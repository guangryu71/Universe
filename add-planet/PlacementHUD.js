// ============================================================
// PlacementHUD.js — 可视化放置星球的实时坐标/方向显示组件
// 供 BodyEditor（主界面）和 PlanetLab（实验室）共用
// ============================================================

export class PlacementHUD {
    /**
     * @param {object} opts
     * @param {HTMLElement} opts.parent — 挂载到的父容器
     * @param {string} opts.position — CSS定位: 'bottom-center' | 'top-right' | 'panel-bottom'
     */
    constructor({ parent, position = 'bottom-center' } = {}) {
        this._parent = parent || document.body;
        this._build(position);
    }

    _build(position) {
        this.el = document.createElement('div');
        this.el.className = 'ph-hud';
        this.el.innerHTML = `
            <div class="ph-hud-row"><span>📍 位置</span><span class="ph-pos">--</span></div>
            <div class="ph-hud-row"><span>🧭 偏X轴角</span><span class="ph-azim">--</span></div>
            <div class="ph-hud-row"><span>📐 仰角(偏XZ面)</span><span class="ph-elev">--</span></div>
            <div class="ph-hud-row ph-speed-row" style="display:none;"><span>⚡ 速度</span><span class="ph-speed">0 m/s</span></div>
            <div class="ph-hud-hint">点击视图放置 XZ 位置</div>
        `;

        // 定位样式
        if (position === 'bottom-center') {
            this.el.style.cssText = 'position:absolute;bottom:16px;left:50%;transform:translateX(-50%);z-index:20;';
        } else if (position === 'top-right') {
            this.el.style.cssText = 'position:fixed;top:80px;right:20px;z-index:400;';
        } else if (position === 'panel-bottom') {
            this.el.style.cssText = 'margin-top:8px;z-index:400;';
        }

        this._parent.appendChild(this.el);

        // 缓存子元素
        this._posEl   = this.el.querySelector('.ph-pos');
        this._azimEl  = this.el.querySelector('.ph-azim');
        this._elevEl  = this.el.querySelector('.ph-elev');
        this._speedEl = this.el.querySelector('.ph-speed');
        this._speedRow = this.el.querySelector('.ph-speed-row');
        this._hintEl  = this.el.querySelector('.ph-hud-hint');
    }

    /** 显示 HUD */
    show() { this.el.style.display = 'block'; }

    /** 隐藏 HUD */
    hide() { this.el.style.display = 'none'; }

    /** 更新位置坐标 */
    updatePosition(x, y, z) {
        this._posEl.textContent = `X:${x.toFixed(1)} Y:${y.toFixed(1)} Z:${z.toFixed(1)}`;
        if (!this._azimShown) {
            this._azimEl.textContent = '--';
            this._elevEl.textContent = '--';
        }
    }

    /** 更新方向角度 */
    updateAngles(azimDeg, elevDeg) {
        this._azimShown = true;
        this._azimEl.textContent = azimDeg != null ? `${azimDeg}°` : '--';
        this._elevEl.textContent = elevDeg != null ? `${elevDeg}°` : '--';
    }

    /** 清除角度显示 */
    clearAngles() {
        this._azimShown = false;
        this._azimEl.textContent = '--';
        this._elevEl.textContent = '--';
    }

    /** 更新速度大小 */
    updateSpeed(magMS) {
        this._speedRow.style.display = magMS > 0 ? 'flex' : 'none';
        this._speedEl.textContent = `${magMS.toFixed(0)} m/s`;
    }

    /** 更新提示文字 */
    updateHint(text) {
        this._hintEl.textContent = text;
    }

    /** 移除 DOM 元素 */
    destroy() {
        this.el.remove();
    }
}
