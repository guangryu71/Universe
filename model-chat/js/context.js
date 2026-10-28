// ============================================================
// context.js — 星语 AI 的只读数据沙箱
//
// 设计约定：
//   * AI 永远拿不到 localStorage / 服务器 / DOM 的直接访问权。
//   * AI 只能在「数据检索规划」里输出若干 id；由本模块校验 id 是否
//     存在于当前数据库，再按白名单读取并整理成纯文本。
//   * 所有函数都是只读的，不执行 AI 生成的任何代码。
//   * 每个星体系统 / 每个星系都有独立的读取接口（getSystemInterface /
//     getGalaxyInterface），AI 按问题自行决定要拉取哪些。
// ============================================================

import { getAllGalaxies } from '../../js/galaxyRegistry.js?v=8';
import {
    loadUniverseGalaxies,
    loadBodyRelations,
    resolveSystemGalaxyId,
} from '../../js/UniverseRegistry.js?v=7';
import { AU } from '../../js/constants.js';

// 内置系统的卫星不包含在 getAllGalaxies() 的 planetInfo 里，
// 这里显式补上（自定义系统则直接读取 planets[].moons）。
// 注意：只有太阳系模块导出了 MOON_CLASSES，HD 219134 没有卫星。
import { MOON_CLASSES as SOLAR_MOONS } from '../../Galaxy/solar system/index.js';

const BUILTIN_MOONS = {
    'solar-system': SOLAR_MOONS,
};

const MAX_SYSTEMS = 8;
const MAX_GALAXIES = 6;
const MAX_CONTEXT_CHARS = 14000;
const MAX_DETAIL_FETCHES = 10;

// ==================== 小工具 ====================

function _clip(value, max) {
    const s = String(value ?? '').replace(/\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, max) + '…' : s;
}

function _num(value, digits = 3) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    if (n === 0) return '0';
    const abs = Math.abs(n);
    if (abs >= 1e6 || abs < 1e-3) return n.toExponential(digits);
    return String(Number(n.toPrecision(digits)));
}

function _km(meters) {
    const n = Number(meters);
    return Number.isFinite(n) ? _num(n / 1000, 4) + ' km' : '—';
}

function _au(meters) {
    const n = Number(meters);
    return Number.isFinite(n) ? _num(n / AU, 3) + ' AU' : '—';
}

function _mass(kg) {
    const n = Number(kg);
    if (!Number.isFinite(n)) return '—';
    return `${n.toExponential(3)} kg`;
}

function _walkTree(nodes, out) {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
        if (!node || typeof node !== 'object') continue;
        if (node.type === 'folder') _walkTree(node.children, out);
        else out.push(node);
    }
}

async function _fetchText(url) {
    if (!/^\/?detail_files\//.test(url)) return '';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
        const resp = await fetch(url, { signal: controller.signal });
        if (!resp.ok) return '';
        const text = await resp.text();
        return text.slice(0, 800);
    } catch {
        return '';
    } finally {
        clearTimeout(timer);
    }
}

/** 详情树 → 可读文本；.txt 内容若只在服务器上则按需读取（受次数上限保护） */
async function _treeText(tree, budget = 1200, fetches = { left: MAX_DETAIL_FETCHES }) {
    const flat = [];
    _walkTree(tree, flat);
    if (flat.length === 0) return { text: '', images: [] };

    const parts = [];
    const images = [];
    let used = 0;

    for (const node of flat) {
        if (used >= budget) break;
        if (node.type === 'image') {
            if (images.length < 10) images.push(_clip(node.name || '图片', 40));
            continue;
        }
        if (node.type !== 'text') continue;

        let content = typeof node.content === 'string' ? node.content : '';
        if (!content && node.url && fetches.left > 0) {
            fetches.left -= 1;
            content = await _fetchText(node.url);
        }
        if (!content) continue;

        const piece = `${_clip(node.name || '资料', 40)}：${_clip(content, Math.max(120, budget - used))}`;
        parts.push(piece);
        used += piece.length;
    }

    return {
        text: parts.join('\n'),
        images,
    };
}

