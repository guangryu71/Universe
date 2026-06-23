// ============================================================
// planets.js — 星球工厂
// 从 Galaxy/solar system/ 目录导入各独立星球类
// ============================================================

import { Sun }      from '../Galaxy/solar system/Sun.js';
import { Mercury }  from '../Galaxy/solar system/Mercury.js';
import { Venus }    from '../Galaxy/solar system/Venus.js';
import { Earth }    from '../Galaxy/solar system/Earth.js';
import { Mars }     from '../Galaxy/solar system/Mars.js';
import { Jupiter }  from '../Galaxy/solar system/Jupiter.js';
import { Saturn }   from '../Galaxy/solar system/Saturn.js';
import { Uranus }   from '../Galaxy/solar system/Uranus.js';
import { Neptune }  from '../Galaxy/solar system/Neptune.js';

/** 所有内置星球类（统一数据源，供 galaxyRegistry 等模块使用） */
export const PLANET_CLASSES = [
    Sun, Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, Neptune,
];

/** 按 key 查找星球类 */
export function getPlanetClassByKey(key) {
    return PLANET_CLASSES.find(cls => cls.KEY === key) || null;
}

/**
 * 创建所有星球实例并设置初始轨道速度
 * @param {THREE.Scene} scene
 * @returns {object} { sun, mercury, venus, earth, mars, jupiter, saturn, uranus, neptune }
 */
export function createAllPlanets(scene) {
    const planets = {
        sun:      new Sun(scene),
        mercury:  new Mercury(scene),
        venus:    new Venus(scene),
        earth:    new Earth(scene),
        mars:     new Mars(scene),
        jupiter:  new Jupiter(scene),
        saturn:   new Saturn(scene),
        uranus:   new Uranus(scene),
        neptune:  new Neptune(scene),
    };

    // 为所有行星设置初始圆形轨道速度（以太阳质量为中心）
    const sunMass = planets.sun.mass;
    for (const key of Object.keys(planets)) {
        if (key === 'sun') continue;
        planets[key].setCircularOrbitVelocity(sunMass);
    }

    return planets;
}
