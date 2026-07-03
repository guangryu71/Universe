// ============================================================
// GalaxyBrowser.js — 星系浏览器 UI 组件
// 弹窗展示所有星系、搜索、点击导航、添加新星系
// ============================================================

import * as THREE from 'three';
import { CelestialBody } from './CelestialBody.js';
import {
    getAllGalaxies,
    searchGalaxies,
    addCustomGalaxy,
    deleteCustomGalaxy,
    isBuiltIn,
    createGalaxyOnServer,
    deleteGalaxyOnServer,
} from './galaxyRegistry.js';
import { AU } from './constants.js';
import { POS_SCALE } from './constants.js';

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
        this._buildDOM();
        this._bindEvents();
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
                    <div class="fui-title">STELLAR_SYS_BROWSER</div>
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
                <div class="glitch-btn-wrapper" id="addBtnWrapper">
                    <button class="fui-glitch-btn" id="galaxy-browser-add-btn"><span>+ ADD_NEW_STELLAR_SYSTEM</span></button>
                    <div class="glitch-layer"><button class="fui-glitch-btn"><span>+ ADD_NEW_STELLAR_SYSTEM</span></button></div>
                    <div class="glitch-layer"><button class="fui-glitch-btn"><span>+ ADD_NEW_STELLAR_SYSTEM</span></button></div>
                    <div class="glitch-layer"><button class="fui-glitch-btn"><span>+ ADD_NEW_STELLAR_SYSTEM</span></button></div>
                    <div class="btn-deco bd-tl-h"></div>
                    <div class="btn-deco bd-tl-v"></div>
                    <div class="btn-deco bd-br-h"></div>
                    <div class="btn-deco bd-br-v"></div>
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
                <div style="padding:10px 14px;border-bottom:1px solid var(--fui-accent-dim);font-family:var(--fui-font-display);font-size:12px;color:var(--fui-cyan);letter-spacing:1px;">💾 选择要导出的星系</div>
                <input type="text" id="gb-save-search" placeholder="搜索星系..." style="margin:8px 12px;padding:6px 10px;background:var(--fui-bg-input);border:1px solid var(--fui-accent-dim);color:var(--fui-text-bright);font-size:12px;outline:none;" />
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
        this.agAddPlanet = this.addModal.querySelector('#ag-add-planet');
        this.agPlanetList = this.addModal.querySelector('#ag-planet-list');
    }

    _buildAddFormHTML() {
        return `
        <div class="add-galaxy-backdrop"></div>
        <div class="add-galaxy-panel">
            <div class="add-galaxy-header">
                <span>➕ 创建单恒星系统</span>
                <button class="add-galaxy-close" id="ag-close">&times;</button>
            </div>
            <div class="add-galaxy-body">
                <div class="ag-section">
                    <div class="ag-section-title">🌌 单恒星系统信息</div>
                    <div class="ag-row"><label>名称</label><input id="ag-name" value="新星系" placeholder="如：比邻星系" /></div>
                    <div class="ag-row"><label>英文名</label><input id="ag-name-cn" value="New Galaxy" placeholder="如：Proxima Centauri" /></div>
                    <div class="ag-row"><label>描述</label><textarea id="ag-desc" rows="2" placeholder="简短描述...">一个新的恒星系统</textarea></div>
                </div>
                <div class="ag-section">
                    <div class="ag-section-title">☀️ 中心恒星</div>
                    <div class="ag-row"><label>名称</label><input id="ag-star-name" value="新恒星" /></div>
                    <div class="ag-row"><label>质量 (kg)</label><input id="ag-star-mass" type="number" value="1.989e30" step="any" /></div>
                    <div class="ag-row"><label>半径 (km)</label><input id="ag-star-radius" type="number" value="696340" step="any" /></div>
                    <div class="ag-row"><label>颜色</label><input id="ag-star-color" type="color" value="#ffcc00" /></div>
                    <div class="ag-row"><label>视觉大小</label><input id="ag-star-visual" type="number" value="5.0" step="0.1" min="0.5" /></div>
                    <div class="ag-row"><label>贴图</label><input id="ag-star-texture" type="file" accept="image/*" style="font-size:10px;" /></div>
                    <div class="ag-row ag-row-3">
                        <span><label>位置 X (AU)</label><input id="ag-star-x" type="number" value="50" step="1" /></span>
                        <span><label>Y (AU)</label><input id="ag-star-y" type="number" value="0" step="1" /></span>
                        <span><label>Z (AU)</label><input id="ag-star-z" type="number" value="0" step="1" /></span>
                    </div>
                    <div class="ag-row"><label>详情描述</label><textarea id="ag-star-details" rows="2" placeholder="恒星详情描述（可选，留空自动生成）"></textarea></div>
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
            <div class="add-galaxy-footer">
                <button id="ag-confirm" class="ag-confirm-btn">🚀 创建单恒星系统并发射入轨</button>
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
        import('./galaxyRegistry.js').then(({ getAllGalaxies, fetchServerGalaxies }) => {
            const all = getAllGalaxies();
            const custom = all.filter(g => !g.isBuiltIn);
            const query = (this.saveSearch?.value || '').toLowerCase().trim();
            const filtered = query ? custom.filter(g => g.name.toLowerCase().includes(query) || g.nameCN.toLowerCase().includes(query)) : custom;
            if (filtered.length === 0) {
                this.saveList.innerHTML = '<div style="color:#667;text-align:center;padding:20px;font-size:12px;">无匹配星系</div>';
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
        const { exportGalaxiesOnServer } = await import('./galaxyRegistry.js');
        const checks = this.saveList?.querySelectorAll('.gb-save-checkbox:checked') || [];
        const ids = Array.from(checks).map(cb => cb.value);
        if (ids.length === 0) { alert('请至少选择一个星系'); return; }
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
            const { importGalaxyOnServer, fetchServerGalaxies } = await import('./galaxyRegistry.js');
            const result = await importGalaxyOnServer(file);
            if (result.ok) {
                alert(`✅ 导入成功！\n导入星系: ${(result.imported || []).join(', ')}`);
                this._renderList();
                // 重新加载自定义星系
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

        // --- 添加星系按钮 ---
        this.addBtn.addEventListener('click', () => this._openAddForm());

        // --- 添加星系模态框 ---
        this.agClose.addEventListener('click', () => this.addModal.classList.add('hidden'));
        this.agBackdrop.addEventListener('click', () => this.addModal.classList.add('hidden'));
        this.agAddPlanet.addEventListener('click', () => this._addPlanetRow());
        this.agConfirm.addEventListener('click', () => this._confirmCreateGalaxy());

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
        this._renderList();
        this.searchEl.value = '';
        this.searchEl.focus();
    }

    hide() {
        this.overlay.classList.add('hidden');
    }

    isVisible() {
        return !this.overlay.classList.contains('hidden');
    }

    // ==================== 列表渲染 ====================
    _renderList() {
        const query = this.searchEl.value;
        const galaxies = searchGalaxies(query);

        if (galaxies.length === 0) {
            this.listEl.innerHTML = '<div class="galaxy-browser-empty">未找到匹配的星系或星球</div>';
            return;
        }

        this.listEl.innerHTML = galaxies.map(g => this._renderGalaxyCard(g)).join('');

        // 绑定点击事件
        this.listEl.querySelectorAll('.gb-galaxy-card').forEach(card => {
            const galaxyId = card.dataset.galaxyId;
            card.querySelector('.gb-galaxy-header')?.addEventListener('click', () => {
                this.onNavigateToGalaxy(galaxyId);
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
                const galaxyId = btn.dataset.galaxyId;
                if (confirm('确定要删除这个星系及其所有天体吗？')) {
                    this._deleteGalaxyBodies(galaxyId);
                    deleteCustomGalaxy(galaxyId);
                    // 尝试从服务器删除（非阻塞）
                    await deleteGalaxyOnServer(galaxyId).catch(() => {});
                    this._renderList();
                }
            });
        });
    }

    _renderGalaxyCard(g) {
        const planetCount = g.planets ? g.planets.length : 0;
        const starPlanet = g.planets?.find(p => p.isStar);
        const otherPlanets = g.planets?.filter(p => !p.isStar) || [];

        return `
        <div class="fui-item gb-galaxy-card" data-galaxy-id="${g.id}">
            <div class="item-header gb-galaxy-header">
                <span class="gb-galaxy-icon">${g.icon || '🌟'}</span>
                <div class="item-info">
                    <span class="item-label">${g.name} <small style="color:var(--text-dim);font-size:12px;font-family:var(--font-body);">// ${g.nameCN}</small></span>
                    <span class="item-desc">${g.description}</span>
                </div>
                <span class="gb-galaxy-count">${planetCount} 天体</span>
                ${g.isBuiltIn ? '<span class="gb-badge-builtin">BUILT_IN</span>' : `<button class="gb-delete-galaxy" data-galaxy-id="${g.id}" title="DELETE_SYSTEM">✕</button>`}
            </div>
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

    // ==================== 添加星系表单 ====================
    _openAddForm() {
        this.addModal.classList.remove('hidden');
        // 清空行星列表
        this.agPlanetList.innerHTML = '<div class="ag-planet-empty">尚未添加行星，点击上方按钮添加</div>';
        this._planetRowCounter = 0;
    }

    _addPlanetRow() {
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
            <div class="ag-row"><label>颜色</label><input class="ag-p-color" type="color" value="${this._randomPlanetColor()}" /></div>
            <div class="ag-row"><label>视觉大小</label><input class="ag-p-visual" type="number" value="0.5" step="0.1" min="0.1" /></div>
            <div class="ag-row"><label>贴图</label><input class="ag-p-texture" type="file" accept="image/*" style="font-size:10px;" /></div>
            <div class="ag-row"><label>详情描述</label><textarea class="ag-p-details" rows="2" placeholder="行星详情描述（可选，留空自动生成）"></textarea></div>
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

        this.agPlanetList.appendChild(row);

        // 删除按钮
        row.querySelector('.ag-remove-planet').addEventListener('click', () => {
            row.remove();
            if (this.agPlanetList.children.length === 0) {
                this.agPlanetList.innerHTML = '<div class="ag-planet-empty">尚未添加行星，点击上方按钮添加</div>';
            }
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
            `;
            moonRow.querySelector('.ag-remove-moon').addEventListener('click', () => {
                moonRow.remove();
                if (moonList.querySelectorAll('.ag-moon-row').length === 0) {
                    moonList.innerHTML = '<div class="ag-moon-empty">尚未添加卫星，点击上方按钮添加</div>';
                }
            });
            moonList.appendChild(moonRow);
        });
    }

    _randomPlanetColor() {
        const colors = ['#e07040', '#4488ff', '#d4b896', '#e8d5a3', '#7ec8e3', '#4060ff', '#b0b0b0', '#e8cda0', '#88cc88', '#cc88cc'];
        return colors[Math.floor(Math.random() * colors.length)];
    }

    async _confirmCreateGalaxy() {
        // --- 读取星系信息（强制填写名称和英文名）---
        const galaxyName   = document.getElementById('ag-name').value.trim();
        const galaxyNameCN = document.getElementById('ag-name-cn').value.trim();
        const galaxyDesc   = document.getElementById('ag-desc').value.trim() || '';
        if (!galaxyName) { alert('⚠️ 请填写单恒星系统名称'); return; }
        if (!galaxyNameCN) { alert('⚠️ 请填写英文名（用于文件夹命名）'); return; }

        // --- 读取恒星信息 ---
        const starName  = document.getElementById('ag-star-name').value.trim() || '新恒星';
        const starMass  = parseFloat(document.getElementById('ag-star-mass').value) || 1.989e30;
        const starRadius = parseFloat(document.getElementById('ag-star-radius').value) || 696340;
        const starColor = document.getElementById('ag-star-color').value || '#ffcc00';
        const starVisual = parseFloat(document.getElementById('ag-star-visual').value) || 5.0;
        const starPosX  = parseFloat(document.getElementById('ag-star-x').value) || 50;
        const starPosY  = parseFloat(document.getElementById('ag-star-y').value) || 0;
        const starPosZ  = parseFloat(document.getElementById('ag-star-z').value) || 0;
        // 恒星贴图
        const starTexFile = document.getElementById('ag-star-texture')?.files?.[0];
        const starTexBase64 = await this._fileToBase64(starTexFile);

        // 恒星用户描述（可选）
        const starDetailsInput = document.getElementById('ag-star-details');
        const starVoiceInput   = document.getElementById('ag-star-voice');
        const starUserDetails  = starDetailsInput ? starDetailsInput.value.trim() : '';
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
            const pVisual = parseFloat(row.querySelector('.ag-p-visual').value) || 0.5;
            const pTexFile = row.querySelector('.ag-p-texture')?.files?.[0];
            const pTexBase64 = await this._fileToBase64(pTexFile);

            // 用户输入描述（可选）
            const pDetailsEl = row.querySelector('.ag-p-details');
            const pVoiceEl   = row.querySelector('.ag-p-voice');
            const pUserDetails = pDetailsEl ? pDetailsEl.value.trim() : '';
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
                textureData: pTexBase64 || null,
                textureName: pTexFile?.name || null,
                details: pUserDetails || autoDetails,
                voiceIntro: pUserVoice || autoVoice,
                moons: moons, // 卫星列表（持久化存储）
            });
        }

        // --- 生成文件夹名（英文名 → 安全标识符）---
        const folderId = (galaxyNameCN || galaxyName)
            .toLowerCase()
            .replace(/[^a-z0-9一-鿿]+/g, '_')
            .replace(/^_|_$/g, '')
            .slice(0, 60) || 'galaxy_' + Date.now();

        // --- 同名检测（Galaxy/ + Galaxy/custom/ 下所有文件夹名）---
        const allGalaxies = getAllGalaxies();
        const existingIds = allGalaxies.map(g => g.id);
        if (existingIds.includes(folderId)) {
            alert(`⚠️ 星系 "${galaxyNameCN || galaxyName}" 已存在，请使用不同的英文名`);
            return;
        }

        // --- 尝试通过服务器创建星系文件夹 ---
        const serverResult = await createGalaxyOnServer({
            id: folderId,
            name: galaxyName,
            nameCN: galaxyNameCN,
            description: galaxyDesc,
            star: {
                name: starName,
                mass: starMass,
                radius: starRadius * 1000,
                color: starColor,
                visualRadius: starVisual,
                x: starPosX,
                y: starPosY,
                z: starPosZ,
                textureData: starTexBase64 || null,
                textureName: starTexFile?.name || null,
                details: starUserDetails || autoStarDetails,
                voiceIntro: starUserVoice || autoStarVoice,
            },
            planets: planetEntries,
        });

        if (serverResult.ok) {
            console.log(`[GalaxyBrowser] 服务器创建星系成功: ${serverResult.id} -> Galaxy/custom/${folderId}/`);

            // 使用 serverResult.id 作为文件夹名，直接实例化 + 跳转
            const starSIPos = { x: starPosX * AU, y: starPosY * AU, z: starPosZ * AU };
            const starPlanetInfo = {
                key: serverResult.id + '_star',
                name: starName, nameCN: starName,
                mass: starMass, radius: starRadius * 1000, orbitRadius: 0,
                visualRadius: starVisual, color: starColor,
                isStar: true, _siPosition: starSIPos,
                details: starUserDetails || autoStarDetails,
                voiceIntro: starUserVoice || autoStarVoice,
            };
            const planetInfos = planetEntries.map((p, i) => ({
                key: serverResult.id + '_planet_' + i,
                name: p.name, nameCN: p.name,
                mass: p.mass, radius: p.radius, orbitRadius: p.orbitRadius,
                visualRadius: p.visualRadius, color: p.color,
                details: p.details || `${p.name} — ${galaxyName}的行星。`,
                voiceIntro: p.voiceIntro || '',
                moons: p.moons || [],
                isStar: false,
            }));
            this._instantiateGalaxy(serverResult.id, starSIPos, starPlanetInfo, planetInfos, starMass);

            // 保存到 localStorage
            const allInfos = [starPlanetInfo, ...planetInfos].map(p => ({ ...p }));
            addCustomGalaxy({ name: galaxyName, nameCN: galaxyNameCN, description: galaxyDesc, icon: '🌟', planets: allInfos }, serverResult.id);

            // 切换到新系统
            if (this.systemManager) {
                this.onNavigateToGalaxy(serverResult.id);
            }

            console.log(`[GalaxyBrowser] 星系 "${galaxyName}" 创建并加载完成`);
        } else {
            console.warn('[GalaxyBrowser] 服务器创建失败，使用本地模式:', serverResult.error);
            this._fallbackCreate(galaxyName, galaxyNameCN, galaxyDesc,
                starName, starMass, starRadius, starColor, starVisual,
                starPosX, starPosY, starPosZ, planetEntries);
        }

        // --- 关闭模态框 & 刷新列表 ---
        this.addModal.classList.add('hidden');
        this._renderList();
    }

    /** 回退方案：本地创建（不依赖服务器） */
    _fallbackCreate(galaxyName, galaxyNameCN, galaxyDesc,
        starName, starMass, starRadius, starColor, starVisual,
        starPosX, starPosY, starPosZ, planetEntries) {

        const galaxyId = 'custom_galaxy_' + Date.now();
        const starKey = galaxyId + '_star';
        const starSIPos = { x: starPosX * AU, y: starPosY * AU, z: starPosZ * AU };

        // 读取恒星用户描述（可能不存在于回退场景）
        const starDetailsInput = document.getElementById('ag-star-details');
        const starVoiceInput   = document.getElementById('ag-star-voice');
        const starUserDetails = starDetailsInput ? starDetailsInput.value.trim() : '';
        const starUserVoice   = starVoiceInput ? starVoiceInput.value.trim() : '';
        const autoStarDetails = `${starName} — ${galaxyName}的中心恒星。质量${(starMass / 1e30).toFixed(2)}×10³⁰kg。`;
        const autoStarVoice   = `${starName}，${galaxyName}的中心恒星。`;

        const starPlanetInfo = {
            key: starKey, name: starName, nameCN: starName,
            mass: starMass, radius: starRadius, orbitRadius: 0,
            visualRadius: starVisual, color: starColor,
            details: starUserDetails || autoStarDetails,
            voiceIntro: starUserVoice || autoStarVoice,
            isStar: true, _siPosition: starSIPos,
        };

        const planetInfos = planetEntries.map((p, i) => ({
            key: galaxyId + '_planet_' + i,
            name: p.name, nameCN: p.name,
            mass: p.mass, radius: p.radius, orbitRadius: p.orbitRadius,
            visualRadius: p.visualRadius, color: p.color,
            details: p.details || `${p.name} — ${galaxyName}的第${i+1}颗行星。`,
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

    /** 将文件转为 Base64 */
    _fileToBase64(file) {
        if (!file) return Promise.resolve(null);
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const result = reader.result;
                // 去掉 data:...;base64, 前缀
                if (typeof result === 'string') {
                    const parts = result.split(',');
                    resolve(parts[1] || null);
                } else {
                    resolve(null);
                }
            };
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(file);
        });
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
            details: starInfo.details,
            voiceIntro: starInfo.voiceIntro || '',
            scene: galaxyGroup,
        });
        starBody.position.set(starSIPos.x, starSIPos.y, starSIPos.z);
        starBody.velocity.set(0, 0, 0);
        starBody._syncMeshPosition();

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
                details: pInfo.details,
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
                const moonGeo = new THREE.SphereGeometry(Math.max(0.05, mData.radius / 10000), 16, 16);
                const moonMat = new THREE.MeshStandardMaterial({ color: mData.color || '#aaaaaa', roughness: 0.7, metalness: 0.1 });
                const moonMesh = new THREE.Mesh(moonGeo, moonMat);
                const moonOrbit = mData.orbitRadius || 3;
                const moonSpeed = mData.orbitSpeed || 1;
                const moonAngle = Math.random() * Math.PI * 2;
                moonMesh.userData = {
                    planetKey: pInfo.key, moonKey, orbitRadius: moonOrbit,
                    orbitSpeed: moonSpeed, angle: moonAngle, name: mData.name || '卫星',
                };
                galaxyGroup.add(moonMesh);
                createdKeys.push(moonKey);
                if (!this.planets[moonKey]) {
                    this.planets[moonKey] = { key: moonKey, name: mData.name || '卫星', mesh: moonMesh, isMoon: true };
                }
            });
        });

        // 注册到 SystemManager
        if (this.systemManager) {
            this.systemManager.registerSystemGroup(galaxyId, galaxyGroup, createdKeys);
        }

        this._customBodies.push({ galaxyId, keys: createdKeys });
    }

    /** 页面加载时恢复所有自定义星系的天体实例（服务器 + localStorage） */
    async restoreCustomGalaxies() {
        // 1) 优先从服务器加载星系模块
        try {
            const { fetchServerGalaxies } = await import('./galaxyRegistry.js');
            const serverGalaxies = await fetchServerGalaxies();
            const knownPlanetKeys = new Set(Object.keys(this.planets));

            for (const sg of serverGalaxies) {
                // 跳过内置星系（已通过静态导入创建）
                const builtInFolderIds = ['solar-system', 'solar system', 'hd-219134'];
                if (builtInFolderIds.includes(sg.id)) continue;
                // 跳过已存在的
                if (knownPlanetKeys.has(sg.id) || knownPlanetKeys.has(sg.id + '_star')) continue;

                try {
                    const modPath = `../Galaxy/custom/${sg.id}/index.js?t=${Date.now()}`;
                    const mod = await import(modPath);
                    if (mod.createPlanets) {
                        const newBodies = mod.createPlanets(this.scene, this.planets);
                        for (const key of Object.keys(newBodies)) {
                            this.planets[key] = newBodies[key];
                        }
                        this._customBodies.push({
                            galaxyId: sg.id,
                            keys: Object.keys(newBodies),
                        });
                        // 注册到系统管理器
                        if (this.systemManager && mod.createPlanets) {
                            this.systemManager.registerModule(sg.id, mod.createPlanets, mod.MOON_CLASSES);
                        }
                        console.log(`[GalaxyBrowser] 从服务器加载星系模块: ${sg.id}`);
                    }
                } catch (e) {
                    console.warn(`[GalaxyBrowser] 加载服务器星系 ${sg.id} 失败:`, e.message);
                }
            }
        } catch (e) {
            // 服务器不可用，忽略
        }

        // 2) 回退：从 localStorage 恢复自定义星系
        const allGalaxies = getAllGalaxies();
        const localGalaxies = allGalaxies.filter(g => !g.isBuiltIn && !this.planets[g.id + '_star']);

        localGalaxies.forEach(g => {
            const starInfo = g.planets?.find(p => p.isStar);
            const planetInfos = g.planets?.filter(p => !p.isStar) || [];

            if (!starInfo) return;

            const starMass = starInfo.mass;
            const starSIPos = starInfo._siPosition || {
                x: starInfo.orbitRadius || 50 * 1.496e11,
                y: 0,
                z: 0,
            };

            this._instantiateGalaxy(g.id, starSIPos, starInfo, planetInfos, starMass);
        });

        if (localGalaxies.length > 0) {
            console.log(`[GalaxyBrowser] 从 localStorage 恢复了 ${localGalaxies.length} 个自定义星系`);
        }
    }

    /** 删除自定义星系的所有天体 */
    _deleteGalaxyBodies(galaxyId) {
        const entry = this._customBodies.find(c => c.galaxyId === galaxyId);
        if (!entry) return;

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
        }

        entry.keys.forEach(key => {
            const body = this.planets[key];
            if (body) {
                this.physics.removeBody(body);
                body.dispose();
                delete this.planets[key];
            }
        });

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
