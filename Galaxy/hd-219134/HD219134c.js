// ============================================================
// HD219134c.js — HD 219134 c（热海王星）
// ============================================================

import { CelestialBody } from '../../js/CelestialBody.js';

export class HD219134c extends CelestialBody {

    static KEY           = 'hd219134c';
    static NAME          = 'HD 219134 c';
    static NAME_CN       = 'HD 219134 c';
    static MASS          = 1.09e25;       // ~11 M_E
    static RADIUS        = 2.10e7;        // ~3.3 R_E
    static ORBIT_RADIUS  = 0.065 * 1.495978707e11;
    static VISUAL_RADIUS = 0.25;
    static COLOR         = 0x5599cc;
    static TEXTURE       = null;

    static DETAILS = `HD 219134 c — 热海王星，系统第二颗行星

• 质量：约11 M🜨（1.09×10²⁵ kg）
• 半径：约21,000 km（约3.3 R🜨）
• 轨道半径：0.065 AU（约972万km）
• 公转周期：约6.76天
• 平衡温度：约800 K
• 非凌星（轨道倾角不在地球视线方向）

【特征】
属于热海王星类别，可能拥有浓厚的氢氦大气层。
其质量介于地球和海王星之间，代表了银河系中最常见的一类行星。`;

    static VOICE_INTRO = 'HD 219134 c，一颗热海王星。质量约为地球的11倍，公转周期不到7天。';

    constructor(scene) {
        super({
            key: HD219134c.KEY,
            name: HD219134c.NAME,
            nameCN: HD219134c.NAME_CN,
            mass: HD219134c.MASS,
            radius: HD219134c.RADIUS,
            orbitRadius: HD219134c.ORBIT_RADIUS,
            visualRadius: HD219134c.VISUAL_RADIUS,
            color: HD219134c.COLOR,
            texturePath: HD219134c.TEXTURE,
            details: HD219134c.DETAILS,
            voiceIntro: HD219134c.VOICE_INTRO,
            rotationSpeed: 1.0,
            scene,
        });
        this.position.set(HD219134c.ORBIT_RADIUS, 0, 0);
    }
}
