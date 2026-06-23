// ============================================================
// saturn_rhea.js — 土卫五（Saturn V - Rhea）
// ============================================================
import { MoonBody } from '../../js/MoonBody.js';
export class Saturn_Rhea extends MoonBody {
    static KEY = 'rhea'; static NAME = '土卫五'; static NAME_CN = 'Rhea';
    static MASS = 2.31e21; static RADIUS = 7.64e5;
    static PARENT_KEY = 'saturn'; static ORBIT_RADIUS = 3.6; static ORBIT_SPEED = 0.4;
    static VISUAL_RADIUS = 0.12; static COLOR = 0xcccccc; static TEXTURE = null;
    static DETAILS = '土卫五是土星第二大卫星，主要由水冰和岩石组成，表面有微弱的氧大气层——太阳系中罕见的特征。';
    static VOICE_INTRO = '土卫五，土星的第二大卫星，拥有微弱的大气层。';
}
