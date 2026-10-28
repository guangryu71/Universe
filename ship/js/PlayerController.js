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
     * @param {number} scale — 舱室在世界坐标中的整体缩放（默认 1）
     */
    constructor(camera, room, canvas, onLockChange, scale = 1) {
        this.camera = camera;
        this.room = room;
        this.canvas = canvas;
        this.onLockChange = onLockChange || (() => {});
        this.scale = scale;

        this.origin = new THREE.Vector3();     // 舱室原点世界坐标
        this.move = { forward: false, backward: false, left: false, right: false };
        this.velocity = new THREE.Vector3();
        this.direction = new THREE.Vector3();
        this.isLocked = false;
        this._enabled = false;
        this.floorHeight = null;   // 可选：(x, z) => 地板高度（舱室本地坐标）

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

        // 记录移动前的位置：碰到舱室边界时回退到上一帧位置，
        // 而不是把玩家投影到椭圆上（投影会产生沿窗面的“强行拖拽”）
        const prevX = this.camera.position.x;
        const prevZ = this.camera.position.z;

        // PointerLockControls 移动（移动距离按舱室缩放）
        const s = this.scale;
        const plc = this._plc;
        if (plc) {
            plc.moveRight(-this.velocity.x * d * s);
            plc.moveForward(-this.velocity.z * d * s);
        }

        // 椭圆边界（舱室尺寸 × 缩放 → 世界坐标）
        // margin 必须随舱室一起缩放：若用固定世界单位，缩放后的舱室
        // 活动范围会远小于可见地板，玩家会被卡在一个小圈里
        const R = this.room;
        const margin = 0.6 * s;
        const lx = R.rx * s - margin, lz = R.rz * s - margin;
        const px = this.camera.position.x - this.origin.x;
        const pz = this.camera.position.z - this.origin.z;
        const ev = (px * px) / (lx * lx) + (pz * pz) / (lz * lz);
        if (ev > 1) {
            const ppx = prevX - this.origin.x;
            const ppz = prevZ - this.origin.z;
            const prevEv = (ppx * ppx) / (lx * lx) + (ppz * ppz) / (lz * lz);
            if (prevEv > 1) {
                // 上一帧就已经在界外（例如舱室缩放变化）→ 投影回边界
                const a = Math.atan2(pz, px);
                this.camera.position.x = this.origin.x + Math.cos(a) * lx;
                this.camera.position.z = this.origin.z + Math.sin(a) * lz;
            } else {
                this.camera.position.x = prevX;
                this.camera.position.z = prevZ;
            }
            this.velocity.x *= 0.2; this.velocity.z *= 0.2;
        }
        const inner = 1.4 * s;
        const dc = Math.sqrt(px * px + pz * pz);
        if (dc < inner) {
            const ppx = prevX - this.origin.x;
            const ppz = prevZ - this.origin.z;
            const prevDc = Math.sqrt(ppx * ppx + ppz * ppz);
            if (prevDc < inner) {
                const a = Math.atan2(pz, px);
                this.camera.position.x = this.origin.x + Math.cos(a) * inner;
                this.camera.position.z = this.origin.z + Math.sin(a) * inner;
            } else {
                this.camera.position.x = prevX;
                this.camera.position.z = prevZ;
            }
            this.velocity.x *= 0.2; this.velocity.z *= 0.2;
        }
        // 地板高度函数使用舱室本地坐标，返回值同样按缩放换算到世界坐标
        const fy = this.floorHeight
            ? this.floorHeight((this.camera.position.x - this.origin.x) / s, (this.camera.position.z - this.origin.z) / s)
            : 0;
        this.camera.position.y = this.origin.y + (1.65 + fy) * s;
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
