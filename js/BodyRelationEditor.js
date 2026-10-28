// ============================================================
// BodyRelationEditor.js — 星体级关联编辑器
//
// 关联的最小单位是“星体”（恒星/行星），并且是有方向的：
//   主动关联：本系统的星体 → 其它星体（例如 地球 → 新星系/a星）
//   被动关联：其它星体 → 本系统的星体（由上一条自动形成）
// 星系之间、星体系统之间的上层关联由 UniverseView 根据星体所属星系自动推导。
// ============================================================

import { escapeHtml } from './utils.js';
import {
    getAllUniverseSystems,
    loadBodyRelations,
    saveBodyRelation,
    deleteBodyRelation,
    normalizeBodyRelation,
} from './UniverseRegistry.js?v=7';

export class BodyRelationEditor {
    /**
     * @param {object} [deps]
     * @param {function} [deps.onChanged] — (relations) => void，关联变化后回调
     */
    constructor(deps = {}) {
        this.onChanged = deps.onChanged || (() => {});
        this._systems = [];
        this._relations = [];
        this._pendingRelations = []; // 新建系统尚未保存时暂存的关联
        this._draftSystem = null;    // 尚未保存到数据库的星体系统
        this._onDraftChange = () => {};
        this._systemId = null;
        this._isOpen = false;
        this._buildDOM();
        this._bindEvents();
    }

    // ==================== DOM ====================

    _buildDOM() {
        this.overlay = document.createElement('div');
        this.overlay.id = 'body-relation-editor';
        this.overlay.className = 'bre-overlay hidden';
        this.overlay.innerHTML = `
            <div class="bre-backdrop" data-bre-close></div>
            <div class="bre-panel">
                <div class="bre-header">
                    <span class="bre-title">🔗 星体关联</span>
                    <span class="bre-scope" id="bre-scope"></span>
                    <button class="bre-close" data-bre-close title="关闭">✕</button>
                </div>
                <div class="bre-body">
                    <p class="bre-hint">
                        <b>主动关联</b>：本系统的星体指向其它星体；<b>被动关联</b>：其它星体指向本系统的星体。
                        主动方的星体系统固定为当前编辑的系统，只需选择两端的星体。
                        星系之间、星体系统之间的连线会根据星体所属星系自动推导。
                    </p>

                    <div class="bre-form-title">主动关联 · 新建</div>
                    <div class="bre-form">
                        <div class="bre-col">
                            <div class="bre-col-title">星体 A · 主动方
                                <span class="bre-lock">已固定为当前星体系统</span></div>
                            <select class="bre-system" data-side="a" disabled></select>
                            <select class="bre-body-select" data-side="a"></select>
                        </div>
                        <div class="bre-link-icon">→</div>
                        <div class="bre-col">
                            <div class="bre-col-title">星体 B · 被动方</div>
                            <select class="bre-system" data-side="b"></select>
                            <select class="bre-body-select" data-side="b"></select>
                        </div>
                    </div>
                    <div class="bre-form-footer">
                        <button class="bre-add" id="bre-add">＋ 建立主动关联</button>
                        <span class="bre-status" id="bre-status"></span>
                    </div>

                    <div class="bre-list-title">
                        <span>主动关联 <em>本系统 → 其它星体</em></span>
                        <span class="bre-count" id="bre-count-active">0 条</span>
                    </div>
                    <div class="bre-list" id="bre-list-active"></div>

                    <div class="bre-list-title">
                        <span>被动关联 <em>其它星体 → 本系统</em></span>
                        <span class="bre-count" id="bre-count-passive">0 条</span>
                    </div>
                    <div class="bre-list" id="bre-list-passive"></div>
                </div>
                <div class="bre-footer">
                    <span class="bre-footnote">关联数据保存在 Galaxy/universe.db（SQLite，离线时使用 localStorage）。</span>
                    <button class="bre-done" data-bre-close>完成</button>
                </div>
            </div>
        `;
        document.body.appendChild(this.overlay);

        this.listActiveEl = this.overlay.querySelector('#bre-list-active');
        this.listPassiveEl = this.overlay.querySelector('#bre-list-passive');
        this.countActiveEl = this.overlay.querySelector('#bre-count-active');
        this.countPassiveEl = this.overlay.querySelector('#bre-count-passive');
        this.scopeEl = this.overlay.querySelector('#bre-scope');
        this.statusEl = this.overlay.querySelector('#bre-status');
        this.systemSelects = {
            a: this.overlay.querySelector('.bre-system[data-side="a"]'),
            b: this.overlay.querySelector('.bre-system[data-side="b"]'),
        };
        this.bodySelects = {
            a: this.overlay.querySelector('.bre-body-select[data-side="a"]'),
            b: this.overlay.querySelector('.bre-body-select[data-side="b"]'),
        };
    }

