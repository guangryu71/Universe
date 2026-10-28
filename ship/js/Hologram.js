// ============================================================
// Hologram.js — 全息太阳系（移植自 飞船.html）
// 动态获取真实星体，右键菜单跃迁，左键聚焦，滚轮缩放
// ============================================================
import * as THREE from 'three';

/** 全局可调参数（直接修改此对象即可实时生效） */
export const HOLOGRAM_CFG = {
    // ---- 轨道 ----
    orbitSpacing:    0.28,   // 等距轨道间距
    orbitFirstRadius: 0.35,  // 最内圈轨道半径
    orbitRingWidth:  0.005,  // 轨道环线宽
    orbitRingOpacity: 0.2,   // 轨道环透明度

    // ---- 行星大小 ----
    planetSizeScale: 0.15,  // 行星视觉半径 × 此值
    planetSizeMin:   0.03,   // 最小行星显示尺寸

    // ---- 公转 ----
    orbitSpeedMin:   0.8,    // 公转速度最小值
    orbitSpeedRange: 0.6,    // 公转速度随机范围（min + rand * range）
    orbitAnimMult:   0.08,   // 公转动画倍率 (dt * speed * mult)

    // ---- 太阳 ----
    sunSize:         0.25,   // 太阳球体半径
    sunGlowSize:     0.3,   // 太阳光晕半径
    sunGlowOpacity:  0.35,
    sunBreathAmp:    0.3,   // 脉动幅度
    sunBreathFreq:   1.6,    // 脉动频率

    // ---- 全息外壳 ----
    shellRadius:     2.5,    // 外发光壳半径
    wireframeRadius: 2.35,    // 线框半径
    wireframeOpacity: 0.25,

    // ---- 全息整体 ----
    rotationSpeed:   0.002,  // 全息系统自转速度 (rad/frame)
    wireRotX:        -0.1,    // 线框 X 轴自转速度
    wireRotZ:        0,    // 线框 Z 轴自转速度

    // ---- 缩放 ----
    zoomMin:         0.28,
    zoomMax:         3,
    zoomStep:        0.06,

    // ---- 亮度 ----
    emissiveNormal:  0.3,
    emissiveHover:   0.8,
    emissiveFocused: 1.2,
};

export class Hologram {
    /**
     * @param {THREE.Group} parent — 挂载到 shipGroup
     * @param {THREE.Vector3} anchor — 局部坐标锚点 (0,1.8,0)
     * @param {THREE.Camera} camera — 主相机（raycast）
     * @param {Function} onWarp — (body) => ShipModule.warpToBody(body)
     * @param {Function} onUIActive — (active) => 控制台状态回调
     */
    constructor(parent, anchor, camera, onWarp, onUIActive) {
        this.parent = parent;
        this.anchor = anchor.clone();
        this.camera = camera;
        this.onWarp = onWarp || (() => {});
        this.onUIActive = onUIActive || (() => {});

        this.bodies = [];         // 真实 CelestialBody 列表
        this.planetMeshes = [];   // 全息小行星 mesh
        this.planetAnimData = [];
        this.focusedPlanet = null;
        this.isZooming = false;
        this.zoomProgress = 0;
        this.zoomStartScale = 1;
        this.zoomTargetScale = 1;
        this._zoomPlanet = null;
        this.currentScale = 1.0;
        this.targetScale = 1.0;   // 滚轮目标缩放，由 update() 平滑逼近
        this.isUIActive = false;
        this.isHoverShell = false;

        this.raycaster = new THREE.Raycaster();
        this.crosshairVec = new THREE.Vector2(0, 0);
        // body.texturePath → THREE.Texture，重建时复用，避免重复加载
        this._textureCache = new Map();
        this._textureLoader = new THREE.TextureLoader();

        this.group = new THREE.Group();
        this.group.position.copy(this.anchor);
        this.parent.add(this.group);

        this._build();
        this._bindUI();
    }

    /** 注入真实星体数据 */
    setBodies(bodies) {
        this.bodies = bodies || [];
        this._rebuildPlanets();
    }

