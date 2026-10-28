// ============================================================
// SystemManager.js — 系统切换管理器（独立场景组）
// 每个星体系统有独立的 THREE.Group，互不干扰
// 切换时：仅将当前系统的组显示，其他系统隐藏
// ============================================================

import * as THREE from 'three';
import { createMoons, updateMoons } from './moons.js';

export class SystemManager {
    /**
     * @param {object} deps
     * @param {object}  deps.planets    — { key: CelestialBody }
     * @param {object}  deps.physics    — PhysicsEngine
     * @param {THREE.Scene} deps.scene  — 主场景（包含星空/光照等公共资源）
     * @param {function} deps.onSwitch  — 切换回调 (newSystemId)
     * @param {function} deps.onDrawOrbits — 绘制轨道线
     * @param {object}  deps.allMoons   — { parentKey: [MoonBody] }
     */
    constructor({ planets, physics, scene, onSwitch, onDrawOrbits, allMoons }) {
        this.planets      = planets;
        this.physics      = physics;
        this.mainScene    = scene;
        this.onSwitch     = onSwitch || (() => {});
        this.onDrawOrbits = onDrawOrbits || (() => {});
        this.allMoons     = allMoons || {};

        /** @type {Object<string, { createPlanets: Function, moonClasses: Object }>} */
        this._modules = {};
        /** 每个系统独立的 Group { systemId: THREE.Group } */
        this._systemGroups = {};
        this._activeSystemId = null;
        this._moonKeys = [];
    }

    // ==================== 注册模块 ====================

    registerModule(id, createPlanetsFn, moonClasses = {}) {
        if (this._modules[id]) {
            console.warn(`[SystemManager] 模块 "${id}" 已注册`);
            return;
        }
        this._modules[id] = { createPlanets: createPlanetsFn, moonClasses };
        console.log(`[SystemManager] 注册模块: ${id}`);
    }

    // ==================== 切换系统 ====================

    switchTo(id) {
        if (id === this._activeSystemId) return;

        const mod = this._modules[id];
        const hasGroup = !!this._systemGroups[id];

        if (!mod && !hasGroup) {
            console.warn(`[SystemManager] 模块/系统组 "${id}" 未注册`);
            return;
        }

        console.log(`[SystemManager] 切换: ${this._activeSystemId} → ${id}`);

        // 1) 隐藏当前系统
        this._hideCurrent();

        // 2) 如果模块系统尚未创建，创建它（自定义系统组已由 GalaxyBrowser 创建）
        if (mod && !this._systemGroups[id]) {
            this._createSystemScene(id, mod);
        }

        // 3) 显示目标系统
        if (this._systemGroups[id]) {
            const group = this._systemGroups[id];
            group.visible = true;
            this.mainScene.add(group);
        }

        // 4) 同步物理引擎
        this._syncPhysicsToSystem(id);

        // 5) 绘制轨道线
        this.onDrawOrbits(id, this.mainScene);

        this._activeSystemId = id;
        this.onSwitch(id);
    }

    /** 为系统创建独立的 Group（包含所有天体 Mesh） */
    _createSystemScene(id, mod) {
        const group = new THREE.Group();
        group.visible = false;

        // 调用模块的 createPlanets，传入 group 作为 scene 替代
        // 注意：createPlanets 会创建 CelestialBody 并添加到传入的 scene/group
        // 我们需要拦截这个过程，让 CelestialBody 添加到 group 而非主场景
        const newPlanets = mod.createPlanets(this.mainScene);

        // 将所有天体的 mesh 从主场景移到 group
        for (const key of Object.keys(newPlanets)) {
            const body = newPlanets[key];
            this.planets[key] = body;

            if (body.mesh && body.mesh.parent) {
                body.mesh.parent.remove(body.mesh);
                group.add(body.mesh);
            }
            if (body.ringMesh) {
                if (body.ringMesh.parent) body.ringMesh.parent.remove(body.ringMesh);
                group.add(body.ringMesh);
            }
            if (body.glowMesh) {
                if (body.glowMesh.parent) body.glowMesh.parent.remove(body.glowMesh);
                group.add(body.glowMesh);
            }
            if (body.labelSprite) {
                if (body.labelSprite.parent) body.labelSprite.parent.remove(body.labelSprite);
                group.add(body.labelSprite);
            }
        }

        // 创建卫星（卫星的 mesh 也加入 group）
        this._initMoonsToGroup(mod.moonClasses, group);

        this._systemGroups[id] = group;

        // 天体数据暂存，供物理同步用
        if (!this._systemPlanetKeys) this._systemPlanetKeys = {};
        this._systemPlanetKeys[id] = Object.keys(newPlanets);

        return group;
    }

