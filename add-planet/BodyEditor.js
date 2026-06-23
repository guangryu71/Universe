// ============================================================
// BodyEditor.js — 星体编辑器（可视化放置 + 初速度选择）
// 步骤：① XZ平面定位 → ② Y高度 → ③ 速度方向(XZ面) → ④ 速度仰角
// 实时显示坐标 + 角度（偏X轴 / 偏XZ面仰角）
// ============================================================

import * as THREE from 'three';
import { CelestialBody } from '../js/CelestialBody.js';
import { POS_SCALE, G, AU } from '../js/constants.js';
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
        if (this.state !== 'idle') return;
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
        return THREE.MathUtils.clamp((1 - (event.clientY - rect.top) / rect.height) * 20 - 10, -10, 10);
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
            this.state = 'idle';
            this.guides.hide();
            this.canvas.style.cursor = '';
            this.canvas.removeEventListener('mousemove', this._onMouseMove_bound);
            this.canvas.removeEventListener('click', this._onClick_bound);
            this.guides.updateY(x, y, z);
            this.hud.hide();

            if (this.app._onPlacementDone) {
                const dist = Math.sqrt(x * x + y * y + z * z);
                const au = (dist / POS_SCALE / AU) || 2;
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

    // ---- 初速度方向：第一步 XZ 面 ----
    _updateVAzimuth(event) {
        const pt = this._raycastXZ(event);
        if (!pt) return;
        const dir = new THREE.Vector3(pt.x, 0, pt.z).sub(this._bodyPos).normalize();
        if (dir.length() < 0.001) return;
        this._vAzimDir = dir.clone();
        this.guides.updateVelocityArrow(this._bodyPos, dir);
        const azimDeg = (Math.atan2(dir.z, dir.x) * 180 / Math.PI).toFixed(1);
        this.hud.updateAngles(azimDeg, '0.0');
        this.hud.updatePosition(this._bodyPos.x, this._bodyPos.y, this._bodyPos.z);
        this.hud.updateHint(`偏X轴: ${azimDeg}° · 点击锁定方向`);
    }

    _lockVAzimuth(event) {
        const pt = this._raycastXZ(event);
        if (!pt) return;
        const dir = new THREE.Vector3(pt.x, 0, pt.z).sub(this._bodyPos);
        if (dir.length() < 0.001) return;
        this._vAzimDir = dir.normalize();
        this.state = 'placing_v_elevation';
        this.hud.updateHint('上下移动鼠标调整速度仰角（偏XZ面），点击确认');
    }

    // ---- 初速度方向：第二步 Z 轴高度（仰角） ----
    _updateVElevation(event) {
        const rect = this.canvas.getBoundingClientRect();
        const t = 1 - (event.clientY - rect.top) / rect.height;
        const angle = THREE.MathUtils.clamp((t - 0.5) * Math.PI / 1.5, -Math.PI / 3, Math.PI / 3);
        const hDir = this._vAzimDir.clone().normalize();
        const elevDir = hDir.clone().multiplyScalar(Math.cos(angle))
            .add(new THREE.Vector3(0, Math.sin(angle), 0)).normalize();
        this.guides.updateVelocityArrow(this._bodyPos, elevDir);

        const azimDeg = (Math.atan2(elevDir.z, elevDir.x) * 180 / Math.PI).toFixed(1);
        const elevDeg = (Math.asin(THREE.MathUtils.clamp(elevDir.y, -1, 1)) * 180 / Math.PI).toFixed(1);
        this.hud.updateAngles(azimDeg, elevDeg);
        this.hud.updateHint(`偏X轴: ${azimDeg}° · 仰角: ${elevDeg}° · 点击确认`);
    }

    _lockVElevation(event) {
        const rect = this.canvas.getBoundingClientRect();
        const t = 1 - (event.clientY - rect.top) / rect.height;
        const angle = THREE.MathUtils.clamp((t - 0.5) * Math.PI / 1.5, -Math.PI / 3, Math.PI / 3);
        const hDir = this._vAzimDir.clone().normalize();
        this._vDir = hDir.clone().multiplyScalar(Math.cos(angle))
            .add(new THREE.Vector3(0, Math.sin(angle), 0)).normalize();

        this.state = 'idle';
        this.guides.hide();
        this.guides.clearAll();
        this.hud.hide();
        this.canvas.style.cursor = '';
        this.canvas.removeEventListener('mousemove', this._onMouseMove_bound);
        this.canvas.removeEventListener('click', this._onClick_bound);

        // 回调通知 app
        if (this.app._onVelocityDone) this.app._onVelocityDone();
    }

    // ==================== 增删改 ====================
    setVelocityMagnitude(mag) {
        this._vMag = Math.max(0, mag);
    }

    confirmCreate(opts) {
        const { name, mass, radius, color, visualR, x, y, z } = opts;

        const key = `custom_${Date.now()}`;
        const siX = x / POS_SCALE, siY = y / POS_SCALE, siZ = z / POS_SCALE;
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
        this.customBodies.push({ key, name, body });

        this.guides.hide();

        const azimDeg = useCustomVel ? (Math.atan2(this._vDir.z, this._vDir.x) * 180 / Math.PI).toFixed(1) : '轨道';
        console.log('[BodyEditor] 创建:', name, '速度:', useCustomVel ? `自定义(${azimDeg}°)` : '计算轨道', 'v=', vel.length().toExponential(2));
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
