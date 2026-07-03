// ============================================================
// PlacementController.js — 可视化放置控制器（状态机）
// 步骤：① XZ平面定位 → ② Y高度 → ③ 速度方向(XZ面) → ④ 速度仰角
// BodyEditor 与 PlanetLab 共用此模块，消除重复
// ============================================================

import * as THREE from 'three';
import { screenToNDC } from '../js/utils.js';
import { PlacementHUD } from './PlacementHUD.js';
import { PlacementGuides } from './PlacementGuides.js';

/**
 * @callback onPlaced  - (x, y, z, vDir: THREE.Vector3)  全部放置完成时回调
 * @callback onStateChange - (state: string, hint: string) 状态变化时回调
 */

export class PlacementController {
    /**
     * @param {object} opts
     * @param {THREE.Scene}    opts.scene
     * @param {THREE.Camera}   opts.camera
     * @param {HTMLCanvasElement} opts.canvas
     * @param {object}         [opts.hudParent]   — HUD 挂载的 DOM 元素
     * @param {string}         [opts.hudPosition] — 'panel-bottom' | 默认
     * @param {boolean}        [opts.showGuides=true]  — 是否创建可视化引导线
     * @param {boolean}        [opts.showHUD=true]     — 是否创建角度/位置 HUD
     * @param {onPlaced}       opts.onPlaced
     * @param {onStateChange}  [opts.onStateChange]
     * @param {function}       [opts.onPositionUpdate] — (x, y, z) 位置/指向变化时通知
     */
    constructor({ scene, camera, canvas, hudParent, hudPosition,
                  showGuides = true, showHUD = true,
                  onPlaced, onStateChange, onPositionUpdate }) {
        this.scene = scene;
        this.camera = camera;
        this.canvas = canvas;
        this.onPlaced = onPlaced || (() => {});
        this.onStateChange = onStateChange || (() => {});
        this.onPositionUpdate = onPositionUpdate || (() => {});

        /** 状态机：idle | placing_xz | placing_y | placing_v_azimuth | placing_v_elevation | placed */
        this.state = 'idle';
        this._lockedXZ = null;       // { x, z }
        this._lockedY = 0;
        this._vDir = new THREE.Vector3(0, 0, 0);
        this._vMag = 0;
        this._vAzimDir = new THREE.Vector3();
        this._bodyPos = new THREE.Vector3();

        // 引导元素（可选）
        if (showGuides) {
            this.guides = new PlacementGuides(this.scene);
        } else {
            this.guides = null;
        }

        // HUD（可选）
        if (showHUD && hudParent) {
            this.hud = new PlacementHUD({ parent: hudParent, position: hudPosition || 'default' });
        } else {
            this.hud = null;
        }
        if (this.hud) this.hud?.hide();

        this._onMouseMove_bound = this._onMouseMove.bind(this);
        this._onClick_bound = this._onClick.bind(this);
    }

    // ==================== 公开接口 ====================

    /** 进入放置模式：状态 → placing_xz */
    enterPlaceMode() {
        this.state = 'placing_xz';
        this._lockedXZ = null;
        this._vDir.set(0, 0, 0);
        this._vAzimDir.set(0, 0, 0);
        this._vMag = 0;
        this.guides?.show();
        this.hud?.show();
        this.hud?.clearAngles();
        this._setHint('点击视图放置 XZ 位置');
        this.canvas.style.cursor = 'crosshair';
        this.canvas.addEventListener('mousemove', this._onMouseMove_bound);
        this.canvas.addEventListener('click', this._onClick_bound);
    }

    /** 退出放置模式并清理 */
    exitPlaceMode() {
        this.state = 'idle';
        this._lockedXZ = null;
        this.guides?.hide();
        this.guides?.clearAll();
        this.hud?.hide();
        this.canvas.style.cursor = '';
        this.canvas.removeEventListener('mousemove', this._onMouseMove_bound);
        this.canvas.removeEventListener('click', this._onClick_bound);
    }

