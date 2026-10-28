// ============================================================
// Blueprint.js — AI 星体系统蓝图（纯数据，不含任何可执行代码）
//
// 职责：
//   1. 校验并规整 AI 输出的 JSON 蓝图（字段/单位/范围白名单）
//   2. 按模式确定性地计算初始位置与速度（SI 单位）
//
// 模式：
//   planetary — 中心恒星 + 行星圆轨道
//   binary    — 两颗恒星绕共同质心（双星纠缠），额外天体为环双星轨道
//   triple    — 分层三星：内双星 + 绕双星公转的第三颗星
//   figure8   — 经典三体八字舞（Chenciner–Montgomery 解）
//   free      — 按距离/方位/显式速度自由排布
// ============================================================

const AU = 1.495978707e11;
const G = 6.6743e-11;

const MAX_BODIES = 16;
const MODES = ['planetary', 'binary', 'triple', 'figure8', 'free'];
const PALETTE = ['#ffcc00', '#ff8844', '#66ccff', '#aaddff', '#b3ff99', '#ff99cc', '#ddaaff', '#ffdd66'];

export const BLUEPRINT_SCHEMA_DOC = `蓝图 JSON 结构：
{
  "name": "系统名称（中文，<= 40 字）",
  "description": "一句话描述",
  "mode": "planetary | binary | triple | figure8 | free",
  "separationAu": 0.4,          // binary：两颗恒星的间距（AU）
  "innerSeparationAu": 0.25,    // triple：内双星间距（AU）
  "outerOrbitAu": 3.0,          // triple：第三颗星绕内双星的轨道半径（AU）
  "scaleAu": 1.0,               // figure8：八字舞的整体尺度（AU）
  "bodies": [
    {
      "name": "天体名称",
      "type": "star | planet",
      "mass": 1.989e30,         // 必须，单位 kg
      "radius": 6.96e8,         // 必须，单位 m
      "color": "#ffcc00",
      "orbitAu": 1.0,           // planetary：轨道半径；binary/triple/figure8 的额外天体：环系统轨道半径
      "angleDeg": 0,            // 初始方位角（度），省略时程序自动均布
      "distanceAu": 1.0,        // 仅 free：距原点的距离
      "velocityKms": 30,        // 仅 free：初速度大小（km/s）
      "directionDeg": 90        // 仅 free：初速度方向（度，0 = +X 轴）
    }
  ]
}

模式约定：
- planetary：bodies[0] 是中心恒星并固定在原点；其余天体必须给 orbitAu。
- binary：bodies[0] 与 bodies[1] 是两颗恒星，间距由 separationAu 决定；其余天体用 orbitAu 环双星公转。
- triple：bodies[0] + bodies[1] 组成内双星，bodies[2] 绕内双星公转；其余天体用 orbitAu 环三星公转。
- figure8：bodies[0..2] 三颗质量接近的天体做经典八字轨道，整体尺度由 scaleAu 决定。
- free：按 distanceAu + angleDeg 放置，可用 velocityKms + directionDeg 指定初速度；未给速度时程序按圆轨道近似。

限制：天体数量 1 ~ 16；质量 1e18 ~ 1e35 kg；半径 1e5 ~ 1e10 m；orbitAu 0.01 ~ 300；角度可为负数。`;

function _num(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function _clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function _positive(value) {
    const n = _num(value);
    return n !== null && n > 0 ? n : null;
}

function _text(value, max) {
    if (typeof value !== 'string') return '';
    return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

function _color(value, index) {
    if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim())) {
        return value.trim().toLowerCase();
    }
    return PALETTE[index % PALETTE.length];
}

function _deg(deg) {
    return (deg * Math.PI) / 180;
}

function _goldenAngle(index) {
    return _deg((index * 137.508) % 360);
}

