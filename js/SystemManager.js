// ============================================================
// SystemManager.js — 系统切换管理器
// 同一时间只有一个单恒星系统存在于场景中。
// 切换时：销毁当前系统所有天体 → 以原点为中心创建新系统
// ============================================================

import * as THREE from 'three';
import { createMoons, updateMoons } from './moons.js';

export class SystemManager {
    /**
     * @param {object} deps
     * @param {object}  deps.planets    — { key: CelestialBody }（由外部持有）
     * @param {object}  deps.physics    — PhysicsEngine 实例
     * @param {THREE.Scene} deps.scene
     * @param {function} deps.onSwitch  — 切换完成回调 (newSystemId)
     * @param {function} deps.onDrawOrbits — 回调 (systemId, scene) 绘制轨道线
     * @param {object}  deps.allMoons   — { parentKey: [MoonBody] }（由外部持有）
     */
    constructor({ planets, physics, scene, onSwitch, onDrawOrbits, allMoons }) {
        this.planets      = planets;
        this.physics      = physics;
        this.scene        = scene;
        this.onSwitch     = onSwitch || (() => {});
        this.onDrawOrbits = onDrawOrbits || (() => {});
        this.allMoons     = allMoons || {};

        /** @type {Object<string, { createPlanets: Function, moonClasses: Object }>} */
        this._modules = {};
        this._activeSystemId = null;
        this._moonKeys = [];        // 当前系统的卫星所属母行星 key
    }

    // ==================== 注册模块 ====================

    /**
     * 注册一个星系模块
     * @param {string}   id — 星系 ID
     * @param {Function} createPlanetsFn — 模块的 createPlanets(scene) 函数
     * @param {Object}   [moonClasses] — 模块的 MOON_CLASSES（按母行星 key 分组）
     */
    registerModule(id, createPlanetsFn, moonClasses = {}) {
        if (this._modules[id]) {
            console.warn(`[SystemManager] 模块 "${id}" 已注册`);
            return;
        }
        this._modules[id] = { createPlanets: createPlanetsFn, moonClasses };
        console.log(`[SystemManager] 注册模块: ${id}`);
    }

    // ==================== 切换系统 ====================

    /**
     * 切换到指定系统：销毁当前 → 创建新系统
     */
    switchTo(id) {
        if (id === this._activeSystemId) return;
        const mod = this._modules[id];
        if (!mod) { console.warn(`[SystemManager] 模块 "${id}" 未注册`); return; }

        console.log(`[SystemManager] 切换: ${this._activeSystemId} → ${id}`);

        // 1) 销毁当前系统
        this._destroyCurrent();

        // 2) 创建新系统
        const newPlanets = mod.createPlanets(this.scene);
        // 新系统以原点为中心，无需偏移

        for (const key of Object.keys(newPlanets)) {
            this.planets[key] = newPlanets[key];
            this.physics.addBody(newPlanets[key]);
        }

        // 3) 创建卫星
        this._initMoons(mod.moonClasses);

        // 4) 绘制轨道线
        this.onDrawOrbits(id, this.scene);

        this._activeSystemId = id;
        this.onSwitch(id);
    }

    /** 获取当前活跃系统 ID */
    getActiveSystemId() {
        return this._activeSystemId;
    }

    /** 获取当前系统所有天体 key */
    getActiveKeys() {
        if (!this._activeSystemId) return [];
        const mod = this._modules[this._activeSystemId];
        if (!mod) return [];
        // 从 planets 中找出属于此系统的 key（以恒星 key 关联）
        // 简单方式：当前 physics 中的所有 body key
        return this.physics.bodies.map(b => b.key);
    }

    // ==================== 内部方法 ====================

    /** 销毁当前系统所有内容 */
    _destroyCurrent() {
        // 清除天体
        for (const body of [...this.physics.bodies]) {
            body.dispose();
            delete this.planets[body.key];
        }
        this.physics.bodies = [];

        // 清除卫星
        for (const key of Object.keys(this.allMoons)) {
            this.allMoons[key].forEach(m => m.dispose?.());
        }
        for (const key of Object.keys(this.allMoons)) {
            delete this.allMoons[key];
        }
    }

    /** 创建卫星 */
    _initMoons(moonClasses) {
        for (const [parentKey, classes] of Object.entries(moonClasses)) {
            const parent = this.planets[parentKey];
            if (!parent || !parent.mesh) continue;
            const moons = classes.map(Cls => new Cls(this.scene));
            if (moons.length > 0) this.allMoons[parentKey] = moons;
        }
    }

    /** 每帧更新卫星位置（由 main.js 的动画循环调用） */
    updateMoons(dt) {
        for (const [key, moons] of Object.entries(this.allMoons)) {
            const planet = this.planets[key];
            if (planet?.mesh?.visible) {
                updateMoons(moons, planet.mesh.position, dt);
            }
        }
    }
}
