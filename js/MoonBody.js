// ============================================================
// MoonBody.js — 卫星基类（模板化设计）
// 与 CelestialBody 使用相同的静态属性模式，但：
//   1) 不加入 N体物理引擎，使用简单圆周轨道
//   2) 轨道中心为母行星，非恒星
//   3) 位置计算在场景空间中进行
// ============================================================

import * as THREE from 'three';
import { colorToHex } from './utils.js';
import { SYSTEM_SCALE } from './constants.js';

export class MoonBody {
    /**
     * 子类需定义以下静态属性：
     *   static KEY          = '<唯一标识>'
     *   static NAME         = '<中文名>'
     *   static NAME_CN      = '<英文名>'
     *   static MASS         = <质量 kg>
     *   static RADIUS       = <半径 m>
     *   static PARENT_KEY   = '<母行星 key>'     // 绕谁转
     *   static ORBIT_RADIUS = <场景单位>          // 距母行星的视觉距离
     *   static ORBIT_SPEED  = <弧度/秒>           // 轨道角速度
     *   static VISUAL_RADIUS = <视觉大小>
     *   static COLOR        = <颜色>
     *   static TEXTURE      = <贴图路径或 null>
     *   static DETAILS      = '<详细描述>'
     *   static VOICE_INTRO  = '<语音简介>'
     */

    constructor(scene) {
        const Cls = this.constructor;

        this.key          = Cls.KEY;
        this.name         = Cls.NAME;
        this.nameCN       = Cls.NAME_CN;
        this.mass         = Cls.MASS;
        this.radius       = Cls.RADIUS;
        this.parentKey    = Cls.PARENT_KEY;
        this.orbitRadius  = Cls.ORBIT_RADIUS * SYSTEM_SCALE;     // 场景单位
        this.orbitSpeed   = Cls.ORBIT_SPEED;       // rad/s
        this.orbitPhase   = Math.random() * Math.PI * 2; // 随机初始相位
        this.visualRadius = Cls.VISUAL_RADIUS * SYSTEM_SCALE;
        this.color        = Cls.COLOR;
        this.details      = Cls.DETAILS || '';
        this.voiceIntro   = Cls.VOICE_INTRO || '';

        // 创建网格
        const geo = new THREE.SphereGeometry(this.visualRadius, 24, 24);
        const mat = new THREE.MeshStandardMaterial({
            color: this.color,
            roughness: 0.7,
            metalness: 0.1,
        });
        this.mesh = new THREE.Mesh(geo, mat);
        this.mesh.userData = {
            isMoon: true,
            parentKey: this.parentKey,
            moonKey: this.key,
            moonBody: this,
        };
        scene.add(this.mesh);
    }

    /**
     * 每帧更新轨道位置
     * @param {THREE.Vector3} parentPos - 母行星的场景位置
     * @param {number} dt - 时间增量（秒）
     */
    update(parentPos, dt) {
        this.orbitPhase += this.orbitSpeed * dt;
        const x = parentPos.x + Math.cos(this.orbitPhase) * this.orbitRadius;
        const z = parentPos.z + Math.sin(this.orbitPhase) * this.orbitRadius;
        this.mesh.position.set(x, parentPos.y, z);
        // 微自转
        this.mesh.rotation.y += 0.5 * dt;
    }

    /** 清理 Three.js 资源 */
    dispose() {
        if (this.mesh) {
            this.mesh.geometry?.dispose();
            if (Array.isArray(this.mesh.material)) {
                this.mesh.material.forEach(m => m.dispose());
            } else {
                this.mesh.material?.dispose();
            }
            this.mesh.parent?.remove(this.mesh);
        }
    }
}
