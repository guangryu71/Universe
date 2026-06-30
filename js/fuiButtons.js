// ============================================================
// fuiButtons.js — FUI 工具栏按钮数据框 + 打字机效果
// 悬停按钮时在下方数据显示框流式输出功能描述
// ============================================================

const BUTTON_TEXT = {
    'bgm-control': [
        '>> INITIALIZING AUDIO SUBSYSTEM...',
        '>> LOADING INTERSTELLAR PLAYLIST...',
        '>> SELECT SOURCE: DEEP_SPACE_FREQ_7.3MHz',
        '>> AUDIO CODEC: STELLAR_AC3  ·  STANDBY',
        '>> SYSTEM ONLINE.  ',
    ],
    'chat-launcher': [
        '>> CONNECTING TO NEURAL INTERFACE...',
        '>> ESTABLISHING SECURE COMM_CHANNEL...',
        '>> AUTHENTICATING OPERATOR CREDENTIALS...',
        '>> LLM ENGINE: DEEPSEEK_FLASH  ·  LATENCY 0.2s',
        '>> TERMINAL READY.  ',
    ],
    'add-body-btn': [
        '>> COMPILING CELESTIAL BLUEPRINT...',
        '>> LOADING MATTER SYNTHESIZER...',
        '>> SPECIFY PARAMETERS: MASS / RADIUS / ORBIT',
        '>> STANDBY FOR OBJECT CREATION.  ',
    ],
    'voice-settings-btn': [
        '>> CONFIGURING VOCAL SYNTHESIZER...',
        '>> CALIBRATING FREQUENCY MODULATOR...',
        '>> TTS ENGINE: EDGE_TTS / ROBOTIC_V2',
        '>> ADJUST PITCH · SPEED · MODULATION.',
        '>> VOICE SYSTEM READY.  ',
    ],
    'ship-entry-btn': [
        '>> POWERING MAIN THRUSTERS...',
        '>> RUNNING PRE-FLIGHT CHECKLIST...',
        '>> INERTIAL DAMPERS: ACTIVE',
        '>> NAVIGATION SYSTEM: ONLINE',
        '>> READY FOR LAUNCH.  ',
    ],
    'galaxy-browser-btn': [
        '>> SCANNING STELLAR SYSTEMS...',
        '>> QUERYING GALACTIC DATABASE...',
        '>> FOUND: SOLAR_SYSTEM / HD_219134 / ++',
        '>> CATALOG INDEXING COMPLETE.',
        '>> GALAXY BROWSER READY.  ',
    ],
    'planet-lab-btn': [
        '>> INITIALIZING LABORATORY ENVIRONMENT...',
        '>> CALIBRATING SPECTROMETER...',
        '>> PLANETARY DATA FEED: ACTIVE',
        '>> ANALYSIS TOOLS: ONLINE',
        '>> READY FOR COMPOSITION ANALYSIS.  ',
    ],
};

class FUIButtonManager {
    constructor() {
        this.display = document.getElementById('fuiDataDisplay');
        this.typewriter = document.getElementById('fuiTypewriter');
        this.currentBtn = null;
        this.isHovering = false;
        this.typingTimer = null;

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

        // 停止之前的打字机音效
        if (window.__soundManager) window.__soundManager.stopTypewriterStream();

        // 清空并显示
        clearTimeout(this.typingTimer);
        this.typewriter.innerHTML = '';
        this.display.classList.add('visible');

        // 获取对应文本
        const lines = BUTTON_TEXT[btn.id] || [
            '>> SYSTEM QUERY...',
            '>> MODULE: ' + btn.id.toUpperCase(),
            '>> STANDBY.  ',
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
        setTimeout(() => {
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
