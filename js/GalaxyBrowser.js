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
            <div class="galaxy-browser-panel">
                <div class="galaxy-browser-header">
                    <span>🌌 单恒星系统浏览器</span>
                    <button class="galaxy-browser-close" id="galaxy-browser-close">&times;</button>
                </div>
                <div class="galaxy-browser-search">
                    <span class="galaxy-search-icon">🔍</span>
                    <input type="text" id="galaxy-search-input" placeholder="搜索单恒星系统或星球（关键词）..." autocomplete="off" />
                </div>
                <div class="galaxy-browser-list" id="galaxy-browser-list">
                    <div class="galaxy-browser-empty">加载中...</div>
                </div>
                <div class="galaxy-browser-footer">
                    <button class="galaxy-browser-add-btn" id="galaxy-browser-add-btn">➕ 添加单恒星系统</button>
                    <button class="galaxy-browser-add-btn" id="galaxy-browser-exoplanet-btn" style="display:none;">🪐 添加系外行星（开发中）</button>
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

    async _confirmCreateGalaxy() {
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
        const starTexBase64 = await this._fileToBase64(starTexFile);

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

            planetEntries.push({
                name: pName,
                mass: pMass,
                radius: pRadius * 1000,
                orbitRadius: pOrbit * AU,
                visualRadius: pVisual,
                color: pColor,
                textureData: pTexBase64 || null,
                textureName: pTexFile?.name || null,
            });
        }

        // --- 尝试通过服务器创建星系文件夹 ---
        const serverResult = await createGalaxyOnServer({
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
            },
            planets: planetEntries,
        });

        if (serverResult.ok) {
            console.log(`[GalaxyBrowser] 服务器创建星系成功: ${serverResult.id}`);

            // 动态导入新创建的模块
            try {
                const modulePath = `../Galaxy/${serverResult.id}/index.js?t=${Date.now()}`;
                const galaxyModule = await import(modulePath);

                // 注册为模块供 SystemManager 使用
                if (this.systemManager) {
                    this.systemManager.registerModule(serverResult.id, galaxyModule.createPlanets, galaxyModule.MOON_CLASSES);
                    // 切换到新系统
                    this.onNavigateToGalaxy(serverResult.id);
                }

                // 也保存到 localStorage（冗余备份）
                const starSIPos = { x: starPosX * AU, y: starPosY * AU, z: starPosZ * AU };
                const allPlanetInfos = [
                    {
                        key: serverResult.id + '_star',
                        name: starName, nameCN: starName,
                        mass: starMass, radius: starRadius * 1000, orbitRadius: 0,
                        visualRadius: starVisual, color: starColor,
                        isStar: true, _siPosition: starSIPos,
                        details: `${starName} — ${galaxyName}的中心恒星。`,
                        voiceIntro: '',
                    },
                    ...planetEntries.map((p, i) => ({
                        key: serverResult.id + '_planet_' + i,
                        name: p.name, nameCN: p.name,
                        mass: p.mass, radius: p.radius, orbitRadius: p.orbitRadius,
                        visualRadius: p.visualRadius, color: p.color,
                        isStar: false,
                        details: `${p.name} — ${galaxyName}的行星。`,
                        voiceIntro: '',
                    })),
                ];
                addCustomGalaxy({
                    name: galaxyName, nameCN: galaxyNameCN,
                    description: galaxyDesc, icon: '🌟',
                    planets: allPlanetInfos,
                });

                console.log(`[GalaxyBrowser] 星系 "${galaxyName}" 创建完成`);
            } catch (importErr) {
                console.error('[GalaxyBrowser] 动态导入星系模块失败:', importErr);
                // 回退到传统的 localStorage + 直接实例化
                this._fallbackCreate(galaxyName, galaxyNameCN, galaxyDesc,
                    starName, starMass, starRadius, starColor, starVisual,
                    starPosX, starPosY, starPosZ, planetEntries);
            }
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

        const starPlanetInfo = {
            key: starKey, name: starName, nameCN: starName,
            mass: starMass, radius: starRadius, orbitRadius: 0,
            visualRadius: starVisual, color: starColor,
            details: `${starName} — ${galaxyName}的中心恒星。`,
            voiceIntro: '', isStar: true, _siPosition: starSIPos,
        };

        const planetInfos = planetEntries.map((p, i) => ({
            key: galaxyId + '_planet_' + i,
            name: p.name, nameCN: p.name,
            mass: p.mass, radius: p.radius, orbitRadius: p.orbitRadius,
            visualRadius: p.visualRadius, color: p.color,
            details: `${p.name} — ${galaxyName}的行星。`,
            voiceIntro: '', isStar: false,
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
                    const modPath = `../Galaxy/${sg.id}/index.js?t=${Date.now()}`;
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
