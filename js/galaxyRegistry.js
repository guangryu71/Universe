// ============================================================
// galaxyRegistry.js — 星系注册表
// 所有内置星系通过 Galaxy/ 模块自动发现
// 每新增一个 Galaxy/<name>/index.js（标准格式）即自动注册
// 支持 localStorage 持久化 + 服务器端星系管理
// ============================================================

import { colorToHex, storageLoad, storageSave } from './utils.js';

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

const STORAGE_KEY = 'universe_custom_galaxies';
let customGalaxies = storageLoad(STORAGE_KEY, []);

// ==================== 服务器端扫描 ====================

const API_BASE = 'http://127.0.0.1:8765';

/**
 * 从服务器扫描 Galaxy/ 目录，获取所有可用星系列表
 * 用于发现后续手动添加的系统文件夹
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
export async function fetchServerGalaxies() {
    try {
        const resp = await fetch(`${API_BASE}/list-galaxies`);
        if (!resp.ok) return [];
        const data = await resp.json();
        return data.galaxies || [];
    } catch (e) {
        console.warn('[galaxyRegistry] 服务器扫描失败，仅使用内置模块:', e.message);
        return [];
    }
}

/**
 * 通过服务器创建新的星系文件夹
 * @param {object} params
 * @param {string} params.name  - 星系中文名
 * @param {string} params.nameCN - 星系英文名
 * @param {string} params.description
 * @param {object} params.star    - { name, mass, radius, color, visualRadius, x, y, z, texture? }
 * @param {Array}  params.planets - [{ name, mass, radius, orbitRadius, color, visualRadius, texture? }]
 * @returns {Promise<object>} { ok, id?, error? }
 */
export async function createGalaxyOnServer(params) {
    try {
        const resp = await fetch(`${API_BASE}/create-galaxy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
        });
        return await resp.json();
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

/**
 * 从服务器删除星系文件夹
 * @param {string} id - 星系ID
 */
export async function deleteGalaxyOnServer(id) {
    try {
        const resp = await fetch(`${API_BASE}/delete-galaxy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id }),
        });
        return await resp.json();
    } catch (e) {
        return { ok: false, error: e.message };
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
export function addCustomGalaxy(galaxyData) {
    const galaxy = {
        id: 'custom_galaxy_' + Date.now(),
        name:        galaxyData.name || '新星系',
        nameCN:      galaxyData.nameCN || 'New Galaxy',
        description: galaxyData.description || '',
        icon:        galaxyData.icon || '🌟',
        planets:     galaxyData.planets || [],
        createdAt:   Date.now(),
    };
    customGalaxies.push(galaxy);
    storageSave(STORAGE_KEY, customGalaxies);
    return galaxy;
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
