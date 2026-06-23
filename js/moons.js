// ============================================================
// moons.js — 太阳系卫星数据与工厂函数
// ============================================================

import * as THREE from 'three';
import { colorToHex } from './utils.js';

// 卫星数据配置
const MOON_DATA = {
    earth: [
        { key: 'moon', name: '月球', nameCN: 'Moon', orbitR: 1.2, radius: 0.12, color: 0xcccccc,
          info: '月球是地球唯一的天然卫星，直径约3,474 km，距地球约384,400 km。月球引起地球潮汐，稳定了地球自转轴。人类于1969年首次登月。' },
    ],
    mars: [
        { key: 'phobos', name: '火卫一', nameCN: 'Phobos', orbitR: 0.6, radius: 0.06, color: 0x8b7355,
          info: '火卫一是火星两颗卫星中较大的一颗，形状不规则，正缓慢螺旋靠近火星，预计数千万年后将解体。' },
        { key: 'deimos', name: '火卫二', nameCN: 'Deimos', orbitR: 0.85, radius: 0.05, color: 0x9b8b7a,
          info: '火卫二是火星较小的卫星，可能是被捕获的小行星，表面相对光滑，缺乏火卫一上的大型撞击坑。' },
    ],
    jupiter: [
        { key: 'io', name: '木卫一', nameCN: 'Io', orbitR: 2.8, radius: 0.2, color: 0xffcc44,
          info: '木卫一是太阳系中火山活动最活跃的天体，拥有超过400座活火山。潮汐加热使其内部持续保持熔融状态。' },
        { key: 'europa', name: '木卫二', nameCN: 'Europa', orbitR: 3.4, radius: 0.18, color: 0xddeeff,
          info: '木卫二冰层下存在液态海洋，水量可能是地球的两倍，是太阳系中寻找地外生命最重要的目标之一。' },
        { key: 'ganymede', name: '木卫三', nameCN: 'Ganymede', orbitR: 4.2, radius: 0.25, color: 0x999999,
          info: '木卫三是太阳系最大的卫星，比水星还大。它是已知唯一拥有自身磁场的卫星。' },
        { key: 'callisto', name: '木卫四', nameCN: 'Callisto', orbitR: 5.0, radius: 0.22, color: 0x555566,
          info: '木卫四是伽利略卫星中最外层的一颗，表面布满撞击坑，是太阳系中撞击坑密度最高的天体之一。' },
    ],
    saturn: [
        { key: 'titan', name: '土卫六', nameCN: 'Titan', orbitR: 3.0, radius: 0.22, color: 0xddaa66,
          info: '土卫六是太阳系中唯一拥有浓厚大气层的卫星，表面存在液态甲烷湖泊，被视为研究生命起源的天然实验室。' },
        { key: 'enceladus', name: '土卫二', nameCN: 'Enceladus', orbitR: 2.2, radius: 0.1, color: 0xf0f8ff,
          info: '土卫二南极有冰火山喷发现象，向太空喷射水冰和有机分子，其地下海洋可能具备生命所需条件。' },
        { key: 'rhea', name: '土卫五', nameCN: 'Rhea', orbitR: 3.6, radius: 0.12, color: 0xcccccc,
          info: '土卫五是土星第二大卫星，主要由水冰和岩石组成，表面有微弱的氧大气层——太阳系中罕见的特征。' },
        { key: 'iapetus', name: '土卫八', nameCN: 'Iapetus', orbitR: 5.0, radius: 0.11, color: 0x888888,
          info: '土卫八以极端的双色表面闻名——一半亮如雪，一半暗如炭，这种色彩差异的原因至今仍有争议。' },
    ],
    uranus: [
        { key: 'titania', name: '天卫三', nameCN: 'Titania', orbitR: 1.8, radius: 0.13, color: 0xaabbcc,
          info: '天卫三是天王星最大的卫星，表面有巨大的峡谷和断层，暗示过去曾有过剧烈的地质活动。' },
        { key: 'oberon', name: '天卫四', nameCN: 'Oberon', orbitR: 2.2, radius: 0.12, color: 0x99aabb,
          info: '天卫四是天王星最外层的较大卫星，表面布满撞击坑，是天王星卫星中地质活动最少的之一。' },
    ],
    neptune: [
        { key: 'triton', name: '海卫一', nameCN: 'Triton', orbitR: 1.6, radius: 0.16, color: 0xccbbcc,
          info: '海卫一是海王星最大的卫星，拥有逆行轨道（暗示它可能是一颗被捕获的柯伊伯带天体），表面有活跃的冰火山。' },
    ],
};

/**
 * 为指定行星创建卫星列表
 * @param {THREE.Scene} scene
 * @param {object} parentBody - 父行星 CelestialBody 实例
 * @returns {Array} 卫星对象数组
 */
export function createMoons(scene, parentBody) {
    const parentKey = parentBody.key;
    const moonDefs = MOON_DATA[parentKey];
    if (!moonDefs) return [];

    const moons = [];
    moonDefs.forEach((def, idx) => {
        const geo = new THREE.SphereGeometry(def.radius, 32, 32);
        const mat = new THREE.MeshStandardMaterial({
            color: def.color,
            roughness: 0.7,
            metalness: 0.1,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.userData = {
            isMoon: true,
            parentKey: parentKey,
            moonData: {
                key: def.key,
                name: def.name,
                nameCN: def.nameCN,
                color: colorToHex(def.color),
                diameter: (def.radius * 2 * 6371).toFixed(0) + ' km',
                mass: '--',
                distanceFromEarth: '--',
                details: def.info,
            },
        };
        scene.add(mesh);

        moons.push({
            key: def.key,
            name: def.name,
            nameCN: def.nameCN,
            mesh: mesh,
            orbitRadius: def.orbitR,
            orbitSpeed: 0.8 + idx * 0.3 + Math.random() * 0.4, // rad/s
            orbitPhase: Math.random() * Math.PI * 2,
            color: def.color,
            details: def.info,
        });
    });
    return moons;
}

/**
 * 更新卫星位置（每帧调用）
 */
export function updateMoons(moons, parentPos, dt) {
    for (const m of moons) {
        m.orbitPhase += m.orbitSpeed * dt;
        const x = parentPos.x + Math.cos(m.orbitPhase) * m.orbitRadius;
        const z = parentPos.z + Math.sin(m.orbitPhase) * m.orbitRadius;
        m.mesh.position.set(x, parentPos.y, z);
        // 微小的自转
        m.mesh.rotation.y += 0.5 * dt;
    }
}