    /** 重建全息行星 — 等间距轨道 */
    _rebuildPlanets() {
        const cfg = HOLOGRAM_CFG;

        // 清空旧行星
        this.planetMeshes.forEach(m => { m.parent?.remove(m); m.geometry?.dispose(); m.material?.dispose(); });
        this.planetMeshes = [];
        this.planetAnimData = [];

        // 找恒星（质量最大的天体为中心恒星）
        const sorted = [...this.bodies].sort((a, b) => b.mass - a.mass);
        const starBody = sorted[0];
        const planets = this.bodies.filter(b => b !== starBody && b.mesh);
        if (planets.length === 0) return;

        const starPos = starBody?.mesh?.position || new THREE.Vector3(0, 0, 0);

        // 排序（按轨道半径升序）
        planets.sort((a, b) => {
            const da = a.mesh.position.distanceTo(starPos);
            const db = b.mesh.position.distanceTo(starPos);
            return da - db;
        });

        // 等间距轨道：内圈半径 + (索引 × 间距)
        const orbitRadius0 = cfg.orbitFirstRadius;
        const spacing = cfg.orbitSpacing;

        planets.forEach((b, idx) => {
            const orbit = orbitRadius0 + idx * spacing;
            const col = b.color || 0x4488cc;
            const size = Math.max(cfg.planetSizeMin, (b.visualRadius || 1) * cfg.planetSizeScale);

            // 轨道环
            const ring = new THREE.Mesh(
                new THREE.RingGeometry(orbit - cfg.orbitRingWidth, orbit + cfg.orbitRingWidth, 64),
                new THREE.MeshBasicMaterial({
                    color: 0x00d4ff, transparent: true,
                    opacity: cfg.orbitRingOpacity, side: THREE.DoubleSide, depthWrite: false,
                })
            );
            ring.rotation.x = -Math.PI / 2;
            this.group.add(ring);

            // 行星小球 — 自定义贴图优先，否则使用纯色
            const map = this._getBodyTexture(b);
            const mesh = new THREE.Mesh(
                new THREE.SphereGeometry(size, 16, 16),
                new THREE.MeshStandardMaterial(map
                    ? {
                        map, color: 0xffffff, emissive: col,
                        // 贴图模式下降低自发光，避免盖住纹理颜色
                        emissiveIntensity: cfg.emissiveNormal * 0.4,
                        roughness: 0.6, metalness: 0.3,
                    }
                    : {
                        color: col, emissive: col,
                        emissiveIntensity: cfg.emissiveNormal,
                        roughness: 0.6, metalness: 0.3,
                    })
            );
            const startAngle = (idx / planets.length) * Math.PI * 2
                + (idx % 2 === 0 ? 0 : Math.PI / planets.length);
            mesh.position.x = Math.cos(startAngle) * orbit;
            mesh.position.z = Math.sin(startAngle) * orbit;
            const speed = cfg.orbitSpeedMin + Math.random() * cfg.orbitSpeedRange;
            mesh.userData = {
                body: b, planetName: b.name || b.key, isPlanet: true,
                orbitRadius: orbit, orbitSpeed: speed, startAngle,
                currentAngle: startAngle, size,
            };

            // 土星环
            if (b.name && String(b.name).includes('土星')) {
                const sr = new THREE.Mesh(
                    new THREE.RingGeometry(size * 1.4, size * 2.2, 24),
                    new THREE.MeshBasicMaterial({
                        color: col, transparent: true, opacity: 0.5,
                        side: THREE.DoubleSide, depthWrite: false,
                    })
                );
                sr.rotation.x = Math.PI / 2.5;
                mesh.add(sr);
            }

            this.group.add(mesh);
            this.planetMeshes.push(mesh);
            this.planetAnimData.push({ mesh, orbit, speed, startAngle, currentAngle: startAngle });
        });
    }

    /** 按贴图路径加载并缓存纹理；纯色球返回 null */
    _getBodyTexture(body) {
        const path = body?.texturePath;
        if (!path) return null;

        let tex = this._textureCache.get(path);
        if (!tex) {
            tex = this._textureLoader.load(path, undefined, undefined, () => {
                // 加载失败时移除缓存，下次重建可重试
                this._textureCache.delete(path);
            });
            tex.colorSpace = THREE.SRGBColorSpace;
            this._textureCache.set(path, tex);
        }
        return tex;
    }

