// ============================================================
// main.js — 应用入口
// 点击星球/卫星 → 卫星式追踪（摄像机固定偏移） → 探测器计算/手动/自动发射
// 添加星体 + 视角坐标轴小控件
// ============================================================

import { SceneManager } from './scene.js';
import { PhysicsEngine } from './physics.js';
import { UIManager } from './ui.js?v=8';
import { BGMManager } from './bgm.js?v=4';
import { SIM_DT, POS_SCALE, SYSTEM_SCALE } from './constants.js';
import { createMoons, updateMoons } from './moons.js';
import { CelestialBody } from './CelestialBody.js';
import { openOverlay } from '../model-chat/js/overlay.js?v=6';
import { speak as vsSpeak, initVoiceSettings } from './voice_settings.js?v=3';
import { ShipModule } from '../ship/js/bridge.js?v=10';
import { GalaxyBrowser } from './GalaxyBrowser.js?v=38';
import { getGalaxyById } from './galaxyRegistry.js?v=8';
import { loadUniverseGalaxies, resolveSystemGalaxyId } from './UniverseRegistry.js?v=7';
import { PersonalCenter } from './PersonalCenter.js?v=8';
import { AdminPanel, computeEntryActivity } from './AdminPanel.js?v=10';
import {
    refreshSession, getCurrentUser, isStaff, onSessionChange, roleIcon, displayNameOf,
    getCommandedGalaxies,
} from './session.js?v=1';
import { escapeHtml } from './utils.js';
import { FocusController } from './FocusController.js?v=2';
import { FreeFlyController } from './FreeFlyController.js?v=3';
import { PlanetLab } from '../add-planet/PlanetLab.js?v=13';
import { SystemManager } from './SystemManager.js';
import { TimeParticles } from './TimeParticles.js?v=2';
import { soundManager } from './SoundManager.js';

import * as solarSystemModule from '../Galaxy/solar system/index.js';
import * as hd219134Module from '../Galaxy/hd-219134/index.js';

import * as THREE from 'three';

const SURFACE_DIR = 'Galaxy/solar system/planets/surface/';
const PROBE_SPEED = 35;

