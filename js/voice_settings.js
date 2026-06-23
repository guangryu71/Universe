// ============================================================
// voice_settings.js — 星语设置（浏览器语音 + 机械电子音合成）
// 通过 voice_handle/tts_server.py 提供 Python TTS 服务
// ============================================================
import { storageLoad, storageSave } from './utils.js';

const STORAGE_KEY = 'starvoice_settings';
const TTS_SERVER = 'http://127.0.0.1:8765';

const DEFAULTS = {
    prompt: '你是一个宇宙飞船上的AI助手，用专业且略带科幻感的语气回答用户问题。回答简洁，每条回复不超过150字。',
    voiceURI: '',
    rate: 1.0,
    pitch: 1.0,
    // 机械音设置
    ttsEngine: 'browser',          // 'browser' | 'robotic'
    roboticPreset: 'ai_assistant',
    roboticParams: {
        ring_mod_freq: 70, ring_mod_mix: 0.3,
        bit_depth: 10, sample_rate_reduction: 16000,
        bandpass_low: 200, bandpass_high: 4000,
        distortion_gain: 1.5, pitch_semitones: 0,
        vibrato_rate: 4, vibrato_depth: 0.002,
        echo_delay: 0.02, echo_decay: 0.25,
    },
};

let _settings = { ...DEFAULTS, ...storageLoad(STORAGE_KEY, {}) };
let _browserVoices = [];
let _initDone = false;
let _subtitleTimer = null;
let _currentAudio = null;

// ========== 字幕 ==========
function _getSubtitleEl() {
    let el = document.getElementById('tts-subtitle');
    if (!el) {
        el = document.createElement('div'); el.id = 'tts-subtitle';
        el.className = 'tts-subtitle'; document.body.appendChild(el);
    }
    return el;
}
function _showSubtitle(text) {
    const el = _getSubtitleEl();
    el.textContent = text; el.classList.add('visible');
    if (_subtitleTimer) clearTimeout(_subtitleTimer);
    _subtitleTimer = setTimeout(() => el.classList.remove('visible'), 15000);
}

function saveSettings() { storageSave(STORAGE_KEY, _settings); }

export function getPrompt() { return _settings.prompt; }

// ========== 浏览器语音 ==========
function _populateBrowserVoices() {
    const synth = window.speechSynthesis;
    if (!synth) { _browserVoices = []; return; }
    _browserVoices = synth.getVoices().filter(v => v.lang.startsWith('zh') || v.lang.startsWith('en'));
    if (_browserVoices.length === 0) _browserVoices = synth.getVoices();
    const sel = document.getElementById('vs-browser-voice');
    if (!sel) return;
    sel.innerHTML = '';
    for (const v of _browserVoices) {
        const opt = document.createElement('option');
        opt.value = v.voiceURI; opt.textContent = `${v.name} (${v.lang})`;
        if (v.voiceURI === _settings.voiceURI || (!_settings.voiceURI && v.lang.startsWith('zh'))) {
            opt.selected = true; _settings.voiceURI = v.voiceURI;
        }
        sel.appendChild(opt);
    }
}

function _speakBrowser(text) {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    setTimeout(() => {
        _showSubtitle(text);
        const u = new SpeechSynthesisUtterance(text);
        const voice = _browserVoices.find(v => v.voiceURI === _settings.voiceURI);
        if (voice) u.voice = voice; else if (_browserVoices.length > 0) u.voice = _browserVoices[0];
        u.rate = _settings.rate; u.pitch = _settings.pitch;
        synth.speak(u);
    }, 100);
}