    // ============ 3D 构建（太阳、外壳、线框）============
    _build() {
        const cfg = HOLOGRAM_CFG;

        // 太阳
        const sun = new THREE.Mesh(
            new THREE.SphereGeometry(cfg.sunSize, 32, 32),
            new THREE.MeshBasicMaterial({ color: 0xffcc44 })
        );
        this.group.add(sun);
        const sunGlow = new THREE.Mesh(
            new THREE.SphereGeometry(cfg.sunGlowSize, 32, 32),
            new THREE.MeshBasicMaterial({
                color: 0xffaa22, transparent: true, opacity: cfg.sunGlowOpacity,
                blending: THREE.AdditiveBlending, depthWrite: false,
            })
        );
        this.group.add(sunGlow);
        this._sunGlowMat = sunGlow.material;
        this._sunScale = { base: 1 };

        // 外全息壳
        const shellGeo = new THREE.SphereGeometry(cfg.shellRadius, 48, 48);
        const shellMat = new THREE.ShaderMaterial({
            uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0x00d4ff) }, uColor2: { value: new THREE.Color(0x9ce8ff) }, uIntensity: { value: 1.0 } },
            vertexShader: `varying vec3 vN;varying vec3 vP;varying vec3 vW;void main(){vN=normalize(normalMatrix*normal);vP=position;vW=(modelMatrix*vec4(position,1.0)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
            fragmentShader: `
                uniform float uTime;uniform vec3 uColor;uniform vec3 uColor2;uniform float uIntensity;
                varying vec3 vN;varying vec3 vP;varying vec3 vW;
                float h(vec3 p){p=fract(p*vec3(443.897,441.423,437.195));p+=dot(p,p.yzx+19.19);return fract((p.x+p.y)*p.z);}
                float n(vec3 p){vec3 i=floor(p);vec3 f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(h(i+vec3(0,0,0)),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z);}
                void main(){
                    vec3 vd=normalize(cameraPosition-vW);
                    float fr=pow(1.-max(dot(vd,vN),0.),2.5);
                    float n1=n(vP*3.+vec3(uTime*.3,uTime*.2,uTime*.4));float n2=n(vP*6.-vec3(uTime*.2,0.,uTime*.3));
                    float p=n1*.6+n2*.4;
                    float la=abs(sin(vP.y*12.+uTime*.5));float lo=abs(sin(atan(vP.x,vP.z)*16.));
                    float g=smoothstep(.95,1.,max(la,lo))*.3;
                    vec3 c=mix(uColor,uColor2,p)+g*uColor2*1.5;
                    float ct=pow(length(vP)/2.,2.);c=mix(c*2.,c,ct);
                    float a=(fr*.6+p*.2+g+.05)*uIntensity;
                    gl_FragColor=vec4(c,a);
                }`,
            transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
        });
        this._shellMat = shellMat;
        this.group.add(new THREE.Mesh(shellGeo, shellMat));

        // 线框
        const wm = new THREE.Mesh(
            new THREE.IcosahedronGeometry(cfg.wireframeRadius, 1),
            new THREE.MeshBasicMaterial({
                color: 0x00d4ff, wireframe: true, transparent: true, opacity: cfg.wireframeOpacity,
            })
        );
        this._wireMesh = wm;
        this.group.add(wm);
    }

    // ============ DOM UI 绑定 ============
    _bindUI() {
        // context-menu (右键菜单)
        this._ctxMenu = document.getElementById('context-menu');
        this._warpName = document.getElementById('warp-planet-name');
        this._warpItem = document.getElementById('warp-menu-item');

        // 跃迁菜单点击
        this._warpItem?.addEventListener('click', () => {
            if (this.focusedPlanet) {
                const body = this.focusedPlanet.userData.body;
                if (body) this.onWarp(body);
            }
            this._hideCtx();
        });

        // 点击外部关闭菜单
        document.addEventListener('mousedown', (e) => {
            if (e.button === 0 && this._ctxMenu?.classList.contains('visible')) {
                if (!this._ctxMenu.contains(e.target)) this._hideCtx();
            }
        });

        // 右键事件已由全局在 ShipModule 中处理
    }

    showContext(x, y) {
        if (!this._ctxMenu || !this.focusedPlanet) return;
        const name = this.focusedPlanet.userData.planetName;
        if (this._warpName) this._warpName.textContent = name;
        this._ctxMenu.style.left = Math.min(x, window.innerWidth - 200) + 'px';
        this._ctxMenu.style.top = Math.min(y, window.innerHeight - 50) + 'px';
        this._ctxMenu.classList.add('visible');
    }
    _hideCtx() { this._ctxMenu?.classList.remove('visible'); }

    // ============ 交互 ============
    handleMouseDown(button, mouseX, mouseY) {
        if (this.isUIActive) return;

        this.raycaster.setFromCamera(this.crosshairVec, this.camera);
        const hits = this.raycaster.intersectObjects(this.planetMeshes, false);

        if (button === 0) { // 左键
            this._hideCtx();
            if (hits.length > 0) {
                const hit = hits[0].object;
                if (!this.focusedPlanet || this._zoomPlanet !== hit) {
                    // 首次点击或点击不同行星 → 聚焦放大
                    this.focusedPlanet = hit;
                    this._startZoom(hit, 1, 5);
                    // 显示跃迁按钮
                    const btn = this._ensureWarpBtn();
                    btn.style.display = 'block';
                    btn.textContent = '⌇ WARP · ' + (hit.userData.planetName || 'TARGET');
                } else {
                    // 再次点击同一行星 → 缩小还原
                    this._startZoom(hit, hit.userData.currentZoomScale || 5, 1);
                }
            } else if (this.focusedPlanet) {
                // 点击空白 → 缩小还原
                this._startZoom(this.focusedPlanet, this.focusedPlanet.userData.currentZoomScale || 5, 1);
            }
        } else if (button === 2 && this.focusedPlanet && !this.isZooming) {
            this.showContext(mouseX, mouseY);
        }
    }

    _startZoom(planet, from, to) {
        this.isZooming = true;
        this.zoomProgress = 0;
        this.zoomStartScale = from;
        this.zoomTargetScale = to;
        this._zoomPlanet = planet;
        planet.userData.currentZoomScale = from;
        if (to < from) planet.userData.willUnfocus = true;
    }

    // ============ 控制台 ============
    showUI() {
        this.isUIActive = true;
        const el = document.getElementById('ui-screen');
        if (el) el.classList.add('active');
        this.onUIActive(true);
    }
    /** 退出聚焦（跃迁或取消时调用） */
    clearFocus() {
        if (this.focusedPlanet) {
            this._startZoom(this.focusedPlanet, this.focusedPlanet.userData.currentZoomScale || 5, 1);
        }
        const wb = document.getElementById('holo-warp-btn');
        if (wb) wb.style.display = 'none';
    }

    hideUI(skipLock = false) {
        this.isUIActive = false;
        const el = document.getElementById('ui-screen');
        if (el) el.classList.remove('active');
        if (!skipLock) this.onUIActive(false);
        const wb = document.getElementById('holo-warp-btn');
        if (wb) wb.style.display = 'none';
    }

    /** 创建或更新跃迁按钮DOM */
    _ensureWarpBtn() {
        let btn = document.getElementById('holo-warp-btn');
        if (!btn) {
            btn = document.createElement('div');
            btn.id = 'holo-warp-btn';
            btn.innerHTML = '⌇ WARP';
            btn.style.cssText = 'position:fixed;bottom:120px;left:50%;transform:translateX(-50%);z-index:250;padding:12px 40px;background:rgba(0,212,255,0.12);border:1px solid rgba(0,212,255,0.6);color:#00d4ff;font-family:Orbitron,sans-serif;font-size:14px;letter-spacing:4px;cursor:pointer;display:none;backdrop-filter:blur(8px);clip-path:polygon(10px 0,100% 0,100% calc(100%-10px),calc(100%-10px) 100%,0 100%,0 10px);transition:all 0.3s;';
            btn.onmouseenter = () => { btn.style.background = 'rgba(0,212,255,0.25)'; btn.style.boxShadow = '0 0 30px rgba(0,212,255,0.4)'; };
            btn.onmouseleave = () => { btn.style.background = 'rgba(0,212,255,0.12)'; btn.style.boxShadow = 'none'; };
            btn.onclick = () => {
                if (this.focusedPlanet && this.focusedPlanet.userData.body) {
                    this.onWarp(this.focusedPlanet.userData.body);
                }
            };
            document.body.appendChild(btn);
        }
        return btn;
    }

    /** 由 ShipModule 调用，传入滚轮 delta */
    handleWheel(deltaY) {
        const cfg = HOLOGRAM_CFG;
        const d = deltaY > 0 ? -cfg.zoomStep : cfg.zoomStep;
        // 只改变目标值，实际缩放由 update() 用阻尼平滑逼近
        this.targetScale = Math.max(cfg.zoomMin, Math.min(cfg.zoomMax, this.targetScale + d));

        if (this.targetScale <= 0.42 && !this.isUIActive) {
            this.showUI();
        } else if (this.targetScale > 0.42 && this.isUIActive) {
            this.hideUI();
        }
    }

    // ============ 每帧 ============
    update(dt, time) {
        const cfg = HOLOGRAM_CFG;

        // shader
        if (this._shellMat) this._shellMat.uniforms.uTime.value = time;

        // 滚轮缩放平滑过渡：指数阻尼，与帧率无关
        if (Math.abs(this.targetScale - this.currentScale) > 1e-4) {
            const k = 1 - Math.pow(0.002, dt);
            this.currentScale += (this.targetScale - this.currentScale) * k;
            if (Math.abs(this.targetScale - this.currentScale) <= 1e-4) this.currentScale = this.targetScale;
            this.group.scale.setScalar(this.currentScale);
        }

        // 全息旋转
        const rotSpeed = this.focusedPlanet ? 0 : cfg.rotationSpeed;
        this.group.rotation.y += dt * rotSpeed;

        // 线框旋转（聚焦时停止）
        if (this._wireMesh && !this.focusedPlanet) {
            this._wireMesh.rotation.x += dt * cfg.wireRotX;
            this._wireMesh.rotation.z += dt * cfg.wireRotZ;
        }

        // 太阳呼吸
        if (this._sunGlowMat) {
            this._sunGlowMat.opacity = cfg.sunGlowOpacity
                + Math.sin(time * cfg.sunBreathFreq) * cfg.sunBreathAmp;
        }

        // 行星公转（未聚焦时）
        if (!this.focusedPlanet) {
            this.planetAnimData.forEach(pd => {
                pd.currentAngle += dt * pd.speed * cfg.orbitAnimMult;
                pd.mesh.position.x = Math.cos(pd.currentAngle) * pd.orbit;
                pd.mesh.position.z = Math.sin(pd.currentAngle) * pd.orbit;
            });
        }

        // 缩放动画
        if (this.isZooming && this._zoomPlanet) {
            this.zoomProgress += dt * 3.5;
            if (this.zoomProgress >= 1) { this.zoomProgress = 1; this.isZooming = false; }
            const e = this.zoomProgress < 0.5 ? 4 * this.zoomProgress ** 3 : 1 - Math.pow(-2 * this.zoomProgress + 2, 3) / 2;
            const cz = this.zoomStartScale + (this.zoomTargetScale - this.zoomStartScale) * e;
            this._zoomPlanet.scale.setScalar(cz);
            this._zoomPlanet.userData.currentZoomScale = cz;
            if (!this.isZooming) {
                if (this._zoomPlanet.userData.willUnfocus) {
                    // 缩小完成 → 取消聚焦
                    this._zoomPlanet.userData.willUnfocus = false;
                    this._zoomPlanet.userData.currentZoomScale = 1;
                    this.focusedPlanet = null;
                    this._hideCtx();
                    const wb = document.getElementById('holo-warp-btn');
                    if (wb) wb.style.display = 'none';
                } else {
                    // 放大完成 → 保持聚焦，显示跃迁按钮
                    this.focusedPlanet = this._zoomPlanet;
                    const btn = this._ensureWarpBtn();
                    btn.style.display = 'block';
                    btn.textContent = '⌇ WARP · ' + (this._zoomPlanet.userData.planetName || 'TARGET');
                }
            }
        }

        // 准星检测悬停
        this.raycaster.setFromCamera(this.crosshairVec, this.camera);
        const hits = this.raycaster.intersectObjects(this.planetMeshes, false);

        this.planetMeshes.forEach(pm => {
            if (pm === hits[0]?.object && !this.focusedPlanet) pm.material.emissiveIntensity = cfg.emissiveHover;
            else if (pm === this.focusedPlanet) pm.material.emissiveIntensity = cfg.emissiveFocused;
            else pm.material.emissiveIntensity = cfg.emissiveNormal;
        });

        // 检测全息壳悬停
        this.isHoverShell = this.raycaster.intersectObject(this.group)?.length > 0;
    }

    setUIActive(v) { this.isUIActive = v; }
}