function _moonInfo(galaxyId, body) {
    const inline = Array.isArray(body?.moons) ? body.moons : null;
    if (inline && inline.length) {
        return inline.map(m => ({
            name: m.name || m.nameCN || m.key || '卫星',
            nameCN: m.nameCN || '',
            massKg: m.mass,
            radius: m.radius,
            orbitRadius: m.orbitRadius,
            details: m.details || '',
        }));
    }

    const classes = BUILTIN_MOONS[galaxyId]?.[body?.key];
    if (!Array.isArray(classes)) return [];
    return classes.map(Cls => ({
        name: Cls.NAME || Cls.KEY || '卫星',
        nameCN: Cls.NAME_CN || '',
        massKg: Cls.MASS,
        radius: Cls.RADIUS,
        orbitRadius: Cls.ORBIT_RADIUS,
        orbitSpeed: Cls.ORBIT_SPEED,
        details: Cls.DETAILS || '',
    }));
}

// ==================== 目录 ====================

function _catalogText(systems, galaxies) {
    const galaxyById = new Map(galaxies.map(g => [g.id, g]));
    const systemLines = systems.map(s => {
        const gid = resolveSystemGalaxyId(s, galaxies);
        const galaxyName = galaxyById.get(gid)?.name || gid;
        const count = Array.isArray(s.planets) ? s.planets.length : 0;
        const desc = s.description ? ` | 简介=${_clip(s.description, 70)}` : '';
        return `- id=${s.id} | 名称=${s.nameCN || s.name} | 星系=${galaxyName} | 星体数=${count}${desc}`;
    });

    const galaxyLines = galaxies.map(g => {
        const members = systems.filter(s => resolveSystemGalaxyId(s, galaxies) === g.id).length;
        const desc = g.description ? ` | 简介=${_clip(g.description, 70)}` : '';
        return `- id=${g.id} | 名称=${g.nameCN || g.name} | 星体系统数=${members}${desc}`;
    });

    return `【星体系统目录】（共 ${systems.length} 个）\n${systemLines.join('\n') || '（空）'}\n\n【星系目录】（共 ${galaxies.length} 个）\n${galaxyLines.join('\n') || '（空）'}`;
}

/**
 * 读取数据库快照 + 紧凑目录（目录会随每次请求发送给 AI）。
 * @returns {Promise<{systems:Array, galaxies:Array, systemById:Map, galaxyById:Map, text:string}>}
 */
export async function buildCatalog() {
    const systems = getAllGalaxies();
    const galaxies = await loadUniverseGalaxies();
    return {
        systems,
        galaxies,
        systemById: new Map(systems.map(s => [s.id, s])),
        galaxyById: new Map(galaxies.map(g => [g.id, g])),
        text: _catalogText(systems, galaxies),
    };
}

// ==================== 单实体读取接口（白名单） ====================

/**
 * 星体系统接口：只接受目录中真实存在的 id，返回结构化只读数据。
 * @param {string} systemId
 * @param {{systems:Array, galaxies:Array}} snapshot
 */
