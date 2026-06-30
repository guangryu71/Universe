// ============================================================
// RoboticVoice.js — 机械电子音合成器 (JS引擎)
// 脉冲震荡 + 共振峰滤波 → 合成语音 → DSP 效果链
// ============================================================

// 预设配置（参数会实际改变声音）
const PRESETS = {
    ai_assistant:  { rate: 0.9, pitch: 0.8, rmod: 70, rmix: 0.3, bits: 10, srReduce: 16000, bpLow: 200, bpHigh: 4000, dist: 1.5, vibRate: 4, vibDepth: 0.002, echoDelay: 0.02, echoDecay: 0.25, pitchSt: 0, f0: 180, formant: [700, 1200, 2600] },
    classic_robot: { rate: 0.7, pitch: 0.3, rmod: 50, rmix: 0.5, bits: 8, srReduce: 11025, bpLow: 300, bpHigh: 3000, dist: 2.5, vibRate: 5, vibDepth: 0.004, echoDelay: 0.04, echoDecay: 0.4, pitchSt: -3, f0: 130, formant: [500, 1100, 2400] },
    dalek:         { rate: 0.6, pitch: 0.1, rmod: 120, rmix: 0.7, bits: 4, srReduce: 8000, bpLow: 500, bpHigh: 2500, dist: 4.0, vibRate: 8, vibDepth: 0.006, echoDelay: 0.05, echoDecay: 0.5, pitchSt: 2, f0: 220, formant: [900, 1600, 2800] },
    glitch_ai:     { rate: 0.8, pitch: 0.5, rmod: 90, rmix: 0.6, bits: 6, srReduce: 8000, bpLow: 400, bpHigh: 3500, dist: 3.0, vibRate: 6, vibDepth: 0.005, echoDelay: 0.03, echoDecay: 0.3, pitchSt: -1, f0: 160, formant: [600, 1300, 3000] },
    subtle_cyborg: { rate: 1.0, pitch: 1.0, rmod: 35, rmix: 0.2, bits: 12, srReduce: 22050, bpLow: 150, bpHigh: 6000, dist: 1.3, vibRate: 3, vibDepth: 0.001, echoDelay: 0.015, echoDecay: 0.15, pitchSt: 0, f0: 200, formant: [800, 1400, 2800] },
    old_radio:     { rate: 0.7, pitch: 0.4, rmod: 0, rmix: 0, bits: 8, srReduce: 11025, bpLow: 500, bpHigh: 2500, dist: 2.0, vibRate: 2, vibDepth: 0.002, echoDelay: 0.06, echoDecay: 0.5, pitchSt: 0, f0: 150, formant: [550, 1150, 2400] },
    deep_mech:     { rate: 0.5, pitch: 0.2, rmod: 40, rmix: 0.55, bits: 7, srReduce: 10000, bpLow: 200, bpHigh: 2500, dist: 3.5, vibRate: 3.5, vibDepth: 0.005, echoDelay: 0.05, echoDecay: 0.45, pitchSt: -5, f0: 110, formant: [450, 950, 2200] },
};

// 默认自定义参数初始值
const DEFAULT_PARAMS = {
    ring_mod_freq: 70, ring_mod_mix: 0.3, bit_depth: 10, sample_rate_reduction: 16000,
    bandpass_low: 200, bandpass_high: 4000, distortion_gain: 1.5, pitch_semitones: 0,
    vibrato_rate: 4, vibrato_depth: 0.002, echo_delay: 0.02, echo_decay: 0.25,
};

export { PRESETS, DEFAULT_PARAMS };

export class RoboticVoice {
    constructor() {
        this._ctx = null;
        this._sources = [];
    }

    _ensureCtx() {
        if (!this._ctx) this._ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (this._ctx.state === 'suspended') this._ctx.resume();
        return this._ctx;
    }

