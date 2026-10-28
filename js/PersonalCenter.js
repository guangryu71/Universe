// ============================================================
// PersonalCenter.js — 个人中心（登录 / 注册 / 我的系统 / 我的星系 / 新消息）
//
// 右上角头像按钮打开。未登录时显示登录 / 注册表单；
// 登录后展示账号信息、自己发布的星体系统、已加入的星系与社区消息。
// ============================================================

import { showToast } from './toast.js?v=1';
import {
    getCurrentUser, refreshSession, reloadUser, onSessionChange,
    login, register, logout, apiPost,
    displayNameOf, roleLabel, roleIcon, escapeHtml,
} from './session.js?v=1';
import {
    ensureSeenAt, scopeHasNew, markSeenFromItems, isNewSince,
} from './activity.js?v=2';
import { formatTime } from './utils.js';

const STATUS_META = {
    approved: { label: '已通过', cls: 'is-approved' },
    pending: { label: '审核中', cls: 'is-pending' },
    rejected: { label: '未通过', cls: 'is-rejected' },
    draft: { label: '草稿', cls: 'is-draft' },
};

/** 系统最近一次“发生变化”的时间（审核 / 编辑 / 发布） */
function systemTs(sys) {
    return Number(sys?.reviewedAt) || Number(sys?.submittedAt) || Number(sys?.updatedAt) || Number(sys?.createdAt) || 0;
}

export class PersonalCenter {
    /**
     * @param {object} deps
     * @param {function} [deps.onEditSystem]      — (systemId) => void
     * @param {function} [deps.onOpenGalaxyManager] — (galaxyId) => void
     * @param {function} [deps.onOpenUniverse]    — (galaxyId?) => void
     * @param {function} [deps.onPublishDraft]    — (systemId) => Promise<{ok,error?}>
     * @param {function} [deps.onWorldChanged]    — 发布草稿后刷新主界面 / 宇宙视图
     */
    constructor(deps = {}) {
        this.onEditSystem = deps.onEditSystem || (() => {});
        this.onOpenGalaxyManager = deps.onOpenGalaxyManager || (() => {});
        this.onOpenUniverse = deps.onOpenUniverse || (() => {});
        this.onPublishDraft = deps.onPublishDraft || (async () => ({ ok: false, error: '暂不可用' }));
        this.onWorldChanged = deps.onWorldChanged || (() => {});

        this._authMode = 'login';
        this._tab = 'systems';
        this._systems = [];
        this._messages = [];
        this._offers = [];
        this._loading = false;

        // “新内容”标记：id 集合在本次会话内保持，红点则随“已查看”时间戳消失
        this._newMessageIds = new Set();
        this._newOfferIds = new Set();
        this._newSystemIds = new Set();
        this._markingRead = false;
        this._credentialModal = null;

        this._buildDOM();
        this._bindEvents();

        onSessionChange(() => {
            this.updateBadge();
            if (this.isVisible()) {
                this._render();
                this.refresh();
            }
        });
        this.updateBadge();
    }

    // ==================== DOM ====================

    _buildDOM() {
        this.overlay = document.createElement('div');
        this.overlay.id = 'personal-center-overlay';
        this.overlay.className = 'pc-overlay hidden';
        this.overlay.innerHTML = `
            <div class="pc-backdrop" data-pc-action="close"></div>
            <div class="pc-panel" role="dialog" aria-label="个人中心">
                <div class="pc-header">
                    <span class="pc-header-title">👤 个人中心</span>
                    <button class="pc-close" type="button" data-pc-action="close" title="关闭">✕</button>
                </div>
                <div class="pc-body" id="pc-body"></div>
            </div>
        `;
        document.body.appendChild(this.overlay);
        this.bodyEl = this.overlay.querySelector('#pc-body');
    }

