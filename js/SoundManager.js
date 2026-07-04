// ============================================================
// SoundManager.js — 全局前端音效管理器
// Web Audio API + AudioBuffer 预加载
// ============================================================

const SOUND_FILES = {
    // 加载页
    enterWhoosh:   'soundEffects/travel-through/mixkit-space-shot-whoosh-3001.wav',
    // 按钮交互
    btnHover:      'soundEffects/click/mixkit-sci-fi-confirmation-914.wav',
    btnClick:      'soundEffects/click/mixkit-water-sci-fi-bleep-902.wav',
    btnInside:     'soundEffects/click/mixkit-sci-fi-interface-robot-click-901.wav',
    // 星球卡片
    planetSelect:  'soundEffects/click/mixkit-cybernetic-technology-affirmation-3116.wav',
    cardAction:    'soundEffects/click/mixkit-sci-fi-confirmation-914.wav',
    // 探测器发射
    probeFire:     'soundEffects/fire/mixkit-sci-fi-plasma-gun-power-1680.wav',
    // 滑块划动
    sliderSwoosh:  'soundEffects/mixkit-long-sweeping-air-swoosh-167.wav',
    // 时间减速吸音
    inhale:        'soundEffects/inhale/mixkit-sci-fi-power-3184.wav',
};

export class SoundManager {
    constructor() {
        this._ctx = null;
        this._buffers = {};
        this._loaded = false;
        this._loading = false;
        this._loadQueue = [];
    }

    /** 初始化并预加载所有音效 */
    async init() {
        if (this._loaded || this._loading) return this._loadPromise;
        this._loading = true;

        this._loadPromise = new Promise(async (resolve) => {
            try {
                this._ctx = new (window.AudioContext || window.webkitAudioContext)();
                const entries = Object.entries(SOUND_FILES);
                let loaded = 0;
                const total = entries.length + 1; // +1 for typewriter

                for (const [name, path] of entries) {
                    try {
                        const resp = await fetch(path);
                        const arrayBuffer = await resp.arrayBuffer();
                        this._buffers[name] = await this._ctx.decodeAudioData(arrayBuffer);
                    } catch (e) {
                        console.warn(`[Sound] 加载失败: ${name}`, e.message);
                    }
                    loaded++;
                    this._dispatchProgress(loaded, total);
                }

                // 为滑块音效创建反向版本
                if (this._buffers['sliderSwoosh']) {
                    const fwd = this._buffers['sliderSwoosh'];
                    const rev = this._ctx.createBuffer(1, fwd.length, fwd.sampleRate);
                    const fwdData = fwd.getChannelData(0);
                    const revData = rev.getChannelData(0);
                    for (let i = 0; i < fwd.length; i++) revData[i] = fwdData[fwd.length - 1 - i];
                    this._buffers['sliderSwooshRev'] = rev;
                }
                // 生成打字机音效（预制缓存）
                this._buffers['typewriter'] = this._genTypewriterBuffer();
                loaded++;
                this._dispatchProgress(loaded, total);

                this._loaded = true;
                console.log(`[SoundManager] ${loaded}/${total} 音效已就绪`);
            } catch (e) {
                console.warn('[SoundManager] 初始化失败:', e.message);
            }
            resolve();
        });

        return this._loadPromise;
    }

    _dispatchProgress(loaded, total) {
        if (this._onProgress) this._onProgress(loaded, total);
    }

    onProgress(cb) { this._onProgress = cb; }

    /** 播放已加载的音效 */
    play(name, opts = {}) {
        const buf = this._buffers[name];
        if (!buf || !this._ctx) return;
        if (this._ctx.state === 'suspended') this._ctx.resume();

        try {
            const src = this._ctx.createBufferSource();
            src.buffer = buf;

            const gainNode = this._ctx.createGain();
            gainNode.gain.value = opts.volume ?? 0.5;

            // 支持音高微调（变调不变速）
            if (opts.detune) {
                src.detune.value = opts.detune;
            }

            src.connect(gainNode);
            gainNode.connect(this._ctx.destination);
            src.start(0);
        } catch (e) {
            // 静默失败
        }
    }

