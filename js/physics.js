// ============================================================
// physics.js — N体引力模拟引擎
// 使用 Velocity Verlet 积分法，保证能量守恒
// ============================================================

import * as THREE from 'three';
import { G, SUBSTEPS } from './constants.js';

export class PhysicsEngine {
    /**
     * @param {CelestialBody[]} bodies - 所有天体实例
     */
    constructor(bodies) {
        /** @type {CelestialBody[]} */
        this.bodies = bodies;
        this.elapsedSimTime = 0;  // 累计模拟时间（秒）
    }

    /**
     * 计算所有天体之间的引力加速度
     * 返回 Map<CelestialBody, THREE.Vector3>
     */
    computeAccelerations() {
        const accels = new Map();
        for (const body of this.bodies) {
            accels.set(body, new THREE.Vector3(0, 0, 0));
        }

        const GVal = G;
        const n = this.bodies.length;

        // 两两计算引力（O(n²)但太阳系只有10个天体，完全没问题）
        for (let i = 0; i < n; i++) {
            const a = this.bodies[i];
            // 太阳不再特殊跳过，黑洞等大质量天体会对其产生引力

            const accA = accels.get(a);
            const posA = a.position;
            const massA = a.mass;

            for (let j = 0; j < n; j++) {
                if (i === j) continue;
                const b = this.bodies[j];
                const posB = b.position;
                const massB = b.mass;

                // 方向向量 a → b
                const dx = posB.x - posA.x;
                const dy = posB.y - posA.y;
                const dz = posB.z - posA.z;
                const distSq = dx * dx + dy * dy + dz * dz;
                const dist = Math.sqrt(distSq);

                // 避免奇点（天体碰撞时距离极小）
                const minDist = (a.realRadius + b.realRadius) * 0.5;
                const effectiveDist = Math.max(dist, minDist);
                const effectiveDistSq = effectiveDist * effectiveDist;

                // F = G * m1 * m2 / r^2
                // a_A = F / m_A = G * m_B / r^2  (方向: 从 A 指向 B)
                const forceMag = GVal * massB / effectiveDistSq;

                if (dist > 0) {
                    const nx = dx / dist;
                    const ny = dy / dist;
                    const nz = dz / dist;

                    accA.x += forceMag * nx;
                    accA.y += forceMag * ny;
                    accA.z += forceMag * nz;
                }

                // 太阳也受到引力（但我们在 update 中保持太阳不动，这里不处理）
                // 如需太阳微动，取消下行注释：
                // if (b.key !== 'sun') { ... }
            }
        }

        return accels;
    }

    /**
     * 执行一个完整时间步长
     * @param {number} totalDt - 总时间步长（秒）
     */
    step(totalDt) {
        const subDt = totalDt / SUBSTEPS;

        for (let s = 0; s < SUBSTEPS; s++) {
            // 1. 计算当前加速度
            const accels = this.computeAccelerations();

            // 2. Velocity Verlet 第一步：更新位置 + 半步速度
            for (const body of this.bodies) {
                const acc = accels.get(body);
                body.updatePhysics(acc, subDt);
            }

            // 3. 计算新位置下的加速度
            const newAccels = this.computeAccelerations();

            // 4. Velocity Verlet 第二步：更新剩余半步速度
            for (const body of this.bodies) {
                const acc = newAccels.get(body);
                body.applySecondHalfVelocity(acc, subDt);
            }

            this.elapsedSimTime += subDt;
        }
    }

    /** 添加天体到模拟 */
    addBody(body) {
        this.bodies.push(body);
    }

    /** 从模拟中移除天体 */
    removeBody(body) {
        this.bodies = this.bodies.filter(b => b !== body);
    }

}
