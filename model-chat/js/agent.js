// ============================================================
// agent.js — 星语的数据检索代理
//
// 流程（两段式，模型只思考、程序只读数据）：
//   1. 目录 + 用户问题 → 规划器输出 {"systems":[...],"galaxies":[...]}
//   2. 程序按 id 白名单读取 → 拼成资料块 → 最终回答
//
// 模型无法直接访问数据库，也不会执行任何代码。
// ============================================================

import { chatOnce } from './api.js?v=2';
import { buildPlannerPrompt } from './prompts.js?v=2';

const MAX_SYSTEMS = 8;
const MAX_GALAXIES = 6;

function _extractJsonObject(raw) {
    if (typeof raw !== 'string') return null;
    let text = raw.trim();
    if (!text) return null;

    // 兼容模型偶尔套上的 ```json ``` 代码块
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) text = fenced[1].trim();

    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;

    try {
        return JSON.parse(text.slice(start, end + 1));
    } catch {
        return null;
    }
}

function _stringList(value, max) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    const out = [];
    for (const item of value) {
        if (typeof item !== 'string') continue;
        const id = item.trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push(id);
        if (out.length >= max) break;
    }
    return out;
}

/**
 * 解析规划器输出；无法解析时返回 null（调用方回退到“只用目录”回答）。
 */
export function parsePlan(raw) {
    const json = _extractJsonObject(raw);
    if (!json || typeof json !== 'object') return null;
    return {
        systems: _stringList(json.systems, MAX_SYSTEMS),
        galaxies: _stringList(json.galaxies, MAX_GALAXIES),
        relations: json.relations === true,
        reason: typeof json.reason === 'string' ? json.reason.slice(0, 200) : '',
    };
}

/**
 * 让 AI 先决定要拉取哪些数据。
 * @param {string} question 用户问题
 * @param {string} catalogText buildCatalog().text
 * @returns {Promise<{systems:string[], galaxies:string[], relations:boolean, reason:string}|null>}
 */
export async function planDataNeeds(question, catalogText) {
    const raw = await chatOnce(
        [{ role: 'user', content: String(question || '') }],
        buildPlannerPrompt(catalogText),
        { maxTokens: 400, temperature: 0, timeoutMs: 60000 }
    );
    return parsePlan(raw);
}

export function isEmptyPlan(plan) {
    return !plan || (plan.systems.length === 0 && plan.galaxies.length === 0);
}
