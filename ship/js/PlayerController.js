// ============================================================
// PlayerController.js — PointerLock + WASD + 椭圆边界（移植自 飞船.html）
// 绑定主相机，支持强制原点偏移（跃迁时舱室移动后自动跟随）
// ============================================================
import * as THREE from 'three';

export class PlayerController {
    /**
     * @param {THREE.Camera} camera
     * @param {{rx:number,rz:number}} room — 椭圆尺寸
     * @param {HTMLCanvasElement} canvas
     * @param {Function} onLockChange — (isLocked) => void
     */
    constructor(camera, room, canvas, onLockChange) {
        this.camera = camera;
        this.room = room;
        this.canvas = canvas;
        this.onLockChange = onLockChange || (() => {});

        this.origin = new THREE.Vector3();     // 舱室原点世界坐标
        this.move = { forward: false, backward: false, left: false, right: false };
        this.velocity = new THREE.Vector3();
        this.direction = new THREE.Vector3();
        this.isLocked = false;
        this._enabled = false;

        this._bind();
    }

    setOrigin(v) {
        const delta = new THREE.Vector3().copy(v).sub(this.origin);
        this.camera.position.add(delta);
        this.origin.copy(v);
    }

    _bind() {
        document.addEventListener('pointerlockchange', () => {
            this.isLocked = document.pointerLockElement !== null;
            this.onLockChange(this.isLocked);
        });

        document.addEventListener('keydown', (e) => {
            if (!this._enabled) return;
            if (e.code === 'KeyW') this.move.forward = true;
            if (e.code === 'KeyS') this.move.backward = true;
            if (e.code === 'KeyA') this.move.left = true;
            if (e.code === 'KeyD') this.move.right = true;
        });
        document.addEventListener('keyup', (e) => {
            if (e.code === 'KeyW') this.move.forward = false;
            if (e.code === 'KeyS') this.move.backward = false;
            if (e.code === 'KeyA') this.move.left = false;
            if (e.code === 'KeyD') this.move.right = false;
        });
    }

    update(dt) {
        if (!this._enabled || !this.isLocked) return;
        const d = Math.min(dt, 0.1);

        this.velocity.x -= this.velocity.x * 8.0 * d;
        this.velocity.z -= this.velocity.z * 8.0 * d;

        this.direction.z = Number(this.move.forward) - Number(this.move.backward);
        this.direction.x = Number(this.move.right) - Number(this.move.left);
        if (this.direction.lengthSq() > 0) this.direction.normalize();

        if (this.move.forward || this.move.backward) this.velocity.z -= this.direction.z * 28 * d;
        if (this.move.left || this.move.right) this.velocity.x -= this.direction.x * 28 * d;

        // PointerLockControls 移动
        const plc = this._plc;
        if (plc) {
            plc.moveRight(-this.velocity.x * d);
            plc.moveForward(-this.velocity.z * d);
        }

        // 椭圆边界
        const R = this.room;
        const margin = 0.6;
        const lx = R.rx - margin, lz = R.rz - margin;
        const px = this.camera.position.x - this.origin.x;
        const pz = this.camera.position.z - this.origin.z;
        const ev = (px * px) / (lx * lx) + (pz * pz) / (lz * lz);
        if (ev > 1) {
            const a = Math.atan2(pz, px);
            this.camera.position.x = this.origin.x + Math.cos(a) * lx;
            this.camera.position.z = this.origin.z + Math.sin(a) * lz;
            this.velocity.x *= 0.3; this.velocity.z *= 0.3;
        }
        const dc = Math.sqrt(px * px + pz * pz);
        if (dc < 1.4) {
            const a = Math.atan2(pz, px);
            this.camera.position.x = this.origin.x + Math.cos(a) * 1.4;
            this.camera.position.z = this.origin.z + Math.sin(a) * 1.4;
            this.velocity.x *= 0.3; this.velocity.z *= 0.3;
        }
        this.camera.position.y = this.origin.y + 1.65;
    }

    set enabled(v) {
        this._enabled = v;
        if (!v && this.isLocked) document.exitPointerLock();
    }
    get enabled() { return this._enabled; }
    enable() { this._enabled = true; }
    disable() { this._enabled = false; if (this.isLocked) document.exitPointerLock(); }

    /** 由 ShipModule 注入 PointerLockControls 实例 */
    setPointerLockControls(plc) { this._plc = plc; }
}
