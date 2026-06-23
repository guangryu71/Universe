// ============================================================
// PlayerController.js — 地面第一人称控制器（重力 + 水平移动）
// ============================================================
import * as THREE from 'three';

export class PlayerController {
    constructor(camera, collisionBounds, canvas) {
        this.camera = camera;
        this.collisionBounds = collisionBounds;
        this.canvas = canvas;

        this.playerRadius = 0.3;
        this.playerHeight = 1.7;
        this.eyeHeight = 1.55;
        this.moveSpeed = 5.0;
        this.mouseSensitivity = 0.002;

        // 地面重力
        this.gravity = 20;
        this.grounded = true;
        this.floorY = -1.0;       // 地板表面 Y 坐标（动态计算）
        this._verticalVel = 0;

        this.yaw = 0;
        this.pitch = 0;
        this.isLocked = false;
        this._enabled = false;
        this._keys = { w: false, a: false, s: false, d: false };

        this._bindPointerLock();
        this._bindKeys();
        this._bindMouse();
    }

    setTransform(position, direction) {
        this.camera.position.copy(position);
        const dir = direction.clone().normalize();
        this.yaw = Math.atan2(dir.x, dir.z);
        this.pitch = 0;
        // 计算脚底地面
        this._computeFloor();
        this._applyRotation();
    }

    /** 基于碰撞体计算当前位置下的地板高度 */
    _computeFloor() {
        let floor = -2.0; // fallback
        for (const b of this.collisionBounds) {
            const px = this.camera.position.x;
            const pz = this.camera.position.z;
            if (px > b.min.x && px < b.max.x && pz > b.min.z && pz < b.max.z) {
                // 这个碰撞体在玩家脚下 → 地板是它的上表面
                if (b.max.y < this.camera.position.y + 0.5 && b.max.y > floor) {
                    floor = b.max.y;
                }
            }
        }
        this.floorY = floor + 0.05; // 脚底略高于地板
    }

    update(dt) {
        if (!this.isLocked) return;
        const dtClamped = Math.min(dt, 0.1);

        // --- 水平移动（XZ 平面） ---
        const forward = this._getHorizontalForward();
        const right = this._getRight();
        const moveDir = new THREE.Vector3();

        if (this._keys.w) moveDir.add(forward);
        if (this._keys.s) moveDir.sub(forward);
        if (this._keys.a) moveDir.sub(right);
        if (this._keys.d) moveDir.add(right);

        if (moveDir.length() > 1) moveDir.normalize();

        const newPos = this.camera.position.clone();
        newPos.x += moveDir.x * this.moveSpeed * dtClamped;
        newPos.z += moveDir.z * this.moveSpeed * dtClamped;

        // --- 重力 ---
        this._computeFloor();
        const footY = this.camera.position.y - this.eyeHeight;

        if (footY > this.floorY + 0.01) {
            // 在空中，下落
            this._verticalVel -= this.gravity * dtClamped;
            this.grounded = false;
        } else {
            // 着地
            this._verticalVel = 0;
            this.grounded = true;
            newPos.y = this.floorY + this.eyeHeight;
        }

        if (!this.grounded) {
            newPos.y += this._verticalVel * dtClamped;
            // 着地检测
            const newFootY = newPos.y - this.eyeHeight;
            if (newFootY <= this.floorY) {
                newPos.y = this.floorY + this.eyeHeight;
                this._verticalVel = 0;
                this.grounded = true;
            }
        }

        // --- 碰撞检测 ---
        const adjusted = this._resolveCollision(this.camera.position.clone(), newPos);
        this.camera.position.copy(adjusted);

        // 碰撞后重新检查着地
        this._computeFloor();
        const adjFootY = this.camera.position.y - this.eyeHeight;
        if (adjFootY <= this.floorY + 0.01) {
            this.camera.position.y = this.floorY + this.eyeHeight;
            this._verticalVel = 0;
            this.grounded = true;
        }
    }

