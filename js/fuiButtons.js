// ============================================================
// fuiButtons.js — FUI 工具栏按钮数据框 + 打字机效果
// 悬停按钮时在下方数据显示框流式输出功能描述
// ============================================================

const BUTTON_TEXT = {
    'chat-launcher': [
        '>> 正在连接智能终端...',
        '>> 建立加密通信链路...',
        '>> 唤起 AI 对话助手，探索宇宙知识',
        '>> 终端就绪。  ',
    ],
    'voice-settings-btn': [
        '>> 正在配置语音合成器...',
        '>> 校准频率调制模块...',
        '>> 调整音色、音调与语速',
        '>> 星语系统就绪。  ',
    ],
    'ship-entry-btn': [
        '>> 主推进器预热中...',
        '>> 执行起飞前检查...',
        '>> 驾驶飞船近距离巡视星系',
        '>> 随时可以启程。  ',
    ],
    'galaxy-browser-btn': [
        '>> 正在连接星体数据库...',
        '>> 索引用户星体系统...',
        '>> 管理、编译并导入导出星体系统',
        '>> 星体数据库就绪。  ',
    ],
    'abp-rebuild-orbits': [
        '>> 正在校准轨道力学模型...',
        '>> 重新读取天体质量与位置...',
        '>> 按当前状态重绘所有轨道线',
        '>> 轨道系统就绪。  ',
    ],
    'probe-launcher-btn': [
        '>> 探测器发射架已就位...',
        '>> 校准深空探测航线...',
        '>> 向目标星球快速发射探测器',
        '>> 等待发射指令。  ',
    ],
    'planet-lab-btn': [
        '>> 正在初始化实验室环境...',
        '>> 校准光谱分析仪...',
        '>> 搭建独立的星球模拟场景',
        '>> 实验设备就绪。  ',
    ],
};

class FUIButtonManager {
    constructor() {
        this.display = document.getElementById('fuiDataDisplay');
        this.typewriter = document.getElementById('fuiTypewriter');
        this.currentBtn = null;
        this.isHovering = false;
        this.typingTimer = null;
        this.hideTimer = null;

        if (!this.display || !this.typewriter) return;

        this._bindButtons();
        // 初始隐藏
        this.display.classList.remove('visible');
    }

    _bindButtons() {
        const sm = () => window.__soundManager;
        document.querySelectorAll('.sci-fi-btn').forEach(btn => {
            btn.addEventListener('mouseenter', () => {
                if (sm() && sm().isReady()) sm().play('btnHover', { volume: 0.3, detune: Math.random() * 100 - 50 });
                this._onEnter(btn);
            });
            btn.addEventListener('click', () => {
                if (sm() && sm().isReady()) sm().play('btnClick', { volume: 0.4 });
            });
            btn.addEventListener('mouseleave', () => this._onLeave());
        });
    }

    _onEnter(btn) {
        this.isHovering = true;
        this.currentBtn = btn;

        // 取消上一个按钮离场时挂起的清除定时器：
        // 快速从一个按钮移到另一个按钮时，旧定时器会把新按钮的打字内容清掉
        clearTimeout(this.hideTimer);
        this.hideTimer = null;

        // 停止之前的打字机音效
        if (window.__soundManager) window.__soundManager.stopTypewriterStream();

        // 清空并显示
        clearTimeout(this.typingTimer);
        this.typewriter.innerHTML = '';
        this.typewriter.style.opacity = '1';
        this.display.classList.add('visible');

        // 获取对应文本
        const lines = BUTTON_TEXT[btn.id] || [
            '>> 正在查询系统模块...',
            '>> 模块：' + btn.id.toUpperCase(),
            '>> 待命中。  ',
        ];

        // 逐行打字
        this._typeLines(lines, 0, 0);
    }

    _onLeave() {
        this.isHovering = false;
        clearTimeout(this.typingTimer);
        if (window.__soundManager) window.__soundManager.stopTypewriterStream();

        // 故障清除效果
        this.typewriter.style.opacity = '0.4';
        clearTimeout(this.hideTimer);
        this.hideTimer = setTimeout(() => {
            // 120ms 内已经悬停到别的按钮 → 不要清除新内容
            if (this.isHovering) return;
            this.typewriter.innerHTML = '';
            this.typewriter.style.opacity = '1';
            this.display.classList.remove('visible');
        }, 120);
    }

    _typeLines(lines, lineIdx, charIdx) {
        if (!this.isHovering || lineIdx >= lines.length) return;

        const line = lines[lineIdx];

        if (charIdx === 0 && lineIdx > 0) {
            this.typewriter.innerHTML += '<br>';
        }

        if (charIdx < line.length) {
            this.typewriter.innerHTML += line.charAt(charIdx);
            // 打字机音效
            if (window.__soundManager && window.__soundManager.isReady()) {
                window.__soundManager.playTypewriter(1);
            }
            const speed = Math.random() * 25 + 15;
            this.typingTimer = setTimeout(
                () => this._typeLines(lines, lineIdx, charIdx + 1),
                speed
            );
        } else {
            // 当前行完成 → 下一行
            const delay = 80 + Math.random() * 60;
            this.typingTimer = setTimeout(
                () => this._typeLines(lines, lineIdx + 1, 0),
                delay
            );
        }
    }
}

// 自动初始化
document.addEventListener('DOMContentLoaded', () => {
    new FUIButtonManager();
});
