// ============================================================
// PlanetLab.js — 星球实验室
// 全屏覆盖层，复用主场景 BodyEditor 完整流程（面板+放置+创建）
// ============================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PhysicsEngine } from '../js/physics.js';
import { formatMass } from '../js/constants.js';
import { BodyEditor } from './BodyEditor.js';

export class PlanetLab {
    constructor() {
        this._bodies = [];
        this._collisionBoxes = [];
        this._selectedBody = null;
        this._isOpen = false;
        this._showTrails = false;       // 轨迹线显隐
        this._trailLines = [];          // { body, line, points[] }

        this._buildDOM();
        this._bindEvents();
    }

    // ==================== DOM（含与主场景一致的 abp 面板）====================
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
                        <button id="pl-clear-trails" class="pl-header-btn" title="擦除所有轨迹线">🗑 擦除</button>
                        <button id="pl-toggle-trails" class="pl-header-btn" title="显示/隐藏轨迹线">〰 轨迹</button>
                        <button id="pl-toggle-collision" class="pl-header-btn" title="切换碰撞箱">📦 碰撞箱</button>
                        <button id="pl-close" class="pl-close-btn">&times;</button>
                    </div>
                </div>
                <div class="pl-canvas-wrap" id="pl-canvas-wrap">
                    <!-- 视角平面切换 -->
                    <div class="pl-vp-btns">
                        <button class="vp-btn" data-plane="xy">XY</button>
                        <button class="vp-btn" data-plane="xz">XZ</button>
                        <button class="vp-btn" data-plane="yz">YZ</button>
                    </div>
                    <!-- 时间流速控制 -->
                    <div class="pl-time-control">
                        <span class="time-label">慢速</span>
                        <input type="range" class="pl-time-slider" min="1" max="100" value="30" step="1" />
                        <span class="time-label">快速</span>
                        <span class="pl-time-display">1:1.00x</span>
                    </div>
                </div>
                <div class="pl-sidebar" id="pl-sidebar">
                    <div class="pl-sidebar-title" id="pl-sidebar-title" style="cursor:pointer;">🪐 星球管理 ▾</div>
                    <div class="pl-body-list" id="pl-body-list">
                        <div class="pl-empty">暂无星球，点击下方按钮添加</div>
                    </div>
                    <button id="pl-add-btn" class="pl-action-btn pl-add" style="width:100%;margin-top:8px;">➕ 添加星球</button>
                    <!-- 内嵌 abp 表单（添加星球时展开） -->
                    <div class="pl-abp-inline hidden" id="pl-abp-inline">
                        <div class="abp-row"><label>名称</label><input id="pl-abp-name" value="新星体" /></div>
                        <div class="abp-row"><label>质量 (kg)</label><input id="pl-abp-mass" type="number" value="1e24" step="any" /></div>
                        <div class="abp-row"><label>半径 (m)</label><input id="pl-abp-radius" type="number" value="6371000" step="any" /></div>
                        <div class="abp-row"><label>颜色</label><input id="pl-abp-color" type="color" value="#ff8844" /></div>
                        <div class="abp-row"><label>位置</label><span id="pl-abp-pos" style="font-size:10px;color:#0f8;">等待放置...</span></div>
                        <div class="abp-row hidden" id="pl-abp-vel-section">
                            <label>初速度</label>
                            <span id="pl-abp-vel-info" style="font-size:10px;color:#fc0;">未设置</span>
                            <div style="display:flex;gap:4px;margin-top:4px;">
                                <input id="pl-abp-vel-speed" type="number" value="0" min="0" step="100" placeholder="m/s" style="flex:1;width:60px;">
                                <button id="pl-abp-vel-btn" class="abp-btn" style="width:60px;font-size:11px;padding:2px 4px;">🎯 方向</button>
                            </div>
                        </div>
                        <button class="abp-btn" id="pl-abp-confirm" disabled>📍 先点击场景放置位置</button>
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
        this.bodyListEl    = this.overlay.querySelector('#pl-body-list');
        this.canvasWrap    = this.overlay.querySelector('#pl-canvas-wrap');
        this.abpInline     = this.overlay.querySelector('#pl-abp-inline');
        this.editModal     = this.overlay.querySelector('#pl-edit-modal');
        this.collisionBtn  = this.overlay.querySelector('#pl-toggle-collision');
        this._showCollision = true;
    }

    // ==================== 事件绑定 ====================
    _bindEvents() {
        this.overlay.querySelector('#pl-close').addEventListener('click', () => this.close());
        this.overlay.querySelector('.pl-backdrop').addEventListener('click', () => this.close());

        // 添加按钮 → 展开内联表单 → 进入放置模式
        this.overlay.querySelector('#pl-add-btn').addEventListener('click', () => {
            this._resetForm();
            this.abpInline.classList.remove('hidden');
            if (this.bodyEditor) {
                this.bodyEditor.enterPlaceMode();
                // 隐藏 PlacementGuides 自带的网格和坐标轴（实验室已有大网格）
                const g = this.bodyEditor.placementCtrl.guides;
                if (g) {
                    if (g._gridHelper) g._gridHelper.visible = false;
                    if (g._axesHelper) g._axesHelper.visible = false;
                }
                this.canvasWrap.style.cursor = 'crosshair';
            }
        });

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

        // 轨迹线切换
        this.trailsBtn = this.overlay.querySelector('#pl-toggle-trails');
        this.trailsBtn?.addEventListener('click', () => {
            this._showTrails = !this._showTrails;
            this.trailsBtn.classList.toggle('active', this._showTrails);
            this._updateTrailsVisibility();
        });
        this.trailsBtn.classList.add('active'); // 默认开启

        // 擦除轨迹线
        this.overlay.querySelector('#pl-clear-trails')?.addEventListener('click', () => {
            this._clearTrails();
        });

        // 侧边栏标题点击 → 展开/折叠星体列表
        this.sideTitle = this.overlay.querySelector('#pl-sidebar-title');
        this.bodyListWrap = this.overlay.querySelector('#pl-body-list');
        this.sideTitle?.addEventListener('click', () => {
            const isHidden = this.bodyListWrap.style.display === 'none';
            this.bodyListWrap.style.display = isHidden ? '' : 'none';
            this.sideTitle.textContent = isHidden ? '🪐 星球管理 ▾' : '🪐 星球管理 ▸';
        });

        // ESC
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this._isOpen) {
                if (this.abpInline && !this.abpInline.classList.contains('hidden')) {
                    this.abpInline.classList.add('hidden');
                    if (this.bodyEditor) this.bodyEditor.exitPlaceMode();
                } else if (!this.editModal.classList.contains('hidden')) {
                    this.editModal.classList.add('hidden');
                } else {
                    this.close();
                }
            }
        });
    }

    /** 重置表单（显示内联面板） */
    _resetForm() {
        const q = (sel) => this.overlay.querySelector(sel);
        q('#pl-abp-name').value = '新星体';
        q('#pl-abp-mass').value = '1e24';
        q('#pl-abp-radius').value = '6371000';
        q('#pl-abp-color').value = '#ff8844';
        q('#pl-abp-pos').textContent = '等待放置...';
        q('#pl-abp-vel-section').classList.add('hidden');
        q('#pl-abp-vel-info').textContent = '未设置';
        const btn = q('#pl-abp-confirm');
        btn.disabled = true;
        btn.textContent = '📍 先点击场景放置位置';
        // 预览球大小 = 默认半径 * 实验室视觉缩放
        const LAB_VIS_SCALE = 1e-6;
        const defaultR = 6371000;
        const defaultVisualR = Math.max(defaultR * LAB_VIS_SCALE, 0.1);
        this._previewSize = defaultVisualR * 20; // SYSTEM_SCALE
        if (this.previewSphere) this.previewSphere.scale.setScalar(this._previewSize);
        // 同步 ghostStar（如果放置引导已激活）
        if (this.bodyEditor?.placementCtrl?.guides) {
            this.bodyEditor.placementCtrl.guides.setPreviewScale(defaultVisualR / 0.6);
        }
    }

    // ==================== 场景 ====================
    _initScene() {
        if (this._scene) return;

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setClearColor(0x050812); // 深空色，避免透出主场景
        this.canvasWrap.appendChild(this.renderer.domElement);

        this._scene = new THREE.Scene();
        this._timeScale = 1.0;   // 时间流速倍率

        this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 50000);
        this.camera.position.set(150, 180, 270);
        this.camera.lookAt(0, 0, 0);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        this.controls.minDistance = 1;
        this.controls.maxDistance = 15000;
        this.controls.target.set(0, 0, 0);
        this.controls.mouseButtons = {
            LEFT: THREE.MOUSE.PAN,
            MIDDLE: THREE.MOUSE.ROTATE,
        };
        this.controls.update();

        this._scene.add(new THREE.AmbientLight(0x334466, 2.5));
        const pt = new THREE.PointLight(0xfff8e8, 8.0, 0, 0.8);
        pt.position.set(0, 5, 0);
        this._scene.add(pt);

        const grid = new THREE.GridHelper(10000, 200, 0x334455, 0x222233);
        this._scene.add(grid);

        const dotGeo = new THREE.SphereGeometry(2, 12, 12);
        const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        this._scene.add(new THREE.Mesh(dotGeo, dotMat));

        this._addAxisLine(new THREE.Vector3(0,0,0), new THREE.Vector3(80,0,0), 0xff4444);
        this._addAxisLine(new THREE.Vector3(0,0,0), new THREE.Vector3(0,80,0), 0x44ff44);
        this._addAxisLine(new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,80), 0x4488ff);

        // 预览球（显示放置位置，大小由半径 * 实验室视觉缩放 决定）
        const LAB_VIS_SCALE = 1e-6;
