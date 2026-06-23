// ============================================================
// overlay.js — 星语终端覆盖层（主页嵌入式对话窗口）
// 登录 → CRT 过渡 → 对话
// ============================================================

import { loadConfig, getConfig } from './config.js';
import { streamChat } from './api.js';
import { speak as vsSpeak, getPrompt } from '../../js/voice_settings.js';

const BASE = 'model-chat'; // 静态资源基路径

let messages = [];
let isStreaming = false;
let abortCtrl = null;
let configLoaded = false;
let isAuthed = false;  // 当前会话是否已登录

// ==================== 打开 / 关闭覆盖层 ====================

export async function openOverlay() {
    const overlay = document.getElementById('chat-overlay');
    const login = document.getElementById('chat-login');
    const window = document.getElementById('chat-window');

    overlay.classList.remove('hidden');
    login.classList.remove('hidden', 'dissolve-out');
    window.classList.add('hidden');

    // 强制回流以重新触发 CSS 动画
    void login.offsetWidth;

    // 重置
    document.getElementById('chat-login-input').value = '';
    document.getElementById('chat-login-error').textContent = '';

    // 加载配置
    if (!configLoaded) {
        try {
            await loadConfig();
            configLoaded = true;
        } catch (err) {
            document.getElementById('chat-login-error').textContent = '配置加载失败: ' + err.message;
        }
    }

    // 检查 sessionStorage 中是否已有登录标记
    if (sessionStorage.getItem('stellar_authed') === '1' || isAuthed) {
        // 已登录，跳过登录界面直接进入对话
        login.classList.add('dissolve-out');
        setTimeout(() => {
            login.classList.add('hidden');
            showChatWindow();
        }, 500);
    } else {
        setTimeout(() => {
            document.getElementById('chat-login-input').focus();
        }, 800);
    }
}

export function closeOverlay() {
    document.getElementById('chat-overlay').classList.add('hidden');
    if (abortCtrl) abortCtrl.abort();
}

// ==================== 登录验证 ====================

document.getElementById('chat-login-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') attemptLogin();
});

function attemptLogin() {
    const cfg = getConfig();
    if (!cfg) return;

    const input = document.getElementById('chat-login-input');
    const pwd = input.value.trim();
    const errorEl = document.getElementById('chat-login-error');

    if (!pwd) {
        errorEl.textContent = '请输入访问密码';
        return;
    }
    if (pwd !== cfg.loginPassword) {
        errorEl.textContent = '密码错误，拒绝访问';
        input.value = '';
        input.focus();
        // 抖动
        const login = document.getElementById('chat-login');
        login.style.animation = 'none';
        void login.offsetWidth;
        login.style.animation = 'shake 0.4s ease-out';
        return;
    }

    // 登录成功 → 溶解动画 + 记住状态
    errorEl.textContent = '';
    isAuthed = true;
    sessionStorage.setItem('stellar_authed', '1');
    const login = document.getElementById('chat-login');
    login.classList.add('dissolve-out');

    setTimeout(() => {
        login.classList.add('hidden');
        showChatWindow();
    }, 500);
}

// ==================== 对话窗口 ====================

function showChatWindow() {
    const window = document.getElementById('chat-window');
    window.classList.remove('hidden');

    const output = document.getElementById('chat-output');
    const input = document.getElementById('chat-input');
    const status = document.getElementById('chat-status');

    output.innerHTML = '';
    messages = [];

    const cfg = getConfig();
    appendSystem(cfg?.welcomeMessage || '> 星语终端已就绪。');
    appendSystem('输入 /help 查看指令，或直接开始对话。');

    input.disabled = false;
    input.focus();
    status.textContent = '● 在线';
}

// ==================== 发送消息 ====================

document.getElementById('chat-input').addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        await sendMessage();
    }
});

