// ============================================================
// ui.js — 点击星球/卫星弹出卡片（CRT特效）、详情弹窗、探测器按钮
// ============================================================

import * as THREE from 'three';
import { screenToNDC, colorToHex } from './utils.js';
import { formatMass, formatDiameter } from './constants.js';

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
     */
    constructor(camera, canvas, planets, allMoons, onBodyClick, onDismiss, onProbe, onRecall, onSpeak) {
        this.camera = camera;
        this.canvas = canvas;
        this.planets = planets;
        this.allMoons = allMoons || {};
        this.onBodyClick = onBodyClick || (() => {});
        this.onDismiss = onDismiss || (() => {});
        this.onProbe = onProbe || (() => {});
        this.onRecall = onRecall || (() => {});
        this.onSpeak = onSpeak || (() => {});

        this.raycaster = new THREE.Raycaster();
        this.raycaster.params.Points.threshold = 0.5;

        // DOM
        this.card = document.getElementById('planet-card');
        this.modal = document.getElementById('detail-modal');
        this.modalTitle = document.getElementById('modal-planet-title');
        this.modalBody = document.getElementById('modal-planet-body');
        this.modalClose = document.getElementById('modal-close-btn');
        this.crtOverlay = document.getElementById('crt-overlay');
        this.crtScanlines = document.getElementById('crt-scanlines');

        // 探测器按钮
        this.probeBtn = document.getElementById('probe-btn');
        this.recallBtn = document.getElementById('recall-btn');
        this.speakBtn = document.getElementById('speak-btn');

        this.activePlanet = null;
        this.activeMoon = null;
        this.cardVisible = false;
        this._clickDisabled = false;

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

        this.probeBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            const sm = window.__soundManager;
            if (sm && sm.isReady()) sm.play('probeFire', { volume: 0.35 });
            if (this.activePlanet) {
                this.onProbe(this.activePlanet, this.activeMoon);
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
            infoEl.textContent = `直径: ${moonData.diameter || '--'} | 卫星`;
        } else {
            titleEl.textContent = body.nameCN || body.key;
            nameEl.textContent = body.name;
            colorDot.style.background = colorToHex(body.color);
            infoEl.textContent = `质量: ${formatMass(body.mass)} | 半径: ${formatDiameter(body.realRadius)}`;
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
                    '<button class="moon-btn" data-moon-i="' + i + '">🚀 探测</button>' +
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
                    this.showDetailModal(null, { key: m.key || ('moon_' + idx), name: m.name || ('卫星' + idx), nameCN: m.name || '' });
                } else if (btn.textContent.includes('探测')) {
                    if (this.onProbe) this.onProbe(m, null);
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
        this.modal.classList.add('show');
    }

    hideDetailModal() {
        this.modal.classList.remove('show');
    }

    _buildPlanetDetail(body) {
        const mass = body.mass.toExponential(2) + ' kg';
        const radius = (body.realRadius / 1000).toFixed(0) + ' km';
        const orbitAU = body.orbitRadius.toFixed(2) + ' AU';
        const colorHex = '#' + body.color.getHexString();
        return `
            <p class="section-title">📐 基本参数</p>
            <p>质量: ${mass}<br>半径: ${radius}<br>轨道半径: ${orbitAU}<br>颜色: <span style="display:inline-block;width:14px;height:14px;background:${colorHex};border-radius:50%;vertical-align:middle;"></span> ${colorHex}</p>
            <p class="section-title">🌍 星球档案</p>
            <p>${body.details || '暂无详细信息'}</p>
        `;
    }

    _buildMoonDetail(info) {
        return `
            <p class="section-title">📐 卫星参数</p>
            <p>直径: ${info.diameter || '--'}<br>颜色: <span style="display:inline-block;width:14px;height:14px;background:${info.color};border-radius:50%;vertical-align:middle;"></span></p>
            <p class="section-title">📝 简介</p>
            <p>${info.details || '暂无详细信息'}</p>
        `;
    }
}