this._previewSize = Math.max(6371000 * LAB_VIS_SCALE, 0.1); // 默认 6371km
        const pGeo = new THREE.SphereGeometry(1, 24, 24);
        const pMat = new THREE.MeshStandardMaterial({
            color: 0x00cc66, roughness: 0.5, metalness: 0.2, transparent: true, opacity: 0.7,
        });
        this.previewSphere = new THREE.Mesh(pGeo, pMat);
        this.previewSphere.scale.setScalar(this._previewSize);
        this.previewSphere.visible = false;
        this._scene.add(this.previewSphere);

        // 物理引擎
        this.physics = new PhysicsEngine([]);

        // 实验室私有的 planets dict（供 BodyEditor 存放天体）
        this._labPlanets = {};

        // 创建 BodyEditor（使用实验室的场景/相机/画布/物理引擎）
        // 注意：BodyEditor 内部会创建 PlacementController + PlacementGuides + PlacementHUD
        this.bodyEditor = new BodyEditor(
            this._scene,           // scene — 实验室场景，引导线会画在这里
            this.camera,           // camera — 实验室相机
            this.renderer.domElement, // canvas — 实验室画布
            this._labPlanets,      // planets — 实验室专用的天体字典
            this.physics,          // physics — 实验室物理引擎
            this._buildAppStub()   // app — 回调桩
        );

        // 在 BodyEditor 生成星体后加碰撞箱
        this._origConfirmCreate = this.bodyEditor.confirmCreate.bind(this.bodyEditor);
        this.bodyEditor.confirmCreate = (opts) => {
            this._origConfirmCreate(opts);
            // 为新创建的星体添加碰撞箱
            const keys = Object.keys(this._labPlanets);
            const latestKey = keys[keys.length - 1];
            const body = this._labPlanets[latestKey];
            if (body && !this._collisionBoxes.some(c => c.body === body)) {
                this._bodies.push(body);
                this._origAddCollisionBox(body);
                this._refreshList();
            }
        };

        // 视角平面 + 时间控制
        this._setupViewPlaneButtons();
        this._setupTimeControl();
        this._animate();
    }

    _addAxisLine(from, to, color) {
        const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
        const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.5 }));
        this._scene.add(line);
    }

    // ==================== 视角平面切换 ====================
    _setupViewPlaneButtons() {
        const normals = {
            xy: new THREE.Vector3(0, 0, 1),
            xz: new THREE.Vector3(0, 1, 0),
            yz: new THREE.Vector3(1, 0, 0),
        };
        let active = null, inverted = false;

        this.overlay.querySelectorAll('.pl-vp-btns .vp-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const plane = btn.dataset.plane;
                const n = normals[plane];
                if (!n) return;

                if (active !== plane) {
                    active = plane;
                    inverted = false;
                    this.overlay.querySelectorAll('.pl-vp-btns .vp-btn').forEach(b => b.classList.remove('active'));
                } else {
                    inverted = !inverted;
                }
                const dir = inverted ? n.clone().negate() : n.clone();
                const dist = Math.max(this.camera.position.length(), 35);
                this.camera.position.copy(dir.clone().multiplyScalar(dist));
                this.camera.lookAt(0, 0, 0);
                this.controls.target.set(0, 0, 0);
                this.controls.update();
                btn.classList.toggle('active', inverted);
            });
        });
    }

    // ==================== 时间流速控制 ====================
    _setupTimeControl() {
        const slider = this.overlay.querySelector('.pl-time-slider');
        const display = this.overlay.querySelector('.pl-time-display');
        if (!slider || !display) return;

        const update = () => {
            const val = parseInt(slider.value);
            this._timeScale = Math.pow(10, (val - 50) / 25);
            const pct = ((val - 1) / 99) * 100;
            slider.style.setProperty('--slider-pct', pct + '%');
            const ts = this._timeScale;
            display.textContent = Math.abs(ts - 1.0) < 0.005 ? '1:1' : '1:' + ts.toFixed(2) + 'x';
        };
        slider.addEventListener('input', update);
        update();
    }

    /** 创建 app 回调桩，使 BodyEditor 与实验室面板联动 */
    _buildAppStub() {
        const self = this;
        const panel = this.overlay;
        return {
            _hudContainer: panel.querySelector('#pl-abp-inline'),
            _onPositionUpdate: (x, y, z) => {
                if (self.previewSphere) self.previewSphere.position.set(x, y, z);
            },
            _onPlacementDone: (x, y, z, au) => {
                const posEl = panel.querySelector('#pl-abp-pos');
                if (posEl) posEl.textContent = `(${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}) ≈ ${au.toFixed(2)} AU`;
                const confirmBtn = panel.querySelector('#pl-abp-confirm');
                if (confirmBtn) {
                    confirmBtn.disabled = false;
                    confirmBtn.textContent = '🚀 确认发射入轨';
                }
                const velSection = panel.querySelector('#pl-abp-vel-section');
                if (velSection) velSection.classList.remove('hidden');
                const velInfo = panel.querySelector('#pl-abp-vel-info');
                if (velInfo) velInfo.textContent = '未设置（默认计算轨道速度）';
            },
            _onVelocityDone: () => {
                const vel = self.bodyEditor.getVelocity();
                const mag = vel.length();
                const velInfo = panel.querySelector('#pl-abp-vel-info');
                if (velInfo) velInfo.textContent = `方向已设定 | 大小: ${mag.toFixed(1)} m/s`;
            },
            _switchToTab: () => {},
            _refreshBodyList: () => self._refreshList(),
        };
    }

    // ==================== 面板按钮（与主场景一致的交互） ====================
    _wireABPButtons() {
        if (this._abpWired) return;
        this._abpWired = true;

        const panel = this.overlay;

        // 确认创建
        panel.querySelector('#pl-abp-confirm').addEventListener('click', () => {
            const name   = panel.querySelector('#pl-abp-name').value || '新星体';
            const mass   = parseFloat(panel.querySelector('#pl-abp-mass').value) || 1e24;
            const radius = parseFloat(panel.querySelector('#pl-abp-radius').value) || 6371000;
            const color  = panel.querySelector('#pl-abp-color').value || '#ff8844';
            const LAB_VIS_SCALE = 1e-6; // 10^6 米 → 1 场景单位
            const visualR = Math.max(radius * LAB_VIS_SCALE, 0.1); // 最小 0.1 保证可见

            // 从 PlacementController 获取放置位置
            const pos = this.bodyEditor.placementCtrl.getPlacedPos();
            if (!pos) return;
            const { x, y, z } = pos;

            this.bodyEditor.confirmCreate({ name, mass, radius, color, visualR, x, y, z });

            // 清理引导元素
            if (this.bodyEditor.placementCtrl.guides) {
                this.bodyEditor.placementCtrl.guides.hide();
                this.bodyEditor.placementCtrl.guides.clearAll();
            }

            this._resetForm();
            this.abpInline.classList.add('hidden');
        });

        // 半径输入 → 同步幽灵预览球大小
        panel.querySelector('#pl-abp-radius').addEventListener('input', (e) => {
            const r = parseFloat(e.target.value) || 6371000;
            const LAB_VIS_SCALE = 1e-6;
            const visualR = Math.max(r * LAB_VIS_SCALE, 0.1);
            // 更新 ghostStar（PlacementGuides 的 wireframe 预览球）
            if (this.bodyEditor?.placementCtrl?.guides) {
                this.bodyEditor.placementCtrl.guides.setPreviewScale(visualR / 0.6);
            }
            // 更新 previewSphere（实验室自己的绿色预览球）
            if (this.previewSphere) {
                this._previewSize = visualR * 20; // SYSTEM_SCALE
                this.previewSphere.scale.setScalar(this._previewSize);
            }
        });
        // 初速度方向
        panel.querySelector('#pl-abp-vel-btn').addEventListener('click', () => {
            const speed = parseFloat(panel.querySelector('#pl-abp-vel-speed').value) || 0;
            this.bodyEditor.setVelocityMagnitude(speed);
            this.bodyEditor.startVelocityPick();
        });
        panel.querySelector('#pl-abp-vel-speed').addEventListener('input', (e) => {
            this.bodyEditor.setVelocityMagnitude(parseFloat(e.target.value) || 0);
        });

        // 放置模式进入（点击"确认发射入轨"按钮在未放置时禁用，点击场景放置区域自动进入）
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

    // ==================== 轨迹线 ====================
    _addTrail(body) {
        const pts = [body.mesh.position.clone()];
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const mat = new THREE.LineBasicMaterial({
            color: 0x00ccff, transparent: true, opacity: 0.5,
        });
        const line = new THREE.Line(geo, mat);
        line.visible = this._showTrails;
        this._scene.add(line);
        this._trailLines.push({ body, line, points: pts });
    }

    _removeTrail(body) {
        const idx = this._trailLines.findIndex(t => t.body === body);
        if (idx >= 0) {
            const entry = this._trailLines[idx];
            entry.line.geometry?.dispose();
            entry.line.material?.dispose();
            this._scene.remove(entry.line);
            this._trailLines.splice(idx, 1);
        }
    }

    _updateTrails(dt) {
        // 仅在轨迹可见时记录（擦除后关闭轨迹则不记录，下次开启才继续）
        if (!this._showTrails) return;
        for (const t of this._trailLines) {
            if (!t.body.mesh) continue;
            const pos = t.body.mesh.position.clone();
            const last = t.points[t.points.length - 1];
            if (last && pos.distanceTo(last) < 0.1) continue;
            t.points.push(pos);
            t.line.geometry.dispose();
            t.line.geometry = new THREE.BufferGeometry().setFromPoints(t.points);
        }
    }

    _updateTrailsVisibility() {
        this._trailLines.forEach(t => { t.line.visible = this._showTrails; });
        if (this._showTrails) {
            for (const t of this._trailLines) {
                if (t.body.mesh) {
                    t.points.push(t.body.mesh.position.clone());
                }
            }
        }
    }

    _clearTrails() {
        // 擦除所有轨迹线（保留轨迹数据结构，清除点列和几何体）
        for (const t of this._trailLines) {
            t.points.length = 0;
            t.line.geometry.dispose();
            t.line.geometry = new THREE.BufferGeometry().setFromPoints([]);
            // 如果轨迹可见，以当前位置为起点继续绘制
            if (this._showTrails && t.body.mesh) {
                t.points.push(t.body.mesh.position.clone());
            }
        }
    }

    // 在 _addCollisionBox 中同时添加轨迹
    _origAddCollisionBox(body) {
        this._addCollisionBox(body);
        this._addTrail(body);
    }

    // ==================== 编辑/删除 ====================
    _openEdit(body) {
        this._editingBody = body;
        this.overlay.querySelector('#pl-edit2-name').value = body.name || '';
        this.overlay.querySelector('#pl-edit2-mass').value = body.mass;
        this.overlay.querySelector('#pl-edit2-radius').value = body.realRadius / 1000;
        this.overlay.querySelector('#pl-edit2-visual').value = body.visualRadius;
        this.overlay.querySelector('#pl-edit2-color').value = '#' + body.color.getHexString();
        this.editModal.classList.remove('hidden');
    }

    _saveEdit() {
        const body = this._editingBody;
        if (!body) return;
        body.name = this.overlay.querySelector('#pl-edit2-name').value.trim() || body.name;
        body.mass = parseFloat(this.overlay.querySelector('#pl-edit2-mass').value) || body.mass;
        body.realRadius = parseFloat(this.overlay.querySelector('#pl-edit2-radius').value) * 1000 || body.realRadius;
        body.visualRadius = parseFloat(this.overlay.querySelector('#pl-edit2-visual').value) || body.visualRadius;
        body.color = new THREE.Color(this.overlay.querySelector('#pl-edit2-color').value || '#' + body.color.getHexString());
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
        this._removeTrail(body);
        body.dispose();
        this._bodies = this._bodies.filter(b => b !== body);
        delete this._labPlanets[body.key];
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
        // 展开列表（有新星体时自动展开）
        if (this.bodyListWrap && this._bodies.length > 0) {
            this.bodyListWrap.style.display = '';
            if (this.sideTitle) this.sideTitle.textContent = '🪐 星球管理 ▾';
        }
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

        this.physics.step(43200 * 0.1 * this._timeScale);
        for (const body of this.physics.bodies) {
            if (body._syncMeshPosition) body._syncMeshPosition();
            if (body.mesh && body.rotationSpeed) body.mesh.rotation.y += body.rotationSpeed * 0.016;
        }

        // 更新轨迹线
        this._updateTrails(43200 * 0.1 * this._timeScale);

        // OrbitControls 在放置模式下禁用（BodyEditor 的 PlacementController 内部控制）
        if (this.controls) this.controls.update();

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
        this._wireABPButtons();
        this._refreshList();
    }

    close() {
        if (this.bodyEditor) this.bodyEditor.exitPlaceMode();
        if (this.abpInline) this.abpInline.classList.add('hidden');
        this.editModal.classList.add('hidden');
        this._isOpen = false;
        this.overlay.classList.add('hidden');
    }

    isActive() { return this._isOpen; }
}
