// ============================================================
// planets.js — 星球工厂（桥接层）
// 所有实际实现委托给 Galaxy/solar system/index.js
// 保留此文件用于向后兼容
// ============================================================

export {
    PLANET_CLASSES,
    PLANET_DATA,
    MOON_CLASSES,
    createPlanets as createAllPlanets,
} from '../Galaxy/solar system/index.js';
