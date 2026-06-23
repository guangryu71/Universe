// ============================================================
// Galaxy/solar system/index.js — 太阳系模块入口
// 标准化格式：导出 SYSTEM_INFO, PLANET_CLASSES, PLANET_DATA, SYSTEM_POS, createPlanets
// ============================================================

import { Sun }      from './Sun.js';
import { Mercury }  from './Mercury.js';
import { Venus }    from './Venus.js';
import { Earth }    from './Earth.js';
import { Mars }     from './Mars.js';
import { Jupiter }  from './Jupiter.js';
import { Saturn }   from './Saturn.js';
import { Uranus }   from './Uranus.js';
import { Neptune }  from './Neptune.js';

// ---- 卫星 ----
import { Earth_Moon }      from './earth_moon.js';
import { Mars_Phobos }     from './mars_phobos.js';
import { Mars_Deimos }     from './mars_deimos.js';
import { Jupiter_Io }       from './jupiter_io.js';
import { Jupiter_Europa }   from './jupiter_europa.js';
import { Jupiter_Ganymede } from './jupiter_ganymede.js';
import { Jupiter_Callisto } from './jupiter_callisto.js';
import { Saturn_Titan }     from './saturn_titan.js';
import { Saturn_Enceladus } from './saturn_enceladus.js';
import { Saturn_Rhea }      from './saturn_rhea.js';
import { Saturn_Iapetus }   from './saturn_iapetus.js';
import { Uranus_Titania }   from './uranus_titania.js';
import { Uranus_Oberon }    from './uranus_oberon.js';
import { Neptune_Triton }   from './neptune_triton.js';

// ==================== 系统元信息 ====================

export const SYSTEM_INFO = {
    id: 'solar-system',
    name: '太阳系',
    nameCN: 'Solar System',
    description: '以太阳为中心的恒星系统，包含8颗行星、数百颗卫星及无数小天体。人类的家园。',
    icon: '☀️',
};

// ==================== 星球静态数据 ====================

export const PLANET_CLASSES = [
    Sun, Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, Neptune,
];

/** 卫星类引用（按母行星组织结构） */
export const MOON_CLASSES = {
    earth:   [Earth_Moon],
    mars:    [Mars_Phobos, Mars_Deimos],
    jupiter: [Jupiter_Io, Jupiter_Europa, Jupiter_Ganymede, Jupiter_Callisto],
    saturn:  [Saturn_Titan, Saturn_Enceladus, Saturn_Rhea, Saturn_Iapetus],
    uranus:  [Uranus_Titania, Uranus_Oberon],
    neptune: [Neptune_Triton],
};

/** 系统在宇宙空间中的位置 (SI 单位: 米) — 太阳系位于原点 */
export const SYSTEM_POS = { x: 0, y: 0, z: 0 };

// ==================== 数据转换 ====================

function _classToInfo(cls) {
    return {
        KEY:          cls.KEY,
        NAME:         cls.NAME,
        NAME_CN:      cls.NAME_CN,
        MASS:         cls.MASS,
        RADIUS:       cls.RADIUS,
        ORBIT_RADIUS: cls.ORBIT_RADIUS,
        VISUAL_RADIUS: cls.VISUAL_RADIUS,
        COLOR:        cls.COLOR,
        TEX_PATH:     cls.TEXTURE || null,
        DETAILS:      cls.DETAILS || '',
        VOICE_INTRO:  cls.VOICE_INTRO || '',
        IS_STAR:      cls.KEY === 'sun',
    };
}

/** 用于 galaxyRegistry 的纯数据数组 */
export const PLANET_DATA = PLANET_CLASSES.map(_classToInfo);

// ==================== 工厂函数 ====================

/**
 * 创建太阳系所有星球实例并设置初始轨道速度
 * @param {THREE.Scene} scene
 * @param {object} [existingPlanets] — 已存在的 planets 对象（避免重复创建）
 * @returns {object} { sun, mercury, venus, earth, mars, jupiter, saturn, uranus, neptune }
 */
export function createPlanets(scene, existingPlanets = {}) {
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
