// ============================================================
// toast.js — 全局操作结果提示（保存成功 / 保存失败等）
// 独立于 #toast，层级高于所有弹窗（详情编译器、星语设置等）。
// ============================================================

let _el = null;
let _timer = null;

/**
 * 显示一条操作提示
 * @param {string} message
 * @param {'success'|'error'|'info'} [kind='success']
 */
export function showToast(message, kind = 'success') {
    if (!_el) {
        _el = document.createElement('div');
        _el.className = 'app-toast';
        _el.setAttribute('role', 'status');
        _el.setAttribute('aria-live', 'polite');
        document.body.appendChild(_el);
    }
    _el.textContent = message;
    // 重新触发过渡，让连续提示也能看到动画
    _el.className = 'app-toast';
    void _el.offsetWidth;
    _el.className = `app-toast show ${kind}`;
    clearTimeout(_timer);
    _timer = setTimeout(() => _el.classList.remove('show'), 2600);
}
