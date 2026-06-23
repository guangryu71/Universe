// ============================================================
// PlanetLab.js — 星球实验室
// 全屏覆盖层，独立场景 + 物理引擎，可视化放置星球（同 BodyEditor 流程）
// 步骤：① XZ平面定位 → ② Y高度 → ③ 速度方向(XZ面) → ④ 速度仰角
// 实时显示坐标 + 角度（偏X轴角度 / 偏XZ面仰角）
// ============================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CelestialBody } from '../js/CelestialBody.js';
import { PhysicsEngine } from '../js/physics.js';
import { POS_SCALE, G, AU, formatMass } from '../js/constants.js';
import { screenToNDC } from '../js/utils.js';
import { PlacementHUD } from './PlacementHUD.js';
import { PlacementGuides } from './PlacementGuides.js';

export class PlanetLab {
    constructor() {
        this._bodies = [];
        this._collisionBoxes = [];
        this._selectedBody = null;
        this._isOpen = false;

        // 放置状态机：idle → placing_xz → placing_y → placing_v_azimuth → placing_v_elevation
        this._placeState = 'idle';
        this._lockedXZ = null;   // { x, z }
        this._lockedY = 0;
        this._bodyPos = new THREE.Vector3();
        this._vAzimDir = new THREE.Vector3();  // XZ面方向
        this._vDir = new THREE.Vector3();      // 最终方向
        this._vMag = 0;

        // 待创建的天体参数（从表单收集）
        this._pendingBody = null;

        this._buildDOM();
        this._bindEvents();
    }