    _bindEvents() {
        this.overlay.querySelectorAll('[data-bre-close]').forEach(el => {
            el.addEventListener('click', () => this.close());
        });
        this.overlay.querySelector('#bre-add')?.addEventListener('click', () => this._addRelation());

        // 主动方固定为当前系统，只需要切换被动方的星体系统
        this.systemSelects.b.addEventListener('change', () => this._fillBodies('b'));

        for (const list of [this.listActiveEl, this.listPassiveEl]) {
            list.addEventListener('click', async (e) => {
                const btn = e.target.closest('[data-bre-delete]');
                if (!btn) return;
                const id = btn.dataset.breDelete;
                const isPending = this._pendingRelations.some(r => r.id === id);
                if (!confirm(isPending ? '移除这条尚未保存的关联？' : '删除这条星体关联？')) return;
                if (isPending) {
                    this._pendingRelations = this._pendingRelations.filter(r => r.id !== id);
                    this._onDraftChange(this._pendingRelations);
                    this._renderList();
                    this._setStatus('已移除关联', 'ok');
                    this.onChanged(this._allRelations());
                    return;
                }
                await deleteBodyRelation(id);
                await this._reload();
                this._setStatus('已删除关联', 'ok');
                this.onChanged(this._allRelations());
            });
        }

        document.addEventListener('keydown', (e) => {
            if (!this._isOpen || e.key !== 'Escape') return;
            e.stopPropagation();
            this.close();
        }, true);
    }

    // ==================== 数据 ====================

    /**
     * @param {string|null} systemId — 当前星体系统（主动方固定为它）
     * @param {object} [options]
     * @param {object} [options.draftSystem]     — 尚未保存的新系统（含 planets 列表）
     * @param {Array}  [options.draftRelations]  — 未保存的关联（随系统一起提交）
     * @param {function} [options.onDraftChange] — (relations) => void
     */
    async open(systemId = null, options = {}) {
        const draft = options.draftSystem
            && Array.isArray(options.draftSystem.planets)
            && options.draftSystem.planets.length
            ? options.draftSystem
            : null;
        this._draftSystem = draft;
        this._pendingRelations = Array.isArray(options.draftRelations)
            ? options.draftRelations.map(normalizeBodyRelation).filter(Boolean)
            : [];
        this._onDraftChange = options.onDraftChange || (() => {});

        this._systems = getAllUniverseSystems()
            .filter(s => Array.isArray(s.planets) && s.planets.length && s.status !== 'draft');
        if (draft && !this._systems.some(s => s.id === draft.id)) this._systems.push(draft);
        if (!this._systems.length) {
            alert('暂无可用的星体系统');
            return;
        }

        this._isOpen = true;
        this.overlay.classList.remove('hidden');
        this.overlay.style.zIndex = '1500';
        this._setStatus('', '');

        const defaultA = this._systems.some(s => s.id === systemId)
            ? systemId
            : (draft ? draft.id : this._systems[0].id);
        this._systemId = defaultA;
        // 主动方固定为当前系统，只提供两个星体选择
        this.systemSelects.a.innerHTML = this._systemOptions(
            this._systems.filter(s => s.id === defaultA)
        );
        this.systemSelects.a.value = defaultA;
        this.systemSelects.a.disabled = true;
        this._fillBodies('a');

        // 被动方可以选择任意其它星体系统；尚未保存的新系统不作为被动方
        const bPool = this._systems.filter(s => !draft || s.id !== draft.id);
        this.systemSelects.b.innerHTML = this._systemOptions(bPool);
        const other = bPool.find(s => s.id !== defaultA) || bPool[0] || null;
        if (other) {
            this.systemSelects.b.value = other.id;
            this._fillBodies('b');
        } else {
            this.bodySelects.b.innerHTML = '';
        }

        this._relations = [];
        this._setStatus('关联加载中…', '');
        this.listActiveEl.innerHTML = '<div class="bre-empty">关联加载中…</div>';
        this.listPassiveEl.innerHTML = '<div class="bre-empty">关联加载中…</div>';
        try {
            this._relations = await loadBodyRelations();
        } catch {
            this._relations = [];
        }
        if (!this._isOpen) return;
        this._setStatus('', '');
        this._renderList();
    }

    close() {
        if (!this._isOpen) return;
        this._isOpen = false;
        this.overlay.classList.add('hidden');
        this.onChanged(this._allRelations());
    }

    _allRelations() {
        return [...this._pendingRelations, ...this._relations];
    }

    _systemOptions(pool = this._systems) {
        return pool.map(s => `
            <option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}${s.isBuiltIn ? ' · 内置' : ''}${s.isDraft ? ' · 草稿' : (s === this._draftSystem ? ' · 未保存' : '')}</option>
        `).join('');
    }

    _fillBodies(side) {
        const systemId = this.systemSelects[side].value;
        const system = this._systems.find(s => s.id === systemId);
        const select = this.bodySelects[side];
        if (!system) {
            select.innerHTML = '';
            return;
        }
        select.innerHTML = (system.planets || []).map(p => `
            <option value="${escapeHtml(p.key)}">${p.isStar ? '★ ' : ''}${escapeHtml(p.name)}</option>
        `).join('');
        // 默认选第一颗非恒星行星，没有则选恒星
        const planet = (system.planets || []).find(p => !p.isStar);
        if (planet) select.value = planet.key;
        else if (system.planets?.[0]) select.value = system.planets[0].key;
    }

