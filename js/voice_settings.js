// ============================================================
// voice_settings.js — 星语设置（浏览器 TTS）
// ============================================================
import { storageLoad, storageSave } from './utils.js';
import { showToast } from './toast.js?v=1';
import { loadConfig, updateAIConfig, getConnection, isConfigured } from '../model-chat/js/config.js?v=2';

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

function saveSettings() { return storageSave(STORAGE_KEY, _settings); }

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

// ========== AI 接口配置（提示词左侧） ==========
const AI_MODE_SEL = 'input[name="vs-ai-mode"]';

function _aiEl(id) { return document.getElementById(id); }

function _applyAIModeUI(mode) {
    _aiEl('vs-ai-api-opts')?.classList.toggle('hidden', mode === 'local');
    _aiEl('vs-ai-local-opts')?.classList.toggle('hidden', mode !== 'local');
}

function _renderAIConfigStatus(message) {
    const el = _aiEl('vs-ai-status');
    if (!el) return;
    if (message) {
        el.textContent = message;
        return;
    }
    if (!isConfigured()) {
        el.textContent = '⚠ 尚未完成配置：直接 API 需要地址与 Key，本地部署需要地址与模型名。';
        return;
    }
    const conn = getConnection();
    el.textContent = `当前：${conn.label} · ${conn.model} · ${conn.url}`;
}

async function _syncAIConfigUI() {
    let cfg;
    try {
        cfg = await loadConfig();
    } catch {
        return;
    }
    if (!cfg) return;

    const mode = cfg.mode === 'local' ? 'local' : 'api';
    document.querySelectorAll(AI_MODE_SEL).forEach(r => { r.checked = r.value === mode; });
    _applyAIModeUI(mode);

    const setValue = (id, value) => {
        const el = _aiEl(id);
        if (el && document.activeElement !== el) el.value = value ?? '';
    };
    setValue('vs-ai-url', cfg.apiUrl);
    setValue('vs-ai-key', cfg.apiKey);
    setValue('vs-ai-model', cfg.model);
    setValue('vs-ai-local-url', cfg.localUrl);
    setValue('vs-ai-local-model', cfg.localModel);
    setValue('vs-ai-local-key', cfg.localKey);
    setValue('vs-ai-max-tokens', cfg.maxTokens);
    setValue('vs-ai-temperature', cfg.temperature);

    const tempVal = _aiEl('vs-ai-temp-val');
    if (tempVal) tempVal.textContent = Number(cfg.temperature).toFixed(2);
    _renderAIConfigStatus();
}

function _initAIConfigUI() {
    document.querySelectorAll(AI_MODE_SEL).forEach(radio => {
        radio.addEventListener('change', () => {
            if (radio.checked) _applyAIModeUI(radio.value);
        });
    });

    _aiEl('vs-ai-temperature')?.addEventListener('input', function () {
        const label = _aiEl('vs-ai-temp-val');
        if (label) label.textContent = Number(this.value).toFixed(2);
    });

    _aiEl('vs-ai-save')?.addEventListener('click', () => {
        const mode = document.querySelector(`${AI_MODE_SEL}:checked`)?.value === 'local' ? 'local' : 'api';
        const apiUrl = (_aiEl('vs-ai-url')?.value || '').trim();
        const localUrl = (_aiEl('vs-ai-local-url')?.value || '').trim();
        const url = mode === 'local' ? localUrl : apiUrl;
        if (!/^https?:\/\//i.test(url)) {
            _renderAIConfigStatus('⚠ 接口地址必须以 http:// 或 https:// 开头');
            return;
        }

        const model = ((mode === 'local' ? _aiEl('vs-ai-local-model')?.value : _aiEl('vs-ai-model')?.value) || '').trim();
        if (!model) {
            _renderAIConfigStatus('⚠ 请填写模型名称');
            return;
        }

        updateAIConfig({
            mode,
            apiUrl,
            localUrl,
            apiKey: (_aiEl('vs-ai-key')?.value || '').trim(),
            model: (_aiEl('vs-ai-model')?.value || '').trim(),
            localModel: (_aiEl('vs-ai-local-model')?.value || '').trim(),
            localKey: (_aiEl('vs-ai-local-key')?.value || '').trim(),
            maxTokens: Math.round(Number(_aiEl('vs-ai-max-tokens')?.value) || 2048),
            temperature: Number(_aiEl('vs-ai-temperature')?.value ?? 0.7),
        });
        _renderAIConfigStatus('✅ 已保存（仅保存在本机浏览器）');
    });

    loadConfig().then(_syncAIConfigUI).catch(() => {});
}

// ========== UI ==========
export function initVoiceSettings() {
    const modal    = document.getElementById('voice-settings-modal');
    const btn      = document.getElementById('voice-settings-btn');
    const closeBtn = document.getElementById('vs-close');
    const backdrop = modal?.querySelector('.vs-backdrop');

    btn?.addEventListener('click', () => {
        modal.classList.remove('hidden');
        _syncAIConfigUI();
    });
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
            promptInput.value = _settings.prompt;
            if (saveSettings()) {
                showToast('✅ 提示词保存成功', 'success');
            } else {
                showToast('⚠ 提示词保存失败：浏览器存储不可用', 'error');
            }
        });
    }

    _initAIConfigUI();

    _initDone = true;
    console.log('[语音] 浏览器 TTS 就绪');
}