    // ==================== DOM ====================
    _buildDOM() {
        this.overlay = document.createElement('div');
        this.overlay.id = 'planet-lab-overlay';
        this.overlay.className = 'planet-lab-overlay hidden';
        this.overlay.innerHTML = `
            <div class="pl-backdrop"></div>
            <div class="pl-main">
                <div class="pl-header">
                    <span>🔬 星球实验室</span>
                    <div class="pl-header-actions">
                        <button id="pl-toggle-collision" class="pl-header-btn" title="切换碰撞箱">📦 碰撞箱</button>
                        <button id="pl-close" class="pl-close-btn">&times;</button>
                    </div>
                </div>
                <div class="pl-canvas-wrap" id="pl-canvas-wrap">
                    <!-- 实时坐标 HUD -->
                    <div class="pl-hud" id="pl-hud" style="display:none;">
                        <div class="pl-hud-row"><span>📍 位置</span><span id="pl-hud-pos">--</span></div>
                        <div class="pl-hud-row"><span>🧭 偏X轴角</span><span id="pl-hud-azim">--</span></div>
                        <div class="pl-hud-row"><span>📐 仰角(偏XZ面)</span><span id="pl-hud-elev">--</span></div>
                        <div class="pl-hud-row" id="pl-hud-speed-row" style="display:none;"><span>⚡ 速度大小</span><span id="pl-hud-speed">0 m/s</span></div>
                        <div class="pl-hud-hint" id="pl-hud-hint">点击视图放置 XZ 位置</div>
                    </div>
                </div>
                <div class="pl-sidebar" id="pl-sidebar">
                    <div class="pl-sidebar-title">🪐 星球管理</div>
                    <div class="pl-body-list" id="pl-body-list">
                        <div class="pl-empty">暂无星球，点击下方按钮添加</div>
                    </div>
                    <div class="pl-sidebar-actions">
                        <button id="pl-add-btn" class="pl-action-btn pl-add">➕ 添加星球（可视化放置）</button>
                    </div>
                </div>
            </div>
            <!-- 属性表单弹窗 -->
            <div class="pl-modal hidden" id="pl-modal">
                <div class="pl-modal-backdrop"></div>
                <div class="pl-modal-panel">
                    <div class="pl-modal-header">
                        <span id="pl-modal-title">添加星球</span>
                        <button id="pl-modal-close">&times;</button>
                    </div>
                    <div class="pl-modal-body">
                        <div class="pl-row"><label>名称</label><input id="pl-edit-name" value="新星球" /></div>
                        <div class="pl-row"><label>质量 (kg)</label><input id="pl-edit-mass" type="number" value="5.97e24" step="any" /></div>
                        <div class="pl-row"><label>半径 (km)</label><input id="pl-edit-radius" type="number" value="6371" step="any" /></div>
                        <div class="pl-row"><label>视觉大小</label><input id="pl-edit-visual" type="number" value="0.8" step="0.1" min="0.1" /></div>
                        <div class="pl-row"><label>颜色</label><input id="pl-edit-color" type="color" value="#ff8844" /></div>
                        <div class="pl-row"><label>贴图</label><input id="pl-edit-texture" type="file" accept="image/*" style="font-size:10px" /></div>
                        <div class="pl-row"><label>速度大小</label><input id="pl-edit-velmag" type="number" value="0" step="100" placeholder="m/s（0=静止）" /></div>
                    </div>
                    <div class="pl-modal-footer">
                        <button id="pl-modal-next" class="pl-action-btn pl-save">📍 下一步：可视化放置</button>
                        <button id="pl-modal-cancel" class="pl-action-btn pl-cancel">取消</button>
                    </div>
                </div>
            </div>
            <!-- 编辑弹窗 -->
            <div class="pl-modal hidden" id="pl-edit-modal">
                <div class="pl-modal-backdrop"></div>
                <div class="pl-modal-panel">
                    <div class="pl-modal-header">
                        <span>编辑星球</span>
                        <button id="pl-edit-modal-close">&times;</button>
                    </div>
                    <div class="pl-modal-body">
                        <div class="pl-row"><label>名称</label><input id="pl-edit2-name" /></div>
                        <div class="pl-row"><label>质量 (kg)</label><input id="pl-edit2-mass" type="number" step="any" /></div>
                        <div class="pl-row"><label>半径 (km)</label><input id="pl-edit2-radius" type="number" step="any" /></div>
                        <div class="pl-row"><label>视觉大小</label><input id="pl-edit2-visual" type="number" step="0.1" /></div>
                        <div class="pl-row"><label>颜色</label><input id="pl-edit2-color" type="color" /></div>
                    </div>
                    <div class="pl-modal-footer">
                        <button id="pl-edit-save" class="pl-action-btn pl-save">💾 保存</button>
                        <button id="pl-edit-cancel" class="pl-action-btn pl-cancel">取消</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(this.overlay);

        // DOM 引用
        this.bodyListEl   = this.overlay.querySelector('#pl-body-list');
        this.canvasWrap   = this.overlay.querySelector('#pl-canvas-wrap');
        this.modal        = this.overlay.querySelector('#pl-modal');
        this.modalTitle   = this.overlay.querySelector('#pl-modal-title');
        this.editModal    = this.overlay.querySelector('#pl-edit-modal');
        this.collisionBtn = this.overlay.querySelector('#pl-toggle-collision');
        this.hudEl        = this.overlay.querySelector('#pl-hud');
        this._showCollision = true;
    }

    // ==================== 事件绑定 ====================
    _bindEvents() {
        this.overlay.querySelector('#pl-close').addEventListener('click', () => this.close());
        this.overlay.querySelector('.pl-backdrop').addEventListener('click', () => this.close());

        // 添加按钮 → 打开属性表单
        this.overlay.querySelector('#pl-add-btn').addEventListener('click', () => {
            this._editingBody = null;
            this.modalTitle.textContent = '添加星球';
            document.getElementById('pl-edit-name').value = '新星球';
            document.getElementById('pl-edit-mass').value = '5.97e24';
            document.getElementById('pl-edit-radius').value = '6371';
            document.getElementById('pl-edit-visual').value = '0.8';
            document.getElementById('pl-edit-color').value = '#ff8844';
            document.getElementById('pl-edit-velmag').value = '0';
            document.getElementById('pl-edit-texture').value = '';
            this.modal.classList.remove('hidden');
        });

        // 属性表单 → 下一步
        this.overlay.querySelector('#pl-modal-next').addEventListener('click', () => this._startPlacement());
        this.overlay.querySelector('#pl-modal-close').addEventListener('click', () => this.modal.classList.add('hidden'));
        this.overlay.querySelector('#pl-modal-cancel').addEventListener('click', () => this.modal.classList.add('hidden'));

        // 编辑弹窗
        this.overlay.querySelector('#pl-edit-modal-close').addEventListener('click', () => this.editModal.classList.add('hidden'));
        this.overlay.querySelector('#pl-edit-cancel').addEventListener('click', () => this.editModal.classList.add('hidden'));
        this.overlay.querySelector('#pl-edit-save').addEventListener('click', () => this._saveEdit());

        // 碰撞箱切换
        this.collisionBtn.addEventListener('click', () => {
            this._showCollision = !this._showCollision;
            this.collisionBtn.classList.toggle('active', this._showCollision);
            this._updateCollisionVisibility();
        });
        this.collisionBtn.classList.add('active');

        // ESC
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this._isOpen) {
                if (this._placeState !== 'idle') {
                    this._exitPlacement();
                } else if (!this.modal.classList.contains('hidden')) {
                    this.modal.classList.add('hidden');
                } else if (!this.editModal.classList.contains('hidden')) {
                    this.editModal.classList.add('hidden');
                } else {
                    this.close();
                }
            }
        });
    }

    // ==================== 场景 ====================
    _initScene() {
        if (this._scene) return;

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.canvasWrap.appendChild(this.renderer.domElement);

        this._scene = new THREE.Scene();

        this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 500);
        this.camera.position.set(10, 12, 18);
        this.camera.lookAt(0, 0, 0);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        this.controls.target.set(0, 0, 0);
        this.controls.update();

        this._scene.add(new THREE.AmbientLight(0x334466, 2.5));
        const pt = new THREE.PointLight(0xfff8e8, 8.0, 0, 0.8);
        pt.position.set(0, 5, 0);
        this._scene.add(pt);

        const grid = new THREE.GridHelper(40, 40, 0x334455, 0x222233);
        this._scene.add(grid);

        // 原点参考点
        const dotGeo = new THREE.SphereGeometry(0.15, 8, 8);
        const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const originDot = new THREE.Mesh(dotGeo, dotMat);
        this._scene.add(originDot);

        // 坐标轴（红X, 绿Y, 蓝Z）
        this._addAxisLine(new THREE.Vector3(0,0,0), new THREE.Vector3(8,0,0), 0xff4444); // X
        this._addAxisLine(new THREE.Vector3(0,0,0), new THREE.Vector3(0,8,0), 0x44ff44); // Y
        this._addAxisLine(new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,8), 0x4488ff); // Z

        // 放置引导元素
        this._guideGroup = new THREE.Group();
        this._guideGroup.visible = false;
        this._scene.add(this._guideGroup);

        this._buildGuides();
        this._buildPreview();

        this.physics = new PhysicsEngine([]);
        this._animate();
    }

    _addAxisLine(from, to, color) {
        const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
        const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.5 }));
        this._scene.add(line);
    }

    // ==================== 引导元素 ====================
    _buildGuides() {
        // XZ投影线
        this._projLine = this._createGuideLine(0xff4444);
        this._projLineY = this._createGuideLine(0x44ff44);
        // 速度箭头
        this._vArrowLine = this._createGuideLine(0xffcc00);
        const coneGeo = new THREE.ConeGeometry(0.12, 0.35, 8, 4);
        const coneMat = new THREE.MeshBasicMaterial({ color: 0xffcc00 });
        this._vArrowHead = new THREE.Mesh(coneGeo, coneMat);
        this._vArrowHead.visible = false;
        this._guideGroup.add(this._vArrowHead);
        // XZ面上的速度投影线
        this._vProjLine = this._createGuideLine(0xffaa44);
    }

    _createGuideLine(color) {
        const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
        const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6, depthTest: true }));
        this._guideGroup.add(line);
        return line;
    }

    _updateGuideLine(line, from, to) {
        const p = line.geometry.attributes.position.array;
        p[0]=from.x; p[1]=from.y; p[2]=from.z;
        p[3]=to.x;   p[4]=to.y;   p[5]=to.z;
        line.geometry.attributes.position.needsUpdate = true;
    }

    _buildPreview() {
        const geo = new THREE.SphereGeometry(0.8, 24, 24);
        const mat = new THREE.MeshStandardMaterial({
            color: 0x00cc66, roughness: 0.5, metalness: 0.2, transparent: true, opacity: 0.7,
        });
        this.previewSphere = new THREE.Mesh(geo, mat);
        this.previewSphere.visible = false;
        this._scene.add(this.previewSphere);
    }

    // ==================== 可视化放置 ====================
    _startPlacement() {
        // 收集表单参数
        const name    = document.getElementById('pl-edit-name').value.trim() || '新星球';
        const mass    = parseFloat(document.getElementById('pl-edit-mass').value) || 5.97e24;
        const radius  = parseFloat(document.getElementById('pl-edit-radius').value) || 6371;
        const visual  = parseFloat(document.getElementById('pl-edit-visual').value) || 0.8;
        const color   = document.getElementById('pl-edit-color').value || '#ff8844';
        const velMag  = parseFloat(document.getElementById('pl-edit-velmag').value) || 0;
        const texFile = document.getElementById('pl-edit-texture')?.files?.[0];
        const texPath = texFile ? URL.createObjectURL(texFile) : null;

        this._pendingBody = { name, mass, radius: radius * 1000, visualRadius: visual, color, texturePath: texPath, velMag };
        this._vMag = velMag;
        this._vDir.set(0, 0, 0);

        // 关闭表单
        this.modal.classList.add('hidden');

        // 进入放置模式 Step 1: XZ
        this._placeState = 'placing_xz';
        this._lockedXZ = null;
        this._lockedY = 0;
        this._guideGroup.visible = true;
        this.previewSphere.visible = true;
        this.hudEl.style.display = 'block';
        this._updateHUD('点击视图放置 XZ 位置');

        // 禁用 OrbitControls
        this.controls.enabled = false;
        this.canvasWrap.style.cursor = 'crosshair';

        // 绑定鼠标事件
        this._onPlaceMouseMove = (e) => this._handlePlaceMove(e);
        this._onPlaceClick    = (e) => this._handlePlaceClick(e);
        this.canvasWrap.addEventListener('mousemove', this._onPlaceMouseMove);
        this.canvasWrap.addEventListener('click', this._onPlaceClick);
    }

    _exitPlacement() {
        this._placeState = 'idle';
        this._guideGroup.visible = false;
        this.previewSphere.visible = false;
        this._vArrowHead.visible = false;
        this.hudEl.style.display = 'none';
        this.controls.enabled = true;
        this.canvasWrap.style.cursor = '';
        if (this._onPlaceMouseMove) {
            this.canvasWrap.removeEventListener('mousemove', this._onPlaceMouseMove);
            this.canvasWrap.removeEventListener('click', this._onPlaceClick);
            this._onPlaceMouseMove = null;
            this._onPlaceClick = null;
        }
    }

    _handlePlaceMove(event) {
        switch (this._placeState) {
            case 'placing_xz': {
                const pt = this._raycastXZ(event);
                if (!pt) return;
                this.previewSphere.position.set(pt.x, 0, pt.z);
                this._updateGuideLine(this._projLine, new THREE.Vector3(pt.x, 0, 0), new THREE.Vector3(pt.x, 0, pt.z));
                document.getElementById('pl-hud-pos').textContent = `X:${pt.x.toFixed(1)} Y:0.0 Z:${pt.z.toFixed(1)}`;
                break;
            }
            case 'placing_y': {
                const x = this._lockedXZ.x, z = this._lockedXZ.z;
                this._lockedY = this._screenYToWorldY(event);
                this.previewSphere.position.set(x, this._lockedY, z);
                this._updateGuideLine(this._projLineY, new THREE.Vector3(x, -20, z), new THREE.Vector3(x, 20, z));
                document.getElementById('pl-hud-pos').textContent = `X:${x.toFixed(1)} Y:${this._lockedY.toFixed(1)} Z:${z.toFixed(1)}`;
                break;
            }
            case 'placing_v_azimuth': {
                const pt = this._raycastXZ(event);
                if (!pt) return;
                const dir = new THREE.Vector3(pt.x, 0, pt.z).sub(this._bodyPos).normalize();
                if (dir.length() < 0.001) return;
                this._vAzimDir = dir.clone();
                const arrowEnd = this._bodyPos.clone().add(dir.clone().multiplyScalar(3));
                this._updateGuideLine(this._vArrowLine, this._bodyPos, arrowEnd);
                this._vArrowHead.position.copy(arrowEnd);
                this._vArrowHead.lookAt(arrowEnd.clone().add(dir));
                this._vArrowHead.visible = true;
                const azimDeg = (Math.atan2(dir.z, dir.x) * 180 / Math.PI).toFixed(1);
                document.getElementById('pl-hud-azim').textContent = `${azimDeg}°`;
                document.getElementById('pl-hud-elev').textContent = '0.0°';
                this._updateHUD('点击锁定速度方向 · 偏X轴角实时显示');
                break;
            }
            case 'placing_v_elevation': {
                this._updateElevationArrow(event);
                break;
            }
        }
    }

    _updateElevationArrow(event) {
        const rect = this.canvasWrap.getBoundingClientRect();
        const t = THREE.MathUtils.clamp(1 - (event.clientY - rect.top) / rect.height, 0.05, 0.95);
        const elevAngle = (t - 0.5) * Math.PI * 0.55; // ±50°
        const hDir = this._vAzimDir.clone();
        const elevDir = hDir.clone().multiplyScalar(Math.cos(elevAngle))
            .add(new THREE.Vector3(0, Math.sin(elevAngle), 0)).normalize();
        const arrowEnd = this._bodyPos.clone().add(elevDir.clone().multiplyScalar(3));
        this._updateGuideLine(this._vArrowLine, this._bodyPos, arrowEnd);
        this._vArrowHead.position.copy(arrowEnd);
        this._vArrowHead.lookAt(arrowEnd.clone().add(elevDir));
        this._vArrowHead.visible = true;

        const azimDeg = (Math.atan2(elevDir.z, elevDir.x) * 180 / Math.PI).toFixed(1);
        const elevDeg = (Math.asin(THREE.MathUtils.clamp(elevDir.y, -1, 1)) * 180 / Math.PI).toFixed(1);
        document.getElementById('pl-hud-azim').textContent = `${azimDeg}°`;
        document.getElementById('pl-hud-elev').textContent = `${elevDeg}°`;
        this._updateHUD('点击锁定仰角');
    }

    _handlePlaceClick(event) {
        switch (this._placeState) {
            case 'placing_xz': {
                const pt = this._raycastXZ(event);
                if (!pt) return;
                this._lockedXZ = { x: pt.x, z: pt.z };
                this._placeState = 'placing_y';
                this._updateHUD('上下移动鼠标选择 Y 高度，点击确认');
                break;
            }
            case 'placing_y': {
                this._lockedY = this._screenYToWorldY(event);
                // 速度大小为0 → 跳过速度方向选择
                if (this._vMag < 0.01) {
                    this._vDir.set(0, 0, 0);
                    this._finalizePlacement();
                    return;
                }
                this._placeState = 'placing_v_azimuth';
                this._bodyPos.set(this._lockedXZ.x, this._lockedY, this._lockedXZ.z);
                this._updateGuideLine(this._projLineY, new THREE.Vector3(), new THREE.Vector3());
                this._updateHUD('移动鼠标选择速度方向（XZ面），点击确认');
                break;
            }
            case 'placing_v_azimuth': {
                const pt = this._raycastXZ(event);
                if (!pt) return;
                const dir = new THREE.Vector3(pt.x, 0, pt.z).sub(this._bodyPos);
                if (dir.length() < 0.001) return;
                this._vAzimDir = dir.normalize();
                this._placeState = 'placing_v_elevation';
                this._updateElevationArrow(event);
                this._updateHUD('上下移动鼠标调整速度仰角，点击确认');
                break;
            }
            case 'placing_v_elevation': {
                const rect = this.canvasWrap.getBoundingClientRect();
                const t = THREE.MathUtils.clamp(1 - (event.clientY - rect.top) / rect.height, 0.05, 0.95);
                const elevAngle = (t - 0.5) * Math.PI * 0.55;
                const hDir = this._vAzimDir.clone();
                this._vDir = hDir.clone().multiplyScalar(Math.cos(elevAngle))
                    .add(new THREE.Vector3(0, Math.sin(elevAngle), 0)).normalize();
                this._finalizePlacement();
                break;
            }
        }
    }

    _finalizePlacement() {
        const x = this._lockedXZ.x, y = this._lockedY, z = this._lockedXZ.z;
        const pb = this._pendingBody;

        const key = 'lab_' + Date.now();
        const siX = x / POS_SCALE, siY = y / POS_SCALE, siZ = z / POS_SCALE;

        const body = new CelestialBody({
            key, name: pb.name, nameCN: pb.name,
            mass: pb.mass, radius: pb.radius,
            orbitRadius: 0,
            visualRadius: pb.visualRadius,
            color: pb.color,
            texturePath: pb.texturePath,
            details: `${pb.name} — 星球实验室创建 · 偏X轴${(Math.atan2(this._vDir.z, this._vDir.x)*180/Math.PI).toFixed(1)}°`,
            voiceIntro: '',
            scene: this._scene,
        });
        body.position.set(siX, siY, siZ);
        body.velocity.copy(this._vDir.clone().multiplyScalar(this._vMag));
        body._syncMeshPosition();

        this.physics.addBody(body);
        this._bodies.push(body);
        this._addCollisionBox(body);

        const azimDeg = (Math.atan2(this._vDir.z, this._vDir.x) * 180 / Math.PI).toFixed(1);
        const elevDeg = (Math.asin(THREE.MathUtils.clamp(this._vDir.y, -1, 1)) * 180 / Math.PI).toFixed(1);
        console.log(`[PlanetLab] 创建 "${pb.name}" 位置(${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)}) 速度${this._vMag}m/s 偏X轴${azimDeg}° 仰角${elevDeg}°`);

        this._exitPlacement();
        this._pendingBody = null;
        this._refreshList();
    }

    /** 获取鼠标 NDC 坐标 */
    _mouseNDC(event) {
        const rect = this.canvasWrap.getBoundingClientRect();
        return {
            x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
            y: -((event.clientY - rect.top) / rect.height) * 2 + 1,
        };
    }

    /** 射线与 Y=0 平面（XZ面）的交点 */
    _raycastXZ(event) {
        const { x, y } = this._mouseNDC(event);
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(x, y), this.camera);
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const intersect = new THREE.Vector3();
        return raycaster.ray.intersectPlane(plane, intersect) ? intersect : null;
    }

    /** 根据屏幕 Y 坐标计算世界 Y 高度 */
    _screenYToWorldY(event) {
        const rect = this.canvasWrap.getBoundingClientRect();
        const t = 1 - (event.clientY - rect.top) / rect.height;
        return THREE.MathUtils.clamp((t - 0.5) * 30, -20, 20);
    }

    // ==================== HUD ====================
    _updateHUD(hint) {
        document.getElementById('pl-hud-hint').textContent = hint;
    }

    _updateHUDPos(x, y, z) {
        document.getElementById('pl-hud-pos').textContent = `X:${x.toFixed(1)} Y:${y.toFixed(1)} Z:${z.toFixed(1)}`;
        document.getElementById('pl-hud-azim').textContent = '--';
        document.getElementById('pl-hud-elev').textContent = '--';
    }

    // ==================== 碰撞箱 ====================
    _addCollisionBox(body) {
        const radius = body.visualRadius * 1.1;
        const geo = new THREE.SphereGeometry(radius, 16, 12);
        const mat = new THREE.MeshBasicMaterial({ color: 0x00ff88, wireframe: true, transparent: true, opacity: 0.5 });
        const box = new THREE.Mesh(geo, mat);
        box.visible = this._showCollision;
        body.mesh?.add(box);
        this._collisionBoxes.push({ body, mesh: box });
    }

    _removeCollisionBox(body) {
        const idx = this._collisionBoxes.findIndex(c => c.body === body);
        if (idx >= 0) {
            const entry = this._collisionBoxes[idx];
            entry.mesh.geometry?.dispose();
            entry.mesh.material?.dispose();
            entry.mesh.parent?.remove(entry.mesh);
            this._collisionBoxes.splice(idx, 1);
        }
    }

    _updateCollisionVisibility() {
        this._collisionBoxes.forEach(c => { c.mesh.visible = this._showCollision; });
    }

    _syncCollisionBoxes() {}

    // ==================== 编辑/删除 ====================
    _openEdit(body) {
        this._editingBody = body;
        document.getElementById('pl-edit2-name').value = body.name || '';
        document.getElementById('pl-edit2-mass').value = body.mass;
        document.getElementById('pl-edit2-radius').value = body.realRadius / 1000;
        document.getElementById('pl-edit2-visual').value = body.visualRadius;
        document.getElementById('pl-edit2-color').value = '#' + body.color.getHexString();
        this.editModal.classList.remove('hidden');
    }

    _saveEdit() {
        const body = this._editingBody;
        if (!body) return;
        body.name = document.getElementById('pl-edit2-name').value.trim() || body.name;
        body.mass = parseFloat(document.getElementById('pl-edit2-mass').value) || body.mass;
        body.realRadius = parseFloat(document.getElementById('pl-edit2-radius').value) * 1000 || body.realRadius;
        body.visualRadius = parseFloat(document.getElementById('pl-edit2-visual').value) || body.visualRadius;
        body.color = new THREE.Color(document.getElementById('pl-edit2-color').value || '#' + body.color.getHexString());
        body._syncMeshPosition();
        if (body.mesh) body.mesh.material.color.copy(body.color);

        this._removeCollisionBox(body);
        this._addCollisionBox(body);
        this.editModal.classList.add('hidden');
        this._editingBody = null;
        this._refreshList();
    }

    _deleteBody(body) {
        if (!confirm(`确定删除 "${body.name}" 吗？`)) return;
        this.physics.removeBody(body);
        this._removeCollisionBox(body);
        body.dispose();
        this._bodies = this._bodies.filter(b => b !== body);
        if (this._selectedBody === body) this._selectedBody = null;
        this._refreshList();
    }

    _selectBody(body) {
        this._selectedBody = body;
        this._collisionBoxes.forEach(c => {
            const sel = c.body === body;
            c.mesh.material.color.set(sel ? 0xffaa00 : 0x00ff88);
            c.mesh.material.opacity = sel ? 0.9 : 0.5;
        });
        if (body?.mesh) {
            this.controls.target.copy(body.mesh.position);
            this.controls.update();
        }
    }

    // ==================== 列表 ====================
    _refreshList() {
        if (this._bodies.length === 0) {
            this.bodyListEl.innerHTML = '<div class="pl-empty">暂无星球，点击下方按钮添加</div>';
            return;
        }
        this.bodyListEl.innerHTML = this._bodies.map((b, i) => `
            <div class="pl-body-item ${this._selectedBody === b ? 'selected' : ''}" data-idx="${i}">
                <span class="pl-body-dot" style="background:#${b.color.getHexString()}"></span>
                <div class="pl-body-info">
                    <span class="pl-body-name">${b.name}</span>
                    <span class="pl-body-meta">${formatMass(b.mass)} · r=${b.visualRadius}</span>
                </div>
                <div class="pl-body-actions">
                    <button class="pl-btn-edit" data-idx="${i}" title="编辑">✎</button>
                    <button class="pl-btn-del" data-idx="${i}" title="删除">🗑</button>
                </div>
            </div>
        `).join('');

        this.bodyListEl.querySelectorAll('.pl-body-item').forEach(item => {
            item.addEventListener('click', () => {
                this._selectBody(this._bodies[parseInt(item.dataset.idx)]);
                this._refreshList();
            });
        });
        this.bodyListEl.querySelectorAll('.pl-btn-edit').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._openEdit(this._bodies[parseInt(btn.dataset.idx)]);
            });
        });
        this.bodyListEl.querySelectorAll('.pl-btn-del').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._deleteBody(this._bodies[parseInt(btn.dataset.idx)]);
            });
        });
    }

    // ==================== 动画 ====================
    _animate() {
        if (!this._isOpen) return;
        requestAnimationFrame(() => this._animate());

        this.physics.step(43200 * 0.1);
        for (const body of this.physics.bodies) {
            if (body._syncMeshPosition) body._syncMeshPosition();
            if (body.mesh && body.rotationSpeed) body.mesh.rotation.y += body.rotationSpeed * 0.016;
        }

        if (this._placeState === 'idle') this.controls.update();

        const w = this.canvasWrap.clientWidth;
        const h = this.canvasWrap.clientHeight;
        if (this.renderer.domElement.width !== w || this.renderer.domElement.height !== h) {
            this.camera.aspect = w / Math.max(h, 1);
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(w, h);
        }
        this.renderer.render(this._scene, this.camera);
    }

    // ==================== 打开/关闭 ====================
    open() {
        if (this._isOpen) return;
        this._isOpen = true;
        this.overlay.classList.remove('hidden');
        this._initScene();
        this._refreshList();
    }

    close() {
        if (this._placeState !== 'idle') this._exitPlacement();
        this._isOpen = false;
        this.overlay.classList.add('hidden');
    }

    isActive() { return this._isOpen; }
}
