// ============================================================
// Cockpit.js — 驾驶舱：坐椅、飞行控制
// ============================================================
import * as THREE from 'three';

export class Cockpit {
    /**
     * @param {THREE.Camera} interiorCamera — 内部场景相机
     * @param {object} shipPhysics — ShipPhysics 实例
     * @param {object} shipHUD — ShipHUD 实例
     */
    constructor(interiorCamera, shipPhysics, shipHUD) {
        this.camera = interiorCamera;
        this.shipPhysics = shipPhysics;
        this.hud = shipHUD;

        this.isSeated = false;
        this._seatPosition = null;
        this._seatDirection = null;
        this._playerController = null;

        this._mouseSensitivity = 0.003;

        // 保存站立时的相机状态以便恢复
        this._standPosition = new THREE.Vector3();
        this._standYaw = 0;
        this._standPitch = 0;
    }

    /** 注入 PlayerController 引用以共享按键状态 */
    setPlayerController(pc) {
        this._playerController = pc;
    }

    sit(playerController, seatPos, seatDir) {
        this._standPosition.copy(this.camera.position);
        this._standYaw = playerController.getYaw();
        this._standPitch = playerController.getPitch();

        // 将相机放到飞船头部外部（更清晰的驾驶视野）
        // 飞船前向是 -Z，头部在 Z=5 附近
        this._seatPosition = seatPos.clone();
        this._seatDirection = seatDir.clone().normalize();

        // 外部视角：相机在飞船头部前方 + 偏下偏前
        const exteriorPos = seatPos.clone();
        exteriorPos.z += 4.5;   // 更靠前
        exteriorPos.y += 1.2;   // 更低（避免天花板遮挡）
        this.camera.position.copy(exteriorPos);

        // 看向前方远处（飞船前进方向，稍微朝下）
        const lookTarget = exteriorPos.clone();
        lookTarget.z -= 10.0;
        lookTarget.y -= 1.8;
        this.camera.lookAt(lookTarget);

        // 同步 PlayerController 朝向
        const forward = lookTarget.clone().sub(exteriorPos).normalize();
        playerController.setRotation(Math.atan2(forward.x, forward.z), 0);

        this.isSeated = true;
        playerController.disable();
        this.hud.showCockpitHUD();

        if (document.pointerLockElement !== playerController.canvas) {
            playerController.canvas.requestPointerLock();
        }
    }

    exit(playerController) {
        const behind = this._seatDirection.clone().multiplyScalar(-1.5);
        behind.y += 0.8;
        this.camera.position.copy(this._seatPosition.clone().add(behind));

        playerController.setRotation(this._standYaw, this._standPitch);

        this.isSeated = false;
        playerController.enable();
        this.hud.hideCockpitHUD();
    }

    update(dt, mouseDX, mouseDY) {
        if (!this.isSeated) return;

        if (Math.abs(mouseDX) > 0.001 || Math.abs(mouseDY) > 0.001) {
            this.shipPhysics.rotateShip(
                -mouseDX * this._mouseSensitivity,
                -mouseDY * this._mouseSensitivity
            );
        }

        // 从 PlayerController 读取 W 键状态（共享同一套 WASD 监听）
        const isThrusting = this._playerController ? this._playerController.isThrustKeyDown() : false;
        const shipForward = this.shipPhysics.getForward();
        this.shipPhysics.update(dt, isThrusting, shipForward);

        this.hud.updateSpeed(this.shipPhysics.getSpeed());
    }

    get active() { return this.isSeated; }
}
