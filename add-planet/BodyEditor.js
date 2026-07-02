// ============================================================
// BodyEditor.js — 星体编辑器（可视化放置 + 初速度选择）
// 步骤：① XZ平面定位 → ② Y高度 → ③ 速度方向(XZ面) → ④ 速度仰角
// 实时显示坐标 + 角度（偏X轴 / 偏XZ面仰角）
// ============================================================

import * as THREE from 'three';
import { CelestialBody } from '../js/CelestialBody.js';
import { POS_SCALE, SYSTEM_SCALE, G, AU } from '../js/constants.js';
import { screenToNDC } from '../js/utils.js';
import { PlacementHUD } from './PlacementHUD.js';
import { PlacementGuides } from './PlacementGuides.js';

export class BodyEditor {
    constructor(scene, camera, canvas, planets, physics, app) {
        this.scene = scene;
        this.camera = camera;
        this.canvas = canvas;
        this.planets = planets;
        this.physics = physics;
        this.app = app;

        this.customBodies = [];

        /** 状态机：idle | placing_xz | placing_y | placing_v_azimuth | placing_v_elevation */
        this.state = 'idle';
        this._lockedXZ = null;
        this._lockedY = 0;

        // 初速度
        this._vDir = new THREE.Vector3(0, 0, 0);
        this._vMag = 0;
        this._vAzimDir = new THREE.Vector3();
        this._bodyPos = new THREE.Vector3();

        // 引导元素
        this.guides = new PlacementGuides(this.scene);

        // HUD（挂载到添加面板底部）
        const panel = document.getElementById('add-body-panel');
        this.hud = new PlacementHUD({ parent: panel || document.body, position: 'panel-bottom' });
        this.hud.hide();

        this._onMouseMove_bound = this._onMouseMove.bind(this);
        this._onClick_bound = this._onClick.bind(this);
    }

    // ==================== 公开接口 ====================
    enterPlaceMode() {
        this.state = 'placing_xz';
        this._lockedXZ = null;
        this._vDir.set(0, 0, 0);
        this._vAzimDir.set(0, 0, 0);
        this._vMag = 0;
        this.guides.show();
        this.hud.show();
        this.hud.clearAngles();
        this.hud.updateHint('点击视图放置 XZ 位置');
        this.canvas.style.cursor = 'crosshair';
        this.canvas.addEventListener('mousemove', this._onMouseMove_bound);
        this.canvas.addEventListener('click', this._onClick_bound);
    }

    exitPlaceMode() {
        this.state = 'idle';
        this._lockedXZ = null;
        this.guides.hide();
        this.guides.clearAll();
        this.hud.hide();
        this.canvas.style.cursor = '';
        this.canvas.removeEventListener('mousemove', this._onMouseMove_bound);
        this.canvas.removeEventListener('click', this._onClick_bound);
    }

    /** 进入初速度方向选择（从面板按钮触发） */
    startVelocityPick() {
        if (this.state !== 'idle' && this.state !== 'placed') return;
        this.state = 'placing_v_azimuth';
        this._bodyPos.set(this._lockedXZ.x, this._lockedY, this._lockedXZ.z);
        this.guides.show();
        this.hud.show();
        this.hud.updateHint('点击/移动选择速度方向（XZ面）');
        this.canvas.style.cursor = 'crosshair';
        this.canvas.addEventListener('mousemove', this._onMouseMove_bound);
        this.canvas.addEventListener('click', this._onClick_bound);
    }

    /** 获取当前初速度（SI 单位） */
    getVelocity() {
        return this._vDir.clone().normalize().multiplyScalar(this._vMag);
    }

    // ==================== 事件 ====================
    _onMouseMove(event) {
        switch (this.state) {
            case 'placing_xz': this._updateXZ(event); break;
            case 'placing_y': this._updateY(event); break;
            case 'placing_v_azimuth': this._updateVAzimuth(event); break;
            case 'placing_v_elevation': this._updateVElevation(event); break;
        }
    }

