// ============================================================
// Projector.js — 投影仪系统：屏幕 1 星系视图 + 屏幕 2 星系选择
// ============================================================
import * as THREE from 'three';

export class Projector {
    /**
     * @param {object} opts
     * @param {THREE.WebGLRenderer} opts.mainRenderer
     * @param {THREE.Scene} opts.mainScene
     * @param {THREE.Camera} opts.mainCamera
     * @param {object} opts.shipModel — ShipModel 实例（提供 screen1/2 mesh 和 material）
     */
    constructor({ mainRenderer, mainScene, mainCamera, shipModel }) {
        this.mainRenderer = mainRenderer;
        this.mainScene = mainScene;
        this.mainCamera = mainCamera;

        this.screen1Mesh = shipModel.screen1Mesh;
        this.screen1Material = shipModel.screen1Material;
        this.screen2Mesh = shipModel.screen2Mesh;
        this.screen2Material = shipModel.screen2Material;

        // 渲染目标（屏幕 1 — 当前星系）
        this.renderTarget = new THREE.WebGLRenderTarget(1024, 614);
        this.screen1Material.map = this.renderTarget.texture;
        this.screen1Material.color.set(0xffffff);
        this.screen1Material.needsUpdate = true;

        // 屏幕 2 状态
        this._screen2Outputted = false;
    }

    /** 每帧更新：将主场景渲染到屏幕 1 的 RenderTarget */
    update() {
        const oldTarget = this.mainRenderer.getRenderTarget();
        this.mainRenderer.setRenderTarget(this.renderTarget);
        this.mainRenderer.render(this.mainScene, this.mainCamera);
        this.mainRenderer.setRenderTarget(oldTarget);
        this.screen1Material.map = this.renderTarget.texture;
    }

    /**
     * 处理屏幕 2 交互（按住 E）
     * @param {number} holdTime — 按住时长（秒）
     */
    handleScreen2Hold(holdTime) {
        if (!this._screen2Outputted && holdTime > 1.5) {
            this._screen2Outputted = true;
            console.log('%c🪐 查看星系选择 %c— 功能待优化',
                'color:#ffaa00;font-size:16px;', 'color:#aaa;');
            console.log('%c当前星系列表：%c太阳系 (Sol System)',
                'color:#0cf;', 'color:#fff;');
            console.log('%c  水星 · 金星 · 地球 · 火星 · 木星 · 土星 · 天王星 · 海王星',
                'color:#888;');
            return true;
        }
        return false;
    }

    resetScreen2() {
        this._screen2Outputted = false;
    }
}
