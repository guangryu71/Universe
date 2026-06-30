// ============================================================
// scene.js — Three.js 场景初始化、相机控制、渲染循环
// 着色器驱动星空（120k+60k粒子）+ Bloom 后处理
// ============================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SYSTEM_SCALE } from './constants.js';

export class SceneManager {
    constructor(container) {
        this.container = container;
        this.clock = new THREE.Clock();

        // --- 场景（增加雾效增强景深感） ---
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x000008, 0.000035 / SYSTEM_SCALE);

        // --- 渲染器（高质量） ---
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
            powerPreference: 'high-performance',
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMappingExposure = 1.2;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        container.appendChild(this.renderer.domElement);

        // --- 相机（广视角，适应放大的星体系统） ---
        const ss = SYSTEM_SCALE;
        this.camera = new THREE.PerspectiveCamera(
            72, window.innerWidth / window.innerHeight, 0.1, 20000 * ss
        );
        this.camera.position.set(5 * ss * 0.5, 30 * ss * 0.5, 45 * ss * 0.5);
        this.camera.lookAt(0, 0, 0);

        // --- OrbitControls（Blender 风格：中键旋转、左键平移、滚轮缩放） ---
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        this.controls.minDistance = ss * 0.5;
        this.controls.maxDistance = ss * 150;
        this.controls.target.set(0, 0, 0);

        // Blender 映射
        this.controls.mouseButtons = {
            LEFT: THREE.MOUSE.PAN,     // 左键 → 平移
            MIDDLE: THREE.MOUSE.ROTATE, // 中键 → 旋转
        };
        // 滚轮保持默认缩放（DOLLY）

        this.controls.update();

        // --- 光照 ---
        this._setupLights();

        // --- 着色器驱动星空 ---
        this._createStarfield();

        // --- 后处理 Bloom ---
        this._createComposer();

