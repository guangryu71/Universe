// ============================================================
// jupiter_callisto.js — 木卫四（Jupiter IV - Callisto）
// ============================================================
import { MoonBody } from '../../js/MoonBody.js';
export class Jupiter_Callisto extends MoonBody {
    static KEY = 'callisto'; static NAME = '木卫四'; static NAME_CN = 'Callisto';
    static MASS = 1.08e23; static RADIUS = 2.41e6;
    static PARENT_KEY = 'jupiter'; static ORBIT_RADIUS = 5.0; static ORBIT_SPEED = 0.6;
    static VISUAL_RADIUS = 0.22; static COLOR = 0x555566; static TEXTURE = null;
    static DETAILS = '木卫四是伽利略卫星中最外层的一颗，表面布满撞击坑，是太阳系中撞击坑密度最高的天体之一。';
    static VOICE_INTRO = '木卫四，木星最外层的大卫星，表面的撞击坑记录着太阳系的古老历史。';
}