function _visualRadius(radiusMeters, isStar) {
    // 恒星：按半径对数映射到 1.4 ~ 3.0，避免近距离双星在视觉上粘在一起
    // 行星：跟真实半径的平方根相关，避免巨行星把整个场景吞掉
    if (isStar) {
        const t = _clamp(Math.log10(Math.max(radiusMeters, 1e8) / 1e8) / 2, 0, 1);
        return 1.4 + t * 1.6;
    }
    const base = Math.sqrt(Math.max(radiusMeters, 1e5) / 6.371e6) * 0.5;
    return _clamp(base, 0.16, 3.2);
}

/**
 * 校验 / 规整 AI 蓝图。
 * 致命错误（返回 ok:false）会触发一次 AI 修复重试；其余问题只记录 notes。
 * @returns {{ok:boolean, blueprint?:object, errors:string[], notes:string[]}}
 */
export function normalizeBlueprint(raw) {
    const errors = [];
    const notes = [];

    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { ok: false, errors: ['输出必须是一个 JSON 对象。'], notes };
    }

    const rawBodies = Array.isArray(raw.bodies) ? raw.bodies : [];
    if (rawBodies.length === 0) {
        return { ok: false, errors: ['缺少 bodies 数组，且至少需要 1 个天体。'], notes };
    }
    if (rawBodies.length > MAX_BODIES) {
        notes.push(`天体数量超过上限，已截取前 ${MAX_BODIES} 个。`);
    }

    const mode = MODES.includes(raw.mode) ? raw.mode : 'planetary';
    if (raw.mode !== mode) notes.push(`未知 mode，已按 planetary 处理。`);

    const bodies = [];
    rawBodies.slice(0, MAX_BODIES).forEach((item, index) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            notes.push(`第 ${index + 1} 个天体格式无效，已跳过。`);
            return;
        }

        let mass = _positive(item.mass);
        if (mass === null) {
            mass = item.type === 'star' ? 1.989e30 : 5.972e24;
            notes.push(`第 ${index + 1} 个天体缺少质量，已按${item.type === 'star' ? '恒星' : '行星'}默认值处理。`);
        }
        const clampedMass = _clamp(mass, 1e18, 1e35);
        if (clampedMass !== mass) notes.push(`第 ${index + 1} 个天体质量已限制在 1e18 ~ 1e35 kg。`);
        mass = clampedMass;

        const isStar = item.type === 'star' || (item.type !== 'planet' && mass >= 1e29);
        let radius = _positive(item.radius);
        if (radius === null) {
            radius = isStar ? 6.96e8 : 6.371e6;
            notes.push(`第 ${index + 1} 个天体缺少半径，已使用默认值。`);
        }
        const clampedRadius = _clamp(radius, 1e5, 1e10);
        if (clampedRadius !== radius) notes.push(`第 ${index + 1} 个天体半径已限制在 1e5 ~ 1e10 m。`);
        radius = clampedRadius;

        const orbitAu = _num(item.orbitAu);
        const distanceAu = _num(item.distanceAu);
        const angleDeg = _num(item.angleDeg);
        const velocityKms = _num(item.velocityKms);
        const directionDeg = _num(item.directionDeg);

        bodies.push({
            name: _text(item.name, 40) || `${isStar ? '恒星' : '行星'} ${index + 1}`,
            type: isStar ? 'star' : 'planet',
            isStar,
            mass,
            radius,
            color: _color(item.color, index),
            orbitAu: orbitAu === null ? null : _clamp(orbitAu, 0.01, 300),
            distanceAu: distanceAu === null ? null : _clamp(distanceAu, 0.005, 500),
            angleDeg: angleDeg === null ? null : angleDeg % 360,
            velocityKms: velocityKms === null ? null : _clamp(velocityKms, 0, 10000),
            directionDeg: directionDeg === null ? null : directionDeg % 360,
        });
    });

    if (bodies.length === 0) {
        return { ok: false, errors: ['bodies 中没有有效的天体。'], notes };
    }

    const pick = (key, min, max) => {
        const n = _num(raw[key]);
        return n === null ? null : _clamp(n, min, max);
    };

    return {
        ok: true,
        errors,
        notes,
        blueprint: {
            name: _text(raw.name, 40) || 'AI 星体系统',
            description: _text(raw.description, 200),
            mode,
            separationAu: pick('separationAu', 0.01, 100),
            innerSeparationAu: pick('innerSeparationAu', 0.01, 100),
            outerOrbitAu: pick('outerOrbitAu', 0.05, 300),
            scaleAu: pick('scaleAu', 0.05, 50),
            bodies,
        },
    };
}

