// ============================================================
// galaxyRegistry.js — 星系注册表
// 所有内置星系通过 Galaxy/ 模块自动发现
// 每新增一个 Galaxy/<name>/index.js（标准格式）即自动注册
// 文本数据以服务器 SQLite（Galaxy/universe.db）为准，localStorage 作离线缓存
// ============================================================

import { colorToHex, storageLoad, storageSave } from './utils.js';
import { AU } from './constants.js';
import { getCurrentUser, refreshSession } from './session.js?v=1';

// ==================== 自动发现 Galaxy 模块 ====================
// 每个 Galaxy/<id>/index.js 必须导出：
//   SYSTEM_INFO  — { id, name, nameCN, description, icon }
//   PLANET_DATA  — [{ key, name, nameCN, mass, radius, orbitRadius, visualRadius, color, ... }]
//   createPlanets(scene, existingPlanets?)  — 返回 { key: CelestialBody }

import { SYSTEM_INFO as SOLAR_INFO, PLANET_DATA as SOLAR_DATA, SYSTEM_POS as SOLAR_POS } from '../Galaxy/solar system/index.js';
import { SYSTEM_INFO as HD_INFO, PLANET_DATA as HD_DATA, SYSTEM_POS as HD_POS } from '../Galaxy/hd-219134/index.js';

/** 所有已注册的内置星系模块 */
const SYSTEM_MODULES = [
    { info: SOLAR_INFO, data: SOLAR_DATA, pos: SOLAR_POS },
    { info: HD_INFO,    data: HD_DATA,    pos: HD_POS },
];

// ==================== 数据格式转换 ====================

/** 将模块的 PLANET_DATA 条目 → 统一 planetInfo 格式 */
function _dataToPlanetInfo(d) {
    return {
        key:          d.KEY,
        name:         d.NAME,
        nameCN:       d.NAME_CN,
        mass:         d.MASS,
        radius:       d.RADIUS,
        orbitRadius:  d.ORBIT_RADIUS,
        visualRadius: d.VISUAL_RADIUS,
        color:        colorToHex(d.COLOR),
        texturePath:  d.TEX_PATH || null,
        details:      d.DETAILS || '',
        voiceIntro:   d.VOICE_INTRO || '',
        isStar:       d.IS_STAR || false,
    };
}

// ==================== 内置星系清单（由模块自动构建） ====================

function _buildBuiltInGalaxies() {
    return SYSTEM_MODULES.map(mod => ({
        id:          mod.info.id,
        name:        mod.info.name,
        nameCN:      mod.info.nameCN,
        description: mod.info.description,
        icon:        mod.info.icon,
        systemPos:   mod.pos,  // { x, y, z } in SI meters
        moduleRef:   mod,
        getPlanets() {
            return mod.data.map(_dataToPlanetInfo);
        },
    }));
}

let _builtInCache = _buildBuiltInGalaxies();

/** 重新构建内置星系缓存（添加新模块后调用） */
function _rebuildBuiltIn() {
    _builtInCache = _buildBuiltInGalaxies();
}

// ==================== 自定义星系持久化 ====================

const API_BASE = '';
const STORAGE_KEY = 'universe_custom_galaxies';
const MIGRATION_FLAG = 'universe_sqlite_migrated_v1';
let customGalaxies = storageLoad(STORAGE_KEY, []);

// ==================== 服务器端 API（Galaxy/custom/ + SQLite）====================

const _api = (path, data) =>
    fetch(API_BASE + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(data),
    }).then(r => r.json()).catch(() => ({ ok: false, error: '服务器不可用' }));

/** 数据库记录（star/planets 为 data.json 结构）→ 前端统一的 planetInfo 结构 */
export function serverRecordToGalaxy(rec) {
    const id = rec.id;
    const star = rec.star || {};
    const starInfo = {
        key: id + '_star',
        name: star.name || '中心恒星',
        nameCN: star.name || '中心恒星',
        mass: star.mass,
        radius: star.radius,
        orbitRadius: 0,
        visualRadius: star.visualRadius,
        color: star.color,
        texturePath: star.texturePath || star.textureData || null,
        textureName: star.textureName || null,
        isStar: true,
        _siPosition: {
            x: (Number(star.x) || 0) * AU,
            y: (Number(star.y) || 0) * AU,
            z: (Number(star.z) || 0) * AU,
        },
        details: star.details || '',
        detailTree: star.detailTree || null,
        surfaceTree: star.surfaceTree || null,
        voiceIntro: star.voiceIntro || '',
    };
    const planetInfos = (Array.isArray(rec.planets) ? rec.planets : []).map((p, i) => ({
        key: id + '_planet_' + i,
        name: p.name || '行星',
        nameCN: p.nameCN || p.name || '行星',
        mass: p.mass,
        radius: p.radius,
        orbitRadius: p.orbitRadius,
        visualRadius: p.visualRadius,
        color: p.color,
        texturePath: p.texturePath || p.textureData || null,
        textureName: p.textureName || null,
        details: p.details || '',
        detailTree: p.detailTree || null,
        surfaceTree: p.surfaceTree || null,
        voiceIntro: p.voiceIntro || '',
        moons: p.moons || [],
        isStar: false,
    }));

    return {
        id,
        name: rec.name || id,
        nameCN: rec.nameCN || rec.name || id,
        description: rec.description || '',
        icon: rec.icon || '🌟',
        planets: [starInfo, ...planetInfos],
        universe: rec.universe || {},
        universeGalaxyId: rec.universeGalaxyId || (rec.universe || {}).galaxyId || '',
        ownerUserId: rec.ownerUserId || null,
        ownerName: rec.ownerName || null,
        status: rec.status || 'approved',
        reviewNote: rec.reviewNote || '',
        reviewedAt: rec.reviewedAt || null,
        submittedAt: rec.submittedAt || null,
        createdAt: rec.createdAt || Date.now(),
        updatedAt: rec.updatedAt || Date.now(),
    };
}