    /**
     * 合成并播放机械电子音
     */
    async speak(text, opts = {}) {
        const presetName = opts.preset || 'ai_assistant';
        const p = opts.params || {};

        // 合并预设 + 自定义参数
        const preset = PRESETS[presetName] || PRESETS.ai_assistant;
        const cfg = {};
        for (const k of Object.keys(preset)) cfg[k] = preset[k];
        // 自定义参数覆盖（仅custom模式下允许覆盖所有，其他模式只覆盖rate/pitch）
        if (presetName === 'custom') {
            for (const k of Object.keys(p)) if (p[k] !== undefined) cfg[k] = p[k];
        } else {
            for (const k of ['rate','pitch']) if (p[k] !== undefined) cfg[k] = p[k];
        }

        const ctx = this._ensureCtx();
        const sr = 22050;
        const durPerChar = 0.08;
        const totalDur = Math.max(1.5, text.length * durPerChar + 0.3);
        const totalSamples = Math.floor(totalDur * sr);

        // === 1. 生成脉冲序列（模拟声带振动） ===
        let audio = this._genPulseTrain(totalSamples, sr, cfg.f0, text);

        // === 2. 共振峰滤波（形成元音质感） ===
        audio = this._formantFilter(audio, sr, cfg.formant);

        // === 3. 整体包络（模拟音节） ===
        for (let i = 0; i < audio.length; i++) {
            const t = i / sr / totalDur;
            const env = Math.sin(Math.PI * t) * 0.8 + 0.2;
            audio[i] *= env;
        }

        // === 4. DSP 效果链 ===
        if (Math.abs(cfg.pitchSt) > 0.01) audio = this._pitchShift(audio, sr, cfg.pitchSt);
        if (cfg.rmod > 0 && cfg.rmix > 0) audio = this._ringMod(audio, sr, cfg.rmod, cfg.rmix);
        if (cfg.bits < 16) audio = this._bitCrush(audio, cfg.bits);
        if (cfg.srReduce < sr) audio = this._sampleRateReduce(audio, sr, cfg.srReduce);
        if (cfg.bpLow > 0 || cfg.bpHigh < sr / 2) audio = this._bandpass(audio, sr, cfg.bpLow, cfg.bpHigh);
        if (cfg.dist > 1.01) audio = this._distort(audio, cfg.dist);
        if (cfg.vibDepth > 0.0001) audio = this._vibrato(audio, sr, cfg.vibRate, cfg.vibDepth);
        if (cfg.echoDecay > 0.001) audio = this._combFilter(audio, sr, cfg.echoDelay, cfg.echoDecay);

        // === 5. 播放 ===
        this._playBuffer(audio, sr);
    }

    // --- 语音合成核心 ---

    _genPulseTrain(len, sr, f0, text) {
        const audio = new Float32Array(len);
        const step = Math.max(1, Math.floor(sr / f0));
        // 脉冲序列
        for (let i = 0; i < len; i += step) {
            audio[i] = 0.8;
        }
        // 根据文字长度添加节奏调制
        const charDur = sr * 0.12;
        for (let i = 0; i < len; i++) {
            const charIdx = Math.floor(i / charDur);
            const inChar = (i % charDur) / charDur;
            const amp = 0.5 + 0.5 * Math.sin(Math.PI * inChar);
            audio[i] *= amp * 0.6;
        }
        return audio;
    }

    _formantFilter(audio, sr, formants) {
        // 多共振峰带通（并联）
        const result = new Float32Array(audio.length);
        for (const f of formants) {
            const filtered = this._bandpassSingle(audio, sr, f - 100, f + 100);
            for (let i = 0; i < audio.length; i++) result[i] += filtered[i] * (0.5 / formants.length);
        }
        return result;
    }

    _bandpassSingle(audio, sr, low, high) {
        const r = new Float32Array(audio.length);
        const nyq = sr / 2;
        const l = Math.max(10, Math.min(low, nyq - 1)) / nyq;
        const h = Math.max(l + 0.01, Math.min(high, nyq - 1)) / nyq;
        const w0 = Math.PI * (l + h);
        const alpha = Math.sin(w0) * 0.5;
        const b0 = alpha, b1 = 0, b2 = -alpha;
        const a0 = 1 + alpha, a1 = -2 * Math.cos(w0), a2 = 1 - alpha;
        let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
        for (let i = 0; i < audio.length; i++) {
            const x = audio[i];
            const y = (b0/a0)*x + (b1/a0)*x1 + (b2/a0)*x2 - (a1/a0)*y1 - (a2/a0)*y2;
            x2 = x1; x1 = x; y2 = y1; y1 = y;
            r[i] = y;
        }
        return r;
    }

