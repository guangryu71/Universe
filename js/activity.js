// ============================================================
// activity.js — “新内容”提醒标记
//
// 每个用户在 localStorage 里记录各区域上次查看的时间戳，用于：
//   · 导航 / 入口按钮上的红点
//   · 列表行上的“新”标签
// 只保存时间戳，不保存任何业务数据；服务端时间与本地时间同为毫秒。
// ============================================================

const STORAGE_KEY = 'universe_activity_seen_v1';

// 解析结果缓存在内存里：一次渲染会查询多个区域，避免反复 JSON.parse
let _cache = null;

function _loadAll() {
    if (_cache) return _cache;
    try {
        const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        _cache = raw && typeof raw === 'object' ? raw : {};
    } catch {
        _cache = {};
    }
    return _cache;
}

function _saveAll(all) {
    _cache = all;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch {
        // localStorage 不可用 / 配额已满时静默降级：红点只是提示，不影响功能
    }
}

// 其他标签页修改了标记时丢弃缓存，避免红点状态过期
if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
        if (e.key === STORAGE_KEY) _cache = null;
    });
}

function _userScope(userId) {
    if (!userId) return null;
    const all = _loadAll();
    return all[userId] || (all[userId] = {});
}

/** 读取某用户某个区域的“上次查看”时间戳；从未记录时返回 null */
export function getSeenAt(userId, scope) {
    if (!userId) return null;
    const mine = _userScope(userId);
    if (!mine) return null;
    const value = Number(mine[scope]);
    return Number.isFinite(value) && value > 0 ? value : null;
}

/** 标记为已查看（只前进，不后退） */
export function markSeenAt(userId, scope, ts = Date.now()) {
    if (!userId) return;
    const all = _loadAll();
    const mine = all[userId] || (all[userId] = {});
    const next = Math.max(Number(ts) || 0, Number(mine[scope]) || 0);
    if (mine[scope] === next) return;
    mine[scope] = next;
    _saveAll(all);
}

/**
 * 用一组记录里的最大时间戳标记已查看，避免依赖本地时钟。
 * @param {function} pick — 从记录中取时间戳（默认 updatedAt）
 */
export function markSeenFromItems(userId, scope, items, pick = (item) => item?.updatedAt) {
    let max = 0;
    for (const item of items || []) {
        max = Math.max(max, Number(pick(item)) || 0);
    }
    if (max > 0) markSeenAt(userId, scope, max);
}

/** 记录是否比“上次查看”更新 */
export function isNewSince(seenAt, ts) {
    return Number(ts) > (Number(seenAt) || 0);
}

/**
 * 读取“上次查看”时间戳；首次使用时以现有内容为基线，
 * 避免把历史内容全部标成“新”（没有记录时用当前时间）。
 */
export function ensureSeenAt(userId, scope, items, pick = (item) => item?.updatedAt) {
    const seen = getSeenAt(userId, scope);
    if (seen != null) return seen;
    let max = 0;
    for (const item of items || []) {
        max = Math.max(max, Number(pick(item)) || 0);
    }
    const baseline = max || Date.now();
    markSeenAt(userId, scope, baseline);
    return baseline;
}

/** 该区域是否有尚未查看的变化（用于导航红点）；首次调用会建立基线 */
export function scopeHasNew(userId, scope, items, pick = (item) => item?.updatedAt) {
    if (!userId) return false;
    const seen = ensureSeenAt(userId, scope, items, pick);
    return (items || []).some((item) => isNewSince(seen, pick(item)));
}
