// ============================================================
// GalaxyBrowser.js — 星体数据库 UI 组件
// 管理用户的所有星体系统：浏览、搜索、创建、再次编译、导入/导出
// ============================================================

import * as THREE from 'three';
import { CelestialBody } from './CelestialBody.js';
import {
    getAllGalaxies,
    getGalaxyById,
    searchGalaxies,
    addCustomGalaxy,
    updateCustomGalaxy,
    deleteCustomGalaxy,
    isBuiltIn,
    createGalaxyOnServer,
    updateGalaxyOnServer,
    deleteGalaxyOnServer,
    serverRecordToGalaxy,
    loadCustomGalaxiesFromServer,
    migrateLocalStorageToServer,
    fetchMySystems,
} from './galaxyRegistry.js?v=8';
import { AU } from './constants.js';
import { POS_SCALE } from './constants.js';
import { escapeHtml } from './utils.js';
import { GalaxyPreview } from './GalaxyPreview.js';
import { DetailTreeEditor } from './DetailTreeEditor.js?v=3';
import { UniverseView } from './UniverseView.js?v=27';
import { BodyRelationEditor } from './BodyRelationEditor.js?v=5';
import {
    DEFAULT_GALAXY_ID,
    DEFAULT_GALAXY_ICON,
    loadUniverseGalaxies,
    getSystemGalaxyId,
    getSystemRelatedIds,
    resolveSystemGalaxyId,
    saveBodyRelation,
} from './UniverseRegistry.js?v=7';

// 新建系统尚未保存时，关联编辑器使用的临时系统 id / 星体 key 前缀
const DRAFT_SYSTEM_ID = '__draft_system__';
import {
    getCurrentUser,
    refreshSession,
    isDeveloper,
    isAdmin,
    getMembershipIds,
    onSessionChange,
    apiPost,
} from './session.js?v=1';
import { showToast } from './toast.js';

