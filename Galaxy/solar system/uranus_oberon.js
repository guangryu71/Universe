// ============================================================
// uranus_oberon.js — 天卫四（Uranus IV - Oberon）
// ============================================================
import { MoonBody } from '../../js/MoonBody.js';
export class Uranus_Oberon extends MoonBody {
    static KEY = 'oberon'; static NAME = '天卫四'; static NAME_CN = 'Oberon';
    static MASS = 3.01e21; static RADIUS = 7.61e5;
    static PARENT_KEY = 'uranus'; static ORBIT_RADIUS = 2.2; static ORBIT_SPEED = 0.4;
    static VISUAL_RADIUS = 0.12; static COLOR = 0x99aabb; static TEXTURE = null;
    static DETAILS = '天卫四是天王星最外层的较大卫星，表面布满撞击坑，是天王星卫星中地质活动最少的之一。';
    static VOICE_INTRO = '天卫四，布满撞击坑的古老卫星。';
}
