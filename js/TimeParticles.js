// ============================================================
// TimeParticles.js — 时间流速粒子特效（全屏）
// 提速：光线自右向左；降速：光线自左向右
// ============================================================

export class TimeParticles {
    constructor() {
        this.canvas = null;
        this.ctx = null;
        this.particles = [];
        this._speed = 0;
        this._active = false;
        this._fading = false;
        this._dragging = false;
        this._lastDrag = 0;
        this._dir = 1;              // 运动方向：1 = 左→右，-1 = 右→左

        this.CONFIG = {
            maxSpeed: 120,
            particlePool: 260,
            trailOpacity: 0.16,
            fadeDecay: 0.92,
            dragTimeout: 1000,      // 拖拽无输入时的兜底淡出时间（ms）
        };

        this._initCanvas();
        this._initParticles();
        this._loop();
    }

    _initCanvas() {
        this.canvas = document.createElement('canvas');
        this.canvas.id = 'time-particles-canvas';
        this.canvas.style.cssText = `
            position: fixed; top: 0; left: 0;
            width: 100vw; height: 100vh;
            pointer-events: none; z-index: 2;
            display: block;
        `;
        document.body.prepend(this.canvas);
        this.ctx = this.canvas.getContext('2d');
        this._resize();
        window.addEventListener('resize', () => this._resize());
    }

    _resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.canvas.style.width = window.innerWidth + 'px';
        this.canvas.style.height = window.innerHeight + 'px';
    }

    _initParticles() {
        this.particles = [];
        for (let i = 0; i < this.CONFIG.particlePool; i++) {
            this.particles.push(this._createParticle());
        }
    }

    _createParticle() {
        return {
            x: Math.random() * window.innerWidth,
            y: Math.random() * window.innerHeight,
            vx: 1,
            length: 0,
            opacity: 0,
            width: 0.5,
            dir: 1,
        };
    }

    /**
     * 重置单个粒子
     * @param {number} dir 1 = 向左→右，-1 = 右→左
     * @param {boolean} spread true = 直接铺满全屏（启动时），false = 从屏幕外进场
     */
    resetParticle(p, dir, spread = false) {
        const w = window.innerWidth;
        p.dir = dir;
        p.vx = (Math.random() * 2.2 + 1) * dir;
        p.x = spread
            ? Math.random() * w
            : (dir > 0 ? -Math.random() * 120 : w + Math.random() * 120);
        p.y = Math.random() * window.innerHeight;
        p.length = Math.random() * 40 + 20;
        p.opacity = Math.random() * 0.45 + 0.15;
        p.width = Math.random() * 1.6 + 0.6;
    }

    /** 外部控制：启动粒子（dir > 0 提速 → 光线右→左；dir < 0 降速 → 光线左→右） */
    start(dir) {
        const moveDir = dir > 0 ? -1 : 1;
        this._active = true;
        this._fading = false;
        this._dragging = false;
        this._dir = moveDir;
        this._speed = this.CONFIG.maxSpeed * 0.75;
        // 重新铺满全屏，避免所有光线挤成一绺从左往右跑
        this.particles.forEach(p => this.resetParticle(p, moveDir, true));
    }

    /** 外部控制：停止粒子 */
    stop() {
        if (this._active) this._fading = true;
    }

    setDragging(dragging, sliderVal, prevVal) {
        if (dragging) {
            this._dragging = true;
            this._lastDrag = performance.now();
            if (sliderVal === prevVal) return;   // 数值未变时保持当前方向

            const accel = sliderVal > prevVal;   // 向右滑 = 提速 → 光线右→左
            const moveDir = accel ? -1 : 1;
            const factor = accel
                ? (sliderVal - 1) / 99
                : 1 - (sliderVal - 1) / 99;

            this._active = true;
            this._fading = false;
            this._speed = Math.max(factor * this.CONFIG.maxSpeed, 20);

            const changed = this._dir !== moveDir ||
                this.particles.some(p => p.length === 0);
            this._dir = moveDir;
            if (changed) {
                // 方向切换或首次启动：按新方向铺满全屏
                this.particles.forEach(p => this.resetParticle(p, moveDir, true));
            }
        } else if (this._active) {
            this._dragging = false;
            this._fading = true;
        }
    }

    _loop() {
        const w = this.canvas.width;
        const h = this.canvas.height;
        const ctx = this.ctx;

        // 兜底：拖拽后若迟迟没有新的 input（松手事件丢失等），自动淡出，避免特效常驻
        if (this._dragging && performance.now() - this._lastDrag > this.CONFIG.dragTimeout) {
            this._dragging = false;
            this._fading = true;
        }

        if (this._fading) {
            this._speed *= this.CONFIG.fadeDecay;
            if (this._speed < 0.5) {
                this._speed = 0;
                this._fading = false;
                this._active = false;
                this.particles.forEach(p => { p.length = 0; });
                ctx.clearRect(0, 0, w, h);
                requestAnimationFrame(() => this._loop());
                return;
            }
        }

        if (this._active && this._speed > 0) {
            // 用 destination-out 淡出上一帧拖尾：画布本身保持透明，不会把场景遮黑
            ctx.globalCompositeOperation = 'destination-out';
            ctx.fillStyle = `rgba(0, 0, 0, ${this.CONFIG.trailOpacity})`;
            ctx.fillRect(0, 0, w, h);
            ctx.globalCompositeOperation = 'source-over';

            const activeCount = Math.floor(
                this.particles.length * Math.min(this._speed / 40, 1)
            );

            for (let i = 0; i < activeCount; i++) {
                const p = this.particles[i];
                if (p.length === 0) this.resetParticle(p, this._dir, true);

                p.x += p.vx * this._speed * 0.08;
                // 整条光线完全离开屏幕后再从对侧重新进场
                if (p.dir > 0 && p.x - p.length > w) this.resetParticle(p, this._dir);
                else if (p.dir < 0 && p.x + p.length < 0) this.resetParticle(p, this._dir);

                ctx.beginPath();
                ctx.strokeStyle = `rgba(100, 180, 255, ${p.opacity})`;
                ctx.lineWidth = p.width;
                ctx.lineCap = 'round';
                ctx.moveTo(p.x, p.y);
                // 拖尾方向：粒子运动反方向
                ctx.lineTo(p.x - p.vx * p.length / (Math.abs(p.vx) || 1), p.y);
                ctx.stroke();
            }
        }

        requestAnimationFrame(() => this._loop());
    }
}
