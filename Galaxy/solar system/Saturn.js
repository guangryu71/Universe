// ============================================================
// Saturn.js — 土星类
// 太阳系第二大行星，以壮观的环系统著称
// ============================================================

import * as THREE from 'three';
import { CelestialBody } from '../../js/CelestialBody.js';

const textureLoader = new THREE.TextureLoader();
const TB = 'Galaxy/solar system/planets/2k/';

export class Saturn extends CelestialBody {

    static KEY           = 'saturn';
    static NAME          = '土星';
    static NAME_CN       = 'Saturn';
    static MASS          = 5.6834e26;
    static RADIUS        = 5.8232e7;
    static ORBIT_RADIUS  = 1.427e12;
    static VISUAL_RADIUS = 1.4;
    static COLOR         = 0xe8d5a3;
    static TEXTURE       = TB + '2k_saturn.jpg';
    static RING_TEXTURE  = TB + '2k_saturn_ring_alpha.png';

    static DETAILS = `土星是太阳系中第二大的行星，以其壮观的环系统闻名于世。

【基本参数】
• 直径：约116,460 km（地球的9.1倍）
• 质量：约5.68×10²⁶ kg（地球的95倍）
• 云顶温度：约-178°C
• 自转周期：约10.7小时
• 公转周期：约29.46年
• 轨道速度：约9.7 km/s
• 卫星数量：146+（已知，太阳系最多）
• 距太阳平均距离：约14.27亿 km

【壮观的环】
土星环主要由水冰、岩石碎片和尘埃组成，宽度可达数十万公里，但厚度仅约10米至1公里，是太阳系最壮观的天体结构之一。环系统分为多个主要环区（A环、B环、C环等），由"卡西尼缝"等间隙分隔。环的密度非常低——如果把环的所有物质压缩成一个球体，直径仅有约200 km。土星环的年龄仍有争议，可能在1亿年内形成，远晚于土星本身。

【土卫六（泰坦）】
土星最大的卫星土卫六（Titan）是太阳系中唯一拥有浓厚大气层的卫星，也是除地球外唯一表面存在稳定液体的天体——不过那里的液体是甲烷和乙烷，而非水。土卫六被认为是研究生命起源的天然实验室。

【密度之最】
土星是太阳系中密度最低的行星（约0.687 g/cm³），甚至比水还轻——理论上，如果能找到一个足够大的水池，土星可以漂浮在水面上。`;

    static VOICE_INTRO = `土星，环系明珠。壮丽的冰岩环带绵延数十万公里，厚度却不过几十米。太阳系最优雅的存在。`;

    constructor(scene) {
        super({
            key: Saturn.KEY,
            name: Saturn.NAME,
            nameCN: Saturn.NAME_CN,
            mass: Saturn.MASS,
            radius: Saturn.RADIUS,
            orbitRadius: Saturn.ORBIT_RADIUS,
            visualRadius: Saturn.VISUAL_RADIUS,
            color: Saturn.COLOR,
            texturePath: Saturn.TEXTURE,
            details: Saturn.DETAILS,
            voiceIntro: Saturn.VOICE_INTRO,
            rotationSpeed: 1.8,
            scene,
        });
        this.position.set(Saturn.ORBIT_RADIUS, 0, 0);
        this._addRings(scene);
    }

    // ---- 添加土星环 ----
    _addRings(scene) {
        const innerR = this.visualRadius * 1.4;
        const outerR = this.visualRadius * 2.5;
        const ringGeo = new THREE.RingGeometry(innerR, outerR, 128);

        // 修正 UV：使贴图从内环到外环正确映射
        const pos = ringGeo.attributes.position;
        const uv = ringGeo.attributes.uv;
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i);
            const y = pos.getY(i);
            const dist = Math.sqrt(x * x + y * y);
            const u = (dist - innerR) / (outerR - innerR);
            uv.setXY(i, u, 0.5);
        }

        ringGeo.rotateX(-Math.PI / 2);

        const ringMat = new THREE.MeshStandardMaterial({
            side: THREE.DoubleSide,
            roughness: 0.5,
            transparent: true,
            opacity: 0.85,
            depthWrite: false,
        });

        // 加载环贴图
        textureLoader.load(
            Saturn.RING_TEXTURE,
            (tex) => { ringMat.map = tex; ringMat.color.set(0xffffff); ringMat.needsUpdate = true; },
            undefined,
            () => console.warn('[Saturn] 环贴图加载失败')
        );

        this.ringMesh = new THREE.Mesh(ringGeo, ringMat);
        scene.add(this.ringMesh);

        // 内环
        const innerRingGeo = new THREE.RingGeometry(
            this.visualRadius * 1.12, this.visualRadius * 1.35, 64
        );

        const ipos = innerRingGeo.attributes.position;
        const iuv = innerRingGeo.attributes.uv;
        const iInner = this.visualRadius * 1.12;
        const iOuter = this.visualRadius * 1.35;
        for (let i = 0; i < ipos.count; i++) {
            const x = ipos.getX(i);
            const y = ipos.getY(i);
            const dist = Math.sqrt(x * x + y * y);
            const u = (dist - iInner) / (iOuter - iInner);
            iuv.setXY(i, u, 0.5);
        }

        innerRingGeo.rotateX(-Math.PI / 2);
        const innerRingMat = new THREE.MeshStandardMaterial({
            color: 0xd4c090,
            side: THREE.DoubleSide,
            roughness: 0.7,
            transparent: true,
            opacity: 0.45,
            depthWrite: false,
        });
        this.innerRingMesh = new THREE.Mesh(innerRingGeo, innerRingMat);
        scene.add(this.innerRingMesh);
    }

    _syncMeshPosition() {
        super._syncMeshPosition();
        if (this.innerRingMesh) {
            this.innerRingMesh.position.copy(this.mesh.position);
        }
    }
}
