// ============================================================
// mars_phobos.js — 火卫一（Mars I - Phobos）
// ============================================================

import { MoonBody } from '../../js/MoonBody.js';

export class Mars_Phobos extends MoonBody {
    static KEY          = 'phobos';
    static NAME         = '火卫一';
    static NAME_CN      = 'Phobos';
    static MASS         = 1.06e16;
    static RADIUS       = 1.1e4;
    static PARENT_KEY   = 'mars';
    static ORBIT_RADIUS = 0.6;
    static ORBIT_SPEED  = 1.8;
    static VISUAL_RADIUS = 0.06;
    static COLOR        = 0x8b7355;
    static TEXTURE      = null;
    static DETAILS = `火卫一是火星两颗卫星中较大的一颗，形状不规则，正缓慢螺旋靠近火星，预计数千万年后将解体。`;
    static VOICE_INTRO = '火卫一，火星最大的卫星。正缓慢螺旋坠向火星表面。';
}
