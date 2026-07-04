// ============================================================
// TimeParticles.js — 时间流速粒子特效（全屏）
// ============================================================

export class TimeParticles {
    constructor() {
        this.canvas = null;
        this.ctx = null;
        this.particles = [];
        this._speed = 0;
        this._active = false;
        this._fading = false;

        this.CONFIG = {
            maxSpeed: 120,
            particlePool: 200,
            trailOpacity: 0.15,
            fadeDecay: 0.92,
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
            x: 0,
            y: Math.random() * window.innerHeight,
            vx: 1,
            length: 0,
            opacity: 0,
            width: 0.5,
            dir: 1, // 1=右, -1=左
        };
    }

    resetParticle(p, dir) {
        const w = window.innerWidth;
        p.dir = dir;
        if (dir > 0) {
            p.x = -Math.random() * 60;
            p.vx = Math.random() * 2 + 1;
        } else {
            p.x = w + Math.random() * 60;
            p.vx = -(Math.random() * 2 + 1);
        }
        p.y = Math.random() * window.innerHeight;
        p.length = Math.random() * 30 + 15;
        p.opacity = Math.random() * 0.4 + 0.1;
        p.width = Math.random() * 1.5 + 0.5;
    }

    setDragging(dragging, sliderVal, prevVal) {
        if (dragging && sliderVal > prevVal) {
            // 向右滑 → 加速 → 粒子从左向右
            this._active = true;
            this._fading = false;
            this._dir = 1;
            const factor = (sliderVal - 1) / 99;
            this._speed = factor * this.CONFIG.maxSpeed;
        } else if (dragging && sliderVal < prevVal) {
            // 向左滑 → 减速 → 粒子从右向左
            this._active = true;
            this._fading = false;
            this._dir = -1;
            const factor = 1 - (sliderVal - 1) / 99;
            this._speed = factor * this.CONFIG.maxSpeed;
        } else if (this._active) {
            this._fading = true;
        }
    }

    _loop() {
        const w = this.canvas.width;
        const h = this.canvas.height;
        const ctx = this.ctx;

        if (this._fading) {
            this._speed *= this.CONFIG.fadeDecay;
            if (this._speed < 0.5) {
                this._speed = 0;
                this._fading = false;
                this._active = false;
                ctx.clearRect(0, 0, w, h);
                requestAnimationFrame(() => this._loop());
                return;
            }
        }

        if (this._active && this._speed > 0) {
            ctx.fillStyle = `rgba(5, 10, 16, ${this.CONFIG.trailOpacity})`;
            ctx.fillRect(0, 0, w, h);

            const activeCount = Math.floor(
                this.particles.length * Math.min(this._speed / 40, 1)
            );

            for (let i = 0; i < activeCount; i++) {
                const p = this.particles[i];
                if (!this._fading && p.length === 0) {
                    p.length = Math.random() * 30 + 15;
                    p.opacity = Math.random() * 0.4 + 0.1;
                    p.width = Math.random() * 1.5 + 0.5;
                }
                p.x += p.vx * this._speed * 0.08;
                if (p.dir > 0 && p.x > w) this.resetParticle(p, this._dir || 1);
                else if (p.dir < 0 && p.x < -60) this.resetParticle(p, this._dir || -1);

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
