// ============================================================
// HD219134g.js — HD 219134 g（外围超级地球）
// ============================================================

import { CelestialBody } from '../../js/CelestialBody.js';

export class HD219134g extends CelestialBody {

    static KEY           = 'hd219134g';
    static NAME          = 'HD 219134 g';
    static NAME_CN       = 'HD 219134 g';
    static MASS          = 1.10e25;       // ~11 M_E
    static RADIUS        = 1.40e7;        // ~2.2 R_E
    static ORBIT_RADIUS  = 0.375 * 1.495978707e11;
    static VISUAL_RADIUS = 0.50;
    static COLOR         = 0x88bbaa;
    static TEXTURE       = null;

    static DETAILS = `HD 219134 g — 系统外围超级地球

• 质量：约11 M🜨（1.10×10²⁵ kg）
• 半径：约14,000 km（约2.2 R🜨）
• 轨道半径：0.375 AU（约5,610万km）
• 公转周期：约94.2天
• 平衡温度：约250 K（接近地球）

【特征】
位于系统较外侧，平衡温度接近地球。
质量组成表明可能是具有较厚大气层的超级地球。`;

    static VOICE_INTRO = 'HD 219134 g，系统外侧的超级地球。温度适中，公转周期约94天。';

    constructor(scene) {
        super({
            key: HD219134g.KEY,
            name: HD219134g.NAME,
            nameCN: HD219134g.NAME_CN,
            mass: HD219134g.MASS,
            radius: HD219134g.RADIUS,
            orbitRadius: HD219134g.ORBIT_RADIUS,
            visualRadius: HD219134g.VISUAL_RADIUS,
            color: HD219134g.COLOR,
            texturePath: HD219134g.TEXTURE,
            details: HD219134g.DETAILS,
            voiceIntro: HD219134g.VOICE_INTRO,
            rotationSpeed: 1.0,
            scene,
        });
        this.position.set(HD219134g.ORBIT_RADIUS, 0, 0);
    }
}
