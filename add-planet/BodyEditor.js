// ============================================================
// BodyEditor.js — 星体编辑器（可视化放置 + 初速度选择）
// 步骤：① XZ平面定位 → ② Y高度 → ③ 速度方向(XZ面) → ④ 速度仰角
// 实时显示坐标 + 角度（偏X轴 / 偏XZ面仰角）
// 放置状态机委托给 PlacementController
// ============================================================

import * as THREE from 'three';
import { CelestialBody } from '../js/CelestialBody.js';
import { POS_SCALE, SYSTEM_SCALE, G, AU } from '../js/constants.js';
import { PlacementController } from './PlacementController.js?v=2';

export class BodyEditor {
    constructor(scene, camera, canvas, planets, physics, app) {
        this.scene = scene;
        this.camera = camera;
        this.canvas = canvas;
        this.planets = planets;
        this.physics = physics;
        this.app = app;

        this.customBodies = [];

        // 使用共享的 PlacementController 处理放置状态机
        this.placementCtrl = new PlacementController({
            scene, camera, canvas,
            hudParent: (app && app._hudContainer) || document.body,
            hudPosition: 'panel-bottom',
            onPlaced: (x, y, z, velocity) => this._onPlaced(x, y, z, velocity),
            onPositionUpdate: (app && app._onPositionUpdate) || undefined,
        });
    }

    /** 放置完成回调（来自 PlacementController） */
    _onPlaced(x, y, z, velocity) {
        const dist = Math.sqrt(x * x + y * y + z * z);
        const au = (dist / POS_SCALE / SYSTEM_SCALE / AU) || 2;
        this._placementVelocity = velocity;
        if (this.app._onPlacementDone) {
            this.app._onPlacementDone(x, y, z, au);
        }
    }

    // ==================== 公开接口（委托给 PlacementController）====================

    enterPlaceMode() {
        this.placementCtrl.enterPlaceMode();
    }

    exitPlaceMode() {
        this.placementCtrl.exitPlaceMode();
    }

    startVelocityPick(mag) {
        const pos = this.placementCtrl.getPlacedPos();
        if (!pos) return;
        const speed = mag ?? (parseFloat(document.getElementById('abp-vel-speed')?.value) || 0);
        this.placementCtrl.startVelocityPick(pos, speed);
    }

    getVelocity() {
        return this.placementCtrl.getVelocity();
    }

    setVelocityMagnitude(mag) {
        this.placementCtrl.setVelocityMag(mag);
    }

    // ==================== 增删改 ====================

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
        } else if (this.planets && this.planets.sun) {
            // 有中心恒星 → 计算轨道速度
            const orbitSpeed = Math.sqrt(G * this.planets.sun.mass / Math.max(dist, 1e9));
            const posNorm = new THREE.Vector3(siX, siY, siZ).normalize();
            const tangent = new THREE.Vector3(0, 1, 0).cross(posNorm).normalize();
            if (tangent.length() < 0.01) tangent.set(1, 0, 0);
            vel = tangent.multiplyScalar(orbitSpeed);
        } else {
            // 无中心恒星（如实验室）→ 静止
            vel = new THREE.Vector3(0, 0, 0);
        }

        // 史瓦西半径检测 → 黑洞
        const G_const = 6.67430e-11;
        const c_const = 299792458;
        const rSchwarzschild = 2 * G_const * (mass || 1e24) / (c_const * c_const);
        const isBlackHole = (radius || 6371000) <= rSchwarzschild;

        if (isBlackHole) {
            // 创建黑洞视觉效果（屏幕闪白）
            import('../add-planet/BlackHoleEffect.js').then(mod => {
                const bh = new mod.BlackHoleEffect();
                bh.show(4000);
            });

            // 创建带有质量的 CelestialBody（供物理引擎计算引力）
            const bhBody = new CelestialBody({
                key, name, nameCN: name,
                mass: mass || 1e24,
                radius: Math.max(1, (radius || 6371000)),
                orbitRadius: dist,
                visualRadius: (visualR || 1.0) * 0.01, // 极小，实际用下方黑洞球体显示
                color: 0x000000,
                details: `🕳️ 黑洞: ${name} · 史瓦西半径 ${(rSchwarzschild/1000).toFixed(2)} km · 质量 ${((mass||1e24)/1e30).toFixed(2)} M☉`,
                scene: this.scene,
            });
            bhBody.position.set(siX, siY, siZ);
            bhBody.velocity.copy(vel);
            bhBody._syncMeshPosition();
            // 隐藏 CelestialBody 自带的微小 mesh，用下方定制显示替代
            if (bhBody.mesh) bhBody.mesh.visible = false;

            // 创建黑洞视觉组（黑球 + 吸积盘），跟随物理位置
            const bhVis = new THREE.Group();
            const bhSize = (visualR || 1.0) * SYSTEM_SCALE;
            const bhSph = new THREE.Mesh(
                new THREE.SphereGeometry(bhSize, 32, 32),
                new THREE.MeshBasicMaterial({ color: 0x000000 })
            );
            bhVis.add(bhSph);
            const glow = new THREE.Mesh(
                new THREE.RingGeometry(bhSize * 1.5, bhSize * 3, 64),
                new THREE.MeshBasicMaterial({
                    color: 0x8844ff, transparent: true, opacity: 0.3,
                    side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
                })
            );
            glow.rotation.x = -Math.PI / 2;
            bhVis.add(glow);
            bhVis.position.copy(bhBody.mesh.position);
            this.scene.add(bhVis);

            // 覆盖同步函数：物理位置更新时同时移动视觉组
            bhBody._bhVisuals = bhVis;
            const origSync = bhBody._syncMeshPosition.bind(bhBody);
            bhBody._syncMeshPosition = function () {
                origSync();
                if (this._bhVisuals) this._bhVisuals.position.copy(this.mesh.position);
            };

            // 加入物理引擎
            this.planets[key] = bhBody;
            this.physics.addBody(bhBody);
            this.customBodies.push({ key, name, body: bhBody, mass: mass || 1e24, radius: (radius || 6371000), isBlackHole: true });

            alert('✦ 该天体超出史瓦西半径，已创建黑洞！它将通过引力影响周围天体。');
            return;
        }

        const body = new CelestialBody({
            key, name, nameCN: name,
            mass: mass || 1e24,
            radius: (radius || 6371000),
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

        this.placementCtrl.guides?.hide();

        const vDir = this.placementCtrl._vDir || new THREE.Vector3();
        const azimDeg = useCustomVel ? (Math.atan2(vDir.z, vDir.x) * 180 / Math.PI).toFixed(1) : '轨道';
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
        const { body, isBlackHole } = this.customBodies[idx];
        this.physics.removeBody(body);
        delete this.planets[key];
        // 清理黑洞视觉组
        if (isBlackHole && body._bhVisuals) {
            body._bhVisuals.traverse(child => {
                if (child.isMesh) { child.geometry?.dispose(); child.material?.dispose(); }
            });
            body._bhVisuals.parent?.remove(body._bhVisuals);
        }
        body.dispose();
        this.customBodies.splice(idx, 1);
    }

    getCustomBodies() { return this.customBodies; }
}
