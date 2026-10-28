// ============================================================
// FreeFlyController.js — 星体系统自由飞行预览
//
// 类似《星际拓荒》飞船操作：鼠标转动视角，WASD 平移，
// Shift 加速，Ctrl 下沉，Space 上升，滚轮调节基础速度。
// 只在主场景的星体系统浏览中使用；进入时接管相机并暂停 OrbitControls。
// ============================================================

import * as THREE from 'three';

const PITCH_LIMIT = Math.PI / 2 - 0.02;
const LOOK_SENSITIVITY = 0.0022;
const BOOST_MULTIPLIER = 4;
const ACCEL = 5.5; // 越大越快到达目标速度

export class FreeFlyController {
    /**
     * @param {object} deps
     * @param {THREE.PerspectiveCamera} deps.camera
     * @param {HTMLElement} deps.domElement     — 渲染画布（用于指针锁定）
     * @param {object} deps.controls            — OrbitControls
     * @param {object} deps.focusController     — 聚焦控制器（进入时解除聚焦）
     * @param {function} [deps.onStateChange]   — (active:boolean) => void
     */
    constructor({ camera, domElement, controls, focusController, onStateChange }) {
        this.camera = camera;
        this.domElement = domElement;
        this.controls = controls;
        this.focusController = focusController;
        this.onStateChange = onStateChange || (() => {});

        this._enabled = false;
        this._locked = false;
        this._hasLocked = false;
        this._keys = { forward: false, back: false, left: false, right: false, up: false, down: false, boost: false };
        this._velocity = new THREE.Vector3();
        this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
        this._speed = 40;
        this._speedMultiplier = 1;
        this._lookX = 0;
        this._lookY = 0;

        this._buildHUD();
        this._bindEvents();
    }

    // ==================== 公开 API ====================

    isActive() { return this._enabled; }

    toggle() {
        if (this._enabled) this.disable();
        else this.enable();
    }

    enable() {
        if (this._enabled) return;
        this._enabled = true;

        this.focusController?.dismiss?.();
        this.controls.enabled = false;

        // 记录用于退出时还原 OrbitControls 的距离尺度
        const camPos = this.camera.position;
        this._orbitDistance = Math.max(
            camPos.distanceTo(this.controls.target),
            this.controls.minDistance || 0.5,
        );
        this._speed = Math.max(this._orbitDistance * 0.18, 8);
        this._speedMultiplier = 1;

        this._syncEulerFromCamera();
        this._velocity.set(0, 0, 0);
        this._clearKeys();

        this.hud.classList.remove('hidden');
        this.crosshair.classList.remove('hidden');
        this._updateSpeedLabel();
        this.domElement.style.cursor = 'crosshair';
        this.onStateChange(true);
        this.requestLock();
    }

    disable() {
        if (!this._enabled) return;
        this._enabled = false;
        this._clearKeys();
        this._velocity.set(0, 0, 0);

        if (document.pointerLockElement === this.domElement) {
            try { document.exitPointerLock(); } catch { /* ignore */ }
        }
        this._locked = false;
        this._hasLocked = false;

        this.hud.classList.add('hidden');
        this.crosshair.classList.add('hidden');
        this.domElement.style.cursor = '';

        // 恢复 OrbitControls：以相机前方作为新的旋转中心，保持原有观察距离
        const forward = new THREE.Vector3();
        this.camera.getWorldDirection(forward);
        const dist = Math.min(
            Math.max(this._orbitDistance || 50, this.controls.minDistance || 0.5),
            this.controls.maxDistance || Infinity,
        );
        this.controls.target.copy(this.camera.position).addScaledVector(forward, dist);
        this.controls.enabled = true;
        this.controls.update();

        this.onStateChange(false);
    }

    requestLock() {
        if (!this._enabled) return;
        const result = this.domElement.requestPointerLock?.();
        // Chrome 111+ 返回 Promise；被拒绝时保留模式，等待用户点击画面
        if (result && typeof result.catch === 'function') result.catch(() => {});
    }

    /** 每帧调用；dt 为秒 */
    update(dt) {
        if (!this._enabled) return;

        const speed = this._speed * this._speedMultiplier * (this._keys.boost ? BOOST_MULTIPLIER : 1);
        const forward = new THREE.Vector3();
        this.camera.getWorldDirection(forward);
        const right = new THREE.Vector3().crossVectors(forward, this.camera.up).normalize();
        const desired = new THREE.Vector3();

        if (this._keys.forward) desired.add(forward);
        if (this._keys.back) desired.sub(forward);
        if (this._keys.right) desired.add(right);
        if (this._keys.left) desired.sub(right);
        if (this._keys.up) desired.y += 1;
        if (this._keys.down) desired.y -= 1;

        if (desired.lengthSq() > 0) {
            desired.normalize().multiplyScalar(speed);
        }

        // 速度平滑过渡，松开按键后带一点惯性漂移
        const blend = 1 - Math.exp(-ACCEL * Math.max(dt, 0.0001));
        this._velocity.lerp(desired, blend);
        this.camera.position.addScaledVector(this._velocity, dt);
    }

