// ============================================================
// UniverseRegistry.js — 宇宙级星系（Galaxy）数据层
//
// 注意术语：
//   星体系统（star system）= Galaxy/custom/ 里保存的单位（太阳系、HD 219134…）
//   星系（galaxy）          = 宇宙视图中的容器（银河系、仙女座…），包含多个星体系统
//
// 星系数据优先存服务器 SQLite（Galaxy/universe.db），localStorage 作为离线兜底。
// ============================================================

import { storageLoad, storageSave } from './utils.js';
import { getAllGalaxies } from './galaxyRegistry.js?v=8';
import { getCurrentUser, refreshSession } from './session.js?v=1';

export const DEFAULT_GALAXY_ID = 'milky-way';
export const STORAGE_KEY = 'universe_galaxies';
export const BODY_RELATIONS_STORAGE_KEY = 'universe_body_relations';

const API_BASE = '';

/** 默认星系图标（内联 SVG，避免额外资源依赖） */
export const DEFAULT_GALAXY_ICON = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <radialGradient id="g" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#eafaff"/>
      <stop offset="32%" stop-color="#66d4ff"/>
      <stop offset="72%" stop-color="#2b6fff" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#0b1a52" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="64" cy="64" r="62" fill="url(#g)" opacity="0.85"/>
  <ellipse cx="64" cy="64" rx="54" ry="17" fill="none" stroke="#8ee9ff" stroke-width="4" opacity="0.75" transform="rotate(-24 64 64)"/>
  <ellipse cx="64" cy="64" rx="36" ry="11" fill="none" stroke="#d6f8ff" stroke-width="3" opacity="0.85" transform="rotate(-24 64 64)"/>
  <circle cx="64" cy="64" r="9" fill="#ffffff"/>
  <circle cx="64" cy="64" r="15" fill="#bfefff" opacity="0.35"/>
