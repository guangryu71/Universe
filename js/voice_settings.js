// ============================================================
// voice_settings.js — 星语设置（浏览器 TTS）
// ============================================================
import { storageLoad, storageSave } from './utils.js';

const STORAGE_KEY = 'starvoice_settings';

const DEFAULTS = {
    prompt: '你是一个宇宙飞船上的AI助手，用专业且略带科幻感的语气回答用户问题。回答简洁，每条回复不超过150字。',
    voiceURI: '',
    rate: 1.0,
    pitch: 1.0,
    volume: 1.0,
};

let _settings = { ...DEFAULTS, ...storageLoad(STORAGE_KEY, {}) };
let _browserVoices = [];
let _initDone = false;
let _subtitleTimer = null;

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

export function speak(text) {
    if (!text || !_initDone) return;
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    setTimeout(() => {
        _showSubtitle(text);
        const u = new SpeechSynthesisUtterance(text);
        const voice = _browserVoices.find(v => v.voiceURI === _settings.voiceURI);
        if (voice) u.voice = voice; else if (_browserVoices.length > 0) u.voice = _browserVoices[0];
        u.rate = _settings.rate;
        u.pitch = _settings.pitch;
        u.volume = _settings.volume;
        synth.speak(u);
    }, 100);
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
    document.getElementById('vs-browser-volume')?.addEventListener('input', function(e) {
        _settings.volume = parseFloat(e.target.value);
        document.getElementById('vs-browser-vol-val').textContent = _settings.volume.toFixed(2);
        saveSettings();
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
    console.log('[语音] 浏览器 TTS 就绪');
}
