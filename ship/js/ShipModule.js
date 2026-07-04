// ============================================================
// ShipModule.js — 飞船模块协调器
// 进入飞船：相机平滑 tween 进舱 → PointerLock 走动
// 跃迁：shipGroup 移动到目标星体附近 + 锚定跟随
// NAV按钮：退出飞船返回宇宙视图
// ============================================================
import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { SYSTEM_SCALE } from '../../js/constants.js';
import { ShipModel } from './ShipModel.js';
import { PlayerController } from './PlayerController.js';
import { Hologram } from './Hologram.js';

const UNIVERSE_UI = [
    'time-control','hint','fps','bgm-control','chat-launcher',
    'voice-settings-btn','add-body-btn','view-plane-btns',
    'planet-card','ship-entry-btn','galaxy-browser-btn','planet-lab-btn',
];

export class ShipModule {
    constructor(sceneManager, planets, physics) {
        this.sceneManager = sceneManager;
        this.planets = planets;
        this.physics = physics;
        this.state = 'universe'; // universe | entering | ship | exiting

        // 舱室模型
        this.shipModel = new ShipModel();
        this.shipGroup = this.shipModel.getShipGroup();
        this.sceneManager.scene.add(this.shipGroup);
        this._positionNearEarth();

        // PointerLockControls
        this.controls = new PointerLockControls(this.sceneManager.camera, document.body);
        this.controls.lockSpeed = 0.1;

        // PlayerController
        this.player = new PlayerController(
            this.sceneManager.camera, this.shipModel.getRoom(),
            this.sceneManager.renderer.domElement,
            (locked) => {
                if (!locked && this.state === 'ship' && !this._holo?.isUIActive && !this._holo?.focusedPlanet) {
                    // 退出锁定时显示覆盖提示
                }
            }
        );
        this.player.setPointerLockControls(this.controls);

        // 全息投影
        this._holo = new Hologram(
            this.shipGroup, new THREE.Vector3(0, 1.8, 0),
            this.sceneManager.camera,
            (body) => this.warpToBody(body),
            (active) => {
                if (active) { this.controls.unlock(); document.exitPointerLock(); }
                else { this.controls.lock(); }
            }
        );

        // 保存/恢复宇宙视角
        this._savedPos = new THREE.Vector3();
        this._savedTarget = new THREE.Vector3();
        this._savedQuat = new THREE.Quaternion();
        this._tween = null;
        this._clock = 0;
        this._warpTarget = null;
        this._warpOffset = new THREE.Vector3();
        this._lastVel = new THREE.Vector3();

        this._flash = document.createElement('div');
        this._flash.style.cssText = 'position:fixed;inset:0;z-index:999999;background:#fff;opacity:0;pointer-events:none;transition:opacity 0.3s;';
        document.body.appendChild(this._flash);

        this._bind();
    }

    _positionNearEarth() {
        const e = this.planets.earth;
        const p = e ? e.mesh.position.clone() : new THREE.Vector3(0,0,30);
        this.shipGroup.position.copy(p).add(new THREE.Vector3(8,4,8).multiplyScalar(SYSTEM_SCALE));
    }