    _onClick(event) {
        switch (this.state) {
            case 'placing_xz': this._lockXZ(event); break;
            case 'placing_y': this._lockY(event); break;
            case 'placing_v_azimuth': this._lockVAzimuth(event); break;
            case 'placing_v_elevation': this._lockVElevation(event); break;
        }
    }

    // ---- XZ 平面射线 ----
    _raycastXZ(event) {
        const { x, y } = screenToNDC(event, this.canvas);
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(x, y), this.camera);
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const intersect = new THREE.Vector3();
        raycaster.ray.intersectPlane(plane, intersect);
        return intersect;
    }

    _screenYToY(event) {
        const rect = this.canvas.getBoundingClientRect();
        return THREE.MathUtils.clamp((1 - (event.clientY - rect.top) / rect.height) * 1000 - 300, -300, 300);
    }

    _updateXZ(event) {
        const pt = this._raycastXZ(event);
        if (!pt) return;
        this.guides.updateXZ(pt.x, pt.z);
        this.hud.updatePosition(pt.x, 0, pt.z);
        this.hud.clearAngles();
    }

    _lockXZ(event) {
        const pt = this._raycastXZ(event);
        if (!pt) return;
        this._lockedXZ = { x: pt.x, z: pt.z };
        this.state = 'placing_y';
        this.hud.updateHint('上下移动鼠标选择 Y 高度，点击确认');
    }

    _updateY(event) {
        this._lockedY = this._screenYToY(event);
        this.guides.updateY(this._lockedXZ.x, this._lockedY, this._lockedXZ.z);
        this.hud.updatePosition(this._lockedXZ.x, this._lockedY, this._lockedXZ.z);
        this.hud.clearAngles();
    }

    _lockY(event) {
        const x = this._lockedXZ.x, z = this._lockedXZ.z, y = this._lockedY;

        // 如果速度大小为0，直接完成位置放置
        if (this._vMag < 0.01) {
            this.state = 'placed';
            this.guides.showFinalPos(x, y, z);
            this.hud.updatePosition(x, y, z);
            if (this.app._onPlacementDone) {
                const dist = Math.sqrt(x * x + y * y + z * z);
                const au = (dist / POS_SCALE / SYSTEM_SCALE / AU) || 2;
                this.app._onPlacementDone(x, y, z, au);
            }
            return;
        }

        // 有初速度 → 进入速度方向选择
        this.state = 'placing_v_azimuth';
        this._bodyPos.set(x, y, z);
        this.guides.updateY(x, y, z);
        this.hud.updateHint('移动鼠标选择速度方向（XZ面），点击确认');
    }

    // ---- 初速度方向：第一步 水平方向（绿色箭头） ----
    _updateVAzimuth(event) {
        const pt = this._raycastXZ(event);
        if (!pt) return;
        const dir = new THREE.Vector3(pt.x, 0, pt.z).sub(this._bodyPos);
        dir.y = 0;
        if (dir.lengthSq() < 0.0001) return;
        dir.normalize();
        this._vAzimDir.copy(dir);
        this._vDir.copy(dir);
        this.guides.updateVelocityYaw(this._bodyPos, dir);
        const azimDeg = (Math.atan2(dir.z, dir.x) * 180 / Math.PI).toFixed(1);
        this.hud.updateAngles(azimDeg, '0.0');
        this.hud.updatePosition(this._bodyPos.x, this._bodyPos.y, this._bodyPos.z);
        this.hud.updateHint('偏X轴: ' + azimDeg + '° · 点击锁定水平方向');
    }

    _lockVAzimuth(event) {
        const pt = this._raycastXZ(event);
        if (!pt) return;
        const dir = new THREE.Vector3(pt.x, 0, pt.z).sub(this._bodyPos);
        dir.y = 0;
        if (dir.lengthSq() < 0.0001) return;
        this._vAzimDir.copy(dir.normalize());
        this.state = 'placing_v_elevation';
        this.hud.updateHint('上下移动鼠标调整速度仰角，点击确认');
    }

    // ---- 初速度方向：第二步 俯仰角（橙色箭头） ----
    _updateVElevation(event) {
        const rect = this.canvas.getBoundingClientRect();
        const t = 1 - (event.clientY - rect.top) / rect.height;
        const pitchAngle = THREE.MathUtils.clamp((t - 0.5) * Math.PI * 2.5, -Math.PI*6, Math.PI*6);
        const hDir = this._vAzimDir.clone().normalize();
        // 在水平方向和Y轴构成的平面内旋转
        const axis = new THREE.Vector3().crossVectors(hDir, new THREE.Vector3(0, 1, 0)).normalize();
        if (axis.lengthSq() < 0.0001) axis.set(0, 0, 1);
        const elevDir = hDir.clone().applyAxisAngle(axis, pitchAngle);
        this.guides.updateVelocityPitch(this._bodyPos, elevDir);

        const azimDeg = (Math.atan2(elevDir.z, elevDir.x) * 180 / Math.PI).toFixed(1);
        const elevDeg = (pitchAngle * 180 / Math.PI).toFixed(1);
        this.hud.updateAngles(azimDeg, elevDeg);
        this.hud.updateHint('偏X轴: ' + azimDeg + '° · 仰角: ' + elevDeg + '° · 点击确认');
    }

    _lockVElevation(event) {
        const rect = this.canvas.getBoundingClientRect();
        const t = 1 - (event.clientY - rect.top) / rect.height;
        const pitchAngle = THREE.MathUtils.clamp((t - 0.5) * Math.PI / 1.5, -Math.PI / 3, Math.PI / 3);
        const hDir = this._vAzimDir.clone().normalize();
        const axis = new THREE.Vector3().crossVectors(hDir, new THREE.Vector3(0, 1, 0)).normalize();
        if (axis.lengthSq() < 0.0001) axis.set(0, 0, 1);
        this._vDir = hDir.clone().applyAxisAngle(axis, pitchAngle);

        this.state = 'placed';
        this.guides.showFinalPos(this._bodyPos.x, this._bodyPos.y, this._bodyPos.z);
        this.hud.updatePosition(this._bodyPos.x, this._bodyPos.y, this._bodyPos.z);
        if (this.app._onPlacementDone) {
            const x = this._bodyPos.x, y = this._bodyPos.y, z = this._bodyPos.z;
            const dist = Math.sqrt(x * x + y * y + z * z);
            const au = (dist / POS_SCALE / SYSTEM_SCALE / AU) || 2;
            this.app._onPlacementDone(x, y, z, au);
        }
    }

    // ==================== 增删改 ====================
    setVelocityMagnitude(mag) {
        this._vMag = Math.max(0, mag);
    }

    confirmCreate(opts) {
        const { name, mass, radius, color, visualR, x, y, z } = opts;

        const key = `custom_${Date.now()}`;
        // 场景坐标 → SI 坐标（含 SYSTEM_SCALE）
        const siX = x / (POS_SCALE * SYSTEM_SCALE);
        const siY = y / (POS_SCALE * SYSTEM_SCALE);
        const siZ = z / (POS_SCALE * SYSTEM_SCALE);
        const dist = Math.sqrt(siX * siX + siY * siY + siZ * siZ);

        const customVel = this.getVelocity();
        const useCustomVel = customVel.length() > 0.01;
        let vel;
        if (useCustomVel) {
            vel = customVel.clone();
        } else {
            const orbitSpeed = Math.sqrt(G * this.planets.sun.mass / Math.max(dist, 1e9));
            const posNorm = new THREE.Vector3(siX, siY, siZ).normalize();
            const tangent = new THREE.Vector3(0, 1, 0).cross(posNorm).normalize();
            if (tangent.length() < 0.01) tangent.set(1, 0, 0);
            vel = tangent.multiplyScalar(orbitSpeed);
        }

        // 史瓦西半径检测 → 黑洞
        const G_const = 6.67430e-11;
        const c_const = 299792458;
        const rSchwarzschild = 2 * G_const * (mass || 1e24) / (c_const * c_const);
        const isBlackHole = (radius || 5000) * 1000 <= rSchwarzschild;

        if (isBlackHole) {
            // 创建黑洞视觉效果
            import('../add-planet/BlackHoleEffect.js').then(mod => {
                const bh = new mod.BlackHoleEffect();
                bh.show(4000);
            });
            // 创建黑洞标记（暗色球体 + 吸积盘光晕）
            const bhGroup = new THREE.Group();
            const bhSize = (visualR || 1.0) * SYSTEM_SCALE;
            const bhSphere = new THREE.Mesh(
                new THREE.SphereGeometry(bhSize, 32, 32),
                new THREE.MeshBasicMaterial({ color: 0x000000 })
            );
            bhSphere.position.set(x, y, z);
            this.scene.add(bhSphere);
            // 吸积盘光晕
            const glowRing = new THREE.Mesh(
                new THREE.RingGeometry(bhSize * 1.5, bhSize * 3, 64),
                new THREE.MeshBasicMaterial({
                    color: 0x8844ff, transparent: true, opacity: 0.3,
                    side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false
                })
            );
            glowRing.rotation.x = -Math.PI / 2;
            glowRing.position.set(x, y, z);
            this.scene.add(glowRing);
            this.customBodies.push({ key, name, body: null, mass: mass || 1e24, radius: (radius || 5000) * 1000, isBlackHole: true });
            alert('✦ 该天体超出史瓦西半径，已创建黑洞！');
            return;
        }

        const body = new CelestialBody({
            key, name, nameCN: name,
            mass: mass || 1e24,
            radius: (radius || 5000) * 1000,
            orbitRadius: dist,
            visualRadius: visualR || 1.0,
            color: color || '#ff8844',
            details: `自定义星体: ${name}${useCustomVel ? ' (自定义初速度)' : ''}`,
            scene: this.scene,
        });

        body.position.set(siX, siY, siZ);
        body.velocity.copy(vel);
        body._syncMeshPosition();

        this.planets[key] = body;
        this.physics.addBody(body);
        this.customBodies.push({ key, name, body, mass: body.mass, radius: body.realRadius, visualR: visualR || 1.0 });

        this.guides.hide();

        const azimDeg = useCustomVel ? (Math.atan2(this._vDir.z, this._vDir.x) * 180 / Math.PI).toFixed(1) : '轨道';
        console.log('[BodyEditor] 创建:', name, '速度:', useCustomVel ? `自定义(${azimDeg}°)` : '计算轨道', 'v=', vel.length().toExponential(2));
    }

    highlightBody(key, show) {
        const entry = this.customBodies.find(c => c.key === key);
        if (!entry || !entry.body || !entry.body.mesh) return;
        entry.body.mesh.material.emissive = show ? new THREE.Color(0x4488ff) : new THREE.Color(0x000000);
        entry.body.mesh.material.emissiveIntensity = show ? 0.5 : 0;
    }

    editBody(key, updates) {
        const entry = this.customBodies.find(c => c.key === key);
        if (!entry || !entry.body) return;
        if (updates.name) entry.body.name = updates.name;
        if (updates.mass) entry.body.mass = updates.mass;
        if (updates.visualR) {
            entry.body.visualRadius = updates.visualR;
            if (entry.body.mesh) entry.body.mesh.scale.setScalar(SYSTEM_SCALE * updates.visualR);
        }
        entry.name = entry.body.name;
        entry.mass = entry.body.mass;
        entry.visualR = updates.visualR || entry.visualR;
    }

    deleteBody(key) {
        const idx = this.customBodies.findIndex(c => c.key === key);
        if (idx < 0) return;
        const { body } = this.customBodies[idx];
        this.physics.removeBody(body);
        delete this.planets[key];
        body.dispose();
        this.customBodies.splice(idx, 1);
    }

    getCustomBodies() { return this.customBodies; }
}
