// ============================================================
// Earth.js — 地球类（真实贴图 + 云层 + 月球贴图）
// ============================================================

import * as THREE from 'three';
import { CelestialBody } from '../../js/CelestialBody.js';

const textureLoader = new THREE.TextureLoader();
const TEXTURE_BASE = 'Galaxy/solar system/planets/2k/';

export class Earth extends CelestialBody {

    static KEY           = 'earth';
    static NAME          = '地球';
    static NAME_CN       = 'Earth';
    static MASS          = 5.9724e24;
    static RADIUS        = 6.3710e6;
    static ORBIT_RADIUS  = 1.496e11;
    static VISUAL_RADIUS = 0.48;
    static COLOR         = 0x4488ff;
    static TEXTURE       = TEXTURE_BASE + '8k_earth_daymap.jpg';
    static CLOUDS        = TEXTURE_BASE + '2k_earth_clouds.jpg';

    static DETAILS = `地球是太阳系中第三颗行星，也是已知唯一存在生命的天体。

【基本参数】
• 直径：约12,742 km
• 质量：约5.97×10²⁴ kg
• 表面温度：约15°C（平均）
• 自转周期：约23小时56分（恒星日）
• 公转周期：约365.25天
• 轨道速度：约29.8 km/s
• 卫星数量：1（月球）
• 距太阳平均距离：约1.496亿 km（1 AU）
• 表面积：约5.1亿 km²（71%为海洋，29%为陆地）

【生命家园】
地球拥有液态水、适宜的大气层和磁场保护，这些条件共同孕育了丰富多彩的生命。从深海热泉到高山之巅，从热带雨林到极地冰盖，生命以惊人的多样性存在于地球的每个角落。地球是目前宇宙中唯一被确认存在生命的天体。

【内部结构】
地球由地壳、地幔、外核和内核组成。液态的外核产生了地球磁场，这个磁场（磁层）保护地表免受太阳风和宇宙射线的直接轰击，是维持地球宜居环境的重要因素。

【月球】
地球唯一的天然卫星——月球，直径约为3,474 km（地球的约四分之一）。月球引起地球的潮汐，稳定了地球的自转轴倾角（约23.5°），对地球气候的长期稳定起到了关键作用。月球距离地球约384,400 km，是人类唯一踏足过的地外天体。`;

    static VOICE_INTRO = `地球，我们的淡蓝家园。目前已知唯一存在生命的世界，拥有液态海洋、适宜的大气和保护性的磁场。`;

    constructor(scene) {
        super({
            key: Earth.KEY,
            name: Earth.NAME,
            nameCN: Earth.NAME_CN,
            mass: Earth.MASS,
            radius: Earth.RADIUS,
            orbitRadius: Earth.ORBIT_RADIUS,
            visualRadius: Earth.VISUAL_RADIUS,
            color: Earth.COLOR,
            texturePath: Earth.TEXTURE,
            details: Earth.DETAILS,
            voiceIntro: Earth.VOICE_INTRO,
            rotationSpeed: 1.0,
            scene,
        });
        this.position.set(Earth.ORBIT_RADIUS, 0, 0);
        this._addClouds(scene);
        // 月球由 moons.js 统一管理
    }

    // ---- 云层（半透明外层球） ----
    _addClouds(scene) {
        const cloudGeo = new THREE.SphereGeometry(this.visualRadius * 1.01, 64, 64);
        const cloudMat = new THREE.MeshStandardMaterial({
            transparent: true,
            opacity: 0.35,
            roughness: 0.9,
            metalness: 0,
            depthWrite: false,
        });

        textureLoader.load(
            Earth.CLOUDS,
            (tex) => { cloudMat.map = tex; cloudMat.needsUpdate = true; },
            undefined,
            () => console.warn('[Earth] 云层贴图加载失败')
        );

        this.cloudMesh = new THREE.Mesh(cloudGeo, cloudMat);
        this.cloudMesh.userData = { isAtmosphere: true };
        scene.add(this.cloudMesh);
    }

    // ---- 同步云层位置 ----
    _syncMeshPosition() {
        super._syncMeshPosition();
        if (this.cloudMesh) {
            this.cloudMesh.position.copy(this.mesh.position);
        }
    }

    updatePhysics(acceleration, dt) {
        super.updatePhysics(acceleration, dt);
        // 月球位置由 moons.js 统一管理
    }
}