/** 从 SQLite（经 /api/list-galaxies）重新同步自定义星系缓存 */
export async function loadCustomGalaxiesFromServer() {
    // 列表是否包含“被驳回的自己的系统”取决于会话，所以先确保会话状态。
    await refreshSession();
    let res = await _api('/api/list-galaxies', {});
    if (!res || !Array.isArray(res.galaxies)) return customGalaxies;

    const user = getCurrentUser();
    if (user) {
        // 离线新建、数据库里还没有的星系：先补传，避免被下面的覆盖操作丢掉
        const remoteIds = new Set(res.galaxies.map(g => g.id));
        const local = storageLoad(STORAGE_KEY, []);
        const missing = local.filter(g => g && g.id && !remoteIds.has(g.id));
        if (missing.length) {
            const pushed = await _api('/api/migrate-local-data', { systems: missing });
            if (pushed?.ok) {
                const fresh = await _api('/api/list-galaxies', {});
                if (fresh && Array.isArray(fresh.galaxies)) res = fresh;
            }
        }
    }

    customGalaxies = res.galaxies.map(serverRecordToGalaxy);
    storageSave(STORAGE_KEY, customGalaxies);
    return customGalaxies;
}

let _migrationPromise = null;

/**
 * 首次升级时把浏览器 localStorage 中的旧数据推送到 SQLite。
 * 成功后写入标记，之后不再重复提交；服务器不可用时下次启动重试。
 */
export function migrateLocalStorageToServer() {
    if (_migrationPromise) return _migrationPromise;
    _migrationPromise = (async () => {
        try {
            if (localStorage.getItem(MIGRATION_FLAG) === '1') {
                return { ok: true, skipped: true };
            }
            await refreshSession();
            if (!getCurrentUser()) {
                // 未登录时不能认领旧数据；登录后再重试
                _migrationPromise = null;
                return { ok: false, skipped: true, error: '未登录' };
            }
            const systems = storageLoad(STORAGE_KEY, []);
            const universes = storageLoad('universe_galaxies', []);
            const relations = storageLoad('universe_body_relations', []);
            if (!systems.length && !universes.length && !relations.length) {
                localStorage.setItem(MIGRATION_FLAG, '1');
                return { ok: true, empty: true };
            }
            const res = await _api('/api/migrate-local-data', { systems, universes, relations });
            if (res?.ok) localStorage.setItem(MIGRATION_FLAG, '1');
            return res;
        } catch (e) {
            _migrationPromise = null;
            return { ok: false, error: String(e) };
        }
    })();
    return _migrationPromise;
}

/** 当前用户自己的系统（含被驳回的） */
export async function fetchMySystems() {
    await refreshSession();
    if (!getCurrentUser()) return { ok: false, error: '请先登录', galaxies: [] };
    const res = await _api('/api/my-systems', {});
    return res && Array.isArray(res.galaxies)
        ? { ok: true, galaxies: res.galaxies.map(serverRecordToGalaxy) }
        : { ok: false, error: res?.error || '加载失败', galaxies: [] };
}

/**
 * 从服务器扫描 Galaxy/custom/ 目录
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
export async function fetchServerGalaxies() {
    const res = await _api('/api/list-galaxies', {});
    return res.galaxies || [];
}

/**
 * 通过服务器在 Galaxy/custom/ 创建星系文件夹
 * @returns {Promise<object>} { ok, id?, error? }
 */
export async function createGalaxyOnServer(params) {
    return await _api('/api/create-galaxy', params);
}

/**
 * 通过服务器更新 Galaxy/custom/ 中已有星系（星体数据库“再次编译”保存时使用）
 * @returns {Promise<object>} { ok, id?, error? }
 */
export async function updateGalaxyOnServer(params) {
    return await _api('/api/update-galaxy', params);
}

/**
 * 从服务器删除 Galaxy/custom/ 中星系文件夹
 */
export async function deleteGalaxyOnServer(id) {
    return await _api('/api/delete-galaxy', { id });
}

/**
 * 导出星系：压缩选中的 Galaxy/custom/ 文件夹到 output/
 */
