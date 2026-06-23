// ============================================================
// uranus_titania.js — 天卫三（Uranus III - Titania）
// ============================================================
import { MoonBody } from '../../js/MoonBody.js';
export class Uranus_Titania extends MoonBody {
    static KEY = 'titania'; static NAME = '天卫三'; static NAME_CN = 'Titania';
    static MASS = 3.40e21; static RADIUS = 7.89e5;
    static PARENT_KEY = 'uranus'; static ORBIT_RADIUS = 1.8; static ORBIT_SPEED = 0.6;
    static VISUAL_RADIUS = 0.13; static COLOR = 0xaabbcc; static TEXTURE = null;
    static DETAILS = '天卫三是天王星最大的卫星，表面有巨大的峡谷和断层，暗示过去曾有过剧烈的地质活动。';
    static VOICE_INTRO = '天卫三，天王星最大的卫星，遍布峡谷与断层。';
}
