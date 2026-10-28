// ============================================================
// api.js — OpenAI 兼容接口调用（流式对话 + 一次性 JSON）
//
// 支持两种后端：
//   1. 直接 API：https://<厂商>/v1/chat/completions
//   2. 本地部署：Ollama / LM Studio / vLLM 等暴露的 OpenAI 兼容地址
//
// 安全说明：这里只负责发起 HTTP 请求；API Key 仅从本机配置读取，
// 不会写入对话消息，也不会被发送给模型。
// ============================================================

import { getConnection } from './config.js?v=2';

function _friendlyFetchError(err) {
    if (err?.name === 'AbortError') return err;
    if (err instanceof TypeError) {
        return new Error('无法连接 AI 接口（网络不可达，或被浏览器 CORS 策略拦截）。请检查接口地址；本地部署可尝试在服务端开启跨域。');
    }
    return err instanceof Error ? err : new Error(String(err));
}

async function _readErrorMessage(resp) {
    const status = resp.status;
    let detail = '';
    try {
        const text = await resp.text();
        try {
            const json = JSON.parse(text);
            detail = json?.error?.message || json?.message || text;
        } catch {
            detail = text;
        }
    } catch {
        detail = '';
    }
    detail = String(detail || '').trim();
    if (detail.length > 300) detail = detail.slice(0, 300) + '…';

    if (status === 401 || status === 403) {
        return new Error(`API Key 无效或没有访问权限（HTTP ${status}）${detail ? '：' + detail : ''}`);
    }
    if (status === 404) {
        return new Error(`接口地址不存在（HTTP 404）。请确认 URL 是否包含 /v1/chat/completions${detail ? '：' + detail : ''}`);
    }
    if (status === 429) {
        return new Error(`请求过于频繁或额度不足（HTTP 429）${detail ? '：' + detail : ''}`);
    }
    return new Error(`AI 接口返回 HTTP ${status}${detail ? '：' + detail : ''}`);
}

function _assertConfigured(conn) {
    if (!conn.url) {
        throw new Error('尚未配置 AI 接口地址。请打开「星语设置 → 提示词」左侧的接口配置。');
    }
    if (!conn.isLocal && !conn.key) {
        throw new Error('尚未配置 API Key。请打开「星语设置 → 提示词」左侧填写，或改用本地 AI 部署。');
    }
}

function _headers(conn) {
    const headers = { 'Content-Type': 'application/json' };
    if (conn.key) headers.Authorization = `Bearer ${conn.key}`;
    return headers;
}

/**
 * 流式调用（SSE）。立即返回 AbortController，便于用户随时中止。
 * @param {Array<{role:string, content:string}>} messages
 * @param {(text:string)=>void} onToken
 * @param {(fullText:string)=>void} onDone
 * @param {(err:Error)=>void} onError
 * @param {string|null} systemPrompt
 * @param {{maxTokens?:number, temperature?:number, timeoutMs?:number}} [opts]
 * @returns {AbortController}
 */
export function streamChat(messages, onToken, onDone, onError, systemPrompt = null, opts = {}) {
    const controller = new AbortController();
    const conn = getConnection();

    try {
        _assertConfigured(conn);
    } catch (err) {
        setTimeout(() => onError(err), 0);
        return controller;
    }

    const prompt = systemPrompt || null;
    const body = {
        model: conn.model,
        messages: prompt ? [{ role: 'system', content: prompt }, ...messages] : messages,
        max_tokens: opts.maxTokens ?? conn.maxTokens,
        temperature: opts.temperature ?? conn.temperature,
        stream: true,
    };

    (async () => {
        let timer = null;
        if (opts.timeoutMs) timer = setTimeout(() => controller.abort(), opts.timeoutMs);
        try {
            const resp = await fetch(conn.url, {
                method: 'POST',
                headers: _headers(conn),
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            if (!resp.ok) throw await _readErrorMessage(resp);

            const reader = resp.body.getReader();
            const decoder = new TextDecoder();
            let fullText = '';
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('data:')) continue;
                    const data = trimmed.slice(5).trim();
                    if (!data || data === '[DONE]') continue;

                    try {
                        const json = JSON.parse(data);
                        const delta = json.choices?.[0]?.delta?.content
                            ?? json.choices?.[0]?.message?.content
                            ?? '';
                        if (delta) {
                            fullText += delta;
                            onToken(delta);
                        }
                    } catch {
                        // 忽略无法解析的心跳/注释行
                    }
                }
            }

            onDone(fullText);
        } catch (err) {
            if (err?.name === 'AbortError') return;
            onError(_friendlyFetchError(err));
        } finally {
            if (timer) clearTimeout(timer);
        }
    })();

    return controller;
}

/**
 * 一次性调用（不流式），用于「数据检索规划」和「实验室蓝图生成」。
 * 返回模型输出的完整文本。
 */
export async function chatOnce(messages, systemPrompt = null, opts = {}) {
    const conn = getConnection();
    _assertConfigured(conn);

    const body = {
        model: conn.model,
        messages: systemPrompt ? [{ role: 'system', content: systemPrompt }, ...messages] : messages,
        max_tokens: opts.maxTokens ?? conn.maxTokens,
        temperature: opts.temperature ?? conn.temperature,
        stream: false,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120000);

    try {
        const resp = await fetch(conn.url, {
            method: 'POST',
            headers: _headers(conn),
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        if (!resp.ok) throw await _readErrorMessage(resp);

        const json = await resp.json();
        const content = json.choices?.[0]?.message?.content
            ?? json.choices?.[0]?.text
            ?? json.message?.content
            ?? '';
        if (typeof content !== 'string') return '';
        return content;
    } catch (err) {
        if (err?.name === 'AbortError') throw new Error('AI 请求超时或被取消');
        throw _friendlyFetchError(err);
    } finally {
        clearTimeout(timer);
    }
}