// ---------- 组装工具 ----------

function _state(body, position, velocity) {
    return {
        name: body.name,
        type: body.type,
        isStar: body.isStar,
        mass: body.mass,
        radius: body.radius,
        color: body.color,
        visualRadius: _visualRadius(body.radius, body.isStar),
        position: { x: position.x, y: 0, z: position.z },
        velocity: { x: velocity.x, y: 0, z: velocity.z },
    };
}

function _circular(position, velocity, radius, centralMass, angle) {
    const speed = Math.sqrt((G * centralMass) / Math.max(radius, 1));
    position.x = radius * Math.cos(angle);
    position.z = radius * Math.sin(angle);
    velocity.x = -Math.sin(angle) * speed;
    velocity.z = Math.cos(angle) * speed;
}

function _orbitAround(cx, cz, radius, centralMass, angle) {
    const speed = Math.sqrt((G * centralMass) / Math.max(radius, 1));
    return {
        position: { x: cx + radius * Math.cos(angle), z: cz + radius * Math.sin(angle) },
        velocity: { x: -Math.sin(angle) * speed, z: Math.cos(angle) * speed },
    };
}

function _planetary(bp, out) {
    const central = bp.bodies[0];
    out.push(_state(central, { x: 0, z: 0 }, { x: 0, z: 0 }));

    for (let i = 1; i < bp.bodies.length; i++) {
        const body = bp.bodies[i];
        const rAu = body.orbitAu ?? 0.6 + (i - 1) * 0.85;
        const angle = body.angleDeg !== null ? _deg(body.angleDeg) : _goldenAngle(i);
        const position = { x: 0, z: 0 };
        const velocity = { x: 0, z: 0 };
        _circular(position, velocity, rAu * AU, central.mass, angle);
        out.push(_state(body, position, velocity));
    }
}

function _binary(bp, out) {
    const a = bp.bodies[0];
    const b = bp.bodies[1];
    if (!b) {
        _planetary(bp, out);
        return;
    }

    const m1 = a.mass;
    const m2 = b.mass;
    const total = m1 + m2;
    const sepAu = bp.separationAu ?? b.orbitAu ?? 0.4;
    const separation = Math.max(sepAu * AU, (a.radius + b.radius) * 1.2);
    const r1 = (separation * m2) / total;
    const r2 = (separation * m1) / total;
    const theta = _deg(a.angleDeg ?? 0);
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const relSpeed = Math.sqrt((G * total) / separation);
    const v1 = (relSpeed * m2) / total;
    const v2 = (relSpeed * m1) / total;

    out.push(_state(a, { x: r1 * c, z: r1 * s }, { x: -v1 * s, z: v1 * c }));
    out.push(_state(b, { x: -r2 * c, z: -r2 * s }, { x: v2 * s, z: -v2 * c }));

    for (let i = 2; i < bp.bodies.length; i++) {
        const body = bp.bodies[i];
        const rAu = body.orbitAu ?? 1.2 + (i - 2) * 0.9;
        const angle = body.angleDeg !== null ? _deg(body.angleDeg) : _goldenAngle(i);
        const orbit = _orbitAround(0, 0, rAu * AU, total, angle);
        out.push(_state(body, orbit.position, orbit.velocity));
    }
}

