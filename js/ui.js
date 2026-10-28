// ============================================================
// ui.js — 点击星球/卫星弹出卡片（CRT特效）、详情弹窗、探测器按钮
// ============================================================

import * as THREE from 'three';
import { screenToNDC, colorToHex } from './utils.js';
import { formatMass, formatDiameter, AU } from './constants.js';
import { legacyDetailsToTree } from './DetailTreeEditor.js?v=3';
import {
    getAllUniverseSystems,
    loadBodyRelations,
    loadUniverseGalaxies,
    resolveSystemGalaxyId,
    DEFAULT_GALAXY_ID,
} from './UniverseRegistry.js?v=7';

export class UIManager {
    /**
     * @param {THREE.Camera} camera
     * @param {HTMLCanvasElement} canvas
     * @param {object} planets
     * @param {object} allMoons     - { parentKey: [moonObjects] }
     * @param {function} onBodyClick - 回调 (body, moonData|null)
     * @param {function} onDismiss
     * @param {function} onProbe    - 回调 (body, moonData|null)
     * @param {function} onRecall   - 回调 收回探测器
     * @param {function} onSurface  - 回调 (planetKey, moonKey|null) 查看地表
     */
    constructor(camera, canvas, planets, allMoons, onBodyClick, onDismiss, onProbe, onRecall, onSpeak, onSurface) {
        this.camera = camera;
        this.canvas = canvas;
        this.planets = planets;
        this.allMoons = allMoons || {};
        this.onBodyClick = onBodyClick || (() => {});
        this.onDismiss = onDismiss || (() => {});
        this.onProbe = onProbe || (() => {});
        this.onRecall = onRecall || (() => {});
        this.onSpeak = onSpeak || (() => {});
        this.onSurface = onSurface || (() => {});

        this.raycaster = new THREE.Raycaster();
        this.raycaster.params.Points.threshold = 0.5;

        // 详情 txt 内容缓存（WeakMap，避免把正文写进 detailTree / localStorage）
        this._detailContentCache = new WeakMap();

        // DOM
        this.card = document.getElementById('planet-card');
        this.modal = document.getElementById('detail-modal');
        this.modalTitle = document.getElementById('modal-planet-title');
        this.modalBody = document.getElementById('modal-planet-body');
        this.modalClose = document.getElementById('modal-close-btn');
        this.crtOverlay = document.getElementById('crt-overlay');
        this.crtScanlines = document.getElementById('crt-scanlines');

        // 探测器按钮
        this.recallBtn = document.getElementById('recall-btn');
        this.speakBtn = document.getElementById('speak-btn');
        this.surfaceBtn = document.getElementById('card-surface-btn');

        this.activePlanet = null;
        this.activeMoon = null;
        this.cardVisible = false;
        this._clickDisabled = false;

        // 关联星体：由 main.js 注入当前系统 / 跳转能力
        this._relationContext = null;
        this._detailRelationToken = 0;

        this._bindEvents();
    }

    _bindEvents() {
        this.canvas.addEventListener('click', (e) => this._onClick(e));

        this.card.addEventListener('click', (e) => e.stopPropagation());

        this.card.querySelector('.card-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            const sm = window.__soundManager;
            if (sm && sm.isReady()) sm.play('cardAction', { volume: 0.3 });
            if (this.activePlanet) {
                this.showDetailModal(this.activePlanet, this.activeMoon);
            }
        });