    /** 生成科幻打字机/电子滴滴声（JS实时合成，不保存文件） */
    _genTypewriterBuffer() {
        if (!this._ctx) return null;
        const sr = this._ctx.sampleRate;
        const duration = 0.032; // 32ms 短促清脆
        const len = Math.floor(sr * duration);
        const buf = this._ctx.createBuffer(1, len, sr);
        const data = buf.getChannelData(0);

        // 白噪声（模拟机械撞击质感）
        for (let i = 0; i < len; i++) {
            const t = i / sr;
            // 三段式音色混合：
            // ① 2500Hz 主音（明亮）
            // ② 4800Hz 泛音（清脆）
            // ③ 白噪声短促爆裂（机械打点感）
            const env = Math.exp(-t * 120);       // 极快指数衰减
            const noise = (Math.random() * 2 - 1) * 0.15;
            const tone1 = Math.sin(2 * Math.PI * 2500 * t) * 0.45;
            const tone2 = Math.sin(2 * Math.PI * 4800 * t) * 0.20;
            data[i] = (tone1 + tone2 + noise) * env * 0.4;
        }
        return buf;
    }

    /** 播放滑块方向音效（每次方向变化时调用一次） */
    playSliderSwoosh(direction) {
        const key = direction > 0 ? 'sliderSwoosh' : 'sliderSwooshRev';
        const buf = this._buffers[key];
        if (!buf || !this._ctx) return;
        if (this._ctx.state === 'suspended') this._ctx.resume();
        try {
            const src = this._ctx.createBufferSource();
            src.buffer = buf;
            const gain = this._ctx.createGain();
            gain.gain.value = 0.4;
            src.connect(gain);
            gain.connect(this._ctx.destination);
            src.start(0);
        } catch(e) {}
    }

    /** 播放打字机音效（多次快速触发） */
    playTypewriter(count = 1) {
        if (!this._buffers['typewriter'] || !this._ctx) return;
        if (this._ctx.state === 'suspended') this._ctx.resume();

        for (let i = 0; i < Math.min(count, 3); i++) {
            setTimeout(() => {
                try {
                    const src = this._ctx.createBufferSource();
                    src.buffer = this._buffers['typewriter'];
                    // 每次随机微调音高，产生变化
                    src.detune.value = (Math.random() - 0.5) * 200;
                    const gainNode = this._ctx.createGain();
                    gainNode.gain.value = 0.2;
                    src.connect(gainNode);
                    gainNode.connect(this._ctx.destination);
                    src.start(0);
                } catch(e) {}
            }, i * 30);
        }
    }

    /** 播放打字机连续流（配合文字流式输出，播放时反复触发） */
    startTypewriterStream(outputElement) {
        if (this._twInterval) clearInterval(this._twInterval);

        let lastLen = outputElement ? outputElement.textContent.length : 0;
        this._twInterval = setInterval(() => {
            if (!outputElement) { this.stopTypewriterStream(); return; }
            const currentLen = outputElement.textContent.length;
            const newChars = currentLen - lastLen;
            lastLen = currentLen;
            if (newChars > 0) {
                this.playTypewriter(Math.min(newChars, 2));
            }
        }, 50);

        // 监听 DOM 变化作为后备
        if (outputElement) {
            const observer = new MutationObserver(() => {
                const cl = outputElement.textContent.length;
                const nc = cl - lastLen;
                lastLen = cl;
                if (nc > 0) this.playTypewriter(Math.min(nc, 2));
            });
            observer.observe(outputElement, { characterData: true, childList: true, subtree: true });
            this._twObserver = observer;
        }
    }

    stopTypewriterStream() {
        if (this._twInterval) { clearInterval(this._twInterval); this._twInterval = null; }
        if (this._twObserver) { this._twObserver.disconnect(); this._twObserver = null; }
    }

    /** 检查是否加载完成 */
    isReady() { return this._loaded; }
}

// 全局单例
const soundManager = new SoundManager();
export { soundManager };
// 同时也暴露到 window 供非模块脚本使用
if (typeof window !== 'undefined') window.__soundManager = soundManager;
