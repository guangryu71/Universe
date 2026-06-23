// ============================================================
// config.js — 加载 key.json 配置
// ============================================================

let _config = null;

export async function loadConfig() {
    if (_config) return _config;

    try {
        const resp = await fetch('model-chat/key.json');
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        _config = await resp.json();
        return _config;
    } catch (err) {
        console.error('[Config] 加载 key.json 失败:', err.message);
        // 返回默认兜底配置
        _config = {
            apiKey: '',
            apiUrl: 'https://api.deepseek.com/v1/chat/completions',
            model: 'deepseek-chat',
            systemPrompt: '你是宇宙探索助手。',
            maxTokens: 2048,
            temperature: 0.7,
            loginPassword: 'star123',
            welcomeMessage: '> 终端已就绪。',
        };
        return _config;
    }
}

export function getConfig() {
    return _config;
}
