// ============================================================
// LabAI.js — 星球实验室的 AI 建造助手
//
// 用户用自然语言描述想搭建的系统 → AI 只输出 JSON 蓝图 →
// Blueprint.js 校验/计算 → PlanetLab 用确定性代码创建天体。
// AI 不接触场景、物理引擎，也不会执行任何代码。
// ============================================================

import { chatOnce } from '../model-chat/js/api.js?v=2';
import { loadConfig, isConfigured } from '../model-chat/js/config.js?v=2';
import { buildLabBuilderPrompt } from '../model-chat/js/prompts.js?v=2';
import {
    BLUEPRINT_SCHEMA_DOC,
    normalizeBlueprint,
    computeAssembly,
    describeAssembly,
} from './Blueprint.js?v=1';

const EXAMPLES = [
    {
        label: '🌞 双星纠缠',
        text: '两颗类太阳恒星互相绕转，间距 0.4 AU；外围有两颗气态巨行星，轨道半径 4 AU 和 7 AU。',
    },
    {
        label: '✨ 三星系统',
        text: '分层三星系统：内双星相距 0.25 AU，第三颗恒星在 3 AU 处绕它们公转；再放一颗类地行星在 8 AU。',
    },
    {
        label: '🌀 三体八字',
        text: '三颗等质量恒星做经典三体八字舞，整体尺度 1 AU，颜色分别用金色、青色和白色。',
    },
    {
        label: '🪐 类太阳系',
        text: '类似太阳系：一颗太阳，四颗行星分别在 0.4、0.7、1.0、1.5 AU，第三颗是蓝色海洋行星。',
    },
];

function _extractJson(raw) {
    if (typeof raw !== 'string') return null;
    let text = raw.trim();
    if (!text) return null;
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) text = fenced[1].trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
        return JSON.parse(text.slice(start, end + 1));
    } catch {
        return null;
    }
}

/** AI 原始输出 → 已校验的装配结果 */
export function parseBlueprint(raw) {
    const json = _extractJson(raw);
    if (!json) return { ok: false, errors: ['无法从输出中解析出 JSON 对象。'] };

    const normalized = normalizeBlueprint(json);
    if (!normalized.ok) return { ok: false, errors: normalized.errors };

    const assembly = computeAssembly(normalized.blueprint);
    return {
        ok: true,
        assembly,
        blueprint: normalized.blueprint,
        notes: normalized.notes,
    };
}

function _clamp(v, min, max) {
    return Math.min(Math.max(v, min), max);
}

function _fmtNum(n, digits = 2) {
    if (!Number.isFinite(n)) return '0';
    if (Math.abs(n) >= 1e5 || (Math.abs(n) > 0 && Math.abs(n) < 1e-2)) {
        return n.toExponential(2).replace('e+', 'e');
    }
    return n.toFixed(digits);
}

export class LabAI {
    /** @param {import('./PlanetLab.js').PlanetLab} planetLab */
    constructor(planetLab) {
        this.lab = planetLab;
        this._busy = false;
        this._configReady = false;
        this._buildDOM();
        this._bindEvents();
    }