// ========== 机械电子音（Python TTS 服务） ==========
async function _speakRobotic(text) {
    _showSubtitle(text);
    try {
        const body = {
            text,
            preset: _settings.roboticPreset === 'custom' ? 'custom' : _settings.roboticPreset,
        };
        if (_settings.roboticPreset === 'custom') {
            body.params = _settings.roboticParams;
        }

        // 停止之前的音频
        if (_currentAudio) { _currentAudio.pause(); _currentAudio = null; }

        const resp = await fetch(TTS_SERVER + '/synthesize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!resp.ok) throw new Error('TTS server error: ' + resp.status);

        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        _currentAudio = new Audio(url);
        _currentAudio.play();
    } catch (e) {
        console.warn('[语音] 机械音合成失败，回退浏览器语音:', e.message);
        _speakBrowser(text);
    }
}

// ========== 统一入口 ==========
export async function speak(text) {
    if (!text || !_initDone) return;
    if (_settings.ttsEngine === 'robotic') {
        await _speakRobotic(text);
    } else {
        _speakBrowser(text);
    }
}

// ========== UI ==========
export function initVoiceSettings() {
    const modal    = document.getElementById('voice-settings-modal');
    const btn      = document.getElementById('voice-settings-btn');
    const closeBtn = document.getElementById('vs-close');
    const backdrop = modal?.querySelector('.vs-backdrop');

    btn?.addEventListener('click', () => modal.classList.remove('hidden'));
    const _close = () => modal.classList.add('hidden');
    closeBtn?.addEventListener('click', _close);
    backdrop?.addEventListener('click', _close);

    // 标签页
    modal?.querySelectorAll('.vs-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            modal.querySelectorAll('.vs-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            modal.querySelectorAll('.vs-page').forEach(p => p.classList.remove('active'));
            document.getElementById(tab.dataset.tab)?.classList.add('active');
        });
    });

    // 浏览器语音设置
    _populateBrowserVoices();
    window.speechSynthesis?.addEventListener('voiceschanged', _populateBrowserVoices);
    document.getElementById('vs-browser-voice')?.addEventListener('change', function() {
        _settings.voiceURI = this.value; saveSettings();
    });
    document.getElementById('vs-browser-rate')?.addEventListener('input', function(e) {
        _settings.rate = parseFloat(e.target.value);
        document.getElementById('vs-browser-rate-val').textContent = _settings.rate.toFixed(1);
        saveSettings();
    });
    document.getElementById('vs-browser-pitch')?.addEventListener('input', function(e) {
        _settings.pitch = parseFloat(e.target.value);
        document.getElementById('vs-browser-pitch-val').textContent = _settings.pitch.toFixed(1);
        saveSettings();
    });

    // TTS 引擎切换
    const engineSel = document.getElementById('vs-tts-engine');
    const browserPage = document.getElementById('vs-voice');
    const roboticPage = document.getElementById('vs-robotic');
    if (engineSel) {
        engineSel.value = _settings.ttsEngine;
        engineSel.addEventListener('change', function() {
            _settings.ttsEngine = this.value;
            browserPage.classList.toggle('active', this.value === 'browser');
            roboticPage?.classList.toggle('active', this.value === 'robotic');
            saveSettings();
        });
        browserPage?.classList.toggle('active', _settings.ttsEngine === 'browser');
        roboticPage?.classList.toggle('active', _settings.ttsEngine === 'robotic');
    }

    // 机械音预设
    const presetSel = document.getElementById('vs-robotic-preset');
    if (presetSel) {
        presetSel.value = _settings.roboticPreset;
        presetSel.addEventListener('change', function() {
            _settings.roboticPreset = this.value;
            document.getElementById('vs-custom-params').classList.toggle('hidden', this.value !== 'custom');
            saveSettings();
        });
        document.getElementById('vs-custom-params')?.classList.toggle('hidden', _settings.roboticPreset !== 'custom');
    }

    // 自定义参数绑定
    const paramMap = {
        'vs-r-ring-freq': 'ring_mod_freq',
        'vs-r-ring-mix': 'ring_mod_mix',
        'vs-r-bit-depth': 'bit_depth',
        'vs-r-sr-reduce': 'sample_rate_reduction',
        'vs-r-bp-low': 'bandpass_low',
        'vs-r-bp-high': 'bandpass_high',
        'vs-r-distortion': 'distortion_gain',
        'vs-r-pitch-st': 'pitch_semitones',
        'vs-r-vib-rate': 'vibrato_rate',
        'vs-r-vib-depth': 'vibrato_depth',
        'vs-r-echo-delay': 'echo_delay',
        'vs-r-echo-decay': 'echo_decay',
    };
    Object.entries(paramMap).forEach(([elId, paramKey]) => {
        const el = document.getElementById(elId);
        if (!el) return;
        const valEl = document.getElementById(elId + '-v');
        el.value = _settings.roboticParams[paramKey] ?? '';
        if (valEl) valEl.textContent = el.value;
        el.addEventListener('input', function() {
            const v = parseFloat(this.value) || 0;
            _settings.roboticParams[paramKey] = v;
            if (valEl) valEl.textContent = this.value;
            saveSettings();
        });
    });

    // 提示词
    const promptInput = document.getElementById('vs-prompt-input');
    if (promptInput) {
        promptInput.value = _settings.prompt;
        document.getElementById('vs-prompt-save')?.addEventListener('click', () => {
            _settings.prompt = promptInput.value.trim() || DEFAULTS.prompt;
            promptInput.value = _settings.prompt; saveSettings();
        });
    }

    _initDone = true;
    console.log('[语音] 引擎就绪 (TTS: ' + (_settings.ttsEngine) + ')');
}
