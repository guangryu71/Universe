// ============================================================
// main.js — 模型对话模块入口
// ============================================================

import { loadConfig } from './config.js';
import { LoginScreen } from './login.js';
import { ChatTerminal } from './chat.js';

(async () => {
    const statusEl = document.getElementById('login-status');

    try {
        // 加载配置
        statusEl.textContent = '> 正在加载系统配置...';
        await loadConfig();
        statusEl.textContent = '> 系统初始化完成';

    } catch (err) {
        statusEl.textContent = `> 配置加载失败: ${err.message}`;
        statusEl.style.color = '#f44';
    }

    // 启动登录 → 成功后启动对话终端
    const chat = new ChatTerminal();

    new LoginScreen(() => {
        chat.start();
    });

})();
