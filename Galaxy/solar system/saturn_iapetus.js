// ============================================================
// saturn_iapetus.js — 土卫八（Saturn VIII - Iapetus）
// ============================================================
import { MoonBody } from '../../js/MoonBody.js';
export class Saturn_Iapetus extends MoonBody {
    static KEY = 'iapetus'; static NAME = '土卫八'; static NAME_CN = 'Iapetus';
    static MASS = 1.81e21; static RADIUS = 7.35e5;
    static PARENT_KEY = 'saturn'; static ORBIT_RADIUS = 5.0; static ORBIT_SPEED = 0.3;
    static VISUAL_RADIUS = 0.11; static COLOR = 0x888888; static TEXTURE = null;
    static DETAILS = '土卫八以极端的双色表面闻名——一半亮如雪，一半暗如炭，这种色彩差异的原因至今仍有争议。';
    static VOICE_INTRO = '土卫八，双色卫星——一半亮如冰雪，一半暗如焦炭。';
}