    /** 隐藏当前系统 */
    _hideCurrent() {
        if (this._activeSystemId && this._systemGroups[this._activeSystemId]) {
            const oldGroup = this._systemGroups[this._activeSystemId];
            oldGroup.visible = false;
            this.mainScene.remove(oldGroup);
        }

        // 从物理引擎移除当前系统所有天体
        for (const body of [...this.physics.bodies]) {
            this.physics.removeBody(body);
        }
    }

    /** 把指定系统的天体加入物理引擎 */
    _syncPhysicsToSystem(id) {
        const keys = this._systemPlanetKeys?.[id] || [];
        for (const key of keys) {
            const body = this.planets[key];
            if (body) {
                this.physics.addBody(body);
            }
        }
    }

    /** 创建卫星并加入 Group（初始化用） */
    _initMoonsToGroup(moonClasses, group) {
        for (const [parentKey, classes] of Object.entries(moonClasses)) {
            const parent = this.planets[parentKey];
            if (!parent || !parent.mesh) continue;
            const moons = classes.map(Cls => new Cls(this.mainScene));
            for (const m of moons) {
                if (m.mesh && m.mesh.parent) {
                    m.mesh.parent.remove(m.mesh);
                    group.add(m.mesh);
                }
            }
            if (moons.length > 0) this.allMoons[parentKey] = moons;
        }
    }

    /** 从外部注册一个已经创建好的系统组（用于 GalaxyBrowser 自定义星系） */
    registerSystemGroup(id, group, bodyKeys) {
        if (this._systemGroups[id]) {
            console.warn(`[SystemManager] 系统组 "${id}" 已存在`);
            return;
        }
        this._systemGroups[id] = group;
        if (!this._systemPlanetKeys) this._systemPlanetKeys = {};
        this._systemPlanetKeys[id] = bodyKeys;
        group.visible = false;
        console.log(`[SystemManager] 注册自定义系统组: ${id} (${bodyKeys.length} 天体)`);
    }

    /**
     * 系统在被编辑后已由外部销毁并重建（GalaxyBrowser 再次编译 / 导入导出）。
     * 如果它正是当前活跃系统，需要重新挂载新组并同步物理引擎。
     */
    refreshActiveSystem(id) {
        if (this._activeSystemId !== id) return;
        const group = this._systemGroups[id];
        if (!group) return;
        group.visible = true;
        this.mainScene.add(group);
        this._syncPhysicsToSystem(id);
        this.onDrawOrbits(id, this.mainScene);
        this.onSwitch(id);
    }

    /** 获取当前活跃系统 ID */
    getActiveSystemId() { return this._activeSystemId; }

    /** 获取当前系统所有天体 key */
    getActiveKeys() {
        if (!this._activeSystemId) return [];
        return this._systemPlanetKeys?.[this._activeSystemId] || [];
    }

    /** 每帧更新卫星位置 */
    updateMoons(dt) {
        for (const [key, moons] of Object.entries(this.allMoons)) {
            const planet = this.planets[key];
            if (planet?.mesh?.visible) {
                updateMoons(moons, planet.mesh.position, dt);
            }
        }
    }
}
