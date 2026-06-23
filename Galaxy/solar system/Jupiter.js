// ============================================================
// Jupiter.js — 木星类
// 太阳系最大行星，气态巨行星，拥有大红斑
// ============================================================

import { CelestialBody } from '../../js/CelestialBody.js';

export class Jupiter extends CelestialBody {

    static KEY           = 'jupiter';
    static NAME          = '木星';
    static NAME_CN       = 'Jupiter';
    static MASS          = 1.8982e27;       // 质量 (kg)
    static RADIUS        = 6.9911e7;        // 实际半径 (m)
    static ORBIT_RADIUS  = 7.786e11;        // 轨道半径 (m) ≈ 5.203 AU
    static VISUAL_RADIUS = 1.8;             // 3D 显示半径
    static COLOR         = 0xd4b896;
    static TEXTURE       = 'Galaxy/solar system/planets/2k/2k_jupiter.jpg';        // 米棕色

    static DETAILS = `木星是太阳系中最大的行星，一颗气态巨行星，质量是其他所有行星总和的2.5倍。

【基本参数】
• 直径：约139,820 km（地球的11倍）
• 质量：约1.90×10²⁷ kg（地球的318倍）
• 云顶温度：约-145°C
• 自转周期：约9.9小时（太阳系最快）
• 公转周期：约11.86年
• 轨道速度：约13.1 km/s
• 卫星数量：95+（已知）
• 距太阳平均距离：约7.786亿 km

【结构与特征】
木星主要由氢和氦组成，没有固体表面。其标志性的大红斑是一个比地球还大的反气旋风暴，已持续存在超过350年。木星拥有强大的磁场（约为地球的20,000倍）和微弱的环系统。

【保护者角色】
木星强大的引力场像一个"宇宙吸尘器"，保护了内太阳系（包括地球）免受许多小行星和彗星的撞击。最著名的事件是1994年苏梅克-列维9号彗星撞击木星，展示了木星对内太阳系的保护作用。

【伽利略卫星】
木星的四大卫星——伊奥（Io）、欧罗巴（Europa）、甘尼米德（Ganymede）和卡利斯托（Callisto）——由伽利略于1610年发现。其中欧罗巴冰层下可能存在液态海洋，是寻找地外生命的热门目标。甘尼米德是太阳系最大的卫星，比水星还大。`;

    static VOICE_INTRO = `木星，行星之王。质量超过其他所有行星的总和。标志性的大红斑是一场已肆虐数百年的超级风暴。`;

    constructor(scene) {
        super({
            key: Jupiter.KEY,
            name: Jupiter.NAME,
            nameCN: Jupiter.NAME_CN,
            mass: Jupiter.MASS,
            radius: Jupiter.RADIUS,
            orbitRadius: Jupiter.ORBIT_RADIUS,
            visualRadius: Jupiter.VISUAL_RADIUS,
            color: Jupiter.COLOR,
            texturePath: Jupiter.TEXTURE,
            details: Jupiter.DETAILS,
            voiceIntro: Jupiter.VOICE_INTRO,
            rotationSpeed: 2.0,
            scene,
        });
        this.position.set(Jupiter.ORBIT_RADIUS, 0, 0);
    }
}
