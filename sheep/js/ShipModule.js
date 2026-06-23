// ============================================================
// ShipModule.js — 飞船模块总协调器
// ============================================================
import * as THREE from 'three';
import { ShipModel } from './ShipModel.js';
import { ShipPhysics } from './ShipPhysics.js';
import { PlayerController } from './PlayerController.js';
import { Interaction } from './Interaction.js';
import { Cockpit } from './Cockpit.js';
import { Projector } from './Projector.js';
import { ShipHUD } from './ShipHUD.js';
import { POS_SCALE } from '../../js/constants.js';

/** 进入飞船时需要隐藏的宇宙 UI 元素 */
const UNIVERSE_UI_IDS = [
    'time-control', 'hint', 'fps', 'bgm-control',
    'chat-launcher', 'voice-settings-btn', 'add-body-btn',
    'view-plane-btns', 'planet-card',
    'ship-entry-btn', 'galaxy-browser-btn', 'planet-lab-btn',
];

export class ShipModule {
    constructor(sceneManager, planets, physics) {
        this.sceneManager = sceneManager;
        this.planets = planets;
        this.physics = physics;

        this.state = 'universe';

        // --- 子模块 ---
        this.shipModel = new ShipModel();
        this.shipPhysics = new ShipPhysics(planets);
        this.shipHUD = new ShipHUD();

        this.interiorCamera = new THREE.PerspectiveCamera(
            70, window.innerWidth / window.innerHeight, 0.05, 50
        );

        this.playerController = new PlayerController(
            this.interiorCamera,
            this.shipModel.getCollisionBounds(),
            this.sceneManager.renderer.domElement
        );

        this.interaction = new Interaction(
            this.interiorCamera,
            this.shipModel.getInteractables()
        );

        this.cockpit = new Cockpit(
            this.interiorCamera,
            this.shipPhysics,
            this.shipHUD
        );
        this.cockpit.setPlayerController(this.playerController);

        this.projector = new Projector({
            mainRenderer: this.sceneManager.renderer,
            mainScene: this.sceneManager.scene,
            mainCamera: this.sceneManager.camera,
            shipModel: this.shipModel,
        });

        // --- 状态 ---
        this._mouseDX = 0;
        this._mouseDY = 0;
        this._eHoldTimer = 0;
        this._eHeld = false;

        // --- 飞船外观 ---
        this._exteriorGroup = this.shipModel.getExteriorGroup();
        this.sceneManager.scene.add(this._exteriorGroup);

        // --- 相机备份 ---
        this._savedMainCameraPos = new THREE.Vector3();
        this._savedMainCameraTarget = new THREE.Vector3();
        this._pointerBlock = null;
        this._clickHandler = null;

        this._bindGlobalInput();
        this._positionNearEarth();
    }

    // ==================== 初始定位 ====================
    /** 将飞船放置在 Earth 附近（仅定位，不进入） */
    _positionNearEarth() {
        const earth = this.planets.earth;
        if (earth) {
            const earthScenePos = earth.mesh.position.clone();
            const offset = new THREE.Vector3(2, 1.5, 2);
            const shipScenePos = earthScenePos.clone().add(offset);
            const shipSIPos = shipScenePos.clone().multiplyScalar(1 / POS_SCALE);
            this.shipPhysics.setPositionSI(shipSIPos);
            this.shipPhysics.setVelocitySI(earth.velocity.clone());
            this.shipPhysics.setForwardDirection(
                earth.position.clone().normalize().multiplyScalar(-1)
            );
            this._exteriorGroup.position.copy(shipScenePos);
        }

        const spawn = this.shipModel.getSpawnPoint();
        this.playerController.setTransform(spawn.position, spawn.direction);
    }

