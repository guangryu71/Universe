// ============================================================
// earth_moon.js — 月球（地球的天然卫星）
// ============================================================

import { MoonBody } from '../../js/MoonBody.js';

export class Earth_Moon extends MoonBody {
    static KEY          = 'moon';
    static NAME         = '月球';
    static NAME_CN      = 'Moon';
    static MASS         = 7.349e22;
    static RADIUS       = 1.737e6;
    static PARENT_KEY   = 'earth';
    static ORBIT_RADIUS = 1.2;
    static ORBIT_SPEED  = 0.8;
    static VISUAL_RADIUS = 0.12;
    static COLOR        = 0xcccccc;
    static TEXTURE      = null;
    static DETAILS = `月球是地球唯一的天然卫星，直径约3,474 km，距地球约384,400 km。月球引起地球潮汐，稳定了地球自转轴。人类于1969年首次登月。`;
    static VOICE_INTRO = '月球，地球唯一的天然卫星。人类唯一踏足过的地外天体。';
}
