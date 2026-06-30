// ============================================================
// HD219134Star.js — HD 219134 中心恒星（K3V 型橙矮星）
// ============================================================

import { CelestialBody } from '../../js/CelestialBody.js';

export class HD219134Star extends CelestialBody {

    static KEY           = 'hd219134';
    static NAME          = 'HD 219134';
    static NAME_CN       = 'HD 219134';
    static MASS          = 1.57e30;       // ~0.79 M☉
    static RADIUS        = 5.94e8;        // ~0.85 R☉
    static ORBIT_RADIUS  = 0;
    static VISUAL_RADIUS = 0.6;
    static COLOR         = 0xff8844;
    static TEXTURE       = null;

    static DETAILS = `HD 219134（HR 8832）是一颗K3V型橙矮星，距地球约21光年。

【基本参数】
• 质量：约0.79 M☉（1.57×10³⁰ kg）
• 半径：约594,000 km（0.85 R☉）
• 表面温度：约4,830 K（比太阳低约1,000 K）
• 光度：约0.36 L☉
• 金属丰度：[Fe/H] = +0.09（略高于太阳）
• 年龄：约120亿年（比太阳古老得多）
• 视星等：+5.57（肉眼隐约可见）
• 星座：仙后座

【行星系统】
HD 219134 拥有至少6颗已确认行星，其中b为凌星超级地球，
可通过JWST进行大气成分分析。系统结构紧凑，类似缩小版的太阳系。`;

    static VOICE_INTRO = 'HD 219134，一颗古老的橙矮星，距地球21光年。它拥有至少6颗行星，其中一颗是罕见的凌星超级地球。';

    constructor(scene) {
        super({
            key: HD219134Star.KEY,
            name: HD219134Star.NAME,
            nameCN: HD219134Star.NAME_CN,
            mass: HD219134Star.MASS,
            radius: HD219134Star.RADIUS,
            orbitRadius: HD219134Star.ORBIT_RADIUS,
            visualRadius: HD219134Star.VISUAL_RADIUS,
            color: HD219134Star.COLOR,
            texturePath: HD219134Star.TEXTURE,
            details: HD219134Star.DETAILS,
            voiceIntro: HD219134Star.VOICE_INTRO,
            rotationSpeed: 0.15,
            scene,
        });
        this.position.set(0, 0, 0);
    }
}
