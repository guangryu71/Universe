// ============================================================
// Mercury.js — 水星类
// 太阳系最小的行星，距离太阳最近
// ============================================================

import { CelestialBody } from '../../js/CelestialBody.js';

export class Mercury extends CelestialBody {

    static KEY           = 'mercury';
    static NAME          = '水星';
    static NAME_CN       = 'Mercury';
    static MASS          = 3.3011e23;
    static RADIUS        = 2.4397e6;
    static ORBIT_RADIUS  = 5.791e10;
    static VISUAL_RADIUS = 0.28;
    static COLOR         = 0xb0b0b0;
    static TEXTURE       = 'Galaxy/solar system/planets/2k/2k_mercury.jpg';

    static DETAILS = `水星是太阳系中最小的行星，也是距离太阳最近的行星。

【基本参数】
• 直径：约4,879 km
• 质量：约3.30×10²³ kg
• 表面温度：-180°C 到 430°C
• 自转周期：约59天
• 公转周期：约88天
• 轨道速度：约47.9 km/s
• 卫星数量：0
• 距太阳平均距离：约5,790万 km

【表面特征】
水星表面布满了撞击坑，外观类似月球。由于缺乏大气层，水星昼夜温差极大——面向太阳的一面可达430°C，背向太阳的一面可降至-180°C。水星拥有一个相对较大的铁核，占其体积的约42%。

【探索历史】
水星因靠近太阳而难以观测。NASA的"信使号"探测器于2011年至2015年环绕水星运行，提供了大量关于水星地质和磁场的珍贵数据。水星存在微弱的磁场，强度约为地球磁场的1%。

【独特现象】
水星的自转与公转存在3:2的轨道共振——水星每公转两圈，自转三圈。这意味着水星上的一天（从日出到日出）约等于两个水星年（176天）。`;

    static VOICE_INTRO = `水星，最小的行星，被太阳无情炙烤。表面温差可达六百摄氏度，没有大气层的保护，一片死寂。`;

    constructor(scene) {
        super({
            key: Mercury.KEY,
            name: Mercury.NAME,
            nameCN: Mercury.NAME_CN,
            mass: Mercury.MASS,
            radius: Mercury.RADIUS,
            orbitRadius: Mercury.ORBIT_RADIUS,
            visualRadius: Mercury.VISUAL_RADIUS,
            color: Mercury.COLOR,
            texturePath: Mercury.TEXTURE,
            details: Mercury.DETAILS,
            voiceIntro: Mercury.VOICE_INTRO,
            rotationSpeed: 0.5,
            scene,
        });
        this.position.set(Mercury.ORBIT_RADIUS, 0, 0);
    }
}
