// ============================================================
// Mars.js — 火星类
// 太阳系第四颗行星，"红色星球"，人类移民首选目标
// ============================================================

import { CelestialBody } from '../../js/CelestialBody.js';

export class Mars extends CelestialBody {

    static KEY           = 'mars';
    static NAME          = '火星';
    static NAME_CN       = 'Mars';
    static MASS          = 6.4171e23;       // 质量 (kg)
    static RADIUS        = 3.3895e6;        // 实际半径 (m)
    static ORBIT_RADIUS  = 2.279e11;        // 轨道半径 (m) ≈ 1.524 AU
    static VISUAL_RADIUS = 0.32;            // 3D 显示半径
    static COLOR         = 0xe07040;
    static TEXTURE       = 'Galaxy/solar system/planets/2k/2k_mars.jpg';        // 红褐色

    static DETAILS = `火星是太阳系中第四颗行星，因其红色外观被称为"红色星球"。

【基本参数】
• 直径：约6,779 km（约为地球的一半）
• 质量：约6.42×10²³ kg
• 表面温度：约-63°C（平均），-140°C 到 20°C
• 自转周期：约24.6小时
• 公转周期：约687天
• 轨道速度：约24.1 km/s
• 卫星数量：2（火卫一 Phobos、火卫二 Deimos）
• 距太阳平均距离：约2.279亿 km

【探索热点】
火星是除地球外人类探索最多的行星。目前已有多辆火星车（如"好奇号"、"毅力号"）在火星表面工作，发现了古代河流和湖泊的证据，表明火星曾经拥有液态水和更浓厚的大气层。

【地理特征】
火星拥有太阳系最高的山——奥林帕斯山（约21.9 km），以及最大的峡谷——水手号谷（长约4,000 km）。火星两极覆盖着由水冰和干冰组成的极冠。

【殖民前景】
火星被视为人类未来最有可能移民的地外行星。SpaceX等公司和多国航天机构正在积极规划载人火星任务，目标是在本世纪实现人类登陆火星。火星上的一天接近地球的24小时，存在水冰资源，重力约为地球的38%，这些条件使其成为太阳系中最适合人类移居的行星。`;

    static VOICE_INTRO = `火星，红色星球。锈红色的荒漠与高耸的火山诉说着曾经的湿润过往，如今寒冷沉寂，静候人类的足迹。`;

    constructor(scene) {
        super({
            key: Mars.KEY,
            name: Mars.NAME,
            nameCN: Mars.NAME_CN,
            mass: Mars.MASS,
            radius: Mars.RADIUS,
            orbitRadius: Mars.ORBIT_RADIUS,
            visualRadius: Mars.VISUAL_RADIUS,
            color: Mars.COLOR,
            texturePath: Mars.TEXTURE,
            details: Mars.DETAILS,
            voiceIntro: Mars.VOICE_INTRO,
            rotationSpeed: 0.9,
            scene,
        });
        this.position.set(Mars.ORBIT_RADIUS, 0, 0);
    }
}
