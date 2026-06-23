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
} from './galaxyRegistry.js';
import { AU } from './constants.js';

export class GalaxyBrowser {
    /**
     * @param {object}   deps
     * @param {object}   deps.planets    — 当前所有星球实例 { key: CelestialBody }
     * @param {object}   deps.physics    — PhysicsEngine 实例
     * @param {THREE.Scene} deps.scene   — 主场景
     * @param {function} deps.onFocusBody — 回调 (bodyKey) 聚焦星球
     * @param {function} deps.onNavigateToGalaxy — 回调 (galaxyId) 导航到星系视图
     * @param {function} deps.onRefreshOrbits — 回调 重绘轨道线
     */
    constructor(deps) {
        this.planets         = deps.planets;
        this.physics         = deps.physics;
        this.scene           = deps.scene;
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
            <div class="galaxy-browser-panel">
                <div class="galaxy-browser-header">
                    <span>🌌 星系浏览器</span>
                    <button class="galaxy-browser-close" id="galaxy-browser-close">&times;</button>
                </div>
                <div class="galaxy-browser-search">
                    <span class="galaxy-search-icon">🔍</span>
                    <input type="text" id="galaxy-search-input" placeholder="搜索星系或星球（关键词）..." autocomplete="off" />
                </div>
                <div class="galaxy-browser-list" id="galaxy-browser-list">
                    <div class="galaxy-browser-empty">加载中...</div>
                </div>
                <div class="galaxy-browser-footer">
                    <button class="galaxy-browser-add-btn" id="galaxy-browser-add-btn">➕ 添加新星系</button>
                </div>
            </div>
        `;
        document.body.appendChild(this.overlay);

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
                <span>➕ 创建新星系</span>
                <button class="add-galaxy-close" id="ag-close">&times;</button>
            </div>
            <div class="add-galaxy-body">
                <div class="ag-section">
                    <div class="ag-section-title">🌌 星系信息</div>
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
                <button id="ag-confirm" class="ag-confirm-btn">🚀 创建星系并发射入轨</button>
            </div>
        </div>`;
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

        // --- ESC 关闭 ---
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (!this.addModal.classList.contains('hidden')) {
                    this.addModal.classList.add('hidden');
                } else if (!this.overlay.classList.contains('hidden')) {
                    this.hide();
                }
            }
        });
    }

    // ==================== 显示/隐藏 ====================
    show() {
        this.overlay.classList.remove('hidden');
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
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const galaxyId = btn.dataset.galaxyId;
                if (confirm('确定要删除这个星系及其所有天体吗？')) {
                    this._deleteGalaxyBodies(galaxyId);
                    deleteCustomGalaxy(galaxyId);
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
        <div class="gb-galaxy-card" data-galaxy-id="${g.id}">
            <div class="gb-galaxy-header">
                <span class="gb-galaxy-icon">${g.icon || '🌟'}</span>
                <div class="gb-galaxy-info">
                    <span class="gb-galaxy-name">${g.name}</span>
                    <span class="gb-galaxy-name-cn">${g.nameCN}</span>
                </div>
                <span class="gb-galaxy-count">${planetCount} 天体</span>
                ${g.isBuiltIn ? '<span class="gb-badge-builtin">内置</span>' : `<button class="gb-delete-galaxy" data-galaxy-id="${g.id}" title="删除星系">🗑</button>`}
            </div>
            <div class="gb-galaxy-desc">${g.description}</div>
            <div class="gb-planet-list">
                ${starPlanet ? `
                <div class="gb-planet-item gb-planet-star" data-planet-key="${starPlanet.key}">
                    <span class="gb-planet-dot" style="background:${starPlanet.color}"></span>
                    <span>${starPlanet.name}</span>
                    <span class="gb-planet-tag">恒星</span>
                </div>` : ''}
                ${otherPlanets.map(p => `
                <div class="gb-planet-item" data-planet-key="${p.key}">
                    <span class="gb-planet-dot" style="background:${p.color}"></span>
                    <span>${p.name}</span>
                    <span class="gb-planet-tag">${(p.mass / 1e24).toFixed(1)}e24 kg</span>
                </div>`).join('')}
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
        `;
        // 移除空状态提示
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
    }

    _randomPlanetColor() {
        const colors = ['#e07040', '#4488ff', '#d4b896', '#e8d5a3', '#7ec8e3', '#4060ff', '#b0b0b0', '#e8cda0', '#88cc88', '#cc88cc'];
        return colors[Math.floor(Math.random() * colors.length)];
    }

    _confirmCreateGalaxy() {
        // --- 读取星系信息 ---
        const galaxyName   = document.getElementById('ag-name').value.trim() || '新星系';
        const galaxyNameCN = document.getElementById('ag-name-cn').value.trim() || 'New Galaxy';
        const galaxyDesc   = document.getElementById('ag-desc').value.trim() || '';

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
        const starTexPath = starTexFile ? URL.createObjectURL(starTexFile) : null;

        // 恒星在 SI 空间中的位置
        const starSIPos = {
            x: starPosX * AU,
            y: starPosY * AU,
            z: starPosZ * AU,
        };

        // --- 生成 key ---
        const galaxyId = 'custom_galaxy_' + Date.now();
        const starKey = galaxyId + '_star';

        // --- 构建恒星数据 ---
        const starPlanetInfo = {
            key: starKey,
            name: starName,
            nameCN: starName,
            mass: starMass,
            radius: starRadius * 1000,
            orbitRadius: 0,
            visualRadius: starVisual,
            color: starColor,
            texturePath: starTexPath,
            details: `${starName} — ${galaxyName}的中心恒星。\n质量：${(starMass / 1.989e30).toFixed(2)} M☉\n半径：${starRadius.toLocaleString()} km`,
            voiceIntro: '',
            isStar: true,
            _siPosition: starSIPos,
        };

        // --- 读取行星信息 ---
        const planetInfos = [];
        const planetRows = this.agPlanetList.querySelectorAll('.ag-planet-row');
        planetRows.forEach(row => {
            const pName   = row.querySelector('.ag-p-name').value.trim() || '行星';
            const pMass   = parseFloat(row.querySelector('.ag-p-mass').value) || 5.97e24;
            const pRadius = parseFloat(row.querySelector('.ag-p-radius').value) || 6371;
            const pOrbit  = parseFloat(row.querySelector('.ag-p-orbit').value) || 1.0;
            const pColor  = row.querySelector('.ag-p-color').value || '#ff8844';
            const pVisual = parseFloat(row.querySelector('.ag-p-visual').value) || 0.5;
            const pTexFile = row.querySelector('.ag-p-texture')?.files?.[0];
            const pTexPath = pTexFile ? URL.createObjectURL(pTexFile) : null;

            const pKey = galaxyId + '_planet_' + planetInfos.length;
            planetInfos.push({
                key: pKey,
                name: pName,
                nameCN: pName,
                mass: pMass,
                radius: pRadius * 1000,
                orbitRadius: pOrbit * AU,
                visualRadius: pVisual,
                color: pColor,
                texturePath: pTexPath,
                details: `${pName} — ${galaxyName}的行星。\n质量：${(pMass / 1e24).toFixed(1)}×10²⁴ kg\n轨道半径：${pOrbit} AU`,
                voiceIntro: '',
                isStar: false,
            });
        });

        // --- 注册到 galaxyRegistry ---
        const allPlanetInfos = [starPlanetInfo, ...planetInfos];
        const galaxyData = {
            name: galaxyName,
            nameCN: galaxyNameCN,
            description: galaxyDesc,
            icon: '🌟',
            planets: allPlanetInfos,
        };
        addCustomGalaxy(galaxyData);

        // --- 创建 Three.js 天体实例 ---
        this._instantiateGalaxy(galaxyId, starSIPos, starPlanetInfo, planetInfos, starMass);

        // --- 关闭模态框 & 刷新列表 ---
        this.addModal.classList.add('hidden');
        this._renderList();

        console.log(`[GalaxyBrowser] 星系 "${galaxyName}" 创建完成，${allPlanetInfos.length} 个天体`);
    }

    /** 将星系数据实例化为 CelestialBody 并加入物理引擎 */
    _instantiateGalaxy(galaxyId, starSIPos, starInfo, planetInfos, starMass) {
        const createdKeys = [];

        // --- 创建恒星 ---
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
            scene: this.scene,
        });
        starBody.position.set(starSIPos.x, starSIPos.y, starSIPos.z);
        starBody.velocity.set(0, 0, 0);
        starBody._syncMeshPosition();

        this.planets[starInfo.key] = starBody;
        this.physics.addBody(starBody);
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
                scene: this.scene,
            });

            // 位置 = 恒星位置 + 轨道偏移（XZ 平面）
            const orbitR = pInfo.orbitRadius;
            body.position.set(
                starSIPos.x + orbitR,
                starSIPos.y,
                starSIPos.z,
            );

            // 设置圆形轨道速度（绕恒星）
            body.setCircularOrbitVelocity(starMass);
            body._syncMeshPosition();

            this.planets[pInfo.key] = body;
            this.physics.addBody(body);
            createdKeys.push(pInfo.key);
        });

        // 追踪
        this._customBodies.push({ galaxyId, keys: createdKeys });
    }

    /** 页面加载时恢复所有自定义星系的天体实例 */
    restoreCustomGalaxies() {
        const allGalaxies = getAllGalaxies();
        const customGalaxies = allGalaxies.filter(g => !g.isBuiltIn);

        customGalaxies.forEach(g => {
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

        if (customGalaxies.length > 0) {
            console.log(`[GalaxyBrowser] 恢复了 ${customGalaxies.length} 个自定义星系`);
        }
    }

    /** 删除自定义星系的所有天体 */
    _deleteGalaxyBodies(galaxyId) {
        const entry = this._customBodies.find(c => c.galaxyId === galaxyId);
        if (!entry) return;

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
}
