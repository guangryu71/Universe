// ============================================================
// galaxyRegistry.js — 星系注册表
// 管理所有已知星系及其天体数据，支持自定义星系的 localStorage 持久化
// ============================================================

import { colorToHex, storageLoad, storageSave } from './utils.js';
import { PLANET_CLASSES } from './planets.js';

// ==================== 内置星系定义 ====================

const SOLAR_SYSTEM_CLASSES = PLANET_CLASSES;

/** 从星球类提取元数据（纯数据，不含 Three.js 对象） */
function classToPlanetInfo(cls) {
    return {
        key:          cls.KEY,
        name:         cls.NAME,
        nameCN:       cls.NAME_CN,
        mass:         cls.MASS,
        radius:       cls.RADIUS,
        orbitRadius:  cls.ORBIT_RADIUS,
        visualRadius: cls.VISUAL_RADIUS,
        color:        colorToHex(cls.COLOR),
        texturePath:  cls.TEXTURE || null,
        details:      cls.DETAILS || '',
        voiceIntro:   cls.VOICE_INTRO || '',
        isStar:       cls.KEY === 'sun',
    };
}

const BUILT_IN_GALAXIES = [
    {
        id: 'solar-system',
        name: '太阳系',
        nameCN: 'Solar System',
        description: '以太阳为中心的恒星系统，包含8颗行星、数百颗卫星及无数小天体。人类的家园。',
        icon: '☀️',
        planetClasses: SOLAR_SYSTEM_CLASSES,
        getPlanets() {
            return this.planetClasses.map(classToPlanetInfo);
        },
    },
];

// ==================== 自定义星系持久化 ====================

const STORAGE_KEY = 'universe_custom_galaxies';

let customGalaxies = storageLoad(STORAGE_KEY, []);

// ==================== 公开 API ====================

/** 获取所有星系（内置 + 自定义） */
export function getAllGalaxies() {
    const builtIn = BUILT_IN_GALAXIES.map(g => ({
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

/** 搜索星系和星球（关键词匹配） */
export function searchGalaxies(query) {
    if (!query || query.trim() === '') return getAllGalaxies();
    const q = query.toLowerCase().trim();
    const all = getAllGalaxies();

    return all.filter(g => {
        // 匹配星系名
        if (g.name.toLowerCase().includes(q)) return true;
        if (g.nameCN.toLowerCase().includes(q)) return true;
        if (g.description.toLowerCase().includes(q)) return true;
        // 匹配星球
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

/** 获取内置星球的类引用（用于 createAllPlanets） */
export function getBuiltInPlanetClasses() {
    return PLANET_CLASSES;
}

/** 检查是否为内置星系 */
export function isBuiltIn(id) {
    return BUILT_IN_GALAXIES.some(g => g.id === id);
}
