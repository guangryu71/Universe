// ============================================================
// Venus.js — 金星类
// 太阳系第二颗行星，最亮的行星，逆向自转
// ============================================================

import { CelestialBody } from '../../js/CelestialBody.js';

export class Venus extends CelestialBody {

    static KEY           = 'venus';
    static NAME          = '金星';
    static NAME_CN       = 'Venus';
    static MASS          = 4.8675e24;       // 质量 (kg)
    static RADIUS        = 6.0518e6;        // 实际半径 (m)
    static ORBIT_RADIUS  = 1.082e11;        // 轨道半径 (m) ≈ 0.723 AU
    static VISUAL_RADIUS = 0.45;            // 3D 显示半径
    static COLOR         = 0xe8cda0;        // 淡金色
    static TEXTURE       = 'Galaxy/solar system/planets/2k/2k_venus_atmosphere.jpg';

    static DETAILS = `金星是太阳系中第二颗行星，因其明亮的外观被称为"启明星"或"长庚星"。

【基本参数】
• 直径：约12,104 km（与地球相近）
• 质量：约4.87×10²⁴ kg
• 表面温度：约462°C（平均，太阳系行星最高）
• 自转周期：约243天（逆向自转）
• 公转周期：约225天
• 轨道速度：约35.0 km/s
• 卫星数量：0
• 距太阳平均距离：约1.082亿 km

【独特之处】
金星是太阳系中唯一逆向自转的行星（太阳从西边升起）。其浓厚的大气层（主要为二氧化碳）造成了极端的温室效应，使金星成为太阳系表面温度最高的行星，甚至比离太阳更近的水星还要热。

【大气环境】
金星表面大气压约为地球的92倍，云层由硫酸组成，表面温度足以熔化铅。金星表面被厚厚的云层完全遮蔽，可见光无法穿透——我们看到的"金星"其实是云层顶部的反射光。尽管环境极其恶劣，但科学家仍在研究金星云层中可能存在微生物的假说。

【探索历史】
苏联的"金星"系列探测器是迄今为止唯一在金星表面成功着陆并传回数据的探测器。近年来的研究发现了金星大气中可能存在磷化氢——一种在地球上与生命活动相关的分子——引发了关于金星生命可能性的热烈讨论。`;

    static VOICE_INTRO = `金星，启明星。浓密的云层之下是令人窒息的高压和漫无边际的火山平原。`;

    constructor(scene) {
        super({
            key: Venus.KEY,
            name: Venus.NAME,
            nameCN: Venus.NAME_CN,
            mass: Venus.MASS,
            radius: Venus.RADIUS,
            orbitRadius: Venus.ORBIT_RADIUS,
            visualRadius: Venus.VISUAL_RADIUS,
            color: Venus.COLOR,
            texturePath: Venus.TEXTURE,
            details: Venus.DETAILS,
            voiceIntro: Venus.VOICE_INTRO,
            rotationSpeed: -0.3,  // 逆向自转
            scene,
        });
        this.position.set(Venus.ORBIT_RADIUS, 0, 0);
    }
}