    // ==================== 公开：进入飞船 ====================
    /** 从宇宙视图进入飞船内部（播放眨眼动画） */
    async enterShip() {
        if (this.state !== 'universe') return;

        // 重新定位到地球附近（如果玩家飞远了）
        this._positionNearEarth();

        // 显示黑屏
        this.shipHUD.blinkOverlay.style.display = 'block';
        this.shipHUD.blinkOverlay.style.opacity = '1';
        this.shipHUD.blinkOverlay.style.transition = 'none';

        await new Promise(r => setTimeout(r, 300));
        await this.shipHUD.playBlinkAnimation();

        this._enterShipInterior();
        console.log('[ShipModule] 玩家进入飞船');
    }

    // ==================== 状态切换 ====================
    _enterShipInterior() {
        this._savedMainCameraPos.copy(this.sceneManager.camera.position);
        this._savedMainCameraTarget.copy(this.sceneManager.controls.target);

        const canvas = this.sceneManager.renderer.domElement;

        // 捕获阶段拦截 → 阻止 OrbitControls
        this._pointerBlock = (e) => { e.stopImmediatePropagation(); };
        canvas.addEventListener('pointerdown', this._pointerBlock, { capture: true });
        canvas.addEventListener('pointermove', this._pointerBlock, { capture: true });
        canvas.addEventListener('pointerup',   this._pointerBlock, { capture: true });

        // 点击请求指针锁定（带防抖）
        this._clickHandler = () => {
            if (!this.playerController.isLocked
                && this.playerController.enabled
                && document.pointerLockElement === null) {
                canvas.requestPointerLock();
            }
        };
        document.addEventListener('click', this._clickHandler);

        // 隐藏宇宙 UI
        this._hideUniverseUI();

        this.state = 'ship_interior';
        this.sceneManager.controls.enabled = false;
        this.playerController.enabled = true;
        this.shipHUD.show();
        this.shipHUD.showPrompt('点击屏幕 · 进入飞船控制');
        setTimeout(() => this.shipHUD.hidePrompt(), 5000);
    }

    _exitToUniverse() {
        // 移除拦截器
        if (this._pointerBlock) {
            const c = this.sceneManager.renderer.domElement;
            c.removeEventListener('pointerdown', this._pointerBlock, { capture: true });
            c.removeEventListener('pointermove', this._pointerBlock, { capture: true });
            c.removeEventListener('pointerup',   this._pointerBlock, { capture: true });
            this._pointerBlock = null;
        }
        if (this._clickHandler) {
            document.removeEventListener('click', this._clickHandler);
            this._clickHandler = null;
        }

        // 显示宇宙 UI
        this._showUniverseUI();

        this.sceneManager.camera.position.copy(this._savedMainCameraPos);
        this.sceneManager.controls.target.copy(this._savedMainCameraTarget);
        this.sceneManager.controls.enabled = true;
        this.sceneManager.controls.update();

        this.playerController.unlock();
        this.playerController.enabled = false;
        this.shipHUD.hide();
        this.state = 'universe';
    }

    _hideUniverseUI() {
        UNIVERSE_UI_IDS.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
    }

