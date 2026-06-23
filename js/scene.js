// ============================================================
// scene.js — Three.js 场景初始化、相机控制、渲染循环
// ============================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class SceneManager {
    constructor(container) {
        this.container = container;

        // --- 场景 ---
        this.scene = new THREE.Scene();

        // --- 渲染器 ---
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.8;
        container.appendChild(this.renderer.domElement);

        // --- 相机 ---
        this.camera = new THREE.PerspectiveCamera(
            55, window.innerWidth / window.innerHeight, 0.1, 2000
        );
        this.camera.position.set(5, 30, 45);
        this.camera.lookAt(0, 0, 0);

        // --- OrbitControls（Blender 风格：中键旋转、左键平移、滚轮缩放） ---
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        this.controls.minDistance = 2;
        this.controls.maxDistance = 1500;
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

        // --- 星空背景 ---
        this._createStarfield();

        // --- 响应式 ---
        window.addEventListener('resize', () => this._onResize());
    }

    _setupLights() {
        // 半球光 — 模拟天空/地面散射光，让行星暗面也有可见度
        const hemiLight = new THREE.HemisphereLight(0x8899cc, 0x223344, 1.8);
        this.scene.add(hemiLight);

        // 环境光 — 整体提亮
        const ambient = new THREE.AmbientLight(0x334466, 2.5);
        this.scene.add(ambient);

        // 太阳点光源 — 从太阳位置发出，照亮所有行星"白天"面
        const sunLight = new THREE.PointLight(0xfff8e8, 8.0, 0, 0.8);
        sunLight.position.set(0, 0, 0);
        sunLight.castShadow = true;
        sunLight.shadow.mapSize.width = 1024;
        sunLight.shadow.mapSize.height = 1024;
        sunLight.shadow.camera.near = 0.1;
        sunLight.shadow.camera.far = 500;
        this.scene.add(sunLight);

    }

    _createStarfield() {
        // 使用 BufferGeometry 创建星空粒子
        const starsCount = 4000;
        const positions = new Float32Array(starsCount * 3);
        const colors = new Float32Array(starsCount * 3);

        for (let i = 0; i < starsCount; i++) {
            // 球形分布
            const radius = 200 + Math.random() * 600;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);

            positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
            positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
            positions[i * 3 + 2] = radius * Math.cos(phi);

            // 随机颜色：白/蓝白/黄白
            const colorChoice = Math.random();
            if (colorChoice < 0.1) {
                colors[i * 3] = 0.7; colors[i * 3 + 1] = 0.8; colors[i * 3 + 2] = 1.0;
            } else if (colorChoice < 0.2) {
                colors[i * 3] = 1.0; colors[i * 3 + 1] = 0.9; colors[i * 3 + 2] = 0.7;
            } else {
                const b = 0.7 + Math.random() * 0.3;
                colors[i * 3] = b; colors[i * 3 + 1] = b; colors[i * 3 + 2] = b;
            }
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const mat = new THREE.PointsMaterial({
            size: 0.25,
            vertexColors: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.starfield = new THREE.Points(geo, mat);
        this.scene.add(this.starfield);
    }

    _onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    // ---------- 渲染一帧 ----------
    render(skipControls = false) {
        if (!skipControls) this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

}