function _triple(bp, out) {
    if (bp.bodies.length < 3) {
        _binary(bp, out);
        return;
    }

    const a = bp.bodies[0];
    const b = bp.bodies[1];
    const third = bp.bodies[2];
    const m1 = a.mass;
    const m2 = b.mass;
    const m3 = third.mass;
    const m12 = m1 + m2;
    const total = m12 + m3;

    let innerSep = (bp.innerSeparationAu ?? b.orbitAu ?? 0.25) * AU;
    const outerR = Math.max((bp.outerOrbitAu ?? third.orbitAu ?? 2.5) * AU, 1);
    // 保持层级结构：内双星必须明显小于外层轨道
    innerSep = Math.min(innerSep, outerR / 2.2);
    innerSep = Math.max(innerSep, (a.radius + b.radius) * 1.2);

    const theta = _deg(third.angleDeg ?? a.angleDeg ?? 0);
    const c = Math.cos(theta);
    const s = Math.sin(theta);

    const aInner = (outerR * m3) / total;
    const aThird = (outerR * m12) / total;
    const outerSpeed = Math.sqrt((G * total) / outerR);
    const vInner = (outerSpeed * m3) / total;
    const vThird = (outerSpeed * m12) / total;

    const r1 = (innerSep * m2) / m12;
    const r2 = (innerSep * m1) / m12;
    const innerSpeed = Math.sqrt((G * m12) / innerSep);
    const v1 = (innerSpeed * m2) / m12;
    const v2 = (innerSpeed * m1) / m12;

    out.push(_state(a,
        { x: (aInner + r1) * c, z: (aInner + r1) * s },
        { x: -(vInner + v1) * s, z: (vInner + v1) * c }));
    out.push(_state(b,
        { x: (aInner - r2) * c, z: (aInner - r2) * s },
        { x: -(vInner - v2) * s, z: (vInner - v2) * c }));
    out.push(_state(third,
        { x: -aThird * c, z: -aThird * s },
        { x: vThird * s, z: -vThird * c }));

    for (let i = 3; i < bp.bodies.length; i++) {
        const body = bp.bodies[i];
        const rAu = body.orbitAu ?? (outerR / AU) * 1.8 + (i - 3) * 1.2;
        const angle = body.angleDeg !== null ? _deg(body.angleDeg) : _goldenAngle(i);
        const orbit = _orbitAround(0, 0, rAu * AU, total, angle);
        out.push(_state(body, orbit.position, orbit.velocity));
    }
}

function _figureEight(bp, out) {
    if (bp.bodies.length < 3) {
        _triple(bp, out);
        return;
    }

    const trio = bp.bodies.slice(0, 3);
    const scale = (bp.scaleAu ?? 1.0) * AU;
    const meanMass = (trio[0].mass + trio[1].mass + trio[2].mass) / 3;
    const velScale = Math.sqrt((G * meanMass) / scale);

    // Chenciner–Montgomery 八字解（G = m = 1 的无量纲初始条件）
    const canonical = [
        { p: [-0.97000436, 0.24308753], v: [0.466203685, 0.43236573] },
        { p: [0.97000436, -0.24308753], v: [0.466203685, 0.43236573] },
        { p: [0, 0], v: [-0.93240737, -0.86473146] },
    ];

    for (let i = 0; i < 3; i++) {
        const item = canonical[i];
        out.push(_state(trio[i],
            { x: item.p[0] * scale, z: item.p[1] * scale },
            { x: item.v[0] * velScale, z: item.v[1] * velScale }));
    }

    const total = trio.reduce((sum, b) => sum + b.mass, 0);
    for (let i = 3; i < bp.bodies.length; i++) {
        const body = bp.bodies[i];
        const rAu = body.orbitAu ?? 3.5 + (i - 3) * 1.2;
        const angle = body.angleDeg !== null ? _deg(body.angleDeg) : _goldenAngle(i);
        const orbit = _orbitAround(0, 0, rAu * AU, total, angle);
        out.push(_state(body, orbit.position, orbit.velocity));
    }
}

