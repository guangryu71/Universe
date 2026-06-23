// ============================================================
// saturn_enceladus.js — 土卫二（Saturn II - Enceladus）
// ============================================================
import { MoonBody } from '../../js/MoonBody.js';
export class Saturn_Enceladus extends MoonBody {
    static KEY = 'enceladus'; static NAME = '土卫二'; static NAME_CN = 'Enceladus';
    static MASS = 1.08e20; static RADIUS = 2.52e5;
    static PARENT_KEY = 'saturn'; static ORBIT_RADIUS = 2.2; static ORBIT_SPEED = 0.5;
    static VISUAL_RADIUS = 0.1; static COLOR = 0xf0f8ff; static TEXTURE = null;
    static DETAILS = '土卫二南极有冰火山喷发现象，向太空喷射水冰和有机分子，其地下海洋可能具备生命所需条件。';
    static VOICE_INTRO = '土卫二，冰火山喷射有机分子。地下海洋隐藏着地外生命的希望。';
}
