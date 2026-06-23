// ============================================================
// HD219134d.js — HD 219134 d（冰巨星）
// ============================================================

import { CelestialBody } from '../../js/CelestialBody.js';

export class HD219134d extends CelestialBody {

    static KEY           = 'hd219134d';
    static NAME          = 'HD 219134 d';
    static NAME_CN       = 'HD 219134 d';
    static MASS          = 1.60e25;       // ~16 M_E
    static RADIUS        = 2.50e7;        // ~4.0 R_E
    static ORBIT_RADIUS  = 0.235 * 1.495978707e11;
    static VISUAL_RADIUS = 0.60;
    static COLOR         = 0x4488aa;
    static TEXTURE       = null;

    static DETAILS = `HD 219134 d — 系统中较大的行星

• 质量：约16 M🜨（1.60×10²⁵ kg）
• 半径：约25,000 km（约4.0 R🜨）
• 轨道半径：0.235 AU（约3,515万km）
• 公转周期：约46.7天
• 平衡温度：约330 K

【特征】
属于热海王星/冰巨星类别，可能拥有较丰富的挥发性物质。
其轨道在f和g之间，可能存在轨道共振。`;

    static VOICE_INTRO = 'HD 219134 d，系统外层的一颗冰巨星，质量是地球的16倍。';

    constructor(scene) {
        super({
            key: HD219134d.KEY,
            name: HD219134d.NAME,
            nameCN: HD219134d.NAME_CN,
            mass: HD219134d.MASS,
            radius: HD219134d.RADIUS,
            orbitRadius: HD219134d.ORBIT_RADIUS,
            visualRadius: HD219134d.VISUAL_RADIUS,
            color: HD219134d.COLOR,
            texturePath: HD219134d.TEXTURE,
            details: HD219134d.DETAILS,
            voiceIntro: HD219134d.VOICE_INTRO,
            rotationSpeed: 1.0,
            scene,
        });
        this.position.set(HD219134d.ORBIT_RADIUS, 0, 0);
    }
}
