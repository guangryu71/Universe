// ============================================================
// HD219134b.js — HD 219134 b（凌星超级地球）
// ============================================================

import { CelestialBody } from '../../js/CelestialBody.js';

export class HD219134b extends CelestialBody {

    static KEY           = 'hd219134b';
    static NAME          = 'HD 219134 b';
    static NAME_CN       = 'HD 219134 b';
    static MASS          = 4.50e24;       // ~4.5 M_E
    static RADIUS        = 9.20e6;        // ~1.44 R_E
    static ORBIT_RADIUS  = 0.0385 * 1.495978707e11;
    static VISUAL_RADIUS = 0.45;
    static COLOR         = 0xcc6644;
    static TEXTURE       = null;

    static DETAILS = `HD 219134 b — 凌星超级地球，系统中最重要的行星

• 质量：约4.5 M🜨（4.50×10²⁴ kg）
• 半径：约9,200 km（约1.44 R🜨）
• 轨道半径：0.0385 AU（约576万km）
• 公转周期：约3.09天
• 平衡温度：约1,100 K
• 密度：约3.5 g/cm³（介于地球和火星之间）
• 凌星：是！这是少数可用JWST进行凌星光谱的超级地球

【科学意义】
HD 219134 b是距离地球最近的凌星超级地球之一，是研究系外行星大气、
内部结构和形成演化的理想目标。JWST已将其列为重点观测对象，
可能揭示其大气成分和表面环境。`;

    static VOICE_INTRO = 'HD 219134 b，一颗近距离的凌星超级地球。绕母星仅需3天，是JWST重点观测目标之一。';

    constructor(scene) {
        super({
            key: HD219134b.KEY,
            name: HD219134b.NAME,
            nameCN: HD219134b.NAME_CN,
            mass: HD219134b.MASS,
            radius: HD219134b.RADIUS,
            orbitRadius: HD219134b.ORBIT_RADIUS,
            visualRadius: HD219134b.VISUAL_RADIUS,
            color: HD219134b.COLOR,
            texturePath: HD219134b.TEXTURE,
            details: HD219134b.DETAILS,
            voiceIntro: HD219134b.VOICE_INTRO,
            rotationSpeed: 1.0,
            scene,
        });
        this.position.set(HD219134b.ORBIT_RADIUS, 0, 0);
    }
}
