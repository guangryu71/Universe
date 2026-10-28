// ============================================================
// PlanetLab.js — 星球实验室
// 全屏覆盖层，复用主场景 BodyEditor 完整流程（面板+放置+创建）
// ============================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PhysicsEngine } from '../js/physics.js';
import { formatMass, POS_SCALE, AU } from '../js/constants.js';
import { BodyEditor } from './BodyEditor.js?v=2';
import { CelestialBody } from '../js/CelestialBody.js';
import { getAllGalaxies } from '../js/galaxyRegistry.js?v=8';
import { getCurrentUser, refreshSession, escapeHtml } from '../js/session.js?v=1';
import { loadUniverseGalaxies, resolveSystemGalaxyId } from '../js/UniverseRegistry.js?v=7';
import { LabAI } from './LabAI.js?v=3';
import { InfiniteGrid } from './InfiniteGrid.js?v=1';

export class PlanetLab {
    /**
     * @param {object} [deps]
     * @param {function} [deps.onExportSystem] — 把实验室里的星体系统写入星体数据库
     */
    constructor(deps = {}) {
        this._onExportSystem = deps.onExportSystem || null;
        this._onRequireLogin = deps.onRequireLogin || (() => {});
        this._bodies = [];
        this._collisionBoxes = [];
        this._selectedBody = null;
        this._isOpen = false;
        this._rafId = 0;                // 渲染循环句柄（关闭时取消，重开时重启）
        this._showTrails = true;        // 轨迹线显隐（默认开启，与按钮高亮一致）
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
                    <div class="pl-header-left">
                        <button id="pl-add-btn" class="pl-header-btn" title="添加一颗新星球">➕ 添加星球</button>
                        <button id="pl-import-btn" class="pl-header-btn" title="从星体数据库复制一个星体系统到实验室">📥 导入星体系统</button>
                        <button id="pl-export-btn" class="pl-header-btn" title="把实验室中的星体系统导出到星体数据库">📤 导出到星体数据库</button>
                    </div>
                    <div class="pl-header-actions">
                        <button id="pl-ai-btn" class="pl-header-btn" title="用 AI 自动搭建星体系统">AI 建造</button>
                        <button id="pl-clear-trails" class="pl-header-btn" title="擦除所有轨迹线">🗑 擦除</button>
                        <button id="pl-toggle-trails" class="pl-header-btn" title="显示/隐藏轨迹线">〰 轨迹</button>
                        <button id="pl-toggle-collision" class="pl-header-btn" title="显示碰撞箱并启用刚性碰撞">📦 碰撞箱</button>
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
                        <div class="pl-empty">暂无星球，点击左上角「添加星球」</div>
                    </div>
                    <!-- 内嵌 abp 表单（添加星球时展开） -->
                    <div class="pl-abp-inline hidden" id="pl-abp-inline">
                        <div class="abp-row"><label>名称</label><input id="pl-abp-name" value="新星体" /></div>
                        <div class="abp-row"><label>质量 (kg)</label><input id="pl-abp-mass" type="number" value="1e24" step="any" /></div>
                        <div class="abp-row"><label>半径 (km)</label><input id="pl-abp-radius" type="number" value="6371" step="any" /></div>
                        <div class="abp-row"><label>颜色</label><input id="pl-abp-color" type="color" value="#ff8844" /></div>
                        <div class="abp-row"><label>位置</label><span id="pl-abp-pos" style="font-size:10px;color:#0f8;">等待放置...</span></div>
                        <div class="abp-row hidden" id="pl-abp-vel-section">
                            <label>初速度 (km/s)</label>
                            <span id="pl-abp-vel-info" style="font-size:10px;color:#fc0;">未设置</span>
                            <div style="display:flex;gap:4px;margin-top:4px;">
                                <input id="pl-abp-vel-speed" type="number" value="0" min="0" step="0.1" placeholder="km/s" style="flex:1;width:60px;">
                                <button id="pl-abp-vel-btn" class="abp-btn" style="width:60px;font-size:11px;padding:2px 4px;">🎯 方向</button>
                            </div>
                        </div>
                        <button class="abp-btn" id="pl-abp-confirm" disabled style="display:none;">🚀 确认发射入轨</button>
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

            <!-- 从星体数据库导入 -->
            <div class="pl-modal hidden" id="pl-import-modal">
                <div class="pl-modal-backdrop"></div>
                <div class="pl-modal-panel">
                    <div class="pl-modal-header">
                        <span>📥 从星体数据库导入</span>
                        <button id="pl-import-modal-close">&times;</button>
                    </div>
                    <div class="pl-modal-body">
                        <input type="search" id="pl-import-search" class="pl-import-search"
                               placeholder="🔍 搜索星体系统 / 星系名称…" autocomplete="off" />
                        <div class="pl-import-list" id="pl-import-list"></div>
                    </div>
                    <div class="pl-modal-footer">
                        <button id="pl-import-cancel" class="pl-action-btn pl-cancel">取消</button>
                    </div>
                </div>
            </div>

            <!-- 导出到星体数据库（保存为草稿） -->
            <div class="pl-modal hidden" id="pl-export-modal">
                <div class="pl-modal-backdrop"></div>
                <div class="pl-modal-panel">
                    <div class="pl-modal-header">
                        <span>📤 导出星体系统</span>
                        <button id="pl-export-modal-close">&times;</button>
                    </div>
                    <div class="pl-modal-body">
                        <p class="pl-export-hint">选择要保存到的星系。导出的系统会存入<b>草稿箱</b>，仅自己可见，可在个人中心「我的系统」中完成发布。</p>
                        <div class="pl-export-list" id="pl-export-list"></div>
                    </div>
                    <div class="pl-modal-footer">
                        <button id="pl-export-save" class="pl-action-btn pl-save" disabled>💾 保存至草稿箱</button>
                        <button id="pl-export-cancel" class="pl-action-btn pl-cancel">取消</button>
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
        this.importModal   = this.overlay.querySelector('#pl-import-modal');
        this.importListEl  = this.overlay.querySelector('#pl-import-list');
        this.importSearchEl = this.overlay.querySelector('#pl-import-search');
        this.exportModal   = this.overlay.querySelector('#pl-export-modal');
        this.exportListEl  = this.overlay.querySelector('#pl-export-list');
        this.exportSaveBtn = this.overlay.querySelector('#pl-export-save');
        this._exportGalaxyId = '';
        this.collisionBtn  = this.overlay.querySelector('#pl-toggle-collision');
        this._showCollision = true;

        // 顶栏在窄窗口下会换行变高，右侧星体面板必须始终贴在其下方
        const header = this.overlay.querySelector('.pl-header');
        this._syncHeaderHeight = () => {
            this.overlay.style.setProperty('--pl-header-h', `${header.offsetHeight}px`);
        };
        this._syncHeaderHeight();
        new ResizeObserver(this._syncHeaderHeight).observe(header);
    }

