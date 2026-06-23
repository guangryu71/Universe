// ============================================================
// HD219134h.js — HD 219134 h（冷气态巨行星）
// ============================================================

import { CelestialBody } from '../../js/CelestialBody.js';

export class HD219134h extends CelestialBody {

    static KEY           = 'hd219134h';
    static NAME          = 'HD 219134 h';
    static NAME_CN       = 'HD 219134 h';
    static MASS          = 6.80e25;       // ~68 M_E ≈ 0.21 M_J
    static RADIUS        = 4.50e7;        // ~7.0 R_E
    static ORBIT_RADIUS  = 3.6 * 1.495978707e11;
    static VISUAL_RADIUS = 0.85;
    static COLOR         = 0xccbb99;
    static TEXTURE       = null;

    static DETAILS = `HD 219134 h — 系统最外侧的巨行星

• 质量：约68 M🜨（6.80×10²⁵ kg，约0.21倍木星质量）
• 半径：约45,000 km
• 轨道半径：3.6 AU（约5.4亿km）
• 公转周期：约6.15年（约2,247天）
• 平衡温度：约90 K（极冷）

【特征】
系统最外侧的行星，是一颗气态巨行星类似于缩小的土星。
轨道距离远、表面温度极低，可能拥有水冰云层。`;

    static VOICE_INTRO = 'HD 219134 h，系统最外侧的冷气态巨行星。质量约为地球的68倍，公转一周需要6年。';

    constructor(scene) {
        super({
            key: HD219134h.KEY,
            name: HD219134h.NAME,
            nameCN: HD219134h.NAME_CN,
            mass: HD219134h.MASS,
            radius: HD219134h.RADIUS,
            orbitRadius: HD219134h.ORBIT_RADIUS,
            visualRadius: HD219134h.VISUAL_RADIUS,
            color: HD219134h.COLOR,
            texturePath: HD219134h.TEXTURE,
            details: HD219134h.DETAILS,
            voiceIntro: HD219134h.VOICE_INTRO,
            rotationSpeed: 1.0,
            scene,
        });
        this.position.set(HD219134h.ORBIT_RADIUS, 0, 0);
    }
}