function _free(bp, out) {
    const bodies = bp.bodies;

    // 找主导天体（质量明显最大）：其余天体默认绕它做圆轨道
    let dominant = null;
    if (bodies.length >= 2) {
        const sorted = [...bodies].sort((x, y) => y.mass - x.mass);
        if (sorted[0].mass >= sorted[1].mass * 5) dominant = sorted[0];
    }

    const placements = bodies.map((body, i) => {
        const rAu = body.distanceAu ?? body.orbitAu ?? (dominant === body ? 0 : 1.0 + 0.7 * i);
        const angle = body.angleDeg !== null ? _deg(body.angleDeg) : _goldenAngle(i);
        return {
            body,
            x: rAu * AU * Math.cos(angle),
            z: rAu * AU * Math.sin(angle),
        };
    });

    const totalMass = bodies.reduce((sum, b) => sum + b.mass, 0);

    for (const p of placements) {
        const body = p.body;
        let velocity = { x: 0, z: 0 };

        if (body.velocityKms !== null) {
            const dir = _deg(body.directionDeg ?? 0);
            velocity.x = Math.cos(dir) * body.velocityKms * 1000;
            velocity.z = Math.sin(dir) * body.velocityKms * 1000;
        } else if (dominant && body !== dominant) {
            const dx = p.x - placements.find(q => q.body === dominant).x;
            const dz = p.z - placements.find(q => q.body === dominant).z;
            const r = Math.hypot(dx, dz);
            if (r > 1) {
                const phi = Math.atan2(dz, dx);
                const speed = Math.sqrt((G * dominant.mass) / r);
                velocity.x = -Math.sin(phi) * speed;
                velocity.z = Math.cos(phi) * speed;
            }
        } else if (dominant !== body) {
            const r = Math.hypot(p.x, p.z);
            if (r > 1) {
                const phi = Math.atan2(p.z, p.x);
                const speed = Math.sqrt((G * totalMass) / r);
                velocity.x = -Math.sin(phi) * speed;
                velocity.z = Math.cos(phi) * speed;
            }
        }

        out.push(_state(body, { x: p.x, z: p.z }, velocity));
    }
}

/**
 * 蓝图 → 初始状态（SI 单位）。
 * @param {object} blueprint normalizeBlueprint().blueprint
 * @returns {{name:string, description:string, mode:string, bodies:Array}}
 */
export function computeAssembly(blueprint) {
    const bp = blueprint;
    const out = [];

    if (bp.mode === 'binary') _binary(bp, out);
    else if (bp.mode === 'triple') _triple(bp, out);
    else if (bp.mode === 'figure8') _figureEight(bp, out);
    else if (bp.mode === 'free') _free(bp, out);
    else _planetary(bp, out);

    // 兜底：任何非法数值都退化为静止在原点，避免污染物理引擎
    for (const body of out) {
        for (const key of ['x', 'y', 'z']) {
            if (!Number.isFinite(body.position[key])) body.position[key] = 0;
            if (!Number.isFinite(body.velocity[key])) body.velocity[key] = 0;
        }
    }

    return {
        name: bp.name,
        description: bp.description,
        mode: bp.mode,
        bodies: out,
    };
}

const MODE_LABELS = {
    planetary: '行星系',
    binary: '双星系统',
    triple: '分层三星系统',
    figure8: '三体八字系统',
    free: '自由排布',
};

/** 给 UI 用的摘要 */
export function describeAssembly(assembly) {
    const stars = assembly.bodies.filter(b => b.isStar).length;
    const planets = assembly.bodies.length - stars;
    let extentAu = 0;
    for (const body of assembly.bodies) {
        extentAu = Math.max(extentAu, Math.hypot(body.position.x, body.position.z) / AU);
    }
    return {
        count: assembly.bodies.length,
        stars,
        planets,
        extentAu,
        mode: assembly.mode,
        label: `${MODE_LABELS[assembly.mode] || assembly.mode} · ${assembly.bodies.length} 个天体` +
            (stars ? `（${stars} 恒星` : '（') + (planets ? ` / ${planets} 行星）` : '）') +
            ` · 半径 ${extentAu.toFixed(2)} AU`,
    };
}
