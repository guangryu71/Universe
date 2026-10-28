// ============================================================
// FocusController.js — 星球聚焦 + 摄像机追踪系统
// 从 main.js 提取，管理卫星式追踪的全部逻辑
// ============================================================
import * as THREE from 'three';
import { SYSTEM_SCALE } from './constants.js';
import { getGalaxyById } from './galaxyRegistry.js?v=8';

export class FocusController {
    /**
     * @param {object} deps
     * @param {THREE.Camera} deps.camera
     * @param {HTMLCanvasElement} deps.canvas
     * @param {object} deps.controls — OrbitControls 实例
     * @param {object} deps.planets — { key: CelestialBody }
     * @param {object} deps.allMoons — { parentKey: [moonObjects] }
     * @param {function} deps.onSpeak — TTS 回调 (text)
     */
    constructor({ camera, canvas, controls, planets, allMoons, onSpeak }) {
        this.camera = camera;
        this.canvas = canvas;
        this.controls = controls;
        this.planets = planets;
        this.allMoons = allMoons;
        this.onSpeak = onSpeak || (() => {});

        // 聚焦状态
        this._focusBody = null;
        this._focusOffset = null;
        this._spokenKeys = new Set();
        this._midDrag = false;
        this._midLastX = 0;
        this._midLastY = 0;
        this._trackDebug = null;

        this._bindFocusInput();
    }

    // ==================== 公开 API ====================

    /** 聚焦某个天体（与点击卡片行为一致） */
    focusBody(body, moonData) {
        if (!body || !body.mesh) {
            console.warn('[FocusController] focusBody: 无效天体', body?.key);
            return;
        }
        const cam = this.camera;
        const meshPos = body.mesh.position.clone();

        const offset = new THREE.Vector3().subVectors(cam.position, meshPos);
        const targetDist = Math.min(Math.max(body.visualRadius * 10 * SYSTEM_SCALE, 5), 200);
        offset.normalize().multiplyScalar(targetDist);

        cam.position.copy(meshPos).add(offset);
        cam.lookAt(meshPos);

        this._focusOffset = offset;
        this._focusBody = body;
        if (moonData) this._focusBody._moonOverride = moonData;
        this.controls.enabled = false;
        this.controls.target.copy(meshPos);

        console.log('[FocusController] 聚焦:', body.key, '距离:', targetDist.toFixed(1));

        if (body.voiceIntro && !this._spokenKeys.has(body.key)) {
            this._spokenKeys.add(body.key);
            this.onSpeak(body.voiceIntro);
        }
    }

    /** 通过 key 聚焦星球（供 GalaxyBrowser 使用） */
    focusByKey(bodyKey) {
        const body = this.planets[bodyKey];
        if (!body) {
            console.warn('[FocusController] 找不到星球:', bodyKey);
            return;
        }
        if (this._focusBody) this.dismiss();
        this.focusBody(body, null);
    }

    /** 导航到星系视图（聚焦星系中心恒星） */
    navigateToGalaxy(galaxyId) {
        const galaxy = getGalaxyById(galaxyId);
        if (!galaxy) return;

        const starPlanet = galaxy.planets?.find(p => p.isStar);
        if (starPlanet) {
            this.focusByKey(starPlanet.key);
        } else if (galaxyId === 'solar-system') {
            this.focusByKey('sun');
        } else {
            const firstPlanet = galaxy.planets?.[0];
            if (firstPlanet) this.focusByKey(firstPlanet.key);
        }
    }

    /** 解除聚焦，恢复 OrbitControls */
    dismiss() {
        // OrbitControls 的 target 必须落在星球“当前”位置：聚焦期间星球一直在运动，
        // 若沿用聚焦瞬间的位置，恢复后相机会围绕很远处的空点旋转/平移，视角会突然失控。
        const mesh = this._focusBody?.mesh;
        if (mesh) this.controls.target.copy(mesh.position);
        this._focusBody = null;
        this._focusOffset = null;
        this._trackDebug = null;
        this.controls.enabled = true;
        this._midDrag = false;
        this.controls.update();
    }

    /** 每帧更新：追踪聚焦星球 */
    update() {
        if (!this._focusBody || !this._focusOffset || !this._focusBody.mesh) return;
        const meshPos = this._focusBody.mesh.position.clone();
        const cam = this.camera;

        cam.position.copy(meshPos).add(this._focusOffset);
        const fwd = new THREE.Vector3().copy(this._focusOffset).negate().normalize();
        cam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), fwd);

        // 持续同步 OrbitControls 目标点，解除聚焦后可以直接接着旋转 / 缩放
        this.controls.target.copy(meshPos);
    }

    get isFocused() { return !!this._focusBody; }
    get focusedTarget() { return this._focusBody; }

    // ==================== 输入绑定 ====================
    _bindFocusInput() {
        const canvas = this.canvas;
        const MIN = 1, MAX = 500, ZOOM = 1.12;
        const H_ROT = 0.005, V_ROT = 0.005;

        canvas.addEventListener('wheel', (e) => {
            if (!this._focusOffset) return;
            e.preventDefault();
            // 向下滚动滚轮 → 放大(拉近)，向上滚动 → 缩小(拉远)
            this._focusOffset.multiplyScalar(e.deltaY > 0 ? 1 / ZOOM : ZOOM);
            const d = this._focusOffset.length();
            if (d < MIN) this._focusOffset.normalize().multiplyScalar(MIN);
            if (d > MAX) this._focusOffset.normalize().multiplyScalar(MAX);
        }, { passive: false });

        canvas.addEventListener('mousedown', (e) => {
            if (e.button !== 1 || !this._focusOffset) return;
            e.preventDefault();
            this._midDrag = true;
            this._midLastX = e.clientX;
            this._midLastY = e.clientY;
        });

        window.addEventListener('mousemove', (e) => {
            if (!this._midDrag || !this._focusOffset) return;
            const dx = e.clientX - this._midLastX;
            const dy = e.clientY - this._midLastY;
            this._midLastX = e.clientX;
            this._midLastY = e.clientY;

            if (dx !== 0) {
                this._focusOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), -dx * H_ROT);
            }
            if (dy !== 0) {
                const right = new THREE.Vector3()
                    .crossVectors(this._focusOffset, new THREE.Vector3(0, 1, 0))
                    .normalize();
                this._focusOffset.applyAxisAngle(right, dy * V_ROT);
            }
        });

        window.addEventListener('mouseup', (e) => {
            if (e.button === 1) this._midDrag = false;
        });
        canvas.addEventListener('auxclick', (e) => { e.preventDefault(); });
    }
}