class SolarSystemApp {
    constructor() {
        const container = document.getElementById('canvas-container');
        if (!container) {
            console.error('[SolarSystem] 找不到 #canvas-container 元素');
            return;
        }

        this.sceneManager = new SceneManager(container);
        this.canvas = this.sceneManager.renderer.domElement;

        // 天体容器（初始为空，由 SystemManager 填充）
        this.planets = {};
        this.allMoons = {};
        this.physics = new PhysicsEngine([]);

        // --- 系统切换管理器（销毁/重建模式，所有系统以原点为中心） ---
        this.systemManager = new SystemManager({
            planets: this.planets,
            physics: this.physics,
            scene: this.sceneManager.scene,
            allMoons: this.allMoons,
            onSwitch: (systemId) => this._onSystemSwitch(systemId),
            onDrawOrbits: (systemId, scene) => this._createOrbitLines(),
        });

        // 注册星系模块
        this.systemManager.registerModule('solar-system', solarSystemModule.createPlanets, solarSystemModule.MOON_CLASSES);
        this.systemManager.registerModule('hd-219134', hd219134Module.createPlanets, hd219134Module.MOON_CLASSES);

        // --- 卫星式追踪 ---
        this.focusController = new FocusController({
            camera: this.sceneManager.camera,
            canvas: this.canvas,
            controls: this.sceneManager.controls,
            planets: this.planets,
            allMoons: this.allMoons,
            onSpeak: (text) => vsSpeak(text),
        });

        // --- UI ---
        this.ui = new UIManager(
            this.sceneManager.camera,
            this.canvas,
            this.planets,
            this.allMoons,
            (body, moonData) => this.focusController.focusBody(body, moonData),
            () => this.focusController.dismiss(),
            (body, moonData) => this._openCalcOverlay(body, moonData),
            () => this._destroyProbe(),
            (body) => { if (body.voiceIntro) vsSpeak(body.voiceIntro); },
            (planetKey, moonKey) => this._showSurface(planetKey, moonKey),
        );

        // 关联星体：详情弹窗内点击关联星体 → 跳到它所在的星体系统并聚焦
        this.ui.setRelationContext({
            getSystemId: () => this.systemManager?.getActiveSystemId?.() || null,
            navigateToBody: (systemId, bodyKey) => {
                this.ui.hideDetailModal();
                this.ui.hideCard();
                this.focusController.dismiss();
                this.systemManager.switchTo(systemId);
                if (bodyKey && this.planets[bodyKey]) this.focusController.focusByKey(bodyKey);
                else this.focusController.navigateToGalaxy(systemId);
            },
        });

        this.bgm = new BGMManager();

        // 星语设置
        initVoiceSettings();

        // 轨道线由 SystemManager 的 onDrawOrbits 回调自动绘制

        // --- 探测器 ---
        this.probeMesh = null;
        this.probeTrail = null;
        this.probeData = null;
        this._setupCalcOverlay();
        this._setupSurfaceViewer();

        // --- 手动发射 ---
        this._manualAim = false;
        this._manualCursor = null;
        this._recalling = false;

        // --- 轨道线重绘 ---
        this._setupOrbitRebuild();

        // --- 自由飞行预览（WASD / Shift / Ctrl） ---
        this._setupFreeFly();

        // --- AI ---
        document.getElementById('chat-launcher')?.addEventListener('click', openOverlay);

        // --- 时间流速 ---
        this.timeScale = 0.12;
        this.timeParticles = new TimeParticles();
        this._setupTimeSlider();
        this._setupTimeDial();

        // --- 音效预加载 ---
        soundManager.init();
        // 全局：窗口内按钮点击统一音效
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn || btn.closest('.sci-fi-btn')) return; // 右上角按钮已有独立音效
            if (btn.closest('.chat-window, .chat-login, .music-popup, .vs-panel, .add-galaxy-panel, .fui-window, .calc-panel, [id^=pl-], .ship-nav-window')) {
                const sm = window.__soundManager;
                if (sm && sm.isReady()) sm.play('btnInside', { volume: 0.25, detune: Math.random() * 100 - 50 });
            }
        }, true);

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                // 飞船模块优先处理 Escape
                if (this.shipModule && this.shipModule.isActive()) return;
                if (this._manualAim) this._exitManualAim();
                if (this.probeData) this._destroyProbe();
                if (this.surfaceOverlay && !this.surfaceOverlay.classList.contains('hidden')) {
                    this._hideSurface();
                }
                if (this.calcOverlay && !this.calcOverlay.classList.contains('hidden')) {
                    this.calcOverlay.classList.add('hidden');
                }
            }
        });

        setTimeout(() => {
            const hint = document.getElementById('hint');
            if (hint) hint.style.opacity = '0';
        }, 10000);

        // ---- 视角平面切换按钮（右下角 XY / XZ / YZ） ----
        this._setupViewPlaneButtons();

        // ---- 飞船模块 ----
        this.shipModule = new ShipModule(
            this.sceneManager,
            this.planets,
            this.physics,
        );

        // ---- 星体数据库 ----
        this.galaxyBrowser = new GalaxyBrowser({
            planets: this.planets,
            physics: this.physics,
            scene: this.sceneManager.scene,
            systemManager: this.systemManager,
            onFocusBody: (bodyKey) => this.focusController.focusByKey(bodyKey),
            onNavigateToGalaxy: (galaxyId) => {
                this.focusController.dismiss();
                this.systemManager.switchTo(galaxyId);
                this.focusController.navigateToGalaxy(galaxyId);
            },
            onRefreshOrbits: () => this._refreshOrbits(),
        });
        // 恢复上次保存的自定义星系
        this.galaxyBrowser.restoreCustomGalaxies().catch(() => {});
        document.getElementById('galaxy-browser-btn')?.addEventListener('click', () => {
            if (this.shipModule && this.shipModule.isActive()) return;
            this.galaxyBrowser.show();
        });
        document.getElementById('universe-view-btn')?.addEventListener('click', () => {
            if (this.shipModule && this.shipModule.isActive()) return;
            this.galaxyBrowser.openUniverseView({ fromDb: false });
        });

        // ---- 社区：个人中心 / 网站管理 / 星系管理 ----
        this._setupCommunity();

        // ---- 主场景左上角层级导航（宇宙 / 星系 / 星体系统）----
        this._setupSceneCrumbs();

        // ---- 进入飞船按钮 ----
        document.getElementById('ship-entry-btn')?.addEventListener('click', () => {
            if (this.shipModule && this.shipModule.isActive()) return;
            this.freeFly?.disable();
            this.shipModule.enterShip();
        });

        // ---- 星球实验室 ----
        // 实验室导出的星体系统统一交给星体数据库入库（SQLite + 本地缓存 + 场景实例化）
        this.planetLab = new PlanetLab({
            onExportSystem: (payload) => this.galaxyBrowser.addSystemFromLab(payload),
            onRequireLogin: () => this.personalCenter?.openLogin?.(),
        });
        document.getElementById('planet-lab-btn')?.addEventListener('click', () => {
            if (this.shipModule && this.shipModule.isActive()) return;
            this.planetLab.open();
        });

        // 📡 按钮点击 → 直接进入手动瞄准模式（与"🎯 手动发射"一致）
        document.getElementById('probe-launcher-btn')?.addEventListener('click', (e) => {
            if (this.probeData) {
                this._showToast('⚠️ 已有探测器在飞行中');
                return;
            }
            // 将面板中的速度同步到 manual-speed input
            const speed = parseFloat(document.getElementById('probe-launcher-speed')?.value) || 35;
            const manualInput = document.getElementById('manual-speed');
            if (manualInput) manualInput.value = speed;
            // 触发现有的手动发射流程
            this._startManualAim();
        });

        // 面板内🔥发射按钮（同手动发射流程：十字准星+鼠标瞄准）
        document.getElementById('probe-launcher-fire')?.addEventListener('click', () => {
            if (this.probeData) return;
            const speed = parseFloat(document.getElementById('probe-launcher-speed')?.value) || 35;
            const manualInput = document.getElementById('manual-speed');
            if (manualInput) manualInput.value = speed;
            this._startManualAim();
        });

        // 收回探测器
        document.getElementById('probe-launcher-recall')?.addEventListener('click', () => {
            if (this.probeData) {
                if (this._manualAim) this._exitManualAim();
                this._destroyProbe();
                this._showToast('↩ 探测器已收回');
            }
        });

        // 最后启动默认系统（此时所有依赖已就绪）
        this.systemManager.switchTo('solar-system');

        this._animate();
    }

    // ==================== 社区 ====================

    _setupCommunity() {
        this.personalCenter = new PersonalCenter({
            onEditSystem: (systemId) => {
                this.galaxyBrowser.hide();
                this.galaxyBrowser.openSystemEditor(systemId);
            },
            onOpenGalaxyManager: (galaxyId) => this.adminPanel.openGalaxyManage(galaxyId),
            onOpenUniverse: () => this.galaxyBrowser.openUniverseView({ fromDb: false }),
            // 草稿发布：服务器翻转状态 → 重建场景实例 → 刷新各视图
            onPublishDraft: (systemId) => this.galaxyBrowser.publishDraft(systemId),
            onWorldChanged: () => this._refreshCommunityWorld(),
        });

        this.adminPanel = new AdminPanel({
            onEditSystem: (systemId) => this.galaxyBrowser.openSystemEditor(systemId),
            onDeleteSystem: (systemId) => this.galaxyBrowser.deleteSystemById(systemId, { silent: true }),
            onRefreshWorld: () => this._refreshCommunityWorld(),
            onBgmChanged: () => this.bgm?.reloadPlaylist?.(),
            onOpenBgmPlayer: () => this.bgm?.openPopup?.(),
        });

        // 星体数据库 / 宇宙视图需要登录、星系管理时的统一入口
        this.galaxyBrowser.setCommunityHandlers({
            onRequireLogin: () => this.personalCenter.openLogin(),
            onManageGalaxy: (galaxyId) => this.adminPanel.openGalaxyManage(galaxyId),
        });

        document.getElementById('profile-btn')?.addEventListener('click', () => {
            if (this.shipModule?.isActive()) return;
            if (getCurrentUser()) this.personalCenter.open();
            else this.personalCenter.openLogin();
        });
        document.getElementById('site-admin-btn')?.addEventListener('click', () => {
            if (this.shipModule?.isActive()) return;
            if (isStaff()) this.adminPanel.open();
            else this.adminPanel.openCommander();
        });

        onSessionChange(() => this._updateCommunityEntries());

        refreshSession().then(() => this._updateCommunityEntries()).catch(() => {});

        // 定时复查管理入口红点（新成员 / 新审核），页面隐藏时不请求
        setInterval(() => {
            if (document.hidden) return;
            this._refreshEntryDot(this._canOpenCommunityPanel());
        }, 60000);
    }

    /** 当前角色是否能看到右上角管理入口（职员 = 网站管理，指挥官 = 星系管理） */
    _canOpenCommunityPanel() {
        return isStaff() || getCommandedGalaxies().length > 0;
    }

    /** 根据登录状态 / 角色 / 指挥官身份显示右上角社区入口 */
    _updateCommunityEntries() {
        const user = getCurrentUser();
        const staff = isStaff();
        const commanded = getCommandedGalaxies();
        const icon = document.getElementById('profile-btn-icon');
        if (icon) icon.textContent = user ? roleIcon(user.role) : '🧑‍🚀';
        const profileBtn = document.getElementById('profile-btn');
        if (profileBtn) {
            profileBtn.title = user
                ? `个人中心 · ${displayNameOf(user)}${user.unread ? ` · ${user.unread} 条未读` : ''}`
                : '登录 / 注册';
        }
        // 职员进入“网站管理”；仅有指挥官身份的公民进入“星系管理”（同一个窗口）。
        const adminBtn = document.getElementById('site-admin-btn');
        const adminBtnIcon = document.getElementById('site-admin-btn-icon');
        const canOpen = staff || commanded.length > 0;
        adminBtn?.classList.toggle('hidden', !canOpen);
        // 没有管理入口时，右侧按钮整体右移补位，保持同一行且相邻
        document.body.classList.toggle('has-admin-entry', canOpen);
        if (adminBtn) {
            adminBtn.title = staff ? '网站管理' : '星系管理';
            if (adminBtnIcon) adminBtnIcon.textContent = staff ? '🛠' : '🛰';
        }
        this.personalCenter?.updateBadge?.();
        this._refreshEntryDot(canOpen);
    }

    /**
     * 右上角管理入口红点：待审核内容 / 自己星系的新成员。
     * 只对能看到入口的角色查询，避免无谓的接口请求。
     */
    async _refreshEntryDot(canOpen) {
        const dot = document.getElementById('site-admin-dot');
        if (!dot) return;
        if (!canOpen) {
            dot.classList.add('hidden');
            return;
        }
        if (this._entryDotLoading) return;
        this._entryDotLoading = true;
        try {
            const hasNew = await computeEntryActivity();
            dot.classList.toggle('hidden', !hasNew);
        } catch {
            dot.classList.add('hidden');
        } finally {
            this._entryDotLoading = false;
        }
    }

    /** 审核 / 删除 / 星系变更后刷新星体数据库、宇宙视图与层级导航 */
    async _refreshCommunityWorld() {
        try {
            await this.galaxyBrowser.refreshCommunity();
        } catch (e) {
            console.warn('[main] 社区数据刷新失败:', e?.message || e);
        }
        this._updateCommunityEntries();
        const active = this.systemManager?.getActiveSystemId?.();
        if (active) this._updateSceneCrumbs(active);
    }

    // ==================== 系统切换管理 ====================

    /** 主场景左上角层级导航：宇宙 / 所属星系 / 当前星体系统 */
    _setupSceneCrumbs() {
        this.sceneCrumbsEl = document.getElementById('scene-crumbs');
        if (!this.sceneCrumbsEl) return;
        this.sceneCrumbsEl.addEventListener('click', (e) => {
            const link = e.target.closest('[data-crumb]');
            if (!link) return;
            if (link.dataset.crumb === 'universe') {
                this.galaxyBrowser.openUniverseView({ fromDb: false });
            } else if (link.dataset.crumb === 'galaxy') {
                this.galaxyBrowser.openUniverseView({
                    galaxyId: link.dataset.galaxyId || undefined,
                    fromDb: false,
                });
            } else if (link.dataset.crumb === 'system') {
                const systemId = link.dataset.systemId;
                if (!systemId || this.systemManager?.getActiveSystemId?.() === systemId) return;
                this.focusController.dismiss();
                this.systemManager.switchTo(systemId);
                this.focusController.navigateToGalaxy(systemId);
            }
        });
    }

    async _updateSceneCrumbs(systemId) {
        const el = this.sceneCrumbsEl;
        if (!el) return;
        const system = getGalaxyById(systemId);
        if (!system) {
            el.classList.add('hidden');
            return;
        }

        let galaxies = [];
        try {
            galaxies = await loadUniverseGalaxies();
        } catch {
            galaxies = [];
        }
        // 异步返回时可能已经切到别的系统
        if (this.systemManager?.getActiveSystemId?.() !== systemId) return;

        const galaxyId = resolveSystemGalaxyId(system, galaxies);
        const galaxy = galaxies.find(g => g.id === galaxyId);
        const galaxyName = galaxy?.name || '银河系';

        el.innerHTML = `
            <span class="sc-crumb sc-link" data-crumb="universe">宇宙</span>
            <span class="sc-sep">/</span>
            <span class="sc-crumb sc-link" data-crumb="galaxy" data-galaxy-id="${escapeHtml(galaxyId)}">${escapeHtml(galaxyName)}</span>
            <span class="sc-sep">/</span>
            <span class="sc-crumb sc-link sc-current" data-crumb="system" data-system-id="${escapeHtml(systemId)}" title="当前星体系统">${escapeHtml(system.name || systemId)}</span>
        `;
        el.classList.remove('hidden');
    }

    /** 系统切换完成回调 */
    _onSystemSwitch(systemId) {
        console.log(`[main] 系统切换到: ${systemId}`);
        // 切换系统会重置相机，自由飞行需要先退出
        this.freeFly?.disable();
        this._updateSceneCrumbs(systemId);

        // 如果有探测器，销毁
        if (this.probeData) this._destroyProbe();

        // 取消聚焦状态
        if (this.focusController?.isFocused) {
            this.focusController.dismiss();
        }

        // 更新视角到新系统（聚焦恒星）
        if (systemId === 'solar-system') {
            this.sceneManager.camera.position.set(5 * SYSTEM_SCALE * 0.3, 30 * SYSTEM_SCALE * 0.3, 45 * SYSTEM_SCALE * 0.3);
            this.sceneManager.controls.target.set(0, 0, 0);
            this.sceneManager.controls.update();
        } else {
            this.focusController.navigateToGalaxy(systemId);
        }
    }

    // ==================== 时间流速 ====================
    _setupTimeSlider() {
        this.slider = document.getElementById('time-slider');
        this.timeDisplay = document.getElementById('time-display');
        if (!this.slider || !this.timeDisplay) return;
        this.slider.value = 27;
        this.timeScale = Math.pow(10, (27 - 50) / 25);
        this._sliderDragging = false;
        this._prevSliderVal = 27;
        this._lastSliderDir = 0;

        const update = () => {
            const val = parseInt(this.slider.value);
            this.timeScale = Math.pow(10, (val - 50) / 25);
            const pct = ((val - 1) / 99) * 100;
            this.slider.style.setProperty('--slider-pct', pct + '%');
            const ts = this.timeScale;
            if (Math.abs(ts - 1.0) < 0.005) {
                this.timeDisplay.textContent = '1:1';
            } else {
                this.timeDisplay.textContent = '1:' + ts.toFixed(2) + 'x';
            }
            // 拖动中 → 粒子播放（传前后值判断向右划）
            if (this.timeParticles && this._sliderDragging) {
                this.timeParticles.setDragging(true, val, this._prevSliderVal);
            }
            // 拖动中 → 滑块方向音效
            if (this._sliderDragging && val !== this._prevSliderVal) {
                const dir = val > this._prevSliderVal ? 1 : -1;
                if (dir !== this._lastSliderDir) {
                    this._lastSliderDir = dir;
                    const sm = window.__soundManager;
                    if (sm && sm.isReady()) {
                        if (dir === 1) sm.playSliderSwoosh(1);    // 向右加速
                        else sm.play('inhale', { volume: 0.5 });   // 向左减速
                    }
                }
            } else if (!this._sliderDragging) {
                this._lastSliderDir = 0;
            }
            this._prevSliderVal = val;
        };

        this.slider.addEventListener('mousedown', () => { this._sliderDragging = true; });
        this.slider.addEventListener('mouseup', () => {
            this._sliderDragging = false;
            if (this.timeParticles) this.timeParticles.setDragging(false, this.slider.value, this._prevSliderVal);
        });
        this.slider.addEventListener('mouseleave', () => {
            if (this._sliderDragging) {
                this._sliderDragging = false;
                if (this.timeParticles) this.timeParticles.setDragging(false, this.slider.value, this._prevSliderVal);
            }
        });
        this.slider.addEventListener('touchstart', () => { this._sliderDragging = true; });
        this.slider.addEventListener('touchend', () => {
            this._sliderDragging = false;
            if (this.timeParticles) this.timeParticles.setDragging(false, this.slider.value, this._prevSliderVal);
        });

        // 窗口级兜底：在滑块外松手时也能结束拖拽，避免粒子特效一直循环播放
        window.addEventListener('pointerup', () => {
            if (!this._sliderDragging) return;
            this._sliderDragging = false;
            if (this.timeParticles) this.timeParticles.setDragging(false, this.slider.value, this._prevSliderVal);
        });

        this.slider.addEventListener('input', update);
        update();
    }

    _updateTimeDisplay() {
        if (!this.timeDisplay) return;
        const ts = this.timeScale;
        if (Math.abs(ts - 1.0) < 0.005) {
            this.timeDisplay.textContent = '1:1';
        } else {
            this.timeDisplay.textContent = '1:' + ts.toFixed(2) + 'x';
        }
        if (this.slider) {
            const val = parseInt(this.slider.value);
            const pct = ((val - 1) / 99) * 100;
            this.slider.style.setProperty('--slider-pct', pct + '%');
        }
    }

    // ==================== 全息表盘集成 ====================
    _setupTimeDial() {
        // 生成刻度
        const ticksG = document.getElementById('ticks');
        if (ticksG && ticksG.children.length === 0) {
            const totalTicks = 30;
            const ns = 'http://www.w3.org/2000/svg';
            for (let i = 0; i <= totalTicks; i++) {
                const angle = -90 + (i / totalTicks) * 180;
                const isMajor = i % 5 === 0;
                const len = isMajor ? 10 : 4;
                const r = 95;
                const rad = (angle - 90) * Math.PI / 180;
                const x1 = 100 + r * Math.cos(rad);
                const y1 = 100 + r * Math.sin(rad);
                const x2 = 100 + (r - len) * Math.cos(rad);
                const y2 = 100 + (r - len) * Math.sin(rad);
                const line = document.createElementNS(ns, 'line');
                line.setAttribute('x1', x1); line.setAttribute('y1', y1);
                line.setAttribute('x2', x2); line.setAttribute('y2', y2);
                line.setAttribute('stroke', isMajor ? '#00f3ff' : 'rgba(0,243,255,0.25)');
                line.setAttribute('stroke-width', isMajor ? 1.5 : 0.5);
                ticksG.appendChild(line);
            }
        }

        const pointerLayer = document.getElementById('pointerLayer');
        const secPath = document.getElementById('sectorPath');
        const secEdge = document.getElementById('sectorEdge');
        const secIn1 = document.getElementById('sectorInner1');
        const secIn2 = document.getElementById('sectorInner2');
        const secIn3 = document.getElementById('sectorInner3');
        const btnL = document.getElementById('btnLeft');
        const btnR = document.getElementById('btnRight');

        /** 根据滑块值更新指针角度 + 扇形 */
        const syncDial = () => {
            const val = parseInt(this.slider?.value) || 30;
            // slider 1→100 → 角度 -90→90
            const angle = -90 + (val - 1) / 99 * 180;
            if (pointerLayer) pointerLayer.style.transform = `rotate(${angle}deg)`;

            // 更新 SVG 扇形
            const r = 95, cx = 100, cy = 100;
            const startAngle = -90;
            if (angle <= startAngle) {
                [secPath, secEdge, secIn1, secIn2, secIn3].forEach(el => el?.setAttribute('d', ''));
                return;
            }
            const endAngle = Math.min(angle, 90);
            const span = endAngle - startAngle;
            const largeArc = span >= 180 ? 1 : 0;
            const toRad = (d) => d * Math.PI / 180;
            const pt = (a, rad) => ({ x: cx + rad * Math.sin(toRad(a)), y: cy - rad * Math.cos(toRad(a)) });
            const sP = pt(startAngle, r), eP = pt(endAngle, r);
            const sectorD = `M ${cx} ${cy} L ${sP.x.toFixed(2)} ${sP.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${eP.x.toFixed(2)} ${eP.y.toFixed(2)} Z`;
            if (secPath) secPath.setAttribute('d', sectorD);
            const edgeD = `M ${sP.x.toFixed(2)} ${sP.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${eP.x.toFixed(2)} ${eP.y.toFixed(2)}`;
            if (secEdge) secEdge.setAttribute('d', edgeD);
            [30, 55, 75].forEach((rad, idx) => {
                const el = [secIn1, secIn2, secIn3][idx];
                if (!el) return;
                const s = pt(startAngle, rad), e = pt(endAngle, rad);
                el.setAttribute('d', `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${rad} ${rad} 0 ${largeArc} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`);
            });
        };

        // 滑块变化时同步表盘
        this.slider?.addEventListener('input', syncDial);

        // 按钮长按连续步进
        this._dialInterval = null;
        const startHold = (dir, btn) => {
            if (this._dialInterval) return;
            btn.classList.add('pressing');
            this._stepSlider(dir);
            // 音效（只播放一次）
            const sm = window.__soundManager;
            if (sm && sm.isReady()) {
                sm.play(dir > 0 ? 'inhale' : 'whoosh', { volume: 0.45 });
            }
            // 粒子持续播放
            if (this.timeParticles) this.timeParticles.start(dir);
            let count = 0;
            this._dialInterval = setInterval(() => {
                count++;
                const step = Math.min(1 + Math.floor(count / 8), 5);
                for (let i = 0; i < step; i++) this._stepSlider(dir);
            }, 50);
        };
        const stopHold = () => {
            if (this._dialInterval) {
                clearInterval(this._dialInterval);
                this._dialInterval = null;
            }
            btnL?.classList.remove('pressing');
            btnR?.classList.remove('pressing');
            // 停止粒子
            if (this.timeParticles) this.timeParticles.stop();
        };

        btnL?.addEventListener('mousedown', () => startHold(-1, btnL));
        btnR?.addEventListener('mousedown', () => startHold(1, btnR));
        window.addEventListener('mouseup', stopHold);
        window.addEventListener('mouseleave', stopHold);

        // 键盘长按连续步进
        const keyState = {};
        document.addEventListener('keydown', (e) => {
            if (keyState[e.key]) return;
            keyState[e.key] = true;
            if (e.key === 'ArrowLeft') startHold(-1, btnL);
            if (e.key === 'ArrowRight') startHold(1, btnR);
        });
        document.addEventListener('keyup', (e) => {
            keyState[e.key] = false;
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') stopHold();
        });

        syncDial();
    }

    /** 步进滑块值 */
    _stepSlider(dir) {
        if (!this.slider) return;
        let v = parseInt(this.slider.value) + dir;
        v = Math.max(1, Math.min(100, v));
        this.slider.value = v;
        this.slider.dispatchEvent(new Event('input'));
    }

    // ==================== 视角平面切换（XY / XZ / YZ） ====================
    _setupViewPlaneButtons() {
        const btns = document.querySelectorAll('.vp-btn');
        console.log('[视角] 找到按钮数:', btns.length);
        if (btns.length === 0) {
            console.warn('[视角] 未找到 .vp-btn 元素，延迟绑定');
            setTimeout(() => this._setupViewPlaneButtons(), 500);
            return;
        }
        const normals = {
            xy: new THREE.Vector3(0, 0, 1),
            xz: new THREE.Vector3(0, 1, 0),
            yz: new THREE.Vector3(1, 0, 0),
        };
        let _activePlane = null;
        let _inverted = false;

        document.querySelectorAll('.vp-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                console.log('[视角] 按钮点击:', btn.dataset.plane, '_activePlane=', _activePlane, '_inverted=', _inverted);
                const plane = btn.dataset.plane;
                const n = normals[plane];
                if (!n) return;

                // 如果正在聚焦某个星球，先解除聚焦
                if (this.focusController.isFocused) {
                    this.focusController.dismiss();
                }

                // 切换平面：重置方向
                if (_activePlane !== plane) {
                    _activePlane = plane;
                    _inverted = false;
                    document.querySelectorAll('.vp-btn').forEach(b => b.classList.remove('active'));
                } else {
                    // 同一平面：反向
                    _inverted = !_inverted;
                }

                const dir = _inverted ? n.clone().negate() : n.clone();
                const cam = this.sceneManager.camera;

                // 保持当前相机到原点的距离（不小于默认值），沿法线方向放置相机
                const currentDist = cam.position.length();
                const viewDist = Math.max(currentDist, 35);

                cam.position.copy(dir.clone().multiplyScalar(viewDist));
                cam.lookAt(0, 0, 0);

                // 同步 OrbitControls 的目标点
                this.sceneManager.controls.target.set(0, 0, 0);
                this.sceneManager.controls.update();

                console.log('[视角] 相机移至:', cam.position.toArray().map(v => v.toFixed(1)),
                    '距离:', viewDist.toFixed(0));

                // 高亮
                if (_inverted) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });
        });
    }

    // ==================== 轨道线 ====================
    _createOrbitLines(clearOnly = false) {
        // 先清除旧轨道线
        if (this._orbitLines) {
            this._orbitLines.forEach(l => this.sceneManager.scene.remove(l));
        }
        this._orbitLines = [];
        if (clearOnly) return;

        const scene = this.sceneManager.scene;
        // 所有在物理引擎中的天体都是当前系统的一部分
        for (const body of this.physics.bodies) {
            const key = body.key;
            if (key === 'sun' || key.startsWith('custom_')) continue;
            const r = body.orbitRadius;
            if (!r || r <= 0) continue;

            // 当前系统以原点为中心，轨道直接以原点为圆心
            const visualR = r * POS_SCALE * SYSTEM_SCALE;
            const pts = [];
            for (let i = 0; i <= 256; i++) {
                const a = (i / 256) * Math.PI * 2;
                pts.push(new THREE.Vector3(
                    Math.cos(a) * visualR, 0,
                    Math.sin(a) * visualR
                ));
            }
            const geo = new THREE.BufferGeometry().setFromPoints(pts);
            const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
                color: 0xbb5544,
                transparent: true, opacity: 0.35, depthTest: true,
            }));
            scene.add(line);
            this._orbitLines.push(line);
        }
    }

    // ==================== 开普勒轨道计算 ====================

    /**
     * 计算天体的开普勒轨道点（数学完美椭圆）
     * @param {CelestialBody} body - 目标天体
     * @param {number} centralMass - 中心天体质量 (kg)
     * @param {THREE.Vector3} [centerPos] - 中心天体 SI 位置，默认原点
     * @param {number} [numPoints=256] - 采样点数
     * @returns {THREE.Vector3[]} 场景坐标下的轨道点数组（首尾闭合）
     */
    _computeKeplerianOrbit(body, centralMass, centerPos = new THREE.Vector3(), numPoints = 256) {
        const G_const = 6.67430e-11;
        const mu = G_const * centralMass;

        // 相对中心的位置和速度（SI 单位）
        const rVec = body.position.clone().sub(centerPos);
        const vVec = body.velocity.clone();
        const r = rVec.length();
        const v = vVec.length();

        if (r < 1e-6 || v < 1e-6) return []; // 恒星自身或静止天体

        // === 坐标系适配 ===
        // 系统使用 XZ 为参考平面（Y 为极轴），但标准轨道力学用 XY 为参考平面（Z 为极轴）
        // 交换 Y ↔ Z 使运算在标准框架下进行，结果再换回
        const rS = new THREE.Vector3(rVec.x, rVec.z, rVec.y); // ours → std
        const vS = new THREE.Vector3(vVec.x, vVec.z, vVec.y);

        // 比角动量 h = r × v
        const hVec = new THREE.Vector3().crossVectors(rS, vS);
        const h = hVec.length();
        if (h < 1e-12) return [];

        // 偏心率向量 e = (v × h) / μ - r̂
        const rHat = rS.clone().normalize();
        const eVec = new THREE.Vector3()
            .crossVectors(vS, hVec)
            .divideScalar(mu)
            .sub(rHat);
        const e = eVec.length();

        // 比能量 ε = v²/2 - μ/r
        const energy = v * v / 2 - mu / r;

        // 半长轴 a = -μ / (2ε)
        const a = -mu / (2 * energy);
        if (a <= 0 || e >= 1) return [];

        // 半短轴
        const bVal = a * Math.sqrt(1 - e * e);

        // 轨道倾角 i = arccos(hz / |h|)
        const inc = Math.acos(Math.max(-1, Math.min(1, hVec.z / h)));

        // 升交点黄经 Ω
        let Omega = 0;
        if (inc > 0.001) {
            const nVec = new THREE.Vector3(-hVec.y, hVec.x, 0);
            const n = nVec.length();
            if (n > 0.001) {
                Omega = Math.acos(Math.max(-1, Math.min(1, nVec.x / n)));
                if (nVec.y < 0) Omega = 2 * Math.PI - Omega;
            }
        }

        // 近心点幅角 ω
        let omega = 0;
        if (e > 0.001) {
            if (inc > 0.001) {
                const nVec = new THREE.Vector3(-hVec.y, hVec.x, 0);
                const n = nVec.length();
                if (n > 0.001) {
                    const eDotN = eVec.x * nVec.x + eVec.y * nVec.y;
                    omega = Math.acos(Math.max(-1, Math.min(1, eDotN / (e * n))));
                    if (eVec.z < 0) omega = 2 * Math.PI - omega;
                }
            } else {
                omega = Math.acos(Math.max(-1, Math.min(1, eVec.x / e)));
                if (eVec.y < 0) omega = 2 * Math.PI - omega;
            }
        }

        // 场景坐标缩放
        const scale = POS_SCALE * SYSTEM_SCALE;
        const centerScene = new THREE.Vector3(
            centerPos.x * scale,
            centerPos.y * scale,
            centerPos.z * scale
        );

        // 预计算旋转矩阵分量
        const cO = Math.cos(Omega), sO = Math.sin(Omega);
        const ci = Math.cos(inc),   si = Math.sin(inc);
        const cw = Math.cos(omega), sw = Math.sin(omega);

        // 旋转矩阵：从轨道平面(PQW)到参考系(ECI)
        // R = Rz(-Ω) * Rx(-i) * Rz(-ω)
        const R = [
            cO*cw - sO*ci*sw,  -cO*sw - sO*ci*cw,  sO*si,
            sO*cw + cO*ci*sw,  -sO*sw + cO*ci*cw, -cO*si,
            si*sw,              si*cw,              ci,
        ];

        const points = [];
        for (let i = 0; i <= numPoints; i++) {
            // 偏近点角 E
            const E = (i / numPoints) * 2 * Math.PI;
            const cosE = Math.cos(E), sinE = Math.sin(E);

            // 轨道平面位置 (PQW): x = a(cosE - e), y = b·sinE
            const xPQW = a * (cosE - e);
            const yPQW = bVal * sinE;

            // 旋转到标准参考系
            const xStd = R[0] * xPQW + R[1] * yPQW;
            const yStd = R[3] * xPQW + R[4] * yPQW;
            const zStd = R[6] * xPQW + R[7] * yPQW;

            // 标准框架 → 系统框架 (Y↔Z 换回) + 缩放 + 平移
            points.push(new THREE.Vector3(
                xStd * scale + centerScene.x,
                zStd * scale + centerScene.y,
                yStd * scale + centerScene.z
            ));
        }

        return points;
    }

    /** 公开：从 BodyEditor 触发轨道重算
     *  方案：基于开普勒轨道根数绘制数学完美椭圆轨道线
     *  优点：无积分、无状态修改、无"拉丝"、所有行星均完美闭合
     */
    async _refreshOrbits() {
        console.log('[轨道] _refreshOrbits 触发');
        if (this._orbitRecalcBusy) return;
        this._orbitRecalcBusy = true;

        try {
            // 1) 清除旧轨道线
            this._createOrbitLines(true);

            // 2) 动态查找中心天体（质量最大的 = 恒星）
            const bodies = this.physics.bodies;
            if (bodies.length < 2) {
                this._orbitRecalcBusy = false;
                return;
            }
            const centralBody = bodies.reduce((a, b) => a.mass > b.mass ? a : b);
            const centralMass = centralBody.mass;
            const centerPos = centralBody.position.clone();

            // 过滤出需要绘制轨道的 key（排除恒星自身）
            const keys = bodies
                .map(b => b.key)
                .filter(k => k !== centralBody.key);

            if (keys.length === 0) {
                this._orbitRecalcBusy = false;
                return;
            }

            // 3) 对每个天体计算开普勒轨道并绘制
            const scene = this.sceneManager.scene;
            for (const key of keys) {
                const body = this.planets[key];
                if (!body || !body.mesh) continue;

                const pts = this._computeKeplerianOrbit(body, centralMass, centerPos);
                if (!pts || pts.length < 3) continue;

                const geo = new THREE.BufferGeometry().setFromPoints(pts);
                const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
                    color: 0xbb5544,
                    transparent: true,
                    opacity: 0.35,
                    depthTest: true,
                }));
                scene.add(line);
                this._orbitLines.push(line);
            }

            console.log('[轨道] 开普勒轨道绘制完成 星体数:', keys.length,
                        '中心:', centralBody.key, '质量:', centralMass.toExponential(2));
        } catch (e) {
            console.error('[轨道] _refreshOrbits 错误:', e);
        } finally {
            this._orbitRecalcBusy = false;
        }
    }

    // ==================== 计算覆盖层（闪回步骤） ====================
    _setupCalcOverlay() {
        this.calcOverlay = document.getElementById('calc-overlay');
        this.calcStepText = document.getElementById('calc-step-text');
        this.calcDetail = document.getElementById('calc-detail');
        this.calcActions = document.getElementById('calc-actions');
        this.btnManual = document.getElementById('btn-manual');
        this.btnCalcClose = document.getElementById('calc-close');
        this.manualSpeedInput = document.getElementById('manual-speed');

        this.btnCalcClose?.addEventListener('click', () => {
            this.calcOverlay.classList.add('hidden');
        });
        this.btnManual?.addEventListener('click', () => {
            this.calcOverlay.classList.add('hidden');
            this._startManualAim();
        });
    }

    _openCalcOverlay(body, moonData) {
        this._calcBody = body;
        this._calcMoon = moonData;
        this._calcResult = this._computeIntercept(body);

        this.calcOverlay.classList.remove('hidden');
        this.calcActions.classList.add('hidden');
        this.calcStepText.textContent = '';
        this.calcDetail.innerHTML = '';

        const steps = [
            {
                title: '步骤 1/4 · 获取目标位置',
                html: `目标: <b>${body.nameCN || body.name}</b><br>
                       当前位置: (${this._calcResult.pos0.x.toFixed(1)}, ${this._calcResult.pos0.y.toFixed(1)}, ${this._calcResult.pos0.z.toFixed(1)})<br>
                       距相机: ${this._calcResult.dist0.toFixed(1)} 单位`,
            },
            {
                title: '步骤 2/4 · 分析轨道运动',
                html: `轨道速度: ${(this._calcResult.orbSpeed * 1e-3).toFixed(2)} km/s<br>
                       运动方向: (${this._calcResult.velDir.x.toFixed(2)}, ${this._calcResult.velDir.y.toFixed(2)}, ${this._calcResult.velDir.z.toFixed(2)})`,
            },
            {
                title: '步骤 3/4 · 预测拦截点',
                html: `预计飞行: <b>${this._calcResult.flightTime.toFixed(2)}</b> 秒<br>
                       拦截坐标: (${this._calcResult.interceptPos.x.toFixed(1)}, ${this._calcResult.interceptPos.y.toFixed(1)}, ${this._calcResult.interceptPos.z.toFixed(1)})<br>
                       星球位移: ${this._calcResult.displacement.toFixed(1)} 单位`,
            },
            {
                title: '步骤 4/4 · 计算发射参数',
                html: `发射速度: <b>${PROBE_SPEED.toFixed(0)}</b> 单位/秒<br>
                       发射方向: (${this._calcResult.launchDir.x.toFixed(3)}, ${this._calcResult.launchDir.y.toFixed(3)}, ${this._calcResult.launchDir.z.toFixed(3)})<br>
                       <span style="color:#0f0;">✓ 预计命中目标表面</span>`,
            },
        ];

        let i = 0;
        const showStep = () => {
            if (i >= steps.length) {
                this.calcStepText.textContent = '计算完成 ✓';
                this.calcDetail.innerHTML = '<span style="color:#0f0;">轨迹已锁定，选择发射方式</span>';
                this.calcActions.classList.remove('hidden');
                return;
            }
            const s = steps[i];
            this.calcStepText.textContent = s.title;
            this.calcDetail.innerHTML = s.html;
            i++;
            setTimeout(showStep, 1400);
        };
        showStep();
    }

    _computeIntercept(body) {
        const cam = this.sceneManager.camera;
        const planetPos = body.mesh.position.clone();
        const startPos = cam.position.clone()
            .add(cam.getWorldDirection(new THREE.Vector3()).multiplyScalar(2));

        const vel = body.velocity || new THREE.Vector3();
        const vel3d = vel.clone().multiplyScalar(POS_SCALE);
        const orbSpeed = vel3d.length();
        const R = planetPos.length();

        if (R < 0.01) {
            const dist = startPos.distanceTo(planetPos);
            return {
                pos0: planetPos, dist0: dist, orbSpeed: 0,
                velDir: new THREE.Vector3(),
                flightTime: dist / PROBE_SPEED,
                interceptPos: planetPos.clone(),
                displacement: 0,
                launchDir: planetPos.clone().sub(startPos).normalize(),
                startPos: startPos.clone(),
            };
        }

        const omega = orbSpeed / R;
        const theta0 = Math.atan2(planetPos.z, planetPos.x);
        const velDir = vel3d.clone().normalize();

        let t = startPos.distanceTo(planetPos) / PROBE_SPEED;
        for (let iter = 0; iter < 15; iter++) {
            const theta = theta0 + omega * t;
            const futurePos = new THREE.Vector3(
                R * Math.cos(theta), planetPos.y, R * Math.sin(theta)
            );
            t = startPos.distanceTo(futurePos) / PROBE_SPEED;
        }

        const theta = theta0 + omega * t;
        const interceptPos = new THREE.Vector3(
            R * Math.cos(theta), planetPos.y, R * Math.sin(theta)
        );
        const launchDir = interceptPos.clone().sub(startPos).normalize();

        return {
            pos0: planetPos, dist0: startPos.distanceTo(planetPos),
            orbSpeed, velDir,
            flightTime: t, interceptPos,
            displacement: interceptPos.distanceTo(planetPos),
            launchDir,
            startPos: startPos.clone(),
        };
    }

    _spawnProbe(pos) {
        if (this.probeMesh) this._destroyProbe();
        const scene = this.sceneManager.scene;

        // 小发光圆点
        const geo = new THREE.SphereGeometry(0.05, 8, 8);
        const mat = new THREE.MeshBasicMaterial({ color: 0x00ffff });
        this.probeMesh = new THREE.Mesh(geo, mat);
        this.probeMesh.position.copy(pos);

        // 外发光晕（微小）
        const glowGeo = new THREE.SphereGeometry(0.10, 8, 8);
        const glowMat = new THREE.MeshBasicMaterial({
            color: 0x00ccff, transparent: true, opacity: 0.35,
        });
        const glow = new THREE.Mesh(glowGeo, glowMat);
        this.probeMesh.add(glow);
        scene.add(this.probeMesh);

        // 尾迹
        const trailGeo = new THREE.BufferGeometry();
        this._trailPoints = [pos.clone()];
        trailGeo.setFromPoints(this._trailPoints);
        this.probeTrail = new THREE.Line(trailGeo,
            new THREE.LineBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.35 }));
        scene.add(this.probeTrail);

        this.ui.setRecallVisible(true);

        if (this._manualAim) this._exitManualAim();
    }

    _destroyProbe() {
        if (this._manualAim) this._exitManualAim();
        const scene = this.sceneManager.scene;
        if (this.probeMesh) {
            scene.remove(this.probeMesh);
            if (this.probeMesh.geometry) this.probeMesh.geometry.dispose();
            if (this.probeMesh.material) this.probeMesh.material.dispose();
            this.probeMesh = null;
        }
        if (this.probeTrail) {
            scene.remove(this.probeTrail);
            if (this.probeTrail.geometry) this.probeTrail.geometry.dispose();
            this.probeTrail = null;
        }
        this.probeData = null;
        this._trailPoints = null;
        this.ui.setRecallVisible(false);
    }

    _cleanProbeKeepAim() {
        this._recalling = false;
        const scene = this.sceneManager.scene;
        if (this.probeMesh) {
            scene.remove(this.probeMesh);
            if (this.probeMesh.geometry) this.probeMesh.geometry.dispose();
            if (this.probeMesh.material) this.probeMesh.material.dispose();
            this.probeMesh = null;
        }
        if (this.probeTrail) {
            scene.remove(this.probeTrail);
            if (this.probeTrail.geometry) this.probeTrail.geometry.dispose();
            this.probeTrail = null;
        }
        this.probeData = null;
        this._trailPoints = null;
        this.ui.setRecallVisible(false);
    }

    // ==================== 手动发射 ====================
    _startManualAim() {
        this._manualAim = true;
        this.ui.setClickDisabled(true);
        this.canvas.style.cursor = 'crosshair';
        this._manualCursor = document.getElementById('manual-cursor');
        if (!this._manualCursor) {
            this._manualCursor = document.createElement('div');
            this._manualCursor.id = 'manual-cursor';
            this._manualCursor.innerHTML = '⊙';
            document.body.appendChild(this._manualCursor);
        }
        this._manualCursor.style.display = 'block';

        this._onManualMouseMove = (e) => {
            this._manualCursor.style.left = e.clientX + 'px';
            this._manualCursor.style.top = e.clientY + 'px';
        };
        this._onManualClick = (e) => { this._manualFire(e); };
        this._onManualRightDown = (e) => {
            e.preventDefault();
            this._recalling = true;
        };
        this._onManualRightUp = (e) => {
            e.preventDefault();
            this._recalling = false;
        };

        document.addEventListener('mousemove', this._onManualMouseMove);
        this.canvas.addEventListener('click', this._onManualClick);
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
        this.canvas.addEventListener('mousedown', (e) => {
            if (e.button === 2) this._onManualRightDown(e);
        });
        document.addEventListener('mouseup', (e) => {
            if (e.button === 2) this._onManualRightUp(e);
        });
    }

    _exitManualAim() {
        this._manualAim = false;
        this.ui.setClickDisabled(false);
        this.canvas.style.cursor = '';
        if (this._manualCursor) this._manualCursor.style.display = 'none';
        document.removeEventListener('mousemove', this._onManualMouseMove);
        this.canvas.removeEventListener('click', this._onManualClick);
        this._recalling = false;
    }

    _manualFire(e) {
        if (!this._manualAim || this.probeData) return;
        const speed = parseFloat(document.getElementById('manual-speed')?.value) || PROBE_SPEED;
        const cam = this.sceneManager.camera;
        const rect = this.canvas.getBoundingClientRect();
        const mx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const my = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        const dir = new THREE.Vector3(mx, my, -1).unproject(cam).sub(cam.position).normalize();
        const startPos = cam.position.clone().add(dir.clone().multiplyScalar(2));

        this._spawnProbe(startPos);
        this.probeMesh.lookAt(startPos.clone().add(dir));
        this.probeData = {
            start: startPos.clone(),
            velocity: dir.multiplyScalar(speed),
            body: null,          // 手动发射不锁定目标，自由飞行
            moonKey: null,
            isManual: true,
        };
        this._exitManualAim();
    }

    // ==================== 自由飞行预览 ====================
    _setupFreeFly() {
        const btn = document.getElementById('free-fly-btn');
        this.freeFly = new FreeFlyController({
            camera: this.sceneManager.camera,
            domElement: this.canvas,
            controls: this.sceneManager.controls,
            focusController: this.focusController,
            onStateChange: (active) => {
                btn?.classList.toggle('is-active', active);
                btn?.setAttribute('aria-pressed', active ? 'true' : 'false');
                if (btn) btn.title = active
                    ? '退出自由飞行（Esc）'
                    : '自由飞行预览（WASD 移动 · Shift 加速 · Ctrl 下沉）';
            },
        });
        btn?.addEventListener('click', () => {
            if (this.shipModule?.isActive()) return;
            this.freeFly.toggle();
        });
    }

    // ==================== 轨道线重绘 ====================
    _setupOrbitRebuild() {
        document.getElementById('abp-rebuild-orbits')?.addEventListener('click', () => {
            if (this._orbitRecalcBusy) {
                console.log('[轨道] 正在计算中，请稍候');
                return;
            }
            this._refreshOrbits();
        });
    }
    _showToast(msg) {
        const el = document.getElementById('toast');
        if (!el) return;
        el.textContent = msg; el.classList.add('show');
        clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 2400);
    }

    // ==================== 动画循环 ====================
    _animate() {
        requestAnimationFrame(() => this._animate());
        const dt = Math.min(0.1, 1 / 60);

        // 始终运行宇宙物理（飞船模式也需要重力和投影仪画面）
        if (!this._pausePhysics) {
            this.physics.step(SIM_DT * this.timeScale);

            // 同步所有星球 mesh
            for (const body of this.physics.bodies) {
                if (body._syncMeshPosition) body._syncMeshPosition();
            }
        }

        // 更新卫星
        this.systemManager.updateMoons(dt);

        // 飞船模式：委托渲染并返回
        if (this.shipModule && this.shipModule.isActive()) {
            this.shipModule.update(dt);
            this.shipModule.render();
            return;
        }

        // --- 自由飞行 / 卫星式追踪 ---
        if (this.freeFly?.isActive()) this.freeFly.update(dt);
        else this.focusController.update();

        // --- 探测器 ---
        if (this.probeData && this.probeMesh) {
            if (this.probeData.isManual && this._recalling) {
                this._cleanProbeKeepAim();
            } else {
                // 手动发射且无锁定目标：自由飞行 + 碰撞检测所有天体
                if (this.probeData.isManual && !this.probeData.body) {
                    this.probeMesh.position.add(
                        this.probeData.velocity.clone().multiplyScalar(dt)
                    );
                    // 手动发射探测器：遍历当前物理引擎中所有天体检测碰撞
                    for (const body of this.physics.bodies) {
                        if (!body.mesh || !body.visualRadius) continue;
                        const toTarget = body.mesh.position.clone().sub(this.probeMesh.position);
                        const dist = toTarget.length();
                        const vr = body.visualRadius || 1;
                        // Mesh 被 SYSTEM_SCALE 缩放，碰撞半径需对应换算
                        if (dist < vr * SYSTEM_SCALE * 1.5) {
                            this._destroyProbe();
                            this._showSurface(body.key, null);
                            break;
                        }
                    }
                } else {
                    // 自动发射或有锁定目标：引导飞向目标
                    const body = this.probeData.body;
                    const targetMesh = body?.mesh;
                    if (targetMesh) {
                        const toTarget = targetMesh.position.clone().sub(this.probeMesh.position);
                        const dist = toTarget.length();
                        const desiredDir = toTarget.normalize();
                        const correction = Math.min(5.0 / Math.max(dist, 0.5), 3.0);
                        this.probeData.velocity.lerp(
                            desiredDir.multiplyScalar(PROBE_SPEED),
                            correction * dt
                        );
                        this.probeMesh.position.add(
                            this.probeData.velocity.clone().multiplyScalar(dt)
                        );

                        const vr = body?.visualRadius || 1;
                        // Mesh 被 SYSTEM_SCALE 缩放，碰撞半径需对应换算
                        if (dist < vr * SYSTEM_SCALE * 1.5) {
                            const pk = body.key;
                            const mk = this.probeData.moonKey;
                            this._destroyProbe();
                            this._showSurface(pk, mk);
                        }
                    } else {
                        this.probeMesh.position.add(
                            this.probeData.velocity.clone().multiplyScalar(dt)
                        );
                    }
                }
            }

            const dir = this.probeData.velocity.clone().normalize();
            this.probeMesh.lookAt(this.probeMesh.position.clone().add(dir));

            if (this._trailPoints && this.probeTrail) {
                this._trailPoints.push(this.probeMesh.position.clone());
                if (this._trailPoints.length > 200) this._trailPoints.shift();
                this.probeTrail.geometry.dispose();
                this.probeTrail.geometry = new THREE.BufferGeometry().setFromPoints(this._trailPoints);
            }
        }

        // 自转（仅活跃系统中的天体）
        for (const body of this.physics.bodies) {
            if (body.mesh && body.rotationSpeed) {
                body.mesh.rotation.y += body.rotationSpeed * dt;
                if (body.ringMesh) body.ringMesh.rotation.y = body.mesh.rotation.y;
                if (body.cloudMesh) body.cloudMesh.rotation.y += body.rotationSpeed * 1.1 * dt;
            }
        }

        // 自由飞行时由 FreeFlyController 接管相机，跳过 OrbitControls 更新
        this.sceneManager.render(this.focusController.isFocused || this.freeFly?.isActive());
    }

    // ==================== 表面全景 ====================
    _setupSurfaceViewer() {
        this.surfaceOverlay = document.getElementById('surface-overlay');
        this.surfaceGrid = document.getElementById('surface-grid');
        this.surfaceEmpty = document.getElementById('surface-empty');
        this.surfaceTitle = document.getElementById('surface-title');
        this.surfaceClose = document.getElementById('surface-close');
        this.surfaceClose?.addEventListener('click', () => this._hideSurface());
        this.surfaceOverlay?.addEventListener('click', (e) => {
            if (e.target === this.surfaceOverlay) this._hideSurface();
        });
    }

    _hideSurface() {
        this.surfaceOverlay?.classList.add('hidden');
        this.surfaceOverlay?.querySelector('.surface-preview')?.remove();
    }

    /** 收集地表文件夹树中的图片 */
    _collectSurfaceImages(surfaceTree) {
        const out = [];
        const walk = (nodes) => {
            for (const n of nodes || []) {
                if (!n) continue;
                if (n.type === 'folder') walk(n.children);
                else if (n.type === 'image' && n.url) {
                    out.push({ name: n.name || '地表图片', url: n.url });
                }
            }
        };
        walk(Array.isArray(surfaceTree) ? surfaceTree : []);
        return out;
    }

    _showSurface(planetKey, moonKey) {
        const moon = moonKey ? (this.allMoons[planetKey] || []).find(m => m.key === moonKey) : null;
        const body = this.planets[planetKey];
        const info = moon || body;
        const name = moon
            ? (moon.name || moonKey)
            : (body?.nameCN || planetKey);

        let images = this._collectSurfaceImages(info?.surfaceTree);

        // 兼容旧数据：没有上传地表图片时，沿用原有的单张表面图 / 贴图
        if (images.length === 0) {
            const fileName = moonKey ? `${planetKey}_${moonKey}.jpg` : `${planetKey}.jpg`;
            const fallback = moon ? (moon.texturePath || null) : (body?.texturePath || null);
            images = [{
                name: fileName,
                url: SURFACE_DIR + fileName,
                fallback,
            }];
        }

        this.surfaceTitle.textContent = `${name} — 地表图片（${images.length}）`;
        this.surfaceGrid.innerHTML = '';
        this.surfaceOverlay.querySelector('.surface-preview')?.remove();

        const showEmpty = () => {
            this.surfaceGrid.classList.add('hidden');
            this.surfaceEmpty.classList.remove('hidden');
        };
        const refreshEmpty = () => {
            if (this.surfaceGrid.children.length === 0) showEmpty();
        };

        images.forEach(item => {
            const tile = document.createElement('div');
            tile.className = 'surface-tile';

            const img = document.createElement('img');
            img.className = 'surface-thumb';
            img.src = item.url;
            img.alt = item.name;
            img.loading = 'lazy';
            // 记录当前实际显示的地址：主地址加载失败时会退回到贴图，
            // 放大预览必须使用同一地址，否则会再次请求失效的旧文件
            let currentUrl = item.url;
            let triedFallback = false;
            img.onerror = () => {
                if (!triedFallback && item.fallback) {
                    triedFallback = true;
                    currentUrl = item.fallback;
                    img.src = item.fallback;
                    return;
                }
                img.onerror = null;
                tile.remove();
                refreshEmpty();
            };

            const cap = document.createElement('div');
            cap.className = 'surface-tile-name';
            cap.textContent = item.name;
            cap.title = item.name;

            tile.appendChild(img);
            tile.appendChild(cap);
            tile.addEventListener('click', () => this._previewSurface(currentUrl, item.name, item.fallback));
            this.surfaceGrid.appendChild(tile);
        });

        if (images.length === 0) showEmpty();
        else {
            this.surfaceGrid.classList.remove('hidden');
            this.surfaceEmpty.classList.add('hidden');
        }

        document.body.style.transition = 'opacity 0.15s';
        document.body.style.opacity = '0';
        setTimeout(() => {
            this.surfaceOverlay.classList.remove('hidden');
            document.body.style.opacity = '1';
        }, 180);
    }

    _previewSurface(url, name, fallback = null) {
        this.surfaceOverlay.querySelector('.surface-preview')?.remove();
        const preview = document.createElement('div');
        preview.className = 'surface-preview';
        const img = document.createElement('img');
        img.alt = name;
        // 主图失效时退回贴图（缩略图可能已经走过同样的回退）
        if (fallback && fallback !== url) {
            img.onerror = () => {
                img.onerror = null;
                img.src = fallback;
            };
        }
        img.src = url;
        const cap = document.createElement('span');
        cap.textContent = name;
        preview.appendChild(img);
        preview.appendChild(cap);
        preview.addEventListener('click', () => preview.remove());
        this.surfaceOverlay.appendChild(preview);
    }
}

try { new SolarSystemApp(); } catch (err) {
    console.error('[SolarSystem] 启动失败:', err);
}
