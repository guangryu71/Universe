// ============================================================
// jupiter_europa.js — 木卫二（Jupiter II - Europa）
// ============================================================
import { MoonBody } from '../../js/MoonBody.js';
export class Jupiter_Europa extends MoonBody {
    static KEY = 'europa'; static NAME = '木卫二'; static NAME_CN = 'Europa';
    static MASS = 4.80e22; static RADIUS = 1.56e6;
    static PARENT_KEY = 'jupiter'; static ORBIT_RADIUS = 3.4; static ORBIT_SPEED = 1.2;
    static VISUAL_RADIUS = 0.18; static COLOR = 0xddeeff; static TEXTURE = null;
    static DETAILS = '木卫二冰层下存在液态海洋，水量可能是地球的两倍，是太阳系中寻找地外生命最重要的目标之一。';
    static VOICE_INTRO = '木卫二，冰封世界下藏着液态海洋，太阳系最可能存在地外生命的地方之一。';
}
