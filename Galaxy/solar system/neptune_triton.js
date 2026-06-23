// ============================================================
// neptune_triton.js — 海卫一（Neptune I - Triton）
// ============================================================
import { MoonBody } from '../../js/MoonBody.js';
export class Neptune_Triton extends MoonBody {
    static KEY = 'triton'; static NAME = '海卫一'; static NAME_CN = 'Triton';
    static MASS = 2.14e22; static RADIUS = 1.35e6;
    static PARENT_KEY = 'neptune'; static ORBIT_RADIUS = 1.6; static ORBIT_SPEED = 0.5;
    static VISUAL_RADIUS = 0.16; static COLOR = 0xccbbcc; static TEXTURE = null;
    static DETAILS = '海卫一是海王星最大的卫星，拥有逆行轨道（暗示它可能是一颗被捕获的柯伊伯带天体），表面有活跃的冰火山。';
    static VOICE_INTRO = '海卫一，被捕获的柯伊伯带天体。逆行轨道诉说它流浪的身世。';
}
