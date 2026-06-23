// ============================================================
// Uranus.js — 天王星类
// 太阳系第七颗行星，冰巨行星，自转轴几乎平躺
// ============================================================

import { CelestialBody } from '../../js/CelestialBody.js';

export class Uranus extends CelestialBody {

    static KEY           = 'uranus';
    static NAME          = '天王星';
    static NAME_CN       = 'Uranus';
    static MASS          = 8.6810e25;       // 质量 (kg)
    static RADIUS        = 2.5362e7;        // 实际半径 (m)
    static ORBIT_RADIUS  = 2.871e12;        // 轨道半径 (m) ≈ 19.19 AU
    static VISUAL_RADIUS = 0.75;            // 3D 显示半径
    static COLOR         = 0x7ec8e3;
    static TEXTURE       = 'Galaxy/solar system/planets/2k/2k_uranus.jpg';        // 淡青蓝色

    static DETAILS = `天王星是太阳系中第七颗行星，一颗冰巨行星，由威廉·赫歇尔于1781年发现。

【基本参数】
• 直径：约50,724 km（地球的4倍）
• 质量：约8.68×10²⁵ kg（地球的14.5倍）
• 云顶温度：约-224°C（太阳系最冷的行星大气层）
• 自转周期：约17.2小时
• 公转周期：约84年
• 轨道速度：约6.8 km/s
• 卫星数量：27（已知）
• 距太阳平均距离：约28.71亿 km

【发现历史】
天王星由威廉·赫歇尔于1781年发现，是第一颗使用望远镜发现的行星。它的发现将太阳系的已知边界扩展了一倍。天王星肉眼几乎不可见，需要借助望远镜才能分辨其圆面。

【奇特的自转】
天王星的自转轴几乎平躺在公转平面上（倾斜约98°），这意味着它的"南北极"交替面向太阳，造成极端的季节变化——每个极点会经历42年的持续日照，然后是42年的黑暗。这种极端的轴倾斜可能是由一颗地球大小的天体在太阳系早期撞击造成的。

【组成结构】
天王星与海王星同属"冰巨行星"，内部主要由水、甲烷和氨的"冰"（高温高压下的超临界流体）组成。其蓝绿色外观来自大气中的甲烷，甲烷吸收红光，反射蓝绿光，赋予了天王星独特的色彩。`;

    static VOICE_INTRO = `天王星，倾覆的行星。远古的撞击将它打翻在地，如今它像一只巨大的宇宙滚桶，侧躺着绕太阳运转。`;

    constructor(scene) {
        super({
            key: Uranus.KEY,
            name: Uranus.NAME,
            nameCN: Uranus.NAME_CN,
            mass: Uranus.MASS,
            radius: Uranus.RADIUS,
            orbitRadius: Uranus.ORBIT_RADIUS,
            visualRadius: Uranus.VISUAL_RADIUS,
            color: Uranus.COLOR,
            texturePath: Uranus.TEXTURE,
            details: Uranus.DETAILS,
            voiceIntro: Uranus.VOICE_INTRO,
            rotationSpeed: 1.4,
            scene,
        });
        this.position.set(Uranus.ORBIT_RADIUS, 0, 0);
    }
}