        // --- 响应式 ---
        window.addEventListener('resize', () => this._onResize());
    }

    _setupLights() {
        // 半球光 — 模拟天空/地面散射光
        const hemiLight = new THREE.HemisphereLight(0x8899cc, 0x223344, 1.2);
        this.scene.add(hemiLight);

        // 环境光 — 极低环境照明（让阴影更明显）
        const ambient = new THREE.AmbientLight(0x223355, 0.4);
        this.scene.add(ambient);

        // 太阳主光源 — 方向光（平行光），从原点向外照射
        // 由于太阳在原点，我们用一个点光源 + 方向光组合模拟恒星照明
        const sunLight = new THREE.PointLight(0xfff8e8, 12.0, 0, 1.5);
        sunLight.position.set(0, 0, 0);
        sunLight.castShadow = true;
        sunLight.shadow.mapSize.width = 2048;
        sunLight.shadow.mapSize.height = 2048;
        sunLight.shadow.camera.near = 0.1;
        sunLight.shadow.camera.far = 2000;
        sunLight.shadow.bias = -0.001;
        this.scene.add(sunLight);

        // 辅助方向光 — 增强立体感
        const dirLight = new THREE.DirectionalLight(0xffeedd, 1.5);
        dirLight.position.set(10, 20, 30);
        dirLight.castShadow = true;
        dirLight.shadow.mapSize.width = 2048;
        dirLight.shadow.mapSize.height = 2048;
        const d = 50;
        dirLight.shadow.camera.left = -d;
        dirLight.shadow.camera.right = d;
        dirLight.shadow.camera.top = d;
        dirLight.shadow.camera.bottom = -d;
        dirLight.shadow.camera.near = 1;
        dirLight.shadow.camera.far = 100;
        dirLight.shadow.bias = -0.001;
        this.scene.add(dirLight);

        // 背面补充光 — 让行星暗面不完全黑暗
        const backLight = new THREE.DirectionalLight(0x446688, 0.6);
        backLight.position.set(-20, -10, -30);
        this.scene.add(backLight);
    }

    // ============================================================
    // 着色器星空系统（光谱分布 + 衍射十字 + 闪烁 + Bloom）
    // ============================================================
    _createStarfield() {
        // --- 圆形渐变纹理（避免方形像素） ---
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        gradient.addColorStop(0, 'rgba(255,255,255,1)');
        gradient.addColorStop(0.1, 'rgba(255,255,255,0.9)');
        gradient.addColorStop(0.4, 'rgba(255,255,255,0.5)');
        gradient.addColorStop(0.7, 'rgba(255,255,255,0.15)');
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 64, 64);
        const starTexture = new THREE.CanvasTexture(canvas);

        // --- 光谱颜色查找表 (O/B/A/F/G/K/M) ---
        const spectralColors = [
            new THREE.Color(0.55, 0.65, 1.0),   // O 蓝
            new THREE.Color(0.65, 0.75, 1.0),   // B 蓝白
            new THREE.Color(0.85, 0.88, 1.0),   // A 白
            new THREE.Color(0.95, 0.92, 0.85),  // F 黄白
            new THREE.Color(1.0, 0.95, 0.80),   // G 黄（太阳型）
            new THREE.Color(1.0, 0.82, 0.62),   // K 橙
            new THREE.Color(1.0, 0.62, 0.40),   // M 红橙
        ];
        const specDist = [0.02, 0.05, 0.08, 0.12, 0.18, 0.25, 0.30];
        const specLum  = [1.0, 0.95, 0.85, 0.7, 0.55, 0.4, 0.25];

        // --- 着色器代码 ---
        const starVertexShader = `
            attribute float size;
            attribute vec3 customColor;
            attribute float brightness;
            varying vec3 vColor;
            varying float vBrightness;
            void main() {
                vColor = customColor;
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                float dist = max(-mvPosition.z, 1.0);
                float distAtten = smoothstep(12000.0, 200.0, dist);
                vBrightness = distAtten * brightness;
                float pointSize = size * (350.0 / dist);
                gl_PointSize = clamp(pointSize, 0.5, 96.0);
                gl_Position = projectionMatrix * mvPosition;
            }
        `;

        const starFragmentShader = `
            uniform sampler2D starTexture;
            uniform float uTime;
            varying vec3 vColor;
            varying float vBrightness;
            void main() {
                vec2 uv = gl_PointCoord - 0.5;
                float d = length(uv);
                float alpha = 1.0 - smoothstep(0.25, 0.5, d);
                if (alpha < 0.01) discard;

                // 衍射十字光晕 (Diffraction Spikes)
                float spike = 0.0;
                float ang = atan(uv.y, uv.x);
                float rad = d * 2.0;
                float spikeMask = sin(ang * 4.0);
                spike = pow(abs(spikeMask), 6.0) * exp(-rad * 3.5) * 0.35;

                // 微闪烁
                float flicker = 0.97 + 0.03 * sin(uTime * 0.5 + gl_PointCoord.x * 100.0);

                vec3 color = vColor * vBrightness * flicker;
                float finalAlpha = alpha + spike;

                // 中心高亮
                float core = exp(-d * d * 80.0);
                color += vec3(1.0) * core * 0.3 * vBrightness;

                gl_FragColor = vec4(color, finalAlpha * vBrightness);
            }
        `;

        // --- 生成恒星数据 ---
        function generateStarData(count) {
            const positions    = new Float32Array(count * 3);
            const colors       = new Float32Array(count * 3);
            const sizes        = new Float32Array(count);
            const brightnesses = new Float32Array(count);

            for (let i = 0; i < count; i++) {
                // 球面均匀分布，两层壳增加深度层次
                const theta = Math.random() * Math.PI * 2;
                const phi   = Math.acos(2 * Math.random() - 1);
                const r = Math.random() < 0.4
                    ? 3500 + Math.random() * 2500
                    : 6000 + Math.random() * 6000;

                positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
                positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
                positions[i * 3 + 2] = r * Math.cos(phi);

                // 光谱类型
                const roll = Math.random();
                let idx = 0;
                for (let cum = 0, j = 0; j < specDist.length; j++) {
                    cum += specDist[j];
                    if (roll < cum) { idx = j; break; }
                }
                const c = spectralColors[idx];
                const variation = 0.92 + Math.random() * 0.16;
                colors[i * 3]     = Math.min(c.r * variation, 1.0);
                colors[i * 3 + 1] = Math.min(c.g * variation, 1.0);
                colors[i * 3 + 2] = Math.min(c.b * variation, 1.0);

                sizes[i] = Math.exp(Math.random() * 2.2) * 0.4 + 0.15;
                const sizeLum = Math.min(sizes[i] / 3.0, 1.0);
                brightnesses[i] = Math.min(specLum[idx] * 0.6 + sizeLum * 0.4 + 0.2, 1.0);
            }
            return { positions, colors, sizes, brightnesses };
        }

        const starUniforms = {
            starTexture: { value: starTexture },
            uTime: { value: 0 },
        };

        // === 主层恒星 (120,000) ===
        const mainData = generateStarData(120000);
        const mainGeo = new THREE.BufferGeometry();
        mainGeo.setAttribute('position',    new THREE.BufferAttribute(mainData.positions, 3));
        mainGeo.setAttribute('customColor', new THREE.BufferAttribute(mainData.colors, 3));
        mainGeo.setAttribute('size',        new THREE.BufferAttribute(mainData.sizes, 1));
        mainGeo.setAttribute('brightness',  new THREE.BufferAttribute(mainData.brightnesses, 1));

        const mainMat = new THREE.ShaderMaterial({
            uniforms: {
                starTexture: { value: starTexture },
                uTime: { value: 0 },
            },
            vertexShader:   starVertexShader,
            fragmentShader: starFragmentShader,
            transparent:  true,
            depthWrite:   false,
            blending:     THREE.AdditiveBlending,
        });
        this.starField = new THREE.Points(mainGeo, mainMat);
        this.starField.frustumCulled = false;
        this.scene.add(this.starField);

        // === 背景暗星层 (60,000) — 推得更远，更小更暗 ===
        const faintData = generateStarData(60000);
        for (let i = 0; i < 60000; i++) {
            const i3 = i * 3;
            const p = faintData.positions;
            const factor = 1.8 + Math.random() * 1.5;
            p[i3]     *= factor;
            p[i3 + 1] *= factor;
            p[i3 + 2] *= factor;
            faintData.sizes[i]        *= 0.4;
            faintData.brightnesses[i] *= 0.35;
        }
        const faintGeo = new THREE.BufferGeometry();
        faintGeo.setAttribute('position',    new THREE.BufferAttribute(faintData.positions, 3));
        faintGeo.setAttribute('customColor', new THREE.BufferAttribute(faintData.colors, 3));
        faintGeo.setAttribute('size',        new THREE.BufferAttribute(faintData.sizes, 1));
        faintGeo.setAttribute('brightness',  new THREE.BufferAttribute(faintData.brightnesses, 1));

        const faintMat = new THREE.ShaderMaterial({
            uniforms: {
                starTexture: { value: starTexture },
                uTime: { value: 0 },
            },
            vertexShader:   starVertexShader,
            fragmentShader: starFragmentShader,
            transparent:  true,
            depthWrite:   false,
            blending:     THREE.AdditiveBlending,
        });
        this.faintField = new THREE.Points(faintGeo, faintMat);
        this.faintField.frustumCulled = false;
        this.scene.add(this.faintField);

        // === 深空星云背景 ===
        this._createNebulaBackground();
    }

    /** 程序化星云背景（画布生成贴图 + 天球） */
    _createNebulaBackground() {
        const canvas = document.createElement('canvas');
        canvas.width = 2048;
        canvas.height = 1024;
        const ctx = canvas.getContext('2d');

        // 基础深空渐变
        const grad = ctx.createLinearGradient(0, 0, canvas.width, 0);
        grad.addColorStop(0,   '#050812');
        grad.addColorStop(0.15,'#0a0e1a');
        grad.addColorStop(0.3, '#080b18');
        grad.addColorStop(0.45,'#0c1220');
        grad.addColorStop(0.55,'#070a14');
        grad.addColorStop(0.7, '#0b0f1c');
        grad.addColorStop(0.85,'#080b15');
        grad.addColorStop(1,   '#050812');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // 多层星云斑点
        const layers = [
            { color: 'rgba(40,30,80,0.015)',  count: 30 },
            { color: 'rgba(60,50,120,0.025)', count: 20 },
            { color: 'rgba(80,60,100,0.012)', count: 40 },
            { color: 'rgba(120,80,60,0.008)', count: 15 },
            { color: 'rgba(20,40,80,0.020)',  count: 25 },
        ];
        for (const layer of layers) {
            for (let i = 0; i < layer.count; i++) {
                const cx = Math.random() * canvas.width;
                const cy = Math.random() * canvas.height;
                const r = 80 + Math.random() * 300;
                const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
                g.addColorStop(0, layer.color);
                g.addColorStop(0.3, layer.color);
                g.addColorStop(1, 'rgba(0,0,0,0)');
                ctx.fillStyle = g;
                ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
            }
        }

        // 银河带
        ctx.save();
        ctx.globalAlpha = 0.03;
        for (let i = 0; i < 80; i++) {
            const x = Math.random() * canvas.width;
            const y = canvas.height * (0.35 + Math.random() * 0.3);
            const r = 40 + Math.random() * 120;
            const g = ctx.createRadialGradient(x, y, 0, x, y, r);
            g.addColorStop(0,   'rgba(180,160,200,0.4)');
            g.addColorStop(0.5, 'rgba(120,100,140,0.15)');
            g.addColorStop(1,   'rgba(0,0,0,0)');
            ctx.fillStyle = g;
            ctx.fillRect(x - r, y - r, r * 2, r * 2);
        }
        ctx.restore();

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;

        const sphereGeo = new THREE.SphereGeometry(8000, 48, 32);
        const sphereMat = new THREE.MeshBasicMaterial({
            map: texture,
            side: THREE.BackSide,
            transparent: true,
            opacity: 0.35,
            depthWrite: false,
        });
        this.nebulaSphere = new THREE.Mesh(sphereGeo, sphereMat);
        this.scene.add(this.nebulaSphere);
    }

    // ============================================================
    // Bloom 后处理
    // ============================================================
    _createComposer() {
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));

        const bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            0.25,  // strength — 降低强度更自然
            0.8,   // radius — 更大半径更柔和
            0.3    // threshold — 更低阈值让更多物体泛光
        );
        this.composer.addPass(bloomPass);
        this.composer.addPass(new OutputPass());
    }

    // ============================================================
    // 窗口自适应
    // ============================================================
    _onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        if (this.composer) {
            this.composer.setSize(window.innerWidth, window.innerHeight);
        }
    }

    // ============================================================
    // 渲染一帧
    // ============================================================
    render(skipControls = false) {
        if (!skipControls) this.controls.update();

        // 星空跟随相机（无穷远效果）& 时间 uniform 更新
        const elapsed = this.clock.getElapsedTime();
        if (this.starField) {
            this.starField.position.copy(this.camera.position);
            this.starField.material.uniforms.uTime.value = elapsed;
        }
        if (this.faintField) {
            this.faintField.position.copy(this.camera.position);
            this.faintField.material.uniforms.uTime.value = elapsed;
        }
        if (this.nebulaSphere) {
            this.nebulaSphere.position.copy(this.camera.position);
        }

        if (this.composer) {
            this.composer.render();
        } else {
            this.renderer.render(this.scene, this.camera);
        }
    }
}