    /** 从面板触发进入速度方向选择（需在 placed 状态调用） */
    startVelocityPick(bodyPos, vMag) {
        if (this.state !== 'idle' && this.state !== 'placed') return;
        this._vMag = vMag || this._vMag;
        this.state = 'placing_v_azimuth';
        this._bodyPos.copy(bodyPos);
        this.guides?.show();
        this.hud?.show();
        this._setHint('点击/移动选择速度方向（XZ面）');
        this.canvas.style.cursor = 'crosshair';
        this.canvas.addEventListener('mousemove', this._onMouseMove_bound);
        this.canvas.addEventListener('click', this._onClick_bound);
    }

    /** 获取当前初速度（SI 单位向量 × 大小） */
    getVelocity() {
        return this._vDir.clone().normalize().multiplyScalar(this._vMag);
    }

    /** 设置速度大小 */
    setVelocityMag(mag) {
        this._vMag = Math.max(0, mag);
    }

    /** 获取锁定位置 */
    getPlacedPos() {
        if (!this._lockedXZ) return null;
        return new THREE.Vector3(this._lockedXZ.x, this._lockedY, this._lockedXZ.z);
    }

    // ==================== 鼠标事件 ====================

    _onMouseMove(event) {
        switch (this.state) {
            case 'placing_xz':          this._updateXZ(event); break;
            case 'placing_y':           this._updateY(event); break;
            case 'placing_v_azimuth':   this._updateVAzimuth(event); break;
            case 'placing_v_elevation': this._updateVElevation(event); break;
        }
    }

    _onClick(event) {
        switch (this.state) {
            case 'placing_xz':          this._lockXZ(event); break;
            case 'placing_y':           this._lockY(event); break;
            case 'placing_v_azimuth':   this._lockVAzimuth(event); break;
            case 'placing_v_elevation': this._lockVElevation(event); break;
        }
    }

    // ==================== XZ 定位 ====================

