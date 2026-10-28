// ============================================================
// GalaxyPreview.js — 星体系统实时预览
// 在“星体编译器”表单旁渲染当前参数对应的 3D 场景
// ============================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { AU, POS_SCALE, SYSTEM_SCALE } from './constants.js';

// 1 AU 在主场景中对应的坐标单位（与 CelestialBody 的渲染换算一致）
const SCENE_PER_AU = AU * POS_SCALE * SYSTEM_SCALE;

const textureLoader = new THREE.TextureLoader();

export class GalaxyPreview {
    /**
     * @param {HTMLElement} container — 预览画布容器
     */
    constructor(container) {
        this.container = container;
        this._planets = [];      // { mesh, orbit, angle, speed }
        this._angles = [];       // 跨刷新保留公转角度，拖动滑块时不会跳变
        this._lastFit = 0;       // 上一次自动取景的尺度
        this._textureCache = new Map(); // url → THREE.Texture，避免每次刷新重复解码
        this._clock = new THREE.Clock();
        this._disposed = false;
        this._init();
    }

    _init() {
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.domElement.style.display = 'block';
        this.container.appendChild(this.renderer.domElement);

        this.scene = new THREE.Scene();

        this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1e7);
        this.camera.position.set(700, 500, 1000);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        this.controls.enablePan = false;
        this.controls.target.set(0, 0, 0);

        this.scene.add(new THREE.AmbientLight(0x8899bb, 1.2));
        this.starLight = new THREE.PointLight(0xffffff, 3, 0, 0);
        this.scene.add(this.starLight);

        this.content = new THREE.Group();
        this.scene.add(this.content);

