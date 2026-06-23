// ============================================================
// CelestialBody.js — 天体基类
// 封装 Three.js 网格、物理状态与星球信息
// 支持加载真实贴图（优先）或回退程序化纹理
// ============================================================

import * as THREE from 'three';
import { POS_SCALE } from './constants.js';

const textureLoader = new THREE.TextureLoader();

export class CelestialBody {
    /**
     * @param {object} opts
     * @param {string} opts.key
     * @param {string} opts.name
     * @param {string} opts.nameCN
     * @param {number} opts.mass
     * @param {number} opts.radius
     * @param {number} opts.orbitRadius
     * @param {number} opts.visualRadius
     * @param {number|string} opts.color
     * @param {string} opts.details
     * @param {string} [opts.texturePath]  - 贴图路径（相对于 index.html）
     * @param {object} opts.scene
     */
    constructor(opts) {
        this.key = opts.key;
        this.name = opts.name;
        this.nameCN = opts.nameCN;
        this.mass = opts.mass;
        this.realRadius = opts.radius;
        this.orbitRadius = opts.orbitRadius;
        this.color = new THREE.Color(opts.color);
        this.details = opts.details || '';
        this.voiceIntro = opts.voiceIntro || '';
        this.scene = opts.scene;
        this.texturePath = opts.texturePath || null;

        // --- 物理状态 (SI) ---
        this.position = new THREE.Vector3();
        this.velocity = new THREE.Vector3();
        this.acceleration = new THREE.Vector3();

        this.visualRadius = opts.visualRadius;

        // --- 自转速度 (弧度/秒，视觉速率) ---
        this.rotationSpeed = opts.rotationSpeed || 0;

        // --- Three.js 对象 ---
        this.mesh = null;
        this.ringMesh = null;
        this.glowMesh = null;

        this._buildMesh();
    }

    // ---------- 构建 3D 网格 ----------
    _buildMesh() {
        const segments = this.visualRadius > 1 ? 64 : 48;
        const geo = new THREE.SphereGeometry(this.visualRadius, segments, segments);

        // 优先加载真实贴图，失败则回退程序化纹理
        if (this.texturePath) {
            this._buildWithTexture(geo);
        } else {
            this._buildWithProcedural(geo);
        }
    }

    _buildWithTexture(geo) {
        const mat = new THREE.MeshStandardMaterial({
            roughness: 0.75,
            metalness: 0.05,
        });

        // 异步加载贴图
        textureLoader.load(
            this.texturePath,
            (texture) => {
                mat.map = texture;
                mat.needsUpdate = true;
            },
            undefined,
            () => {
                console.warn(`[CelestialBody] 贴图加载失败: ${this.texturePath}，使用程序化纹理`);
                mat.map = this._generateTexture();
                mat.needsUpdate = true;
            }
        );

        this._createMeshObject(geo, mat);
    }

    _buildWithProcedural(geo) {
        const texture = this._generateTexture();
        const mat = new THREE.MeshStandardMaterial({
            map: texture,
            roughness: 0.7,
            metalness: 0.1,
        });
        this._createMeshObject(geo, mat);
    }

    /** 共享的网格创建逻辑 */
    _createMeshObject(geo, mat) {
        this.mesh = new THREE.Mesh(geo, mat);
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;
        this.mesh.userData = { celestialBody: this };
        this.scene.add(this.mesh);
        this._syncMeshPosition();
    }

    // ---------- 程序化纹理生成（回退方案） ----------
    _generateTexture() {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        const base = this.color.clone();
        ctx.fillStyle = '#' + base.getHexString();
        ctx.fillRect(0, 0, size, size);

        const imageData = ctx.getImageData(0, 0, size, size);
        const data = imageData.data;
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const i = (y * size + x) * 4;
                const noise = (Math.random() - 0.5) * 40;
                const latFactor = 1 - Math.abs((y / size - 0.5) * 2) * 0.3;
                data[i] = Math.max(0, Math.min(255, data[i] + noise * latFactor));
                data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise * latFactor));
                data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise * latFactor));
            }
        }
        ctx.putImageData(imageData, 0, 0);

        for (let y = 0; y < size; y += 10 + Math.random() * 15) {
            ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.06})`;
            ctx.fillRect(0, y, size, 3 + Math.random() * 8);
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        return texture;
    }

    // ---------- 圆形轨道速度 ----------
    setCircularOrbitVelocity(centralMass) {
        const r = this.position.length();
        if (r === 0) return;
        const G = 6.67430e-11;
        const speed = Math.sqrt(G * centralMass / r);
        const dir = new THREE.Vector3(-this.position.z, 0, this.position.x).normalize();
        this.velocity.copy(dir.multiplyScalar(speed));
    }

    // ---------- 同步物理 → 3D ----------
    _syncMeshPosition() {
        if (this.mesh) {
            this.mesh.position.set(
                this.position.x * POS_SCALE,
                this.position.y * POS_SCALE,
                this.position.z * POS_SCALE
            );
        }
        if (this.ringMesh) {
            this.ringMesh.position.copy(this.mesh.position);
        }
        if (this.glowMesh) {
            this.glowMesh.position.copy(this.mesh.position);
        }
    }

    updatePhysics(acceleration, dt) {
        const halfDt = dt * 0.5;
        this.velocity.x += acceleration.x * halfDt;
        this.velocity.y += acceleration.y * halfDt;
        this.velocity.z += acceleration.z * halfDt;
        this.position.x += this.velocity.x * dt;
        this.position.y += this.velocity.y * dt;
        this.position.z += this.velocity.z * dt;
        this._syncMeshPosition();
    }

    applySecondHalfVelocity(acceleration, dt) {
        const halfDt = dt * 0.5;
        this.velocity.x += acceleration.x * halfDt;
        this.velocity.y += acceleration.y * halfDt;
        this.velocity.z += acceleration.z * halfDt;
    }

    getDetails() {
        return this.details;
    }

    /** 正确清理 Three.js 资源 */
    dispose() {
        if (this.mesh) {
            this.mesh.geometry?.dispose();
            if (Array.isArray(this.mesh.material)) {
                this.mesh.material.forEach(m => m.dispose());
            } else {
                this.mesh.material?.dispose();
            }
            this.mesh.parent?.remove(this.mesh);
        }
        if (this.ringMesh) {
            this.ringMesh.geometry?.dispose();
            this.ringMesh.material?.dispose();
            this.ringMesh.parent?.remove(this.ringMesh);
        }
        if (this.glowMesh) {
            this.glowMesh.geometry?.dispose();
            this.glowMesh.material?.dispose();
            this.glowMesh.parent?.remove(this.glowMesh);
        }
    }
}
