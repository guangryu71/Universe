// ============================================================
// moons.js — 卫星工厂（桥接层）
// 卫星数据定义在 Galaxy/solar system/<planet>_<moon>.js 中
// ============================================================

import { MOON_CLASSES as SOLAR_MOON_CLASSES } from '../Galaxy/solar system/index.js';

/** 所有已注册的卫星类（按母行星 key 索引） */
const _registeredMoons = {};

/**
 * 注册一组卫星类供工厂使用
 * @param {string} parentKey - 母行星 key
 * @param {Array} moonClasses - MoonBody 子类数组
 */
export function registerMoons(parentKey, moonClasses) {
    _registeredMoons[parentKey] = moonClasses;
}

// 注册太阳系卫星
for (const [key, classes] of Object.entries(SOLAR_MOON_CLASSES)) {
    registerMoons(key, classes);
}

/**
 * 为指定行星创建所有卫星实例
 * @param {THREE.Scene} scene
 * @param {object} parentBody - CelestialBody 实例（母行星）
 * @returns {Array} MoonBody 实例数组
 */
export function createMoons(scene, parentBody) {
    const parentKey = parentBody.key;
    const moonClasses = _registeredMoons[parentKey];
    if (!moonClasses || moonClasses.length === 0) return [];

    return moonClasses.map(Cls => new Cls(scene));
}

/**
 * 更新卫星位置（每帧调用）
 * @param {MoonBody[]} moons - MoonBody 实例数组
 * @param {THREE.Vector3} parentPos - 母行星的场景位置
 * @param {number} dt - 时间增量
 */
export function updateMoons(moons, parentPos, dt) {
    for (const moon of moons) {
        moon.update(parentPos, dt);
    }
}