export async function exportGalaxiesOnServer(ids) {
    return await _api('/api/export-galaxies', { ids });
}

/**
 * 导入星系：上传 zip 文件到服务器并解压到 Galaxy/custom/
 * @param {File} file - zip 文件
 */
export async function importGalaxyOnServer(file) {
    const url = API_BASE + '/api/import-galaxy';
    try {
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: await file.arrayBuffer(),
        });
        return await resp.json();
    } catch (e) {
        return { ok: false, error: '服务器不可用: ' + e.message };
    }
}

// ==================== 公开 API ====================

/** 获取所有星系（内置 + 自定义） */
export function getAllGalaxies() {
    const builtIn = _builtInCache.map(g => ({
        id:          g.id,
        name:        g.name,
        nameCN:      g.nameCN,
        description: g.description,
        icon:        g.icon,
        isBuiltIn:   true,
        planets:     g.getPlanets(),
    }));

    const custom = customGalaxies.map(g => ({
        ...g,
        isBuiltIn: false,
    }));

    return [...builtIn, ...custom];
}

/** 按 id 查找星系 */
export function getGalaxyById(id) {
    return getAllGalaxies().find(g => g.id === id) || null;
}

/** 添加自定义星系（纯数据，不创建 Three.js 对象） */
export function addCustomGalaxy(galaxyData, customId) {
    const galaxy = {
        id: customId || galaxyData.id || 'custom_galaxy_' + Date.now(),
        name:        galaxyData.name || '新星系',
        nameCN:      galaxyData.nameCN || 'New Galaxy',
        description: galaxyData.description || '',
        icon:        galaxyData.icon || '🌟',
        planets:     galaxyData.planets || [],
        universe:    galaxyData.universe || {},
        universeGalaxyId: galaxyData.universeGalaxyId || (galaxyData.universe || {}).galaxyId || '',
        ownerUserId: galaxyData.ownerUserId || null,
        ownerName:   galaxyData.ownerName || null,
        status:      galaxyData.status || 'approved',
        reviewNote:  galaxyData.reviewNote || '',
        submittedAt: galaxyData.submittedAt || null,
        createdAt:   galaxyData.createdAt || Date.now(),
        updatedAt:   galaxyData.updatedAt || Date.now(),
    };
    customGalaxies.push(galaxy);
    storageSave(STORAGE_KEY, customGalaxies);
    return galaxy;
}

/** 更新已有自定义星系（保持 id 不变，避免系统组/物理引用失效） */
export function updateCustomGalaxy(id, galaxyData) {
    const idx = customGalaxies.findIndex(g => g.id === id);
    if (idx < 0) return null;
    customGalaxies[idx] = {
        ...customGalaxies[idx],
        name:        galaxyData.name || customGalaxies[idx].name,
        nameCN:      galaxyData.nameCN || customGalaxies[idx].nameCN,
        description: galaxyData.description || '',
        icon:        galaxyData.icon || customGalaxies[idx].icon || '🌟',
        planets:     galaxyData.planets || [],
        universe:    galaxyData.universe || customGalaxies[idx].universe || {},
        universeGalaxyId: galaxyData.universeGalaxyId || customGalaxies[idx].universeGalaxyId || '',
        ownerUserId: galaxyData.ownerUserId ?? customGalaxies[idx].ownerUserId ?? null,
        ownerName:   galaxyData.ownerName ?? customGalaxies[idx].ownerName ?? null,
        status:      galaxyData.status || customGalaxies[idx].status || 'approved',
        reviewNote:  galaxyData.reviewNote ?? customGalaxies[idx].reviewNote ?? '',
        updatedAt:   Date.now(),
    };
    storageSave(STORAGE_KEY, customGalaxies);
    return customGalaxies[idx];
}

/** 删除自定义星系 */
export function deleteCustomGalaxy(id) {
    customGalaxies = customGalaxies.filter(g => g.id !== id);
    storageSave(STORAGE_KEY, customGalaxies);
}

/** 搜索星系和星球 */
export function searchGalaxies(query) {
    if (!query || query.trim() === '') return getAllGalaxies();
    const q = query.toLowerCase().trim();
    const all = getAllGalaxies();

    return all.filter(g => {
        if (g.name.toLowerCase().includes(q)) return true;
        if (g.nameCN.toLowerCase().includes(q)) return true;
        if (g.description.toLowerCase().includes(q)) return true;
        if (g.planets && g.planets.length > 0) {
            return g.planets.some(p =>
                p.name.toLowerCase().includes(q) ||
                p.nameCN.toLowerCase().includes(q) ||
                p.key.toLowerCase().includes(q)
            );
        }
        return false;
    });
}

/**
 * 获取内置星系的模块引用
 * 用于 main.js 中的 createAllPlanets 等工厂调用
 */
export function getModuleByGalaxyId(id) {
    const entry = _builtInCache.find(g => g.id === id);
    return entry ? entry.moduleRef : null;
}

/** 检查是否为内置星系 */
export function isBuiltIn(id) {
    return _builtInCache.some(g => g.id === id);
}
