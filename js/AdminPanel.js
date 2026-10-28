// ============================================================
// AdminPanel.js — 网站管理（开发者 / 管理员）
//
// 开发者：用户管理、内容审核、星体系统编辑/删除、星系管理、
//         星系资格发布、背景音乐管理。
// 管理员：用户管理（封禁）、删除任意星体系统、直接添加星系 /
//         发布星系资格；不能修改星体系统、不能删除星系。
// ============================================================

import { showToast } from './toast.js?v=1';
import {
    getCurrentUser, refreshSession, isDeveloper, isStaff, isAdmin,
    apiPost, roleLabel, roleIcon, escapeHtml,
} from './session.js?v=1';
import { formatTime } from './utils.js';
import {
    DEFAULT_GALAXY_ID, DEFAULT_GALAXY_ICON, makeGalaxyId, saveUniverseGalaxy, deleteUniverseGalaxy,
} from './UniverseRegistry.js?v=7';
import {
    ensureSeenAt, scopeHasNew, markSeenFromItems, isNewSince,
} from './activity.js?v=2';

const STATUS_META = {
    approved: { label: '已通过', cls: 'is-approved' },
    pending: { label: '审核中', cls: 'is-pending' },
    rejected: { label: '未通过', cls: 'is-rejected' },
};

/** 系统最近一次“发生变化”的时间（提交 / 编辑 / 审核） */
function systemTs(sys) {
    return Number(sys?.submittedAt) || Number(sys?.updatedAt) || Number(sys?.reviewedAt) || 0;
}

/** 新成员提醒按星系分别记录 */
function memberScope(galaxyId) {
    return `galaxy-members:${galaxyId}`;
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
        reader.onerror = () => reject(new Error('文件读取失败'));
        reader.readAsDataURL(file);
    });
}

export class AdminPanel {
    /**
     * @param {object} deps
     * @param {function} [deps.onEditSystem]      — (systemId) => void
     * @param {function} [deps.onDeleteSystem]    — (systemId) => Promise
     * @param {function} [deps.onRefreshWorld]    — 数据变更后刷新主界面 / 宇宙视图
     * @param {function} [deps.onBgmChanged]      — 背景音乐上传 / 删除后同步播放器
     * @param {function} [deps.onOpenBgmPlayer]   — 打开背景音乐播放器弹窗
     */
    constructor(deps = {}) {
        this.onEditSystem = deps.onEditSystem || (() => {});
        this.onDeleteSystem = deps.onDeleteSystem || (async () => ({ ok: false }));
        this.onRefreshWorld = deps.onRefreshWorld || (() => {});
        this.onBgmChanged = deps.onBgmChanged || (() => {});
        this.onOpenBgmPlayer = deps.onOpenBgmPlayer || (() => {});

        this._tab = 'users';
        this._users = [];
        this._systems = [];
        this._galaxies = [];
        this._offers = [];
        this._bgm = [];
        this._statusFilter = 'all';
        this._userQuery = '';
        this._galaxyQuery = '';
        this._loading = false;
        this._commanderMode = false;
        this._manageGalaxy = null;
        this._members = [];
        this._membersLoading = false;
        this._manageEditing = false;

        // 新内容标记（本次会话内保持“新”标签；红点随“已查看”时间戳消失）
        this._newUserIds = new Set();
        this._newSystemIds = new Set();
        this._newGalaxyIds = new Set();
        this._newOfferIds = new Set();
        this._newMemberIds = new Set();
        this._memberMap = new Map();

        this._buildDOM();
        this._bindEvents();
    }

    // ==================== DOM ====================

    _buildDOM() {
        this.overlay = document.createElement('div');
        this.overlay.id = 'admin-panel-overlay';
        this.overlay.className = 'ap-overlay hidden';
        this.overlay.innerHTML = `
            <div class="ap-backdrop" data-ap-action="close"></div>
            <div class="ap-panel" role="dialog" aria-label="网站管理">
                <div class="ap-header">
                    <span class="ap-header-title" id="ap-header-title">🛠 网站管理</span>
                    <div class="ap-header-actions">
                        <div class="ap-add-wrap">
                            <button type="button" class="ap-add-btn" id="ap-add-menu-btn"
                                    data-ap-action="toggle-add-menu">＋ 添加星系 ▾</button>
                            <div class="ap-add-menu hidden" id="ap-add-menu">
                                <button type="button" data-ap-action="add-mode" data-mode="offer">🎫 发布星系资格</button>
                                <button type="button" data-ap-action="add-mode" data-mode="direct">🌌 直接添加星系</button>
                            </div>
                        </div>
                        <button type="button" class="ap-close" data-ap-action="close" title="关闭">✕</button>
                    </div>
                </div>
                <div class="ap-body" id="ap-body">
                    <div class="ap-loading">加载中…</div>
                </div>
            </div>

            <div class="ap-modal hidden" id="ap-modal">
                <div class="ap-modal-backdrop" data-ap-action="modal-close"></div>
                <div class="ap-modal-panel">
                    <div class="ap-modal-header">
                        <span id="ap-modal-title">添加星系</span>
                        <button type="button" class="ap-close" data-ap-action="modal-close">✕</button>
                    </div>
                    <div class="ap-modal-body" id="ap-modal-body"></div>
                </div>
            </div>
        `;
        document.body.appendChild(this.overlay);
        this.bodyEl = this.overlay.querySelector('#ap-body');
        this.addMenuEl = this.overlay.querySelector('#ap-add-menu');
        this.addWrapEl = this.overlay.querySelector('.ap-add-wrap');
        this.headerTitleEl = this.overlay.querySelector('#ap-header-title');
        this.modalEl = this.overlay.querySelector('#ap-modal');
        this.modalBodyEl = this.overlay.querySelector('#ap-modal-body');
        this.modalTitleEl = this.overlay.querySelector('#ap-modal-title');
    }

