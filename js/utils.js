// ============================================================
// utils.js — 共享 DOM、几何、颜色、存储工具
// 消除项目中的重复代码模式
// ============================================================
import * as THREE from 'three';

// --- NDC 坐标转换（统一 ui.js + BodyEditor.js 的 3 行重复） ---
export function screenToNDC(event, canvas) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
        y: -((event.clientY - rect.top) / rect.height) * 2 + 1,
    };
}

// --- 颜色转 hex 字符串（统一 4 处重复） ---
export function colorToHex(color) {
    return '#' + new THREE.Color(color).getHexString();
}

// --- 毫秒时间戳 → “YYYY-MM-DD HH:mm”（个人中心 / 网站管理共用） ---
export function formatTime(ts) {
    if (!ts) return '';
    const d = new Date(Number(ts));
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// --- Raycaster 工厂 ---
export function createRaycaster(camera, canvas, event) {
    const { x, y } = screenToNDC(event, canvas);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(x, y), camera);
    return rc;
}

// --- Modal/覆盖层关闭绑定（统一 6 处重复：close-btn + backdrop + Escape） ---
// 返回 cleanup 函数用于移除所有监听器
export function bindModalClosers({ modalEl, closeBtn, backdropEl, onClose }) {
    const onEscape = (e) => {
        if (e.key === 'Escape') onClose();
    };
    closeBtn?.addEventListener('click', onClose);
    backdropEl?.addEventListener('click', onClose);
    document.addEventListener('keydown', onEscape);
    return () => {
        closeBtn?.removeEventListener('click', onClose);
        backdropEl?.removeEventListener('click', onClose);
        document.removeEventListener('keydown', onEscape);
    };
}

// --- localStorage JSON 存取（统一 galaxyRegistry + voice_settings 的重复） ---
export function storageLoad(key, fallback = null) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch {
        return fallback;
    }
}

export function storageSave(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch (e) {
        console.warn(`[Storage] 保存 "${key}" 失败:`, e);
        return false;
    }
}

// --- HTML 转义 ---
export function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