        this.recallBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.onRecall();
        });

        this.speakBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.activePlanet) this.onSpeak(this.activePlanet);
        });

        // 查看地表（卡片内，位于“访问星球内部数据库”下方）
        this.surfaceBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!this.activePlanet) return;
            this.onSurface(this.activePlanet.key, this.activeMoon?.key || null);
        });

        this.modalClose.addEventListener('click', () => this.hideDetailModal());
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) this.hideDetailModal();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.hideDetailModal();
        });
    }

    /** 临时禁用点击（手动发射模式） */
    setClickDisabled(disabled) { this._clickDisabled = disabled; }

    /**
     * 注入“关联星体”所需的上下文
     * @param {object} ctx
     * @param {function} ctx.getSystemId   — () => 当前星体系统 id
     * @param {function} ctx.navigateToBody — (systemId, bodyKey) => void
     */
    setRelationContext(ctx) {
        this._relationContext = ctx || null;
    }

    /** 显示/隐藏收回探测器按钮 */
    setRecallVisible(visible) {
        if (this.recallBtn) {
            if (visible) this.recallBtn.classList.add('visible');
            else this.recallBtn.classList.remove('visible');
        }
    }

    // ---------- 点击处理 ----------
    _onClick(event) {
        if (this._clickDisabled) return;
        if (document.pointerLockElement) return;
        const { x, y } = screenToNDC(event, this.canvas);
        this.raycaster.setFromCamera(new THREE.Vector2(x, y), this.camera);

        // 收集所有可点击的 mesh
        const meshes = [];
        for (const planet of Object.values(this.planets)) {
            if (planet.mesh) meshes.push(planet.mesh);
        }
        // 卫星 mesh
        for (const moons of Object.values(this.allMoons)) {
            for (const m of moons) {
                if (m.mesh) meshes.push(m.mesh);
            }
        }

        const intersects = this.raycaster.intersectObjects(meshes, false);

        if (intersects.length > 0) {
            const obj = intersects[0].object;
            const isMoon = obj.userData?.isMoon;
            const parentKey = obj.userData?.parentKey;
            const moonData = isMoon ? obj.userData?.moonData : null;

            let body;
            if (isMoon && parentKey) {
                body = this.planets[parentKey];
            } else {
                body = obj.userData?.celestialBody;
            }
            if (body) {
                this.activePlanet = body;
                this.activeMoon = moonData;
                this._showCard(body, moonData);
                this.onBodyClick(body, moonData);
                return;
            }
        }

        // 点击空白 → 关闭卡片并通知外层退出聚焦
        this.hideCard();
        this.onDismiss();
    }

    // ---------- 卡片 ----------
    _showCard(body, moonData) {
        const titleEl = this.card.querySelector('.card-title-text');
        const nameEl = this.card.querySelector('.card-name-cn');
        const infoEl = this.card.querySelector('.card-info');
        const colorDot = this.card.querySelector('.card-dot');

        if (moonData) {
            titleEl.textContent = moonData.nameCN || moonData.key;
            nameEl.textContent = moonData.name;
            colorDot.style.background = moonData.color || '#888';
            infoEl.innerHTML = this._buildCardParams(moonData, true);
        } else {
            titleEl.textContent = body.nameCN || body.key;
            nameEl.textContent = body.name;
            colorDot.style.background = colorToHex(body.color);
            infoEl.innerHTML = this._buildCardParams(body, false);
        }

        // 卫星列表
        this._populateMoons(body);

        // 星球选中音效
        const sm = window.__soundManager;
        if (sm && sm.isReady()) sm.play('planetSelect', { volume: 0.35 });

        // CRT 动画
        this.crtOverlay.classList.add('active');
        this.crtScanlines.classList.add('active');
        setTimeout(() => {
            this.crtOverlay.classList.remove('active');
            this.crtScanlines.classList.remove('active');
        }, 300);

        this.card.classList.add('visible');
        this.cardVisible = true;
    }

    /** 填充卫星列表 */
    _populateMoons(body) {
        const toggle = document.getElementById('card-moons-btn');
        const list = document.getElementById('card-moons-list');
        const wrap = document.querySelector('.card-moons-toggle');
        if (!toggle || !list || !wrap) return;

        wrap.style.display = '';
        const moons = this.allMoons[body.key];
        if (!moons || moons.length === 0) {
            list.innerHTML = '<div class="moon-item" style="opacity:0.4">暂无卫星数据</div>';
        } else {
            list.innerHTML = moons.map((m, i) => {
                const name = m.name || m.key || ('卫星' + i);
                const info = m.radius ? 'R=' + (m.radius / 1000).toFixed(0) + 'km' : '--';
                return '<div class="moon-item">' +
                    '<span class="moon-name">🌙 ' + name + '</span>' +
                    '<span class="moon-info">' + info + '</span>' +
                    '<button class="moon-btn" data-moon-i="' + i + '">🔍 详情</button>' +
                    '<button class="moon-btn" data-moon-i="' + i + '">🖼 地表</button>' +
                '</div>';
            }).join('');
        }

        toggle.onclick = () => {
            const open = list.style.display !== 'none';
            list.style.display = open ? 'none' : '';
            toggle.querySelector('.moons-arrow').textContent = open ? '▸' : '▾';
        };

        list.querySelectorAll('.moon-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.dataset.moonI);
                const m = moons[idx];
                if (!m) return;
                if (btn.textContent.includes('详情')) {
                    this.showDetailModal(body, m);
                } else if (btn.textContent.includes('地表')) {
                    this.onSurface(body.key, m.key);
                }
            });
        });
    }

    hideCard() {
        this.card.classList.remove('visible');
        this.cardVisible = false;
        this.activePlanet = null;
        this.activeMoon = null;
    }

    // ---------- 详情弹窗 ----------
    showDetailModal(body, moonData) {
        let title, bodyHTML;
        let info;
        if (moonData) {
            title = moonData.name;
            info = moonData;
            bodyHTML = this._buildMoonDetail(info);
        } else {
            title = body.nameCN || body.name;
            info = body;
            bodyHTML = this._buildPlanetDetail(info);
        }

        this.modalTitle.textContent = title;
        this.modalBody.innerHTML = bodyHTML;

        this._bindDetailTree();
        this.modal.classList.add('show');

        // 卫星不参与星体级关联，只有星体（恒星/行星）显示关联区域
        this._detailRelationToken++;
        if (!moonData) this._renderDetailRelations(info);
    }

    hideDetailModal() {
        this._detailRelationToken++;
        this.modal.classList.remove('show');
    }

    /** 星体卡片中的基本参数（从原详情弹窗搬来） */
    _buildCardParams(info, isMoon) {
        const row = (label, value) =>
            `<div class="cp-row"><span class="cp-label">${label}</span><span class="cp-value">${value}</span></div>`;
        const rows = [];

        if (info.mass) rows.push(row('质量', formatMass(info.mass)));

        if (isMoon) {
            const dia = info.diameter
                || (info.radius ? (info.radius / 1000).toFixed(0) + ' km' : '--');
            rows.push(row('直径', dia));
        } else {
            if (info.realRadius) rows.push(row('半径', formatDiameter(info.realRadius)));
            const orbitAU = (Number(info.orbitRadius) || 0) / AU;
            rows.push(row('轨道半径', orbitAU.toFixed(2) + ' AU'));
        }

        const colorHex = isMoon ? (info.color || '#888888') : colorToHex(info.color);
        rows.push(row('颜色',
            `<i class="cp-color" style="background:${colorHex}"></i>${colorHex}`));

        return rows.join('');
    }

    _buildPlanetDetail(body) {
        return `
            <p class="section-title">🗂 星球内部数据库</p>
            ${this._buildDetailTreeSection(body, body.details)}
            <p class="section-title">🔗 关联星体</p>
            <div class="detail-relations" id="detail-relations">
                <div class="dr-empty">关联加载中…</div>
            </div>
        `;
    }

    _buildMoonDetail(info) {
        return `
            <p class="section-title">🗂 卫星内部数据库</p>
            ${this._buildDetailTreeSection(info, info.details)}
        `;
    }

    // ---------- 关联星体 ----------

    /** 渲染“关联星体”区域：主动关联 / 被动关联，路径格式 星系/星体系统/星体 */
    async _renderDetailRelations(body) {
        const wrap = this.modalBody.querySelector('#detail-relations');
        if (!wrap) return;

        const token = this._detailRelationToken;
        const systemId = this._relationContext?.getSystemId?.() || null;
        const bodyKey = body?.key;
        if (!systemId || !bodyKey) {
            wrap.innerHTML = '<div class="dr-empty">无法确定当前星体所属系统</div>';
            return;
        }

        const [relRes, galRes] = await Promise.allSettled([
            loadBodyRelations(),
            loadUniverseGalaxies(),
        ]);
        if (token !== this._detailRelationToken) return;

        const relations = relRes.status === 'fulfilled' && Array.isArray(relRes.value) ? relRes.value : [];
        const galaxies = galRes.status === 'fulfilled' && Array.isArray(galRes.value) && galRes.value.length
            ? galRes.value
            : [{ id: DEFAULT_GALAXY_ID, name: '银河系' }];

        const active = relations.filter(r => r.fromSystemId === systemId && r.fromKey === bodyKey);
        const passive = relations.filter(r => r.toSystemId === systemId && r.toKey === bodyKey);
        if (!active.length && !passive.length) {
            wrap.innerHTML = '<div class="dr-empty">该星体暂无关联星体</div>';
            return;
        }

        const systemById = new Map(getAllUniverseSystems().map(s => [s.id, s]));
        const galaxyById = new Map(galaxies.map(g => [g.id, g]));

        /** 把关联的另一端解析成 星系 / 星体系统 / 星体 */
        const resolveEnd = (sysId, key, fallbackName) => {
            const sys = systemById.get(sysId);
            const galaxyId = sys ? resolveSystemGalaxyId(sys, galaxies) : DEFAULT_GALAXY_ID;
            const galaxy = galaxyById.get(galaxyId);
            const info = (sys?.planets || []).find(p => p.key === key);
            return {
                systemId: sysId,
                key,
                galaxyName: galaxy?.name || (galaxyId === DEFAULT_GALAXY_ID ? '银河系' : galaxyId),
                systemName: sys?.name || sysId,
                bodyName: info?.name || fallbackName || key,
                exists: !!sys,
            };
        };

        wrap.innerHTML = [
            this._relationGroupHtml(
                '主动关联', '本星体 → 其它星体', false,
                active.map(r => resolveEnd(r.toSystemId, r.toKey, r.toName)),
            ),
            this._relationGroupHtml(
                '被动关联', '其它星体 → 本星体', true,
                passive.map(r => resolveEnd(r.fromSystemId, r.fromKey, r.fromName)),
            ),
        ].join('');

        wrap.querySelectorAll('.dr-body-link').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const systemId2 = btn.dataset.drSystem;
                const key2 = btn.dataset.drKey;
                if (!systemId2 || !key2) return;
                this._relationContext?.navigateToBody?.(systemId2, key2);
            });
        });
    }

    _relationGroupHtml(title, note, passive, items) {
        const rows = items.length
            ? items.map(it => {
                const name = this._escapeHtml(it.bodyName);
                const bodyHtml = it.exists
                    ? `<button class="dr-body-link"
                               data-dr-system="${this._escapeAttr(it.systemId)}"
                               data-dr-key="${this._escapeAttr(it.key)}"
                               title="跳转到 ${this._escapeAttr(it.systemName)} · ${this._escapeAttr(it.bodyName)}">${name}<span class="dr-go">↗</span></button>`
                    : `<span class="dr-body-name" title="该星体所在的星体系统已被删除">${name}</span>`;
                return `
                    <div class="dr-item">
                        <span class="dr-path">
                            <span class="dr-galaxy">${this._escapeHtml(it.galaxyName)}</span>
                            <span class="dr-sep">/</span>
                            <span class="dr-system">${this._escapeHtml(it.systemName)}</span>
                            <span class="dr-sep">/</span>
                            ${bodyHtml}
                        </span>
                        ${it.exists ? '' : '<span class="dr-missing">系统已不存在</span>'}
                    </div>
                `;
            }).join('')
            : `<div class="dr-empty">${passive ? '暂无被动关联' : '暂无主动关联'}</div>`;

        return `
            <div class="dr-group ${passive ? 'is-passive' : 'is-active'}">
                <div class="dr-title">
                    <span>${title}</span>
                    <small>${note}</small>
                    <span class="dr-count">${items.length} 条</span>
                </div>
                <div class="dr-list">${rows}</div>
            </div>
        `;
    }

    // ---------- 文件夹式详情 ----------

    /**
     * 渲染详情文件夹树（恒星/行星/卫星通用）
     * 旧数据只有纯文本 details 时，自动包装为“详情/简介.txt”
     */
    _buildDetailTreeSection(info, fallbackDetails) {
        const tree = (Array.isArray(info?.detailTree) && info.detailTree.length)
            ? info.detailTree
            : legacyDetailsToTree(fallbackDetails);
        if (!tree || tree.length === 0) {
            return '<p class="detail-empty">暂无详细信息</p>';
        }
        const nodes = [];
        const filesHTML = tree.map(node => this._buildDetailNode(node, 1, nodes)).join('');
        this._detailNodes = nodes;
        return `
            <div class="detail-tree">
                <div class="detail-tree-files">${filesHTML}</div>
                <div class="detail-file-viewer">
                    <div class="dfv-placeholder">点击左侧 .txt 或图片文件查看内容</div>
                </div>
            </div>
        `;
    }

    _buildDetailNode(node, level, nodes) {
        if (!node || !node.type) return '';
        const id = nodes.length;
        nodes.push(node);
        const name = this._escapeHtml(node.name || '未命名');
        const pad = 6 + (level - 1) * 16;

        if (node.type === 'folder') {
            const open = level === 1;
            const children = Array.isArray(node.children) ? node.children : [];
            return `
                <div class="dt-node">
                    <div class="dt-row dt-folder" data-dt-id="${id}" data-dt-kind="folder" style="padding-left:${pad}px">
                        <span class="dt-arrow">${open ? '▾' : '▸'}</span>
                        <span class="dt-icon">${open ? '📂' : '📁'}</span>
                        <span class="dt-name">${name}</span>
                    </div>
                    <div class="dt-children"${open ? '' : ' style="display:none"'}>
                        ${children.map(c => this._buildDetailNode(c, level + 1, nodes)).join('')}
                    </div>
                </div>
            `;
        }

        const isImage = node.type === 'image';
        return `
            <div class="dt-node">
                <div class="dt-row dt-file" data-dt-id="${id}" data-dt-kind="file" style="padding-left:${pad}px">
                    <span class="dt-arrow"></span>
                    <span class="dt-icon">${isImage ? '🖼' : '📄'}</span>
                    <span class="dt-name">${name}</span>
                </div>
            </div>
        `;
    }

    _bindDetailTree() {
        const root = this.modalBody.querySelector('.detail-tree');
        if (!root) return;
        const viewer = root.querySelector('.detail-file-viewer');

        root.querySelectorAll('.dt-row').forEach(row => {
            row.addEventListener('click', (e) => {
                e.stopPropagation();
                if (row.dataset.dtKind === 'folder') {
                    const wrap = row.closest('.dt-node');
                    const children = wrap?.querySelector('.dt-children');
                    if (!children) return;
                    const isOpen = children.style.display !== 'none';
                    children.style.display = isOpen ? 'none' : '';
                    row.querySelector('.dt-arrow').textContent = isOpen ? '▸' : '▾';
                    row.querySelector('.dt-icon').textContent = isOpen ? '📁' : '📂';
                    return;
                }
                const node = this._detailNodes?.[Number(row.dataset.dtId)];
                if (node) this._showDetailFile(viewer, node);
                root.querySelectorAll('.dt-row.active').forEach(r => r.classList.remove('active'));
                row.classList.add('active');
            });
        });
    }

    async _showDetailFile(viewer, node) {
        if (!viewer) return;
        if (node.type === 'image') {
            if (!node.url) {
                viewer.innerHTML = '<div class="dfv-placeholder">图片不可用</div>';
                return;
            }
            viewer.innerHTML = `<div class="dfv-title">🖼 ${this._escapeHtml(node.name)}</div>` +
                `<img class="dfv-image" src="${this._escapeAttr(node.url)}" alt="${this._escapeAttr(node.name)}">`;
            return;
        }

        viewer.innerHTML = '<div class="dfv-placeholder">加载中…</div>';
        let content = node.content;
        if (content === undefined) content = this._detailContentCache.get(node);
        if (content === undefined) {
            try {
                if (node.url) {
                    const resp = await fetch(node.url);
                    content = resp.ok ? await resp.text() : '';
                } else {
                    content = '';
                }
            } catch {
                content = '';
            }
            this._detailContentCache.set(node, content);
        }
        // 用户可能已经点了别的文件
        if (!viewer.isConnected) return;
        viewer.innerHTML = `<div class="dfv-title">📄 ${this._escapeHtml(node.name)}</div>` +
            `<pre class="dfv-text">${this._escapeHtml(content || '（空文件）')}</pre>`;
    }

    _escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    _escapeAttr(str) {
        return this._escapeHtml(str).replace(/`/g, '&#96;');
    }
}
