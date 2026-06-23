// ============================================================
// jupiter_ganymede.js — 木卫三（Jupiter III - Ganymede）
// ============================================================
import { MoonBody } from '../../js/MoonBody.js';
export class Jupiter_Ganymede extends MoonBody {
    static KEY = 'ganymede'; static NAME = '木卫三'; static NAME_CN = 'Ganymede';
    static MASS = 1.48e23; static RADIUS = 2.63e6;
    static PARENT_KEY = 'jupiter'; static ORBIT_RADIUS = 4.2; static ORBIT_SPEED = 0.9;
    static VISUAL_RADIUS = 0.25; static COLOR = 0x999999; static TEXTURE = null;
    static DETAILS = '木卫三是太阳系最大的卫星，比水星还大。它是已知唯一拥有自身磁场的卫星。';
    static VOICE_INTRO = '木卫三，太阳系最大的卫星，比水星还大，拥有自己的磁场。';
}