    // --- DSP 效果 ---

    _pitchShift(audio, sr, semitones) {
        const factor = Math.pow(2, semitones / 12);
        const newLen = Math.floor(audio.length / factor);
        const r = new Float32Array(newLen);
        for (let i = 0; i < newLen; i++) {
            const src = i * factor;
            const idx = Math.floor(src);
            const frac = src - idx;
            const a = audio[Math.min(idx, audio.length - 1)];
            const b = audio[Math.min(idx + 1, audio.length - 1)];
            r[i] = a + (b - a) * frac;
        }
        return r;
    }

    _ringMod(audio, sr, freq, mix) {
        const r = new Float32Array(audio.length);
        let peak = 0;
        for (let i = 0; i < audio.length; i++) {
            const carrier = Math.sin(2 * Math.PI * freq * i / sr);
            const mod = audio[i] * carrier;
            if (Math.abs(mod) > peak) peak = Math.abs(mod);
            r[i] = mod;
        }
        const op = this._peak(audio);
        if (peak > 0.001 && op > 0.001) { const s = op / peak; for (let i = 0; i < r.length; i++) r[i] *= s; }
        for (let i = 0; i < r.length; i++) r[i] = (1 - mix) * audio[i] + mix * r[i];
        return r;
    }

    _bitCrush(audio, bits) {
        const mv = Math.pow(2, bits - 1) - 1;
        const r = new Float32Array(audio.length);
        for (let i = 0; i < audio.length; i++) r[i] = Math.round(audio[i] * mv) / mv;
        return r;
    }

    _sampleRateReduce(audio, origSr, targetSr) {
        if (targetSr >= origSr) return audio;
        const ratio = Math.floor(origSr / targetSr);
        if (ratio < 2) return audio;
        const r = new Float32Array(audio.length);
        for (let i = 0; i < audio.length; i++) r[i] = audio[Math.floor(i / ratio) * ratio];
        return r;
    }

    _bandpass(audio, sr, low, high) {
        return this._bandpassSingle(audio, sr, low, high);
    }

    _distort(audio, gain) {
        const r = new Float32Array(audio.length);
        for (let i = 0; i < audio.length; i++) r[i] = Math.tanh(audio[i] * gain);
        return r;
    }

    _vibrato(audio, sr, rate, depth) {
        const r = new Float32Array(audio.length);
        for (let i = 0; i < audio.length; i++) {
            const delay = depth * sr * Math.sin(2 * Math.PI * rate * i / sr);
            const src = i - delay;
            const idx = Math.floor(src);
            const frac = src - idx;
            r[i] = (idx > 0 && idx < audio.length - 1) ? audio[idx]*(1-frac) + audio[idx+1]*frac : audio[i];
        }
        return r;
    }

    _combFilter(audio, sr, delay, decay) {
        const ds = Math.max(1, Math.floor(delay * sr));
        const r = new Float32Array(audio.length);
        r.set(audio);
        for (let i = ds; i < audio.length; i++) r[i] += decay * r[i - ds];
        const p = this._peak(r);
        const op = this._peak(audio);
        if (p > 0.001 && op > 0.001) { const s = op / p; for (let i = 0; i < r.length; i++) r[i] *= s; }
        return r;
    }

    _playBuffer(audio, sr) {
        const ctx = this._ensureCtx();
        const buf = ctx.createBuffer(1, audio.length, sr);
        buf.getChannelData(0).set(audio);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        src.start();
        this._sources.push(src);
        src.onended = () => {
            const i = this._sources.indexOf(src);
            if (i >= 0) this._sources.splice(i, 1);
        };
    }

    _peak(arr) { let p = 0; for (let i = 0; i < arr.length; i++) if (Math.abs(arr[i]) > p) p = Math.abs(arr[i]); return p; }
}
