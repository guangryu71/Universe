// ============================================================
// constants.js — 物理常量、缩放比例、格式化工具
// 星球具体数据定义在各 Galaxy/solar system/*.js 类中
// ============================================================

// 引力常量 (m^3 kg^-1 s^-2)
export const G = 6.67430e-11;

// 天文单位 (m)
export const AU = 1.495978707e11;

// 光速 (m/s)
export const C = 2.99792458e8;

// 一天秒数
export const DAY = 86400;

// 视觉缩放：物理位置 → 3D 位置缩放因子（1 AU ≈ 22 个 3D 单位）
export const POS_SCALE = 22 / AU;

// 星体系统整体放大倍率（增大星体相对飞船的视觉大小）
export const SYSTEM_SCALE = 20;

// 模拟参数：每帧模拟时间步长（秒），约半天
export const SIM_DT = 43200;

// 子步数（提高精度）
export const SUBSTEPS = 4;

// --- 辅助：质量格式化 ---
export function formatMass(kg) {
    if (kg >= 1e27) return (kg / 1e27).toFixed(2) + ' × 10²⁷ kg';
    if (kg >= 1e24) return (kg / 1e24).toFixed(2) + ' × 10²⁴ kg';
    if (kg >= 1e21) return (kg / 1e21).toFixed(2) + ' × 10²¹ kg';
    return kg.toExponential(2) + ' kg';
}

// --- 辅助：距离格式化（光年/光分/光秒） ---
export function formatLightDistance(meters) {
    const lightSecond = C;
    const lightMinute = C * 60;
    const lightHour = C * 3600;
    const lightYear = C * DAY * 365.25;

    if (meters >= lightYear * 0.01) {
        return (meters / lightYear).toFixed(4) + ' 光年';
    } else if (meters >= lightHour) {
        return (meters / lightHour).toFixed(2) + ' 光时';
    } else if (meters >= lightMinute) {
        return (meters / lightMinute).toFixed(2) + ' 光分';
    } else {
        return (meters / lightSecond).toFixed(1) + ' 光秒';
    }
}

// --- 辅助：直径格式化 ---
export function formatDiameter(radiusMeters) {
    const diameter = radiusMeters * 2;
    if (diameter >= 1e9) return (diameter / 1e9).toFixed(2) + ' 百万 km';
    if (diameter >= 1e6) return (diameter / 1e3).toFixed(0) + ' km';
    return diameter.toFixed(0) + ' m';
}