export async function getSystemInterface(systemId, snapshot) {
    const system = snapshot?.systemById?.get(systemId)
        || snapshot?.systems?.find(s => s.id === systemId);
    if (!system) return null;

    const galaxies = snapshot.galaxies || [];
    const galaxyId = resolveSystemGalaxyId(system, galaxies);
    const galaxy = galaxies.find(g => g.id === galaxyId);
    const relations = await loadBodyRelations();
    const active = relations.filter(r => r.fromSystemId === system.id);
    const passive = relations.filter(r => r.toSystemId === system.id);

    const planets = Array.isArray(system.planets) ? system.planets : [];
    const bodies = [];
    for (let i = 0; i < planets.length; i++) {
        const p = planets[i];
        if (!p) continue;
        const isStar = !!p.isStar || (i === 0 && !planets.some(q => q?.isStar));
        const tree = await _treeText(p.detailTree, 600);
        bodies.push({
            key: p.key,
            name: p.name || p.nameCN || `星体${i + 1}`,
            nameCN: p.nameCN || '',
            isStar,
            massKg: p.mass,
            radiusKm: Number.isFinite(Number(p.radius)) ? Number(p.radius) / 1000 : null,
            orbitAu: Number.isFinite(Number(p.orbitRadius)) ? Number(p.orbitRadius) / AU : null,
            visualRadius: p.visualRadius,
            color: p.color,
            details: p.details || '',
            detailText: tree.text,
            surfaceImages: tree.images,
            moons: _moonInfo(system.id, p),
        });
    }

    return {
        id: system.id,
        name: system.nameCN || system.name,
        nameEN: system.name,
        description: system.description || '',
        galaxyId,
        galaxyName: galaxy?.nameCN || galaxy?.name || galaxyId,
        isBuiltIn: !!system.isBuiltIn,
        bodies,
        relations: { active, passive },
    };
}

/**
 * 星系接口：只接受目录中真实存在的星系 id。
 * @param {string} galaxyId
 * @param {{systems:Array, galaxies:Array}} snapshot
 */
export async function getGalaxyInterface(galaxyId, snapshot) {
    const galaxy = snapshot?.galaxyById?.get(galaxyId)
        || snapshot?.galaxies?.find(g => g.id === galaxyId);
    if (!galaxy) return null;

    const systems = snapshot.systems || [];
    const members = systems
        .filter(s => resolveSystemGalaxyId(s, snapshot.galaxies || []) === galaxy.id)
        .map(s => ({
            id: s.id,
            name: s.nameCN || s.name,
            bodyCount: Array.isArray(s.planets) ? s.planets.length : 0,
        }));

    const tree = await _treeText(galaxy.detailTree, 1200);

    return {
        id: galaxy.id,
        name: galaxy.nameCN || galaxy.name,
        nameEN: galaxy.name,
        description: galaxy.description || '',
        isDefault: !!galaxy.isDefault,
        detailText: tree.text,
        detailImages: tree.images,
        systems: members,
    };
}

// ==================== 规划结果 → 文本 ====================

function _formatRelation(rel, direction) {
    const arrow = direction === 'active' ? '主动 →' : '被动 ←';
    const from = `${rel.fromSystemId}/${rel.fromName || rel.fromKey}`;
    const to = `${rel.toSystemId}/${rel.toName || rel.toKey}`;
    return `${arrow} ${from} → ${to}`;
}

function _formatSystem(sys) {
    const lines = [];
    lines.push(`【星体系统】${sys.name}（id=${sys.id}${sys.nameEN ? '，英文名=' + sys.nameEN : ''}）`);
    lines.push(`所属星系：${sys.galaxyName}（id=${sys.galaxyId}）${sys.isBuiltIn ? ' · 内置系统' : ' · 自定义系统'}`);
    if (sys.description) lines.push(`简介：${_clip(sys.description, 300)}`);
    lines.push(`星体（${sys.bodies.length} 个）：`);

    sys.bodies.forEach((b, i) => {
        const tags = b.isStar ? '[恒星]' : '[行星]';
        lines.push(`${i + 1}. ${b.name}${b.nameCN && b.nameCN !== b.name ? '（' + b.nameCN + '）' : ''} ${tags} key=${b.key}`.trim());
        lines.push(`   质量=${_mass(b.massKg)} 半径=${b.radiusKm != null ? _num(b.radiusKm, 4) + ' km' : '—'} 轨道=${b.orbitAu != null ? _num(b.orbitAu, 3) + ' AU' : '—'} 视觉半径=${_num(b.visualRadius)} 颜色=${b.color || '—'}`);
        if (b.details && b.details.trim()) lines.push(`   详情：${_clip(b.details, 320)}`);
        if (b.detailText) lines.push(`   详细资料：${_clip(b.detailText, 500)}`);
        if (b.surfaceImages.length) lines.push(`   地表图片：${b.surfaceImages.join('、')}`);
        if (b.moons.length) {
            const names = b.moons.slice(0, 8).map(m => m.name).join('、');
            lines.push(`   卫星（${b.moons.length}）：${names}${b.moons.length > 8 ? '…' : ''}`);
        }
    });

    const rels = [
        ...sys.relations.active.map(r => _formatRelation(r, 'active')),
        ...sys.relations.passive.map(r => _formatRelation(r, 'passive')),
    ];
    if (rels.length) {
        lines.push('星体关联：');
        rels.slice(0, 20).forEach(r => lines.push('   ' + r));
    }

    return lines.join('\n');
}

