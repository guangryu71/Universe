// ============================================================
// ShipHUD.js — 飞船 HUD 覆盖层：速度、交互提示、准星
// ============================================================

export class ShipHUD {
    constructor() {
        this._createElements();
        this._visible = false;
    }

    _createElements() {
        // 容器
        this.container = document.createElement('div');
        this.container.id = 'ship-hud';
        this.container.innerHTML = `
            <div id="ship-crosshair"></div>
            <div id="ship-speed-display">-- m/s</div>
            <div id="ship-prompt"></div>
            <div id="ship-cockpit-hud" class="hidden">
                <div id="ship-pitch-ladder"></div>
            </div>
        `;
        document.body.appendChild(this.container);

        this.crosshair = document.getElementById('ship-crosshair');
        this.speedEl = document.getElementById('ship-speed-display');
        this.promptEl = document.getElementById('ship-prompt');
        this.cockpitHUD = document.getElementById('ship-cockpit-hud');

        // 眨眼动画覆盖层
        this.blinkOverlay = document.createElement('div');
        this.blinkOverlay.id = 'ship-blink-overlay';
        document.body.appendChild(this.blinkOverlay);

        // 失真过渡覆盖层
        this.glitchOverlay = document.createElement('div');
        this.glitchOverlay.id = 'ship-glitch-overlay';
        document.body.appendChild(this.glitchOverlay);
    }

    show() {
        this._visible = true;
        this.container.style.display = 'block';
        this.crosshair.style.display = 'block';
        this.speedEl.style.display = 'block';
    }

    hide() {
        this._visible = false;
        this.container.style.display = 'none';
        this.crosshair.style.display = 'none';
        this.speedEl.style.display = 'none';
        this.promptEl.style.display = 'none';
        this.cockpitHUD.classList.add('hidden');
    }

    updateSpeed(speedMS) {
        if (!this._visible) return;
        let text;
        if (speedMS >= 1000) {
            text = (speedMS / 1000).toFixed(1) + ' km/s';
        } else {
            text = speedMS.toFixed(0) + ' m/s';
        }
        this.speedEl.textContent = text;
        // 高速时变色
        if (speedMS > 50000) {
            this.speedEl.style.color = '#ff6644';
        } else if (speedMS > 10000) {
            this.speedEl.style.color = '#ffaa33';
        } else {
            this.speedEl.style.color = '#00ccaa';
        }
    }

    showPrompt(text) {
        if (!this._visible) return;
        this.promptEl.textContent = text;
        this.promptEl.style.display = 'block';
        this.promptEl.classList.add('visible');
    }

    hidePrompt() {
        this.promptEl.textContent = '';
        this.promptEl.style.display = 'none';
        this.promptEl.classList.remove('visible');
    }

    showCockpitHUD() {
        this.cockpitHUD.classList.remove('hidden');
        this.speedEl.classList.add('cockpit-speed');
    }

    hideCockpitHUD() {
        this.cockpitHUD.classList.add('hidden');
        this.speedEl.classList.remove('cockpit-speed');
    }

    /** 播放眨眼动画：快速黑屏闪烁 */
    async playBlinkAnimation() {
        const overlay = this.blinkOverlay;
        overlay.style.display = 'block';
        overlay.style.opacity = '1';
        overlay.style.transition = 'none';

        // 3 次眨眼
        for (let i = 0; i < 3; i++) {
            await this._sleep(200);
            overlay.style.opacity = '1';
            overlay.style.transition = 'opacity 0.08s';
            await this._sleep(80);
            overlay.style.opacity = '0.3';
            overlay.style.transition = 'opacity 0.12s';
        }

        // 最终淡出
        await this._sleep(200);
        overlay.style.transition = 'opacity 0.6s ease-out';
        overlay.style.opacity = '0';
        await this._sleep(600);
        overlay.style.display = 'none';
    }

    /** 屏幕失真过渡：失真 → 闭眼 → 完成回调 */
    async playGlitchTransition(onComplete) {
        const overlay = this.glitchOverlay;
        overlay.classList.remove('active');
        overlay.style.display = 'none';
        // 强制回流
        void overlay.offsetWidth;
        overlay.style.display = 'block';
        overlay.classList.add('active');

        // 等待失真动画完成 (1.2s)
        await this._sleep(1200);
        // 调用完成回调（切换到宇宙视图）
        if (onComplete) onComplete();
        // 等待一小段黑屏
        await this._sleep(400);
        // 淡入（睁眼）
        overlay.style.background = 'rgba(0,0,0,1)';
        overlay.style.transition = 'background 0.6s ease-out';
        await this._sleep(50);
        overlay.style.background = 'rgba(0,0,0,0)';
        await this._sleep(600);
        overlay.style.display = 'none';
        overlay.classList.remove('active');
        overlay.style.transition = '';
    }

    _sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }
}