    async _addRelation() {
        const fromSys = this._systems.find(s => s.id === this.systemSelects.a.value);
        const toSys = this._systems.find(s => s.id === this.systemSelects.b.value);
        const fromKey = this.bodySelects.a.value;
        const toKey = this.bodySelects.b.value;
        if (!fromSys || !toSys || !fromKey || !toKey) {
            this._setStatus('请选择两个星体', 'warn');
            return;
        }
        if (fromSys.id === toSys.id && fromKey === toKey) {
            this._setStatus('不能关联到同一个星体', 'warn');
            return;
        }
        const fromBody = fromSys.planets.find(p => p.key === fromKey);
        const toBody = toSys.planets.find(p => p.key === toKey);
        if (!fromBody || !toBody) {
            this._setStatus('星体不存在，请重新选择', 'warn');
            return;
        }

        // 新建系统尚未保存：关联先记在内存里，保存系统时一起提交
        if (this._draftSystem
            && (fromSys.id === this._draftSystem.id || toSys.id === this._draftSystem.id)) {
            const rel = normalizeBodyRelation({
                fromSystemId: fromSys.id,
                fromKey,
                fromName: fromBody.name,
                toSystemId: toSys.id,
                toKey,
                toName: toBody.name,
                updatedAt: Date.now(),
            });
            if (!rel) {
                this._setStatus('关联数据不完整', 'warn');
                return;
            }
            if (this._pendingRelations.some(r => r.id === rel.id)) {
                this._setStatus('这条关联已存在', 'warn');
                return;
            }
            this._pendingRelations.unshift(rel);
            this._onDraftChange(this._pendingRelations);
            this._renderList();
            this._setStatus(
                `已添加关联：${fromBody.name} → ${toBody.name}（保存星体系统后生效）`,
                'ok'
            );
            this.onChanged(this._allRelations());
            return;
        }

        const before = this._relations.length;
        const result = await saveBodyRelation({
            fromSystemId: fromSys.id,
            fromKey,
            fromName: fromBody.name,
            toSystemId: toSys.id,
            toKey,
            toName: toBody.name,
        });
        if (!result.ok) {
            this._setStatus(result.error || '保存失败', 'warn');
            return;
        }
        this._systemId = fromSys.id;
        await this._reload();
        const added = this._relations.length !== before;
        this._setStatus(
            added
                ? `已建立主动关联：${fromBody.name} → ${toBody.name}`
                : '这条关联已存在',
            added ? 'ok' : 'warn'
        );
        this.onChanged(this._allRelations());
    }

    async _reload() {
        this._relations = await loadBodyRelations();
        this._renderList();
    }

    _renderList() {
        const systemById = new Map(this._systems.map(s => [s.id, s]));
        const selfSystem = systemById.get(this._systemId);
        const draftName = selfSystem && this._draftSystem && selfSystem.id === this._draftSystem.id
            ? (selfSystem.isDraft ? ' · 草稿' : ' · 未保存')
            : '';
        this.scopeEl.textContent = selfSystem ? `当前：${selfSystem.name}${draftName}` : '';

        const relations = this._allRelations();
        const active = relations.filter(r => r.fromSystemId === this._systemId);
        const passive = relations.filter(r => r.toSystemId === this._systemId);

        this.countActiveEl.textContent = `${active.length} 条`;
        this.countPassiveEl.textContent = `${passive.length} 条`;
        this.listActiveEl.innerHTML = active.length
            ? active.map(rel => this._rowHtml(rel, systemById, false)).join('')
            : '<div class="bre-empty">尚未建立主动关联</div>';
        this.listPassiveEl.innerHTML = passive.length
            ? passive.map(rel => this._rowHtml(rel, systemById, true)).join('')
            : '<div class="bre-empty">还没有其它星体指向本系统</div>';
    }

    _rowHtml(rel, systemById, passive) {
        const fromSys = systemById.get(rel.fromSystemId);
        const toSys = systemById.get(rel.toSystemId);
        const fromLabel = `${escapeHtml(rel.fromName || rel.fromKey)}<em>${escapeHtml(fromSys?.name || rel.fromSystemId)}</em>`;
        const toLabel = `${escapeHtml(rel.toName || rel.toKey)}<em>${escapeHtml(toSys?.name || rel.toSystemId)}</em>`;
        const missing = (!fromSys || !toSys) ? '<span class="bre-missing">已失效</span>' : '';
        const pending = this._pendingRelations.some(r => r.id === rel.id)
            ? '<span class="bre-pending">待保存</span>'
            : '';
        return `
            <div class="bre-row ${passive ? 'is-passive' : 'is-active'}">
                <span class="bre-end">${fromLabel}</span>
                <span class="bre-arrow">→</span>
                <span class="bre-end">${toLabel}</span>
                ${pending}${missing}
                <button class="bre-delete" data-bre-delete="${escapeHtml(rel.id)}" title="删除这条关联">删除</button>
            </div>
        `;
    }

    _setStatus(text, kind) {
        if (!this.statusEl) return;
        this.statusEl.textContent = text || '';
        this.statusEl.className = 'bre-status' + (kind ? ' is-' + kind : '');
    }
}