    // ==================== 内部 ====================

    _syncEulerFromCamera() {
        this._euler.setFromQuaternion(this.camera.quaternion, 'YXZ');
        this._lookY = this._euler.y;
        this._lookX = this._euler.x;
    }

    _applyLook() {
        this._lookX = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this._lookX));
        this._euler.set(this._lookX, this._lookY, 0, 'YXZ');
        this.camera.quaternion.setFromEuler(this._euler);
    }

    _clearKeys() {
        for (const k of Object.keys(this._keys)) this._keys[k] = false;
    }

    _updateSpeedLabel() {
        if (!this.speedEl) return;
        const boost = this._keys.boost ? ` × ${BOOST_MULTIPLIER}` : '';
        this.speedEl.textContent = `${(this._speed * this._speedMultiplier).toFixed(0)}${boost}`;
    }

    _buildHUD() {
        this.hud = document.createElement('div');
        this.hud.id = 'free-fly-hud';
        this.hud.className = 'free-fly-hud hidden';
        this.hud.innerHTML = `
            <div class="ff-title">🛸 自由飞行预览</div>
            <div class="ff-keys"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 移动 · <kbd>Shift</kbd> 加速 · <kbd>Ctrl</kbd> 下沉 · <kbd>Space</kbd> 上升</div>
            <div class="ff-speed">速度 <span id="ff-speed-value">--</span> · 滚轮调速 · <kbd>Esc</kbd> 退出</div>
        `;
        document.body.appendChild(this.hud);
        this.speedEl = this.hud.querySelector('#ff-speed-value');

        this.crosshair = document.createElement('div');
        this.crosshair.className = 'free-fly-crosshair hidden';
        this.crosshair.innerHTML = '<span></span>';
        document.body.appendChild(this.crosshair);
    }

    _bindEvents() {
        // ---- 指针锁定 ----
        document.addEventListener('pointerlockchange', () => {
            const locked = document.pointerLockElement === this.domElement;
            this._locked = locked;
            if (locked) {
                this._hasLocked = true;
                this.requestLockPending = false;
            } else if (this._enabled && this._hasLocked) {
                // 用户按 Esc 或浏览器释放指针 → 退出预览，恢复 OrbitControls
                this.disable();
            }
        });

        // 已开启但尚未锁定时，点击画面重新锁定
        this.domElement.addEventListener('mousedown', (e) => {
            if (!this._enabled || this._locked) return;
            e.preventDefault();
            e.stopPropagation();
            this.requestLock();
        }, true);

        // ---- 鼠标视角 ----
        document.addEventListener('mousemove', (e) => {
            if (!this._enabled || !this._locked) return;
            this._lookY -= e.movementX * LOOK_SENSITIVITY;
            this._lookX -= e.movementY * LOOK_SENSITIVITY;
            this._applyLook();
        });

        // ---- 滚轮调速（捕获阶段拦截 OrbitControls / 聚焦缩放）----
        this.domElement.addEventListener('wheel', (e) => {
            if (!this._enabled) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            const factor = e.deltaY > 0 ? 1 / 1.2 : 1.2;
            this._speedMultiplier = Math.max(0.05, Math.min(20, this._speedMultiplier * factor));
            this._updateSpeedLabel();
        }, { capture: true, passive: false });

        // ---- 键盘 ----
        window.addEventListener('keydown', (e) => {
            if (!this._enabled) return;
            // 未获得指针锁定时 Esc 不会触发 pointerlockchange，这里显式退出
            if (e.code === 'Escape') {
                this.disable();
                return;
            }
            if (!this._locked) return;
            const changed = this._setKey(e.code, true);
            if (changed || e.code === 'Space') e.preventDefault();
            if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this._updateSpeedLabel();
        }, true);
        window.addEventListener('keyup', (e) => {
            if (!this._enabled) return;
            const changed = this._setKey(e.code, false);
            if (changed || e.code === 'Space') e.preventDefault();
            if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this._updateSpeedLabel();
        }, true);

        // 失焦时清空按键，避免“卡键”持续漂移
        window.addEventListener('blur', () => {
            if (!this._enabled) return;
            this._clearKeys();
            this._updateSpeedLabel();
        });
    }

    /** 返回是否识别到了对应按键 */
    _setKey(code, pressed) {
        switch (code) {
            case 'KeyW': this._keys.forward = pressed; return true;
            case 'KeyS': this._keys.back = pressed; return true;
            case 'KeyA': this._keys.left = pressed; return true;
            case 'KeyD': this._keys.right = pressed; return true;
            case 'ShiftLeft':
            case 'ShiftRight': this._keys.boost = pressed; return true;
            case 'ControlLeft':
            case 'ControlRight': this._keys.down = pressed; return true;
            case 'Space': this._keys.up = pressed; return true;
            default: return false;
        }
    }
}
