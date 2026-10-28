// ============================================================
// overlay.js — 星语终端覆盖层（主页内嵌对话窗口）
//
// 点击入口直接进入对话（无登录窗口）；
// 关闭只能通过右上角 ✕；
// 每条消息先由规划器决定要拉取哪些星体/星系数据，再由程序
// 按白名单读取，最后连同目录一起交给模型回答。
// ============================================================

import { loadConfig, getConfig, getConnection, isConfigured } from './config.js?v=2';
import { streamChat } from './api.js?v=2';
import { buildCatalog, collectContext, describeContext } from './context.js?v=2';
import { planDataNeeds, isEmptyPlan } from './agent.js?v=2';
import { buildAnswerPrompt } from './prompts.js?v=2';
import { getPrompt } from '../../js/voice_settings.js?v=3';

let messages = [];
let isStreaming = false;
let abortCtrl = null;
let configLoaded = false;
let initialized = false;
let runToken = 0;

let _catalogCache = null;   // { at:number, data }
const CATALOG_TTL = 15000;
const MAX_HISTORY = 20;

const EMPTY_PACKET = { text: '', systems: [], galaxies: [], truncated: false, chars: 0 };

// ==================== 打开 / 关闭 ====================

export async function openOverlay() {
    const overlay = document.getElementById('chat-overlay');
    const win = document.getElementById('chat-window');
    if (!overlay || !win) return;

    overlay.classList.remove('hidden');
    win.classList.remove('hidden');

    if (!configLoaded) {
        _setStatus('◇ 加载接口配置...');
        try {
            await loadConfig();
        } catch (err) {
            console.warn('[星语] 配置加载失败:', err);
        }
        configLoaded = true;
    }

    _initConversation();
    _refreshHeader();

    const input = document.getElementById('chat-input');
    if (input) {
        input.disabled = false;
        input.focus();
    }
    _setStatus('● 在线');
    _scrollBottom();
}

export function closeOverlay() {
    runToken += 1;
    if (abortCtrl) {
        abortCtrl.abort();
        abortCtrl = null;
    }
    _finishStream();
    document.getElementById('chat-overlay')?.classList.add('hidden');
}

function _initConversation() {
    if (initialized) return;
    initialized = true;
    messages = [];

    const cfg = getConfig();
    appendSystem(cfg.welcomeMessage || '> 星语终端已就绪。');
    appendSystem('输入 /help 查看指令，或直接向我提问。');

    if (!isConfigured()) {
        appendSystem('⚠ 尚未配置 AI 接口。请点击右上角 ⚙「星语设置」→「提示词」，在左侧选择「直接 API 连接」或「本地 AI 部署」并填写参数。');
    }
}

function _refreshHeader() {
    const tag = document.querySelector('#chat-window .sys-tag');
    if (!tag) return;
    if (!isConfigured()) {
        tag.textContent = '未配置接口';
        return;
    }
    const conn = getConnection();
    tag.textContent = `${conn.label} · ${conn.model}`;
    tag.title = conn.url;
}

// ==================== 数据目录 ====================

async function _getCatalog() {
    const now = Date.now();
    if (_catalogCache && now - _catalogCache.at < CATALOG_TTL) {
        return _catalogCache.data;
    }
    const data = await buildCatalog();
    _catalogCache = { at: now, data };
    return data;
}

// ==================== 发送消息 ====================