/** 属性值转义：escapeHtml 只处理文本节点，引号会破坏 title/src/data-* 属性 */
function _escapeAttr(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

export class GalaxyBrowser {
    /**
     * @param {object}   deps
     * @param {object}   deps.planets    — 当前所有星球实例 { key: CelestialBody }
     * @param {object}   deps.physics    — PhysicsEngine 实例
     * @param {THREE.Scene} deps.scene   — 主场景
     * @param {SystemManager} deps.systemManager — 系统切换管理器
     * @param {function} deps.onFocusBody — 回调 (bodyKey) 聚焦星球
     * @param {function} deps.onNavigateToGalaxy — 回调 (galaxyId) 导航到星系视图
     * @param {function} deps.onRefreshOrbits — 回调 重绘轨道线
     */
    constructor(deps) {
        this.planets         = deps.planets;
        this.physics         = deps.physics;
        this.scene           = deps.scene;
        this.systemManager   = deps.systemManager;
        this.onFocusBody     = deps.onFocusBody || (() => {});
        this.onNavigateToGalaxy = deps.onNavigateToGalaxy || (() => {});
        this.onRefreshOrbits = deps.onRefreshOrbits || (() => {});

        this._customBodies = [];  // 追踪自定义星系创建的 body keys
        this._editingGalaxy = null;   // 非 null 时，编译窗口处于“再次编译”模式
        this._detailEditor = null;      // 文件夹式详情编译器
        this._detailSaveCallback = null;
        this._editStarDetailTree = null; // 恒星详情文件夹树（编辑模式）
        this._editStarSurfaceTree = null; // 恒星地表图片文件夹树（编辑模式）
        this._editStarDetails = '';       // 恒星原详情文本（只读保留，兼容旧数据）

        this._universeView = null;        // 宇宙视图（懒加载）
        this._universeReturnToDb = false; // 关闭宇宙视图后是否回到星体数据库
        this._pendingUniverseGalaxyId = null; // 从星系视图新建系统时，保存后回到该星系
        this._pendingUniverseReturn = false;  // 是否从星系视图打开编译器（保存/关闭后返回）
        this._universeGalaxies = [];      // 宇宙级星系列表
        this._dbGalaxyId = null;          // 星体数据库当前展开的星系（null = 星系列表）
        this._bodyRelationEditor = null;  // 星体级关联编辑器（懒加载）
        this._draftRelations = [];        // 新建系统尚未保存的星体关联
        this._addFormToken = 0;           // 防止异步加载串台
        this._communityHandlers = {};     // 个人中心 / 登录 / 星系管理等回调

        this._buildDOM();
        this._bindEvents();
        // 预加载星系列表：列表卡片的“所属星系”需要
        this._refreshUniverseGalaxies();
        // 登录 / 退出后刷新权限相关的按钮与“我的系统”
        onSessionChange(() => {
            this._renderList();
            this._universeView?.setViewer?.(getCurrentUser());
        });
    }

    /**
     * 由 main.js 注入的社区能力。全部可选，缺失时降级为普通提示。
     */
    setCommunityHandlers(handlers = {}) {
        this._communityHandlers = { ...this._communityHandlers, ...handlers };
    }

    _requireLogin() {
        if (this._communityHandlers.onRequireLogin) {
            this._communityHandlers.onRequireLogin();
        } else {
            showToast('请先登录后再操作', 'info');
        }
    }

    // ==================== DOM 构建 ====================
    _buildDOM() {
        // --- 覆盖层 ---
        this.overlay = document.createElement('div');
        this.overlay.id = 'galaxy-browser-overlay';
        this.overlay.className = 'galaxy-browser-overlay hidden';
        this.overlay.innerHTML = `
            <div class="galaxy-browser-backdrop"></div>
            <div class="scanline"></div>
            <div class="fui-window">
                <div class="fui-header">
                    <div class="fui-title">STELLAR_DATABASE</div>
                    <div class="fui-search-box">
                        <svg class="search-icon" viewBox="0 0 24 24" width="16" height="16">
                            <path d="M15.5 14h-.79l-.28-.27C15.46 12.68 16 11.12 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.62 0 3.18-.54 4.22-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                        </svg>
                        <input type="text" class="fui-search-input" id="galaxy-search-input" placeholder="SEARCH_TARGET_SYSTEM..." autocomplete="off" />
                    </div>
                    <!-- 文件导入导出按钮 -->
                    <div class="gb-file-btn-wrap" style="position:relative;margin-left:6px;">
                        <button class="gb-file-btn" id="gb-file-btn" title="导入/导出星系" style="background:none;border:none;cursor:pointer;padding:4px;filter:drop-shadow(0 0 6px #00aaff);">
                            <img src="buttons/文件夹,文件.png" style="width:20px;height:20px;display:block;" />
                        </button>
                    </div>
                    <button class="galaxy-browser-close" id="galaxy-browser-close">✕</button>
                </div>
                <div class="fui-content galaxy-browser-list" id="galaxy-browser-list">
                    <div class="galaxy-browser-empty">加载中...</div>
                </div>
            </div>
        `;
        document.body.appendChild(this.overlay);

        // --- 文件下拉菜单 + 保存面板（fixed 定位，避免被 fui-window 的 clip-path 裁剪）---
        const ddHTML = `
            <div class="gb-file-dropdown hidden" id="gb-file-dropdown" style="position:fixed;z-index:9999;background:rgba(10,12,20,0.95);border:1px solid var(--fui-border-glow);min-width:120px;">
                <button class="gb-file-dropdown-item" data-action="save" style="display:block;width:100%;padding:8px 14px;background:none;border:none;color:var(--fui-text-bright);cursor:pointer;text-align:left;font-family:var(--fui-font-body);font-size:13px;">💾 保存</button>
                <button class="gb-file-dropdown-item" data-action="import" style="display:block;width:100%;padding:8px 14px;background:none;border:none;color:var(--fui-text-bright);cursor:pointer;text-align:left;font-family:var(--fui-font-body);font-size:13px;">📂 导入</button>
            </div>
            <div class="gb-save-panel hidden" id="gb-save-panel" style="position:fixed;z-index:9999;width:320px;max-height:400px;background:rgba(10,12,20,0.95);border:1px solid var(--fui-border-glow);display:flex;flex-direction:column;">
                <div style="padding:10px 14px;border-bottom:1px solid var(--fui-accent-dim);font-family:var(--fui-font-display);font-size:12px;color:var(--fui-cyan);letter-spacing:1px;">💾 选择要导出的星体系统</div>
                <input type="text" id="gb-save-search" placeholder="搜索星体系统..." style="margin:8px 12px;padding:6px 10px;background:var(--fui-bg-input);border:1px solid var(--fui-accent-dim);color:var(--fui-text-bright);font-size:12px;outline:none;" />
                <div id="gb-save-list" style="flex:1;overflow-y:auto;padding:4px 12px;min-height:100px;"></div>
                <div style="padding:8px 12px;border-top:1px solid var(--fui-accent-dim);text-align:right;">
                    <button id="gb-save-confirm" class="fui-glitch-btn" style="padding:6px 20px;font-size:12px;"><span>✔ 确认导出</span></button>
                </div>
            </div>`;
        const ddWrap = document.createElement('div');
        ddWrap.innerHTML = ddHTML;
        this.overlay.appendChild(ddWrap);

        // --- 添加星系模态框 ---
        this.addModal = document.createElement('div');
        this.addModal.id = 'add-galaxy-modal';
        this.addModal.className = 'add-galaxy-modal hidden';
        this.addModal.innerHTML = this._buildAddFormHTML();
        document.body.appendChild(this.addModal);

        // 引用
        this.listEl    = this.overlay.querySelector('#galaxy-browser-list');
        this.searchEl  = this.overlay.querySelector('#galaxy-search-input');
        this.closeBtn  = this.overlay.querySelector('#galaxy-browser-close');
        this.addBtn    = this.overlay.querySelector('#galaxy-browser-add-btn');
        this.backdrop  = this.overlay.querySelector('.galaxy-browser-backdrop');

        // 添加表单引用
        this.agClose     = this.addModal.querySelector('#ag-close');
        this.agBackdrop  = this.addModal.querySelector('.add-galaxy-backdrop');
        this.agConfirm   = this.addModal.querySelector('#ag-confirm');
        this.agDraft     = this.addModal.querySelector('#ag-draft');
        this.agAddPlanet = this.addModal.querySelector('#ag-add-planet');
        this.agPlanetList = this.addModal.querySelector('#ag-planet-list');
        this.agPreviewCanvas = this.addModal.querySelector('#ag-preview-canvas');
        this.agPreviewInfo = this.addModal.querySelector('#ag-preview-info');
        this.agPreviewReset = this.addModal.querySelector('#ag-preview-reset');
        this._galaxyPreview = null;
        this._previewTimer = null;
        // 贴图文件 → 预览用 object URL（以文件输入元素为键，避免重复创建）
        this._previewTextureUrls = new WeakMap();
    }

    _buildAddFormHTML() {
        return `
        <div class="add-galaxy-backdrop"></div>
        <div class="add-galaxy-panel">
            <div class="add-galaxy-header">
                <span id="ag-title-text">➕ 星体编译器</span>
                <button class="add-galaxy-close" id="ag-close">&times;</button>
            </div>
            <div class="add-galaxy-main">
            <div class="add-galaxy-body">
                <div class="ag-section">
                    <div class="ag-section-title">🌌 星体系统信息</div>
                    <div class="ag-row"><label>名称</label><input id="ag-name" value="新星系" placeholder="如：比邻星系" /></div>
                    <div class="ag-row"><label>英文名</label><input id="ag-name-cn" value="New Galaxy" placeholder="如：Proxima Centauri" /></div>
                    <div class="ag-row"><label>描述</label><textarea id="ag-desc" rows="2" placeholder="简短描述...">一个新的恒星系统</textarea></div>
                    <div class="ag-row"><label>星体关联</label>
                        <div class="ag-detail-field">
                            <button type="button" id="ag-relations-btn" class="ag-detail-manage-btn"
                                    title="编辑该星体系统与其他星体系统之间的关联">🔗 编辑星体关联</button>
                            <span class="ag-detail-count" id="ag-relations-hint">可直接编辑，保存后生效</span>
                        </div>
                    </div>
                </div>
                <div class="ag-section">
                    <div class="ag-section-title">🌌 所属星系</div>
                    <div class="ag-row"><label>所属星系</label>
                        <div class="ag-universe-field">
                            <input id="ag-universe-galaxy-search" class="ag-search-input" placeholder="🔍 搜索星系…" autocomplete="off" />
                            <select id="ag-universe-galaxy" class="ag-universe-select"></select>
                        </div>
                    </div>
                </div>
                <div class="ag-section">
                    <div class="ag-section-title">☀️ 中心恒星</div>
                    <div class="ag-row"><label>名称</label><input id="ag-star-name" value="新恒星" /></div>
                    <div class="ag-row"><label>质量 (kg)</label><input id="ag-star-mass" type="number" value="1.989e30" step="any" /></div>
                    <div class="ag-row"><label>半径 (km)</label><input id="ag-star-radius" type="number" value="696340" step="any" /></div>
                    <div class="ag-row"><label>外观</label>
                        <select id="ag-star-appearance" class="ag-appearance">
                            <option value="color">纯色球</option>
                            <option value="texture">上传贴图</option>
                        </select>
                    </div>
                    <div class="ag-row"><label>颜色</label><input id="ag-star-color" type="color" value="#ffcc00" /></div>
                    <div class="ag-row"><label>贴图</label><input id="ag-star-texture" type="file" accept="image/*" style="font-size:10px;" title="选择图片后自动切换到贴图模式" /></div>
                    <div class="ag-row ag-row-3">
                        <span><label>位置 X (AU)</label><input id="ag-star-x" type="number" value="50" step="1" /></span>
                        <span><label>Y (AU)</label><input id="ag-star-y" type="number" value="0" step="1" /></span>
                        <span><label>Z (AU)</label><input id="ag-star-z" type="number" value="0" step="1" /></span>
                    </div>
                    <div class="ag-row"><label>详情数据</label>
                        <div class="ag-detail-field">
                            <button type="button" id="ag-star-detail-btn" class="ag-detail-manage-btn" title="打开文件夹式详情编译器">📁 编辑详情数据</button>
                            <span class="ag-detail-count" id="ag-star-detail-count">未配置</span>
                        </div>
                    </div>
                    <div class="ag-row"><label>地表图片</label>
                        <div class="ag-detail-field">
                            <button type="button" id="ag-star-surface-btn" class="ag-detail-manage-btn" title="上传该恒星的地表图片">🖼 管理地表图片</button>
                            <span class="ag-detail-count" id="ag-star-surface-count">未配置</span>
                        </div>
                    </div>
                    <div class="ag-row"><label>语音简介</label><textarea id="ag-star-voice" rows="1" placeholder="TTS 朗读文本（可选，留空自动生成）"></textarea></div>
                </div>
                <div class="ag-section">
                    <div class="ag-section-title">
                        <span>🪐 行星</span>
                        <button class="ag-add-planet-btn" id="ag-add-planet">+ 添加行星</button>
                    </div>
                    <div id="ag-planet-list">
                        <div class="ag-planet-empty">尚未添加行星，点击上方按钮添加</div>
                    </div>
                </div>
            </div>
            <div class="ag-preview-wrap">
                <div class="ag-preview-header">
                    <span>🔭 实时预览</span>
                    <button id="ag-preview-reset" type="button" title="重置视角">⟲</button>
                </div>
                <div class="ag-preview-canvas" id="ag-preview-canvas"></div>
                <div class="ag-preview-info" id="ag-preview-info">预览以恒星为原点 · 拖动可旋转视角</div>
            </div>
            </div>
            <div class="add-galaxy-footer">
                <button id="ag-draft" class="ag-draft-btn" type="button">💾 暂存到草稿箱</button>
                <button id="ag-confirm" class="ag-confirm-btn">🚀 直接发表</button>
            </div>
        </div>`;
    }

    // ==================== 保存/导入 ====================

    /** 打开保存面板 */
    _openSavePanel() {
        if (this.savePanel) {
            this.savePanel.classList.remove('hidden');
            this._renderSaveList();
        }
    }

    /** 渲染保存列表（含搜索过滤） */
    _renderSaveList() {
        if (!this.saveList) return;
        import('./galaxyRegistry.js?v=8').then(({ getAllGalaxies, fetchServerGalaxies }) => {
            const all = getAllGalaxies();
            const custom = all.filter(g => !g.isBuiltIn);
            const query = (this.saveSearch?.value || '').toLowerCase().trim();
            const filtered = query ? custom.filter(g => g.name.toLowerCase().includes(query) || g.nameCN.toLowerCase().includes(query)) : custom;
            if (filtered.length === 0) {
                this.saveList.innerHTML = '<div style="color:#667;text-align:center;padding:20px;font-size:12px;">无匹配星体系统</div>';
                return;
            }
            this.saveList.innerHTML = filtered.map(g => `
                <label style="display:flex;align-items:center;gap:8px;padding:6px 4px;cursor:pointer;border-bottom:1px solid rgba(0,243,255,0.05);font-size:13px;color:var(--fui-text-bright);">
                    <input type="checkbox" class="gb-save-checkbox" value="${g.id}" />
                    <span>${g.name} <small style="color:var(--fui-text-dim);">// ${g.nameCN}</small></span>
                </label>
            `).join('');
        });
    }

    /** 确认导出 */
    async _confirmExport() {
        const { exportGalaxiesOnServer } = await import('./galaxyRegistry.js?v=8');
        const checks = this.saveList?.querySelectorAll('.gb-save-checkbox:checked') || [];
        const ids = Array.from(checks).map(cb => cb.value);
        if (ids.length === 0) { alert('请至少选择一个星体系统'); return; }
        const result = await exportGalaxiesOnServer(ids);
        if (result.ok) {
            alert(`✅ 导出成功！\n文件: ${result.filename}\n路径: ${result.path}`);
            this.savePanel?.classList.add('hidden');
        } else {
            alert('❌ 导出失败: ' + (result.error || '未知错误'));
        }
    }

    /** 导入星系 */
    _importGalaxy() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.zip';
        input.style.display = 'none';
        input.addEventListener('change', async () => {
            const file = input.files?.[0];
            if (!file) return;
            const { importGalaxyOnServer, fetchServerGalaxies } = await import('./galaxyRegistry.js?v=8');
            const result = await importGalaxyOnServer(file);
            if (result.ok) {
                alert(`✅ 导入成功！\n导入星系: ${(result.imported || []).join(', ')}`);
                // 从数据库重新同步并实例化新导入的星系
                await this.restoreCustomGalaxies();
                this._renderList();
                if (this.onRefreshOrbits) this.onRefreshOrbits();
            } else {
                alert('❌ 导入失败: ' + (result.error || '未知错误'));
            }
            document.body.removeChild(input);
        });
        document.body.appendChild(input);
        input.click();
    }

    // ==================== 事件绑定 ====================
    _bindEvents() {
        // --- 打开/关闭 ---
        this.closeBtn.addEventListener('click', () => this.hide());
        this.backdrop.addEventListener('click', () => this.hide());

        // --- 搜索 ---
        this.searchEl.addEventListener('input', () => this._renderList());

        // --- 添加星系模态框 ---
        this.agClose.addEventListener('click', () => this._closeAddForm());
        this.agBackdrop.addEventListener('click', () => this._closeAddForm());
        this.agAddPlanet.addEventListener('click', () => this._addPlanetRow());
        this.agConfirm.addEventListener('click', () => this._confirmCreateGalaxy('publish'));
        this.agDraft?.addEventListener('click', () => this._confirmCreateGalaxy('draft'));

        // 星体关联：主动方固定为当前系统；新建时用表单内容构造临时系统，保存后一起提交
        this.addModal.querySelector('#ag-relations-btn')?.addEventListener('click', () => {
            this._openFormRelations();
        });

        // --- 所属星系 ---
        this.addModal.querySelector('#ag-universe-galaxy-search')?.addEventListener('input', (e) => {
            this._filterGalaxyOptions(e.target.value);
        });

        // 恒星详情文件夹编译器
        const starDetailBtn = this.addModal.querySelector('#ag-star-detail-btn');
        starDetailBtn?.addEventListener('click', () => {
            const starName = this.addModal.querySelector('#ag-star-name')?.value.trim() || '恒星';
            this._openDetailTreeEditor(this._editStarDetailTree, '恒星 · ' + starName, (tree) => {
                this._editStarDetailTree = tree;
                this._updateDetailTreeBadge(starDetailBtn, tree);
            });
        });

        // 恒星地表图片（专用文件夹）
        const starSurfaceBtn = this.addModal.querySelector('#ag-star-surface-btn');
        starSurfaceBtn?.addEventListener('click', () => {
            const starName = this.addModal.querySelector('#ag-star-name')?.value.trim() || '恒星';
            this._openDetailTreeEditor(this._editStarSurfaceTree, '恒星 · ' + starName, (tree) => {
                this._editStarSurfaceTree = tree;
                this._updateDetailTreeBadge(starSurfaceBtn, tree, 'surface');
            }, 'surface');
        });

        // --- 实时预览 ---
        this.agPreviewReset?.addEventListener('click', () => this._galaxyPreview?.resetView());
        this.addModal.addEventListener('input', () => this._schedulePreview());
        this.addModal.addEventListener('change', (e) => {
            // 选择图片后自动切换到“上传贴图”模式
            const input = e.target;
            if (input instanceof HTMLInputElement && input.type === 'file' && input.files?.[0]) {
                const scope = input.closest('.ag-planet-row') || input.closest('.ag-section');
                const appearance = scope?.querySelector('.ag-appearance');
                if (appearance) appearance.value = 'texture';
            }
            this._schedulePreview();
        });

        // --- 文件按钮：点击切换下拉菜单 ---
        const fileBtn = this.overlay.querySelector('#gb-file-btn');
        const fileDropdown = this.overlay.querySelector('#gb-file-dropdown');
        const savePanel = this.overlay.querySelector('#gb-save-panel');

        /** 定位下拉菜单到文件按钮下方 */
        const positionDropdown = () => {
            if (!fileBtn || !fileDropdown) return;
            const rect = fileBtn.getBoundingClientRect();
            fileDropdown.style.left = rect.left + 'px';
            fileDropdown.style.top = (rect.bottom + 2) + 'px';
        };
        /** 定位保存面板到文件按钮右侧 */
        const positionSavePanel = () => {
            if (!fileBtn || !savePanel) return;
            const rect = fileBtn.getBoundingClientRect();
            savePanel.style.left = (rect.right + 8) + 'px';
            savePanel.style.top = rect.top + 'px';
        };

        fileBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            const wasHidden = fileDropdown?.classList.contains('hidden');
            fileDropdown?.classList.add('hidden');
            if (savePanel) savePanel.classList.add('hidden');
            if (wasHidden) {
                positionDropdown();
                fileDropdown?.classList.remove('hidden');
            }
        });
        // 下拉项点击
        fileDropdown?.querySelectorAll('.gb-file-dropdown-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                fileDropdown?.classList.add('hidden');
                const action = item.dataset.action;
                if (action === 'save') {
                    positionSavePanel();
                    this._openSavePanel();
                } else if (action === 'import') {
                    this._importGalaxy();
                }
            });
        });
        // 点击页面其他位置关闭
        document.addEventListener('click', () => {
            fileDropdown?.classList.add('hidden');
        }, { capture: true });

        // --- 保存面板 ---
        this.savePanel = savePanel;
        this.saveSearch = this.overlay.querySelector('#gb-save-search');
        this.saveList = this.overlay.querySelector('#gb-save-list');
        this.saveConfirm = this.overlay.querySelector('#gb-save-confirm');
        this.saveSearch?.addEventListener('input', () => this._renderSaveList());
        this.saveConfirm?.addEventListener('click', (e) => {
            e.stopPropagation();
            this._confirmExport();
        });

        // --- ESC 关闭 ---
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (!this.addModal.classList.contains('hidden')) {
                    this.addModal.classList.add('hidden');
                } else if (this.savePanel && !this.savePanel.classList.contains('hidden')) {
                    this.savePanel.classList.add('hidden');
                } else if (!this.overlay.classList.contains('hidden')) {
                    this.hide();
                }
            }
        });

        // --- Glitch 按钮效果 ---
        this._setupGlitchEffect();
    }

    // ==================== 显示/隐藏 ====================
    show() {
        this.overlay.classList.remove('hidden');
        if (this.savePanel) this.savePanel.classList.add('hidden');
        // 每次打开都从“星系列表”开始
        this._dbGalaxyId = null;
        this.searchEl.value = '';
        this._renderList();
        this.searchEl.focus();
        // 拉取星系列表，用于在卡片上显示“所属星系”
        this._refreshUniverseGalaxies();
    }

    /** 刷新星系列表缓存（卡片上的“所属星系”用） */
    async _refreshUniverseGalaxies() {
        try {
            const list = await loadUniverseGalaxies();
            if (!Array.isArray(list) || !list.length) return;
            this._universeGalaxies = list;
            if (this.isVisible()) this._renderList();
        } catch { /* 服务器不可用时沿用旧缓存 */ }
    }

    hide() {
        this.overlay.classList.add('hidden');
    }

    isVisible() {
        return !this.overlay.classList.contains('hidden');
    }

    /**
     * 打开宇宙视图（全屏覆盖层）。
     * @param {object} [options]
     * @param {string} [options.galaxyId] — 直接进入指定星系
     * @param {boolean} [options.fromDb]  — 是否从星体数据库打开（关闭时回到数据库）
     */
    openUniverseView(options = {}) {
        if (options.fromDb !== undefined) {
            this._universeReturnToDb = !!options.fromDb;
        }
        this.hide();
        if (!this._universeView) {
            this._universeView = new UniverseView({
                onEnterSystem: (systemId) => this.onNavigateToGalaxy(systemId),
                onAddSystem: (galaxyId) => this._openAddSystemFromUniverse(galaxyId),
                onManageGalaxy: (galaxyId) => this._communityHandlers.onManageGalaxy?.(galaxyId),
                onRequireLogin: () => this._requireLogin(),
                onClose: () => {
                    if (this._universeReturnToDb) this.show();
                },
            });
        }
        this._universeView.open(options);
    }

    /** 打开星体级关联编辑器（星体数据库 / 宇宙视图共用） */
    _openBodyRelations(systemId = null, options = {}) {
        if (!this._bodyRelationEditor) {
            this._bodyRelationEditor = new BodyRelationEditor({
                onChanged: () => this._universeView?.refreshBodyRelations?.(),
            });
        }
        // 未指定时回落到主场景当前系统，保证默认选中的是“进入该模块的星体系统”
        this._bodyRelationEditor.open(
            systemId || this.systemManager?.getActiveSystemId?.() || null,
            options
        );
    }

    /** 星体编译器里的「编辑星体关联」：新建系统直接进入，无需先保存 */
    _openFormRelations() {
        const draftOptions = (draftSystem) => ({
            draftSystem,
            draftRelations: this._draftRelations,
            onDraftChange: (relations) => {
                this._draftRelations = relations;
                this._updateRelationsHint();
            },
        });

        if (this._editingGalaxy) {
            // 已保存的草稿仍按“未发布系统”处理，关联先暂存，保存时一起提交
            if ((this._editingGalaxy.status || 'approved') === 'draft') {
                this._openBodyRelations(
                    this._editingGalaxy.id,
                    draftOptions(this._galaxyToDraftSystem(this._editingGalaxy))
                );
            } else {
                this._openBodyRelations(this._editingGalaxy.id);
            }
            return;
        }
        this._openBodyRelations(DRAFT_SYSTEM_ID, draftOptions(this._buildDraftSystem()));
    }

    /** 把已保存的星系记录转成关联编辑器需要的临时系统结构 */
    _galaxyToDraftSystem(galaxy) {
        return {
            id: galaxy.id,
            name: galaxy.name || galaxy.id,
            isDraft: true,
            planets: (galaxy.planets || []).map(p => ({
                key: p.key,
                name: p.name || p.key,
                isStar: !!p.isStar,
            })),
        };
    }

    /** 用当前表单内容构造一个临时系统，供未保存时配置关联 */
    _buildDraftSystem() {
        const q = (sel) => this.addModal.querySelector(sel);
        const name = q('#ag-name')?.value.trim() || '未命名星体系统';
        const starName = q('#ag-star-name')?.value.trim() || '恒星';
        const planets = [{ key: DRAFT_SYSTEM_ID + '_star', name: starName, isStar: true }];
        this.agPlanetList?.querySelectorAll('.ag-planet-row').forEach((row, i) => {
            const pName = row.querySelector('.ag-p-name')?.value.trim() || `行星 ${i + 1}`;
            planets.push({ key: DRAFT_SYSTEM_ID + '_planet_' + i, name: pName, isStar: false });
        });
        return { id: DRAFT_SYSTEM_ID, name, planets };
    }

    /** 关联按钮旁的状态提示 */
    _updateRelationsHint() {
        const hint = this.addModal.querySelector('#ag-relations-hint');
        if (!hint) return;
        const count = this._draftRelations.length;
        if (this._editingGalaxy) {
            hint.textContent = count
                ? `${count} 条关联待保存`
                : (this._editingGalaxy.status === 'draft' ? '编辑草稿的关联' : '编辑当前系统的关联');
            return;
        }
        hint.textContent = count
            ? `${count} 条关联 · 保存后生效`
            : '可直接编辑，保存后生效';
    }

    /**
     * 把新建系统时暂存的关联转换到真实 id 后写入数据库。
     * 临时系统的星体 key 形如 __draft_system___star，
     * 转换后与 serverRecordToGalaxy 生成的 key 保持一致。
     */
    async _commitDraftRelations(systemId) {
        const pending = this._draftRelations;
        this._draftRelations = [];
        if (!systemId || !pending?.length) return;
        const remapId = (id) => (id === DRAFT_SYSTEM_ID ? systemId : id);
        const remapKey = (key) => (
            typeof key === 'string' && key.startsWith(DRAFT_SYSTEM_ID)
                ? systemId + key.slice(DRAFT_SYSTEM_ID.length)
                : key
        );
        for (const rel of pending) {
            const result = await saveBodyRelation({
                fromSystemId: remapId(rel.fromSystemId),
                fromKey: remapKey(rel.fromKey),
                fromName: rel.fromName,
                toSystemId: remapId(rel.toSystemId),
                toKey: remapKey(rel.toKey),
                toName: rel.toName,
            });
            if (!result?.ok) {
                console.warn('[GalaxyBrowser] 关联保存失败:', result?.error);
            }
        }
        this._universeView?.refreshBodyRelations?.();
    }

    /** 星系视图 → 新建星体系统：直接打开编译器，并预选目标星系（可为空） */
    _openAddSystemFromUniverse(galaxyId) {
        const user = getCurrentUser();
        if (!user) {
            this._requireLogin();
            return;
        }
        if (user.role === 'citizen') {
            const membership = getMembershipIds();
            if (galaxyId && !membership.has(galaxyId)) {
                showToast('请先加入该星系，再发布星体系统', 'info');
                return;
            }
            if (!galaxyId && membership.size === 0) {
                showToast('请先在宇宙视图中加入一个星系，再发布星体系统', 'info');
                return;
            }
        }
        this._pendingUniverseGalaxyId = galaxyId || null;
        this._pendingUniverseReturn = true;
        this._universeView?.close({ silent: true });
        this._openAddForm(null, galaxyId ? { galaxyId } : {});
    }

    /** 关闭编译器；若来自星系视图则返回该星系 */
    _closeAddForm() {
        this.addModal.classList.add('hidden');
        const pending = this._pendingUniverseGalaxyId;
        const fromUniverse = this._pendingUniverseReturn;
        this._pendingUniverseGalaxyId = null;
        this._pendingUniverseReturn = false;
        if (fromUniverse) {
            this.openUniverseView(pending ? { galaxyId: pending } : {});
        }
    }

    // ==================== 列表渲染 ====================

    /** 当前用户能否编辑该系统（开发者 / 系统所有者；管理员只能删不能改） */
    _canEditSystem(g) {
        const user = getCurrentUser();
        if (!user || !g || g.isBuiltIn) return false;
        if (user.role === 'developer') return true;
        return !!g.ownerUserId && g.ownerUserId === user.id;
    }

    /** 当前用户能否删除该系统（开发者 / 管理员 / 所有者） */
    _canDeleteSystem(g) {
        const user = getCurrentUser();
        if (!user || !g || g.isBuiltIn) return false;
        if (user.role === 'developer' || user.role === 'admin') return true;
        return !!g.ownerUserId && g.ownerUserId === user.id;
    }

    _renderList() {
        const query = this.searchEl.value.trim();
        // 草稿只出现在个人中心，不进入星体数据库 / 宇宙视图
        const visible = (g) => (g.status || 'approved') !== 'draft';
        const systems = getAllGalaxies().filter(visible);
        const galaxies = this._universeGalaxies;

        // 搜索：跨星系直接列出匹配的星体系统
        if (query) {
            this._renderSystemCards(searchGalaxies(query).filter(visible), { galaxies });
            return;
        }

        // 未选择星系：先展示星系（图标 + 名称）
        if (!this._dbGalaxyId) {
            this._renderGalaxyTiles(galaxies, systems);
            return;
        }

        const galaxy = galaxies.find(g => g.id === this._dbGalaxyId);
        if (!galaxy) {
            this._dbGalaxyId = null;
            this._renderGalaxyTiles(galaxies, systems);
            return;
        }
        const list = systems.filter(s => resolveSystemGalaxyId(s, galaxies) === galaxy.id);
        this._renderSystemCards(list, { galaxies, galaxy });
    }

    /** 第一层：星系列表（以星系图标为分类入口） */
    _renderGalaxyTiles(galaxies, systems) {
        if (!galaxies.length) {
            this.listEl.innerHTML = '<div class="galaxy-browser-empty">加载星系中…</div>';
            return;
        }

        const tiles = galaxies.map((g) => {
            const count = systems.filter(s => resolveSystemGalaxyId(s, galaxies) === g.id).length;
            const icon = g.iconSvg || DEFAULT_GALAXY_ICON;
            const commander = g.commanderName ? ` · 指挥官 ${escapeHtml(g.commanderName)}` : '';
            return `
                <button type="button" class="gb-galaxy-tile" data-galaxy-id="${_escapeAttr(g.id)}"
                        title="查看「${_escapeAttr(g.name)}」中的星体系统">
                    <span class="gb-galaxy-tile-icon-wrap">
                        <img class="gb-galaxy-tile-icon" src="${_escapeAttr(icon)}" alt="" />
                    </span>
                    <span class="gb-galaxy-tile-main">
                        <span class="gb-galaxy-tile-name">${escapeHtml(g.name)}
                            <small>${escapeHtml(g.nameCN || '')}</small></span>
                        <span class="gb-galaxy-tile-meta">${count} 个星体系统${commander}</span>
                    </span>
                    <span class="gb-galaxy-tile-arrow">→</span>
                </button>`;
        }).join('');

        this.listEl.innerHTML = `
            <div class="gb-db-hint">🌌 先选择星系，再查看其中的星体系统</div>
            <div class="gb-galaxy-grid">${tiles}</div>
        `;
        this.listEl.querySelectorAll('.gb-galaxy-tile').forEach((tile) => {
            tile.addEventListener('click', () => {
                this._dbGalaxyId = tile.dataset.galaxyId;
                this._renderList();
            });
        });
    }

    /** 第二层：某个星系内的星体系统（或搜索结果） */
    _renderSystemCards(list, { galaxies = [], galaxy = null } = {}) {
        const nav = galaxy ? `
            <div class="gb-db-nav">
                <button type="button" class="gb-db-back" data-gb-back>← 星系列表</button>
                <span class="gb-db-crumb">🌌 ${escapeHtml(galaxy.name)}
                    <small>${escapeHtml(galaxy.nameCN || '')}</small></span>
                <span class="gb-db-count">${list.length} 个星体系统</span>
            </div>` : '';

        const emptyText = galaxy
            ? '这个星系中还没有星体系统'
            : '未找到匹配的星体系统或星球';
        this.listEl.innerHTML = nav + (list.length
            ? list.map(g => this._renderGalaxyCard(g)).join('')
            : `<div class="galaxy-browser-empty">${emptyText}</div>`);

        this.listEl.querySelector('.gb-db-back')?.addEventListener('click', () => {
            this._dbGalaxyId = null;
            this.searchEl.value = '';
            this._renderList();
        });

        // 绑定点击事件
        this.listEl.querySelectorAll('.gb-galaxy-card').forEach(card => {
            const galaxyId = card.dataset.galaxyId;
            const galaxy = list.find(g => g.id === galaxyId);
            const canEdit = this._canEditSystem(galaxy);
            card.querySelector('.gb-galaxy-header')?.addEventListener('click', (e) => {
                if (e.target.closest('button')) return;
                if (galaxy && !galaxy.isBuiltIn) {
                    if (canEdit) {
                        // 用户星体系统：打开星体编译器，预填属性进行再次编译
                        this._openAddForm(galaxy);
                    } else {
                        // 无编辑权限：以只读方式进入该系统
                        this.onNavigateToGalaxy(galaxyId);
                        this.hide();
                    }
                } else {
                    this.onNavigateToGalaxy(galaxyId);
                    this.hide();
                }
            });

            // 自定义系统：点击卡片空白区域同样打开星体编译器（有权限时）
            if (galaxy && !galaxy.isBuiltIn && canEdit) {
                card.querySelector('.item-body')?.addEventListener('click', (e) => {
                    if (e.target.closest('.gb-planet-item') || e.target.closest('button')) return;
                    this._openAddForm(galaxy);
                });
            }
        });

        // ✎ 编辑（显式入口）
        this.listEl.querySelectorAll('.gb-edit-galaxy').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const galaxy = list.find(g => g.id === btn.dataset.galaxyId);
                if (galaxy) this._openAddForm(galaxy);
            });
        });

        // 🚀 单独进入系统
        this.listEl.querySelectorAll('.gb-enter-galaxy').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.onNavigateToGalaxy(btn.dataset.galaxyId);
                this.hide();
            });
        });

        this.listEl.querySelectorAll('.gb-planet-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const planetKey = item.dataset.planetKey;
                this.onFocusBody(planetKey);
                this.hide();
            });
        });

        // 删除自定义星系
        this.listEl.querySelectorAll('.gb-delete-galaxy').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const galaxy = list.find(g => g.id === btn.dataset.galaxyId);
                if (!galaxy || !this._canDeleteSystem(galaxy)) return;
                const tip = galaxy.status === 'rejected'
                    ? '确定要删除这个未通过的星体系统吗？'
                    : '确定要删除这个星体系统及其所有天体吗？';
                if (confirm(tip)) {
                    await this.deleteSystemById(galaxy.id, { silent: true });
                }
            });
        });
    }

    // ==================== 对外社区接口 ====================

    /** 打开指定星体系统的编译器（网站管理 / 个人中心使用） */
    async openSystemEditor(systemId) {
        const galaxy = getAllGalaxies().find(g => g.id === systemId);
        if (!galaxy) {
            showToast('未找到该星体系统', 'error');
            return false;
        }
        if (!this._canEditSystem(galaxy)) {
            showToast('你没有修改该星体系统的权限', 'error');
            return false;
        }
        await this._openAddForm(galaxy);
        return true;
    }

    /** 删除星体系统（服务器为准，随后清理本地缓存与场景） */
    async deleteSystemById(systemId, options = {}) {
        if (!systemId) return { ok: false, error: '缺少系统 id' };
        const res = await deleteGalaxyOnServer(systemId).catch(() => ({ ok: false, error: '服务器不可用' }));
        if (!res?.ok) {
            if (!options.silent) showToast(`删除失败：${res?.error || '服务器不可用'}`, 'error');
            return res || { ok: false, error: '服务器不可用' };
        }
        this._deleteGalaxyBodies(systemId);
        deleteCustomGalaxy(systemId);
        this._renderList();
        this._universeView?.refresh?.();
        if (!options.silent) showToast('星体系统已删除', 'success');
        return { ok: true };
    }

    /** 社区状态变化后刷新：重新拉取数据库记录并刷新界面 */
    async refreshCommunity() {
        try {
            await refreshSession(true);
            await loadCustomGalaxiesFromServer();
        } catch (e) {
            console.warn('[GalaxyBrowser] 刷新社区数据失败:', e?.message || e);
        }
        // 已被删除的系统：清掉场景实例与本地缓存
        const alive = new Set(getAllGalaxies().map(g => g.id));
        for (const entry of [...this._customBodies]) {
            if (!alive.has(entry.galaxyId)) this._deleteGalaxyBodies(entry.galaxyId);
        }
        // 新发布（含草稿转正）的系统补建场景实例
        this._instantiateMissingCustomGalaxies();
        this._renderList();
        this._refreshUniverseGalaxies();
        this._universeView?.refresh?.();
        this.onRefreshOrbits?.();
    }

    /** 发布草稿：个人中心「我的系统」中的“完成发布”按钮调用 */
    async publishDraft(systemId) {
        if (!systemId) return { ok: false, error: '缺少系统 id' };
        const res = await apiPost('/api/publish-system', { id: systemId })
            .catch(() => ({ ok: false, error: '服务器不可用' }));
        if (!res?.ok) return res || { ok: false, error: '服务器不可用' };
        try {
            await loadCustomGalaxiesFromServer();
        } catch (e) {
            console.warn('[GalaxyBrowser] 发布后刷新失败:', e?.message || e);
        }
        this._instantiateMissingCustomGalaxies();
        this._renderList();
        this._refreshUniverseGalaxies();
        this._universeView?.refresh?.();
        this.onRefreshOrbits?.();
        return res;
    }

    /** 星体系统所属星系的显示名 */
    _galaxyNameOf(system) {
        // 优先取数据库列 universeGalaxyId（星系被删除后系统会归入默认星系）
        const gid = resolveSystemGalaxyId(system, this._universeGalaxies);
        const galaxy = this._universeGalaxies.find(x => x.id === gid);
        if (galaxy) return galaxy.name;
        // 星系记录缺失（离线或刚被删除）时系统实际归入默认星系
        return DEFAULT_GALAXY_ID ? '银河系' : gid;
    }

    _renderGalaxyCard(g) {
        const planetCount = g.planets ? g.planets.length : 0;
        const starPlanet = g.planets?.find(p => p.isStar);
        const otherPlanets = g.planets?.filter(p => !p.isStar) || [];
        const galaxyName = this._galaxyNameOf(g);
        const canEdit = this._canEditSystem(g);
        const canDelete = this._canDeleteSystem(g);
        const status = g.status || 'approved';
        const isCustom = !g.isBuiltIn;
        const statusBadge = isCustom ? {
            pending: '<span class="gb-status is-pending" title="等待开发者审核">⏳ 审核中</span>',
            rejected: `<span class="gb-status is-rejected" title="${escapeHtml(g.reviewNote || '未通过审核')}">⛔ 未通过</span>`,
        }[status] || '<span class="gb-status is-approved">✅ 已通过</span>' : '';
        const ownerBadge = isCustom && g.ownerName
            ? `<span class="gb-owner" title="发布者">👤 ${escapeHtml(g.ownerName)}</span>`
            : '';
        const headerTip = !isCustom
            ? '点击进入该系统'
            : (canEdit ? '点击打开星体编译器' : '点击进入该系统（只读）');
        const reviewNote = isCustom && status === 'rejected'
            ? `<div class="gb-review-note">审核意见：${escapeHtml(g.reviewNote || '未通过审核，请修改后重新提交')}</div>`
            : '';

        return `
        <div class="fui-item gb-galaxy-card${status === 'rejected' ? ' is-rejected' : ''}" data-galaxy-id="${g.id}">
            <div class="item-header gb-galaxy-header" title="${headerTip}">
                <span class="gb-galaxy-icon">${g.icon || '🌟'}</span>
                <div class="item-info">
                    <span class="item-label">${g.name} <small style="color:var(--text-dim);font-size:12px;font-family:var(--font-body);">// ${g.nameCN}</small></span>
                    <span class="item-desc">${g.description}</span>
                </div>
                ${statusBadge}
                ${ownerBadge}
                <span class="gb-galaxy-parent" title="所属星系">🌌 ${escapeHtml(galaxyName)}</span>
                <span class="gb-galaxy-count">${planetCount} 天体</span>
                <span class="gb-custom-actions">
                    ${isCustom ? `
                    ${canEdit ? `<button class="gb-edit-galaxy" data-galaxy-id="${g.id}" title="编辑该系统">✎</button>` : ''}
                    <button class="gb-enter-galaxy" data-galaxy-id="${g.id}" title="进入该系统">🚀</button>
                    ${canDelete ? `<button class="gb-delete-galaxy" data-galaxy-id="${g.id}" title="删除该系统">✕</button>` : ''}` : ''}
                </span>
                ${g.isBuiltIn ? '<span class="gb-badge-builtin">BUILT_IN</span>' : ''}
            </div>
            ${reviewNote}
            <div class="item-body">
                <div class="subitems-grid gb-planet-list">
                    ${starPlanet ? `
                    <div class="subitem gb-planet-item" data-planet-key="${starPlanet.key}">
                        <span class="dot dot-star"></span>
                        <span class="sub-name">${starPlanet.name}</span>
                        <span class="sub-type">STAR</span>
                        <span class="sub-val">${(starPlanet.mass / 1e30).toFixed(1)} M☉</span>
                    </div>` : ''}
                    ${otherPlanets.map(p => `
                    <div class="subitem gb-planet-item" data-planet-key="${p.key}">
                        <span class="dot" style="background:${p.color}"></span>
                        <span class="sub-name">${p.name}</span>
                        <span class="sub-type">PLANET</span>
                        <span class="sub-val">${(p.mass / 1e24).toFixed(1)}e24 kg</span>
                    </div>`).join('')}
                </div>
            </div>
        </div>`;
    }

    // ==================== 星体编译器（新建 / 再次编译）====================
    async _openAddForm(galaxy = null, options = {}) {
        // 社区模式下所有写入都要求登录（服务器同样会校验）
        const user = getCurrentUser();
        if (!user) {
            this._requireLogin();
            return;
        }
        if (galaxy && !this._canEditSystem(galaxy)) {
            showToast(
                user.role === 'admin'
                    ? '管理员只能删除星体系统，不能修改'
                    : '只能编辑自己发布的星体系统',
                'error'
            );
            return;
        }
        if (!galaxy && user.role === 'citizen') {
            const membership = getMembershipIds();
            if (options.galaxyId && !membership.has(options.galaxyId)) {
                showToast('请先加入该星系，再发布星体系统', 'info');
                return;
            }
            if (!options.galaxyId && membership.size === 0) {
                showToast('请先在宇宙视图中加入一个星系，再发布星体系统', 'info');
                return;
            }
        }

        this._editingGalaxy = galaxy || null;
        const isEdit = !!galaxy;
        const isDraftEdit = isEdit && (galaxy.status || 'approved') === 'draft';
        const token = ++this._addFormToken;
        this._draftRelations = [];

        const title = this.addModal.querySelector('#ag-title-text');
        if (title) title.textContent = isEdit ? '✏️ 再次编译星体系统' : '➕ 星体编译器';
        if (this.agConfirm) {
            this.agConfirm.textContent = isDraftEdit
                ? '🚀 发布星体系统'
                : (isEdit ? '💾 保存星体系统' : '🚀 直接发表');
        }
        if (this.agDraft) {
            // 已被驳回 / 已通过的系统不需要草稿按钮；新建与草稿继续提供暂存
            this.agDraft.classList.toggle('hidden', isEdit && !isDraftEdit);
            this.agDraft.textContent = isDraftEdit ? '💾 保存草稿' : '💾 暂存到草稿箱';
        }
        this._updateRelationsHint();

        this._resetAddForm();
        this.addModal.classList.remove('hidden');
        this._ensurePreview();
        this._schedulePreview(true);

        await this._loadUniverseFields(galaxy, options.galaxyId);
        if (token !== this._addFormToken) return;
        if (isEdit) this._populateAddForm(galaxy);
        this._schedulePreview(true);
    }

    /** 新建模式：恢复所有字段默认值 */
    _resetAddForm() {
        const q = (sel) => this.addModal.querySelector(sel);
        q('#ag-name').value = '新星系';
        q('#ag-name-cn').value = 'New Galaxy';
        q('#ag-desc').value = '一个新的恒星系统';
        q('#ag-star-name').value = '新恒星';
        q('#ag-star-mass').value = String(1.989e30);
        q('#ag-star-radius').value = '696340';
        q('#ag-star-appearance').value = 'color';
        q('#ag-star-color').value = '#ffcc00';
        q('#ag-star-texture').value = '';
        q('#ag-star-x').value = '50';
        q('#ag-star-y').value = '0';
        q('#ag-star-z').value = '0';
        q('#ag-star-voice').value = '';
        this._editStarTexture = null;
        this._editStarTextureName = null;
        this._editStarDetailTree = null;
        this._editStarSurfaceTree = null;
        this._editStarDetails = '';
        this._updateDetailTreeBadge(this.addModal.querySelector('#ag-star-detail-btn'), null);
        this._updateDetailTreeBadge(this.addModal.querySelector('#ag-star-surface-btn'), null, 'surface');

        q('#ag-universe-galaxy-search').value = '';

        this.agPlanetList.innerHTML = '<div class="ag-planet-empty">尚未添加行星，点击上方按钮添加</div>';
        this._planetRowCounter = 0;
    }

    /** 加载“所属星系”下拉框 */
    async _loadUniverseFields(galaxy = null, presetGalaxyId = null) {
        const select = this.addModal.querySelector('#ag-universe-galaxy');
        if (!select) return;

        this._universeGalaxies = await loadUniverseGalaxies();
        if (!this._universeGalaxies.length) {
            this._universeGalaxies = [{
                id: DEFAULT_GALAXY_ID, name: '银河系', nameCN: 'Milky Way', isDefault: true,
            }];
        }

        const wanted = galaxy
            ? getSystemGalaxyId(galaxy)
            : (presetGalaxyId || DEFAULT_GALAXY_ID);

        // 星际公民只能把系统发布到已加入的星系；管理员 / 开发者不受限制。
        // 编辑已有系统时始终保留它原来的所属星系，避免因退群而无法保存。
        const user = getCurrentUser();
        let selectable = this._universeGalaxies;
        if (user?.role === 'citizen') {
            const membership = getMembershipIds();
            selectable = this._universeGalaxies.filter(g => membership.has(g.id) || g.id === wanted);
        }
        this._selectableGalaxies = selectable;

        if (!selectable.length) {
            select.innerHTML = '<option value="">尚未加入任何星系</option>';
            select.value = '';
            const galaxySearch = this.addModal.querySelector('#ag-universe-galaxy-search');
            if (galaxySearch) galaxySearch.value = '';
            return;
        }

        select.innerHTML = selectable.map(g => this._galaxyOptionHtml(g)).join('');
        select.value = selectable.some(g => g.id === wanted) ? wanted : selectable[0].id;

        const galaxySearch = this.addModal.querySelector('#ag-universe-galaxy-search');
        if (galaxySearch) galaxySearch.value = '';
    }

    _galaxyOptionHtml(g) {
        return `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}${g.isDefault ? '（默认）' : ''}</option>`;
    }

    /** 按关键词过滤“所属星系”下拉项（保留当前选择） */
    _filterGalaxyOptions(query) {
        const select = this.addModal.querySelector('#ag-universe-galaxy');
        if (!select) return;
        const q = String(query || '').trim().toLowerCase();
        const current = select.value;
        const pool = this._selectableGalaxies || this._universeGalaxies;
        if (!pool.length) return;
        const list = q
            ? pool.filter(g =>
                `${g.name || ''} ${g.nameCN || ''} ${g.id || ''}`.toLowerCase().includes(q))
            : pool;

        select.innerHTML = list.map(g => this._galaxyOptionHtml(g)).join('');
        // 当前选中项被过滤掉时补回，避免搜索时悄悄改掉用户的选择
        if (current && !list.some(g => g.id === current)) {
            const cur = pool.find(g => g.id === current);
            if (cur) select.insertAdjacentHTML('afterbegin', this._galaxyOptionHtml(cur));
        }
        if (current) select.value = current;
    }

    /** 再次编译模式：用数据库中已有的系统数据预填表单 */
    _populateAddForm(galaxy) {
        const q = (sel) => this.addModal.querySelector(sel);
        const starInfo = galaxy.planets?.find(p => p.isStar);
        q('#ag-name').value = galaxy.name || '';
        q('#ag-name-cn').value = galaxy.nameCN || '';
        q('#ag-desc').value = galaxy.description || '';

        if (starInfo) {
            const siPos = starInfo._siPosition || {
                x: starInfo.orbitRadius || 50 * AU, y: 0, z: 0,
            };
            q('#ag-star-name').value = starInfo.name || '恒星';
            q('#ag-star-mass').value = String(starInfo.mass || 1.989e30);
            q('#ag-star-radius').value = String((starInfo.radius || 696340000) / 1000);
            q('#ag-star-appearance').value = starInfo.texturePath ? 'texture' : 'color';
            q('#ag-star-color').value = this._toHexColor(starInfo.color, '#ffcc00');
            q('#ag-star-x').value = String((siPos.x || 0) / AU);
            q('#ag-star-y').value = String((siPos.y || 0) / AU);
            q('#ag-star-z').value = String((siPos.z || 0) / AU);
            q('#ag-star-voice').value = starInfo.voiceIntro || '';
            this._editStarTexture = starInfo.texturePath || null;
            this._editStarTextureName = starInfo.textureName || null;
            this._editStarDetailTree = starInfo.detailTree || null;
            this._editStarSurfaceTree = starInfo.surfaceTree || null;
            this._editStarDetails = starInfo.details || '';
            this._updateDetailTreeBadge(q('#ag-star-detail-btn'), this._editStarDetailTree);
            this._updateDetailTreeBadge(q('#ag-star-surface-btn'), this._editStarSurfaceTree, 'surface');
        }

        (galaxy.planets || []).filter(p => !p.isStar).forEach(p => this._addPlanetRow(p));
    }

    /** 任意颜色表示（#hex / 0xrrggbb）→ #rrggbb */
    _toHexColor(c, fallback = '#ffffff') {
        if (!c) return fallback;
        if (typeof c === 'string' && c.startsWith('#')) return c;
        return '#' + new THREE.Color(c).getHexString();
    }

    // ==================== 文件夹式详情编译器 ====================

    _ensureDetailEditor() {
        if (!this._detailEditor) {
            this._detailEditor = new DetailTreeEditor({
                onSave: (tree) => {
                    const cb = this._detailSaveCallback;
                    this._detailSaveCallback = null;
                    if (cb) cb(tree);
                },
            });
        }
        return this._detailEditor;
    }

    /**
     * 打开详情编译器
     * @param {Array|null} tree - 已有文件夹树
     * @param {string} title
     * @param {function} onSave - 保存回调 (tree) => void
     * @param {'detail'|'surface'} [mode] - surface：仅一个地表图片文件夹
     */
    _openDetailTreeEditor(tree, title, onSave, mode = 'detail') {
        this._detailSaveCallback = onSave;
        this._ensureDetailEditor().open(tree, title, { mode });
    }

    /** 详情/地表按钮旁的计数，提示用户已配置 */
    _updateDetailTreeBadge(btn, tree, kind = 'detail') {
        if (!btn) return;
        const isSurface = kind === 'surface';
        const count = this._countDetailFiles(tree);
        btn.classList.toggle('has-tree', count > 0);
        btn.title = count > 0
            ? (isSurface ? `已配置 ${count} 张地表图片，点击编辑` : `已配置 ${count} 个详情文件，点击编辑`)
            : (isSurface ? '管理地表图片' : '打开文件夹式详情编译器');
        const status = btn.parentElement?.querySelector('.ag-detail-count');
        if (status) {
            status.textContent = count > 0
                ? `${count} ${isSurface ? '张图片' : '个文件'}`
                : '未配置';
            status.classList.toggle('has-tree', count > 0);
        }
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

    // ==================== 实时预览 ====================

    _ensurePreview() {
        if (this._galaxyPreview || !this.agPreviewCanvas) return;
        this._galaxyPreview = new GalaxyPreview(this.agPreviewCanvas);
    }

    /** 合并短时间内的多次输入，避免每次按键都重建场景 */
    _schedulePreview(immediate = false) {
        if (!this.addModal || this.addModal.classList.contains('hidden')) return;
        if (this._previewTimer) clearTimeout(this._previewTimer);
        this._previewTimer = setTimeout(() => {
            this._previewTimer = null;
            this._updatePreview();
        }, immediate ? 0 : 80);
    }

    _updatePreview() {
        this._ensurePreview();
        if (!this._galaxyPreview) return;

        const data = this._collectPreviewData();
        this._galaxyPreview.update(data);

        if (this.agPreviewInfo) {
            this.agPreviewInfo.textContent =
                `☀️ ${data.star.name} · 🪐 ${data.planets.length} 颗行星 · 恒星为原点 · 拖动旋转`;
        }
    }

    _collectPreviewData() {
        const numberIn = (row, selector, fallback) => {
            const n = parseFloat(row?.querySelector(selector)?.value);
            return Number.isFinite(n) ? n : fallback;
        };

        const starName = this.addModal.querySelector('#ag-star-name')?.value.trim() || '恒星';
        const starRadiusKm = numberIn(this.addModal, '#ag-star-radius', 696340);
        const starColor = this.addModal.querySelector('#ag-star-color')?.value || '#ffcc00';
        const starUseTexture = this.addModal.querySelector('#ag-star-appearance')?.value === 'texture';

        const planets = Array.from(this.agPlanetList.querySelectorAll('.ag-planet-row')).map(row => {
            const useTexture = row.querySelector('.ag-p-appearance')?.value === 'texture';
            return {
                orbitAU: Math.max(numberIn(row, '.ag-p-orbit', 1), 0.02),
                visualRadius: this._visualRadiusFromKm(numberIn(row, '.ag-p-radius', 6371)),
                color: row.querySelector('.ag-p-color')?.value || '#ff8844',
                textureUrl: useTexture ? this._previewTextureUrl(row.querySelector('.ag-p-texture')) : null,
            };
        });

        return {
            star: {
                name: starName,
                visualRadius: this._visualRadiusFromKm(starRadiusKm),
                color: starColor,
                textureUrl: starUseTexture
                    ? this._previewTextureUrl(this.addModal.querySelector('#ag-star-texture'))
                    : null,
            },
            planets,
        };
    }

    /** 为预览生成（并复用）上传图片的 object URL */
    _previewTextureUrl(input) {
        const file = input?.files?.[0];
        if (!file) return null;
        const cached = this._previewTextureUrls.get(input);
        if (cached && cached.file === file) return cached.url;
        if (cached) URL.revokeObjectURL(cached.url);
        const url = URL.createObjectURL(file);
        this._previewTextureUrls.set(input, { file, url });
        return url;
    }

    _addPlanetRow(pData = null) {
        this._planetRowCounter++;
        const idx = this._planetRowCounter;
        const row = document.createElement('div');
        row.className = 'ag-planet-row';
        row.dataset.planetIdx = idx;
        row.innerHTML = `
            <div class="ag-planet-row-header">
                <span>🪐 行星 #${idx}</span>
                <button class="ag-remove-planet" data-idx="${idx}">✕</button>
            </div>
            <div class="ag-row"><label>名称</label><input class="ag-p-name" value="行星${idx}" /></div>
            <div class="ag-row"><label>质量 (kg)</label><input class="ag-p-mass" type="number" value="5.97e24" step="any" /></div>
            <div class="ag-row"><label>半径 (km)</label><input class="ag-p-radius" type="number" value="6371" step="any" /></div>
            <div class="ag-row"><label>轨道半径 (AU)</label><input class="ag-p-orbit" type="number" value="${(idx * 0.5 + 1).toFixed(1)}" step="0.1" min="0.1" /></div>
            <div class="ag-row"><label>外观</label>
                <select class="ag-p-appearance ag-appearance">
                    <option value="color">纯色球</option>
                    <option value="texture">上传贴图</option>
                </select>
            </div>
            <div class="ag-row"><label>颜色</label><input class="ag-p-color" type="color" value="${this._randomPlanetColor()}" /></div>
            <div class="ag-row"><label>贴图</label><input class="ag-p-texture" type="file" accept="image/*" style="font-size:10px;" title="选择图片后自动切换到贴图模式" /></div>
            <div class="ag-row"><label>详情数据</label>
                <div class="ag-detail-field">
                    <button type="button" class="ag-detail-manage-btn ag-p-detail-btn" title="打开文件夹式详情编译器">📁 编辑详情数据</button>
                    <span class="ag-detail-count">未配置</span>
                </div>
            </div>
            <div class="ag-row"><label>地表图片</label>
                <div class="ag-detail-field">
                    <button type="button" class="ag-detail-manage-btn ag-p-surface-btn" title="上传该行星的地表图片">🖼 管理地表图片</button>
                    <span class="ag-detail-count">未配置</span>
                </div>
            </div>
            <div class="ag-row"><label>语音简介</label><textarea class="ag-p-voice" rows="1" placeholder="TTS 朗读文本（可选，留空自动生成）"></textarea></div>
            <div class="ag-moon-toggle-wrap">
                <button class="ag-moon-toggle-btn" type="button">🌙 卫星管理 <span class="ag-moon-arrow">▸</span></button>
            </div>
            <div class="ag-moon-section hidden">
                <div class="ag-moon-header">
                    <span>🛰️ 卫星列表</span>
                    <button class="ag-add-moon-btn" type="button">+ 添加卫星</button>
                </div>
                <div class="ag-moon-list" data-planet-idx="${idx}">
                    <div class="ag-moon-empty">尚未添加卫星，点击上方按钮添加</div>
                </div>
            </div>
        `;
        const empty = this.agPlanetList.querySelector('.ag-planet-empty');
        if (empty) empty.remove();

        // 再次编译：用数据库里的行星属性预填（贴图无法回填到 file input，
        // 因此单独保存原贴图数据，保存时若未选择新文件则沿用）
        row._textureData = pData ? (pData.texturePath || null) : null;
        row._textureName = pData ? (pData.textureName || null) : null;
        row._detailTree = pData ? (pData.detailTree || null) : null;
        row._surfaceTree = pData ? (pData.surfaceTree || null) : null;
        row._details = pData ? (pData.details || '') : ''; // 旧版纯文本详情（只读保留）
        // 行星详情文件夹编译器
        const pDetailBtn = row.querySelector('.ag-p-detail-btn');
        this._updateDetailTreeBadge(pDetailBtn, row._detailTree);
        pDetailBtn.addEventListener('click', () => {
            const pName = row.querySelector('.ag-p-name')?.value.trim() || '行星';
            this._openDetailTreeEditor(row._detailTree, '行星 · ' + pName, (tree) => {
                row._detailTree = tree;
                this._updateDetailTreeBadge(pDetailBtn, tree);
            });
        });
        // 行星地表图片（专用文件夹）
        const pSurfaceBtn = row.querySelector('.ag-p-surface-btn');
        this._updateDetailTreeBadge(pSurfaceBtn, row._surfaceTree, 'surface');
        pSurfaceBtn.addEventListener('click', () => {
            const pName = row.querySelector('.ag-p-name')?.value.trim() || '行星';
            this._openDetailTreeEditor(row._surfaceTree, '行星 · ' + pName, (tree) => {
                row._surfaceTree = tree;
                this._updateDetailTreeBadge(pSurfaceBtn, tree, 'surface');
            }, 'surface');
        });
        if (pData) {
            row.querySelector('.ag-p-name').value = pData.name || '行星';
            row.querySelector('.ag-p-mass').value = String(pData.mass || 5.97e24);
            row.querySelector('.ag-p-radius').value = String((pData.radius || 6371000) / 1000);
            row.querySelector('.ag-p-orbit').value = String((pData.orbitRadius || AU) / AU);
            row.querySelector('.ag-p-appearance').value = pData.texturePath ? 'texture' : 'color';
            row.querySelector('.ag-p-color').value = this._toHexColor(pData.color, '#ff8844');
            row.querySelector('.ag-p-voice').value = pData.voiceIntro || '';
        }

        this.agPlanetList.appendChild(row);
        this._schedulePreview();

        // 删除按钮
        row.querySelector('.ag-remove-planet').addEventListener('click', () => {
            row.remove();
            if (this.agPlanetList.children.length === 0) {
                this.agPlanetList.innerHTML = '<div class="ag-planet-empty">尚未添加行星，点击上方按钮添加</div>';
            }
            this._schedulePreview(true);
        });

        // 卫星展开/收起
        const toggleBtn = row.querySelector('.ag-moon-toggle-btn');
        const moonSection = row.querySelector('.ag-moon-section');
        toggleBtn.addEventListener('click', () => {
            moonSection.classList.toggle('hidden');
            toggleBtn.querySelector('.ag-moon-arrow').textContent = moonSection.classList.contains('hidden') ? '▸' : '▾';
        });

        // 添加卫星
        const addMoonBtn = row.querySelector('.ag-add-moon-btn');
        const moonList = row.querySelector('.ag-moon-list');
        let moonCounter = 0;
        addMoonBtn.addEventListener('click', () => {
            moonCounter++;
            const emptyMoon = moonList.querySelector('.ag-moon-empty');
            if (emptyMoon) emptyMoon.remove();
            const moonRow = document.createElement('div');
            moonRow.className = 'ag-moon-row';
            moonRow.innerHTML = `
                <div class="ag-moon-row-header">
                    <span>🛰️ 卫星 #${moonCounter}</span>
                    <button class="ag-remove-moon" type="button">✕</button>
                </div>
                <div class="ag-row"><label>名称</label><input class="ag-m-name" value="卫星${moonCounter}" /></div>
                <div class="ag-row"><label>质量 (kg)</label><input class="ag-m-mass" type="number" value="7.35e22" step="any" /></div>
                <div class="ag-row"><label>半径 (km)</label><input class="ag-m-radius" type="number" value="1737" step="any" /></div>
                <div class="ag-row"><label>轨道半径 (场景单位)</label><input class="ag-m-orbit" type="number" value="3.8" step="0.1" min="0.1" /></div>
                <div class="ag-row"><label>轨道速度</label><input class="ag-m-speed" type="number" value="1.0" step="0.1" min="0.1" /></div>
                <div class="ag-row"><label>颜色</label><input class="ag-m-color" type="color" value="#aaaaaa" /></div>
                <div class="ag-row"><label>详情数据</label>
                    <div class="ag-detail-field">
                        <button type="button" class="ag-detail-manage-btn ag-m-detail-btn" title="打开文件夹式详情编译器">📁 编辑详情数据</button>
                        <span class="ag-detail-count">未配置</span>
                    </div>
                </div>
                <div class="ag-row"><label>地表图片</label>
                    <div class="ag-detail-field">
                        <button type="button" class="ag-detail-manage-btn ag-m-surface-btn" title="上传该卫星的地表图片">🖼 管理地表图片</button>
                        <span class="ag-detail-count">未配置</span>
                    </div>
                </div>
            `;
            moonRow._detailTree = null;
            moonRow._surfaceTree = null;
            moonRow._details = '';
            const mDetailBtn = moonRow.querySelector('.ag-m-detail-btn');
            this._updateDetailTreeBadge(mDetailBtn, null);
            mDetailBtn.addEventListener('click', () => {
                const mName = moonRow.querySelector('.ag-m-name')?.value.trim() || '卫星';
                this._openDetailTreeEditor(moonRow._detailTree, '卫星 · ' + mName, (tree) => {
                    moonRow._detailTree = tree;
                    this._updateDetailTreeBadge(mDetailBtn, tree);
                });
            });
            const mSurfaceBtn = moonRow.querySelector('.ag-m-surface-btn');
            this._updateDetailTreeBadge(mSurfaceBtn, null, 'surface');
            mSurfaceBtn.addEventListener('click', () => {
                const mName = moonRow.querySelector('.ag-m-name')?.value.trim() || '卫星';
                this._openDetailTreeEditor(moonRow._surfaceTree, '卫星 · ' + mName, (tree) => {
                    moonRow._surfaceTree = tree;
                    this._updateDetailTreeBadge(mSurfaceBtn, tree, 'surface');
                }, 'surface');
            });
            moonRow.querySelector('.ag-remove-moon').addEventListener('click', () => {
                moonRow.remove();
                if (moonList.querySelectorAll('.ag-moon-row').length === 0) {
                    moonList.innerHTML = '<div class="ag-moon-empty">尚未添加卫星，点击上方按钮添加</div>';
                }
            });
            moonList.appendChild(moonRow);
        });

        // 再次编译：恢复该行星已有的卫星列表
        if (pData?.moons?.length) {
            pData.moons.forEach(m => {
                addMoonBtn.click();
                const mRow = moonList.lastElementChild;
                if (!mRow || !mRow.classList.contains('ag-moon-row')) return;
                mRow.querySelector('.ag-m-name').value = m.name || '';
                mRow.querySelector('.ag-m-mass').value = String(m.mass || 7.35e22);
                mRow.querySelector('.ag-m-radius').value = String(m.radius || 1737);
                mRow.querySelector('.ag-m-orbit').value = String(m.orbitRadius || 3.8);
                mRow.querySelector('.ag-m-speed').value = String(m.orbitSpeed || 1.0);
                mRow.querySelector('.ag-m-color').value = this._toHexColor(m.color, '#aaaaaa');
                mRow._detailTree = m.detailTree || null;
                mRow._surfaceTree = m.surfaceTree || null;
                mRow._details = m.details || '';
                this._updateDetailTreeBadge(mRow.querySelector('.ag-m-detail-btn'), mRow._detailTree);
                this._updateDetailTreeBadge(mRow.querySelector('.ag-m-surface-btn'), mRow._surfaceTree, 'surface');
            });
            moonSection.classList.remove('hidden');
            toggleBtn.querySelector('.ag-moon-arrow').textContent = '▾';
        }
    }

    /**
     * 由半径（km）换算视觉大小（场景单位）
     * 使用平方根缩放：恒星 696340km → ≈5.0，地球 6371km → ≈0.48，
     * 与原先“视觉大小”默认值一致，避免视觉上比例失衡
     */
    _visualRadiusFromKm(km) {
        return Math.max(0.05, 0.006 * Math.sqrt(Math.max(Number(km) || 1, 1)));
    }

    _randomPlanetColor() {
        const colors = ['#e07040', '#4488ff', '#d4b896', '#e8d5a3', '#7ec8e3', '#4060ff', '#b0b0b0', '#e8cda0', '#88cc88', '#cc88cc'];
        return colors[Math.floor(Math.random() * colors.length)];
    }

    async _confirmCreateGalaxy(mode = 'publish') {
        const asDraft = mode === 'draft';
        // --- 读取星系信息（强制填写名称和英文名）---
        const galaxyName   = document.getElementById('ag-name').value.trim();
        const galaxyNameCN = document.getElementById('ag-name-cn').value.trim();
        const galaxyDesc   = document.getElementById('ag-desc').value.trim() || '';
        if (!galaxyName) { alert('⚠️ 请填写星体系统名称'); return; }
        if (!galaxyNameCN) { alert('⚠️ 请填写英文名（用于文件夹命名）'); return; }

        // --- 读取恒星信息 ---
        const starName  = document.getElementById('ag-star-name').value.trim() || '新恒星';
        const starMass  = parseFloat(document.getElementById('ag-star-mass').value) || 1.989e30;
        const starRadius = parseFloat(document.getElementById('ag-star-radius').value) || 696340;
        const starColor = document.getElementById('ag-star-color').value || '#ffcc00';
        const starVisual = this._visualRadiusFromKm(starRadius);
        // 注意：位置 0 是合法值，不能把 0 当成空值回退到 50
        const numOr = (id, fallback) => {
            const n = parseFloat(document.getElementById(id)?.value);
            return Number.isFinite(n) ? n : fallback;
        };
        const starPosX  = numOr('ag-star-x', 50);
        const starPosY  = numOr('ag-star-y', 0);
        const starPosZ  = numOr('ag-star-z', 0);
        // 恒星外观：纯色球 / 上传贴图（二选一）
        const starAppearance = document.getElementById('ag-star-appearance')?.value || 'color';
        const starTexFile = starAppearance === 'texture'
            ? document.getElementById('ag-star-texture')?.files?.[0]
            : null;
        const starTexFileBase64 = await this._fileToBase64(starTexFile);
        // 再次编译时未选择新贴图 → 沿用原贴图数据
        const starTexBase64 = starTexFileBase64
            || (starAppearance === 'texture' ? (this._editStarTexture || null) : null);
        const starTexName = starTexFile?.name || this._editStarTextureName || null;

        // 恒星详情文本已由文件夹式详情数据取代；旧文本只读保留
        const starVoiceInput   = document.getElementById('ag-star-voice');
        const starUserDetails  = (this._editStarDetails || '').trim();
        const starUserVoice    = starVoiceInput ? starVoiceInput.value.trim() : '';
        // 自动生成恒星物理描述
        const autoStarDetails = `${starName} — ${galaxyName}的中心恒星。质量${(starMass / 1e30).toFixed(2)}×10³⁰kg(${(starMass / 1.989e30).toFixed(2)}M☉)，半径${(starRadius).toFixed(0)}km。`;
        const autoStarVoice   = `${starName}，${galaxyName}的中心恒星。`;

        // --- 读取行星信息 ---
        const planetEntries = [];
        const planetRows = this.agPlanetList.querySelectorAll('.ag-planet-row');
        for (const row of planetRows) {
            const pName   = row.querySelector('.ag-p-name').value.trim() || '行星';
            const pMass   = parseFloat(row.querySelector('.ag-p-mass').value) || 5.97e24;
            const pRadius = parseFloat(row.querySelector('.ag-p-radius').value) || 6371;
            const pOrbit  = parseFloat(row.querySelector('.ag-p-orbit').value) || 1.0;
            const pColor  = row.querySelector('.ag-p-color').value || '#ff8844';
            const pVisual = this._visualRadiusFromKm(pRadius);
            // 行星外观：纯色球 / 上传贴图（二选一）
            const pAppearance = row.querySelector('.ag-p-appearance')?.value || 'color';
            const pTexFile = pAppearance === 'texture'
                ? row.querySelector('.ag-p-texture')?.files?.[0]
                : null;
            const pTexFileBase64 = await this._fileToBase64(pTexFile);
            // 再次编译时未选择新贴图 → 沿用该行原有的贴图数据
            const pTexBase64 = pTexFileBase64
                || (pAppearance === 'texture' ? (row._textureData || null) : null);
            const pTexName = pTexFile?.name || row._textureName || null;

            // 详情文本已由文件夹式详情数据取代；旧文本只读保留
            const pVoiceEl   = row.querySelector('.ag-p-voice');
            const pUserDetails = (row._details || '').trim();
            const pUserVoice   = pVoiceEl ? pVoiceEl.value.trim() : '';
            const pIdx = planetEntries.length + 1;
            // 自动生成物理描述
            const autoDetails = `${pName} — ${galaxyName}的第${pIdx}颗行星。${pMass > 1e27 ? '气态巨行星' : pMass > 1e25 ? '类地行星' : '小型天体'}。` +
                          `质量${(pMass / 1e24).toFixed(2)}×10²⁴kg，半径${pRadius}km，轨道半径${pOrbit}AU。`;
            const autoVoice = `${pName}，行星，距恒星${pOrbit}天文单位。`;

            // 读取该行星的卫星数据
            const moonList = row.querySelector('.ag-moon-list');
            const moons = [];
            if (moonList) {
                moonList.querySelectorAll('.ag-moon-row').forEach(mRow => {
                    moons.push({
                        name: (mRow.querySelector('.ag-m-name')?.value || '').trim() || '卫星',
                        mass: parseFloat(mRow.querySelector('.ag-m-mass')?.value) || 7.35e22,
                        radius: parseFloat(mRow.querySelector('.ag-m-radius')?.value) || 1737,
                        orbitRadius: parseFloat(mRow.querySelector('.ag-m-orbit')?.value) || 3.8,
                        orbitSpeed: parseFloat(mRow.querySelector('.ag-m-speed')?.value) || 1.0,
                        color: mRow.querySelector('.ag-m-color')?.value || '#aaaaaa',
                        details: (mRow._details || '').trim(),
                        detailTree: mRow._detailTree || null,
                        surfaceTree: mRow._surfaceTree || null,
                    });
                });
            }

            planetEntries.push({
                name: pName,
                mass: pMass,
                radius: pRadius * 1000,
                orbitRadius: pOrbit * AU,
                visualRadius: pVisual,
                color: pColor,
                appearance: pAppearance,
                textureData: pTexBase64 || null,
                textureName: pTexName,
                details: pUserDetails || autoDetails,
                detailTree: row._detailTree || null,
                surfaceTree: row._surfaceTree || null,
                voiceIntro: pUserVoice || autoVoice,
                moons: moons, // 卫星列表（持久化存储）
            });
        }

        // --- 所属星系 ---
        // 关联的最小单位已改为“星体”，旧的系统级关联只作为兼容数据原样保留。
        const universeGalaxyId = this.addModal.querySelector('#ag-universe-galaxy')?.value || '';
        if (!universeGalaxyId) {
            alert('⚠️ 请先在宇宙视图中加入一个星系，再发布星体系统');
            return;
        }
        const relatedSystemIds = this._editingGalaxy
            ? getSystemRelatedIds(this._editingGalaxy)
            : [];
        const universe = { galaxyId: universeGalaxyId, relatedSystemIds };

        const isEdit = !!this._editingGalaxy;
        const galaxyPayload = {
            name: galaxyName,
            nameCN: galaxyNameCN,
            description: galaxyDesc,
            universe,
            star: {
                name: starName,
                mass: starMass,
                radius: starRadius * 1000,
                color: starColor,
                visualRadius: starVisual,
                appearance: starAppearance,
                x: starPosX,
                y: starPosY,
                z: starPosZ,
                textureData: starTexBase64 || null,
                textureName: starTexName,
                details: starUserDetails || autoStarDetails,
                detailTree: this._editStarDetailTree || null,
                surfaceTree: this._editStarSurfaceTree || null,
                voiceIntro: starUserVoice || autoStarVoice,
            },
            planets: planetEntries,
        };

        // --- 文件夹名：新建时由英文名生成；再次编译沿用原 id ---
        let folderId = isEdit ? this._editingGalaxy.id : '';
        if (!isEdit) {
            folderId = (galaxyNameCN || galaxyName)
                .toLowerCase()
                .replace(/[^a-z0-9一-鿿]+/g, '_')
                .replace(/^_|_$/g, '')
                .slice(0, 60) || 'galaxy_' + Date.now();

            // 同名检测（Galaxy/ + Galaxy/custom/ 下所有文件夹名）
            const existingIds = getAllGalaxies().map(g => g.id);
            if (existingIds.includes(folderId)) {
                alert(`⚠️ 星体系统 "${galaxyNameCN || galaxyName}" 已存在，请使用不同的英文名`);
                return;
            }
        }

        // --- 服务器写入：新建文件夹 或 覆盖更新已有星系 ---
        const serverResult = isEdit
            ? await updateGalaxyOnServer({ id: folderId, ...galaxyPayload, draft: asDraft })
            : await createGalaxyOnServer({ id: folderId, ...galaxyPayload, draft: asDraft });

        if (!serverResult?.ok) {
            // 社区模式下服务器是权威来源：写入失败（未登录 / 无权限 / 服务器不可用）
            // 时不能悄悄退化为本地保存，否则数据会在刷新后丢失。
            const msg = serverResult?.error || '服务器不可用';
            console.warn(`[GalaxyBrowser] 服务器${isEdit ? '更新' : '创建'}失败:`, msg);
            showToast(`${isEdit ? '保存' : '发布'}失败：${msg}`, 'error');
            return;
        }
        const serverOk = true;
        const galaxyId = serverResult.id || folderId;
        const savedAsDraft = (serverResult.status || '') === 'draft';
        if (serverResult.status === 'pending' || serverResult.message) {
            showToast(serverResult.message || '已提交，等待开发者审核', 'info');
        } else if (isEdit) {
            showToast('星体系统已保存', 'success');
        }

        // --- 构造场景实例数据（服务器返回的记录优先：贴图已落盘为相对路径）---
        const serverGalaxy = serverOk && serverResult.galaxy
            ? serverRecordToGalaxy(serverResult.galaxy)
            : null;
        const serverStar = serverGalaxy?.planets.find(p => p.isStar) || null;
        const useServerRecord = !!serverStar;

        const starSIPos = useServerRecord
            ? (serverStar._siPosition || { x: 0, y: 0, z: 0 })
            : { x: starPosX * AU, y: starPosY * AU, z: starPosZ * AU };
        const starPlanetInfo = useServerRecord ? serverStar : {
            key: galaxyId + '_star',
            name: starName, nameCN: starName,
            mass: starMass, radius: starRadius * 1000, orbitRadius: 0,
            visualRadius: starVisual, color: starColor,
            texturePath: starTexBase64 || null,
            textureName: starTexName,
            isStar: true, _siPosition: starSIPos,
            details: starUserDetails || autoStarDetails,
            detailTree: this._editStarDetailTree || null,
            surfaceTree: this._editStarSurfaceTree || null,
            voiceIntro: starUserVoice || autoStarVoice,
        };
        const planetInfos = useServerRecord
            ? serverGalaxy.planets.filter(p => !p.isStar)
            : planetEntries.map((p, i) => ({
                key: galaxyId + '_planet_' + i,
                name: p.name, nameCN: p.name,
                mass: p.mass, radius: p.radius, orbitRadius: p.orbitRadius,
                visualRadius: p.visualRadius, color: p.color,
                texturePath: p.textureData || null,
                textureName: p.textureName || null,
                details: p.details || `${p.name} — ${galaxyName}的行星。`,
                detailTree: p.detailTree || null,
                surfaceTree: p.surfaceTree || null,
                voiceIntro: p.voiceIntro || '',
                moons: p.moons || [],
                isStar: false,
            }));
        const allInfos = [starPlanetInfo, ...planetInfos].map(p => ({ ...p }));

        // 尚未保存的关联现在系统已有 id，可以正式写入了
        await this._commitDraftRelations(galaxyId);

        // --- 编辑：先销毁旧实例，再用新数据重建（保持同一个系统 id）---
        const wasActive = isEdit && this.systemManager?.getActiveSystemId?.() === galaxyId;
        if (isEdit) this._deleteGalaxyBodies(galaxyId);
        // 草稿不进入场景 / 宇宙视图，等发布后再实例化
        if (!savedAsDraft) {
            this._instantiateGalaxy(galaxyId, starSIPos, starPlanetInfo, planetInfos, starMass);
        }

        // --- 持久化到 localStorage（写入服务器返回的归属 / 审核状态）---
        const communityMeta = serverGalaxy ? {
            ownerUserId: serverGalaxy.ownerUserId,
            ownerName: serverGalaxy.ownerName,
            status: serverGalaxy.status,
            reviewNote: serverGalaxy.reviewNote,
            universeGalaxyId: serverGalaxy.universeGalaxyId,
            submittedAt: serverGalaxy.submittedAt,
        } : {
            status: savedAsDraft ? 'draft' : 'pending',
            universeGalaxyId: universeGalaxyId,
        };
        if (isEdit) {
            updateCustomGalaxy(galaxyId, {
                name: galaxyName, nameCN: galaxyNameCN,
                description: galaxyDesc, icon: '🌟', planets: allInfos, universe,
                ...communityMeta,
            });
        } else {
            addCustomGalaxy({
                name: galaxyName, nameCN: galaxyNameCN,
                description: galaxyDesc, icon: '🌟', planets: allInfos, universe,
                ...communityMeta,
            }, galaxyId);
        }

        const fromUniverse = this._pendingUniverseReturn;
        this._pendingUniverseGalaxyId = null;
        this._pendingUniverseReturn = false;

        // --- 编辑保存：若正在展示则重新挂载；新建：直接进入新系统 ---
        if (savedAsDraft) {
            showToast(
                isEdit ? '草稿已保存' : '已暂存到草稿箱，可在个人中心「我的系统」完成发布',
                'success'
            );
        } else if (isEdit) {
            if (wasActive) this.systemManager?.refreshActiveSystem?.(galaxyId);
            if (this.onRefreshOrbits) this.onRefreshOrbits();
        } else if (fromUniverse) {
            // 从星系视图新建：保存后回到该星系，让新系统直接出现在视图里
            this.openUniverseView({ galaxyId: universeGalaxyId });
        } else if (this.systemManager) {
            this.onNavigateToGalaxy(galaxyId);
        }

        console.log(`[GalaxyBrowser] 星体系统 "${galaxyName}" ${isEdit ? '已重新编译并保存' : '创建并加载完成'}`);

        // --- 关闭模态框 & 刷新列表 ---
        this._editingGalaxy = null;
        this.addModal.classList.add('hidden');
        this._renderList();
    }

    /** 回退方案：本地创建（不依赖服务器） */
    _fallbackCreate(galaxyName, galaxyNameCN, galaxyDesc,
        starName, starMass, starRadius, starColor, starVisual,
        starPosX, starPosY, starPosZ, planetEntries,
        starTexturePath = null, starTextureName = null) {

        const galaxyId = 'custom_galaxy_' + Date.now();
        const starKey = galaxyId + '_star';
        const starSIPos = { x: starPosX * AU, y: starPosY * AU, z: starPosZ * AU };

        // 读取恒星用户描述（可能不存在于回退场景）
        const starVoiceInput   = document.getElementById('ag-star-voice');
        const starUserDetails = (this._editStarDetails || '').trim();
        const starUserVoice   = starVoiceInput ? starVoiceInput.value.trim() : '';
        const autoStarDetails = `${starName} — ${galaxyName}的中心恒星。质量${(starMass / 1e30).toFixed(2)}×10³⁰kg。`;
        const autoStarVoice   = `${starName}，${galaxyName}的中心恒星。`;

        const starPlanetInfo = {
            key: starKey, name: starName, nameCN: starName,
            mass: starMass, radius: starRadius, orbitRadius: 0,
            visualRadius: starVisual, color: starColor,
            texturePath: starTexturePath || null,
            textureName: starTextureName,
            details: starUserDetails || autoStarDetails,
            detailTree: this._editStarDetailTree || null,
            surfaceTree: this._editStarSurfaceTree || null,
            voiceIntro: starUserVoice || autoStarVoice,
            isStar: true, _siPosition: starSIPos,
        };

        const planetInfos = planetEntries.map((p, i) => ({
            key: galaxyId + '_planet_' + i,
            name: p.name, nameCN: p.name,
            mass: p.mass, radius: p.radius, orbitRadius: p.orbitRadius,
            visualRadius: p.visualRadius, color: p.color,
            texturePath: p.textureData || null,
            textureName: p.textureName || null,
            details: p.details || `${p.name} — ${galaxyName}的第${i+1}颗行星。`,
            detailTree: p.detailTree || null,
            surfaceTree: p.surfaceTree || null,
            voiceIntro: p.voiceIntro || `${p.name}，${galaxyName}的行星。`,
            moons: p.moons || [],
            isStar: false,
        }));

        const allPlanetInfos = [starPlanetInfo, ...planetInfos];
        addCustomGalaxy({
            name: galaxyName, nameCN: galaxyNameCN,
            description: galaxyDesc, icon: '🌟',
            planets: allPlanetInfos,
        });

        this._instantiateGalaxy(galaxyId, starSIPos, starPlanetInfo, planetInfos, starMass);

        console.log(`[GalaxyBrowser] (本地模式) 星系 "${galaxyName}" 创建完成，${allPlanetInfos.length} 个天体`);
    }

    /**
     * 将图片文件转为可直接用于 THREE.TextureLoader 的 data URL。
     * 超过 maxSize 的图片会等比缩小，避免上传 / 缓存体积过大。
     */
    _fileToBase64(file, maxSize = 512) {
        if (!file) return Promise.resolve(null);
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => {
                const dataUrl = typeof reader.result === 'string' ? reader.result : null;
                if (!dataUrl) { resolve(null); return; }

                const img = new Image();
                img.onload = () => {
                    try {
                        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
                        // 尺寸已经够小且体积不大时保留原始编码
                        if (scale >= 1 && dataUrl.length < 1.5e6) {
                            resolve(dataUrl);
                            return;
                        }
                        const w = Math.max(1, Math.round(img.width * scale));
                        const h = Math.max(1, Math.round(img.height * scale));
                        const canvas = document.createElement('canvas');
                        canvas.width = w;
                        canvas.height = h;
                        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                        const isPng = /^data:image\/png/i.test(dataUrl);
                        resolve(canvas.toDataURL(isPng ? 'image/png' : 'image/jpeg', 0.9));
                    } catch (err) {
                        // 无法解码/绘制时退回原始图片数据
                        resolve(dataUrl);
                    }
                };
                img.onerror = () => resolve(dataUrl);
                img.src = dataUrl;
            };
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(file);
        });
    }

    /** 兼容旧数据：相对路径原样返回，裸 base64 补全为 data URL */
    _toTexturePath(data) {
        if (!data) return null;
        const s = String(data).trim();
        if (/^(data:|https?:|blob:|\/|\.{1,2}\/|Galaxy\/|detail_files\/|assets\/|textures\/)/i.test(s)) {
            return s;
        }
        return `data:image/png;base64,${s}`;
    }

    /** 将星系数据实例化为独立系统组 */
    _instantiateGalaxy(galaxyId, starSIPos, starInfo, planetInfos, starMass) {
        const createdKeys = [];
        // 星系独立组 — 所有天体 Mesh 直接创建在此组内，永不污染主场景
        const galaxyGroup = new THREE.Group();
        galaxyGroup.visible = false;

        // --- 创建恒星（scene 传 galaxyGroup，Mesh 直接归属组） ---
        const starBody = new CelestialBody({
            key: starInfo.key,
            name: starInfo.name,
            nameCN: starInfo.nameCN,
            mass: starInfo.mass,
            radius: starInfo.radius,
            orbitRadius: 0,
            visualRadius: starInfo.visualRadius,
            color: starInfo.color,
            texturePath: this._toTexturePath(starInfo.texturePath),
            details: starInfo.details,
            detailTree: starInfo.detailTree || null,
            surfaceTree: starInfo.surfaceTree || null,
            voiceIntro: starInfo.voiceIntro || '',
            scene: galaxyGroup,
        });
        starBody.position.set(starSIPos.x, starSIPos.y, starSIPos.z);
        starBody.velocity.set(0, 0, 0);
        starBody._syncMeshPosition();

        // --- 恒星发光 ---
        // 1) 材质自发光：让恒星球体本身像主序星一样明亮；
        // 2) 挂一盏随恒星移动的点光源，为该系统内的行星提供真实照明
        //    （自定义恒星可能远离主场景原点，场景里的全局光源照不到它）。
        const starMat = starBody.mesh?.material;
        if (starMat) {
            starMat.emissive = starBody.color.clone();
            starMat.emissiveIntensity = 0.8;
            starMat.needsUpdate = true;
        }
        if (starBody.mesh) {
            const starLight = new THREE.PointLight(starBody.color.clone(), 12.0, 0, 1.5);
            starBody.mesh.add(starLight);
        }

        this.planets[starInfo.key] = starBody;
        createdKeys.push(starInfo.key);

        // --- 创建行星 ---
        planetInfos.forEach(pInfo => {
            const body = new CelestialBody({
                key: pInfo.key,
                name: pInfo.name,
                nameCN: pInfo.nameCN,
                mass: pInfo.mass,
                radius: pInfo.radius,
                orbitRadius: pInfo.orbitRadius,
                visualRadius: pInfo.visualRadius,
                color: pInfo.color,
                texturePath: this._toTexturePath(pInfo.texturePath),
                details: pInfo.details,
                detailTree: pInfo.detailTree || null,
                surfaceTree: pInfo.surfaceTree || null,
                voiceIntro: pInfo.voiceIntro || '',
                scene: galaxyGroup,
            });

            const orbitR = pInfo.orbitRadius;
            body.position.set(starSIPos.x + orbitR, starSIPos.y, starSIPos.z);
            body.setCircularOrbitVelocity(starMass);
            body._syncMeshPosition();

            this.planets[pInfo.key] = body;
            createdKeys.push(pInfo.key);

            // --- 卫星 ---
            const moons = pInfo.moons || [];
            moons.forEach((mData, mi) => {
                const moonKey = pInfo.key + '_moon_' + mi;
                const moonRadiusKm = mData.radius || 1737;
                const moonGeo = new THREE.SphereGeometry(Math.max(0.05, moonRadiusKm / 10000), 16, 16);
                const moonMat = new THREE.MeshStandardMaterial({ color: mData.color || '#aaaaaa', roughness: 0.7, metalness: 0.1 });
                const moonMesh = new THREE.Mesh(moonGeo, moonMat);
                const moonOrbit = mData.orbitRadius || 3;
                const moonSpeed = mData.orbitSpeed || 1;
                const moonAngle = Math.random() * Math.PI * 2;

                // ui.js 点击卫星时读取 userData.moonData（详情弹窗使用）
                const moonData = {
                    key: moonKey,
                    name: mData.name || '卫星',
                    nameCN: mData.name || '卫星',
                    color: mData.color || '#aaaaaa',
                    mass: mData.mass || 7.35e22,
                    radius: moonRadiusKm * 1000,
                    diameter: (moonRadiusKm * 2).toFixed(0) + ' km',
                    details: mData.details || '',
                    detailTree: mData.detailTree || null,
                    surfaceTree: mData.surfaceTree || null,
                    mesh: moonMesh,
                    isMoon: true,
                    parentKey: pInfo.key,
                    orbitPhase: moonAngle,
                    orbitRadius: moonOrbit,
                    // SystemManager.updateMoons 每帧调用（与 MoonBody 接口保持一致）
                    update(parentPos, dt) {
                        this.orbitPhase += moonSpeed * dt;
                        moonMesh.position.set(
                            parentPos.x + Math.cos(this.orbitPhase) * moonOrbit,
                            parentPos.y,
                            parentPos.z + Math.sin(this.orbitPhase) * moonOrbit
                        );
                        moonMesh.rotation.y += 0.5 * dt;
                    },
                };

                moonMesh.userData = {
                    isMoon: true,
                    parentKey: pInfo.key,
                    planetKey: pInfo.key,
                    moonKey,
                    moonBody: moonData,
                    moonData,
                    orbitRadius: moonOrbit,
                    orbitSpeed: moonSpeed,
                    angle: moonAngle,
                    name: moonData.name,
                };
                galaxyGroup.add(moonMesh);
                // 卫星是运动学天体（由 updateMoons 驱动），不加入物理引擎
                if (!this.planets[moonKey]) {
                    this.planets[moonKey] = moonData;
                }
                // 注册到 UIManager 的卫星列表，使自定义卫星可点击 / 显示详情
                if (this.systemManager?.allMoons) {
                    const list = this.systemManager.allMoons[pInfo.key] || [];
                    list.push(moonData);
                    this.systemManager.allMoons[pInfo.key] = list;
                }
            });
        });

        // 注册到 SystemManager
        if (this.systemManager) {
            this.systemManager.registerSystemGroup(galaxyId, galaxyGroup, createdKeys);
        }

        this._customBodies.push({ galaxyId, keys: createdKeys });
    }

    /**
     * 星球实验室导出的星体系统入库（SQLite + 本地缓存 + 场景实例）
     * @param {object} payload
     * @param {string} payload.name
     * @param {string} [payload.description]
     * @param {object} payload.star    — 与 create-galaxy 的 star 字段同构
     * @param {Array}  payload.planets — 与 create-galaxy 的 planets 字段同构
     * @param {string} [payload.galaxyId] 所属星系
     * @param {boolean} [payload.draft] — true 时存入草稿箱（不进入场景，仅本人可见）
     */
    async addSystemFromLab({ name, description = '', star, planets = [], galaxyId = DEFAULT_GALAXY_ID, draft = false }) {
        if (!name || !star) return { ok: false, error: '缺少系统名称或恒星数据' };
        if (!getCurrentUser()) return { ok: false, error: '请先登录后再保存星体系统' };

        const proposedId = 'lab_' + Date.now().toString(36);
        const serverResult = await createGalaxyOnServer({
            id: proposedId,
            name,
            nameCN: name,
            description,
            universe: { galaxyId },
            star: { ...star, appearance: star.textureData ? 'texture' : (star.appearance || 'color') },
            planets,
            draft,
        });
        if (!serverResult?.ok) {
            console.warn('[GalaxyBrowser] 实验室系统写入服务器失败:', serverResult?.error);
            return { ok: false, error: serverResult?.error || '服务器不可用' };
        }
        const newId = serverResult.id || proposedId;

        // 服务器记录优先：贴图已写入磁盘，记录里只有相对路径
        const serverGalaxy = serverResult.galaxy
            ? serverRecordToGalaxy(serverResult.galaxy)
            : null;
        const serverStar = serverGalaxy?.planets.find(p => p.isStar) || null;
        const useServerRecord = !!serverStar;

        const starSIPos = useServerRecord
            ? (serverStar._siPosition || { x: 0, y: 0, z: 0 })
            : {
                x: (star.x || 0) * AU,
                y: (star.y || 0) * AU,
                z: (star.z || 0) * AU,
            };
        const starPlanetInfo = useServerRecord ? serverStar : {
            key: newId + '_star',
            name: star.name || '中心恒星', nameCN: star.name || '中心恒星',
            mass: star.mass, radius: star.radius, orbitRadius: 0,
            visualRadius: star.visualRadius, color: star.color,
            texturePath: star.textureData || null,
            textureName: star.textureName || null,
            isStar: true, _siPosition: starSIPos,
            details: star.details || '',
            detailTree: star.detailTree || null,
            surfaceTree: star.surfaceTree || null,
            voiceIntro: star.voiceIntro || '',
        };
        const planetInfos = useServerRecord
            ? serverGalaxy.planets.filter(p => !p.isStar)
            : planets.map((p, i) => ({
                key: newId + '_planet_' + i,
                name: p.name, nameCN: p.name,
                mass: p.mass, radius: p.radius, orbitRadius: p.orbitRadius,
                visualRadius: p.visualRadius, color: p.color,
                texturePath: p.textureData || null,
                textureName: p.textureName || null,
                details: p.details || '',
                detailTree: p.detailTree || null,
                surfaceTree: p.surfaceTree || null,
                voiceIntro: p.voiceIntro || '',
                moons: p.moons || [],
                isStar: false,
            }));
        const allInfos = [starPlanetInfo, ...planetInfos].map(p => ({ ...p }));
        const savedStatus = serverGalaxy?.status || serverResult.status || 'approved';

        // 草稿只在个人中心可见，不实例化进主场景
        if (savedStatus !== 'draft') {
            this._instantiateGalaxy(newId, starSIPos, starPlanetInfo, planetInfos, star.mass);
        }
        addCustomGalaxy({
            name, nameCN: name, description, icon: '🌟', planets: allInfos,
            universe: { galaxyId },
            universeGalaxyId: serverGalaxy?.universeGalaxyId || galaxyId,
            ownerUserId: serverGalaxy?.ownerUserId || null,
            ownerName: serverGalaxy?.ownerName || null,
            status: savedStatus,
            reviewNote: serverGalaxy?.reviewNote || '',
            submittedAt: serverGalaxy?.submittedAt || null,
        }, newId);
        if (this.onRefreshOrbits) this.onRefreshOrbits();
        this._renderList();

        return {
            ok: true,
            id: newId,
            status: savedStatus,
            message: serverResult.message || '',
            server: true,
        };
    }

    /** 页面加载时恢复所有自定义星系的天体实例（SQLite 为准，localStorage 兜底） */
    async restoreCustomGalaxies() {
        // 1) 首次升级：把 localStorage 里的旧数据并入 SQLite
        try {
            await migrateLocalStorageToServer();
        } catch (e) {
            console.warn('[GalaxyBrowser] 旧数据迁移失败，继续使用本地缓存:', e?.message || e);
        }

        // 2) 以数据库为准刷新自定义星系缓存（服务器不可用时保留本地缓存）
        try {
            await loadCustomGalaxiesFromServer();
        } catch (e) {
            console.warn('[GalaxyBrowser] 读取数据库星系失败，使用本地缓存:', e?.message || e);
        }

        // 3) 实例化尚未创建的自定义星系（草稿不进入场景）
        this._instantiateMissingCustomGalaxies();
    }

    /** 为数据库中已存在但场景里还没有的自定义星系创建天体（发布草稿后也会调用） */
    _instantiateMissingCustomGalaxies() {
        const allGalaxies = getAllGalaxies();
        const pendingGalaxies = allGalaxies.filter(g =>
            !g.isBuiltIn
            && (g.status || 'approved') !== 'draft'
            && !this.planets[g.id + '_star']);

        pendingGalaxies.forEach(g => {
            const starInfo = g.planets?.find(p => p.isStar);
            const planetInfos = g.planets?.filter(p => !p.isStar) || [];

            if (!starInfo) return;

            const starSIPos = starInfo._siPosition || {
                x: Number(starInfo.orbitRadius) || 0,
                y: 0,
                z: 0,
            };

            this._instantiateGalaxy(g.id, starSIPos, starInfo, planetInfos, starInfo.mass);
        });

        if (pendingGalaxies.length > 0) {
            console.log(`[GalaxyBrowser] 恢复了 ${pendingGalaxies.length} 个自定义星系`);
        }
    }

    /** 删除自定义星系的所有天体 */
    _deleteGalaxyBodies(galaxyId) {
        // 从 SystemManager 移除系统组
        if (this.systemManager && this.systemManager._systemGroups) {
            const group = this.systemManager._systemGroups[galaxyId];
            if (group) {
                group.parent?.remove(group);
                // 递归释放组内所有 mesh
                group.traverse(child => {
                    if (child.isMesh) {
                        child.geometry?.dispose();
                        if (Array.isArray(child.material)) {
                            child.material.forEach(m => m.dispose());
                        } else {
                            child.material?.dispose();
                        }
                    }
                });
                delete this.systemManager._systemGroups[galaxyId];
            }
            if (this.systemManager._systemPlanetKeys) {
                delete this.systemManager._systemPlanetKeys[galaxyId];
            }
        }

        // 收集该系统所有天体 key：
        // 1) _customBodies 中登记的 key；2) planets 里同前缀的 key
        //    （服务器模块回退后可能重复登记，仅取第一条会漏删）
        const keys = new Set();
        this._customBodies
            .filter(c => c.galaxyId === galaxyId)
            .forEach(c => (c.keys || []).forEach(k => keys.add(k)));
        Object.keys(this.planets).forEach(k => {
            if (k === galaxyId || k.startsWith(galaxyId + '_')) keys.add(k);
        });
        // 物理引擎里可能还残留同前缀的旧天体
        (this.physics?.bodies || []).forEach(b => {
            if (b.key && (b.key === galaxyId || b.key.startsWith(galaxyId + '_'))) keys.add(b.key);
        });

        keys.forEach(key => {
            const body = this.planets[key];
            if (body) {
                this.physics.removeBody(body);
                if (typeof body.dispose === 'function') body.dispose();
                else body.mesh?.parent?.remove(body.mesh);
                delete this.planets[key];
            }
        });

        // UIManager 的卫星列表里同步移除该系统卫星，避免点击到已销毁的 Mesh
        const allMoons = this.systemManager?.allMoons;
        if (allMoons) {
            Object.keys(allMoons).forEach(parentKey => {
                if (parentKey === galaxyId || parentKey.startsWith(galaxyId + '_')) {
                    delete allMoons[parentKey];
                    return;
                }
                const filtered = (allMoons[parentKey] || []).filter(m => !keys.has(m.key));
                if (filtered.length) allMoons[parentKey] = filtered;
                else delete allMoons[parentKey];
            });
        }

        // 兜底：按 key 从物理引擎移除（避免 planets 已被覆盖时漏删）
        for (const body of [...(this.physics?.bodies || [])]) {
            if (body.key && (body.key === galaxyId || body.key.startsWith(galaxyId + '_'))) {
                this.physics.removeBody(body);
            }
        }

        this._customBodies = this._customBodies.filter(c => c.galaxyId !== galaxyId);
    }

    // ==================== ⚡ Glitch 按钮特效 ====================
    _setupGlitchEffect() {
        const glitchWrapper = this.overlay.querySelector('#addBtnWrapper');
        if (!glitchWrapper) return;
        const glitchBtn = glitchWrapper.querySelector('.fui-glitch-btn');

        let hoverGlitchInterval = null;

        glitchBtn.addEventListener('mouseenter', () => {
            this._triggerGlitch(glitchWrapper, 300);
            hoverGlitchInterval = setInterval(() => {
                if (Math.random() > 0.5) this._triggerGlitch(glitchWrapper, 150 + Math.random() * 200);
            }, 400);
        });

        // 点击时触发强故障
        glitchBtn.addEventListener('click', () => {
            this._triggerGlitch(glitchWrapper, 400);
        });

        glitchBtn.addEventListener('mouseleave', () => {
            clearInterval(hoverGlitchInterval);
            glitchWrapper.classList.remove('is-glitching');
        });

        // 空闲时随机故障
        const scheduleNext = () => {
            const delay = 2000 + Math.random() * 5000;
            setTimeout(() => {
                if (!glitchWrapper.matches(':hover')) {
                    this._triggerGlitch(glitchWrapper, 100 + Math.random() * 250);
                }
                scheduleNext();
            }, delay);
        };
        scheduleNext();
    }

    _triggerGlitch(wrapper, duration = 200) {
        wrapper.classList.add('is-glitching');
        const offset = 2 + Math.random() * 6;
        wrapper.style.setProperty('--glitch-offset', `${offset}px`);
        setTimeout(() => {
            wrapper.classList.remove('is-glitching');
        }, duration);
    }
}
