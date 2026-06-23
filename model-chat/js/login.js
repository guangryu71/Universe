// ============================================================
// login.js — 登录界面（终端风格 CRT 动画）
// ============================================================

import { getConfig } from './config.js';

export class LoginScreen {
    /**
     * @param {function} onSuccess - 登录成功回调
     */
    constructor(onSuccess) {
        this.onSuccess = onSuccess;
        this.container = document.getElementById('login-container');
        this.input = document.getElementById('login-input');
        this.errorEl = document.getElementById('login-error');

        this._bindEvents();
    }

    _bindEvents() {
        // 密码输入框回车提交
        this.input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this._attemptLogin();
        });

        // 自动聚焦
        setTimeout(() => this.input?.focus(), 2500);
    }

    _attemptLogin() {
        const cfg = getConfig();
        const pwd = this.input.value.trim();

        if (!pwd) {
            this._showError('请输入访问密码');
            return;
        }

        if (pwd !== cfg.loginPassword) {
            this._showError('密码错误，拒绝访问');
            this.input.value = '';
            this.input.focus();
            // 抖动效果
            this.container.style.animation = 'none';
            void this.container.offsetWidth;
            this.container.style.animation = 'shake 0.4s ease-out';
            return;
        }

        // 登录成功 → 溶解动画
        this._showError('');
        this.container.classList.add('dissolve-out');

        setTimeout(() => {
            this.container.style.display = 'none';
            document.getElementById('chat-container').classList.add('active');
            this.onSuccess();
        }, 500);
    }

    _showError(msg) {
        if (this.errorEl) {
            this.errorEl.textContent = msg;
            this.errorEl.style.display = msg ? 'block' : 'none';
        }
    }
}
