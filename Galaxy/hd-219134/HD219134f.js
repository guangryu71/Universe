// ============================================================
// HD219134f.js — HD 219134 f（宜居带内缘超级地球）
// ============================================================

import { CelestialBody } from '../../js/CelestialBody.js';

export class HD219134f extends CelestialBody {

    static KEY           = 'hd219134f';
    static NAME          = 'HD 219134 f';
    static NAME_CN       = 'HD 219134 f';
    static MASS          = 7.00e24;       // ~7 M_E
    static RADIUS        = 1.15e7;        // ~1.8 R_E
    static ORBIT_RADIUS  = 0.146 * 1.495978707e11;
    static VISUAL_RADIUS = 0.48;
    static COLOR         = 0x66bb88;
    static TEXTURE       = null;

    static DETAILS = `HD 219134 f — 宜居带内缘超级地球

• 质量：约7 M🜨（7.00×10²⁴ kg）
• 半径：约11,500 km（约1.8 R🜨）
• 轨道半径：0.146 AU（约2,184万km）
• 公转周期：约22.8天
• 平衡温度：约450 K
• 非凌星

【特征】
位于系统宜居带内缘，可能是拥有较薄大气层的岩石行星。
质量表明它可能拥有较大的铁核和较薄的地幔。`;

    static VOICE_INTRO = 'HD 219134 f，系统宜居带内缘的超级地球。质量约为地球的7倍。';

    constructor(scene) {
        super({
            key: HD219134f.KEY,
            name: HD219134f.NAME,
            nameCN: HD219134f.NAME_CN,
            mass: HD219134f.MASS,
            radius: HD219134f.RADIUS,
            orbitRadius: HD219134f.ORBIT_RADIUS,
            visualRadius: HD219134f.VISUAL_RADIUS,
            color: HD219134f.COLOR,
            texturePath: HD219134f.TEXTURE,
            details: HD219134f.DETAILS,
            voiceIntro: HD219134f.VOICE_INTRO,
            rotationSpeed: 1.0,
            scene,
        });
        this.position.set(HD219134f.ORBIT_RADIUS, 0, 0);
    }
}