    _buildDOM() {
        const modal = document.createElement('div');
        modal.className = 'pl-ai-modal hidden';
        modal.innerHTML = `
            <div class="pl-ai-backdrop"></div>
            <div class="pl-ai-panel" id="pl-ai-panel">
                <div class="pl-ai-dragbar" id="pl-ai-dragbar" title="拖动窗口"><span class="pl-ai-grip"></span></div>
                <button class="pl-ai-close" id="pl-ai-close" title="关闭">&times;</button>
                <div class="pl-ai-body">
                    <label class="pl-ai-label" for="pl-ai-input">描述你想搭建的星体系统</label>
                    <textarea id="pl-ai-input" class="pl-ai-textarea" rows="4"
                        placeholder="例如：一个双星系统，两颗类太阳恒星相距 0.4 AU，外圈有两颗气态巨行星……"></textarea>

                    <div class="pl-ai-examples" id="pl-ai-examples"></div>

                    <div class="pl-ai-status" id="pl-ai-status">
                        星语会根据描述生成蓝图，再由实验室按物理规则搭建初始轨道。
                    </div>
                    <pre class="pl-ai-preview hidden" id="pl-ai-preview"></pre>
                </div>
                <div class="pl-ai-footer">
                    <button class="pl-ai-cancel" id="pl-ai-cancel">取消</button>
                    <button class="pl-ai-generate" id="pl-ai-generate">✨ 生成并搭建</button>
                </div>
                <div class="pl-ai-resize" id="pl-ai-resize" title="拖动调整窗口大小"></div>
            </div>
        `;
        this.lab.overlay.appendChild(modal);
        this.modal = modal;
        this.panelEl = modal.querySelector('#pl-ai-panel');
        this._geometry = null;
        this.inputEl = modal.querySelector('#pl-ai-input');
        this.statusEl = modal.querySelector('#pl-ai-status');
        this.previewEl = modal.querySelector('#pl-ai-preview');
        this.generateBtn = modal.querySelector('#pl-ai-generate');
        this.examplesEl = modal.querySelector('#pl-ai-examples');

        for (const example of EXAMPLES) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'pl-ai-example';
            btn.textContent = example.label;
            btn.addEventListener('click', () => {
                this.inputEl.value = example.text;
                this.inputEl.focus();
            });
            this.examplesEl.appendChild(btn);
        }
    }

    _bindEvents() {
        this.modal.querySelector('#pl-ai-close').addEventListener('click', () => this.close());
        this.modal.querySelector('#pl-ai-close').addEventListener('pointerdown', (e) => e.stopPropagation());
        this.modal.querySelector('#pl-ai-cancel').addEventListener('click', () => this.close());
        this.modal.querySelector('.pl-ai-backdrop').addEventListener('click', () => this.close());
        this.generateBtn.addEventListener('click', () => this._generate());
        this._bindDragAndResize();

        this.inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                this._generate();
            }
        });
    }

    /** 标题栏拖拽 + 右下角缩放 */
    _bindDragAndResize() {
        const bar = this.modal.querySelector('#pl-ai-dragbar');
        const handle = this.modal.querySelector('#pl-ai-resize');

        // 用 window 级监听跟踪指针，而不是依赖 setPointerCapture：
        // 指针一旦离开标题栏/缩放手柄（尤其是 20px 的手柄），捕获在部分环境失效，
        // 后面的事件会被 backdrop 接走，拖动/缩放就会中途断掉。
        this._onDragMove = (e) => {
            if (!this._dragState) return;
            const dx = e.clientX - this._dragState.x;
            const dy = e.clientY - this._dragState.y;
            const w = this.panelEl.offsetWidth;
            this._geometry.left = _clamp(this._dragState.left + dx, -w + 120, window.innerWidth - 120);
            this._geometry.top = _clamp(this._dragState.top + dy, 0, window.innerHeight - 44);
            this._applyGeometry();
        };
        this._onDragEnd = () => {
            this._dragState = null;
            this.panelEl.classList.remove('dragging');
            window.removeEventListener('pointermove', this._onDragMove);
            window.removeEventListener('pointerup', this._onDragEnd);
            window.removeEventListener('pointercancel', this._onDragEnd);
        };
        this._onResizeMove = (e) => {
            if (!this._resizeState) return;
            const maxW = window.innerWidth - this._geometry.left - 12;
            const maxH = window.innerHeight - this._geometry.top - 12;
            this._geometry.width = _clamp(this._resizeState.width + e.clientX - this._resizeState.x, 420, Math.max(420, maxW));
            this._geometry.height = _clamp(this._resizeState.height + e.clientY - this._resizeState.y, 340, Math.max(340, maxH));
            this._applyGeometry();
        };
        this._onResizeEnd = () => {
            this._resizeState = null;
            this.panelEl.classList.remove('resizing');
            window.removeEventListener('pointermove', this._onResizeMove);
            window.removeEventListener('pointerup', this._onResizeEnd);
            window.removeEventListener('pointercancel', this._onResizeEnd);
        };

        bar.addEventListener('pointerdown', (e) => {
            if (e.button !== undefined && e.button !== 0) return;
            if (e.target.closest('button')) return;
            const rect = this.panelEl.getBoundingClientRect();
            this._dragState = { x: e.clientX, y: e.clientY, left: rect.left, top: rect.top };
            this.panelEl.classList.add('dragging');
            window.addEventListener('pointermove', this._onDragMove);
            window.addEventListener('pointerup', this._onDragEnd);
            window.addEventListener('pointercancel', this._onDragEnd);
            e.preventDefault();
        });

        handle.addEventListener('pointerdown', (e) => {
            if (e.button !== undefined && e.button !== 0) return;
            const rect = this.panelEl.getBoundingClientRect();
            this._resizeState = { x: e.clientX, y: e.clientY, width: rect.width, height: rect.height };
            this.panelEl.classList.add('resizing');
            window.addEventListener('pointermove', this._onResizeMove);
            window.addEventListener('pointerup', this._onResizeEnd);
            window.addEventListener('pointercancel', this._onResizeEnd);
            e.preventDefault();
        });
    }

    _ensureGeometry() {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        if (!this._geometry) {
            const width = Math.min(640, Math.round(vw * 0.86));
            const height = Math.min(580, Math.round(vh * 0.74));
            this._geometry = {
                width,
                height,
                left: Math.round((vw - width) / 2),
                top: Math.round((vh - height) / 2),
            };
        }
        this._applyGeometry();
    }

    _applyGeometry() {
        const g = this._geometry;
        if (!g) return;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        g.width = _clamp(g.width, 420, Math.max(420, vw - 16));
        g.height = _clamp(g.height, 340, Math.max(340, vh - 16));
        g.left = _clamp(g.left, -g.width + 120, Math.max(0, vw - 120));
        g.top = _clamp(g.top, 0, Math.max(0, vh - 44));

        this.panelEl.style.left = `${Math.round(g.left)}px`;
        this.panelEl.style.top = `${Math.round(g.top)}px`;
        this.panelEl.style.width = `${Math.round(g.width)}px`;
        this.panelEl.style.height = `${Math.round(g.height)}px`;
    }

    async open() {
        this.modal.classList.remove('hidden');
        this._ensureGeometry();
        this._setStatus('星语会根据描述生成蓝图，再由实验室按物理规则搭建初始轨道。');
        this.previewEl.classList.add('hidden');
        this.previewEl.textContent = '';
        this.inputEl.focus();

        if (!this._configReady) {
            try {
                await loadConfig();
            } catch (err) {
                console.warn('[LabAI] 配置加载失败:', err);
            }
            this._configReady = true;
        }
        if (!isConfigured()) {
            this._setStatus('⚠ 尚未配置 AI 接口。请打开「星语设置」→「提示词」，在左侧配置 API 或本地模型。', 'error');
        }
    }

    close() {
        if (this._busy) return;
        this.modal.classList.add('hidden');
    }

    /** 实验室整体关闭时强制隐藏（生成请求仍然在后台完成） */
    hide() {
        this.modal.classList.add('hidden');
    }

    _setStatus(text, kind = '') {
        this.statusEl.textContent = text;
        this.statusEl.className = 'pl-ai-status' + (kind ? ' ' + kind : '');
    }

    _setBusy(busy, label) {
        this._busy = busy;
        this.generateBtn.disabled = busy;
        this.generateBtn.textContent = busy ? (label || '◇ 构建中...') : '✨ 生成并搭建';
    }

    async _generate() {
        if (this._busy) return;

        const description = this.inputEl.value.trim();
        if (!description) {
            this._setStatus('请先描述星体系统的样子。', 'error');
            this.inputEl.focus();
            return;
        }
        if (!isConfigured()) {
            this._setStatus('⚠ 尚未配置 AI 接口，无法调用模型。请先在「星语设置」中配置。', 'error');
            return;
        }

        this._setBusy(true);
        this.previewEl.classList.add('hidden');
        this._setStatus('◇ 星语正在设计系统结构...', 'working');

        const systemPrompt = buildLabBuilderPrompt(BLUEPRINT_SCHEMA_DOC);
        const options = { maxTokens: 1800, temperature: 0.4, timeoutMs: 120000 };

        try {
            const firstRaw = await chatOnce(
                [{ role: 'user', content: description }],
                systemPrompt,
                options
            );
            let result = parseBlueprint(firstRaw);

            if (!result.ok) {
                this._setStatus('◇ 蓝图校验未通过，正在让星语修正...', 'working');
                const repairRaw = await chatOnce(
                    [
                        { role: 'user', content: description },
                        { role: 'assistant', content: String(firstRaw || '').slice(0, 3000) },
                        {
                            role: 'user',
                            content: `上一次输出未通过校验：${result.errors.join('；')}。请只输出修正后的 JSON 对象，不要任何解释或代码块标记。`,
                        },
                    ],
                    systemPrompt,
                    options
                );
                result = parseBlueprint(repairRaw);
            }

            if (!result.ok) {
                throw new Error('蓝图校验失败：' + result.errors.join('；'));
            }

            const applied = this.lab.applyBlueprint(result.assembly);
            if (!applied.ok) {
                this._setStatus(applied.reason === 'cancelled' ? '已取消本次搭建。' : '搭建失败。', applied.reason === 'cancelled' ? '' : 'error');
                return;
            }

            this._renderPreview(result.assembly);
            const summary = describeAssembly(result.assembly);
            const notes = result.notes.length ? `\n（已自动修正：${result.notes.slice(0, 3).join('；')}）` : '';
            this._setStatus(`✅ ${result.assembly.name} 搭建完成\n${summary.label}${notes}`, 'ok');
        } catch (err) {
            this._setStatus('⚠ ' + (err?.message || err), 'error');
        } finally {
            this._setBusy(false);
        }
    }

    _renderPreview(assembly) {
        const lines = assembly.bodies.map((body, i) => {
            const distanceAu = Math.hypot(body.position.x, body.position.z) / 1.495978707e11;
            const speedKms = Math.hypot(body.velocity.x, body.velocity.z) / 1000;
            const kind = body.isStar ? '恒星' : '行星';
            return `${String(i + 1).padStart(2, '0')} ${kind} ${body.name}\n` +
                `    质量 ${_fmtNum(body.mass)} kg · 半径 ${_fmtNum(body.radius)} m · ${body.color}\n` +
                `    位置 ${distanceAu.toFixed(3)} AU · 初速 ${speedKms.toFixed(2)} km/s`;
        });
        const header = `${assembly.name}${assembly.description ? ' — ' + assembly.description : ''}\n${'─'.repeat(46)}\n`;
        this.previewEl.textContent = header + lines.join('\n');
        this.previewEl.classList.remove('hidden');
    }
}