    // ==================== 事件绑定 ====================
    _bindEvents() {
        this.overlay.querySelector('#pl-close').addEventListener('click', () => this.close());
        this.overlay.querySelector('.pl-backdrop').addEventListener('click', () => this.close());

        // AI 建造（右上角，擦除按钮左侧）
        this.labAI = new LabAI(this);
        this.overlay.querySelector('#pl-ai-btn').addEventListener('click', () => this.labAI.open());

        // 添加按钮 → 展开内联表单 → 进入放置模式
        this.overlay.querySelector('#pl-add-btn').addEventListener('click', () => {
            this._resetForm();
            this.abpInline.classList.remove('hidden');
            if (this.bodyEditor) {
                this.bodyEditor.enterPlaceMode();
                // 移除 PlacementGuides 自带的有限网格与坐标轴（实验室使用无限网格）
                this.bodyEditor.placementCtrl.guides?.disableGrid();
                this.canvasWrap.style.cursor = 'crosshair';
            }
        });

        // 编辑弹窗
        this.overlay.querySelector('#pl-edit-modal-close').addEventListener('click', () => this.editModal.classList.add('hidden'));
        this.overlay.querySelector('#pl-edit-cancel').addEventListener('click', () => this.editModal.classList.add('hidden'));
        this.overlay.querySelector('#pl-edit-save').addEventListener('click', () => this._saveEdit());

        // 导入 / 导出星体系统（左上角）
        this.overlay.querySelector('#pl-import-btn').addEventListener('click', () => this._openImportModal());
        this.overlay.querySelector('#pl-export-btn').addEventListener('click', () => this._openExportModal());
        this.overlay.querySelector('#pl-import-modal-close').addEventListener('click', () => this.importModal.classList.add('hidden'));
        this.overlay.querySelector('#pl-import-cancel').addEventListener('click', () => this.importModal.classList.add('hidden'));
        this.importModal.querySelector('.pl-modal-backdrop').addEventListener('click', () => this.importModal.classList.add('hidden'));
        this.importSearchEl?.addEventListener('input', () => this._filterImportList());
        this.overlay.querySelector('#pl-export-modal-close').addEventListener('click', () => this.exportModal.classList.add('hidden'));
        this.overlay.querySelector('#pl-export-cancel').addEventListener('click', () => this.exportModal.classList.add('hidden'));
        this.exportModal.querySelector('.pl-modal-backdrop').addEventListener('click', () => this.exportModal.classList.add('hidden'));
        this.exportSaveBtn?.addEventListener('click', () => this._saveDraftToGalaxy());

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
                } else if (this.importModal && !this.importModal.classList.contains('hidden')) {
                    this.importModal.classList.add('hidden');
                } else if (this.exportModal && !this.exportModal.classList.contains('hidden')) {
                    this.exportModal.classList.add('hidden');
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
        q('#pl-abp-radius').value = '6371';
        q('#pl-abp-color').value = '#ff8844';
        q('#pl-abp-pos').textContent = '等待放置...';
        q('#pl-abp-vel-section').classList.add('hidden');
        q('#pl-abp-vel-info').textContent = '未设置';
        const btn = q('#pl-abp-confirm');
        btn.disabled = true;
        btn.textContent = '🚀 确认发射入轨';
        btn.style.display = 'none';
        // 预览球大小 = 默认半径(km) * 实验室视觉缩放
        const defaultRKm = 6371;
        const defaultVisualR = Math.max(defaultRKm * 1e-3, 0.1);
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
        // 保留一点最小距离，避免缩放退化到目标点后旋转与平移全部失灵
        this.controls.minDistance = 0.5;
        this.controls.maxDistance = 15000;
        this.controls.zoomSpeed = 1.2;
        this.controls.zoomToCursor = true;
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

        // 无限三维参考网格（取代有限的 GridHelper / 坐标轴）
        this._grid = new InfiniteGrid();
        this._scene.add(this._grid.group);

        const dotGeo = new THREE.SphereGeometry(2, 12, 12);
        const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        this._scene.add(new THREE.Mesh(dotGeo, dotMat));

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
        // 每个物理子步后做碰撞检测，避免高速下直接穿过对方
        this.physics.onSubstep = () => this._resolveCollisions();

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
                    confirmBtn.style.display = '';
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
                if (velInfo) velInfo.textContent = `方向已设定 | 大小: ${(mag / 1000).toFixed(2)} km/s`;
            },
            _switchToTab: () => {},
            _refreshBodyList: () => self._refreshList(),
        };
    }

    // ==================== 导入 / 导出星体系统 ====================

    /** 打开“导入星体系统”弹窗：支持按星体系统 / 所属星系搜索 */
    async _openImportModal() {
        this.importModal.classList.remove('hidden');
        if (this.importSearchEl) this.importSearchEl.value = '';
        this.importListEl.innerHTML = '<div class="pl-import-empty">正在读取星体数据库…</div>';

        // 星系列表用来标注每个星体系统的所属星系
        let galaxies = [];
        try {
            galaxies = await loadUniverseGalaxies();
        } catch (e) {
            galaxies = [];
        }
        // 草稿仅本人可见、也不在星体数据库中展示，因此不进入导入列表
        const systems = getAllGalaxies().filter(g => (g.status || 'approved') !== 'draft');
        if (!this.importModal || this.importModal.classList.contains('hidden')) return;

        if (systems.length === 0) {
            this.importListEl.innerHTML = '<div class="pl-import-empty">星体数据库中还没有星体系统</div>';
            return;
        }

        const galaxyById = new Map(galaxies.map(x => [x.id, x]));
        this.importListEl.innerHTML = systems.map((g, i) => {
            const infos = g.planets || [];
            const planetCount = infos.filter(p => !p.isStar).length;
            const hasStar = infos.some(p => p.isStar);
            const meta = infos.length === 0
                ? '无星体数据'
                : (hasStar ? `恒星 1 · 行星 ${planetCount}` : `星体 ${infos.length}`);
            const galaxy = galaxyById.get(resolveSystemGalaxyId(g, galaxies));
            const galaxyName = galaxy?.name || '银河系';
            const search = [
                g.name || '', g.nameCN || '', g.description || '',
                galaxyName, galaxy?.nameCN || '',
            ].join(' ').toLowerCase();
            return `<div class="pl-import-item${infos.length ? '' : ' is-disabled'}"
                         data-idx="${i}" data-search="${escapeHtml(search)}">
                <span class="pl-import-item-icon">${g.icon || '🌟'}</span>
                <div class="pl-import-item-info">
                    <span class="pl-import-item-name">${escapeHtml(g.nameCN || g.name)}</span>
                    <span class="pl-import-item-meta">${meta}</span>
                    <span class="pl-import-item-galaxy">🛰 所属星系：${escapeHtml(galaxyName)}</span>
                </div>
            </div>`;
        }).join('') + '<div class="pl-import-empty hidden" id="pl-import-empty">没有匹配的星体系统</div>';

        this.importListEl.querySelectorAll('.pl-import-item').forEach(item => {
            item.addEventListener('click', () => {
                if (item.classList.contains('is-disabled')) return;
                const galaxy = systems[parseInt(item.dataset.idx)];
                if (!galaxy?.planets?.length) {
                    alert('该系统暂时没有可导入的星体数据');
                    return;
                }
                if (this._bodies.length > 0 &&
                    !confirm(`导入会清空实验室中现有的 ${this._bodies.length} 个星体，确定继续吗？`)) {
                    return;
                }
                this.importModal.classList.add('hidden');
                this._importSystem(galaxy);
            });
        });
    }

    /** 导入弹窗的即时搜索（按星体系统名 / 星系名过滤） */
    _filterImportList() {
        const q = String(this.importSearchEl?.value || '').trim().toLowerCase();
        let visible = 0;
        this.importListEl.querySelectorAll('.pl-import-item').forEach((item) => {
            const show = !q || (item.dataset.search || '').includes(q);
            item.classList.toggle('hidden', !show);
            if (show) visible++;
        });
        this.importListEl.querySelector('#pl-import-empty')?.classList.toggle('hidden', !(q && visible === 0));
    }

    /** 把星体数据库里的一个系统复制到实验室（属性不变） */
    _importSystem(galaxy) {
        this._initScene();
        // 退出可能正在进行的放置流程，避免导入后引导球残留
        if (this.bodyEditor) this.bodyEditor.exitPlaceMode();
        if (this.abpInline) this.abpInline.classList.add('hidden');
        if (this.previewSphere) this.previewSphere.visible = false;
        this._clearLab();

        const infos = (galaxy.planets || []).filter(Boolean);
        const starInfo = infos.find(p => p.isStar) || infos[0];
        if (!starInfo) {
            alert('该系统没有可导入的星体');
            return;
        }
        const planetInfos = infos.filter(p => p !== starInfo);
        const starMass = starInfo.mass || 1e30;
        const baseKey = 'lab_import_' + Date.now();

        // --- 中心恒星：统一放在实验室原点（属性保持原样） ---
        const starBody = new CelestialBody({
            key: baseKey + '_star',
            name: starInfo.name || galaxy.name || '中心恒星',
            nameCN: starInfo.nameCN || starInfo.name || galaxy.name || '中心恒星',
            mass: starMass,
            radius: starInfo.radius || 1e9,
            orbitRadius: 0,
            visualRadius: starInfo.visualRadius || 5,
            color: starInfo.color || '#ffcc00',
            details: starInfo.details || '',
            detailTree: starInfo.detailTree || null,
            surfaceTree: starInfo.surfaceTree || null,
            voiceIntro: starInfo.voiceIntro || '',
            texturePath: this._labTexturePath(starInfo.texturePath),
            scene: this._scene,
        });
        starBody.textureName = starInfo.textureName || null;
        starBody.position.set(0, 0, 0);
        starBody.velocity.set(0, 0, 0);
        starBody._syncMeshPosition();

        // 与星体数据库中的恒星一样：自发光 + 点光源
        const starMat = starBody.mesh?.material;
        if (starMat) {
            starMat.emissive = starBody.color.clone();
            starMat.emissiveIntensity = 0.8;
            starMat.needsUpdate = true;
        }
        if (starBody.mesh) {
            starBody.mesh.add(new THREE.PointLight(starBody.color.clone(), 12.0, 0, 1.5));
        }
        this._registerImportedBody(starBody);

        // --- 行星：保留原轨道半径，重新给绕恒星的圆轨道初速度 ---
        planetInfos.forEach((p, i) => {
            const orbitR = Math.max(p.orbitRadius || 0, 1);
            const body = new CelestialBody({
                key: baseKey + '_planet_' + i,
                name: p.name || `行星 ${i + 1}`,
                nameCN: p.nameCN || p.name || `行星 ${i + 1}`,
                mass: p.mass || 1e24,
                radius: p.radius || 1e6,
                orbitRadius: orbitR,
                visualRadius: p.visualRadius || 1,
                color: p.color || '#ff8844',
                details: p.details || '',
                detailTree: p.detailTree || null,
                surfaceTree: p.surfaceTree || null,
                voiceIntro: p.voiceIntro || '',
                texturePath: this._labTexturePath(p.texturePath),
                scene: this._scene,
            });
            body.textureName = p.textureName || null;
            // 实验室不渲染卫星，但保留数据，导出时原样带回星体数据库
            body._sourceMoons = Array.isArray(p.moons) ? p.moons : [];
            body.position.set(orbitR, 0, 0);
            body.setCircularOrbitVelocity(starMass);
            body._syncMeshPosition();
            this._registerImportedBody(body);
        });

        this._refreshList();
        this._fitCameraToBodies();
        console.log(`[PlanetLab] 已从星体数据库导入: ${galaxy.name}（${infos.length} 个星体）`);
    }

    /** 导入的天体：登记到实验室 + 物理引擎 + 碰撞箱/轨迹 + BodyEditor 记录 */
    _registerImportedBody(body) {
        this._labPlanets[body.key] = body;
        this.physics.addBody(body);
        if (!this._bodies.includes(body)) this._bodies.push(body);
        this._origAddCollisionBox(body);
        if (this.bodyEditor && Array.isArray(this.bodyEditor.customBodies)) {
            this.bodyEditor.customBodies.push({
                key: body.key,
                name: body.name,
                body,
                mass: body.mass,
                radius: body.realRadius,
                visualR: body.visualRadius,
            });
        }
    }

    /**
     * 按 AI 蓝图（Blueprint.computeAssembly 的结果）搭建星体系统。
     * 所有数值均由程序计算，AI 只提供数据。
     * @param {{name:string, description:string, mode:string, bodies:Array}} assembly
     * @returns {{ok:boolean, reason?:string, count?:number}}
     */
    applyBlueprint(assembly) {
        if (!assembly || !Array.isArray(assembly.bodies) || assembly.bodies.length === 0) {
            return { ok: false, reason: 'empty' };
        }

        this._initScene();
        if (this.bodyEditor) this.bodyEditor.exitPlaceMode();
        if (this.abpInline) this.abpInline.classList.add('hidden');
        if (this.previewSphere) this.previewSphere.visible = false;
        this.canvasWrap.style.cursor = '';

        if (Object.keys(this._labPlanets).length > 0) {
            const ok = window.confirm('实验室中已有天体，AI 建造会清空它们。是否继续？');
            if (!ok) return { ok: false, reason: 'cancelled' };
        }

        this._clearLab();

        // 多星系统轨道紧凑，默认关闭弹珠式碰撞，避免刚建好就被碰撞箱撞散
        this._showCollision = false;
        this.collisionBtn?.classList.remove('active');
        this._updateCollisionVisibility();

        const baseKey = 'lab_ai_' + Date.now();
        assembly.bodies.forEach((spec, index) => {
            const distance = Math.hypot(spec.position.x, spec.position.z);
            const body = new CelestialBody({
                key: `${baseKey}_${index}`,
                name: spec.name,
                nameCN: spec.name,
                mass: spec.mass,
                radius: spec.radius,
                orbitRadius: distance,
                visualRadius: spec.visualRadius,
                color: spec.color,
                details: `AI 建造 · ${assembly.name}${assembly.description ? ' · ' + assembly.description : ''}`,
                scene: this._scene,
            });

            body.position.set(spec.position.x, spec.position.y, spec.position.z);
            body.velocity.set(spec.velocity.x, spec.velocity.y, spec.velocity.z);
            body._syncMeshPosition();

            // 恒星自发光 + 点光源，与「从星体数据库导入」保持一致
            if (spec.isStar && body.mesh) {
                const mat = body.mesh.material;
                if (mat) {
                    mat.emissive = body.color.clone();
                    mat.emissiveIntensity = 0.8;
                    mat.needsUpdate = true;
                }
                body.mesh.add(new THREE.PointLight(body.color.clone(), 12.0, 0, 1.5));
            }

            this._registerImportedBody(body);
        });

        this._refreshList();
        this._fitCameraToBodies();
        this._autoTimeScale(assembly);
        console.log(`[PlanetLab] AI 建造完成: ${assembly.name}（${assembly.mode} / ${assembly.bodies.length} 个天体）`);
        return { ok: true, count: assembly.bodies.length };
    }

    /**
     * 根据系统尺度自动设置时间流速，让中等距离的轨道大约 20 秒转一圈。
     * 避免 AI 建好的系统在默认流速下几乎静止。
     */
    _autoTimeScale(assembly) {
        const distances = assembly.bodies
            .map(b => Math.hypot(b.position.x, b.position.z))
            .filter(r => r > 1e7)
            .sort((a, b) => a - b);
        if (distances.length === 0) return;

        const radius = distances[Math.floor(distances.length / 2)];
        const totalMass = assembly.bodies.reduce((sum, b) => sum + b.mass, 0);
        const period = 2 * Math.PI * Math.sqrt((radius * radius * radius) / (6.6743e-11 * totalMass));
        if (!Number.isFinite(period) || period <= 0) return;

        // 每帧模拟 43200 * 0.1 * timeScale 秒；目标约 1200 帧（60fps 下 20 秒）
        const timeScale = period / (43200 * 0.1 * 1200);
        const sliderVal = Math.round(50 + 25 * Math.log10(timeScale));
        const slider = this.overlay.querySelector('.pl-time-slider');
        if (!slider) return;
        slider.value = String(Math.min(100, Math.max(1, sliderVal)));
        slider.dispatchEvent(new Event('input'));
    }

    /** 清空实验室中的所有天体（导入前调用） */
    _clearLab() {
        for (const body of Object.values(this._labPlanets)) {
            this.physics.removeBody(body);
            this._removeCollisionBox(body);
            this._removeTrail(body);
            // 黑洞的视觉组是单独挂在场景里的，需要一并移除
            if (body._bhVisuals) {
                body._bhVisuals.traverse(o => {
                    if (o.isMesh) {
                        o.geometry?.dispose();
                        o.material?.dispose();
                    }
                });
                this._scene.remove(body._bhVisuals);
                body._bhVisuals = null;
            }
            body.dispose();
        }
        for (const key of Object.keys(this._labPlanets)) delete this._labPlanets[key];
        if (this.bodyEditor && Array.isArray(this.bodyEditor.customBodies)) {
            this.bodyEditor.customBodies.length = 0;
        }
        this._bodies = [];
        this._collisionBoxes = [];
        this._trailLines = [];
        this._selectedBody = null;
        this._refreshList();
    }

    /** 导入后把镜头拉到能看全整个系统的位置 */
    _fitCameraToBodies() {
        let extent = 0;
        for (const body of this._bodies) {
            if (!body.mesh) continue;
            extent = Math.max(extent, body.mesh.position.length() + body.visualRadius * 20);
        }
        if (extent <= 0) return;

        const dist = Math.max(extent * 2.2, 120);
        this.controls.maxDistance = Math.max(dist * 4, 15000);
        this.camera.far = Math.max(dist * 8, 50000);
        this.camera.near = Math.max(0.1, extent / 1e5);
        const dir = new THREE.Vector3(0.55, 0.45, 0.75).normalize();
        this.controls.target.set(0, 0, 0);
        this.camera.position.copy(dir.multiplyScalar(dist));
        this.camera.updateProjectionMatrix();
        this.controls.update();
    }

    // ==================== 导出到星体数据库（草稿箱） ====================

    /** 打开导出弹窗：列出自己加入的星系，选择后保存为草稿 */
    async _openExportModal() {
        const bodies = this._bodies.filter(b => b.mesh);
        if (bodies.length === 0) {
            alert('实验室中还没有星体，无法导出。');
            return;
        }
        if (!this._onExportSystem) {
            alert('当前未连接星体数据库，无法导出。');
            return;
        }

        const user = getCurrentUser();
        if (!user) {
            this._onRequireLogin();
            return;
        }

        this._exportGalaxyId = '';
        this.exportSaveBtn.disabled = true;
        this.exportModal.classList.remove('hidden');
        this.exportListEl.innerHTML = '<div class="pl-import-empty">正在读取你加入的星系…</div>';

        // 刚加入 / 被任命为指挥官时，本地缓存的成员信息可能还是旧的
        try { await refreshSession(true); } catch { /* 离线时沿用本地缓存 */ }
        const current = getCurrentUser() || user;
        const memberships = current.memberships || [];
        // 指挥官可能不在 memberships 里（例如直接被任命），一并列出
        const commanded = current.commandedGalaxies || [];
        const merged = new Map();
        for (const g of memberships) merged.set(g.id, g);
        for (const g of commanded) merged.set(g.id, { ...(merged.get(g.id) || {}), ...g });
        const list = [...merged.values()];

        if (!this.exportModal || this.exportModal.classList.contains('hidden')) return;

        if (list.length === 0) {
            this.exportListEl.innerHTML = `
                <div class="pl-import-empty">你还没有加入任何星系。<br />
                    请先到宇宙视图加入一个星系，再回来导出。</div>`;
            return;
        }

        this.exportListEl.innerHTML = list.map((g) => `
            <div class="pl-export-item" data-id="${escapeHtml(g.id)}">
                <span class="pl-export-item-icon">🛰</span>
                <div class="pl-export-item-info">
                    <span class="pl-export-item-name">${escapeHtml(g.name || g.id)}</span>
                    ${g.nameCN ? `<span class="pl-export-item-meta">${escapeHtml(g.nameCN)}</span>` : ''}
                </div>
                <span class="pl-export-item-check">✓</span>
            </div>
        `).join('');

        this.exportListEl.querySelectorAll('.pl-export-item').forEach((item) => {
            item.addEventListener('click', () => this._selectExportGalaxy(item));
        });

        // 默认选中第一个星系，减少一次点击
        const first = this.exportListEl.querySelector('.pl-export-item');
        if (first) this._selectExportGalaxy(first);
    }

    /** 选中导出目标星系（单选） */
    _selectExportGalaxy(item) {
        this.exportListEl.querySelectorAll('.pl-export-item')
            .forEach(el => el.classList.toggle('is-selected', el === item));
        this._exportGalaxyId = item.dataset.id;
        this.exportSaveBtn.disabled = false;
    }

    /** 把实验室里的星体系统保存到所选星系的草稿箱 */
    async _saveDraftToGalaxy() {
        if (!this._exportGalaxyId) {
            alert('请先选择一个星系');
            return;
        }
        const payload = this._buildExportPayload(this._generateSystemName());
        if (!payload) return;

        this.exportSaveBtn.disabled = true;
        let result;
        try {
            result = await this._onExportSystem({
                ...payload,
                galaxyId: this._exportGalaxyId,
                draft: true,
            });
        } catch (err) {
            console.error('[PlanetLab] 导出失败:', err);
            alert(`⚠️ 保存失败：${err?.message || '未知错误'}`);
            this.exportSaveBtn.disabled = false;
            return;
        }
        this.exportSaveBtn.disabled = false;

        if (result?.ok) {
            this.exportModal.classList.add('hidden');
            alert(`✅ 「${payload.name}」已保存到草稿箱。\n可在个人中心 →「我的系统」中完成发布。`);
        } else {
            alert(`⚠️ 保存失败：${result?.error || '未知错误'}`);
        }
    }

    /** 把实验室星体转成星体数据库记录（质量最大的天体作为中心恒星） */
    _buildExportPayload(name) {
        const bodies = this._bodies.filter(b => b.mesh);
        if (bodies.length === 0) {
            alert('实验室中还没有星体，无法导出。');
            return null;
        }

        const starBody = bodies.reduce((a, b) => (b.mass > a.mass ? b : a));
        const starPos = starBody.position.clone();
        const planetBodies = bodies
            .filter(b => b !== starBody)
            .sort((a, b) => a.position.distanceTo(starPos) - b.position.distanceTo(starPos));

        const textureOf = (b) => {
            const p = b.texturePath;
            return p && String(p).startsWith('data:') ? String(p) : null;
        };

        const starPayload = {
            name: starBody.name || '中心恒星',
            mass: starBody.mass,
            radius: starBody.realRadius,
            color: '#' + starBody.color.getHexString(),
            visualRadius: starBody.visualRadius,
            appearance: textureOf(starBody) ? 'texture' : 'color',
            x: starPos.x / AU,
            y: starPos.y / AU,
            z: starPos.z / AU,
            textureData: textureOf(starBody),
            textureName: starBody.textureName || null,
            details: starBody.details || '',
            detailTree: starBody.detailTree || null,
            surfaceTree: starBody.surfaceTree || null,
            voiceIntro: starBody.voiceIntro || '',
        };

        const planetPayloads = planetBodies.map(b => ({
            name: b.name || '行星',
            mass: b.mass,
            radius: b.realRadius,
            orbitRadius: Math.max(
                1,
                Math.hypot(b.position.x - starPos.x, b.position.z - starPos.z)
            ),
            visualRadius: b.visualRadius,
            color: '#' + b.color.getHexString(),
            appearance: textureOf(b) ? 'texture' : 'color',
            textureData: textureOf(b),
            textureName: b.textureName || null,
            details: b.details || '',
            detailTree: b.detailTree || null,
            surfaceTree: b.surfaceTree || null,
            voiceIntro: b.voiceIntro || '',
            moons: b._sourceMoons || [],
        }));

        return {
            name,
            description: `由星球实验室导出的星体系统，共 ${bodies.length} 个星体。`,
            star: starPayload,
            planets: planetPayloads,
        };
    }

    /** 自动生成不重复的系统名称（带导出的日期时间） */
    _generateSystemName() {
        const existing = new Set();
        for (const g of getAllGalaxies()) {
            if (g.name) existing.add(String(g.name).trim().toLowerCase());
            if (g.nameCN) existing.add(String(g.nameCN).trim().toLowerCase());
        }
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
        const base = `实验室星体系统 ${stamp}`;
        let name = base;
        let i = 2;
        while (existing.has(name.toLowerCase())) name = `${base} (${i++})`;
        return name;
    }

    /** 仅接受 data URL 贴图；相对路径与空值一律忽略 */
    _labTexturePath(path) {
        if (!path) return null;
        const s = String(path);
        return s.startsWith('data:') ? s : null;
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
            const radiusKm = parseFloat(panel.querySelector('#pl-abp-radius').value) || 6371;
            const radius = radiusKm * 1000; // km → m
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
            const rKm = parseFloat(e.target.value) || 6371;
            const visualR = Math.max(rKm * 1e-3, 0.1);
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
            const speed = (parseFloat(panel.querySelector('#pl-abp-vel-speed').value) || 0) * 1000; // km/s → m/s
            this.bodyEditor.setVelocityMagnitude(speed);
            this.bodyEditor.startVelocityPick(speed);
        });
        panel.querySelector('#pl-abp-vel-speed').addEventListener('input', (e) => {
            this.bodyEditor.setVelocityMagnitude((parseFloat(e.target.value) || 0) * 1000);
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

    /**
     * 刚性球碰撞：把天体视为半径与碰撞箱一致的实心球，
     * 相互接近时按质量加权施加完全弹性冲量（类似弹珠相撞）。
     * 仅在“碰撞箱”开启时生效。
     */
    _resolveCollisions() {
        if (!this._showCollision) return;
        const bodies = this.physics.bodies;
        for (let i = 0; i < bodies.length; i++) {
            for (let j = i + 1; j < bodies.length; j++) {
                this._resolveCollisionPair(bodies[i], bodies[j]);
            }
        }
    }

    _resolveCollisionPair(a, b) {
        const BOX_FACTOR = 1.1;   // 与 _addCollisionBox 的半径系数一致
        const RESTITUTION = 1.0;  // 1 = 完全弹性（弹珠式）

        // 碰撞半径：视觉半径(场景单位) → 米
        const rA = Math.max((a.visualRadius || 0) * BOX_FACTOR / POS_SCALE, 0);
        const rB = Math.max((b.visualRadius || 0) * BOX_FACTOR / POS_SCALE, 0);
        if (rA <= 0 || rB <= 0) return;

        let dx = b.position.x - a.position.x;
        let dy = b.position.y - a.position.y;
        let dz = b.position.z - a.position.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        const rSum = rA + rB;
        if (distSq >= rSum * rSum) return;

        const invA = a.mass > 0 ? 1 / a.mass : 0;
        const invB = b.mass > 0 ? 1 / b.mass : 0;
        const invSum = invA + invB;
        if (invSum <= 0) return;

        let dist = Math.sqrt(distSq);
        let nx = 1, ny = 0, nz = 0;
        if (dist > 1e-9) {
            nx = dx / dist; ny = dy / dist; nz = dz / dist;
        } else {
            dist = 0; // 球心完全重合，任选一个方向推开
        }

        // 1) 位置修正：按质量反比把重叠的两球推开，防止持续穿模
        const overlap = rSum - dist;
        const corr = overlap / invSum;
        a.position.x -= nx * corr * invA;
        a.position.y -= ny * corr * invA;
        a.position.z -= nz * corr * invA;
        b.position.x += nx * corr * invB;
        b.position.y += ny * corr * invB;
        b.position.z += nz * corr * invB;

        // 2) 速度冲量：只处理相互接近的情况
        const vn = (b.velocity.x - a.velocity.x) * nx
                 + (b.velocity.y - a.velocity.y) * ny
                 + (b.velocity.z - a.velocity.z) * nz;
        if (vn >= 0) return;

        const impulse = -(1 + RESTITUTION) * vn / invSum;
        a.velocity.x -= nx * impulse * invA;
        a.velocity.y -= ny * impulse * invA;
        a.velocity.z -= nz * impulse * invA;
        b.velocity.x += nx * impulse * invB;
        b.velocity.y += ny * impulse * invB;
        b.velocity.z += nz * impulse * invB;
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
            this.bodyListEl.innerHTML = '<div class="pl-empty">暂无星球，点击左上角「添加星球」</div>';
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
        this._rafId = requestAnimationFrame(() => this._animate());

        this.physics.step(43200 * 0.1 * this._timeScale);
        for (const body of this.physics.bodies) {
            if (body._syncMeshPosition) body._syncMeshPosition();
            if (body.mesh && body.rotationSpeed) body.mesh.rotation.y += body.rotationSpeed * 0.016;
        }

        // 更新轨迹线
        this._updateTrails(43200 * 0.1 * this._timeScale);

        // OrbitControls 在放置模式下禁用（BodyEditor 的 PlacementController 内部控制）
        if (this.controls) this.controls.update();

        // 无限网格跟随相机，保持向远处延伸
        if (this._grid) this._grid.update(this.camera, this.controls?.target);

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
        this._syncHeaderHeight?.();
        this._initScene();
        // 首次进入由 _initScene 建好场景；再次进入时场景已存在，需要手动恢复渲染循环
        if (!this._rafId) this._animate();
        this._wireABPButtons();
        this._refreshList();
    }

    close() {
        if (this.bodyEditor) this.bodyEditor.exitPlaceMode();
        if (this.abpInline) this.abpInline.classList.add('hidden');
        this.editModal.classList.add('hidden');
        this.labAI?.hide();
        this._isOpen = false;
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = 0;
        }
        this.overlay.classList.add('hidden');
    }

    isActive() { return this._isOpen; }
}
