// ============================================================
// mars_deimos.js — 火卫二（Mars II - Deimos）
// ============================================================

import { MoonBody } from '../../js/MoonBody.js';

export class Mars_Deimos extends MoonBody {
    static KEY = 'deimos';
    static NAME = '火卫二'; static NAME_CN = 'Deimos';
    static MASS = 1.48e15; static RADIUS = 6.2e3;
    static PARENT_KEY = 'mars'; static ORBIT_RADIUS = 0.85; static ORBIT_SPEED = 1.2;
    static VISUAL_RADIUS = 0.05; static COLOR = 0x9b8b7a; static TEXTURE = null;
    static DETAILS = '火卫二是火星较小的卫星，可能是被捕获的小行星，表面相对光滑，缺乏火卫一上的大型撞击坑。';
    static VOICE_INTRO = '火卫二，火星较小的卫星，一颗被捕获的小行星。';
}