    // ==================== 进入 / 退出 ====================
    enterShip() {
        if (this.state !== 'universe') return;

        // 禁用 OrbitControls
        this.sceneManager.controls.enabled = false;
        const canvas = this.sceneManager.renderer.domElement;
        this._ptrBlock = (e) => e.stopImmediatePropagation();
        canvas.addEventListener('pointerdown', this._ptrBlock, { capture: true });
        canvas.addEventListener('pointermove', this._ptrBlock, { capture: true });
        canvas.addEventListener('pointerup', this._ptrBlock, { capture: true });

        const cam = this.sceneManager.camera;
        const dir = cam.getWorldDirection(new THREE.Vector3());
        this.shipGroup.position.copy(cam.position).add(dir.multiplyScalar(-4));
        this.shipGroup.quaternion.set(0,0,0,1);

        this._savedPos.copy(cam.position);
        this._savedTarget.copy(this.sceneManager.controls.target || new THREE.Vector3());
        this._savedQuat.copy(cam.quaternion);

        this._hideUI();
        // 显示飞船 HUD
        const hT = document.getElementById('ship-hud-top');
        const hB = document.getElementById('ship-hud-bottom');
        if (hT) hT.style.display = '';
        if (hB) hB.style.display = '';

        // 注入当前系统天体到全息
        this._holo.setBodies(this._currentBodies());

        // tween（保存进出 quaternion 供 slerp）
        const spawnLocal = new THREE.Vector3(0, 1.65, 5.5);
        const target = this.shipGroup.localToWorld(spawnLocal.clone());
        const targetLookAt = this.shipGroup.localToWorld(new THREE.Vector3(0, 1.65, -2));
        const enterQFrom = cam.quaternion.clone();
        const enterQTo = new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 0, -1),
            targetLookAt.clone().sub(target).normalize()
        );
        this._tween = {
            from: cam.position.clone(), to: target,
            qFrom: enterQFrom, qTo: enterQTo,
            t: 0, dur: 1.2, onDone: () => {
                this.state = 'ship';
                this.player.setOrigin(this.shipGroup.position);
                this.player.enable();
                // 更新全息天体数据（可能系统已切换）
                this._holo.setBodies(this._currentBodies());
                this._showToast('✦ 点击屏幕锁定鼠标 · ESC 退出舱室');
            }
        };
        this.state = 'entering';
    }

    exit() {
        if (this.state !== 'ship') return;
        this.player.disable();
        try { this.controls.unlock(); } catch(e) {}
        this._holo._hideCtx();
        this._holo.hideUI(true); // skipLock = true，避免重复锁定

        const cam = this.sceneManager.camera;
        const exitPosFrom = cam.position.clone();
        const exitQuatFrom = cam.quaternion.clone();
        this._tween = {
            from: exitPosFrom, to: this._savedPos.clone(),
            qFrom: exitQuatFrom, qTo: this._savedQuat.clone(),
            t: 0, dur: 1.0, onDone: () => {
                if (this._ptrBlock) {
                    const c = this.sceneManager.renderer.domElement;
                    c.removeEventListener('pointerdown', this._ptrBlock, { capture: true });
                    c.removeEventListener('pointermove', this._ptrBlock, { capture: true });
                    c.removeEventListener('pointerup', this._ptrBlock, { capture: true });
                    this._ptrBlock = null;
                }
                const cam2 = this.sceneManager.camera;
                cam2.position.copy(this._savedPos);
                cam2.quaternion.copy(this._savedQuat);
                this.sceneManager.controls.target?.copy(this._savedTarget);
                this.sceneManager.controls.enabled = true;
                this.sceneManager.controls.update?.();
                this._showUI();
                // 隐藏飞船 HUD
                const hT = document.getElementById('ship-hud-top');
                const hB = document.getElementById('ship-hud-bottom');
                if (hT) hT.style.display = 'none';
                if (hB) hB.style.display = 'none';
                this.state = 'universe';
                this._warpTarget = null;
            }
        };
        this.state = 'exiting';
    }

    // ==================== 跃迁 ====================
    async warpToBody(body) {
        if (!body || !body.mesh) return;
        // 闪白
        this._flash.style.transition = 'opacity 0.12s';
        this._flash.style.opacity = '1';
        await new Promise(r => setTimeout(r, 150));

        const target = body.mesh.position.clone();
        const radius = (body.visualRadius || 2) * SYSTEM_SCALE;
        // 飞船与星体同一水平面（y 对齐），在星体平行位置处偏移
        const angle = Math.random() * Math.PI * 2;
        const dist = radius * 3.5 + 2 * SYSTEM_SCALE;
        const offset = new THREE.Vector3(
            Math.cos(angle) * dist,
            0,
            Math.sin(angle) * dist
        );

        this._warpOffset.copy(offset);
        this._warpTarget = body;
        this.shipGroup.position.copy(target).add(offset);
        this.player.setOrigin(this.shipGroup.position);
        // 跃迁后重新注入天体数据（位置已更新）
        this._holo.setBodies(this._currentBodies());

        this._flash.style.transition = 'opacity 0.3s';
        this._flash.style.opacity = '0';
        // 清除聚焦 + 隐藏跃迁按钮
        if (this._holo) this._holo.clearFocus();
        this._showToast(`✦ 跃迁完成 · ${body.name || body.key}`);
    }

    // ==================== 每帧 ====================
    update(dt) {
        const dc = Math.min(dt, 0.1);
        this._clock += dc;

        // tween
        if (this._tween) {
            this._tween.t += dc;
            const k = Math.min(1, this._tween.t / this._tween.dur);
            const e = 1 - Math.pow(1 - k, 3);
            const cam = this.sceneManager.camera;
            if (this._tween.from && this._tween.to) cam.position.lerpVectors(this._tween.from, this._tween.to, e);
            if (this._tween.qFrom && this._tween.qTo) cam.quaternion.copy(this._tween.qFrom).slerp(this._tween.qTo, e);
            else {
                const lk = new THREE.Vector3().lerpVectors(this._tween.lookFrom, this._tween.lookTo, e);
                cam.lookAt(lk);
            }
            if (k >= 1) { const cb = this._tween.onDone; this._tween = null; cb?.(); }
            return;
        }

        if (this.state !== 'ship') return;

        // 跃迁跟随
        if (this._warpTarget && this._warpTarget.mesh) {
            this.shipGroup.position.copy(this._warpTarget.mesh.position).add(this._warpOffset);
            this.player.setOrigin(this.shipGroup.position);
        }

        this.shipModel.updateDecor(this._clock, dc);
        this.player.update(dc);
        this._holo.update(dc, this._clock);

        // 更新 tooltip / mode
        const tt = document.getElementById('hover-tooltip');
        const mv = document.getElementById('mode-value');
        if (!tt || !mv) return;
        const fp = this._holo.focusedPlanet;
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(0, 0), this.sceneManager.camera);
        const hits = raycaster.intersectObjects(this._holo.planetMeshes, false);
        const isHover = hits.length > 0 && !fp;

        if (fp) {
            tt.textContent = fp.userData.planetName; tt.style.opacity = '1';
            mv.textContent = fp.userData.planetName.toUpperCase(); mv.style.color = '#00ff9c';
        } else if (isHover) {
            tt.textContent = hits[0].object.userData.planetName; tt.style.opacity = '1';
            mv.textContent = hits[0].object.userData.planetName.toUpperCase(); mv.style.color = '#9ce8ff';
        } else if (this._holo.isHoverShell) {
            tt.textContent = '星体系统全息投影'; tt.style.opacity = '1';
            mv.textContent = 'HOLOGRAM'; mv.style.color = '#9ce8ff';
        } else {
            tt.style.opacity = '0';
            mv.textContent = 'EXPLORATION'; mv.style.color = '#00d4ff';
        }
    }

    render() {
        if (this.state === 'universe' || this.state === 'entering' || this.state === 'exiting') {
            // 过渡期间也渲染场景
            if (this._tween) this.sceneManager.renderer.render(this.sceneManager.scene, this.sceneManager.camera);
            return;
        }
        this.sceneManager.renderer.render(this.sceneManager.scene, this.sceneManager.camera);
    }

    isActive() { return this.state !== 'universe'; }

    _currentBodies() {
        return this.physics ? this.physics.bodies.filter(b => b.mesh) : [];
    }

    _showToast(msg) {
        const t = document.getElementById('toast');
        if (!t) return;
        t.textContent = msg; t.classList.add('show');
        clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2400);
    }

    /** 获取当前舱内可跃迁天体列表 */
    getWarpTargets() { return this._currentBodies(); }

    // ==================== 输入 ====================
    _bind() {
        document.addEventListener('keydown', (e) => {
            if (this.state === 'ship' && e.key === 'Escape') {
                e.preventDefault();
                this.exit();
            }
        });

        // 左键点击 → 全息交互 或 锁定指针
        document.addEventListener('mousedown', (e) => {
            if (this.state !== 'ship') return;
            if (e.button === 0) {
                // 点击 UI 元素时不锁定指针
                if (e.target.closest('#ui-screen') || e.target.closest('#context-menu') || e.target.closest('#toast')) return;
                if (!this.controls.isLocked) { this.controls.lock(); return; }
                this._holo.handleMouseDown(0, e.clientX, e.clientY);
            }
            if (e.button === 2 && this.controls.isLocked && !e.target.closest('#context-menu')) {
                // 右键 → 全息菜单：暂时解锁鼠标
                try { this.controls.unlock(); } catch(er) {}
                try { document.exitPointerLock(); } catch(er) {}
                setTimeout(() => this._holo.handleMouseDown(2, e.clientX, e.clientY), 50);
            }
        });

        document.addEventListener('contextmenu', (e) => {
            if (this.state === 'ship') e.preventDefault();
        });

        // 滚轮
        document.addEventListener('wheel', (e) => {
            if (this.state === 'ship' && (this.controls.isLocked || this._holo.focusedPlanet)) {
                e.preventDefault();
                this._holo.handleWheel(e.deltaY);
            }
        }, { passive: false });

        // UI 关闭按钮
        document.getElementById('ui-close-btn')?.addEventListener('click', () => this._holo?.hideUI());

        // UI 按钮：NAV → 退出飞船
        document.querySelectorAll('.ui-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const a = btn.dataset.action;
                if (a === 'nav') { this.exit(); return; }
                this._showToast({
                    nav: '导航系统已校准', shield: '能量护盾已激活',
                    scan: '深空扫描启动', warp: '曲率引擎预热'
                }[a] || '指令已执行');
            });
        });
    }

    _hideUI() { UNIVERSE_UI.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; }); }
    _showUI() { UNIVERSE_UI.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = ''; }); }
}