async function sendMessage() {
    if (isStreaming) return;

    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';

    // 指令
    if (text.startsWith('/')) {
        handleCommand(text);
        return;
    }

    appendUser(text);
    messages.push({ role: 'user', content: text });

    isStreaming = true;
    input.disabled = true;
    document.getElementById('chat-status').textContent = '◇ 思考中...';

    const aiBubble = createAIBubble();
    let firstToken = true;

    abortCtrl = await streamChat(
        messages,
        (token) => {
            aiBubble.textContent += token;
            scrollBottom();
            if (firstToken) {
                firstToken = false;
                document.getElementById('chat-status').textContent = '◆ 回复中';
            }
        },
        (fullText) => {
            messages.push({ role: 'assistant', content: fullText });
            const speakBtn = aiBubble.parentElement?.querySelector('.msg-speak-btn');
            if (speakBtn) speakBtn.style.display = '';
            vsSpeak(fullText);  // 自动朗读
            finishStream();
        },
        (err) => {
            aiBubble.textContent += `\n\n[错误] ${err.message}`;
            aiBubble.style.color = '#f44';
            finishStream();
            document.getElementById('chat-status').textContent = '● 在线';
        },
        getPrompt()
    );
}

function finishStream() {
    isStreaming = false;
    const input = document.getElementById('chat-input');
    input.disabled = false;
    input.focus();
    document.getElementById('chat-status').textContent = '● 在线';
    scrollBottom();
}

// ==================== 指令 ====================

function handleCommand(cmd) {
    const args = cmd.split(/\s+/);
    const command = args[0].toLowerCase();

    switch (command) {
        case '/help':
            appendSystem(`可用指令：
/help     - 显示帮助
/clear    - 清屏
/reset    - 重置对话
/about    - 关于星语`);
            break;
        case '/clear':
            document.getElementById('chat-output').innerHTML = '';
            appendSystem('> 屏幕已清除。');
            break;
        case '/reset':
            messages = [];
            document.getElementById('chat-output').innerHTML = '';
            appendSystem(getConfig()?.welcomeMessage || '> 对话已重置。');
            break;
        case '/about':
            appendSystem(`星语 v1.0 — 宇宙探索助手
模型: DeepSeek Flash
擅长: 天文学 / 物理学 / 航天工程
风格: 专业 + 太空诗人`);
            break;
        default:
            appendSystem(`未知指令: ${command}，输入 /help 查看可用指令。`);
    }
    scrollBottom();
}

// ==================== DOM 工具 ====================

function appendUser(text) {
    const div = document.createElement('div');
    div.className = 'msg-user';
    div.innerHTML = `<span class="prompt">▸</span> ${esc(text)}`;
    document.getElementById('chat-output').appendChild(div);
    scrollBottom();
}

function appendSystem(text) {
    const div = document.createElement('div');
    div.className = 'msg-system';
    div.textContent = text;
    document.getElementById('chat-output').appendChild(div);
    scrollBottom();
}

function createAIBubble() {
    const div = document.createElement('div');
    div.className = 'msg-ai';
    div.innerHTML = '<span class="prompt">✦</span> ';
    const span = document.createElement('span');
    div.appendChild(span);

    // 添加朗读按钮
    const speakBtn = document.createElement('button');
    speakBtn.className = 'msg-speak-btn';
    speakBtn.title = '朗读回复';
    speakBtn.textContent = '🔊';
    speakBtn.style.display = 'none';  // 完成后才显示
    speakBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const text = span.textContent;
        if (text) vsSpeak(text);
    });
    div.appendChild(speakBtn);

    document.getElementById('chat-output').appendChild(div);
    scrollBottom();
    return span;
}

function esc(str) {
    const el = document.createElement('span');
    el.textContent = str;
    return el.innerHTML;
}

function scrollBottom() {
    const output = document.getElementById('chat-output');
    output.scrollTop = output.scrollHeight;
}

// ==================== 关闭按钮 ====================

document.getElementById('chat-close-btn').addEventListener('click', closeOverlay);
document.getElementById('chat-close-btn2').addEventListener('click', closeOverlay);
// 点击背景关闭
document.querySelector('.chat-backdrop').addEventListener('click', closeOverlay);