</svg>`);

function _api(path, data) {
    return fetch(API_BASE + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(data),
    }).then(r => r.json()).catch(() => ({ ok: false, error: '服务器不可用' }));
}

// ==================== 本地存储 ====================

export function loadLocalUniverseGalaxies() {
    const list = storageLoad(STORAGE_KEY, []);
    return Array.isArray(list) ? list : [];
}

function _saveLocalUniverseGalaxies(list) {
    storageSave(STORAGE_KEY, list);
}

function _upsertLocal(galaxy) {
    const list = loadLocalUniverseGalaxies();
    const idx = list.findIndex(g => g.id === galaxy.id);
    if (idx >= 0) list[idx] = { ...list[idx], ...galaxy };
    else list.push(galaxy);
    _saveLocalUniverseGalaxies(list);
}

/** 由英文名/名称生成稳定、可读的 id */
export function makeGalaxyId(name, existingIds = []) {
    let base = String(name || '')
        .toLowerCase()
        .replace(/[^a-z0-9一-鿿]+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 48);
    if (!base) base = 'galaxy_' + Date.now();
    let id = base;
    let i = 2;
    const used = new Set(existingIds);
    while (used.has(id)) id = `${base}_${i++}`;
    return id;
}

export function createDefaultGalaxy() {
    const now = Date.now();
    return {
        id: DEFAULT_GALAXY_ID,
        name: '银河系',
        nameCN: 'Milky Way',
        description: '默认星系。所有尚未指定隶属星系的星体系统都会自动归入这里。',
        iconSvg: DEFAULT_GALAXY_ICON,
        detailTree: [],
        isDefault: true,
        createdAt: now,
        updatedAt: now,
    };
}

// ==================== 服务器 API ====================

export async function fetchUniverseGalaxiesFromServer() {
    const res = await _api('/api/list-universe-galaxies', {});
    return Array.isArray(res?.galaxies) ? res.galaxies : [];
}

async function _saveUniverseGalaxyOnServer(galaxy) {
    return await _api('/api/save-universe-galaxy', galaxy);
}

export async function deleteUniverseGalaxyFromServer(id) {
    return await _api('/api/delete-universe-galaxy', { id });
}

// ==================== 公开数据接口 ====================

/**
 * 读取全部星系：服务器 + localStorage 合并（按 updatedAt 取新），
 * 并确保至少存在默认星系“银河系”。
 * @returns {Promise<Array>}
 */
export async function loadUniverseGalaxies() {
    await refreshSession();
    const local = loadLocalUniverseGalaxies();
    let remote = [];
    let serverReachable = true;
    try {
        remote = await fetchUniverseGalaxiesFromServer();
    } catch {
        remote = [];
        serverReachable = false;
    }

    const remoteIds = new Set(remote.map(g => g.id).filter(Boolean));
    const unsyncedLocal = local.filter(g => g && g.id && !remoteIds.has(g.id));

    // 数据库是社区状态的权威来源：同 id 时远程记录覆盖本地缓存，
    // 只有服务器上不存在的本地离线星系才保留。
    const byId = new Map();
    for (const g of remote) {
        if (g && g.id) byId.set(g.id, g);
    }
    for (const g of local) {
        if (!g || !g.id || byId.has(g.id)) continue;
        byId.set(g.id, g);
    }

    let galaxies = Array.from(byId.values());

    // 默认星系兜底：即使服务器/localStorage 都没有，也自动创建并持久化
    if (!galaxies.some(g => g.id === DEFAULT_GALAXY_ID)) {
        const def = createDefaultGalaxy();
        galaxies.unshift(def);
        _upsertLocal(def);
        if (serverReachable) _saveUniverseGalaxyOnServer(def).catch(() => {});
    }

    // 离线新建的星系补传数据库（登录后才允许，避免匿名写入）
    if (serverReachable && getCurrentUser()) {
        for (const g of unsyncedLocal) {
            if (g.id === DEFAULT_GALAXY_ID) continue;
            _saveUniverseGalaxyOnServer(g).catch(() => {});
        }
    }

    // 默认星系永远排在最前，其余按名称排序
    galaxies.sort((a, b) => {
        if (a.id === DEFAULT_GALAXY_ID) return -1;
        if (b.id === DEFAULT_GALAXY_ID) return 1;
        return String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN');
    });
    return galaxies;
}

/**
 * 新建或更新星系。先写 localStorage 兜底，再写数据库并用返回记录回填缓存。
 * @returns {Promise<{ok:boolean, server:boolean, galaxy:object}>}
 */
export async function saveUniverseGalaxy(galaxy) {
    const now = Date.now();
    const record = {
        ...galaxy,
        updatedAt: now,
        createdAt: galaxy.createdAt || now,
    };
    const server = await _saveUniverseGalaxyOnServer(record);
    if (server?.ok && server.galaxy) {
        _upsertLocal(server.galaxy);
        return { ok: true, server: true, galaxy: server.galaxy };
    }
    // 只有服务器完全不可达时才退回本地；权限/参数错误必须让用户看到。
    if (server?.error === '服务器不可用') {
        _upsertLocal(record);
        return { ok: true, server: false, galaxy: record };
    }
    return { ok: false, server: false, error: server?.error || '保存失败', galaxy: record };
}

export async function deleteUniverseGalaxy(id) {
    if (id === DEFAULT_GALAXY_ID) {
        return { ok: false, error: '默认星系不可删除' };
    }
    const server = await deleteUniverseGalaxyFromServer(id);
    // “服务器不可用”：离线时删除本地缓存即可，下次联网不再回传；
    // “星系不存在”：数据库里已经没有了（或它只存在于本地缓存），同样视为删除成功。
    const err = server?.error;
    const ok = server?.ok || err === '服务器不可用' || err === '星系不存在';
    if (!ok) return { ok: false, error: err || '删除失败' };
    const list = loadLocalUniverseGalaxies().filter(g => g.id !== id);
    _saveLocalUniverseGalaxies(list);
    return { ok: true, server: !!server?.ok };
}

// ==================== 星体系统 ↔ 星系关系 ====================

/** 星体系统所属星系（未配置 → 默认星系） */
export function getSystemGalaxyId(system) {
    // universeGalaxyId 是数据库列（星系删除后会归入默认星系），优先于 data_json 里的旧值
    return system?.universeGalaxyId || system?.universe?.galaxyId || DEFAULT_GALAXY_ID;
}

/** 星体系统关联的其他星体系统 id 列表 */
export function getSystemRelatedIds(system) {
    const ids = system?.universe?.relatedSystemIds;
    return Array.isArray(ids) ? ids.filter(Boolean) : [];
}

/** 把配置了不存在星系的系统回落到默认星系，并返回该星系 id */
export function resolveSystemGalaxyId(system, galaxies) {
    const gid = getSystemGalaxyId(system);
    return galaxies.some(g => g.id === gid) ? gid : DEFAULT_GALAXY_ID;
}

/** 某个星系包含的星体系统 */
export function getSystemsInGalaxy(systems, galaxies, galaxyId) {
    return systems.filter(s => resolveSystemGalaxyId(s, galaxies) === galaxyId);
}

/**
 * 计算星系之间的连线：只要两个星体系统之间存在关联且隶属不同星系，
 * 就认为这两个星系有关联（去重）。
 */
export function buildGalaxyLinks(systems, galaxies) {
    const validGalaxy = new Set(galaxies.map(g => g.id));
    const byId = new Map(systems.map(s => [s.id, s]));
    const seen = new Set();
    const links = [];

    const add = (a, b) => {
        if (!a || !b || a === b) return;
        if (!validGalaxy.has(a) || !validGalaxy.has(b)) return;
        const key = [a, b].sort().join('|');
        if (seen.has(key)) return;
        seen.add(key);
        links.push({ a, b });
    };

    for (const system of systems) {
        const a = resolveSystemGalaxyId(system, galaxies);
        for (const relatedId of getSystemRelatedIds(system)) {
            const target = byId.get(relatedId);
            if (!target) continue;
            add(a, resolveSystemGalaxyId(target, galaxies));
        }
    }

    // 预留：星系记录本身也可以声明 relatedGalaxyIds
    for (const g of galaxies) {
        for (const rid of (g.relatedGalaxyIds || [])) add(g.id, rid);
    }

    return links;
}

/**
 * 计算一个星系内部星体系统之间的连线。
 * 只返回两端都在该星系内的关系。
 */
export function buildSystemLinks(systems, galaxies, galaxyId) {
    const byId = new Map(systems.map(s => [s.id, s]));
    const seen = new Set();
    const links = [];

    for (const system of systems) {
        if (resolveSystemGalaxyId(system, galaxies) !== galaxyId) continue;
        const ids = getSystemRelatedIds(system);
        for (const relatedId of ids) {
            const target = byId.get(relatedId);
            if (!target) continue;
            if (resolveSystemGalaxyId(target, galaxies) !== galaxyId) continue;
            const key = [system.id, target.id].sort().join('|');
            if (seen.has(key)) continue;
            seen.add(key);
            links.push({ a: system.id, b: target.id });
        }
    }
    return links;
}

/** 便于调用方拿到当前所有星体系统（内置 + 自定义） */
export function getAllUniverseSystems() {
    return getAllGalaxies();
}

// ==================== 星体级关联（Body Relations） ====================
//
// 关联的最小单位是“某个星体系统里的某个星体”，例如：
//   { fromSystemId: 'solar-system', fromKey: 'earth',
//     toSystemId: 'new_galaxy',    toKey: 'new_galaxy_planet_0' }
// 关联是有方向的：
//   from → to 是 from 的“主动关联”，同时是 to 的“被动关联”。
// 星系之间/星体系统之间的上层关联全部由这些记录自动推导。

function _bodyRelationId(fromSystemId, fromKey, toSystemId, toKey) {
    return `${fromSystemId}:${fromKey}->${toSystemId}:${toKey}`;
}

/** 清洗单条关联；无效时返回 null */
export function normalizeBodyRelation(input) {
    if (!input || typeof input !== 'object') return null;
    const fromSystemId = String(input.fromSystemId || '').trim();
    const toSystemId = String(input.toSystemId || '').trim();
    const fromKey = String(input.fromKey || '').trim();
    const toKey = String(input.toKey || '').trim();
    if (!fromSystemId || !toSystemId || !fromKey || !toKey) return null;
    if (fromSystemId === toSystemId && fromKey === toKey) return null;
    return {
        id: _bodyRelationId(fromSystemId, fromKey, toSystemId, toKey),
        fromSystemId,
        fromKey,
        fromName: String(input.fromName || '').trim(),
        toSystemId,
        toKey,
        toName: String(input.toName || '').trim(),
        updatedAt: Number(input.updatedAt) || Date.now(),
    };
}

export function loadLocalBodyRelations() {
    const list = storageLoad(BODY_RELATIONS_STORAGE_KEY, []);
    if (!Array.isArray(list)) return [];
    return list.map(normalizeBodyRelation).filter(Boolean);
}

function _saveLocalBodyRelations(list) {
    storageSave(BODY_RELATIONS_STORAGE_KEY, list);
}

async function _persistBodyRelations(list) {
    const clean = list.map(normalizeBodyRelation).filter(Boolean);
    _saveLocalBodyRelations(clean);
    const res = await _api('/api/save-body-relations', { relations: clean });
    return { ok: true, server: !!res?.ok, relations: clean };
}

/** 读取全部星体关联：服务器 + localStorage 合并（按 updatedAt 取新） */
export async function loadBodyRelations() {
    const local = loadLocalBodyRelations();
    let remote = [];
    try {
        const res = await _api('/api/list-body-relations', {});
        remote = Array.isArray(res?.relations) ? res.relations : [];
    } catch {
        remote = [];
    }

    const remoteIds = new Set();
    const byId = new Map();
    for (const item of remote) {
        const rel = normalizeBodyRelation(item);
        if (rel) {
            byId.set(rel.id, rel);
            remoteIds.add(rel.id);
        }
    }
    for (const rel of local) {
        const existing = byId.get(rel.id);
        if (!existing || (rel.updatedAt || 0) >= (existing.updatedAt || 0)) {
            byId.set(rel.id, rel);
        }
    }

    const merged = Array.from(byId.values()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    // 浏览器里新增、数据库尚未收录的关联：整表回写一次
    if (local.some(rel => !remoteIds.has(rel.id))) {
        _api('/api/save-body-relations', { relations: merged }).catch(() => {});
    }
    return merged;
}

/** 新增/更新一条星体关联（按方向去重：A→B 与 B→A 是两条不同的关联） */
export async function saveBodyRelation(input) {
    const rel = normalizeBodyRelation({ ...input, updatedAt: Date.now() });
    if (!rel) return { ok: false, error: '关联数据不完整' };
    const list = await loadBodyRelations();
    const next = list.filter(r => r.id !== rel.id);
    next.unshift(rel);
    return await _persistBodyRelations(next);
}

export async function deleteBodyRelation(id) {
    const list = await loadBodyRelations();
    return await _persistBodyRelations(list.filter(r => r.id !== id));
}

/** 当前与某个星体系统相关的全部星体关联 */
export function getBodyRelationsForSystem(relations, systemId) {
    return (relations || []).filter(r => r.fromSystemId === systemId || r.toSystemId === systemId);
}

/** 主动关联：以该星体系统里的星体为起点的关联 */
export function getActiveBodyRelations(relations, systemId) {
    return (relations || []).filter(r => r.fromSystemId === systemId);
}

/** 被动关联：其它星体指向该星体系统里的星体的关联 */
export function getPassiveBodyRelations(relations, systemId) {
    return (relations || []).filter(r => r.toSystemId === systemId);
}

/**
 * 由星体关联推导星系之间的关联。
 * 只要一条星体关联的两端隶属不同星系，就认为这两个星系有关联。
 */
export function buildGalaxyLinksFromBodies(relations, systems, galaxies) {
    const validGalaxy = new Set(galaxies.map(g => g.id));
    const byId = new Map(systems.map(s => [s.id, s]));
    const seen = new Set();
    const links = [];

    for (const rel of relations || []) {
        const from = byId.get(rel.fromSystemId);
        const to = byId.get(rel.toSystemId);
        if (!from || !to) continue;
        const a = resolveSystemGalaxyId(from, galaxies);
        const b = resolveSystemGalaxyId(to, galaxies);
        if (!a || !b || a === b) continue;
        if (!validGalaxy.has(a) || !validGalaxy.has(b)) continue;
        const key = [a, b].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        links.push({ a, b });
    }
    return links;
}