    _bindEvents() {
        this.overlay.addEventListener('click', (e) => {
            const target = e.target.closest('[data-pc-action]');
            if (!target) return;
            this._onAction(target.dataset.pcAction, target.dataset, e);
        });
        this.overlay.addEventListener('submit', (e) => {
            const form = e.target.closest('form[data-pc-form]');
            if (!form) return;
            e.preventDefault();
            this._onForm(form.dataset.pcForm, new FormData(form));
        });
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape' || !this.isVisible()) return;
            // 注册后的账号提醒必须点“确认登录”关闭，避免用户没看清就进入界面
            if (this._credentialModal) return;
            this.close();
        });
    }

    isVisible() {
        return !this.overlay.classList.contains('hidden');
    }

    open() {
        this.overlay.classList.remove('hidden');
        this._render();
        this.refresh();
    }

    close() {
        if (this._credentialModal) return; // 账号提醒未确认时不关闭
        this.overlay.classList.add('hidden');
    }

    /**
     * 注册成功后的账号提醒弹窗：不支持找回密码，务必记住账号密码。
     * 点“确认登录”后才真正进入界面（会话此时已建立，这里只放行 UI）。
     */
    _showCredentialReminder(username, password) {
        this._dismissCredentialReminder();
        const el = document.createElement('div');
        el.className = 'pc-credential-modal';
        el.innerHTML = `
            <div class="pc-credential-card" role="alertdialog" aria-label="账号密码提醒">
                <div class="pc-credential-icon">🔐</div>
                <h3 class="pc-credential-title">请牢记你的账号密码</h3>
                <p class="pc-credential-warn">目前网站暂不支持密码找回功能，请牢记注册的账号密码。</p>
                <div class="pc-credential-list">
                    <div class="pc-credential-item">
                        <span>账号</span>
                        <strong class="pc-credential-value">${escapeHtml(username)}</strong>
                    </div>
                    <div class="pc-credential-item">
                        <span>密码</span>
                        <strong class="pc-credential-value pc-credential-password">${escapeHtml(password)}</strong>
                    </div>
                </div>
                <p class="pc-credential-hint">建议立即截图或抄写保存，此窗口关闭后不会再次显示。</p>
                <button type="button" class="pc-primary-btn pc-credential-confirm"
                        data-pc-action="confirm-login">确认登录</button>
            </div>
        `;
        this.overlay.appendChild(el);
        this._credentialModal = el;
    }

    _dismissCredentialReminder() {
        if (this._credentialModal) {
            this._credentialModal.remove();
            this._credentialModal = null;
        }
    }

    /** 未登录时打开登录表单（右上角按钮 / 其它入口共用） */
    openLogin() {
        this._authMode = 'login';
        this.open();
    }

    // ==================== 状态 ====================

    async refresh() {
        const user = getCurrentUser();
        if (!user) return;
        if (this._loading) return;
        this._loading = true;
        try {
            await reloadUser();
            const [systemsRes, msgRes, offerRes] = await Promise.all([
                apiPost('/api/my-systems', {}),
                apiPost('/api/messages', { limit: 100 }),
                apiPost('/api/offers/list', {}),
            ]);
            this._systems = systemsRes?.galaxies || [];
            this._messages = msgRes?.messages || [];
            this._offers = offerRes?.offers || [];
            this._collectNewItems();
            // 不再在刷新时自动清空未读：只有真正打开“消息与资格”才算已查看，
            // 否则右上角红点会在用户看到消息前就消失。
        } finally {
            this._loading = false;
            if (this.isVisible()) this._render();
            this.updateBadge();
        }
    }

    /**
     * 记录本次会话里“新”的条目 id。
     * 标记集合只增不减：标记为已读后列表里的“新”标签仍保留，方便回看。
     */
    _collectNewItems() {
        const user = getCurrentUser();
        if (!user?.id) return;
        const msgSeen = ensureSeenAt(user.id, 'messages', this._messages, (m) => m.createdAt);
        const offerSeen = ensureSeenAt(user.id, 'offers', this._offers, (o) => o.createdAt);
        const sysSeen = ensureSeenAt(user.id, 'systems', this._systems, systemTs);
        for (const m of this._messages) {
            if (isNewSince(msgSeen, m.createdAt)) this._newMessageIds.add(m.id);
        }
        for (const o of this._offers) {
            if (isNewSince(offerSeen, o.createdAt)) this._newOfferIds.add(o.id);
        }
        for (const s of this._systems) {
            if (isNewSince(sysSeen, systemTs(s))) this._newSystemIds.add(s.id);
        }
    }

    /** 打开某个标签页时把对应内容标记为已查看（红点消失，“新”标签保留） */
    _markTabSeen(tab) {
        const user = getCurrentUser();
        if (!user?.id) return;
        if (tab === 'systems') {
            markSeenFromItems(user.id, 'systems', this._systems, systemTs);
            return;
        }
        if (tab !== 'messages') return;
        markSeenFromItems(user.id, 'messages', this._messages, (m) => m.createdAt);
        markSeenFromItems(user.id, 'offers', this._offers, (o) => o.createdAt);
        if ((Number(user.unread) || 0) > 0 && !this._markingRead) {
            this._markingRead = true;
            apiPost('/api/messages/read', {})
                .then((res) => (res?.ok ? refreshSession(true) : null))
                .catch(() => {})
                .finally(() => { this._markingRead = false; });
        }
    }

    updateBadge() {
        const badge = document.querySelector('#profile-btn .pc-unread-badge');
        if (!badge) return;
        const user = getCurrentUser();
        const unread = Number(user?.unread) || 0;
        badge.textContent = unread > 99 ? '99+' : String(unread);
        badge.classList.toggle('hidden', !user || unread <= 0);
    }

    // ==================== 渲染 ====================

    _render() {
        const user = getCurrentUser();
        if (!user) {
            this._renderAuth();
            return;
        }
        const tabs = this._tabs(user);
        if (!tabs.some(t => t.key === this._tab)) this._tab = 'systems';

        const nav = tabs.map(t => `
            <button type="button" class="pc-nav-btn${this._tab === t.key ? ' is-active' : ''}"
                    data-pc-action="tab" data-tab="${t.key}">
                ${t.icon ? '<span class="pc-nav-icon">' + t.icon + '</span>' : ''}
                <span class="pc-nav-label">${t.label}</span>
                ${t.count ? `<span class="pc-nav-count">${t.count}</span>` : ''}
                ${t.hasNew && this._tab !== t.key ? '<span class="pc-nav-dot" title="有新内容"></span>' : ''}
            </button>
        `).join('');

        let content = '';
        if (this._tab === 'messages') content = this._renderMessages();
        else if (this._tab === 'account') content = this._renderAccount(user);
        else content = this._renderMyUniverse(user);

        this.bodyEl.innerHTML = `
            <div class="pc-layout">
                <aside class="pc-sidebar">
                    <div class="pc-user-card">
                        <div class="pc-avatar">${roleIcon(user.role)}</div>
                        <div class="pc-user-name">${escapeHtml(displayNameOf(user))}</div>
                        <span class="pc-role-badge">${roleLabel(user.role)}</span>
                    </div>
                    <nav class="pc-nav">${nav}</nav>
                    <button type="button" class="pc-logout" data-pc-action="logout">退出登录</button>
                </aside>
                <section class="pc-content" id="pc-panel">${content}</section>
            </div>
        `;

        // 正在看的标签页即视为已查看：红点消失，列表里的“新”标签保留
        this._markTabSeen(this._tab);
    }

    /** 侧边栏导航项（数字为待处理数量，红点表示有未查看的变化） */
    _tabs(user) {
        const unread = Number(user?.unread) || 0;
        const claimable = this._offers.filter(o => !o.claimedGalaxyId && Number(o.remaining) > 0).length;
        const drafts = this._systems.filter(s => s.status === 'draft').length;
        const messagesNew = unread > 0
            || scopeHasNew(user?.id, 'offers', this._offers, (o) => o.createdAt)
            || scopeHasNew(user?.id, 'messages', this._messages, (m) => m.createdAt);
        const systemsNew = scopeHasNew(user?.id, 'systems', this._systems, systemTs);
        return [
            { key: 'systems', label: '我的系统', count: drafts, hasNew: systemsNew },
            { key: 'messages', icon: '📨', label: '消息与资格', count: unread || claimable, hasNew: messagesNew },
            { key: 'account', icon: '🪪', label: '账号设置', count: 0, hasNew: false },
        ];
    }

    _renderAuth() {
        const isLogin = this._authMode !== 'register';
        this.bodyEl.innerHTML = `
            <div class="pc-auth">
                <div class="pc-auth-hero">
                    <div class="pc-auth-logo">🌌</div>
                    <h2>${isLogin ? '登录星际社区' : '加入星际社区'}</h2>
                    <p>${isLogin ? '登录后可发布星体系统、加入星系并参与社区协作。' : '注册后即可加入喜欢的星系，发布自己的星体系统。'}</p>
                </div>
                <form class="pc-auth-form" data-pc-form="${isLogin ? 'login' : 'register'}">
                    <label class="pc-field">
                        <span>用户名</span>
                        <input name="username" type="text" autocomplete="username" placeholder="3-24 位字母或数字" required />
                    </label>
                    ${isLogin ? '' : `
                    <label class="pc-field">
                        <span>昵称（可选）</span>
                        <input name="displayName" type="text" maxlength="24" placeholder="展示给其他公民的名字" />
                    </label>`}
                    <label class="pc-field">
                        <span>密码</span>
                        <input name="password" type="password" autocomplete="${isLogin ? 'current-password' : 'new-password'}"
                               placeholder="至少 8 位" required />
                    </label>
                    ${isLogin ? '' : `
                    <label class="pc-field">
                        <span>确认密码</span>
                        <input name="confirm" type="password" autocomplete="new-password" required />
                    </label>`}
                    <button type="submit" class="pc-primary-btn">${isLogin ? '登录' : '注册并登录'}</button>
                    <div class="pc-auth-switch">
                        ${isLogin
                            ? '还没有账号？<button type="button" data-pc-action="switch-auth" data-mode="register">立即注册</button>'
                            : '已有账号？<button type="button" data-pc-action="switch-auth" data-mode="login">返回登录</button>'}
                    </div>
                    <p class="pc-auth-hint">第一个注册的账号将成为本网站开发者。</p>
                </form>
            </div>
        `;
    }

    _renderAccount(user) {
        return `
            <div class="pc-section">
                <h3 class="pc-section-title">🪪 账号设置</h3>
                <div class="pc-info-grid">
                    <div><span>用户名</span><strong>${escapeHtml(user.username)}</strong></div>
                    <div><span>角色</span><strong>${roleIcon(user.role)} ${roleLabel(user.role)}</strong></div>
                    <div><span>注册时间</span><strong>${formatTime(user.createdAt)}</strong></div>
                    <div><span>已加入星系</span><strong>${(user.memberships || []).length}</strong></div>
                </div>
                <form class="pc-inline-form" data-pc-form="profile">
                    <input name="displayName" type="text" maxlength="24" value="${escapeHtml(user.displayName || '')}" placeholder="昵称" />
                    <button type="submit" class="pc-primary-btn">保存昵称</button>
                </form>
                <form class="pc-inline-form pc-password-form" data-pc-form="password">
                    <input name="currentPassword" type="password" autocomplete="current-password" placeholder="当前密码" required />
                    <input name="newPassword" type="password" autocomplete="new-password" placeholder="新密码（至少 8 位）" required />
                    <button type="submit" class="pc-primary-btn">更新密码</button>
                </form>
            </div>
        `;
    }

    /** 我的系统：创建的系统 + 指挥官身份 + 已加入星系，整合在同一个模块内 */
    _renderMyUniverse(user) {
        const memberships = (user.memberships || []).length;
        const commanded = (user.commandedGalaxies || []).length;
        const drafts = this._systems.filter(s => s.status === 'draft').length;

        const systemRows = this._systems.length
            ? this._systems.map((g) => {
                const meta = STATUS_META[g.status] || STATUS_META.approved;
                const isDraft = g.status === 'draft';
                const isNew = this._newSystemIds.has(g.id);
                return `
                    <div class="pc-system-row${isDraft ? ' is-draft' : ''}${isNew ? ' is-new' : ''}" data-id="${escapeHtml(g.id)}">
                        <div class="pc-system-main">
                            <span class="pc-system-name">${escapeHtml(g.name || g.id)}
                                <small>${escapeHtml(g.nameCN || '')}</small></span>
                            ${isNew ? '<span class="pc-new-tag">新</span>' : ''}
                            <span class="pc-status ${meta.cls}">${meta.label}</span>
                        </div>
                        <div class="pc-system-meta">
                            ${isDraft ? '暂存于草稿箱，尚未公开' : `创建 / 提交：${formatTime(g.submittedAt || g.createdAt)}`}
                            ${g.reviewNote && g.status === 'rejected'
                                ? `<span class="pc-review-note">审核意见：${escapeHtml(g.reviewNote)}</span>` : ''}
                        </div>
                        <div class="pc-system-actions">
                            ${isDraft ? `
                                <button type="button" class="pc-primary-btn pc-publish-btn"
                                        data-pc-action="publish-draft" data-id="${escapeHtml(g.id)}">🚀 完成发布</button>` : ''}
                            <button type="button" class="pc-small-btn" data-pc-action="edit-system" data-id="${escapeHtml(g.id)}">✎ 编辑</button>
                        </div>
                    </div>
                `;
            }).join('')
            : `<div class="pc-empty">你还没有发布过星体系统。<br />进入星体数据库或宇宙视图，创建你的第一个系统吧。</div>`;

        return `
            <div class="pc-section">
                <div class="pc-section-head">
                    <h3 class="pc-section-title">🌌 我的系统 · ${this._systems.length}</h3>
                    <span class="pc-profile-stats">
                        🛰 ${memberships} 个星系 · 👑 ${commanded} 个指挥官身份
                        ${drafts ? ` · 💾 ${drafts} 个草稿` : ''}
                    </span>
                </div>
                <h4 class="pc-subtitle">🪐 我创建的系统</h4>
                ${systemRows}
                <h4 class="pc-subtitle">🛰 星系指挥官与加入情况</h4>
                ${this._renderGalaxyStatus(user)}
            </div>
        `;
    }

    _renderGalaxyStatus(user) {
        const memberships = user.memberships || [];
        const commanded = user.commandedGalaxies || [];
        const merged = new Map();
        memberships.forEach(g => merged.set(g.id, { ...g }));
        commanded.forEach((g) => {
            merged.set(g.id, { ...(merged.get(g.id) || {}), ...g, isCommander: true });
        });
        const list = [...merged.values()];

        const summary = `
            <div class="pc-info-grid pc-galaxy-summary">
                <div><span>星系指挥官</span><strong>${commanded.length} 个</strong></div>
                <div><span>已加入星系</span><strong>${memberships.length} 个</strong></div>
            </div>`;

        const commanderNames = commanded.map(g => g.name || g.id).filter(Boolean);
        const commanderLine = commanderNames.length
            ? `<div class="pc-commander-line">👑 指挥官：${commanderNames.map(n => escapeHtml(n)).join('、')}</div>`
            : '';

        if (!list.length) {
            return `
                ${summary}
                <div class="pc-empty">你还没有加入任何星系。<br />
                    <button type="button" class="pc-primary-btn pc-empty-btn" data-pc-action="open-universe">前往宇宙视图加入星系</button>
                </div>`;
        }

        const rows = list.map((g) => `
            <div class="pc-galaxy-row">
                <div class="pc-galaxy-main">
                    <span class="pc-galaxy-name">${escapeHtml(g.name || g.id)}
                        ${g.nameCN ? `<small>${escapeHtml(g.nameCN)}</small>` : ''}</span>
                    ${g.isCommander ? '<span class="pc-role-badge">星系指挥官</span>' : ''}
                </div>
                <div class="pc-galaxy-actions">
                    ${g.isCommander
                        ? `<button type="button" class="pc-small-btn" data-pc-action="manage-galaxy" data-id="${escapeHtml(g.id)}">⚙ 星系管理</button>`
                        : `<button type="button" class="pc-small-btn is-danger" data-pc-action="leave-galaxy" data-id="${escapeHtml(g.id)}">退出星系</button>`}
                </div>
            </div>
        `).join('');
        return `
            ${summary}
            ${commanderLine}
            <div class="pc-galaxy-list">${rows}</div>
            <button type="button" class="pc-ghost-btn" data-pc-action="open-universe">＋ 去宇宙视图加入更多星系</button>
        `;
    }

    _renderMessages() {
        const offers = this._offers.slice(0, 10);
        const offerHtml = offers.length
            ? `<div class="pc-section">
                <h3 class="pc-section-title">🎫 新星系资格</h3>
                ${offers.map((o) => {
                    const claimed = !!o.claimedGalaxyId;
                    const soldOut = Number(o.remaining) <= 0;
                    const isNew = this._newOfferIds.has(o.id);
                    return `
                        <div class="pc-offer-row${isNew ? ' is-new' : ''}">
                            <div class="pc-offer-main">
                                <span class="pc-offer-name">${escapeHtml(o.name)}${isNew ? ' <span class="pc-new-tag">新</span>' : ''}</span>
                                <span class="pc-offer-desc">${escapeHtml(o.description || '成为该星系的指挥官')}</span>
                                <span class="pc-offer-meta">剩余 ${Number(o.remaining) || 0} / ${Number(o.quantity) || 0}</span>
                            </div>
                            ${claimed
                                ? '<span class="pc-status is-approved">已领取</span>'
                                : (soldOut
                                    ? '<span class="pc-status is-rejected">已被抢完</span>'
                                    : `<button type="button" class="pc-primary-btn pc-claim-btn" data-pc-action="claim-offer" data-id="${escapeHtml(o.id)}">抢夺资格</button>`)}
                        </div>
                    `;
                }).join('')}
            </div>`
            : '';

        const messages = this._messages;
        const msgHtml = messages.length
            ? `<div class="pc-section">
                <h3 class="pc-section-title">📨 消息</h3>
                ${messages.map((m) => `
                    <div class="pc-message-row${m.read ? '' : ' is-unread'}${this._newMessageIds.has(m.id) ? ' is-new' : ''}">
                        <div class="pc-message-head">
                            <span class="pc-message-title">${escapeHtml(m.title || '通知')}${this._newMessageIds.has(m.id) ? ' <span class="pc-new-tag">新</span>' : ''}</span>
                            <span class="pc-message-time">${formatTime(m.createdAt)}</span>
                        </div>
                        <div class="pc-message-body">${escapeHtml(m.body || '')}</div>
                    </div>
                `).join('')}
            </div>`
            : '';

        if (!offerHtml && !msgHtml) {
            return `
                <div class="pc-section">
                    <h3 class="pc-section-title">📨 消息与资格</h3>
                    <div class="pc-empty">暂无新消息。</div>
                </div>`;
        }
        return offerHtml + msgHtml;
    }

    // ==================== 事件 ====================

    async _onAction(action, data) {
        switch (action) {
            case 'close':
                this.close();
                break;
            case 'tab':
                this._tab = data.tab || 'systems';
                this._render();
                break;
            case 'switch-auth':
                this._authMode = data.mode === 'register' ? 'register' : 'login';
                this._render();
                break;
            case 'confirm-login': {
                this._dismissCredentialReminder();
                this.close();
                const me = getCurrentUser();
                showToast(me?.role === 'developer'
                    ? '欢迎开发者，已进入星际社区'
                    : `欢迎加入星际社区，${displayNameOf(me)}`, 'success');
                await refreshSession(true);
                break;
            }
            case 'logout':
                if (!confirm('确定要退出登录吗？')) return;
                await logout();
                this._authMode = 'login';
                this._tab = 'systems';
                this._render();
                showToast('已退出登录', 'info');
                break;
            case 'edit-system':
                this.close();
                this.onEditSystem(data.id);
                break;
            case 'publish-draft': {
                const target = this._systems.find(s => s.id === data.id);
                const name = target?.name || '这个星体系统';
                if (!confirm(`发布「${name}」？发布后将进入审核流程。`)) return;
                const res = await this.onPublishDraft(data.id);
                if (!res?.ok) { showToast(res?.error || '发布失败', 'error'); return; }
                await refreshSession(true);
                await this.onWorldChanged();
                await this.refresh();
                showToast(res.message || '已提交发布', 'success');
                break;
            }
            case 'manage-galaxy':
                this.close();
                this.onOpenGalaxyManager(data.id);
                break;
            case 'leave-galaxy': {
                const res = await apiPost('/api/galaxy/leave', { galaxyId: data.id });
                if (!res?.ok) { showToast(res?.error || '退出失败', 'error'); return; }
                await refreshSession(true);
                showToast('已退出星系', 'success');
                this.refresh();
                break;
            }
            case 'open-universe':
                this.close();
                this.onOpenUniverse();
                break;
            case 'claim-offer': {
                const res = await apiPost('/api/offers/claim', { offerId: data.id });
                if (!res?.ok) { showToast(res?.error || '抢夺失败', 'error'); return; }
                await refreshSession(true);
                this.refresh();
                showToast(res?.galaxy ? `🎉 你已成为「${res.galaxy.name}」的指挥官` : '抢夺成功', 'success');
                break;
            }
            default:
                break;
        }
    }

    async _onForm(kind, formData) {
        const username = String(formData.get('username') || '').trim();
        const password = String(formData.get('password') || '');

        if (kind === 'login') {
            if (!username || !password) { showToast('请填写用户名和密码', 'info'); return; }
            const res = await login(username, password);
            if (!res?.ok) { showToast(res?.error || '登录失败', 'error'); return; }
            this._render();
            await this.refresh();
            showToast(`欢迎回来，${displayNameOf(getCurrentUser())}`, 'success');
            return;
        }

        if (kind === 'register') {
            if (!username || password.length < 8) { showToast('用户名不能为空，密码至少 8 位', 'info'); return; }
            if (password !== String(formData.get('confirm') || '')) { showToast('两次输入的密码不一致', 'error'); return; }
            const res = await register(username, password, String(formData.get('displayName') || '').trim());
            if (!res?.ok) { showToast(res?.error || '注册失败', 'error'); return; }
            // 注册即登录，但先弹出账号提醒，点“确认登录”后才进入界面
            this._authMode = 'login';
            this._showCredentialReminder(username, password);
            return;
        }

        if (kind === 'profile') {
            const displayName = String(formData.get('displayName') || '').trim();
            const res = await apiPost('/api/auth/profile', { displayName });
            if (!res?.ok) { showToast(res?.error || '保存失败', 'error'); return; }
            await refreshSession(true);
            showToast('昵称已更新', 'success');
            this._render();
            return;
        }

        if (kind === 'password') {
            const res = await apiPost('/api/auth/profile', {
                currentPassword: String(formData.get('currentPassword') || ''),
                newPassword: String(formData.get('newPassword') || ''),
            });
            if (!res?.ok) { showToast(res?.error || '修改失败', 'error'); return; }
            showToast('密码已更新', 'success');
            this._render();
        }
    }
}
