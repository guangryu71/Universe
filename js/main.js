// ============================================================
// main.js — 应用入口
// 点击星球/卫星 → 卫星式追踪（摄像机固定偏移） → 探测器计算/手动/自动发射
// 添加星体 + 视角坐标轴小控件
// ============================================================

import { SceneManager } from './scene.js';
import { PhysicsEngine } from './physics.js';
import { UIManager } from './ui.js';
import { BGMManager } from './bgm.js?v=2';
import { SIM_DT, POS_SCALE, SYSTEM_SCALE } from './constants.js';
import { createMoons, updateMoons } from './moons.js';
import { CelestialBody } from './CelestialBody.js';
import { BodyEditor } from '../add-planet/BodyEditor.js';
import { openOverlay } from '../model-chat/js/overlay.js';
import { speak as vsSpeak, initVoiceSettings } from './voice_settings.js';
import { ShipModule } from '../ship/js/bridge.js';
import { GalaxyBrowser } from './GalaxyBrowser.js';
import { FocusController } from './FocusController.js';
import { PlanetLab } from '../add-planet/PlanetLab.js';
import { SystemManager } from './SystemManager.js';
import { TimeParticles } from './TimeParticles.js';
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
        );

        this.bgm = new BGMManager();
        document.getElementById('music-upload-btn')?.addEventListener('click', () => {
            this.bgm.triggerUpload();
        });

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

        // --- 添加星体编辑器 ---
        this._setupBodyEditor();

        // --- AI ---
        document.getElementById('chat-launcher')?.addEventListener('click', openOverlay);

        // --- 时间流速 ---
        this.timeScale = 0.12;
        this.timeParticles = new TimeParticles();
        this._setupTimeSlider();

        // --- 音效预加载 ---
        soundManager.init();
        // 全局：窗口内按钮点击统一音效
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn || btn.closest('.sci-fi-btn')) return; // 右上角按钮已有独立音效
            if (btn.closest('.chat-window, .chat-login, .music-popup, .add-body-panel, .vs-panel, .add-galaxy-panel, .fui-window, .calc-panel, [id^=pl-], .ship-nav-window')) {
                const sm = window.__soundManager;
                if (sm && sm.isReady()) sm.play('btnInside', { volume: 0.25, detune: Math.random() * 100 - 50 });
            }
        }, true);

        // --- FPS ---
        this.fpsEl = document.getElementById('fps');
        this.frameCount = 0;
        this.lastFpsTime = performance.now();

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                // 飞船模块优先处理 Escape
                if (this.shipModule && this.shipModule.isActive()) return;
                if (this._manualAim) this._exitManualAim();
                if (this.probeData) this._destroyProbe();
                if (this.surfaceOverlay && !this.surfaceOverlay.classList.contains('hidden')) {
                    this.surfaceOverlay.classList.add('hidden');
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

        // ---- 星系浏览器 ----
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

        // ---- 进入飞船按钮 ----
        document.getElementById('ship-entry-btn')?.addEventListener('click', () => {
            if (this.shipModule && this.shipModule.isActive()) return;
            this.shipModule.enterShip();
        });

        // ---- 星球实验室 ----
        this.planetLab = new PlanetLab();
        document.getElementById('planet-lab-btn')?.addEventListener('click', () => {
            if (this.shipModule && this.shipModule.isActive()) return;
            this.planetLab.open();
        });

        // 快捷探测器发射
        document.getElementById('probe-launcher-fire')?.addEventListener('click', () => {
            if (this.probeData) return;
            const speed = parseFloat(document.getElementById('probe-launcher-speed')?.value) || 35;
            const cam = this.sceneManager.camera;
            const dir = cam.getWorldDirection(new THREE.Vector3());
            const startPos = cam.position.clone().add(dir.clone().multiplyScalar(2));
            this._spawnProbe(startPos);
            this.probeMesh.lookAt(startPos.clone().add(dir));
            this.probeData = {
                start: startPos.clone(),
                velocity: dir.multiplyScalar(speed),
                body: null, moonKey: null, isManual: true,
            };
            this._showToast('📡 探测器已发射 · 速度 ' + speed + ' 单位/秒');
        });

        // 最后启动默认系统（此时所有依赖已就绪）
        this.systemManager.switchTo('solar-system');

        this._animate();
    }

    // ==================== 系统切换管理 ====================

    /** 系统切换完成回调 */
    _onSystemSwitch(systemId) {
        console.log(`[main] 系统切换到: ${systemId}`);

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
            if (this.timeParticles) {
                this.timeParticles.setDragging(this._sliderDragging, val, this._prevSliderVal);
            }
            // 拖动中 → 滑块方向音效（每次向右划只播一次正向，向左播反向）
            if (this._sliderDragging && val !== this._prevSliderVal) {
                const dir = val > this._prevSliderVal ? 1 : -1;
                if (dir !== this._lastSliderDir) {
                    this._lastSliderDir = dir;
                    if (dir === 1) { // 只向右时播放特效
                        const sm = window.__soundManager;
                        if (sm && sm.isReady()) sm.playSliderSwoosh(1);
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

    /** 公开：从 BodyEditor 触发轨道重算
     *  1) 清旧线  2) 100x 等 10s  3) 物理循环密集采样  4) 恢复
     */
    async _refreshOrbits() {
        console.log('[轨道] _refreshOrbits 触发');
        if (this._orbitRecalcBusy) return;
        this._orbitRecalcBusy = true;
        try {
            await vsSpeak('检测到轨道变化，正在计算新轨道线。');

            // 1) 清除旧轨道线
            this._createOrbitLines(true);

            // 2) 保存状态 & 拉到最高
            const savedVal = parseInt(document.getElementById('time-slider').value);
            const savedScale = this.timeScale;
            document.getElementById('time-slider').value = 100;
            this.timeScale = 100;
            this._updateTimeDisplay();

            // 对当前系统的天体进行轨道采样
            const keys = this.physics.bodies
                .map(b => b.key)
                .filter(k => k !== 'sun' && !k.startsWith('custom_'));

            // 3) 等待 10s 让轨道稳定（动画循环正常跑 100x）
            await new Promise(r => setTimeout(r, 10000));

            // 4) 暂停动画循环的物理更新，切换为手动密集采样
            this._pausePhysics = true;
            const trackScale = 1;  // 采样用 1x 保证平滑（每步 0.5 天）
            const totalSteps = 5000;
            const simDt = SIM_DT * trackScale;
            const samples = {};
            keys.forEach(k => { samples[k] = []; });

            for (let step = 0; step < totalSteps; step++) {
                this.physics.step(simDt);
                // 同步 mesh 位置（采样用）
                for (const body of this.physics.bodies) {
                    if (body._syncMeshPosition) body._syncMeshPosition();
                }
                for (const key of keys) {
                    const b = this.planets[key];
                    if (b?.mesh) samples[key].push(b.mesh.position.clone());
                }
                if (step % 200 === 199) await new Promise(r => setTimeout(r, 0));
            }

            // 5) 绘制轨道线
            const scene = this.sceneManager.scene;
            for (const key of keys) {
                const pts = samples[key];
                if (pts.length < 2) continue;
                const geo = new THREE.BufferGeometry().setFromPoints(pts);
                const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
                    color: 0xbb5544, transparent: true, opacity: 0.35, depthTest: true,
                }));
                scene.add(line);
                this._orbitLines.push(line);
            }
            console.log('[轨道] 采样完成 步数:', totalSteps, '轨道数:', Object.keys(samples).length);

            // 6) 恢复
            this._pausePhysics = false;
            document.getElementById('time-slider').value = savedVal;
            this.timeScale = savedScale;
            this._updateTimeDisplay();
            this._orbitRecalcBusy = false;

            await vsSpeak('轨道校验完成。');
        } catch (e) {
            console.error('[轨道] _refreshOrbits 错误:', e);
            this._pausePhysics = false;
            this._orbitRecalcBusy = false;
        }
    }

    // ==================== 计算覆盖层（闪回步骤） ====================
    _setupCalcOverlay() {
        this.calcOverlay = document.getElementById('calc-overlay');
        this.calcStepText = document.getElementById('calc-step-text');
        this.calcDetail = document.getElementById('calc-detail');
        this.calcActions = document.getElementById('calc-actions');
        this.btnAutoLaunch = document.getElementById('btn-auto-launch');
        this.btnManual = document.getElementById('btn-manual');
        this.btnCalcClose = document.getElementById('calc-close');
        this.manualSpeedInput = document.getElementById('manual-speed');

        this.btnCalcClose?.addEventListener('click', () => {
            this.calcOverlay.classList.add('hidden');
        });
        this.btnAutoLaunch?.addEventListener('click', () => {
            this.calcOverlay.classList.add('hidden');
            this._autoLaunch();
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

    // ==================== 自动发射 ====================
    _autoLaunch() {
        const r = this._calcResult;
        this._spawnProbe(r.startPos);
        this.probeData = {
            start: r.startPos.clone(),
            velocity: r.launchDir.clone().multiplyScalar(PROBE_SPEED),
            body: this._calcBody,
            moonKey: this._calcMoon?.key || null,
            isManual: false,
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

    // ==================== 添加星体编辑器 ====================
    _setupBodyEditor() {
        this.addBodyPanel = document.getElementById('add-body-panel');
        this.addBodyBtn = document.getElementById('add-body-btn');

        this.bodyEditor = new BodyEditor(
            this.sceneManager.scene,
            this.sceneManager.camera,
            this.canvas,
            this.planets,
            this.physics,
            this,
        );

        // 轨道线重绘按钮
        document.getElementById('abp-rebuild-orbits')?.addEventListener('click', () => {
            if (this._orbitRecalcBusy) {
                console.log('[轨道] 正在计算中，请稍候');
                return;
            }
            this._refreshOrbits();
        });

        this.addBodyBtn?.addEventListener('click', () => {
            const isOpen = !this.addBodyPanel.classList.contains('hidden');
            const schPanel = document.getElementById('schwarzschild-info');
            if (isOpen) {
                this.addBodyPanel.classList.add('hidden');
                if (schPanel) schPanel.classList.add('hidden');
                this.bodyEditor.exitPlaceMode();
            } else {
                if (confirm('⚠️ 添加星体会改变当前星系结构\n\n新增的星体会加入物理引擎并影响现有天体的轨道。\n\n是否继续？')) {
                    this.addBodyPanel.classList.remove('hidden');
                    if (schPanel) schPanel.classList.remove('hidden');
                    this._switchToTab('abp-add');
                    this.bodyEditor.enterPlaceMode();
                }
            }
        });

        document.getElementById('abp-close')?.addEventListener('click', () => {
            this.addBodyPanel.classList.add('hidden');
            const schPanel = document.getElementById('schwarzschild-info');
            if (schPanel) schPanel.classList.add('hidden');
            this.bodyEditor.exitPlaceMode();
        });

        this.addBodyPanel?.querySelectorAll('.abp-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const targetId = tab.dataset.tab;
                this._switchToTab(targetId);
                if (targetId === 'abp-list') {
                    this.bodyEditor.exitPlaceMode();
                    this._refreshBodyList();
                } else if (targetId === 'abp-add') {
                    this.bodyEditor.enterPlaceMode();
                }
            });
        });

        const confirmBtn = document.getElementById('abp-confirm');
        confirmBtn?.addEventListener('click', () => {
            if (!this._placementPos) return;
            const name = document.getElementById('abp-name').value || '新星体';
            const mass = parseFloat(document.getElementById('abp-mass').value) || 1e24;
            const radius = parseFloat(document.getElementById('abp-radius').value) || 5000;
            const color = document.getElementById('abp-color').value || '#ff8844';
            const visualR = parseFloat(document.getElementById('abp-visual').value) || 1.2;
            const { x, y, z } = this._placementPos;

            this.bodyEditor.confirmCreate({ name, mass, radius, color, visualR, x, y, z });
            // 确认后隐藏所有引导元素
            if (this.bodyEditor.guides) {
                this.bodyEditor.guides.hide();
                this.bodyEditor.guides.clearAll();
            }
            this._placementPos = null;
            confirmBtn.disabled = true;
            confirmBtn.textContent = '📍 先点击场景放置位置';
            document.getElementById('abp-pos-info').textContent = '等待放置...';
            document.getElementById('abp-vel-info').textContent = '未设置';
            document.getElementById('abp-velocity-section')?.classList.add('hidden');
            this._refreshBodyList();
        });

        // ---- 视觉大小实时更新预览球 ----
        document.getElementById('abp-visual')?.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value) || 1.0;
            if (this.bodyEditor && this.bodyEditor.guides) {
                this.bodyEditor.guides.setPreviewScale(val);
            }
        });

        // ---- 初速度 ----
        document.getElementById('abp-vel-btn')?.addEventListener('click', () => {
            this.bodyEditor.setVelocityMagnitude(
                parseFloat(document.getElementById('abp-vel-speed').value) || 0
            );
            this.bodyEditor.startVelocityPick();
        });
        document.getElementById('abp-vel-speed')?.addEventListener('input', (e) => {
            this.bodyEditor.setVelocityMagnitude(parseFloat(e.target.value) || 0);
        });
    }

    _onPlacementDone(x, y, z, au) {
        this._placementPos = { x, y, z };
        document.getElementById('abp-pos-info').textContent =
            `(${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}) ≈ ${au.toFixed(2)} AU`;
        const confirmBtn = document.getElementById('abp-confirm');
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.textContent = '🚀 确认发射入轨';
        }
        // 显示初速度区域
        const velSection = document.getElementById('abp-velocity-section');
        if (velSection) velSection.classList.remove('hidden');
        document.getElementById('abp-vel-info').textContent = '未设置（默认计算轨道速度）';
        this._switchToTab('abp-add');
    }

    _onVelocityDone() {
        const vel = this.bodyEditor.getVelocity();
        const mag = vel.length();
        document.getElementById('abp-vel-info').textContent =
            `方向已设定 | 大小: ${mag.toFixed(1)} m/s`;
    }

    _switchToTab(targetId) {
        this.addBodyPanel.querySelectorAll('.abp-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.tab === targetId);
        });
        this.addBodyPanel.querySelectorAll('.abp-section').forEach(s => {
            s.classList.toggle('active', s.id === targetId);
        });
    }

    _refreshBodyList() {
        const listBody = document.getElementById('abp-list-body');
        if (!listBody) return;
        const list = this.bodyEditor.getCustomBodies();
        if (list.length === 0) {
            listBody.innerHTML = '<div style="color:#667;font-size:12px;text-align:center;padding:10px;">暂无自定义星体</div>';
            return;
        }
        listBody.innerHTML = list.map(c => {
            const mass = c.mass || 0;
            const radius = c.radius || 0;
            const visR = c.visualR || 1.0;
            const isBH = c.isBlackHole || false;
            const nameTag = isBH ? '🕳️ ' : '';
            const infoText = c.radius ? `${(mass / 1e24).toFixed(1)}e24 kg · ${(radius / 1000).toFixed(0)} km` : '黑洞';
            return `
            <div class="abp-list-item" data-key="${c.key}">
                <div class="abp-list-main">
                    <span class="abp-list-name">${nameTag}${c.name}</span>
                    <span class="abp-list-info">${infoText}</span>
                </div>
                <span class="abp-list-actions">
                    <button class="abp-edit" data-key="${c.key}">✎</button>
                    <button class="abp-del" data-key="${c.key}">🗑</button>
                </span>
            </div>
            <div class="abp-edit-row hidden" data-key="${c.key}">
                <input class="abp-edit-name" value="${c.name}" placeholder="名称" />
                <input class="abp-edit-mass" type="number" value="${mass}" step="any" placeholder="质量(kg)" />
                <input class="abp-edit-visual" type="number" value="${visR}" step="0.1" placeholder="视觉大小" />
                <button class="abp-edit-save" data-key="${c.key}">💾</button>
            </div>
        `}).join('');

        // 悬浮高亮
        listBody.querySelectorAll('.abp-list-item').forEach(item => {
            const key = item.dataset.key;
            item.addEventListener('mouseenter', () => this.bodyEditor.highlightBody(key, true));
            item.addEventListener('mouseleave', () => this.bodyEditor.highlightBody(key, false));
        });

        // 删除
        listBody.querySelectorAll('.abp-del').forEach(btn => {
            btn.addEventListener('click', () => {
                this.bodyEditor.deleteBody(btn.dataset.key);
                this._refreshBodyList();
            });
        });

        // 编辑展开
        listBody.querySelectorAll('.abp-edit').forEach(btn => {
            btn.addEventListener('click', () => {
                const key = btn.dataset.key;
                const row = listBody.querySelector(`.abp-edit-row[data-key="${key}"]`);
                row.classList.toggle('hidden');
            });
        });

        // 保存编辑
        listBody.querySelectorAll('.abp-edit-save').forEach(btn => {
            btn.addEventListener('click', () => {
                const key = btn.dataset.key;
                const row = listBody.querySelector(`.abp-edit-row[data-key="${key}"]`);
                const name = row.querySelector('.abp-edit-name').value;
                const mass = parseFloat(row.querySelector('.abp-edit-mass').value);
                const visualR = parseFloat(row.querySelector('.abp-edit-visual').value);
                const updates = {};
                if (name) updates.name = name;
                if (!isNaN(mass)) updates.mass = mass;
                if (!isNaN(visualR)) updates.visualR = visualR;
                this.bodyEditor.editBody(key, updates);
                row.classList.add('hidden');
                this._refreshBodyList();
            });
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

        // --- 卫星式追踪 ---
        this.focusController.update();

        // --- 探测器 ---
        if (this.probeData && this.probeMesh) {
            if (this.probeData.isManual && this._recalling) {
                this._cleanProbeKeepAim();
            } else {
                // 手动发射且无锁定目标：自由飞行
                if (this.probeData.isManual && !this.probeData.body) {
                    this.probeMesh.position.add(
                        this.probeData.velocity.clone().multiplyScalar(dt)
                    );
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
                        if (dist < vr * 1.5) {
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

        this.sceneManager.render(this.focusController.isFocused);

        this.frameCount++;
        const now = performance.now();
        if (now - this.lastFpsTime >= 1000) {
            this.fpsEl.textContent = 'FPS: ' + Math.round(this.frameCount / ((now - this.lastFpsTime) / 1000));
            this.frameCount = 0;
            this.lastFpsTime = now;
        }
    }

    // ==================== 表面全景 ====================
    _setupSurfaceViewer() {
        this.surfaceOverlay = document.getElementById('surface-overlay');
        this.surfaceImage = document.getElementById('surface-image');
        this.surfaceTitle = document.getElementById('surface-title');
        this.surfaceClose = document.getElementById('surface-close');
        this.surfaceClose?.addEventListener('click', () => this.surfaceOverlay.classList.add('hidden'));
        this.surfaceOverlay?.addEventListener('click', (e) => {
            if (e.target === this.surfaceOverlay) this.surfaceOverlay.classList.add('hidden');
        });
    }

    _showSurface(planetKey, moonKey) {
        const fileName = moonKey ? `${planetKey}_${moonKey}.jpg` : `${planetKey}.jpg`;
        const name = moonKey
            ? this.allMoons[planetKey]?.find(m => m.key === moonKey)?.name || moonKey
            : this.planets[planetKey]?.nameCN || planetKey;
        document.body.style.transition = 'opacity 0.15s';
        document.body.style.opacity = '0';
        setTimeout(() => {
            this.surfaceImage.src = SURFACE_DIR + fileName;
            this.surfaceImage.onerror = () => {
                this.surfaceImage.src = '';
                this.surfaceTitle.textContent = `${name} — 表面图未找到`;
            };
            this.surfaceImage.onload = () => {
                this.surfaceTitle.textContent = `${name} 表面`;
            };
            this.surfaceOverlay.classList.remove('hidden');
            document.body.style.opacity = '1';
        }, 180);
    }
}

try { new SolarSystemApp(); } catch (err) {
    console.error('[SolarSystem] 启动失败:', err);
}