document.getElementById('chat-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

async function sendMessage() {
    if (isStreaming) return;

    const input = document.getElementById('chat-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = '';

    if (text.startsWith('/')) {
        handleCommand(text);
        return;
    }

    appendUser(text);
    messages.push({ role: 'user', content: text });
    if (messages.length > MAX_HISTORY) {
        messages = messages.slice(messages.length - MAX_HISTORY);
    }

    isStreaming = true;
    input.disabled = true;
    const token = ++runToken;

    const aiBubble = createAIBubble();
    let firstToken = true;

    try {
        // ---------- 第一步：AI 决定要哪些数据 ----------
        _setStatus('◇ 规划数据检索...');
        let catalog = null;
        let packet = EMPTY_PACKET;

        try {
            catalog = await _getCatalog();
        } catch (err) {
            appendSystem('⚠ 读取数据库目录失败：' + (err?.message || err) + '（将只进行通用对话）');
        }
        if (token !== runToken) return;

        let plan = null;
        if (catalog) {
            try {
                plan = await planDataNeeds(text, catalog.text);
            } catch (err) {
                appendSystem('⚠ 数据检索规划失败：' + (err?.message || err) + '（将只使用目录摘要回答）');
            }
        }
        if (token !== runToken) return;

        if (plan && !isEmptyPlan(plan)) {
            _setStatus('◇ 调取星体数据...');
            packet = await collectContext(plan, catalog);
            if (token !== runToken) return;
            if (packet.systems.length || packet.galaxies.length) {
                appendSystem('📡 已调取 · ' + describeContext(packet));
            }
        } else if (plan) {
            appendSystem('◇ 通用对话 · 未调取数据库');
        }

        // ---------- 第二步：带着资料回答 ----------
        const systemPrompt = buildAnswerPrompt({
            userPrompt: getPrompt(),
            catalogText: catalog?.text || '',
            contextText: packet.text,
        });

        _setStatus('◇ 思考中...');
        firstToken = true;

        abortCtrl = streamChat(
            messages,
            (delta) => {
                aiBubble.textContent += delta;
                const sm = window.__soundManager;
                if (sm && sm.isReady()) sm.playTypewriter(1);
                _scrollBottom();
                if (firstToken) {
                    firstToken = false;
                    _setStatus('◆ 回复中');
                }
            },
            (fullText) => {
                if (fullText.trim()) {
                    messages.push({ role: 'assistant', content: fullText });
                }
                _finishStream();
            },
            (err) => {
                aiBubble.textContent += `\n\n[错误] ${err?.message || err}`;
                aiBubble.style.color = '#f44';
                _finishStream();
            },
            systemPrompt,
            { timeoutMs: 180000 }
        );
    } catch (err) {
        aiBubble.textContent += `\n\n[错误] ${err?.message || err}`;
        aiBubble.style.color = '#f44';
        _finishStream();
    }
}

function _finishStream() {
    isStreaming = false;
    abortCtrl = null;
    const input = document.getElementById('chat-input');
    if (input) {
        input.disabled = false;
        input.focus();
    }
    _setStatus('● 在线');
    _scrollBottom();
}

function _setStatus(text) {
    const status = document.getElementById('chat-status');
    if (status) status.textContent = text;
}

// ==================== 指令 ====================

function handleCommand(cmd) {
    const command = cmd.split(/\s+/)[0].toLowerCase();

    switch (command) {
        case '/help':
            appendSystem(`可用指令：
/help     - 显示帮助
/clear    - 清屏（保留对话上下文）
/reset    - 重置对话
/data     - 查看数据库概览
/about    - 关于星语`);
            break;
        case '/clear':
            document.getElementById('chat-output').innerHTML = '';
            appendSystem('> 屏幕已清除（对话上下文仍保留）。');
            break;
        case '/reset':
            messages = [];
            document.getElementById('chat-output').innerHTML = '';
            appendSystem(getConfig()?.welcomeMessage || '> 对话已重置。');
            break;
        case '/data':
            _showDataOverview();
            break;
        case '/about':
            _showAbout();
            break;
        default:
            appendSystem(`未知指令: ${command}，输入 /help 查看可用指令。`);
    }
    _scrollBottom();
}

async function _showDataOverview() {
    try {
        const catalog = await _getCatalog();
        const names = catalog.systems.slice(0, 12).map(s => s.nameCN || s.name).join('、');
        appendSystem(`📚 星体数据库：${catalog.systems.length} 个星体系统${names ? '（' + names + (catalog.systems.length > 12 ? '…' : '') + '）' : ''}\n🌌 星系数据库：${catalog.galaxies.length} 个星系（${catalog.galaxies.map(g => g.name).join('、')}）`);
        appendSystem('提示：直接提问即可，星语会自行判断需要调取哪些系统/星系的数据。');
    } catch (err) {
        appendSystem('⚠ 读取数据库失败：' + (err?.message || err));
    }
    _scrollBottom();
}

function _showAbout() {
    const conn = getConnection();
    const connLine = isConfigured()
        ? `接口: ${conn.label} · ${conn.model}`
        : '接口: 未配置';
    appendSystem(`星语 · 《星空宇宙》专属智能终端
${connLine}
数据: 星体数据库（星体系统/星体/卫星/关联）+ 星系数据库
机制: 先规划 → 程序按白名单调取 → 再回答（只读沙箱）`);
    _scrollBottom();
}

// ==================== DOM 工具 ====================

function appendUser(text) {
    const div = document.createElement('div');
    div.className = 'msg-user';
    div.innerHTML = `<span class="prompt">▸</span> ${esc(text)}`;
    document.getElementById('chat-output').appendChild(div);
    _scrollBottom();
}

function appendSystem(text) {
    const div = document.createElement('div');
    div.className = 'msg-system';
    div.textContent = text;
    document.getElementById('chat-output').appendChild(div);
    _scrollBottom();
}

function createAIBubble() {
    const div = document.createElement('div');
    div.className = 'msg-ai';
    div.innerHTML = '<span class="prompt">✦</span> ';
    const span = document.createElement('span');
    div.appendChild(span);

    document.getElementById('chat-output').appendChild(div);
    _scrollBottom();
    return span;
}

function esc(str) {
    const el = document.createElement('span');
    el.textContent = str;
    return el.innerHTML;
}

function _scrollBottom() {
    const output = document.getElementById('chat-output');
    if (output) output.scrollTop = output.scrollHeight;
}

// ==================== 关闭按钮 ====================

// 只允许右上角 ✕ 关闭；点击窗口外部不再关闭
const closeBtn = document.getElementById('chat-close-btn2');
closeBtn?.addEventListener('click', closeOverlay);
// 阻止标题栏在按下 ✕ 时启动拖拽，否则 pointer capture 会把 click 重定向到标题栏
closeBtn?.addEventListener('pointerdown', (e) => e.stopPropagation());

// ==================== 全息窗口拖拽 ====================

const chatWindow = document.getElementById('chat-window');
const dragHandle = document.getElementById('chatDragHandle');
let dragging = false, dragSX, dragSY, dragIL, dragIT;

dragHandle?.addEventListener('pointerdown', (e) => {
    // 标题栏内的按钮/输入框不触发拖拽
    if (e.target.closest('button, input, textarea, select, a')) return;
    if (e.button !== undefined && e.button !== 0) return;
    dragging = true;
    dragHandle.setPointerCapture(e.pointerId);
    const r = chatWindow.getBoundingClientRect();
    dragSX = e.clientX; dragSY = e.clientY;
    dragIL = r.left + r.width / 2; dragIT = r.top + r.height / 2;
    chatWindow.style.transition = 'none';
});
document.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    chatWindow.style.left = `${dragIL + e.clientX - dragSX}px`;
    chatWindow.style.top = `${dragIT + e.clientY - dragSY}px`;
    chatWindow.style.transform = 'translate(-50%, -50%)';
});
document.addEventListener('pointerup', () => { dragging = false; });

// ==================== TRANSMIT 按钮 ====================

document.getElementById('chat-send-btn')?.addEventListener('click', () => {
    const input = document.getElementById('chat-input');
    if (!input?.disabled && input.value.trim()) sendMessage();
});
