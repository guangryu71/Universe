// ============================================================
// Neptune.js — 海王星类
// 太阳系第八颗行星，距离太阳最远，通过数学预言发现
// ============================================================

import { CelestialBody } from '../../js/CelestialBody.js';

export class Neptune extends CelestialBody {

    static KEY           = 'neptune';
    static NAME          = '海王星';
    static NAME_CN       = 'Neptune';
    static MASS          = 1.02413e26;      // 质量 (kg)
    static RADIUS        = 2.4622e7;        // 实际半径 (m)
    static ORBIT_RADIUS  = 4.498e12;        // 轨道半径 (m) ≈ 30.07 AU
    static VISUAL_RADIUS = 0.7;             // 3D 显示半径
    static COLOR         = 0x4060ff;
    static TEXTURE       = 'Galaxy/solar system/planets/2k/2k_neptune.jpg';        // 深蓝色

    static DETAILS = `海王星是太阳系中第八颗行星，也是距离太阳最远的行星，一颗冰巨行星。

【基本参数】
• 直径：约49,244 km（地球的3.9倍）
• 质量：约1.02×10²⁶ kg（地球的17.1倍）
• 云顶温度：约-218°C
• 自转周期：约16.1小时
• 公转周期：约164.8年
• 轨道速度：约5.4 km/s
• 卫星数量：16（已知）
• 距太阳平均距离：约44.98亿 km
• 风速：太阳系最快（可达2,100 km/h）

【数学预言——笔尖上的发现】
海王星是唯一通过数学计算预言而非直接观测发现的行星。天文学家通过天王星轨道的异常推测出它的存在，法国数学家勒维耶和英国天文学家亚当斯分别独立计算出了海王星的位置。1846年，德国天文学家伽勒根据勒维耶的计算在预言位置找到了海王星——这一事件被誉为"牛顿力学的伟大胜利"。

【极端环境】
海王星的蓝色外观源于大气中的甲烷。尽管距离太阳遥远，海王星内部却异常活跃，拥有太阳系中最强的风暴和最极端的天气现象。海王星是太阳系中距太阳最远的行星，接收到的太阳能量仅为地球的约千分之一，但其内部热源使其大气活动远超预期。

【海卫一】
海王星最大的卫星海卫一（Triton）是太阳系中最冷的天体之一（约-235°C），拥有活跃的冰火山，喷发出的是氮冰和尘埃。海卫一的逆行轨道暗示它可能是一颗被海王星捕获的柯伊伯带天体。`;

    static VOICE_INTRO = `海王星，太阳系最后一颗行星。深蓝色的冰巨星，拥有太阳系最快的风暴，风速超过每小时两千公里。`;

    constructor(scene) {
        super({
            key: Neptune.KEY,
            name: Neptune.NAME,
            nameCN: Neptune.NAME_CN,
            mass: Neptune.MASS,
            radius: Neptune.RADIUS,
            orbitRadius: Neptune.ORBIT_RADIUS,
            visualRadius: Neptune.VISUAL_RADIUS,
            color: Neptune.COLOR,
            texturePath: Neptune.TEXTURE,
            details: Neptune.DETAILS,
            voiceIntro: Neptune.VOICE_INTRO,
            rotationSpeed: 1.4,
            scene,
        });
        this.position.set(Neptune.ORBIT_RADIUS, 0, 0);
    }
}
