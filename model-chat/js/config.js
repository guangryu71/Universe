// ============================================================
// config.js — AI 接口配置
//
// 默认值来自 model-chat/key.json（可选，已被 .gitignore 排除）；
// 在「星语设置 → 提示词」左侧修改的配置会写入 localStorage，
// 优先级：localStorage > model-chat/key.json > 内置默认值。
//
// 两种连接方式：
//   mode = 'api'   直接连接 OpenAI 兼容的云端接口（需要 API Key）
//   mode = 'local' 连接本机部署的 OpenAI 兼容服务（Ollama / LM Studio / vLLM …）
// ============================================================

const STORAGE_KEY = 'stellar_ai_config';
const FILE_CONFIG_URL = 'model-chat/key.json';

const DEFAULTS = {
    mode: 'api',
    apiUrl: 'https://api.deepseek.com/v1/chat/completions',
    apiKey: '',
    model: 'deepseek-chat',
    localUrl: 'http://127.0.0.1:11434/v1/chat/completions',
    localModel: 'qwen2.5:7b',
    localKey: '',
    maxTokens: 2048,
    temperature: 0.7,
    systemPrompt: '',
    welcomeMessage: '> 星语终端已就绪。输入 /help 查看指令，或直接向我提问。',
};

const TEXT_FIELDS = [
    'mode', 'apiUrl', 'apiKey', 'model',
    'localUrl', 'localModel', 'localKey',
    'systemPrompt', 'welcomeMessage',
];

let _config = null;
let _loadPromise = null;

function _readLocal() {
    try {
        const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        return raw && typeof raw === 'object' ? raw : {};
    } catch {
        return {};
    }
}

/** 白名单 + 数值范围清洗，避免配置文件里的脏数据影响请求 */
function _normalize(raw, base) {
    const out = { ...base };
    if (!raw || typeof raw !== 'object') return out;

    for (const key of TEXT_FIELDS) {
        if (typeof raw[key] === 'string') out[key] = raw[key].trim();
    }
    if (out.mode !== 'local' && out.mode !== 'api') out.mode = 'api';

    const maxTokens = Number(raw.maxTokens);
    if (Number.isFinite(maxTokens)) {
        out.maxTokens = Math.min(8192, Math.max(128, Math.round(maxTokens)));
    }
    const temperature = Number(raw.temperature);
    if (Number.isFinite(temperature)) {
        out.temperature = Math.min(1.5, Math.max(0, temperature));
    }
    return out;
}

/** 读取配置（只请求一次 key.json，之后合并 localStorage） */
export function loadConfig() {
    if (_config) return Promise.resolve(_config);
    if (_loadPromise) return _loadPromise;

    _loadPromise = (async () => {
        let fileConfig = {};
        try {
            const resp = await fetch(FILE_CONFIG_URL, { cache: 'no-store' });
            if (resp.ok) {
                fileConfig = await resp.json();
            } else if (resp.status !== 404) {
                console.warn('[Config] 读取 key.json 失败: HTTP', resp.status);
            }
        } catch (err) {
            console.warn('[Config] 读取 key.json 失败:', err?.message || err);
        }
        _config = _normalize(_readLocal(), _normalize(fileConfig, { ...DEFAULTS }));
        return _config;
    })();

    return _loadPromise;
}

export function getConfig() {
    if (_config) return _config;
    return _normalize(_readLocal(), { ...DEFAULTS });
}

/** 只更新允许在界面上编辑的字段；API Key 只保存在本机浏览器 */
export function updateAIConfig(patch) {
    const current = getConfig();
    _config = _normalize({ ...current, ...patch }, current);
    _loadPromise = Promise.resolve(_config);

    const persist = {
        mode: _config.mode,
        apiUrl: _config.apiUrl,
        apiKey: _config.apiKey,
        model: _config.model,
        localUrl: _config.localUrl,
        localModel: _config.localModel,
        localKey: _config.localKey,
        maxTokens: _config.maxTokens,
        temperature: _config.temperature,
    };
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ..._readLocal(), ...persist }));
    } catch (err) {
        console.warn('[Config] 保存配置失败:', err?.message || err);
    }
    return _config;
}

/** 当前生效的连接参数（按 mode 选择云端 / 本地字段） */
export function getConnection() {
    const c = getConfig();
    const isLocal = c.mode === 'local';
    return {
        mode: c.mode,
        isLocal,
        url: (isLocal ? c.localUrl : c.apiUrl).trim(),
        key: (isLocal ? c.localKey : c.apiKey).trim(),
        model: (isLocal ? c.localModel : c.model).trim() || 'local-model',
        maxTokens: c.maxTokens,
        temperature: c.temperature,
        label: isLocal ? '本地部署' : '直接 API',
    };
}

/** 本地部署允许不填 Key；云端 API 模式必须有 Key */
export function isConfigured() {
    const conn = getConnection();
    if (!conn.url) return false;
    return conn.isLocal || !!conn.key;
}

export { DEFAULTS as AI_CONFIG_DEFAULTS, STORAGE_KEY as AI_CONFIG_STORAGE_KEY };