    _raycastXZ(event) {
        const { x, y } = screenToNDC(event, this.canvas);
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(x, y), this.camera);
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const intersect = new THREE.Vector3();
        raycaster.ray.intersectPlane(plane, intersect);
        return intersect;
    }

    _screenYToWorldY(event) {
        const rect = this.canvas.getBoundingClientRect();
        return THREE.MathUtils.clamp(
            (1 - (event.clientY - rect.top) / rect.height) * 1000 - 300,
            -300, 300
        );
    }

    _updateXZ(event) {
        const pt = this._raycastXZ(event);
        if (!pt) return;
        this.guides?.updateXZ(pt.x, pt.z);
        this.hud?.updatePosition(pt.x, 0, pt.z);
        this.hud?.clearAngles();
        this.onPositionUpdate(pt.x, 0, pt.z);
    }

    _lockXZ(event) {
        const pt = this._raycastXZ(event);
        if (!pt) return;
        this._lockedXZ = { x: pt.x, z: pt.z };
        this.state = 'placing_y';
        this._setHint('上下移动鼠标选择 Y 高度，点击确认');
    }

    // ==================== Y 高度 ====================

    _updateY(event) {
        this._lockedY = this._screenYToWorldY(event);
        this.guides?.updateY(this._lockedXZ.x, this._lockedY, this._lockedXZ.z);
        this.hud?.updatePosition(this._lockedXZ.x, this._lockedY, this._lockedXZ.z);
        this.hud?.clearAngles();
        this.onPositionUpdate(this._lockedXZ.x, this._lockedY, this._lockedXZ.z);
    }

    _lockY(event) {
        const x = this._lockedXZ.x, z = this._lockedXZ.z, y = this._lockedY;

        // 速度大小为 0 → 直接完成放置
        if (this._vMag < 0.01) {
            this.guides?.showFinalPos(x, y, z);
            this.hud?.updatePosition(x, y, z);
            this.state = 'placed';
            this.onPlaced(x, y, z, new THREE.Vector3(0, 0, 0));
            return;
        }

        // 有初速度 → 进入速度方向选择
        this.state = 'placing_v_azimuth';
        this._bodyPos.set(x, y, z);
        this.guides?.updateY(x, y, z);
        this._setHint('移动鼠标选择速度方向（XZ面），点击确认');
    }

    // ==================== 速度水平方向 ====================

    _updateVAzimuth(event) {
        const pt = this._raycastXZ(event);
        if (!pt) return;
        const dir = new THREE.Vector3(pt.x, 0, pt.z).sub(this._bodyPos);
        dir.y = 0;
        if (dir.lengthSq() < 0.0001) return;
        dir.normalize();
        this._vAzimDir.copy(dir);
        this._vDir.copy(dir);
        this.guides?.updateVelocityYaw(this._bodyPos, dir);
        const azimDeg = (Math.atan2(dir.z, dir.x) * 180 / Math.PI).toFixed(1);
        this.hud?.updateAngles(azimDeg, '0.0');
        this.hud?.updatePosition(this._bodyPos.x, this._bodyPos.y, this._bodyPos.z);
        this.onPositionUpdate(this._bodyPos.x, this._bodyPos.y, this._bodyPos.z);
        this._setHint('偏X轴: ' + azimDeg + '° · 点击锁定水平方向');
    }

    _lockVAzimuth(event) {
        const pt = this._raycastXZ(event);
        if (!pt) return;
        const dir = new THREE.Vector3(pt.x, 0, pt.z).sub(this._bodyPos);
        dir.y = 0;
        if (dir.lengthSq() < 0.0001) return;
        this._vAzimDir.copy(dir.normalize());
        this.state = 'placing_v_elevation';
        this._setHint('上下移动鼠标调整速度仰角，点击确认');
    }

    // ==================== 速度仰角 ====================

    _updateVElevation(event) {
        const rect = this.canvas.getBoundingClientRect();
        const t = 1 - (event.clientY - rect.top) / rect.height;
        const pitchAngle = THREE.MathUtils.clamp(
            (t - 0.5) * Math.PI * 2.5, -Math.PI * 6, Math.PI * 6
        );
        const hDir = this._vAzimDir.clone().normalize();
        const axis = new THREE.Vector3()
            .crossVectors(hDir, new THREE.Vector3(0, 1, 0))
            .normalize();
        if (axis.lengthSq() < 0.0001) axis.set(0, 0, 1);
        const elevDir = hDir.clone().applyAxisAngle(axis, pitchAngle);
        this.guides?.updateVelocityPitch(this._bodyPos, elevDir);

        const azimDeg = (Math.atan2(elevDir.z, elevDir.x) * 180 / Math.PI).toFixed(1);
        const elevDeg = (pitchAngle * 180 / Math.PI).toFixed(1);
        this.hud?.updateAngles(azimDeg, elevDeg);
        this._setHint('偏X轴: ' + azimDeg + '° · 仰角: ' + elevDeg + '° · 点击确认');
    }

    _lockVElevation(event) {
        const rect = this.canvas.getBoundingClientRect();
        const t = 1 - (event.clientY - rect.top) / rect.height;
        const pitchAngle = THREE.MathUtils.clamp(
            (t - 0.5) * Math.PI / 1.5, -Math.PI / 3, Math.PI / 3
        );
        const hDir = this._vAzimDir.clone().normalize();
        const axis = new THREE.Vector3()
            .crossVectors(hDir, new THREE.Vector3(0, 1, 0))
            .normalize();
        if (axis.lengthSq() < 0.0001) axis.set(0, 0, 1);
        this._vDir.copy(hDir.clone().applyAxisAngle(axis, pitchAngle));

        const x = this._bodyPos.x, y = this._bodyPos.y, z = this._bodyPos.z;
        this.guides?.showFinalPos(x, y, z);
        this.hud?.updatePosition(x, y, z);
        this.state = 'placed';
        this.onPlaced(x, y, z, this._vDir.clone().normalize().multiplyScalar(this._vMag));
    }

    // ==================== 辅助 ====================

    _setHint(text) {
        this.hud?.updateHint(text);
        this.onStateChange(this.state, text);
    }
}
