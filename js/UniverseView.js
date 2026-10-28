// ============================================================
// UniverseView.js — 宇宙视图（全屏覆盖层）
//
// 单一场景：宇宙级星系图标与已展开星系的星体系统共存。
//   · 点击星系图标 → 图标闪烁消失，星体系列动态展开
//   · 悬停图标/恒星 → 静态发光关联线（首帧保留发射动效）
//       主动关联（本星体 → 其它星体）= 青蓝色
//       被动关联（其它星体 → 本星体）= 橙色
//   · 单击节点 → 关联线固定保持，点击空白处取消
//   · 左上角星系名可点击 → 全部收起
//   · 关联的最小单位是“星体”，上层星系关联自动推导
//
// 数据来源：
//   星系      → UniverseRegistry（Galaxy/universe.db + localStorage）
//   星体系统  → galaxyRegistry.getAllGalaxies()
//   星体关联  → Galaxy/universe.db（SQLite）+ localStorage
// ============================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { DetailTreeEditor } from './DetailTreeEditor.js?v=3';
import {
    DEFAULT_GALAXY_ID,
    DEFAULT_GALAXY_ICON,
    makeGalaxyId,
    loadUniverseGalaxies,
    saveUniverseGalaxy,
    deleteUniverseGalaxy,
    getAllUniverseSystems,
    getSystemsInGalaxy,
    getSystemRelatedIds,
    resolveSystemGalaxyId,
    loadBodyRelations,
    buildGalaxyLinks,
} from './UniverseRegistry.js?v=7';
import {
    getCurrentUser, refreshSession, isDeveloper, isAdmin,
    getMembershipIds, isCommanderOf, canEditGalaxy, apiPost,
} from './session.js?v=1';

const ICON_SIZE = 58;
const GALAXY_RADIUS = 250;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const LINK_SEGMENTS = 24;

// 关联线配色：主动 = 青蓝，被动 = 橙
const LINK_ACTIVE_COLOR = 0x59c8ff;
const LINK_ACTIVE_SYSTEM_COLOR = 0x7fe7ff;
const LINK_PASSIVE_COLOR = 0xffa23f;

const delay = (ms) => new Promise(r => setTimeout(r, ms));
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const easeOutCubic = (t) => 1 - Math.pow(1 - clamp01(t), 3);
const easeInOutCubic = (t) => {
    t = clamp01(t);
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};

function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