    _getHorizontalForward() {
        // 相机前方投影到 XZ 平面
        const fwd = new THREE.Vector3(0, 0, -1);
        fwd.applyQuaternion(new THREE.Quaternion().setFromEuler(
            new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ')
        ));
        fwd.y = 0;
        if (fwd.length() < 0.001) return new THREE.Vector3(0, 0, -1);
        return fwd.normalize();
    }

    _getRight() {
        const right = new THREE.Vector3(1, 0, 0);
        right.applyQuaternion(new THREE.Quaternion().setFromEuler(
            new THREE.Euler(0, this.yaw, 0, 'YXZ')
        ));
        return right;
    }

    _applyRotation() {
        this.camera.rotation.order = 'YXZ';
        this.camera.rotation.y = this.yaw;
        this.camera.rotation.x = this.pitch;
    }

    _resolveCollision(oldPos, newPos) {
        const testPos = newPos.clone();
        if (this._isPositionValid(testPos)) return testPos;

        const xOnly = new THREE.Vector3(newPos.x, oldPos.y, oldPos.z);
        if (this._isPositionValid(xOnly)) testPos.x = newPos.x;
        else testPos.x = oldPos.x;

        const zOnly = new THREE.Vector3(oldPos.x, oldPos.y, newPos.z);
        if (this._isPositionValid(zOnly)) testPos.z = newPos.z;
        else testPos.z = oldPos.z;

        testPos.y = oldPos.y;
        return testPos;
    }

    _isPositionValid(pos) {
        const px = pos.x, py = pos.y, pz = pos.z;
        const r = this.playerRadius;
        const hh = this.playerHeight * 0.5;
        for (const b of this.collisionBounds) {
            const closestX = Math.max(b.min.x, Math.min(px, b.max.x));
            const closestY = Math.max(b.min.y, Math.min(py, b.max.y));
            const closestZ = Math.max(b.min.z, Math.min(pz, b.max.z));
            const dx = px - closestX;
            const dy = py - closestY;
            const dz = pz - closestZ;
            const distXZ = Math.sqrt(dx * dx + dz * dz);
            if (distXZ < r && Math.abs(dy) < hh + 0.1) return false;
        }
        return true;
    }

    // --- 输入 ---
    _bindPointerLock() {
        document.addEventListener('pointerlockchange', () => {
            this.isLocked = document.pointerLockElement === this.canvas;
        });
    }

    _bindKeys() {
        const setKey = (e, v) => {
            const k = e.key.toLowerCase();
            if (k in this._keys) { this._keys[k] = v; e.preventDefault(); }
        };
        document.addEventListener('keydown', e => setKey(e, true));
        document.addEventListener('keyup', e => setKey(e, false));
    }

    _bindMouse() {
        document.addEventListener('mousemove', (e) => {
            if (!this.isLocked) return;
            this.yaw -= e.movementX * this.mouseSensitivity;
            this.pitch -= e.movementY * this.mouseSensitivity;
            this.pitch = Math.max(-Math.PI * 0.45, Math.min(Math.PI * 0.45, this.pitch));
            this._applyRotation();
        });
    }

    set enabled(v) {
        this._enabled = v;
        if (!v && this.isLocked) document.exitPointerLock();
    }
    get enabled() { return this._enabled; }

    enable()  { this._enabled = true; }
    disable() { this._enabled = false; if (this.isLocked) document.exitPointerLock(); }

    unlock() {
        this._enabled = false;
        if (this.isLocked) document.exitPointerLock();
    }

    setRotation(yaw, pitch) {
        this.yaw = yaw;
        this.pitch = pitch;
        this._applyRotation();
    }
    getYaw()   { return this.yaw; }
    getPitch() { return this.pitch; }
    isThrustKeyDown() { return this._keys.w; }

    getForward() { return this._getHorizontalForward(); }
}