function _formatGalaxy(gal) {
    const lines = [];
    lines.push(`【星系】${gal.name}（id=${gal.id}${gal.nameEN ? '，英文名=' + gal.nameEN : ''}）${gal.isDefault ? ' · 默认星系' : ''}`);
    if (gal.description) lines.push(`简介：${_clip(gal.description, 400)}`);
    if (gal.detailText) lines.push(`详细资料：${_clip(gal.detailText, 700)}`);
    if (gal.detailImages.length) lines.push(`星系图片：${gal.detailImages.join('、')}`);
    lines.push(`包含的星体系统（${gal.systems.length} 个）：`);
    if (gal.systems.length === 0) lines.push('   （空）');
    gal.systems.forEach(s => lines.push(`   - ${s.name}（id=${s.id}，星体 ${s.bodyCount} 个）`));
    return lines.join('\n');
}

/**
 * 按规划结果拉取数据，返回给模型的纯文本。
 * 任何 id 都必须先在目录里存在；数量与总长度都有硬上限。
 * @param {{systems?:string[], galaxies?:string[], relations?:boolean}} plan
 * @param {object} snapshot — buildCatalog() 的返回值
 */
export async function collectContext(plan, snapshot) {
    const wantedSystems = Array.isArray(plan?.systems)
        ? [...new Set(plan.systems.map(String))].filter(id => snapshot.systemById.has(id)).slice(0, MAX_SYSTEMS)
        : [];
    const wantedGalaxies = Array.isArray(plan?.galaxies)
        ? [...new Set(plan.galaxies.map(String))].filter(id => snapshot.galaxyById.has(id)).slice(0, MAX_GALAXIES)
        : [];

    const sections = [];
    const usedSystems = [];
    const usedGalaxies = [];
    let total = 0;
    let truncated = false;

    for (const id of wantedSystems) {
        const sys = await getSystemInterface(id, snapshot);
        if (!sys) continue;
        const text = _formatSystem(sys);
        if (total + text.length > MAX_CONTEXT_CHARS) { truncated = true; break; }
        sections.push(text);
        usedSystems.push(sys.name);
        total += text.length;
    }

    for (const id of wantedGalaxies) {
        const gal = await getGalaxyInterface(id, snapshot);
        if (!gal) continue;
        const text = _formatGalaxy(gal);
        if (total + text.length > MAX_CONTEXT_CHARS) { truncated = true; break; }
        sections.push(text);
        usedGalaxies.push(gal.name);
        total += text.length;
    }

    return {
        text: sections.join('\n\n'),
        systems: usedSystems,
        galaxies: usedGalaxies,
        truncated,
        chars: total,
    };
}

/** 给界面用的一句话摘要 */
export function describeContext(packet) {
    const parts = [];
    if (packet?.systems?.length) parts.push('星体系统：' + packet.systems.join('、'));
    if (packet?.galaxies?.length) parts.push('星系：' + packet.galaxies.join('、'));
    if (parts.length === 0) return '未调取项目数据';
    return parts.join('；') + (packet.truncated ? '（已截断）' : '');
}
