// ============================================================
// Galaxy/hd-219134/index.js — HD 219134 系统模块入口
// 标准化格式：导出 SYSTEM_INFO, PLANET_CLASSES, PLANET_DATA, createPlanets
// ============================================================

import { HD219134Star } from './HD219134Star.js';
import { HD219134b }    from './HD219134b.js';
import { HD219134c }    from './HD219134c.js';
import { HD219134d }    from './HD219134d.js';
import { HD219134f }    from './HD219134f.js';
import { HD219134g }    from './HD219134g.js';
import { HD219134h }    from './HD219134h.js';

const AU = 1.495978707e11;

// ==================== 系统元信息 ====================

export const SYSTEM_INFO = {
    id: 'hd-219134',
    name: 'HD 219134 系统',
    nameCN: 'HD 219134 System',
    description: '距地球约21光年的K3V型橙矮星系统，拥有多颗系外行星。其中HD 219134 b是一颗凌星超级地球，适合JWST进行大气表征。',
    icon: '🟠',
};

// ==================== 星球类引用 ====================

export const PLANET_CLASSES = [
    HD219134Star,
    HD219134b,
    HD219134c,
    HD219134d,
    HD219134f,
    HD219134g,
    HD219134h,
];

// ---- 系统在宇宙空间中的位置 (SI 单位: 米) ----
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
        IS_STAR:      cls.KEY === 'hd219134',
    };
}

/** 用于 galaxyRegistry 的纯数据数组 */
export const PLANET_DATA = PLANET_CLASSES.map(_classToInfo);

// ==================== 工厂函数 ====================

/**
 * 创建 HD 219134 系统的所有天体实例
 * @param {THREE.Scene} scene
 * @param {object} [existingPlanets] — 已存在的 planets 对象（避免重复创建）
 * @returns {object} { hd219134, hd219134b, hd219134c, ... }
 */
export function createPlanets(scene, existingPlanets = {}) {
    const bodies = {};

    for (const Cls of PLANET_CLASSES) {
        const key = Cls.KEY;
        if (existingPlanets[key]) continue;

        // 先相对于原点创建（位置在构造函数中设置）
        const body = new Cls(scene);

        // 偏移到系统位置
        body.position.x += SYSTEM_POS.x;
        body.position.y += SYSTEM_POS.y;
        body.position.z += SYSTEM_POS.z;
        body._syncMeshPosition();

        bodies[key] = body;
    }

    // 设置轨道速度（所有行星绕恒星运动）
    const star = bodies['hd219134'];
    if (star) {
        const starPos = star.position.clone();
        for (const key of Object.keys(bodies)) {
            if (key === 'hd219134') continue;
            bodies[key].setCircularOrbitVelocity(star.mass, starPos);
        }
    }

    return bodies;
}