    _showUniverseUI() {
        UNIVERSE_UI_IDS.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = '';
        });
    }

    // ==================== 每帧更新 ====================
    update(dt) {
        if (this.state === 'universe') return;
        const dtC = Math.min(dt, 0.1);

        if (this.state === 'ship_cockpit') {
            this.cockpit.update(dtC, this._mouseDX, this._mouseDY);
            this._mouseDX = 0; this._mouseDY = 0;
        }

        if (this.state === 'ship_interior') {
            this.playerController.update(dtC);

            const target = this.interaction.update();
            if (target) this.shipHUD.showPrompt(target.label);
            else this.shipHUD.hidePrompt();
        }

        if (this._eHeld && this.state === 'ship_interior') {
            const target = this.interaction.currentTarget;
            if (target && target.type === 'screen2') {
                this._eHoldTimer += dtC;
                this.projector.handleScreen2Hold(this._eHoldTimer);
            }
        }

        this._syncExterior();
    }

    /** 渲染：主场景渲染一次到 RenderTarget → 同时用作穹顶背景和屏幕 1 纹理 */
    render() {
        if (this.state === 'universe') return;
        const renderer = this.sceneManager.renderer;
        const mainCam = this.sceneManager.camera;
        const interiorScene = this.shipModel.getInteriorScene();
        const rt = this.projector.renderTarget;

        // 1. 保存主相机状态
        const savedPos = mainCam.position.clone();
        const savedQuat = mainCam.quaternion.clone();

        // 2. 主相机放到飞船位置
        const shipScenePos = this.shipPhysics.getScenePosition();
        const shipForward = this.shipPhysics.getForward();
        mainCam.position.copy(shipScenePos);
        mainCam.lookAt(shipScenePos.clone().add(shipForward));

        // 3. 渲染主场景到共享 RenderTarget（隐藏飞船外观）
        this._exteriorGroup.visible = false;
        const oldTarget = renderer.getRenderTarget();
        renderer.setRenderTarget(rt);
        renderer.render(this.sceneManager.scene, mainCam);
        renderer.setRenderTarget(oldTarget);
        this._exteriorGroup.visible = true;

        // 4. 恢复主相机
        mainCam.position.copy(savedPos);
        mainCam.quaternion.copy(savedQuat);

        // 5. 设置内部场景背景为共享纹理（穹顶透过 depthWrite=false 看到）
        interiorScene.background = rt.texture;

        // 6. 更新屏幕 1 材质（已指向 rt.texture，无需额外操作）
        this.projector.screen1Material.map = rt.texture;

        // 7. 渲染飞船内部
        renderer.render(interiorScene, this.interiorCamera);
    }

    _syncExterior() {
        const sp = this.shipPhysics.getScenePosition();
        this._exteriorGroup.position.copy(sp);
        this._exteriorGroup.quaternion.copy(this.shipPhysics.shipQuaternion);
    }

    isActive() { return this.state !== 'universe'; }

    // ==================== 全局输入 ====================
    _bindGlobalInput() {
        document.addEventListener('mousemove', (e) => {
            if (this.state === 'ship_cockpit' && this.cockpit.isSeated) {
                this._mouseDX += e.movementX;
                this._mouseDY += e.movementY;
            }
        });

        document.addEventListener('keydown', (e) => {
            if (this.state === 'universe') return;

            if (e.key.toLowerCase() === 'e') {
                e.preventDefault();
                this._eHeld = true;
                this._eHoldTimer = 0;
                this.projector.resetScreen2();
                this._handleEPress();
            }

            if (e.key.toLowerCase() === 'f') {
                e.preventDefault();
                this._handleFPress();
            }

            if (e.key === 'Escape') {
                e.preventDefault();
                if (this.state === 'ship_cockpit') {
                    this.cockpit.exit(this.playerController);
                    this.state = 'ship_interior';
                }
            }
        });

        document.addEventListener('keyup', (e) => {
            if (e.key.toLowerCase() === 'e') {
                this._eHeld = false;
                this._eHoldTimer = 0;
            }
        });
    }

    _handleEPress() {
        if (this.state !== 'ship_interior') return;

        const target = this.interaction.onPressE();
        if (!target) return;

        switch (target.type) {
            case 'seat': {
                const seat = this.shipModel.getCockpitSeat();
                this.cockpit.sit(this.playerController, seat.position, seat.direction);
                this.state = 'ship_cockpit';
                this.shipHUD.hidePrompt();
                break;
            }
            case 'screen1':
                // 失真过渡 → 进入宇宙视图
                this.shipHUD.hidePrompt();
                this.playerController.enabled = false;
                if (this.playerController.isLocked) {
                    document.exitPointerLock();
                }
                this.shipHUD.playGlitchTransition(() => {
                    this._exitToUniverse();
                });
                break;
            case 'screen2':
                // 按住 E 处理
                break;
        }
    }

    _handleFPress() {
        if (this.state === 'ship_cockpit' && this.cockpit.isSeated) {
            this.cockpit.exit(this.playerController);
            this.state = 'ship_interior';
            this.shipHUD.hidePrompt();
        }
    }
}
