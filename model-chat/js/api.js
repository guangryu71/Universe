// ============================================================
// api.js — DeepSeek API 流式调用模块
// ============================================================

import { getConfig } from './config.js';

/**
 * 流式调用 DeepSeek Chat API
 * @param {Array<{role:string, content:string}>} messages - 对话历史
 * @param {function} onToken  - 每收到一个 token 回调 (text:string) => void
 * @param {function} onDone   - 流结束回调 (fullText:string) => void
 * @param {function} onError  - 出错回调 (error:Error) => void
 * @returns {AbortController} 用于取消请求
 */
export async function streamChat(messages, onToken, onDone, onError, systemPrompt = null) {
    const cfg = getConfig();
    const controller = new AbortController();

    if (!cfg.apiKey || cfg.apiKey === 'sk-your-deepseek-api-key-here') {
        onError(new Error('请先在 model-chat/key.json 中配置有效的 DeepSeek API Key'));
        return controller;
    }

    const prompt = systemPrompt || cfg.systemPrompt;

    const body = {
        model: cfg.model,
        messages: [
            { role: 'system', content: prompt },
            ...messages,
        ],
        max_tokens: cfg.maxTokens,
        temperature: cfg.temperature,
        stream: true,
    };

    try {
        const resp = await fetch(cfg.apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${cfg.apiKey}`,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });

        if (!resp.ok) {
            const errText = await resp.text();
            let msg;
            try {
                const errJson = JSON.parse(errText);
                msg = errJson.error?.message || errText;
            } catch {
                msg = errText || `HTTP ${resp.status}`;
            }
            throw new Error(msg);
        }

        // 读取 SSE 流
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // 最后一行可能不完整

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith('data: ')) continue;

                const data = trimmed.slice(6); // 去掉 "data: "
                if (data === '[DONE]') continue;

                try {
                    const json = JSON.parse(data);
                    const delta = json.choices?.[0]?.delta?.content;
                    if (delta) {
                        fullText += delta;
                        onToken(delta);
                    }
                } catch {
                    // 跳过解析失败的行
                }
            }
        }

        onDone(fullText);
    } catch (err) {
        if (err.name === 'AbortError') return controller;
        onError(err);
    }

    return controller;
}
