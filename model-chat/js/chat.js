// ============================================================
// chat.js — 对话终端界面（消息渲染、指令、流式输出）
// ============================================================

import { streamChat } from './api.js';
import { getConfig } from './config.js';

export class ChatTerminal {
    constructor() {
        this.messages = [];           // 对话历史 [{role, content}]
        this.outputEl = document.getElementById('chat-output');
        this.inputEl = document.getElementById('chat-input');
        this.statusEl = document.getElementById('chat-status');
        this.isStreaming = false;
        this.abortCtrl = null;

        this._bindEvents();
    }

    // ---------- 事件绑定 ----------
    _bindEvents() {
        this.inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this._sendMessage();
            }
        });
    }

    // ---------- 启动终端 ----------
    start() {
        const cfg = getConfig();
        this._appendSystem(cfg.welcomeMessage || '> 终端已就绪。');
        this._appendSystem('输入 /help 查看指令，或直接开始对话。');
        this.inputEl.disabled = false;
        this.inputEl.focus();
        this._setStatus('● 在线');
    }

    // ---------- 发送消息 ----------
    async _sendMessage() {
        if (this.isStreaming) return;

        const text = this.inputEl.value.trim();
        if (!text) return;

        this.inputEl.value = '';

        // 指令处理
        if (text.startsWith('/')) {
            this._handleCommand(text);
            return;
        }

        // 用户消息
        this._appendUser(text);
        this.messages.push({ role: 'user', content: text });

        // AI 回复
        this.isStreaming = true;
        this.inputEl.disabled = true;
        this._setStatus('◇ 思考中...');

        const aiBubble = this._createAIBubble();
        let tokenCount = 0;

        this.abortCtrl = await streamChat(
            this.messages,
            // onToken
            (token) => {
                tokenCount++;
                aiBubble.textContent += token;
                this._scrollBottom();
                if (tokenCount === 1) this._setStatus('◆ 回复中');
            },
            // onDone
            (fullText) => {
                this.messages.push({ role: 'assistant', content: fullText });
                this._finishStream();
            },
            // onError
            (err) => {
                aiBubble.textContent += `\n\n[错误] ${err.message}`;
                aiBubble.style.color = '#f44';
                this._finishStream();
                this._setStatus('● 在线');
            }
        );
    }

    _finishStream() {
        this.isStreaming = false;
        this.inputEl.disabled = false;
        this.inputEl.focus();
        this._setStatus('● 在线');
        this._scrollBottom();
    }

    // ---------- 指令 ----------
    _handleCommand(cmd) {
        const args = cmd.split(/\s+/);
        const command = args[0].toLowerCase();

        switch (command) {
            case '/help':
                this._appendSystem(`可用指令：
/help     - 显示帮助
/clear    - 清屏
/reset    - 重置对话
/about    - 关于星语`);
                break;
            case '/clear':
                this.outputEl.innerHTML = '';
                this._appendSystem('> 屏幕已清除。');
                break;
            case '/reset':
                this.messages = [];
                this.outputEl.innerHTML = '';
                const cfg = getConfig();
                this._appendSystem(cfg.welcomeMessage || '> 对话已重置。');
                break;
            case '/about':
                this._appendSystem(`星语 v1.0 — 宇宙探索助手
模型: DeepSeek Flash
擅长: 天文学 / 物理学 / 航天工程
风格: 专业 + 太空诗人`);
                break;
            default:
                this._appendSystem(`未知指令: ${command}，输入 /help 查看可用指令。`);
        }
        this._scrollBottom();
    }

    // ---------- DOM 构建 ----------
    _appendUser(text) {
        const div = document.createElement('div');
        div.className = 'msg-user';
        div.innerHTML = `<span class="prompt">▸</span> ${this._escapeHtml(text)}`;
        this.outputEl.appendChild(div);
        this._scrollBottom();
    }

    _appendSystem(text) {
        const div = document.createElement('div');
        div.className = 'msg-system';
        div.textContent = text;
        this.outputEl.appendChild(div);
        this._scrollBottom();
    }

    _createAIBubble() {
        const div = document.createElement('div');
        div.className = 'msg-ai';
        div.innerHTML = '<span class="prompt">✦</span> ';
        const span = document.createElement('span');
        div.appendChild(span);
        this.outputEl.appendChild(div);
        this._scrollBottom();
        return span;
    }

    _escapeHtml(str) {
        const el = document.createElement('span');
        el.textContent = str;
        return el.innerHTML;
    }

    _setStatus(text) {
        if (this.statusEl) this.statusEl.textContent = text;
    }

    _scrollBottom() {
        this.outputEl.scrollTop = this.outputEl.scrollHeight;
    }
}