    _bindEvents() {
        this.overlay.addEventListener('click', (e) => {
            const target = e.target.closest('[data-ap-action]');
            if (!target) {
                if (!e.target.closest('.ap-add-wrap')) this.addMenuEl?.classList.add('hidden');
                return;
            }
            this._onAction(target.dataset.apAction, target.dataset, e);
        });
        this.overlay.addEventListener('submit', (e) => {
            e.preventDefault();
            const form = e.target.closest('form[data-ap-form]');
            if (form) this._onForm(form.dataset.apForm, new FormData(form));
        });
        this.overlay.addEventListener('change', (e) => {
            if (e.target.matches('#ap-status-filter')) {
                this._statusFilter = e.target.value || 'all';
                this._render();
            }
        });
        // 用户管理 / 星系管理的即时搜索（原地过滤，避免重绘打断输入）
        this.overlay.addEventListener('input', (e) => {
            if (e.target.matches('#ap-user-search')) {
                this._userQuery = e.target.value;
                this._filterRows('.ap-user-row', '#ap-filter-empty-users', this._userQuery);
            } else if (e.target.matches('#ap-galaxy-search')) {
                this._galaxyQuery = e.target.value;
                this._filterRows('.ap-galaxy-row', '#ap-filter-empty-galaxies', this._galaxyQuery);
            }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isVisible()) {
                if (!this.modalEl.classList.contains('hidden')) {
                    this.modalEl.classList.add('hidden');
                } else {
                    this.close();
                }
            }
        });
    }

    isVisible() {
        return !this.overlay.classList.contains('hidden');
    }

    /**
     * 打开管理窗口。
     * 职员（开发者 / 管理员）看到完整网站管理；仅有指挥官身份的公民只看到
     * “星系管理”，并且只列出自己担任指挥官的星系。
     */
    async open(tab, options = {}) {
        const staff = isStaff();
        const commanded = getCurrentUser()?.commandedGalaxies || [];
        if (!staff && !commanded.length) {
            showToast('只有开发者 / 管理员 / 星系指挥官可以进入', 'error');
            return;
        }
        this._commanderMode = !staff;
        this._tab = this._commanderMode ? 'galaxies' : (tab || 'users');
        this.overlay.classList.remove('hidden');
        this.addMenuEl?.classList.add('hidden');
        this.addWrapEl?.classList.toggle('hidden', this._commanderMode);
        this.headerTitleEl.textContent = this._commanderMode ? '🛰 星系管理' : '🛠 网站管理';
        this._render();
        await this.refresh();
        if (options.galaxyId) await this.openGalaxyManage(options.galaxyId);
    }

    /** 指挥官入口：直接打开自己的星系管理列表 */
    openCommander() {
        return this.open('galaxies');
    }

    /** 从个人中心 / 宇宙视图直接打开某个星系的管理弹窗 */
    async openGalaxyManage(galaxyId) {
        if (!galaxyId) return;
        if (!this.isVisible()) {
            await this.open('galaxies');
        }
        if (!this.isVisible()) return;
        let galaxy = this._galaxies.find(g => g.id === galaxyId);
        if (!galaxy) {
            await this.refresh();
            galaxy = this._galaxies.find(g => g.id === galaxyId);
        }
        if (!galaxy) { showToast('星系不存在或已被删除', 'error'); return; }
        this._tab = 'galaxies';
        this._render();
        await this._showGalaxyManage(galaxy);
    }

    close() {
        this.overlay.classList.add('hidden');
        this.modalEl?.classList.add('hidden');
        this.addMenuEl?.classList.add('hidden');
        this._manageGalaxy = null;
        this._members = [];
        this._manageEditing = false;
    }

    // ==================== 数据 ====================

    async refresh() {
        if (this._loading) return;
        this._loading = true;
        try {
            const staff = isStaff();
            const [galaxiesRes, systemsRes, offersRes, usersRes, bgmRes] = await Promise.all([
                apiPost('/api/list-universe-galaxies', {}),
                staff ? apiPost('/api/admin/systems', {}) : null,
                staff ? apiPost('/api/offers/list', { includeInactive: true }) : null,
                staff ? apiPost('/api/admin/users', {}) : null,
                isDeveloper() ? apiPost('/api/admin/list-bgm', {}) : null,
                staff ? null : this._loadCommanderMembers(),
            ]);
            this._systems = systemsRes?.galaxies || [];
            this._galaxies = galaxiesRes?.galaxies || [];
            this._offers = offersRes?.offers || [];
            this._users = usersRes?.users || this._users;
            this._bgm = bgmRes?.files || this._bgm;
            this._collectNewItems();
        } finally {
            this._loading = false;
            if (this.isVisible()) this._render();
        }
    }

    /** 指挥官模式：拉取自己星系的成员，用来判断“有新成员加入” */
    async _loadCommanderMembers() {
        const commanded = getCurrentUser()?.commandedGalaxies || [];
        const results = await Promise.all(commanded.map(async (g) => {
            const res = await apiPost('/api/galaxy/members', { galaxyId: g.id });
            return { galaxyId: g.id, members: res?.members || [] };
        }));
        this._memberMap = new Map(results.map(r => [r.galaxyId, r.members]));
    }

    /** 记录本次会话里“新”的条目 id（标记集合只增不减） */
    _collectNewItems() {
        const user = getCurrentUser();
        if (!user?.id) return;
        const userSeen = ensureSeenAt(user.id, 'admin:users', this._users, (u) => u.createdAt);
        const systemSeen = ensureSeenAt(user.id, 'admin:systems', this._systems, systemTs);
        const galaxySeen = ensureSeenAt(user.id, 'admin:galaxies', this._galaxies, (g) => g.createdAt);
        const offerSeen = ensureSeenAt(user.id, 'admin:offers', this._offers, (o) => o.createdAt);
        for (const u of this._users) if (isNewSince(userSeen, u.createdAt)) this._newUserIds.add(u.id);
        for (const s of this._systems) if (isNewSince(systemSeen, systemTs(s))) this._newSystemIds.add(s.id);
        for (const g of this._galaxies) if (isNewSince(galaxySeen, g.createdAt)) this._newGalaxyIds.add(g.id);
        for (const o of this._offers) if (isNewSince(offerSeen, o.createdAt)) this._newOfferIds.add(o.id);
    }

    /** 该标签页是否有尚未查看的变化（用于红点） */
    _tabHasNew(tab) {
        const userId = getCurrentUser()?.id;
        if (!userId) return false;
        if (tab === 'users') return scopeHasNew(userId, 'admin:users', this._users, (u) => u.createdAt);
        if (tab === 'systems') return scopeHasNew(userId, 'admin:systems', this._systems, systemTs);
        if (tab === 'galaxies') {
            if (scopeHasNew(userId, 'admin:galaxies', this._galaxies, (g) => g.createdAt)) return true;
            for (const [galaxyId, members] of this._memberMap) {
                if (scopeHasNew(userId, memberScope(galaxyId), members, (m) => m.joinedAt)) return true;
            }
            return false;
        }
        if (tab === 'offers') return scopeHasNew(userId, 'admin:offers', this._offers, (o) => o.createdAt);
        return false;
    }

    /** 正在看的标签页视为已查看：红点消失，列表里的“新”标签保留 */
    _markTabSeen(tab) {
        const user = getCurrentUser();
        if (!user?.id) return;
        if (tab === 'users') {
            markSeenFromItems(user.id, 'admin:users', this._users, (u) => u.createdAt);
        } else if (tab === 'systems') {
            markSeenFromItems(user.id, 'admin:systems', this._systems, systemTs);
        } else if (tab === 'galaxies') {
            markSeenFromItems(user.id, 'admin:galaxies', this._galaxies, (g) => g.createdAt);
            for (const [galaxyId, members] of this._memberMap) {
                markSeenFromItems(user.id, memberScope(galaxyId), members, (m) => m.joinedAt);
            }
        } else if (tab === 'offers') {
            markSeenFromItems(user.id, 'admin:offers', this._offers, (o) => o.createdAt);
        }
    }

    // ==================== 渲染 ====================

    _tabs() {
        const pending = this._systems.filter(s => s.status === 'pending').length;
        if (this._commanderMode) {
            return [{ key: 'galaxies', label: '星系管理', count: 0, hasNew: this._tabHasNew('galaxies') }];
        }
        const list = [
            { key: 'users', label: '👥 用户管理', count: 0, hasNew: this._tabHasNew('users') },
            { key: 'systems', label: '内容管理', count: pending, hasNew: this._tabHasNew('systems') },
            { key: 'galaxies', label: '星系管理', count: 0, hasNew: this._tabHasNew('galaxies') },
            { key: 'offers', label: '🎫 星系资格', count: 0, hasNew: this._tabHasNew('offers') },
        ];
        if (isDeveloper()) list.push({ key: 'bgm', label: '🎵 背景音乐', count: 0, hasNew: false });
        return list;
    }

    _render() {
        if (!isStaff() && !this._commanderMode) {
            this.bodyEl.innerHTML = '<div class="ap-empty">没有访问权限。</div>';
            return;
        }
        const tabs = this._tabs();
        if (!tabs.some(t => t.key === this._tab)) this._tab = tabs[0].key;

        const tabBtns = tabs.map((t) => `
            <button type="button" class="ap-tab${this._tab === t.key ? ' is-active' : ''}"
                    data-ap-action="tab" data-tab="${t.key}">${t.label}${t.count
                        ? `<span class="ap-tab-count">${t.count}</span>` : ''}${t.hasNew && this._tab !== t.key
                        ? '<span class="ap-tab-dot" title="有新内容"></span>' : ''}</button>
        `).join('');

        let content = '';
        switch (this._tab) {
            case 'systems': content = this._renderSystems(); break;
            case 'galaxies': content = this._renderGalaxies(); break;
            case 'offers': content = this._renderOffers(); break;
            case 'bgm': content = this._renderBgm(); break;
            default: content = this._renderUsers();
        }

        this.bodyEl.innerHTML = `
            ${tabs.length > 1 ? `<aside class="ap-sidebar">${tabBtns}</aside>` : ''}
            <section class="ap-content">${content}</section>
        `;
        if (this._tab === 'bgm') this._bindBgmUpload();
        // 重新渲染后恢复搜索框的过滤状态
        if (this._tab === 'users') this._filterRows('.ap-user-row', '#ap-filter-empty-users', this._userQuery);
        if (this._tab === 'galaxies') this._filterRows('.ap-galaxy-row', '#ap-filter-empty-galaxies', this._galaxyQuery);
        this._markTabSeen(this._tab);
    }

    /** 按关键词隐藏不匹配的行；关键词无命中的时候显示空状态 */
    _filterRows(rowSelector, emptySelector, query) {
        const q = String(query || '').trim().toLowerCase();
        let visible = 0;
        this.bodyEl.querySelectorAll(rowSelector).forEach((row) => {
            const show = !q || (row.dataset.search || '').includes(q);
            row.classList.toggle('hidden', !show);
            if (show) visible++;
        });
        const empty = this.bodyEl.querySelector(emptySelector);
        empty?.classList.toggle('hidden', !(q && visible === 0));
    }

    _renderUsers() {
        const me = getCurrentUser();
        const canRole = isDeveloper();
        const canAppoint = isDeveloper();
        const galaxyOptions = this._galaxies.map(g =>
            `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`
        ).join('');
        const rows = this._users.map((u) => {
            const isSelf = u.id === me?.id;
            const isDev = u.role === 'developer';
            const isNew = this._newUserIds.has(u.id);
            const commandedList = u.commandedGalaxies || [];
            const commanded = commandedList.map(g => g.name).join('、');
            const commanderTags = commandedList.map(g => `
                <span class="ap-commander-tag" title="该用户担任此星系的指挥官">
                    👑 ${escapeHtml(g.name)}
                    ${!isSelf ? `<button type="button" data-ap-action="revoke-commander"
                            data-id="${u.id}" data-galaxy-id="${escapeHtml(g.id)}" title="撤销指挥官">✕</button>` : ''}
                </span>`).join('');
            const searchText = [
                u.displayName || '', u.username || '', roleLabel(u.role),
                commandedList.map(g => g.name).join(' '),
                u.banned ? '已封禁' : '',
            ].join(' ').toLowerCase();
            return `
                <div class="ap-row ap-user-row" data-search="${escapeHtml(searchText)}">
                    <div class="ap-user-main">
                        <span class="ap-user-name">${roleIcon(u.role)} ${escapeHtml(u.displayName || u.username)}
                            <small>@${escapeHtml(u.username)}</small></span>
                        ${isNew ? '<span class="ap-new-tag">新</span>' : ''}
                        <span class="ap-role-badge">${roleLabel(u.role)}</span>
                        ${u.banned ? '<span class="ap-status is-rejected">已封禁</span>' : ''}
                    </div>
                    <div class="ap-user-meta">
                        加入：${formatTime(u.createdAt)}
                        ${commanded ? ` · 指挥官：${escapeHtml(commanded)}` : ''}
                    </div>
                    ${canAppoint && !isSelf ? `
                        <div class="ap-user-commander">
                            <span class="ap-user-commander-label">星系指挥官</span>
                            ${commanderTags || '<span class="ap-user-commander-none">未担任任何星系指挥官</span>'}
                            ${!isDev ? `
                                <select class="ap-select ap-user-commander-select" data-user-id="${u.id}">
                                    <option value="">任命为指挥官…</option>
                                    ${galaxyOptions}
                                </select>
                                <button type="button" class="ap-small-btn" data-ap-action="set-commander-user"
                                        data-id="${u.id}">任命</button>` : ''}
                        </div>` : ''}
                    <div class="ap-row-actions">
                        ${canRole && !isSelf && !isDev ? `
                            <button type="button" class="ap-small-btn" data-ap-action="set-role"
                                    data-id="${u.id}" data-role="${u.role === 'admin' ? 'citizen' : 'admin'}">
                                ${u.role === 'admin' ? '撤销管理员' : '设为管理员'}
                            </button>` : ''}
                        ${!isSelf && !isDev ? `
                            <button type="button" class="ap-small-btn${u.banned ? '' : ' is-danger'}"
                                    data-ap-action="set-banned" data-id="${u.id}" data-banned="${u.banned ? '0' : '1'}">
                                ${u.banned ? '解封' : '封禁'}
                            </button>` : ''}
                        ${isDeveloper() && !isSelf && !isDev ? `
                            <button type="button" class="ap-small-btn is-danger"
                                    data-ap-action="delete-user" data-id="${u.id}">删除账号</button>` : ''}
                    </div>
                </div>
            `;
        }).join('');
        return `
            <div class="ap-section">
                <div class="ap-section-head">
                    <h3 class="ap-section-title">用户管理 · ${this._users.length}</h3>
                    <input type="search" id="ap-user-search" class="ap-search-input"
                           placeholder="🔍 搜索用户名 / 昵称 / 角色 / 指挥官…"
                           value="${escapeHtml(this._userQuery)}" autocomplete="off" />
                </div>
                <p class="ap-hint">开发者可任命 / 撤销管理员，并在每一位用户上任命或撤销星系指挥官；管理员与开发者都可以封禁普通用户。</p>
                ${rows || '<div class="ap-empty">暂无用户。</div>'}
                <div class="ap-empty ap-filter-empty hidden" id="ap-filter-empty-users">没有匹配的用户。</div>
            </div>
        `;
    }

    _renderSystems() {
        const filters = [
            ['all', '全部'], ['pending', '审核中'], ['rejected', '未通过'], ['approved', '已通过'],
        ];
        const list = this._statusFilter === 'all'
            ? this._systems
            : this._systems.filter(s => (s.status || 'approved') === this._statusFilter);
        const dev = isDeveloper();

        const rows = list.map((s) => {
            const meta = STATUS_META[s.status] || STATUS_META.approved;
            const isNew = this._newSystemIds.has(s.id);
            return `
                <div class="ap-row ap-system-row">
                    <div class="ap-system-main">
                        <span class="ap-system-name">${escapeHtml(s.name || s.id)}
                            <small>${escapeHtml(s.nameCN || s.id)}</small></span>
                        ${isNew ? '<span class="ap-new-tag">新</span>' : ''}
                        <span class="ap-status ${meta.cls}">${meta.label}</span>
                    </div>
                    <div class="ap-system-meta">
                        作者：${escapeHtml(s.ownerName || '未认领')} ·
                        所属：${escapeHtml(s.universeGalaxyId || DEFAULT_GALAXY_ID)} ·
                        ${formatTime(s.submittedAt || s.updatedAt)}
                        ${s.reviewNote ? `<div class="ap-review-note">审核意见：${escapeHtml(s.reviewNote)}</div>` : ''}
                    </div>
                    <div class="ap-row-actions">
                        ${dev && (s.status === 'pending' || s.status === 'rejected') ? `
                            <button type="button" class="ap-small-btn is-ok" data-ap-action="review"
                                    data-id="${escapeHtml(s.id)}" data-decision="approve">通过</button>
                            <button type="button" class="ap-small-btn is-danger" data-ap-action="review"
                                    data-id="${escapeHtml(s.id)}" data-decision="reject">驳回</button>` : ''}
                        ${dev ? `
                            <button type="button" class="ap-small-btn" data-ap-action="edit-system"
                                    data-id="${escapeHtml(s.id)}">✎ 编辑</button>` : ''}
                        <button type="button" class="ap-small-btn is-danger" data-ap-action="delete-system"
                                data-id="${escapeHtml(s.id)}">✕ 删除</button>
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div class="ap-section">
                <div class="ap-section-head">
                    <h3 class="ap-section-title">内容管理 · ${list.length}</h3>
                    <select id="ap-status-filter" class="ap-select">
                        ${filters.map(([v, label]) => `<option value="${v}"${this._statusFilter === v ? ' selected' : ''}>${label}</option>`).join('')}
                    </select>
                </div>
                <p class="ap-hint">${dev
                    ? '开发者可审核、修改和删除所有公民发布的星体系统。驳回时可填写审核意见。'
                    : '管理员可以删除任意星系中的星体系统，但不能修改它们。'}</p>
                ${rows || '<div class="ap-empty">没有符合条件的星体系统。</div>'}
            </div>
        `;
    }

    _renderGalaxies() {
        const dev = isDeveloper();
        const staff = isStaff();
        const user = getCurrentUser();
        const list = staff
            ? this._galaxies
            : this._galaxies.filter(g => g.commanderUserId === user?.id);
        const rows = list.map((g) => {
            const isDefault = g.id === DEFAULT_GALAXY_ID || g.isDefault;
            const isNew = this._newGalaxyIds.has(g.id);
            const commanderId = g.commanderUserId || '';
            const canManage = dev || (user && commanderId === user.id);
            const membersNew = !!user?.id
                && scopeHasNew(user.id, memberScope(g.id), this._memberMap.get(g.id) || [], (m) => m.joinedAt);
            const searchText = [
                g.name || '', g.nameCN || '', g.id || '',
                g.commanderName || (commanderId ? '' : '未任命'),
                commanderId === user?.id ? '我是指挥官' : '',
            ].join(' ').toLowerCase();
            return `
                <div class="ap-row ap-galaxy-row" data-search="${escapeHtml(searchText)}">
                    <div class="ap-galaxy-main">
                        <span class="ap-galaxy-name">${escapeHtml(g.name)}
                            <small>${escapeHtml(g.nameCN || g.id)}</small></span>
                        ${isNew ? '<span class="ap-new-tag">新</span>' : ''}
                        ${membersNew ? '<span class="ap-new-tag is-member">新成员</span>' : ''}
                        <span class="ap-galaxy-meta">${Number(g.memberCount) || 0} 位公民 ·
                            指挥官：${escapeHtml(g.commanderName || '未任命')}
                            ${commanderId === user?.id ? '<span class="ap-status is-approved">我是指挥官</span>' : ''}</span>
                    </div>
                    <div class="ap-row-actions">
                        ${canManage ? `
                            <button type="button" class="ap-small-btn" data-ap-action="manage-galaxy"
                                    data-id="${escapeHtml(g.id)}">⚙ 编辑信息 / 成员</button>` : ''}
                        ${dev && !isDefault ? `
                            <button type="button" class="ap-small-btn is-danger" data-ap-action="delete-galaxy"
                                    data-id="${escapeHtml(g.id)}">删除星系</button>` : ''}
                        ${dev && isDefault ? '<span class="ap-locked">默认星系（不可删除）</span>' : ''}
                        ${!dev && staff ? '<span class="ap-hint-inline">仅开发者可以删除</span>' : ''}
                    </div>
                </div>
            `;
        }).join('');
        return `
            <div class="ap-section">
                <div class="ap-section-head">
                    <h3 class="ap-section-title">星系管理 · ${list.length}</h3>
                    <input type="search" id="ap-galaxy-search" class="ap-search-input"
                           placeholder="🔍 搜索星系 / 指挥官…"
                           value="${escapeHtml(this._galaxyQuery)}" autocomplete="off" />
                </div>
                <p class="ap-hint">${dev
                    ? '可编辑星系信息与成员、删除星系；指挥官的任命与撤销请到「用户管理」。删除星系后，其中的星体系统会自动归入默认星系。'
                    : (staff
                        ? '管理员可以查看星系与指挥官信息，但不能编辑 / 删除星系。'
                        : '你可以编辑自己担任指挥官的星系信息，并管理（移出）星系成员。')}</p>
                ${rows || '<div class="ap-empty">暂无星系。</div>'}
                <div class="ap-empty ap-filter-empty hidden" id="ap-filter-empty-galaxies">没有匹配的星系。</div>
            </div>
        `;
    }

    _renderOffers() {
        const rows = this._offers.map((o) => `
            <div class="ap-row ap-offer-row">
                <div class="ap-offer-main">
                    <span class="ap-offer-name">${escapeHtml(o.name)} <small>${escapeHtml(o.nameCN || '')}</small>
                        ${this._newOfferIds.has(o.id) ? '<span class="ap-new-tag">新</span>' : ''}</span>
                    <span class="ap-offer-meta">
                        剩余 ${Number(o.remaining) || 0} / ${Number(o.quantity) || 0} ·
                        发布者：${escapeHtml(o.creatorName || '—')} ·
                        ${formatTime(o.createdAt)}
                    </span>
                    ${o.description ? `<div class="ap-offer-desc">${escapeHtml(o.description)}</div>` : ''}
                </div>
                <div class="ap-row-actions">
                    ${o.active && Number(o.remaining) > 0
                        ? `<button type="button" class="ap-small-btn is-danger" data-ap-action="cancel-offer"
                                   data-id="${escapeHtml(o.id)}">下架资格</button>`
                        : '<span class="ap-status is-rejected">已结束</span>'}
                    <button type="button" class="ap-small-btn" data-ap-action="add-mode" data-mode="offer">＋ 再发布</button>
                </div>
            </div>
        `).join('');
        return `
            <div class="ap-section">
                <div class="ap-section-head">
                    <h3 class="ap-section-title">星系资格 · ${this._offers.length}</h3>
                    <button type="button" class="ap-add-btn" data-ap-action="add-mode" data-mode="offer">🎫 发布资格</button>
                </div>
                <p class="ap-hint">发布后，所有星际公民都会收到“新消息”通知，可在个人中心抢夺资格并成为该星系指挥官。</p>
                ${rows || '<div class="ap-empty">还没有发布过星系资格。</div>'}
            </div>
        `;
    }

    _renderBgm() {
        const rows = this._bgm.map((name) => `
            <div class="ap-row ap-bgm-row">
                <span class="ap-bgm-name">🎵 ${escapeHtml(name)}</span>
                <button type="button" class="ap-small-btn is-danger" data-ap-action="delete-bgm"
                        data-name="${escapeHtml(name)}">删除</button>
            </div>
        `).join('');
        return `
            <div class="ap-section">
                <div class="ap-section-head">
                    <h3 class="ap-section-title">背景音乐 · ${this._bgm.length}</h3>
                    <div class="ap-bgm-actions">
                        <button type="button" class="ap-small-btn" data-ap-action="open-bgm-player">🎵 打开播放器</button>
                        <label class="ap-upload-btn">
                            📁 上传音乐
                            <input type="file" id="ap-bgm-file" accept="audio/*" hidden />
                        </label>
                    </div>
                </div>
                <p class="ap-hint">支持 mp3 / wav / ogg / flac / m4a，单个文件不超过 25MB。上传后会立即加入播放列表。</p>
                ${rows || '<div class="ap-empty">播放列表为空。</div>'}
            </div>
        `;
    }

    // ==================== 操作 ====================

    async _onAction(action, data) {
        switch (action) {
            case 'close':
                this.close();
                break;
            case 'tab':
                this._tab = data.tab || 'users';
                this._render();
                break;
            case 'modal-close':
                this.modalEl.classList.add('hidden');
                this._manageGalaxy = null;
                this._members = [];
                this._manageEditing = false;
                break;
            case 'toggle-add-menu':
                if (!isStaff()) return;
                this.addMenuEl?.classList.toggle('hidden');
                break;
            case 'manage-galaxy': {
                const galaxy = this._galaxies.find(g => g.id === data.id);
                if (!galaxy) { showToast('星系不存在或已被删除', 'error'); return; }
                await this._showGalaxyManage(galaxy);
                break;
            }
            case 'manage-edit':
                this._manageEditing = true;
                this._renderGalaxyManage();
                break;
            case 'manage-cancel-edit':
                this._manageEditing = false;
                this._renderGalaxyManage();
                break;
            case 'manage-reload':
                this._membersLoading = true;
                this._renderGalaxyManage();
                await this._loadMembers();
                break;
            case 'kick-member': {
                if (!this._manageGalaxy) return;
                if (!confirm(`将「${data.name}」移出星系？`)) return;
                const res = await apiPost('/api/galaxy/kick', {
                    galaxyId: this._manageGalaxy.id,
                    userId: data.id,
                });
                if (!res?.ok) { showToast(res?.error || '移出失败', 'error'); return; }
                showToast(`已将「${data.name}」移出星系`, 'success');
                this._membersLoading = true;
                this._renderGalaxyManage();
                await Promise.all([refreshSession(true), this._loadMembers(), this.onRefreshWorld()]);
                this.refresh();
                break;
            }
            case 'add-mode':
                this.addMenuEl?.classList.add('hidden');
                this._openGalaxyForm(data.mode === 'offer' ? 'offer' : 'direct');
                break;
            case 'set-role': {
                const res = await apiPost('/api/admin/set-role', {
                    userId: data.id,
                    role: data.role,
                });
                if (!res?.ok) { showToast(res?.error || '操作失败', 'error'); return; }
                showToast('角色已更新', 'success');
                await refreshSession(true);
                this.refresh();
                break;
            }
            case 'set-banned': {
                const banned = data.banned === '1';
                const res = await apiPost('/api/admin/set-banned', {
                    userId: data.id, banned,
                });
                if (!res?.ok) { showToast(res?.error || '操作失败', 'error'); return; }
                showToast(banned ? '账号已封禁' : '账号已解封', 'success');
                this.refresh();
                break;
            }
            case 'delete-user': {
                if (!confirm('确定要删除这个账号吗？该操作不可撤销。')) return;
                const res = await apiPost('/api/admin/delete-user', { userId: data.id });
                if (!res?.ok) { showToast(res?.error || '删除失败', 'error'); return; }
                showToast('账号已删除', 'success');
                this.refresh();
                break;
            }
            case 'review': {
                const approve = data.decision === 'approve';
                const note = approve ? '' : (prompt('填写驳回原因（会发送给作者）：') || '');
                if (!approve && !note.trim()) {
                    showToast('驳回需要填写审核意见', 'info');
                    return;
                }
                const res = await apiPost('/api/review-system', {
                    id: data.id,
                    action: approve ? 'approve' : 'reject',
                    note,
                });
                if (!res?.ok) { showToast(res?.error || '操作失败', 'error'); return; }
                showToast(approve ? '已通过审核' : '已驳回', 'success');
                await this.onRefreshWorld();
                this.refresh();
                break;
            }
            case 'edit-system':
                this.close();
                this.onEditSystem(data.id);
                break;
            case 'delete-system': {
                if (!confirm('确定要删除这个星体系统吗？')) return;
                const res = await this.onDeleteSystem(data.id);
                if (!res?.ok && res?.error) showToast(res.error, 'error');
                await this.onRefreshWorld();
                this.refresh();
                break;
            }
            case 'set-commander-user': {
                const select = this.overlay.querySelector(`.ap-user-commander-select[data-user-id="${data.id}"]`);
                const galaxyId = select?.value;
                if (!galaxyId) { showToast('请选择要任命的星系', 'info'); return; }
                const res = await apiPost('/api/admin/set-commander', {
                    galaxyId, userId: data.id,
                });
                if (!res?.ok) { showToast(res?.error || '任命失败', 'error'); return; }
                const galaxyName = this._galaxies.find(g => g.id === galaxyId)?.name || galaxyId;
                showToast(`已任命为「${galaxyName}」指挥官`, 'success');
                await Promise.all([refreshSession(true), this.onRefreshWorld()]);
                this.refresh();
                break;
            }
            case 'revoke-commander': {
                const galaxyName = this._galaxies.find(g => g.id === data.galaxyId)?.name || data.galaxyId;
                if (!confirm(`撤销该用户在「${galaxyName}」的指挥官身份？`)) return;
                const res = await apiPost('/api/admin/set-commander', {
                    galaxyId: data.galaxyId, userId: '',
                });
                if (!res?.ok) { showToast(res?.error || '撤销失败', 'error'); return; }
                showToast('指挥官已撤销', 'success');
                await Promise.all([refreshSession(true), this.onRefreshWorld()]);
                this.refresh();
                break;
            }
            case 'delete-galaxy': {
                if (!confirm('删除这个星系？其中的星体系统会自动归入默认星系。')) return;
                // 必须走 UniverseRegistry：它同时清理 localStorage 缓存，
                // 否则下次读取会把已删除的星系重新合并回来并再次写回数据库。
                const res = await deleteUniverseGalaxy(data.id);
                if (!res?.ok) { showToast(res?.error || '删除失败', 'error'); return; }
                this._galaxies = this._galaxies.filter(g => g.id !== data.id);
                showToast('星系已删除', 'success');
                await Promise.all([refreshSession(true), this.onRefreshWorld()]);
                this.refresh();
                break;
            }
            case 'cancel-offer': {
                if (!confirm('下架这个星系资格？已领取的记录不受影响。')) return;
                const res = await apiPost('/api/offers/cancel', { offerId: data.id });
                if (!res?.ok) { showToast(res?.error || '下架失败', 'error'); return; }
                showToast('资格已下架', 'success');
                this.refresh();
                break;
            }
            case 'open-bgm-player':
                this.onOpenBgmPlayer();
                break;
            case 'delete-bgm': {
                if (!confirm(`删除音乐「${data.name}」？`)) return;
                const res = await apiPost('/api/admin/delete-bgm', { filename: data.name });
                if (!res?.ok) { showToast(res?.error || '删除失败', 'error'); return; }
                this._bgm = res.files || [];
                showToast('音乐已删除', 'success');
                this.onBgmChanged();
                this._render();
                break;
            }
            default:
                break;
        }
    }

    async _onForm(kind, formData) {
        if (kind === 'galaxy') return this._createGalaxy(formData);
        if (kind === 'offer') return this._publishOffer(formData);
        if (kind === 'manage-galaxy') return this._saveManagedGalaxy(formData);
    }

    async _createGalaxy(formData) {
        const name = String(formData.get('name') || '').trim();
        const nameCN = String(formData.get('nameCN') || '').trim();
        const description = String(formData.get('description') || '').trim();
        if (!name) { showToast('请填写星系名称', 'info'); return; }

        const file = formData.get('icon');
        let iconSvg = DEFAULT_GALAXY_ICON;
        if (file instanceof File && file.size > 0) {
            if (!/svg/i.test(file.type) && !/\.svg$/i.test(file.name)) {
                showToast('图标必须是 .svg 文件', 'error');
                return;
            }
            try {
                iconSvg = await readFileAsDataUrl(file);
            } catch (e) {
                showToast(e.message || '图标读取失败', 'error');
                return;
            }
        }

        const id = makeGalaxyId(nameCN || name, this._galaxies.map(g => g.id));
        const res = await apiPost('/api/save-universe-galaxy', {
            id, name, nameCN, description, iconSvg, detailTree: [],
        });
        if (!res?.ok) { showToast(res?.error || '创建失败', 'error'); return; }
        this.modalEl.classList.add('hidden');
        showToast(`星系「${name}」已创建`, 'success');
        await this.onRefreshWorld();
        this.refresh();
    }

    async _publishOffer(formData) {
        const name = String(formData.get('name') || '').trim();
        const nameCN = String(formData.get('nameCN') || '').trim();
        const description = String(formData.get('description') || '').trim();
        const quantity = Math.max(1, Math.min(20, Number(formData.get('quantity')) || 1));
        if (!name) { showToast('请填写星系名称', 'info'); return; }

        const res = await apiPost('/api/offers/publish', { name, nameCN, description, quantity });
        if (!res?.ok) { showToast(res?.error || '发布失败', 'error'); return; }
        this.modalEl.classList.add('hidden');
        showToast('星系资格已发布，已通知所有星际公民', 'success');
        this._tab = 'offers';
        this.refresh();
    }

    // ==================== 添加星系 / 发布资格弹窗 ====================

    _openGalaxyForm(mode) {
        if (!isStaff()) return;
        const isOffer = mode === 'offer';
        this.modalTitleEl.textContent = isOffer ? '🎫 发布星系资格' : '🌌 直接添加星系';
        this.modalBodyEl.innerHTML = `
            <form class="ap-form" data-ap-form="${isOffer ? 'offer' : 'galaxy'}">
                <label class="ap-field"><span>星系名称</span>
                    <input name="name" type="text" placeholder="如：仙女座星系" required />
                </label>
                <label class="ap-field"><span>英文名</span>
                    <input name="nameCN" type="text" placeholder="如：Andromeda" />
                </label>
                <label class="ap-field"><span>简介</span>
                    <textarea name="description" rows="3" placeholder="一句话介绍这个星系…"></textarea>
                </label>
                ${isOffer ? `
                    <label class="ap-field"><span>资格数量</span>
                        <input name="quantity" type="number" min="1" max="20" value="1" />
                    </label>
                    <p class="ap-hint">发布后所有星际公民都会在“新消息”中收到通知，先抢先得。抢到的公民自动成为该星系的指挥官。</p>
                ` : `
                    <label class="ap-field"><span>图标（.svg，可选）</span>
                        <input name="icon" type="file" accept=".svg,image/svg+xml" />
                    </label>
                    <p class="ap-hint">直接添加的星系会立即出现在宇宙视图中，不经过抢夺流程。</p>
                `}
                <div class="ap-form-actions">
                    <button type="button" class="ap-ghost-btn" data-ap-action="modal-close">取消</button>
                    <button type="submit" class="ap-primary-btn">${isOffer ? '发布资格' : '创建星系'}</button>
                </div>
            </form>
        `;
        this.modalEl.classList.remove('hidden');
        setTimeout(() => this.modalBodyEl.querySelector('input[name="name"]')?.focus(), 30);
    }

    // ==================== 星系信息 / 成员管理 ====================

    async _showGalaxyManage(galaxy) {
        if (!galaxy) return;
        this._manageGalaxy = galaxy;
        this._manageEditing = false;
        this._members = [];
        this._newMemberIds = new Set();
        this._membersLoading = true;
        this.modalTitleEl.textContent = `🛰 星系管理 · ${galaxy.name}`;
        this.modalBodyEl.innerHTML = '<div class="gm-loading">加载中…</div>';
        this.modalEl.classList.remove('hidden');
        this._renderGalaxyManage();
        await this._loadMembers();
    }

    async _loadMembers() {
        const galaxy = this._manageGalaxy;
        if (!galaxy) return;
        const res = await apiPost('/api/galaxy/members', { galaxyId: galaxy.id });
        if (this._manageGalaxy !== galaxy) return;
        this._members = res?.members || [];
        this._membersLoading = false;
        if (!res?.ok && res?.error) showToast(res.error, 'error');

        // 新成员标签：先按“上次查看”时间取新成员，再把本次读取标记为已查看
        const user = getCurrentUser();
        if (user?.id) {
            const seen = ensureSeenAt(user.id, memberScope(galaxy.id), this._members, (m) => m.joinedAt);
            this._newMemberIds = new Set(
                this._members.filter((m) => isNewSince(seen, m.joinedAt)).map((m) => m.id)
            );
            markSeenFromItems(user.id, memberScope(galaxy.id), this._members, (m) => m.joinedAt);
        }
        this._renderGalaxyManage();
    }

    _renderGalaxyManage() {
        const galaxy = this._manageGalaxy;
        if (!galaxy) return;
        const user = getCurrentUser();
        const canEdit = isDeveloper() || galaxy.commanderUserId === user?.id;
        const isCommander = galaxy.commanderUserId === user?.id;

        const editForm = `
            <form class="gm-form" data-ap-form="manage-galaxy">
                <label class="gm-field"><span>星系名称</span>
                    <input name="name" type="text" value="${escapeHtml(galaxy.name || '')}" required />
                </label>
                <label class="gm-field"><span>英文名</span>
                    <input name="nameCN" type="text" value="${escapeHtml(galaxy.nameCN || '')}" />
                </label>
                <label class="gm-field"><span>简介</span>
                    <textarea name="description" rows="3">${escapeHtml(galaxy.description || '')}</textarea>
                </label>
                <label class="gm-field"><span>图标（.svg，留空则保持不变）</span>
                    <input name="icon" type="file" accept=".svg,image/svg+xml" />
                </label>
                <div class="gm-form-actions">
                    <button type="button" class="gm-ghost-btn" data-ap-action="manage-cancel-edit">取消</button>
                    <button type="submit" class="gm-primary-btn">保存星系信息</button>
                </div>
            </form>
        `;

        const memberRows = this._members.map((m) => `
            <div class="gm-member-row">
                <div class="gm-member-main">
                    <span class="gm-member-name">${escapeHtml(m.displayName || m.username)}</span>
                    ${this._newMemberIds.has(m.id) ? '<span class="ap-new-tag">新</span>' : ''}
                    <span class="gm-member-role">${roleLabel(m.role)}${m.isCommander ? ' · 指挥官' : ''}</span>
                    ${m.banned ? '<span class="gm-member-banned">已封禁</span>' : ''}
                </div>
                <div class="gm-member-meta">加入于 ${formatTime(m.joinedAt)}</div>
                ${canEdit && !m.isCommander && m.id !== user?.id
                    ? `<button type="button" class="gm-small-btn is-danger" data-ap-action="kick-member"
                               data-id="${escapeHtml(m.id)}" data-name="${escapeHtml(m.displayName || m.username)}">移出星系</button>`
                    : ''}
            </div>
        `).join('');

        this.modalBodyEl.innerHTML = `
            <div class="gm-info-card">
                <img class="gm-icon" src="${escapeHtml(galaxy.iconSvg || DEFAULT_GALAXY_ICON)}" alt="" />
                <div class="gm-info-main">
                    <div class="gm-galaxy-name">${escapeHtml(galaxy.name)}
                        <small>${escapeHtml(galaxy.nameCN || '')}</small></div>
                    <div class="gm-info-meta">
                        指挥官：${escapeHtml(galaxy.commanderName || '未任命')} ·
                        ${this._members.length} 位公民
                        ${galaxy.isDefault ? ' · 默认星系' : ''}
                    </div>
                    <div class="gm-badge-row">
                        ${canEdit ? '<span class="gm-badge">可编辑星系信息</span>' : ''}
                        ${canEdit ? '<span class="gm-badge">可管理成员</span>' : ''}
                        ${isCommander ? '<span class="gm-badge is-commander">星系指挥官</span>' : ''}
                    </div>
                </div>
                ${canEdit && !this._manageEditing
                    ? '<button type="button" class="gm-primary-btn" data-ap-action="manage-edit">✎ 编辑星系信息</button>'
                    : ''}
            </div>

            ${canEdit && this._manageEditing ? editForm : ''}

            <div class="gm-section">
                <div class="gm-section-head">
                    <h3>成员列表 · ${this._members.length}</h3>
                    <button type="button" class="gm-ghost-btn" data-ap-action="manage-reload">⟳ 刷新</button>
                </div>
                ${canEdit
                    ? '<p class="gm-hint">作为星系管理者，你可以将成员移出星系；被移出的成员会收到通知。</p>'
                    : '<p class="gm-hint">只有该星系指挥官或开发者可以移出成员。</p>'}
                ${this._membersLoading
                    ? '<div class="gm-loading">加载中…</div>'
                    : (memberRows || '<div class="gm-empty">暂无成员。</div>')}
            </div>
        `;
    }

    async _saveManagedGalaxy(formData) {
        const galaxy = this._manageGalaxy;
        if (!galaxy) return;
        const name = String(formData.get('name') || '').trim();
        if (!name) { showToast('请填写星系名称', 'info'); return; }

        let iconSvg = galaxy.iconSvg || DEFAULT_GALAXY_ICON;
        const file = formData.get('icon');
        if (file instanceof File && file.size > 0) {
            if (!/svg/i.test(file.type) && !/\.svg$/i.test(file.name)) {
                showToast('图标必须是 .svg 文件', 'error');
                return;
            }
            try {
                iconSvg = (await readFileAsDataUrl(file)) || iconSvg;
            } catch (e) {
                showToast(e.message || '图标读取失败', 'error');
                return;
            }
        }

        const res = await saveUniverseGalaxy({
            ...galaxy,
            name,
            nameCN: String(formData.get('nameCN') || '').trim(),
            description: String(formData.get('description') || '').trim(),
            iconSvg,
        });
        if (!res?.ok) {
            showToast(res?.error || '保存失败', 'error');
            return;
        }
        this._manageEditing = false;
        showToast('星系信息已更新', 'success');
        await Promise.all([refreshSession(true), this.onRefreshWorld()]);
        await this.refresh();
        const updated = this._galaxies.find(g => g.id === galaxy.id);
        if (updated) {
            this._manageGalaxy = updated;
            this.modalTitleEl.textContent = `🛰 星系管理 · ${updated.name}`;
            this._renderGalaxyManage();
        }
    }

    // 背景音乐上传（change 事件需要单独绑定，因为 input 由渲染动态生成）
    _bindBgmUpload() {
        const input = this.overlay.querySelector('#ap-bgm-file');
        if (!input || input._apBound) return;
        input._apBound = true;
        input.addEventListener('change', async () => {
            const file = input.files?.[0];
            if (!file) return;
            if (file.size > 25 * 1024 * 1024) {
                showToast('音频不能超过 25MB', 'error');
                return;
            }
            input.disabled = true;
            try {
                const dataUrl = await readFileAsDataUrl(file);
                const res = await apiPost('/api/admin/upload-bgm', {
                    filename: file.name, dataUrl,
                });
                if (!res?.ok) { showToast(res?.error || '上传失败', 'error'); return; }
                this._bgm = res.files || [];
                showToast('音乐已上传', 'success');
                this.onBgmChanged();
                this._render();
            } finally {
                input.disabled = false;
            }
        });
    }
}

/**
 * 右上角「网站管理 / 星系管理」入口是否需要红点：
 *  · 开发者 / 管理员：存在待审核的星体系统
 *  · 星系指挥官：自己管理的星系有新公民加入
 */
export async function computeEntryActivity() {
    const user = getCurrentUser();
    if (!user) return false;
    if (isStaff()) {
        const res = await apiPost('/api/admin/systems', {});
        return (res?.galaxies || []).some((s) => s.status === 'pending');
    }
    const commanded = user.commandedGalaxies || [];
    const results = await Promise.all(commanded.map(async (g) => {
        const res = await apiPost('/api/galaxy/members', { galaxyId: g.id });
        return { galaxyId: g.id, ok: !!res?.ok, members: res?.members || [] };
    }));
    return results.some(({ galaxyId, ok, members }) => ok
        && scopeHasNew(user.id, memberScope(galaxyId), members, (m) => m.joinedAt));
}
