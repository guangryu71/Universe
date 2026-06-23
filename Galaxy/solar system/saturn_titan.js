// ============================================================
// saturn_titan.js — 土卫六（Saturn VI - Titan）
// ============================================================
import { MoonBody } from '../../js/MoonBody.js';
export class Saturn_Titan extends MoonBody {
    static KEY = 'titan'; static NAME = '土卫六'; static NAME_CN = 'Titan';
    static MASS = 1.35e23; static RADIUS = 2.57e6;
    static PARENT_KEY = 'saturn'; static ORBIT_RADIUS = 3.0; static ORBIT_SPEED = 0.7;
    static VISUAL_RADIUS = 0.22; static COLOR = 0xddaa66; static TEXTURE = null;
    static DETAILS = '土卫六是太阳系中唯一拥有浓厚大气层的卫星，表面存在液态甲烷湖泊，被视为研究生命起源的天然实验室。';
    static VOICE_INTRO = '土卫六，泰坦星。浓厚大气下的甲烷湖泊，生命起源的天然实验室。';
}
