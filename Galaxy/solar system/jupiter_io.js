// ============================================================
// jupiter_io.js — 木卫一（Jupiter I - Io）
// ============================================================
import { MoonBody } from '../../js/MoonBody.js';
export class Jupiter_Io extends MoonBody {
    static KEY = 'io'; static NAME = '木卫一'; static NAME_CN = 'Io';
    static MASS = 8.93e22; static RADIUS = 1.82e6;
    static PARENT_KEY = 'jupiter'; static ORBIT_RADIUS = 2.8; static ORBIT_SPEED = 1.5;
    static VISUAL_RADIUS = 0.2; static COLOR = 0xffcc44; static TEXTURE = null;
    static DETAILS = '木卫一是太阳系中火山活动最活跃的天体，拥有超过400座活火山。潮汐加热使其内部持续保持熔融状态。';
    static VOICE_INTRO = '木卫一，太阳系火山最活跃的世界。潮汐加热让它熔岩不息。';
}