        this._resizeObserver = new ResizeObserver(() => this._resize());
        this._resizeObserver.observe(this.container);
        this._resize();
        this._animate();
    }

    // ==================== 更新数据 ====================

    /**
     * @param {{ star: {name:string, visualRadius:number, color:string, textureUrl?:string},
     *           planets: Array<{orbitAU:number, visualRadius:number, color:string, textureUrl?:string}> }} data
     */
    update(data) {
        this._disposeContent();

        const star = data.star || {};
        const planets = data.planets || [];
        const starRadius = Math.max(star.visualRadius || 5, 0.4) * SYSTEM_SCALE;

        this.starLight.color.set(star.color || '#ffcc00');
        this.starLight.position.set(0, 0, 0);

        // 恒星（有贴图时使用贴图，否则纯色）
        const starMap = star.textureUrl ? this._loadTexture(star.textureUrl) : null;
        const starMesh = new THREE.Mesh(
            new THREE.SphereGeometry(1, 32, 32),
            new THREE.MeshBasicMaterial(starMap
                ? { map: starMap, color: 0xffffff }
                : { color: star.color || '#ffcc00' })
        );
        starMesh.scale.setScalar(starRadius);
        this.content.add(starMesh);

        // 柔和光晕
        const glow = new THREE.Mesh(
            new THREE.SphereGeometry(1, 24, 24),
            new THREE.MeshBasicMaterial({
                color: star.color || '#ffcc00',
                transparent: true, opacity: 0.16,
                blending: THREE.AdditiveBlending, depthWrite: false,
            })
        );
        glow.scale.setScalar(starRadius * 2.2);
        this.content.add(glow);

        let extent = starRadius * 3;

        this._planets = planets.map((p, i) => {
            const orbit = Math.max(p.orbitAU || 0, 0.02) * SCENE_PER_AU;
            const radius = Math.max(p.visualRadius || 0.5, 0.05) * SYSTEM_SCALE;
            extent = Math.max(extent, orbit + radius);

            this.content.add(this._makeOrbitLine(orbit, p.color));

            const map = p.textureUrl ? this._loadTexture(p.textureUrl) : null;
            const mesh = new THREE.Mesh(
                new THREE.SphereGeometry(1, 24, 16),
                new THREE.MeshStandardMaterial(map
                    ? { map, roughness: 0.75, metalness: 0.05 }
                    : { color: p.color || '#ff8844', roughness: 0.75, metalness: 0.05 })
            );
            mesh.scale.setScalar(radius);
            this.content.add(mesh);

            if (this._angles[i] === undefined) this._angles[i] = Math.random() * Math.PI * 2;
            // 越近的行星转得越快，仅用于预览观感
            const speed = 0.35 / Math.sqrt(Math.max(p.orbitAU || 1, 0.1));
            return { mesh, orbit, angle: this._angles[i], speed };
        });
        this._angles.length = planets.length;

        this._fit(extent);
    }

    /** 重置为默认视角 */
    resetView() {
        this.camera.position.set(0.62, 0.4, 1).normalize();
        this._fit(this._lastFit || 100, true);
    }

    _loadTexture(url) {
        let tex = this._textureCache.get(url);
        if (!tex) {
            tex = textureLoader.load(url);
            tex.colorSpace = THREE.SRGBColorSpace;
            this._textureCache.set(url, tex);
        }
        return tex;
    }

    _makeOrbitLine(radius, color) {
        const points = [];
        const segments = 128;
        for (let i = 0; i <= segments; i++) {
            const a = (i / segments) * Math.PI * 2;
            points.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
        }
        const geo = new THREE.BufferGeometry().setFromPoints(points);
        const lineColor = new THREE.Color(color || '#4488aa').multiplyScalar(0.45);
        const mat = new THREE.LineBasicMaterial({
            color: lineColor, transparent: true, opacity: 0.55,
        });
        return new THREE.Line(geo, mat);
    }

    // ==================== 相机 ====================

    /** 自动取景：尺度变化超过 15% 时才重新计算，避免拖动滑块时镜头乱跳 */
    _fit(extent, force = false) {
        extent = Math.max(extent, 30);
        if (!force && this._lastFit > 0 &&
            Math.abs(extent - this._lastFit) / this._lastFit < 0.15) {
            return;
        }
        this._lastFit = extent;

        const fov = THREE.MathUtils.degToRad(this.camera.fov);
        const dist = (extent / Math.sin(fov / 2)) * 0.9;

        // 保留用户当前的观察方向，只调整距离
        const dir = this.camera.position.clone().sub(this.controls.target);
        if (dir.lengthSq() < 1e-6) dir.set(0.62, 0.4, 1);
        dir.normalize();

        this.controls.target.set(0, 0, 0);
        this.camera.position.copy(dir.multiplyScalar(dist));
        this.camera.near = Math.max(0.1, dist / 1000);
        this.camera.far = Math.max(dist * 20, extent * 20);
        this.camera.updateProjectionMatrix();

        this.controls.minDistance = Math.max(1, extent * 0.05);
        this.controls.maxDistance = Math.max(extent * 12, dist * 2);
        this.controls.update();
    }

    _resize() {
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        if (!w || !h) return;
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
    }

    // ==================== 渲染循环 ====================

    _animate() {
        if (this._disposed) return;
        this._raf = requestAnimationFrame(() => this._animate());

        const dt = Math.min(this._clock.getDelta(), 0.05);
        // 模态框隐藏时不渲染，避免无谓开销
        if (!this.container.isConnected || this.container.offsetParent === null) return;

        for (const p of this._planets) {
            p.angle += p.speed * dt;
            p.mesh.position.set(Math.cos(p.angle) * p.orbit, 0, Math.sin(p.angle) * p.orbit);
        }

        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    // ==================== 清理 ====================

    _disposeContent() {
        for (const child of [...this.content.children]) {
            this.content.remove(child);
            child.traverse(obj => {
                if (obj.isMesh || obj.isLine) {
                    obj.geometry?.dispose();
                    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
                    // 贴图由 _textureCache 统一持有，重建时只释放材质
                    materials.forEach(m => m?.dispose());
                }
            });
        }
        this._planets = [];
    }

    dispose() {
        this._disposed = true;
        cancelAnimationFrame(this._raf);
        this._resizeObserver?.disconnect();
        this._disposeContent();
        this._textureCache.forEach(tex => tex.dispose());
        this._textureCache.clear();
        this.controls?.dispose();
        this.renderer?.dispose();
        this.renderer?.domElement?.remove();
    }
}