function escapeAttr(str) {
    return escapeHtml(str).replace(/`/g, '&#96;');
}

function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

export class UniverseView {
    /**
     * @param {object} deps
     * @param {function} deps.onEnterSystem    — (systemId) => void，进入星体系统
     * @param {function} [deps.onAddSystem]    — (galaxyId) => void，打开星体编译器
     * @param {function} [deps.onManageGalaxy] — (galaxyId) => void，编辑星系信息 / 成员
     * @param {function} [deps.onRequireLogin] — 访客点击需要登录的操作时打开登录
     * @param {function} [deps.onClose]        — 关闭宇宙视图
     *
     * 星体关联的编辑入口只在星体编译器（添加 / 编辑星体系统）内，宇宙视图不再提供。
     */
    constructor(deps = {}) {
        this.onEnterSystem = deps.onEnterSystem || (() => {});
        this.onAddSystem = deps.onAddSystem || (() => {});
        this.onManageGalaxy = deps.onManageGalaxy || (() => {});
        this.onRequireLogin = deps.onRequireLogin || (() => {});
        this.onClose = deps.onClose || (() => {});
        this._viewer = getCurrentUser();

        this._open = false;
        this._galaxies = [];
        this._systems = [];
        this._bodyRelations = [];
        this._activeGalaxy = null;

        this._rootGroup = null;
        this._galaxyNodes = new Map();      // gid → { galaxy, position, icon, halo, labelEl, ... }
        this._expandedGroups = new Map();   // gid → { group, nodes: Map(sysId → node), ... }
        this._systemNodes = new Map();      // sysId → node（仅已展开星系）
        this._collapsing = [];
        this._expandedManual = new Set();
        this._expandedAuto = new Set();
        this._autoCollapseTimer = 0;

        this._linkGroup = null;
        this._linkRecords = [];
        this._pickables = [];

        this._hovered = null;
        this._pinned = null;   // 单击固定的关联线来源 { kind, id }
        this._pointer = new THREE.Vector2(-10, -10);
        this._pointerInside = false;

        this._previewKind = null;
        this._previewId = null;
        this._previewNodes = null;

        this._iconTextures = new Map();
        this._starTextures = new Map();
        this._fallbackIcon = null;
        this._haloTexture = null;

        this._raf = 0;
        this._sceneToken = 0;
        this._transitioning = false;
        this._entering = false;
        this._anim = null;
        this._clock = new THREE.Clock();

        this._addGalaxyIcon = null;
        this._addGalaxyDetailTree = [];
        this._detailEditor = null;

        // 星系编辑
        this._editingGalaxy = null;
        this._editingIconSvg = null;

        // 选中星体系统的环形选择标识
        this._selRingTex = null;
        this._selRingGlowTex = null;
        this._selRing = null;
        this._selRingGlow = null;
        this._selRingTarget = null;
        this._selRingStart = 0;

        // 当前显示的关联线对应节点（避免同一节点反复重建、重播动画）
        this._linkKey = null;

        this._buildDOM();
        this._bindEvents();
    }

    // ==================== DOM ====================

    _buildDOM() {
        this.overlay = document.createElement('div');
        this.overlay.id = 'universe-view-overlay';
        this.overlay.className = 'universe-view-overlay hidden';
        this.overlay.innerHTML = `
            <div class="uv-canvas" id="uv-canvas"></div>

            <div class="uv-topbar">
                <div class="uv-crumbs" id="uv-crumbs">
                    <span class="uv-crumb-current">宇宙</span>
                </div>
                <div class="uv-actions">
                    <div class="uv-galaxy-menu-wrap">
                        <button class="uv-action-btn" id="uv-galaxy-menu-btn" title="星系添加 / 编辑">✦ 星系编辑</button>
                        <div class="uv-galaxy-menu hidden" id="uv-galaxy-menu">
                            <button class="uv-menu-item" id="uv-galaxy-add-btn">＋ 添加星系</button>
                            <button class="uv-menu-item" id="uv-galaxy-edit-btn">✎ 编辑星系</button>
                        </div>
                    </div>
                    <button class="uv-action-btn hidden" id="uv-add-system-btn" title="添加星体系统">＋ 添加星体系统</button>
                    <button class="uv-action-btn uv-close-btn" id="uv-close-btn" title="关闭">✕</button>
                </div>
            </div>

            <div class="uv-preview hidden" id="uv-preview"></div>

            <div class="uv-transition" id="uv-transition">
                <div class="uv-transition-ring"></div>
            </div>

            <div class="uv-toast" id="uv-toast"></div>

            <div class="uv-add-modal hidden" id="uv-add-modal">
                <div class="uv-add-backdrop" id="uv-add-backdrop"></div>
                <div class="uv-add-panel">
                    <div class="uv-add-header">
                        <span id="uv-add-title">🛰 添加星系</span>
                        <button class="uv-add-close" id="uv-add-close">✕</button>
                    </div>
                    <div class="uv-add-body">
                        <div class="uv-add-row">
                            <label>名称</label>
                            <input id="uv-g-name" value="新星系" placeholder="如：仙女座星系" />
                        </div>
                        <div class="uv-add-row">
                            <label>英文名</label>
                            <input id="uv-g-name-cn" value="New Galaxy" placeholder="用于生成唯一 id，如 Andromeda" />
                        </div>
                        <div class="uv-add-row">
                            <label>简介</label>
                            <textarea id="uv-g-desc" rows="2" placeholder="一句话介绍这个星系..."></textarea>
                        </div>
                        <div class="uv-add-row">
                            <label>图标 (.svg)</label>
                            <div class="uv-icon-field">
                                <input id="uv-g-icon" type="file" accept=".svg,image/svg+xml" />
                                <img id="uv-g-icon-preview" class="uv-icon-preview hidden" alt="星系图标预览" />
                            </div>
                        </div>
                        <div class="uv-add-row">
                            <label>详情介绍</label>
                            <div class="uv-detail-field">
                                <button type="button" id="uv-g-detail-btn">📁 编辑详情介绍</button>
                                <span id="uv-g-detail-count" class="uv-detail-count">未配置</span>
                            </div>
                        </div>
                    </div>
                    <div class="uv-add-footer">
                        <button class="uv-save-btn" id="uv-g-save">保存星系</button>
                    </div>
                </div>
            </div>

            <div class="uv-add-modal hidden" id="uv-gedit-modal">
                <div class="uv-add-backdrop" id="uv-gedit-backdrop"></div>
                <div class="uv-add-panel uv-gedit-panel">
                    <div class="uv-add-header">
                        <span>✎ 编辑星系</span>
                        <button class="uv-add-close" id="uv-gedit-close">✕</button>
                    </div>
                    <div class="uv-gedit-body">
                        <p class="uv-gedit-hint">点击星系进入编辑；右侧 ✕ 可删除。默认星系不可删除。</p>
                        <div class="uv-gedit-list" id="uv-gedit-list"></div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(this.overlay);

        this.canvasHost = this.overlay.querySelector('#uv-canvas');
        this.previewEl = this.overlay.querySelector('#uv-preview');
        this.transitionEl = this.overlay.querySelector('#uv-transition');
        this.toastEl = this.overlay.querySelector('#uv-toast');
        this.addModal = this.overlay.querySelector('#uv-add-modal');
        this.geditModal = this.overlay.querySelector('#uv-gedit-modal');
        this.geditListEl = this.overlay.querySelector('#uv-gedit-list');
        this.crumbsEl = this.overlay.querySelector('#uv-crumbs');
        this.galaxyMenuBtn = this.overlay.querySelector('#uv-galaxy-menu-btn');
        this.galaxyMenuEl = this.overlay.querySelector('#uv-galaxy-menu');
        this.addSystemBtn = this.overlay.querySelector('#uv-add-system-btn');
    }

    _bindEvents() {
        this.overlay.querySelector('#uv-close-btn')?.addEventListener('click', () => this.close());
        this.addSystemBtn?.addEventListener('click', () => this._openAddSystem());

        // 星系编辑菜单：添加 / 编辑
        this.galaxyMenuBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this._toggleGalaxyMenu();
        });
        this.overlay.querySelector('#uv-galaxy-add-btn')?.addEventListener('click', () => {
            this._closeGalaxyMenu();
            this._openAddGalaxy();
        });
        this.overlay.querySelector('#uv-galaxy-edit-btn')?.addEventListener('click', () => {
            this._closeGalaxyMenu();
            this._openGalaxyManager();
        });
        this.overlay.addEventListener('pointerdown', (e) => {
            if (!e.target.closest('.uv-galaxy-menu-wrap')) this._closeGalaxyMenu();
        });

        // 添加 / 编辑星系弹窗
        this.overlay.querySelector('#uv-add-close')?.addEventListener('click', () => this._closeAddGalaxy());
        this.overlay.querySelector('#uv-add-backdrop')?.addEventListener('click', () => this._closeAddGalaxy());
        this.overlay.querySelector('#uv-g-save')?.addEventListener('click', () => this._saveGalaxyFromForm());
        this.overlay.querySelector('#uv-g-icon')?.addEventListener('change', (e) => this._previewIconFile(e.target));
        this.overlay.querySelector('#uv-g-detail-btn')?.addEventListener('click', () => this._openAddGalaxyDetailEditor());

        // 星系列表 / 编辑
        this.overlay.querySelector('#uv-gedit-close')?.addEventListener('click', () => this._closeGalaxyManager());
        this.overlay.querySelector('#uv-gedit-backdrop')?.addEventListener('click', () => this._closeGalaxyManager());

        // ESC：优先关闭弹窗/预览，再全部收起，最后关闭视图
        document.addEventListener('keydown', (e) => {
            if (!this._open || e.key !== 'Escape') return;
            // 星体关联编辑器是更上层的弹窗，交给它自己处理
            const bre = document.getElementById('body-relation-editor');
            if (bre && !bre.classList.contains('hidden')) return;
            e.stopPropagation();
            const dte = document.getElementById('detail-tree-editor');
            if (dte?.classList.contains('show')) {
                this._detailEditor?.close();
            } else if (!this.addModal.classList.contains('hidden')) {
                this._closeAddGalaxy();
            } else if (!this.geditModal.classList.contains('hidden')) {
                this._closeGalaxyManager();
            } else if (!this.galaxyMenuEl.classList.contains('hidden')) {
                this._closeGalaxyMenu();
            } else if (!this.previewEl.classList.contains('hidden')) {
                this._hidePreview();
            } else if (this._expandedGroups.size || this._expandedManual.size) {
                this._collapseAll();
            } else {
                this.close();
            }
        }, true);

        window.addEventListener('resize', () => {
            if (this._open) this._resize();
        });
    }

    // ==================== 打开 / 关闭 ====================

    /**
     * @param {object} [options]
     * @param {string} [options.galaxyId] — 打开后直接展开指定星系
     */
    async open(options = {}) {
        if (this._open) return;
        this._open = true;
        this.overlay.classList.remove('hidden');
        this._transitionElReset();
        this._transitioning = false;
        this._entering = false;
        this._hidePreview();
        this._closeAddGalaxy();
        this._closeGalaxyManager();
        this._closeGalaxyMenu();
        this._pointerInside = false;
        this._pinned = null;

        // 复用同一个 renderer/scene：重复初始化会叠出第二个 canvas。
        if (!this.renderer) this._initThree();
        this._resize();
        this._setCameraForUniverse();

        await this._refreshData();
        if (!this._open) return;

        await this._buildScene();
        if (!this._open) return;

        if (options.galaxyId) {
            const galaxy = this._galaxies.find(g => g.id === options.galaxyId);
            if (galaxy) this._expandGalaxy(galaxy.id, { manual: true });
        }
        this._updateTopbar();
        this._startLoop();
    }

    close(options = {}) {
        if (!this._open) return;
        this._open = false;
        this._stopLoop();
        this._transitioning = false;
        this._entering = false;
        this._finishAnim();
        this._clearAutoCollapse();
        this._hidePreview();
        this._closeAddGalaxy();
        this._closeGalaxyManager();
        this._closeGalaxyMenu();
        this._detailEditor?.close();
        this._clearLinks();
        this._clearScene();
        this._pointerInside = false;
        this._pinned = null;
        this.overlay.classList.add('hidden');
        if (!options.silent) this.onClose();
    }

    isOpen() {
        return this._open;
    }

    /** 登录状态变化后刷新权限相关的界面 */
    setViewer(user = getCurrentUser()) {
        this._viewer = user || null;
        if (!this._open) return;
        this._updateTopbar();
        if (this._previewKind === 'galaxy' && this._previewId) {
            this._selectGalaxy(this._previewId);
        } else if (this._previewKind === 'system' && this._previewId) {
            this._selectSystem(this._previewId);
        }
    }

    /** 外部数据变化（审核、删除、加入星系等）后重新加载场景 */
    async refresh() {
        if (!this._open) return;
        await refreshSession(true);
        this._viewer = getCurrentUser();
        this._galaxies = await loadUniverseGalaxies();
        this._systems = getAllUniverseSystems().filter(s => (s.status || 'approved') !== 'draft');
        this._bodyRelations = await loadBodyRelations();
        await this._rebuildSceneKeepingExpanded();
        this._updateTopbar();
    }

    // ==================== Three.js 初始化 ====================

    _initThree() {
        if (this.renderer) return;
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.canvasHost.appendChild(this.renderer.domElement);

        this.labelRenderer = new CSS2DRenderer();
        this.labelRenderer.domElement.style.position = 'absolute';
        this.labelRenderer.domElement.style.top = '0';
        this.labelRenderer.domElement.style.left = '0';
        this.labelRenderer.domElement.style.pointerEvents = 'none';
        this.canvasHost.appendChild(this.labelRenderer.domElement);

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(50, 1, 0.5, 6000);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        this.controls.enablePan = true;
        this.controls.screenSpacePanning = true;
        this.controls.panSpeed = 0.9;
        this.controls.rotateSpeed = 0.6;
        this.controls.zoomSpeed = 0.8;
        // 与主场景一致的操作习惯：中键平移镜头（左键仍为旋转）
        this.controls.mouseButtons = {
            LEFT: THREE.MOUSE.ROTATE,
            MIDDLE: THREE.MOUSE.PAN,
            RIGHT: THREE.MOUSE.PAN,
        };
        this.controls.target.set(0, 0, 0);

        this.scene.add(new THREE.AmbientLight(0x8899bb, 1.4));
        const keyLight = new THREE.PointLight(0xbfe4ff, 2.4, 0, 0);
        keyLight.position.set(180, 240, 260);
        this.scene.add(keyLight);
        const rimLight = new THREE.PointLight(0x4466ff, 1.1, 0, 0);
        rimLight.position.set(-260, -120, -220);
        this.scene.add(rimLight);

        this._haloTexture = this._makeHaloTexture();
        this._fallbackIcon = this._makeFallbackIconTexture();
        this._selRingTex = this._makeSelectionRingTexture(false);
        this._selRingGlowTex = this._makeSelectionRingTexture(true);
        this._addStarfield();

        this.raycaster = new THREE.Raycaster();

        this.renderer.domElement.addEventListener('pointermove', (e) => this._onPointerMove(e));
        this.renderer.domElement.addEventListener('pointerleave', () => {
            this._pointerInside = false;
            this._setHovered(null);
        });
        this.renderer.domElement.addEventListener('pointerdown', (e) => {
            this._downX = e.clientX;
            this._downY = e.clientY;
        });
        this.renderer.domElement.addEventListener('pointerup', (e) => {
            if (e.button !== 0) return;
            const moved = Math.hypot(e.clientX - (this._downX ?? e.clientX), e.clientY - (this._downY ?? e.clientY));
            if (moved > 6) return;
            this._onCanvasClick(e);
        });
    }

    _resize() {
        if (!this.renderer) return;
        const w = this.overlay.clientWidth || window.innerWidth;
        const h = this.overlay.clientHeight || window.innerHeight;
        this.renderer.setSize(w, h);
        this.labelRenderer.setSize(w, h);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
    }

    _addStarfield() {
        const count = 1400;
        const positions = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
            const r = 900 + Math.random() * 1500;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
            positions[i * 3 + 1] = r * Math.cos(phi);
            positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const mat = new THREE.PointsMaterial({
            color: 0x9fd8ff,
            size: 2.2,
            transparent: true,
            opacity: 0.75,
            sizeAttenuation: true,
            depthWrite: false,
        });
        this.starfield = new THREE.Points(geo, mat);
        this.scene.add(this.starfield);
    }

    // ==================== 数据 ====================

    async _refreshData() {
        const [galaxies, bodyRelations] = await Promise.all([
            loadUniverseGalaxies(),
            loadBodyRelations(),
        ]);
        this._galaxies = galaxies;
        this._systems = getAllUniverseSystems().filter(s => (s.status || 'approved') !== 'draft');
        this._bodyRelations = bodyRelations;
        this._viewer = getCurrentUser();
    }

    /** 关联编辑器关闭后刷新数据，并重建当前悬停/固定的连线 */
    async refreshBodyRelations() {
        this._bodyRelations = await loadBodyRelations();
        if (!this._open) return;
        if (this._hovered) {
            this._showHoverLinks(
                this._hovered.userData.kind,
                this._hovered.userData.id,
                { animate: false },
            );
        } else if (this._hasPinnedNode()) {
            this._showPinnedLinks();
        }
    }

    // ==================== 场景构建 ====================

    async _buildScene() {
        const token = ++this._sceneToken;
        this._destroyGroup(this._rootGroup);
        this._rootGroup = new THREE.Group();
        this.scene.add(this._rootGroup);

        this._galaxyNodes.clear();
        this._expandedGroups.clear();
        this._expandedManual.clear();
        this._expandedAuto.clear();
        this._systemNodes.clear();
        this._collapsing = [];
        this._pickables = [];
        this._hovered = null;
        this._activeGalaxy = null;
        this._pinned = null;
        this._selRing = null;
        this._selRingGlow = null;
        this._selRingTarget = null;
        this._clearLinks();
        this._clearAutoCollapse();

        const galaxies = this._galaxies;
        const positions = this._layoutUniverse(galaxies);
        const textures = await Promise.all(galaxies.map(g => this._loadIconTexture(g.iconSvg || DEFAULT_GALAXY_ICON)));
        if (!this._open || token !== this._sceneToken) return;

        galaxies.forEach((galaxy, i) => {
            const pos = positions[i];
            const group = new THREE.Group();
            group.position.copy(pos);
            this._rootGroup.add(group);

            const icon = new THREE.Sprite(new THREE.SpriteMaterial({
                map: textures[i] || this._fallbackIcon,
                transparent: true,
                depthWrite: false,
            }));
            icon.scale.setScalar(ICON_SIZE);
            icon.renderOrder = 2;
            icon.userData = { kind: 'galaxy', id: galaxy.id, baseScale: ICON_SIZE, hidden: false };
            group.add(icon);

            const halo = new THREE.Sprite(new THREE.SpriteMaterial({
                map: this._haloTexture,
                color: 0x7fd4ff,
                transparent: true,
                opacity: 0.3,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            }));
            halo.scale.setScalar(ICON_SIZE * 1.9);
            halo.renderOrder = 1;
            group.add(halo);

            const label = this._makeLabel(galaxy.name, new THREE.Vector3(0, -ICON_SIZE * 0.62, 0));
            group.add(label);

            this._galaxyNodes.set(galaxy.id, {
                galaxy,
                position: pos.clone(),
                group,
                icon,
                halo,
                labelEl: label.element,
                hidden: false,
                flashStart: 0,
                appearStart: 0,
                flashScale: 1,
            });
            this._pickables.push(icon);
        });

        this._updateTopbar();
    }

    _layoutUniverse(galaxies) {
        const n = galaxies.length;
        if (n === 0) return [];
        if (n === 1) return [new THREE.Vector3(0, 0, 0)];
        // 斐波那契球面分布 + 压扁 Y：两三个星系时左右并排，不会被顶栏/底部提示挡住
        return galaxies.map((g, i) => {
            const py = 1 - (i / (n - 1)) * 2;
            const ring = Math.sqrt(Math.max(0, 1 - py * py));
            const theta = i * GOLDEN_ANGLE;
            return new THREE.Vector3(
                py * GALAXY_RADIUS,
                Math.sin(theta) * ring * GALAXY_RADIUS * 0.5,
                Math.cos(theta) * ring * GALAXY_RADIUS
            );
        });
    }

    /** 星系内部：紧凑的金角螺旋盘 */
    _layoutSystems(systems) {
        const n = systems.length;
        if (n === 0) return [];
        if (n === 1) return [new THREE.Vector3(0, 0, 0)];

        // 展开后的系统占据足够大的空间，避免恒星与标签互相重叠
        const maxR = Math.max(70, 40 * Math.sqrt(n));
        return systems.map((system, i) => {
            const r = maxR * Math.sqrt((i + 0.4) / n);
            const theta = i * GOLDEN_ANGLE;
            const yJitter = ((hashString(system.id) % 1000) / 1000 - 0.5) * 28;
            return new THREE.Vector3(
                Math.cos(theta) * r,
                yJitter,
                Math.sin(theta) * r
            );
        });
    }

    _systemRadius(star) {
        const mass = Number(star?.mass) || 1.989e30;
        const scaled = 4.4 + Math.log10(Math.max(1, mass / 1e29)) * 0.8;
        return Math.max(4.2, Math.min(7.5, scaled));
    }

    // ==================== 展开 / 收起 ====================

    _isExpanded(gid) {
        return this._expandedGroups.has(gid);
    }

    /**
     * 展开星系：图标闪烁消失 → 恒星逐一弹入。
     * @param {string} gid
     * @param {{manual?:boolean}} [options]
     */
    _expandGalaxy(gid, options = {}) {
        if (!this._open || this._isExpanded(gid)) return;
        const node = this._galaxyNodes.get(gid);
        const galaxy = this._galaxies.find(g => g.id === gid);
        if (!node || !galaxy) return;

        const manual = !!options.manual;
        this._expandedManual[manual ? 'add' : 'delete'](gid);
        this._expandedAuto[manual ? 'delete' : 'add'](gid);
        this._clearAutoCollapse();

        // 图标闪烁并消失
        const now = performance.now();
        node.flashStart = now;
        node.hidden = true;
        node.icon.userData.hidden = true;
        node.labelEl.style.opacity = '0';

        const systems = getSystemsInGalaxy(this._systems, this._galaxies, gid);
        const positions = this._layoutSystems(systems);
        const group = new THREE.Group();
        group.position.copy(node.position);
        this._rootGroup.add(group);

        const rec = { gid, galaxy, group, nodes: new Map(), created: now };
        this._expandedGroups.set(gid, rec);
        this._activeGalaxy = galaxy;

        systems.forEach((system, i) => {
            const star = system.planets?.find(p => p.isStar) || {};
            const local = positions[i];
            const world = node.position.clone().add(local);
            const color = new THREE.Color(star.color || '#ffcc00');
            const radius = this._systemRadius(star);

            const mat = new THREE.MeshStandardMaterial({
                color: 0xffffff,
                emissive: color,
                emissiveIntensity: 0.85,
                roughness: 0.55,
                metalness: 0.05,
            });
            const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 32), mat);
            mesh.position.copy(local);
            mesh.scale.setScalar(0.15);
            mesh.userData = {
                kind: 'system',
                id: system.id,
                galaxyId: gid,
            };
            group.add(mesh);
            this._pickables.push(mesh);

            const halo = new THREE.Sprite(new THREE.SpriteMaterial({
                map: this._haloTexture,
                color,
                transparent: true,
                opacity: 0,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            }));
            halo.position.copy(local);
            halo.scale.setScalar(radius * 3.6);
            halo.renderOrder = 1;
            group.add(halo);

            const label = this._makeLabel(system.name, new THREE.Vector3(local.x, local.y - radius - 8, local.z), 'uv-label uv-label-system');
            label.element.style.opacity = '0';
            group.add(label);

            const sysNode = {
                system,
                mesh,
                halo,
                labelEl: label.element,
                local: local.clone(),
                world,
                galaxyId: gid,
                radius,
                born: now + i * 45,
                spin: 0.05 + (hashString(system.id) % 100) / 4000,
            };
            rec.nodes.set(system.id, sysNode);
            this._systemNodes.set(system.id, sysNode);

            // 恒星贴图异步补上（不阻塞展开）
            const texPath = star.texturePath || null;
            if (texPath) {
                this._loadStarTexture(texPath).then((tex) => {
                    if (!tex || !mesh.parent) return;
                    mesh.material.map = tex;
                    mesh.material.color.set(0xffffff);
                    mesh.material.emissiveIntensity = 0.25;
                    mesh.material.needsUpdate = true;
                });
            }
        });

        this._updateTopbar();
    }

    _collapseGalaxy(gid) {
        const rec = this._expandedGroups.get(gid);
        if (!rec) return;

        // 被固定的节点随星系一起消失时，取消固定
        if (this._pinned) {
            const { kind, id } = this._pinned;
            if (kind === 'galaxy' && id === gid) this._pinned = null;
            if (kind === 'system' && this._systemNodes.get(id)?.galaxyId === gid) this._pinned = null;
        }

        this._expandedGroups.delete(gid);
        this._expandedManual.delete(gid);
        this._expandedAuto.delete(gid);

        for (const [sysId, node] of rec.nodes) {
            this._systemNodes.delete(sysId);
            const idx = this._pickables.indexOf(node.mesh);
            if (idx >= 0) this._pickables.splice(idx, 1);
        }

        rec.collapseStart = performance.now();
        this._collapsing.push(rec);

        // 恢复星系图标
        const gn = this._galaxyNodes.get(gid);
        if (gn) {
            gn.hidden = false;
            gn.icon.userData.hidden = false;
            gn.icon.visible = true;
            gn.halo.visible = true;
            gn.labelEl.style.display = '';
            gn.labelEl.style.opacity = '';
            gn.appearStart = performance.now();
        }

        if (this._previewKind === 'galaxy' && this._previewId === gid) this._hidePreview();
        if (this._previewKind === 'system' && rec.nodes.has(this._previewId)) this._hidePreview();

        this._clearLinks();
        // 收起是通过 DOM 按钮触发的，画布此刻并没有新的 pointermove；
        // 暂停 hover 检测，避免鼠标旧坐标立刻又把关联线画回来。
        this._pointerInside = false;
        if (this._activeGalaxy?.id === gid) {
            const next = Array.from(this._expandedGroups.keys()).pop();
            this._activeGalaxy = next ? this._galaxies.find(g => g.id === next) || null : null;
        }
        // 自动收起的目标星系不应把“单击固定”的关联线一起清掉
        if (this._hasPinnedNode()) this._showPinnedLinks();
        this._updateTopbar();
    }

    _collapseAll() {
        this._pinned = null;
        this._setHovered(null);
        for (const gid of Array.from(this._expandedGroups.keys())) this._collapseGalaxy(gid);
        this._expandedManual.clear();
        this._expandedAuto.clear();
        this._activeGalaxy = null;
        this._hidePreview();
        this._clearLinks();
        this._clearAutoCollapse();
        this._pointerInside = false;
        this._toast('已收起全部星系');
        this._updateTopbar();
    }

    _scheduleAutoCollapse() {
        this._clearAutoCollapse();
        this._autoCollapseTimer = window.setTimeout(() => {
            this._autoCollapseTimer = 0;
            const hoveredGid = this._hovered?.userData?.galaxyId;
            for (const gid of Array.from(this._expandedAuto)) {
                if (gid === hoveredGid) continue;
                this._collapseGalaxy(gid);
            }
        }, 700);
    }

    _clearAutoCollapse() {
        if (this._autoCollapseTimer) {
            clearTimeout(this._autoCollapseTimer);
            this._autoCollapseTimer = 0;
        }
    }

    // ==================== 关联线（悬停触发 · 单击固定 · 静态发光） ====================

    _showHoverLinks(kind, id, options = {}) {
        const key = `${kind}:${id}`;
        const animate = options.animate !== false;
        // 同一个节点已经显示了连线 → 不再重建（也就不会重播生长/发射动画）
        if (this._linkKey === key && this._linkRecords.length) {
            // 若此刻要求静态显示（例如单击固定），立即结束还在播放的生长动画
            if (!animate) this._finalizeLinks();
            return;
        }
        this._clearLinks();
        this._linkKey = key;
        if (kind === 'galaxy') this._buildGalaxyHoverLinks(id, animate);
        else this._buildSystemHoverLinks(id, animate);
    }

    /** 单击固定：关联线在鼠标移开后仍然保留 */
    _pinLinks(kind, id) {
        this._pinned = { kind, id };
        // 固定后，为显示连线而自动展开的星系不再自动收起
        for (const gid of this._expandedAuto) this._expandedManual.add(gid);
        this._expandedAuto.clear();
        this._clearAutoCollapse();
        // 单击即把连线变为静态：正在播放的生长/发射动画当场结束
        this._showPinnedLinks();
    }

    /** 把当前连线全部切换到静态（满长度、无飞行动效） */
    _finalizeLinks() {
        for (const rec of this._linkRecords) {
            rec.animate = false;
            rec.start = 0;
            rec.grow = 1;
            if (rec.flare) rec.flare.visible = false;
        }
    }

    _hasPinnedNode() {
        if (!this._pinned) return false;
        return this._pinned.kind === 'galaxy'
            ? this._galaxyNodes.has(this._pinned.id)
            : this._systemNodes.has(this._pinned.id);
    }

    _showPinnedLinks() {
        if (!this._hasPinnedNode()) {
            this._pinned = null;
            this._clearLinks();
            return;
        }
        // 单击固定后的线直接静态呈现，不再播放生长/发射动画
        this._showHoverLinks(this._pinned.kind, this._pinned.id, { animate: false });
    }

    /** 星系图标悬停：星系级关联（由星体关联自动推导，区分主动 / 被动） */
    _buildGalaxyHoverLinks(gid, animate = true) {
        const self = this._galaxyNodes.get(gid);
        if (!self) return;

        // otherGid → { node, active: [label], passive: [label] }
        const byOther = new Map();
        const push = (otherGid, label, passive) => {
            if (!otherGid || otherGid === gid) return;
            const node = this._galaxyNodes.get(otherGid);
            if (!node) return;
            let rec = byOther.get(otherGid);
            if (!rec) {
                rec = { node, active: [], passive: [] };
                byOther.set(otherGid, rec);
            }
            const arr = passive ? rec.passive : rec.active;
            if (label && !arr.includes(label)) arr.push(label);
        };

        // 星体级关联 → 星系关联
        for (const rel of this._bodyRelations) {
            const from = this._systems.find(s => s.id === rel.fromSystemId);
            const to = this._systems.find(s => s.id === rel.toSystemId);
            if (!from || !to) continue;
            const ga = resolveSystemGalaxyId(from, this._galaxies);
            const gb = resolveSystemGalaxyId(to, this._galaxies);
            const label = `${rel.fromName || '星体'} → ${rel.toName || '星体'}`;
            if (ga === gid && gb !== gid) push(gb, label, false);
            else if (gb === gid && ga !== gid) push(ga, label, true);
        }
        // 兼容旧的系统级关联（无方向，按主动显示）
        for (const link of buildGalaxyLinks(this._systems, this._galaxies)) {
            if (link.a !== gid && link.b !== gid) continue;
            push(link.a === gid ? link.b : link.a, '', false);
        }

        if (!byOther.size) {
            this._toast('该星系暂未配置关联');
            return;
        }

        const records = [];
        for (const rec of byOther.values()) {
            const otherPos = rec.node.position.clone();
            const selfPos = self.position.clone();
            // 主动：本星系 → 其它星系
            if (rec.active.length || !rec.passive.length) {
                records.push({
                    a: selfPos.clone(),
                    b: otherPos.clone(),
                    labels: rec.active,
                    color: LINK_ACTIVE_COLOR,
                });
            }
            // 被动：其它星系 → 本星系
            if (rec.passive.length) {
                records.push({
                    a: otherPos.clone(),
                    b: selfPos.clone(),
                    labels: rec.passive,
                    color: LINK_PASSIVE_COLOR,
                    passive: true,
                    // 主被动同时存在时，把橙线抬高一点避免完全重叠
                    offsetY: rec.active.length ? 4 : 0,
                });
            }
        }
        this._drawLinks(records, { radius: 1.6, labelLimit: 8, animate });
    }

    /** 恒星悬停：星体级关联；目标星系自动展开 */
    _buildSystemHoverLinks(sysId, animate = true) {
        const selfNode = this._systemNodes.get(sysId);
        const selfSystem = this._systems.find(s => s.id === sysId);
        if (!selfNode || !selfSystem) return;

        // otherId → { node, active: [label], passive: [label] }
        const byOther = new Map();

        const ensureExpanded = (systemId) => {
            const system = this._systems.find(s => s.id === systemId);
            if (!system) return null;
            const gid = resolveSystemGalaxyId(system, this._galaxies);
            if (!this._isExpanded(gid)) this._expandGalaxy(gid, { manual: false });
            return this._systemNodes.get(systemId) || null;
        };

        const push = (otherId, label, passive) => {
            if (!otherId || otherId === sysId) return;
            const otherNode = ensureExpanded(otherId);
            if (!otherNode) return;
            let rec = byOther.get(otherId);
            if (!rec) {
                rec = { node: otherNode, active: [], passive: [] };
                byOther.set(otherId, rec);
            }
            const arr = passive ? rec.passive : rec.active;
            if (label && !arr.includes(label)) arr.push(label);
        };

        // 星体级关联
        for (const rel of this._bodyRelations) {
            const label = `${rel.fromName || '星体'} → ${rel.toName || '星体'}`;
            if (rel.fromSystemId === sysId) {
                push(rel.toSystemId, label, false);      // 本系统主动
            } else if (rel.toSystemId === sysId) {
                push(rel.fromSystemId, label, true);     // 本系统被动
            }
        }

        // 兼容旧的系统级关联（无方向，按主动显示）
        for (const relId of getSystemRelatedIds(selfSystem)) {
            push(relId, '', false);
        }

        if (!byOther.size) {
            this._toast('该星体系统暂未配置关联');
            return;
        }

        const records = [];
        for (const rec of byOther.values()) {
            const selfPos = selfNode.world.clone();
            const otherPos = rec.node.world.clone();
            if (rec.active.length || !rec.passive.length) {
                records.push({
                    a: selfPos.clone(),
                    b: otherPos.clone(),
                    labels: rec.active,
                    color: LINK_ACTIVE_SYSTEM_COLOR,
                });
            }
            if (rec.passive.length) {
                records.push({
                    a: otherPos.clone(),
                    b: selfPos.clone(),
                    labels: rec.passive,
                    color: LINK_PASSIVE_COLOR,
                    passive: true,
                    offsetY: rec.active.length ? 3 : 0,
                });
            }
        }

        this._drawLinks(records, { radius: 1.1, labelLimit: 10, animate });
    }

    /**
     * 画一组关联线：
     *   · 起点 → 终点的发射生长动画 + 一道飞行的光点
     *   · 动画结束后保持静态发光（亮线 + 加色发光管）
     */
    _drawLinks(records, options = {}) {
        if (!records.length) return;
        const baseColor = options.color ?? 0x7fe7ff;
        const radius = options.radius ?? 0.7;
        const labelLimit = options.labelLimit ?? 8;
        const animate = options.animate !== false;

        const group = new THREE.Group();
        this._rootGroup.add(group);
        this._linkGroup = group;

        const now = performance.now();
        let index = 0;
        let labelsUsed = 0;

        for (const record of records) {
            const color = record.color ?? baseColor;
            const a = record.a.clone();
            const b = record.b.clone();
            if (record.offsetY) {
                a.y += record.offsetY;
                b.y += record.offsetY;
            }
            if (a.distanceToSquared(b) < 0.01) continue;

            // 生长用的折线（直线也采样成多段，便于 setDrawRange）
            const points = [];
            for (let i = 0; i <= LINK_SEGMENTS; i++) points.push(a.clone().lerp(b, i / LINK_SEGMENTS));
            const geo = new THREE.BufferGeometry().setFromPoints(points);
            const mat = new THREE.LineBasicMaterial({
                color,
                transparent: true,
                opacity: 0.9,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });
            const line = new THREE.Line(geo, mat);
            line.renderOrder = 4;
            line.geometry.setDrawRange(0, 0);
            group.add(line);

            // 发光管（静态）：内层亮芯 + 外层柔光
            const curve = new THREE.LineCurve3(a.clone(), b.clone());
            const tubeGeo = new THREE.TubeGeometry(curve, 1, radius, 6, false);
            const tubeMat = new THREE.MeshBasicMaterial({
                color,
                transparent: true,
                opacity: 0,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });
            const tube = new THREE.Mesh(tubeGeo, tubeMat);
            tube.renderOrder = 3;
            group.add(tube);

            const glowGeo = new THREE.TubeGeometry(curve, 1, radius * 3.2, 6, false);
            const glowMat = new THREE.MeshBasicMaterial({
                color,
                transparent: true,
                opacity: 0,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });
            const glow = new THREE.Mesh(glowGeo, glowMat);
            glow.renderOrder = 2;
            group.add(glow);

            // 发射光点
            const flareMat = new THREE.SpriteMaterial({
                map: this._haloTexture,
                color,
                transparent: true,
                opacity: 0,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });
            const flare = new THREE.Sprite(flareMat);
            flare.scale.setScalar(options.radius > 0.8 ? 26 : 18);
            flare.position.copy(a);
            flare.visible = false;
            flare.renderOrder = 5;
            group.add(flare);

            // 星体级连线标签
            let labelEl = null;
            if (labelsUsed < labelLimit && record.labels?.length) {
                const text = record.labels.slice(0, 2).join(' · ')
                    + (record.labels.length > 2 ? ` +${record.labels.length - 2}` : '');
                const mid = a.clone().lerp(b, 0.5);
                const labelClass = 'uv-label uv-link-label' + (record.passive ? ' is-passive' : '');
                const label = this._makeLabel(text, new THREE.Vector3(mid.x, mid.y + 7, mid.z), labelClass);
                label.element.style.opacity = '0';
                group.add(label);
                labelEl = label.element;
                labelsUsed++;
            }

            this._linkRecords.push({
                line, mat, tube, tubeMat, glow, glowMat, flare, flareMat, labelEl,
                a, b, animate,
                start: animate ? now + index * 90 : now,
                grow: animate ? 500 : 1,
                drawn: -1,
                points: LINK_SEGMENTS + 1,
            });
            index++;
        }
    }

    _updateLinks(now) {
        for (const rec of this._linkRecords) {
            const elapsed = now - rec.start;
            if (elapsed < 0) continue;
            const p = clamp01(elapsed / rec.grow);
            const count = p >= 1 ? rec.points : Math.max(0, Math.round(rec.points * p));
            if (count !== rec.drawn) {
                rec.line.geometry.setDrawRange(0, count < 2 ? 0 : count);
                rec.drawn = count;
            }
            rec.mat.opacity = 0.88;
            rec.tubeMat.opacity = 0.24 * p;
            rec.glowMat.opacity = 0.07 * p;

            // 首次触发的“发射”动效：光点沿线飞过，到达后淡出
            // 已固定关联线后再次显示（animate=false）时不再播放
            if (!rec.animate) {
                rec.flare.visible = false;
            } else {
                const ft = clamp01(elapsed / 460);
                if (ft < 1) {
                    rec.flare.visible = true;
                    rec.flare.position.copy(rec.a).lerp(rec.b, easeOutCubic(ft));
                    rec.flareMat.opacity = 0.35 + 0.65 * Math.sin(Math.PI * ft);
                } else if (rec.flare.visible) {
                    rec.flareMat.opacity *= 0.85;
                    if (rec.flareMat.opacity < 0.03) {
                        rec.flare.visible = false;
                        rec.flareMat.opacity = 0;
                    }
                }
            }

            if (rec.labelEl) rec.labelEl.style.opacity = p >= 1 ? '0.9' : String(p * 0.9);
        }
    }

    _clearLinks() {
        if (this._linkGroup) this._destroyGroup(this._linkGroup);
        this._linkGroup = null;
        this._linkRecords = [];
        this._linkKey = null;
    }

    // ==================== 通用场景工具 ====================

    _makeLabel(text, position, className = 'uv-label') {
        const el = document.createElement('div');
        el.className = className;
        el.textContent = text;
        const label = new CSS2DObject(el);
        label.position.copy(position);
        return label;
    }

    _loadIconTexture(url) {
        if (this._iconTextures.has(url)) return this._iconTextures.get(url);
        const promise = new Promise((resolve) => {
            // 星系图标是 .svg：先画到 canvas 再上传成纹理。
            // 直接把 SVGImage 当纹理在部分 WebGL 实现（含无头浏览器）会得到全透明贴图。
            const img = new Image();
            img.onload = () => {
                try {
                    const size = 256;
                    const canvas = document.createElement('canvas');
                    canvas.width = size;
                    canvas.height = size;
                    const ctx = canvas.getContext('2d');
                    const iw = img.naturalWidth || size;
                    const ih = img.naturalHeight || size;
                    const scale = Math.min(size / iw, size / ih);
                    const dw = iw * scale;
                    const dh = ih * scale;
                    ctx.drawImage(img, (size - dw) / 2, (size - dh) / 2, dw, dh);
                    const tex = new THREE.CanvasTexture(canvas);
                    tex.colorSpace = THREE.SRGBColorSpace;
                    tex.minFilter = THREE.LinearFilter;
                    tex.magFilter = THREE.LinearFilter;
                    tex.generateMipmaps = false;
                    resolve(tex);
                } catch {
                    resolve(this._fallbackIcon);
                }
            };
            img.onerror = () => resolve(this._fallbackIcon);
            img.src = url;
        });
        this._iconTextures.set(url, promise);
        return promise;
    }

    _loadStarTexture(path) {
        if (!path) return Promise.resolve(null);
        if (this._starTextures.has(path)) return this._starTextures.get(path);
        const promise = new Promise((resolve) => {
            new THREE.TextureLoader().load(
                path,
                (tex) => {
                    tex.colorSpace = THREE.SRGBColorSpace;
                    tex.minFilter = THREE.LinearFilter;
                    tex.generateMipmaps = false;
                    resolve(tex);
                },
                undefined,
                () => resolve(null)
            );
        });
        this._starTextures.set(path, promise);
        return promise;
    }

    _makeHaloTexture() {
        const size = 128;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(0.25, 'rgba(180,235,255,0.75)');
        grad.addColorStop(0.6, 'rgba(90,170,255,0.22)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        return tex;
    }

    /**
     * 选中星体系统的环形标识：四段圆弧，在上下左右留出缺口（对应参考图）。
     * @param {boolean} glow — true 时生成柔光层纹理
     */
    _makeSelectionRingTexture(glow = false) {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const c = size / 2;
        const r = size * 0.42;
        const gap = Math.PI / 12; // 每段首尾各留 15°，形成十字缺口
        const passes = glow
            ? [{ w: 34, a: 0.04 }, { w: 24, a: 0.07 }, { w: 16, a: 0.13 }, { w: 10, a: 0.28 }]
            : [{ w: 11, a: 0.35 }, { w: 7, a: 0.95 }];

        ctx.lineCap = 'round';
        ctx.shadowColor = glow ? 'rgba(80, 205, 255, 0.95)' : 'rgba(160, 245, 255, 0.85)';
        ctx.shadowBlur = glow ? 22 : 10;

        for (let i = 0; i < 4; i++) {
            const start = i * Math.PI / 2 + gap;
            const end = (i + 1) * Math.PI / 2 - gap;
            for (const p of passes) {
                ctx.beginPath();
                ctx.strokeStyle = `rgba(150, 235, 255, ${p.a})`;
                ctx.lineWidth = p.w;
                ctx.arc(c, c, r, start, end);
                ctx.stroke();
            }
            // 弧段端点的小光点
            for (const ang of [start, end]) {
                const px = c + Math.cos(ang) * r;
                const py = c + Math.sin(ang) * r;
                ctx.beginPath();
                ctx.fillStyle = glow ? 'rgba(120, 220, 255, 0.4)' : 'rgba(230, 253, 255, 0.95)';
                ctx.arc(px, py, glow ? 7 : 4, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        return tex;
    }

    _makeFallbackIconTexture() {
        const size = 128;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const grad = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.25, '#8ee9ff');
        grad.addColorStop(0.6, 'rgba(60,130,255,0.55)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        return tex;
    }

    _destroyGroup(group) {
        if (!group) return;
        group.traverse((obj) => {
            if (obj.isCSS2DObject && obj.element?.parentNode) {
                obj.element.parentNode.removeChild(obj.element);
            }
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                mats.forEach(m => m.dispose());
            }
        });
        if (group.parent) group.parent.remove(group);
    }

    _clearScene() {
        this._destroyGroup(this._rootGroup);
        this._rootGroup = null;
        this._galaxyNodes.clear();
        this._expandedGroups.clear();
        this._expandedManual.clear();
        this._expandedAuto.clear();
        this._systemNodes.clear();
        this._collapsing = [];
        this._linkGroup = null;
        this._linkRecords = [];
        this._linkKey = null;
        this._pickables = [];
        this._hovered = null;
        this._activeGalaxy = null;
        this._pinned = null;
        this._selRing = null;
        this._selRingGlow = null;
        this._selRingTarget = null;
        this._sceneToken++;
    }

    // ==================== 相机 ====================

    _setCameraForUniverse() {
        this.camera.position.set(0, 210, 590);
        this.controls.target.set(0, 0, 0);
        this.controls.minDistance = 220;
        this.controls.maxDistance = 1400;
        this.controls.enabled = true;
        this.controls.update();
    }

    // ==================== 交互 / hover ====================

    _onPointerMove(e) {
        this._pointerInside = true;
        const rect = this.renderer.domElement.getBoundingClientRect();
        this._pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this._pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    }

    _pickAtPointer() {
        if (!this._pointerInside || !this._pickables.length) return null;
        this.raycaster.setFromCamera(this._pointer, this.camera);
        const hits = this.raycaster.intersectObjects(this._pickables, false);
        for (const hit of hits) {
            const obj = hit.object;
            if (!obj.visible || obj.userData.hidden) continue;
            return obj;
        }
        return null;
    }

    _nodeFor(obj) {
        if (!obj) return null;
        return obj.userData.kind === 'galaxy'
            ? this._galaxyNodes.get(obj.userData.id)
            : this._systemNodes.get(obj.userData.id);
    }

    _setHovered(obj) {
        if (this._hovered === obj) return;
        this._nodeFor(this._hovered)?.labelEl?.classList.remove('is-hover');
        this._hovered = obj || null;
        if (this._hovered) {
            this._nodeFor(this._hovered)?.labelEl?.classList.add('is-hover');
            this.renderer.domElement.style.cursor = 'pointer';
            this._clearAutoCollapse();
            // 已固定过节点：之后的悬停预览直接静态显示，不再播放动画
            this._showHoverLinks(
                this._hovered.userData.kind,
                this._hovered.userData.id,
                { animate: !this._hasPinnedNode() },
            );
        } else {
            this.renderer.domElement.style.cursor = '';
            // 鼠标移开：若之前单击固定过，则恢复固定的关联线
            if (this._hasPinnedNode()) this._showPinnedLinks();
            else this._clearLinks();
            this._scheduleAutoCollapse();
        }
    }

    _onCanvasClick() {
        if (this._entering) return;
        const obj = this._pickAtPointer();
        if (!obj) {
            // 点击空白处：取消固定并收起预览
            this._pinned = null;
            this._hidePreview();
            this._clearLinks();
            return;
        }
        // 单击即固定关联线，鼠标移开后仍保持
        this._pinLinks(obj.userData.kind, obj.userData.id);
        if (obj.userData.kind === 'galaxy') {
            this._selectGalaxy(obj.userData.id);
        } else if (obj.userData.kind === 'system') {
            this._selectSystem(obj.userData.id);
        }
    }

    // ==================== 预览面板 ====================

    _selectGalaxy(id) {
        const galaxy = this._galaxies.find(g => g.id === id);
        if (!galaxy) return;

        // 点击星系 → 图标闪烁消失 + 星系展开
        if (!this._isExpanded(id)) {
            this._expandGalaxy(id, { manual: true });
        } else {
            this._expandedManual.add(id);
        }
        this._activeGalaxy = galaxy;
        this._previewKind = 'galaxy';
        this._previewId = id;

        const systems = getSystemsInGalaxy(this._systems, this._galaxies, galaxy.id);
        const icon = galaxy.iconSvg || DEFAULT_GALAXY_ICON;
        const tree = Array.isArray(galaxy.detailTree) ? galaxy.detailTree : [];
        const systemNames = systems.slice(0, 10)
            .map(s => `<span class="uv-system-chip">${escapeHtml(s.name)}</span>`)
            .join('');
        const more = systems.length > 10
            ? `<span class="uv-system-more">+${systems.length - 10}</span>`
            : '';

        // --- 社区状态 ---
        const user = this._viewer || getCurrentUser();
        const isMember = getMembershipIds().has(galaxy.id);
        const canEdit = canEditGalaxy(galaxy);
        const memberCount = Number(galaxy.memberCount) || 0;
        const commanderName = galaxy.commanderName || '';
        const joinBtn = !user
            ? '<button class="uv-enter-btn" id="uv-preview-join">登录后加入星系</button>'
            : (isMember
                ? '<button class="uv-sub-btn uv-preview-leave" id="uv-preview-leave">退出星系</button>'
                : '<button class="uv-enter-btn" id="uv-preview-join">＋ 加入星系</button>');
        const manageBtns = canEdit ? `
            <button class="uv-sub-btn" id="uv-preview-edit-galaxy">✎ 编辑星系</button>
            <button class="uv-sub-btn" id="uv-preview-manage">👥 成员管理</button>` : '';

        this.previewEl.innerHTML = `
            <button class="uv-preview-close" id="uv-preview-close" title="关闭">✕</button>
            <div class="uv-preview-head">
                <img class="uv-preview-icon" src="${escapeAttr(icon)}" alt="" />
                <div class="uv-preview-title">
                    <h2>${escapeHtml(galaxy.name)}</h2>
                    <small>${escapeHtml(galaxy.nameCN || '')}</small>
                </div>
            </div>
            <p class="uv-preview-desc">${escapeHtml(galaxy.description || '暂无简介')}</p>
            <div class="uv-preview-stat">
                <span>${systems.length}</span> 个星体系统 ·
                <span>${memberCount}</span> 位公民
                ${commanderName ? ` · 指挥官 ${escapeHtml(commanderName)}` : ''}
            </div>
            <div class="uv-preview-systems">${systemNames}${more}</div>
            ${tree.length ? this._renderDetailTree(tree) : ''}
            <div class="uv-preview-actions">
                <div class="uv-preview-sub-actions">${joinBtn}${manageBtns}</div>
                <button class="uv-enter-btn uv-collapse-btn" id="uv-preview-collapse">⌃ 收起星系</button>
            </div>
        `;
        this.previewEl.classList.remove('hidden');
        this._bindPreviewEvents();
        this.previewEl.querySelector('#uv-preview-collapse')?.addEventListener('click', () => {
            this._hidePreview();
            this._collapseGalaxy(id);
        });
        this.previewEl.querySelector('#uv-preview-join')?.addEventListener('click', () => this._joinGalaxy(galaxy.id));
        this.previewEl.querySelector('#uv-preview-leave')?.addEventListener('click', () => this._leaveGalaxy(galaxy.id));
        this.previewEl.querySelector('#uv-preview-edit-galaxy')?.addEventListener('click', () => {
            this._hidePreview();
            this._openEditGalaxy(galaxy);
        });
        this.previewEl.querySelector('#uv-preview-manage')?.addEventListener('click', () => {
            this.onManageGalaxy(galaxy.id);
        });
    }

    // ==================== 加入 / 退出星系 ====================

    async _joinGalaxy(galaxyId) {
        if (!this._viewer) {
            this.onRequireLogin();
            return;
        }
        const galaxy = this._galaxies.find(g => g.id === galaxyId);
        const res = await apiPost('/api/galaxy/join', { galaxyId });
        if (!res?.ok) {
            this._toast('⚠ ' + (res?.error || '加入失败'));
            return;
        }
        await refreshSession(true);
        this._viewer = getCurrentUser();
        this._galaxies = await loadUniverseGalaxies();
        this._updateTopbar();
        this._selectGalaxy(galaxyId);
        this._toast(`✅ 已加入「${galaxy?.name || galaxyId}」`);
    }

    async _leaveGalaxy(galaxyId) {
        const galaxy = this._galaxies.find(g => g.id === galaxyId);
        if (!confirm(`退出星系「${galaxy?.name || galaxyId}」？\n退出后将无法在该星系发布新的星体系统。`)) return;
        const res = await apiPost('/api/galaxy/leave', { galaxyId });
        if (!res?.ok) {
            this._toast('⚠ ' + (res?.error || '退出失败'));
            return;
        }
        await refreshSession(true);
        this._viewer = getCurrentUser();
        this._galaxies = await loadUniverseGalaxies();
        this._updateTopbar();
        this._selectGalaxy(galaxyId);
        this._toast(`已退出「${galaxy?.name || galaxyId}」`);
    }

    /** 恒星点击：打开预览，点击“进入”才切换主场景 */
    _selectSystem(id) {
        const node = this._systemNodes.get(id);
        const system = this._systems.find(s => s.id === id);
        if (!system) return;

        // 点击过说明用户要留着这个星系，取消自动收起
        if (node) {
            this._expandedManual.add(node.galaxyId);
            this._expandedAuto.delete(node.galaxyId);
        }
        this._previewKind = 'system';
        this._previewId = id;

        const star = system.planets?.find(p => p.isStar) || {};
        const starColor = star.color || '#ffcc00';
        const planets = (system.planets || []).filter(p => !p.isStar);
        const tree = Array.isArray(star.detailTree) ? star.detailTree : [];
        const chips = planets.slice(0, 10)
            .map(p => `<span class="uv-system-chip">${escapeHtml(p.name)}</span>`)
            .join('');
        const more = planets.length > 10
            ? `<span class="uv-system-more">+${planets.length - 10}</span>`
            : '';
        const icon = star.texturePath
            ? `<img class="uv-preview-icon" src="${escapeAttr(star.texturePath)}" alt="" />`
            : `<span class="uv-preview-star" style="--star-color:${escapeAttr(starColor)}"></span>`;

        const activeRels = this._bodyRelations.filter(r => r.fromSystemId === id);
        const activeIds = new Set(activeRels.map(r => r.id));
        const passiveRels = this._bodyRelations
            .filter(r => r.toSystemId === id && !activeIds.has(r.id));
        const relations = [...activeRels, ...passiveRels];
        const relationChips = relations.slice(0, 6).map((rel) => {
            const passive = rel.toSystemId === id && rel.fromSystemId !== id;
            const title = passive ? '被动关联：其它星体指向本系统' : '主动关联：本系统指向其它星体';
            return `<span class="uv-system-chip uv-rel-chip${passive ? ' is-passive' : ''}" title="${title}">${escapeHtml(rel.fromName || '星体')} → ${escapeHtml(rel.toName || '星体')}</span>`;
        }).join('');
        const relationMore = relations.length > 6
            ? `<span class="uv-system-more">+${relations.length - 6}</span>`
            : '';

        this.previewEl.innerHTML = `
            <button class="uv-preview-close" id="uv-preview-close" title="关闭">✕</button>
            <div class="uv-preview-head">
                ${icon}
                <div class="uv-preview-title">
                    <h2>${escapeHtml(system.name)}</h2>
                    <small>${escapeHtml(system.nameCN || '')}</small>
                </div>
            </div>
            <p class="uv-preview-desc">${escapeHtml(system.description || '暂无简介')}</p>
            <div class="uv-preview-stat">
                <span>${planets.length}</span> 颗行星 ·
                ${node ? `位于 ${escapeHtml(this._galaxies.find(g => g.id === node.galaxyId)?.name || '')}` : ''}
            </div>
            <div class="uv-preview-systems">${chips}${more}</div>
            ${relations.length ? `
                <div class="uv-preview-relations">
                    <div class="uv-preview-relations-title">关联星体 <small>青＝主动 · 橙＝被动</small></div>
                    <div class="uv-preview-systems">${relationChips}${relationMore}</div>
                </div>` : ''}
            ${tree.length ? this._renderDetailTree(tree) : ''}
            <div class="uv-preview-actions">
                <button class="uv-enter-btn" id="uv-preview-enter">进入星体系统 →</button>
                <div class="uv-preview-sub-actions">
                    <button class="uv-sub-btn" id="uv-preview-collapse">⌃ 收起星系</button>
                </div>
            </div>
        `;
        this.previewEl.classList.remove('hidden');
        this._bindPreviewEvents();
        this.previewEl.querySelector('#uv-preview-enter')?.addEventListener('click', () => this._enterSystem(system.id));
        this.previewEl.querySelector('#uv-preview-collapse')?.addEventListener('click', () => {
            if (!node) return;
            this._hidePreview();
            this._collapseGalaxy(node.galaxyId);
        });
    }

    _bindPreviewEvents() {
        this.previewEl.querySelector('#uv-preview-close')?.addEventListener('click', () => {
            this._hidePreview();
        });
        this.previewEl.querySelectorAll('.uv-dt-file').forEach(btn => {
            btn.addEventListener('click', () => this._showPreviewFile(Number(btn.dataset.uvDt)));
        });
    }

    _hidePreview() {
        this.previewEl.classList.add('hidden');
        this.previewEl.innerHTML = '';
        this._previewKind = null;
        this._previewId = null;
        this._previewNodes = null;
    }

    _renderDetailTree(tree) {
        const nodes = [];
        const viewerId = 'uv-dt-viewer';

        const walk = (items, level) => items.map((node) => {
            if (!node || !node.type) return '';
            const id = nodes.length;
            nodes.push(node);
            const name = escapeHtml(node.name || '未命名');
            const pad = 4 + level * 12;

            if (node.type === 'folder') {
                const children = Array.isArray(node.children) ? node.children : [];
                return `
                    <details class="uv-dt-folder" open>
                        <summary style="padding-left:${pad}px">📁 ${name}</summary>
                        <div class="uv-dt-children">${walk(children, level + 1)}</div>
                    </details>
                `;
            }

            return `<button type="button" class="uv-dt-file" data-uv-dt="${id}" style="padding-left:${pad}px">
                ${node.type === 'image' ? '🖼' : '📄'} ${name}
            </button>`;
        }).join('');

        this._previewNodes = nodes;
        return `
            <div class="uv-detail-tree">
                <div class="uv-detail-tree-title">📖 详情介绍</div>
                <div class="uv-dt-list">${walk(Array.isArray(tree) ? tree : [], 0)}</div>
                <div class="uv-dt-viewer" id="${viewerId}">
                    <div class="uv-dt-placeholder">点击上方文件查看内容</div>
                </div>
            </div>
        `;
    }

    async _showPreviewFile(index) {
        const node = this._previewNodes?.[index];
        const viewer = this.previewEl.querySelector('.uv-dt-viewer');
        if (!node || !viewer) return;

        if (node.type === 'image') {
            viewer.innerHTML = node.url
                ? `<img class="uv-dt-image" src="${escapeAttr(node.url)}" alt="${escapeAttr(node.name)}" />`
                : '<div class="uv-dt-placeholder">图片不可用</div>';
            return;
        }

        viewer.innerHTML = '<div class="uv-dt-placeholder">加载中…</div>';
        let content = node.content;
        if (content === undefined && node.url) {
            try {
                const res = await fetch(node.url);
                content = await res.text();
            } catch {
                content = '（内容加载失败）';
            }
        }
        viewer.innerHTML = `<pre class="uv-dt-text">${escapeHtml(content ?? '（空文件）')}</pre>`;
    }

    // ==================== 进入星体系统 ====================

    /**
     * 进入效果：恒星球放大并向视角后方移动，视角同步飞入，最后切换主场景。
     */
    async _enterSystem(systemId) {
        if (this._entering) return;
        const node = this._systemNodes.get(systemId);
        if (!node) return;

        this._entering = true;
        this._hidePreview();
        this._clearLinks();
        this._clearAutoCollapse();
        this.controls.enabled = false;

        const target = node.world.clone();
        const camStart = this.camera.position.clone();
        const dirToCam = camStart.clone().sub(target).normalize();
        const camEnd = target.clone().add(dirToCam.multiplyScalar(17));
        const forward = target.clone().sub(camStart).normalize();
        const meshStartScale = node.mesh.scale.x || 1;
        const meshStartPos = node.mesh.position.clone();
        const meshEndPos = meshStartPos.clone().add(forward.multiplyScalar(42));
        const halo = node.halo;
        const haloStart = halo.scale.x;

        await this._runAnim(820, (t) => {
            const e = easeInOutCubic(t);
            this.camera.position.lerpVectors(camStart, camEnd, e);
            this.camera.lookAt(target);
            node.mesh.scale.setScalar(meshStartScale * (1 + 9 * e));
            node.mesh.position.lerpVectors(meshStartPos, meshEndPos, e);
            halo.scale.setScalar(haloStart * (1 + 4 * e));
            halo.material.opacity = Math.min(0.95, 0.3 + e);
        });

        if (!this._open) { this._entering = false; return; }

        this.transitionEl.classList.add('show');
        await delay(260);
        if (!this._open) { this._entering = false; return; }

        this.close({ silent: true });
        this.onEnterSystem(systemId);
        this._entering = false;
    }

    // ==================== 动画辅助 ====================

    /** 由渲染循环驱动的单段动画 */
    _runAnim(duration, onUpdate) {
        this._finishAnim();
        return new Promise((resolve) => {
            this._anim = { start: performance.now(), duration, onUpdate, resolve };
        });
    }

    _finishAnim() {
        if (this._anim) {
            const { resolve } = this._anim;
            this._anim = null;
            resolve?.();
        }
    }

    // ==================== 顶栏 ====================

    _updateTopbar() {
        const expanded = Array.from(this._expandedGroups.values())
            .map(rec => rec.galaxy)
            .filter(Boolean);

        if (expanded.length) {
            const items = expanded.map(g => `
                <span class="uv-crumb-sep">/</span>
                <span class="uv-crumb-link uv-crumb-galaxy" data-uv-collapse="${escapeAttr(g.id)}"
                      title="点击收起全部星系">${escapeHtml(g.name)}</span>
            `).join('');
            this.crumbsEl.innerHTML = `<span class="uv-crumb-current">宇宙</span>${items}`;
            this.crumbsEl.querySelectorAll('[data-uv-collapse]').forEach(el => {
                el.addEventListener('click', () => this._collapseAll());
            });
        } else {
            this.crumbsEl.innerHTML = '<span class="uv-crumb-current">宇宙</span>';
        }

        // 星系编辑菜单仅开发者可见（管理员不能删除 / 修改星系）
        this.overlay.querySelector('.uv-galaxy-menu-wrap')
            ?.classList.toggle('hidden', !isDeveloper());

        // 发布星体系统入口始终显示；有目标星系时优先用它，否则在编译器中自选
        const target = this._addTargetGalaxy();
        this.addSystemBtn?.classList.remove('hidden');
        if (this.addSystemBtn) {
            this.addSystemBtn.title = target
                ? `在「${target.name}」中添加星体系统`
                : '添加星体系统（可在编译器中选择所属星系）';
        }
    }

    /** 当前用于“添加星体系统”的目标星系：展开中 > 预览中 > 无 */
    _addTargetGalaxy() {
        const expandedTarget = this._activeGalaxy && this._expandedGroups.has(this._activeGalaxy.id)
            ? this._activeGalaxy
            : this._expandedGroups.values().next().value?.galaxy || null;
        if (expandedTarget) return expandedTarget;
        if (this._previewKind === 'galaxy' && this._previewId) {
            return this._galaxies.find(g => g.id === this._previewId) || null;
        }
        return null;
    }

    _canAddSystemTo(galaxy) {
        const user = this._viewer || getCurrentUser();
        if (!user || !galaxy) return false;
        if (user.role === 'developer' || user.role === 'admin') return true;
        return getMembershipIds().has(galaxy.id);
    }

    _openAddSystem() {
        if (!this._viewer) {
            this.onRequireLogin();
            return;
        }
        const target = this._addTargetGalaxy();
        if (target && !this._canAddSystemTo(target)) {
            this._toast('请先加入该星系，再发布星体系统');
            return;
        }
        this.onAddSystem(target ? target.id : '');
    }

    _toast(message) {
        this.toastEl.textContent = message;
        this.toastEl.classList.add('show');
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), 2600);
    }

    // ==================== 星系编辑菜单 ====================

    _toggleGalaxyMenu() {
        if (!isDeveloper()) return;
        this.galaxyMenuEl?.classList.toggle('hidden');
    }

    _closeGalaxyMenu() {
        this.galaxyMenuEl?.classList.add('hidden');
    }

    // ==================== 添加 / 编辑星系表单 ====================

    _openAddGalaxy() {
        this._editingGalaxy = null;
        this._editingIconSvg = null;
        this.addModal.classList.remove('hidden');
        const title = this.overlay.querySelector('#uv-add-title');
        if (title) title.textContent = '🛰 添加星系';
        this.overlay.querySelector('#uv-g-name').value = '新星系';
        this.overlay.querySelector('#uv-g-name-cn').value = 'New Galaxy';
        this.overlay.querySelector('#uv-g-desc').value = '';
        this.overlay.querySelector('#uv-g-icon').value = '';
        this.overlay.querySelector('#uv-g-icon-preview').classList.add('hidden');
        this._addGalaxyIcon = null;
        this._addGalaxyDetailTree = [];
        this._updateAddGalaxyDetailBadge();
        setTimeout(() => this.overlay.querySelector('#uv-g-name')?.focus(), 50);
    }

    /** 打开某个星系的编辑表单（与“添加星系”同一套字段，全部可改） */
    _openEditGalaxy(galaxy) {
        if (!galaxy) return;
        this._editingGalaxy = galaxy;
        this._editingIconSvg = galaxy.iconSvg || DEFAULT_GALAXY_ICON;
        this._addGalaxyIcon = null;
        this._addGalaxyDetailTree = JSON.parse(JSON.stringify(galaxy.detailTree || []));

        this.addModal.classList.remove('hidden');
        const title = this.overlay.querySelector('#uv-add-title');
        if (title) title.textContent = '✎ 编辑星系';
        this.overlay.querySelector('#uv-g-name').value = galaxy.name || '';
        this.overlay.querySelector('#uv-g-name-cn').value = galaxy.nameCN || '';
        this.overlay.querySelector('#uv-g-desc').value = galaxy.description || '';
        this.overlay.querySelector('#uv-g-icon').value = '';
        const preview = this.overlay.querySelector('#uv-g-icon-preview');
        if (preview) {
            preview.src = this._editingIconSvg;
            preview.classList.remove('hidden');
        }
        this._updateAddGalaxyDetailBadge();
        setTimeout(() => this.overlay.querySelector('#uv-g-name')?.focus(), 50);
    }

    _closeAddGalaxy() {
        this.addModal.classList.add('hidden');
        this._editingGalaxy = null;
        this._editingIconSvg = null;
    }

    // ==================== 星系列表 / 删除 ====================

    async _openGalaxyManager() {
        this._closeGalaxyMenu();
        if (!isDeveloper()) {
            this._toast('仅开发者可以删除星系');
            return;
        }
        this._galaxies = await loadUniverseGalaxies();
        if (!this._open) return;
        this._systems = getAllUniverseSystems().filter(s => (s.status || 'approved') !== 'draft');
        this._renderGalaxyManager();
        this.geditModal.classList.remove('hidden');
    }

    _closeGalaxyManager() {
        this.geditModal.classList.add('hidden');
    }

    _renderGalaxyManager() {
        if (!this.geditListEl) return;
        const rows = this._galaxies.map((g) => {
            const count = getSystemsInGalaxy(this._systems, this._galaxies, g.id).length;
            const isDefault = g.id === DEFAULT_GALAXY_ID || g.isDefault;
            return `
                <div class="uv-gedit-row" data-gedit-id="${escapeAttr(g.id)}" title="点击编辑「${escapeAttr(g.name)}」">
                    <img class="uv-gedit-icon" src="${escapeAttr(g.iconSvg || DEFAULT_GALAXY_ICON)}" alt="" />
                    <div class="uv-gedit-info">
                        <span class="uv-gedit-name">${escapeHtml(g.name)}
                            <small>${escapeHtml(g.nameCN || '')}</small>
                        </span>
                        <span class="uv-gedit-meta">${count} 个星体系统${isDefault ? ' · 默认星系' : ''}</span>
                    </div>
                    ${isDefault
                        ? '<span class="uv-gedit-locked" title="默认星系不可删除">🔒</span>'
                        : `<button class="uv-gedit-delete" data-gedit-delete="${escapeAttr(g.id)}" title="删除星系">✕</button>`}
                </div>
            `;
        }).join('');
        this.geditListEl.innerHTML = rows || '<div class="uv-gedit-empty">还没有星系</div>';

        this.geditListEl.querySelectorAll('[data-gedit-id]').forEach((row) => {
            row.addEventListener('click', (e) => {
                if (e.target.closest('[data-gedit-delete]')) return;
                const galaxy = this._galaxies.find(g => g.id === row.dataset.geditId);
                if (!galaxy) return;
                this._closeGalaxyManager();
                this._openEditGalaxy(galaxy);
            });
        });
        this.geditListEl.querySelectorAll('[data-gedit-delete]').forEach((btn) => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const galaxy = this._galaxies.find(g => g.id === btn.dataset.geditDelete);
                if (!galaxy) return;
                if (!confirm(`删除星系「${galaxy.name}」？\n其中的星体系统会自动归入默认星系。`)) return;
                const result = await deleteUniverseGalaxy(galaxy.id);
                if (!result.ok) {
                    this._toast('⚠ ' + (result.error || '删除失败'));
                    return;
                }
                if (this._pinned?.kind === 'galaxy' && this._pinned.id === galaxy.id) this._pinned = null;
                this._galaxies = await loadUniverseGalaxies();
                this._systems = getAllUniverseSystems().filter(s => (s.status || 'approved') !== 'draft');
                this._renderGalaxyManager();
                await this._rebuildSceneKeepingExpanded();
                this._toast(`🗑 星系「${galaxy.name}」已删除`);
            });
        });
    }

    _previewIconFile(input) {
        const file = input.files?.[0];
        const img = this.overlay.querySelector('#uv-g-icon-preview');
        if (!file || !img) {
            img?.classList.add('hidden');
            return;
        }
        if (!/svg/i.test(file.type) && !/\.svg$/i.test(file.name)) {
            this._toast('⚠ 图标必须是 .svg 文件');
            input.value = '';
            img.classList.add('hidden');
            return;
        }
        const url = URL.createObjectURL(file);
        img.src = url;
        img.classList.remove('hidden');
        img.onload = () => URL.revokeObjectURL(url);
    }

    _ensureDetailEditor() {
        if (!this._detailEditor) {
            this._detailEditor = new DetailTreeEditor({
                onSave: (tree) => {
                    this._addGalaxyDetailTree = tree;
                    this._updateAddGalaxyDetailBadge();
                },
            });
        }
        return this._detailEditor;
    }

    _openAddGalaxyDetailEditor() {
        const name = this.overlay.querySelector('#uv-g-name')?.value.trim() || '星系';
        const editor = this._ensureDetailEditor();
        editor.open(this._addGalaxyDetailTree, '星系 · ' + name, { mode: 'detail' });
        // 详情编辑器默认 z-index 1000；宇宙视图弹窗在其上方，需要抬高
        const dom = document.getElementById('detail-tree-editor');
        if (dom) dom.style.zIndex = '1400';
    }

    _updateAddGalaxyDetailBadge() {
        const count = this._countDetailFiles(this._addGalaxyDetailTree);
        const el = this.overlay.querySelector('#uv-g-detail-count');
        if (!el) return;
        el.textContent = count > 0 ? `${count} 个文件` : '未配置';
        el.classList.toggle('has-tree', count > 0);
    }

    _countDetailFiles(nodes) {
        if (!Array.isArray(nodes)) return 0;
        let n = 0;
        for (const node of nodes) {
            if (!node) continue;
            if (node.type === 'folder') n += this._countDetailFiles(node.children);
            else if (node.type === 'text' || node.type === 'image') n++;
        }
        return n;
    }

    async _readSvg(file) {
        if (!file) return null;
        if (!/svg/i.test(file.type) && !/\.svg$/i.test(file.name)) {
            throw new Error('图标必须是 .svg 文件');
        }
        if (file.size > 2 * 1024 * 1024) {
            throw new Error('SVG 图标不能超过 2MB');
        }
        return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
            reader.onerror = () => reject(new Error('图标读取失败'));
            reader.readAsDataURL(file);
        });
    }

    async _saveGalaxyFromForm() {
        const name = this.overlay.querySelector('#uv-g-name').value.trim();
        const nameCN = this.overlay.querySelector('#uv-g-name-cn').value.trim();
        const description = this.overlay.querySelector('#uv-g-desc').value.trim();
        if (!name) {
            this._toast('⚠ 请填写星系名称');
            return;
        }

        const editing = this._editingGalaxy;

        // 编辑时未重新选择图标就保留原图标
        let iconSvg = editing ? (this._editingIconSvg || DEFAULT_GALAXY_ICON) : DEFAULT_GALAXY_ICON;
        try {
            const file = this.overlay.querySelector('#uv-g-icon').files?.[0];
            if (file) iconSvg = (await this._readSvg(file)) || iconSvg;
        } catch (err) {
            this._toast('⚠ ' + err.message);
            return;
        }

        // 编辑保持 id 不变：星体系统的 universe.galaxyId 引用不会失效
        const id = editing
            ? editing.id
            : makeGalaxyId(nameCN || name, this._galaxies.map(g => g.id));
        const galaxy = {
            ...(editing || {}),
            id,
            name,
            nameCN,
            description,
            iconSvg,
            detailTree: this._addGalaxyDetailTree || [],
            isDefault: editing ? !!editing.isDefault : false,
            createdAt: editing?.createdAt || Date.now(),
        };

        const saveBtn = this.overlay.querySelector('#uv-g-save');
        saveBtn.disabled = true;
        saveBtn.textContent = '保存中…';
        const result = await saveUniverseGalaxy(galaxy);
        saveBtn.disabled = false;
        saveBtn.textContent = '保存星系';

        if (!result.ok) {
            this._toast('⚠ ' + (result.error || '保存失败'));
            return;
        }

        this._galaxies = await loadUniverseGalaxies();
        await this._rebuildSceneKeepingExpanded();
        this._closeAddGalaxy();
        const action = editing ? '已更新' : '已保存';
        this._toast(result.server
            ? `✅ 星系「${name}」${action}`
            : `✅ 星系「${name}」${action}到本地（服务器不可用）`);
        if (this._previewKind === 'galaxy' && this._previewId === galaxy.id) {
            this._selectGalaxy(galaxy.id);
        }
    }

    async _rebuildSceneKeepingExpanded() {
        const keep = Array.from(this._expandedManual);
        const keepAuto = Array.from(this._expandedAuto);
        this._hidePreview();
        await this._buildScene();
        if (!this._open) return;
        for (const gid of keep) this._expandGalaxy(gid, { manual: true });
        for (const gid of keepAuto) {
            if (!this._isExpanded(gid)) this._expandGalaxy(gid, { manual: false });
        }
    }

    // ==================== 渲染循环 ====================

    _startLoop() {
        if (this._raf) return;
        this._clock.getDelta();
        const tick = () => {
            this._raf = requestAnimationFrame(tick);
            this._update();
        };
        this._raf = requestAnimationFrame(tick);
    }

    _stopLoop() {
        if (this._raf) cancelAnimationFrame(this._raf);
        this._raf = 0;
    }

    _update() {
        const dt = Math.min(this._clock.getDelta(), 0.1);
        const now = performance.now();

        // 动画（进入星体系统的运镜）
        if (this._anim) {
            const { start, duration, onUpdate, resolve } = this._anim;
            const t = clamp01((now - start) / duration);
            onUpdate(t);
            if (t >= 1) {
                this._anim = null;
                resolve?.();
            }
        }

        if (this._entering) {
            // 运镜期间由 _anim 直接控制相机，不能让 OrbitControls 覆盖朝向
            this.renderer.render(this.scene, this.camera);
            this.labelRenderer.render(this.scene, this.camera);
            return;
        }

        // hover 检测
        const hit = this._pickAtPointer();
        this._setHovered(hit);

        this._updateGalaxyNodes(dt, now);
        this._updateSystemNodes(dt, now);
        this._updateSelectionRing(dt, now);
        this._updateCollapsing(dt);
        this._updateLinks(now);

        if (this.starfield) this.starfield.rotation.y += dt * 0.004;

        this.controls.update();
        this.renderer.render(this.scene, this.camera);
        this.labelRenderer.render(this.scene, this.camera);
    }

    _updateGalaxyNodes(dt, now) {
        for (const node of this._galaxyNodes.values()) {
            const hovered = this._hovered === node.icon;
            const base = ICON_SIZE;

            if (node.flashStart) {
                const t = clamp01((now - node.flashStart) / 560);
                const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 6);
                node.icon.material.opacity = t >= 1 ? 0 : 0.25 + 0.75 * pulse;
                node.halo.material.opacity = t >= 1 ? 0 : 0.1 + 0.5 * pulse;
                node.flashScale = 1 + 0.5 * Math.sin(t * Math.PI);
                if (t >= 1) {
                    node.flashStart = 0;
                    node.flashScale = 1;
                    node.icon.visible = false;
                    node.halo.visible = false;
                    node.labelEl.style.display = 'none';
                }
                node.icon.scale.setScalar(base * node.flashScale);
                continue;
            }

            if (node.appearStart) {
                const t = clamp01((now - node.appearStart) / 420);
                const e = easeOutCubic(t);
                node.icon.material.opacity = e;
                node.halo.material.opacity = 0.3 * e;
                node.icon.scale.setScalar(base * (0.2 + 0.8 * e));
                node.labelEl.style.opacity = String(e);
                if (t >= 1) node.appearStart = 0;
                continue;
            }

            if (node.hidden) continue;

            const targetScale = hovered ? base * 1.14 : base;
            const cur = node.icon.scale.x || base;
            node.icon.scale.setScalar(cur + (targetScale - cur) * Math.min(1, dt * 12));
            node.icon.material.opacity = 1;

            const baseOpacity = 0.3;
            const pulse = hovered ? 0.22 + Math.sin(now * 0.006) * 0.12 : 0;
            const targetOpacity = hovered ? Math.min(0.95, baseOpacity + 0.5 + pulse) : baseOpacity;
            node.halo.material.opacity += (targetOpacity - node.halo.material.opacity) * Math.min(1, dt * 10);
        }
    }

    // ==================== 选中星体系统的环形标识 ====================

    _createSelectionRing() {
        if (!this._rootGroup) return;
        const core = new THREE.Sprite(new THREE.SpriteMaterial({
            map: this._selRingTex,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            depthTest: false,
            blending: THREE.AdditiveBlending,
        }));
        core.renderOrder = 20;
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({
            map: this._selRingGlowTex,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            depthTest: false,
            blending: THREE.AdditiveBlending,
        }));
        glow.renderOrder = 19;
        this._rootGroup.add(core, glow);
        this._selRing = core;
        this._selRingGlow = glow;
    }

    /** 单击固定的星体系统外侧绘制四段圆弧；悬停时沿圆弧微微发光 */
    _updateSelectionRing(dt, now) {
        const target = this._pinned?.kind === 'system' ? this._systemNodes.get(this._pinned.id) : null;
        if (!target) {
            if (this._selRing) {
                this._selRing.visible = false;
                this._selRingGlow.visible = false;
            }
            this._selRingTarget = null;
            return;
        }

        if (!this._selRing || !this._selRing.parent) this._createSelectionRing();
        if (!this._selRing) return;

        if (this._selRingTarget !== this._pinned.id) {
            this._selRingTarget = this._pinned.id;
            this._selRingStart = now;
        }

        const appear = clamp01((now - this._selRingStart) / 380);
        const ease = easeOutCubic(appear);
        const hovered = this._hovered === target.mesh;
        const pulse = hovered ? 1 + Math.sin(now * 0.008) * 0.035 : 1;
        // 按屏幕像素换算环半径：始终以约 1.9 倍恒星的视觉尺寸包住它，且不小于 34px，
        // 这样拉远镜头时环也不会缩成一个小点。
        const cam = this.camera;
        const halfH = Math.max(1, this.renderer.domElement.clientHeight * 0.5);
        const dist = Math.max(cam.position.distanceTo(target.world), 1);
        const pxPerWorld = halfH / (Math.tan(THREE.MathUtils.degToRad(cam.fov * 0.5)) * dist);
        const ringPx = Math.max(target.radius * pxPerWorld * 1.9, 34);
        // 纹理中圆环半径为贴图宽度的 0.42，故 sprite 尺寸 = 世界半径 / 0.42
        const scale = (ringPx / pxPerWorld / 0.42) * (0.8 + 0.2 * ease) * pulse;

        this._selRing.visible = true;
        this._selRingGlow.visible = true;
        this._selRing.position.copy(target.world);
        this._selRing.scale.setScalar(scale);
        this._selRing.material.opacity = 0.9 * ease;
        this._selRing.material.rotation -= dt * 0.1;

        this._selRingGlow.position.copy(target.world);
        this._selRingGlow.scale.setScalar(scale * 1.12);
        const glowTarget = (hovered ? 0.8 : 0.14) * ease;
        this._selRingGlow.material.opacity += (glowTarget - this._selRingGlow.material.opacity) * Math.min(1, dt * 9);
        this._selRingGlow.material.rotation -= dt * (hovered ? 0.34 : 0.13);
    }

    _updateSystemNodes(dt, now) {
        for (const node of this._systemNodes.values()) {
            const hovered = this._hovered === node.mesh;
            const t = clamp01((now - node.born) / 460);
            const reveal = 0.15 + 0.85 * easeOutCubic(t);
            const targetScale = reveal * (hovered ? 1.18 : 1);
            const cur = node.mesh.scale.x || 0.001;
            node.mesh.scale.setScalar(cur + (targetScale - cur) * Math.min(1, dt * 14));

            const targetHalo = (hovered ? 0.72 + Math.sin(now * 0.006) * 0.12 : 0.26) * t;
            node.halo.material.opacity += (targetHalo - node.halo.material.opacity) * Math.min(1, dt * 10);
            node.labelEl.style.opacity = String(t);
            node.mesh.rotation.y += node.spin * dt;
        }
    }

    _updateCollapsing(dt) {
        for (let i = this._collapsing.length - 1; i >= 0; i--) {
            const rec = this._collapsing[i];
            const t = clamp01((performance.now() - rec.collapseStart) / 260);
            const s = Math.max(0.01, 1 - easeOutCubic(t));
            for (const node of rec.nodes.values()) {
                node.mesh.scale.setScalar(s);
                node.halo.material.opacity = 0.26 * (1 - t);
                node.labelEl.style.opacity = String(1 - t);
            }
            if (t >= 1) {
                this._destroyGroup(rec.group);
                this._collapsing.splice(i, 1);
            }
        }
    }

    _transitionElReset() {
        this.transitionEl.classList.remove('show');
    }
}
