// ============================================================
// session.js — 社区账号 / 会话 / 通用 API 客户端
// 会话 Cookie 由服务器以 HttpOnly 形式下发，前端只保存用户视图数据。
// ============================================================

const API_BASE = '';
const listeners = new Set();

let currentUser = null;
let loaded = false;
let loading = null;

function _emit() {
    for (const fn of listeners) {
        try { fn(currentUser); } catch (e) { console.warn('[session] listener failed', e); }
    }
}

export async function apiPost(path, data = {}, options = {}) {
    try {
        const res = await fetch(API_BASE + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(data),
            ...options,
        });
        let payload = null;
        try { payload = await res.json(); } catch { payload = null; }
        if (!payload) payload = { ok: false, error: `服务器返回 ${res.status}` };
        if (res.status === 401) {
            currentUser = null;
            loaded = true;
            _emit();
        }
        return payload;
    } catch (e) {
        return { ok: false, error: '服务器不可用' };
    }
}

export async function refreshSession(force = false) {
    if (loading && !force) return loading;
    if (loaded && !force) return currentUser;
    loading = (async () => {
        try {
            const res = await fetch(API_BASE + '/api/auth/me', {
                credentials: 'same-origin',
                cache: 'no-store',
            });
            const payload = await res.json().catch(() => null);
            currentUser = payload?.user || null;
        } catch {
            currentUser = null;
        } finally {
            loaded = true;
            loading = null;
            _emit();
        }
        return currentUser;
    })();
    return loading;
}

export function getCurrentUser() {
    return currentUser;
}

export function isLoggedIn() {
    return !!currentUser;
}

export function isDeveloper() {
    return currentUser?.role === 'developer';
}

export function isStaff() {
    return currentUser?.role === 'developer' || currentUser?.role === 'admin';
}

export function isAdmin() {
    return currentUser?.role === 'admin';
}

export function getMembershipIds() {
    return new Set((currentUser?.memberships || []).map(g => g.id));
}

export function getCommandedGalaxies() {
    return currentUser?.commandedGalaxies || [];
}

export function isCommanderOf(galaxyId) {
    return (currentUser?.commandedGalaxies || []).some(g => g.id === galaxyId);
}

export function canEditGalaxy(galaxy) {
    if (!currentUser || !galaxy) return false;
    if (currentUser.role === 'developer') return true;
    return galaxy.commanderUserId === currentUser.id;
}

export function canManageGalaxyMembers(galaxy) {
    return canEditGalaxy(galaxy) || currentUser?.role === 'developer';
}

export async function login(username, password) {
    const res = await apiPost('/api/auth/login', { username, password });
    if (res?.ok) {
        currentUser = res.user || null;
        loaded = true;
        _emit();
    }
    return res;
}

export async function register(username, password, displayName) {
    const res = await apiPost('/api/auth/register', { username, password, displayName });
    if (res?.ok) {
        currentUser = res.user || null;
        loaded = true;
        _emit();
    }
    return res;
}

export async function logout() {
    await apiPost('/api/auth/logout', {});
    currentUser = null;
    loaded = true;
    _emit();
}

export async function reloadUser() {
    return await refreshSession(true);
}

export function onSessionChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

export function displayNameOf(user) {
    return user?.displayName || user?.username || '访客';
}

export function roleLabel(role) {
    return {
        developer: '开发者',
        admin: '管理员',
        citizen: '星际公民',
    }[role] || '星际公民';
}

export function roleIcon(role) {
    return { developer: '👑', admin: '🛡️', citizen: '🧑‍🚀' }[role] || '🧑‍🚀';
}

export function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}
