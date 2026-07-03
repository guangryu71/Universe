// ============================================================
// Sun.js — 太阳类（无光晕，球体即显示大小）
// ============================================================

import * as THREE from 'three';
import { CelestialBody } from '../../js/CelestialBody.js';

const textureLoader = new THREE.TextureLoader();

export class Sun extends CelestialBody {

    static KEY           = 'sun';
    static NAME          = '太阳';
    static NAME_CN       = 'Sun';
    static MASS          = 1.989e30;
    static RADIUS        = 6.9634e8;
    static ORBIT_RADIUS  = 0;
    static VISUAL_RADIUS = 5.0;
    static COLOR         = 0xffcc00;
    static TEXTURE       = 'Galaxy/solar system/planets/2k/2k_sun.jpg';

    static DETAILS = `太阳是太阳系的中心恒星，一颗黄矮星（G型主序星）。

【基本参数】
• 直径：约1,392,700 km（地球的109倍）
• 质量：约1.989×10³⁰ kg（地球的33万倍）
• 表面温度：约5,500°C
• 核心温度：约1,500万°C
• 自转周期：约25天（赤道）
• 光谱类型：G2V
• 年龄：约46亿年
• 距银河系中心：约26,000光年

【能量来源】
太阳通过核心的核聚变反应，每秒将约6亿吨氢转化为氦，释放出相当于数十亿颗核弹的能量。这些能量以电磁辐射的形式向外传播，经过约8分20秒抵达地球，为地球提供生命所需的光和热。

【太阳活动】
太阳表面存在太阳黑子、耀斑和日冕物质抛射等剧烈活动。太阳黑子是表面温度相对较低的区域，由强磁场抑制对流所致。太阳活动周期约为11年，活动剧烈时可能对地球的通信和电网造成影响。

【未来演化】
大约50亿年后，太阳将耗尽核心的氢燃料，膨胀为红巨星（届时可能吞噬地球轨道），最终外层物质散逸形成行星状星云，核心坍缩为白矮星。`;

    static VOICE_INTRO = `太阳，一颗壮丽的G型恒星，太阳系的心脏。核心一千五百万度的高温驱动着核聚变，照亮并束缚着所有行星。四十六亿年了，它仍在燃烧。`;

    constructor(scene) {
        super({
            key: Sun.KEY,
            name: Sun.NAME,
            nameCN: Sun.NAME_CN,
            mass: Sun.MASS,
            radius: Sun.RADIUS,
            orbitRadius: Sun.ORBIT_RADIUS,
            visualRadius: Sun.VISUAL_RADIUS,
            color: Sun.COLOR,
            details: Sun.DETAILS,
            voiceIntro: Sun.VOICE_INTRO,
            texturePath: Sun.TEXTURE,
            rotationSpeed: 0.2,
            scene,
        });
        this.position.set(0, 0, 0);
        this._setupSun(scene);
    }

    _setupSun(scene) {
        // 太阳不发光但用 AdditiveBlending 增强亮度
        this.mesh.material.emissive = this.color;
        this.mesh.material.emissiveIntensity = 0.8;
    }

    // 使用 CelestialBody 默认的 _syncMeshPosition，使太阳可被黑洞引力拉动
}
