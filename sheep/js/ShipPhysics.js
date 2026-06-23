// ============================================================
// ShipPhysics.js — 飞船运动物理：推力、惯性、行星引力
// ============================================================
import * as THREE from 'three';
import { G, POS_SCALE } from '../../js/constants.js';

export class ShipPhysics {
    /**
     * @param {object} planets — { sun, earth, mars, ... }
     */
    constructor(planets) {
        this.planets = planets;
        /** 飞船在世界空间的位置（SI 米） */
        this.position = new THREE.Vector3();
        /** 飞船速度（SI m/s） */
        this.velocity = new THREE.Vector3();
        /** 飞船朝向四元数 */
        this.shipQuaternion = new THREE.Quaternion();
        /** 推力加速度 (m/s^2) — 增强版 */
        this.thrustAccel = 500;
        /** 速度上限 (m/s) — 1000 km/s，星际航行级别 */
        this.maxSpeed = 1e6;

        // 缓存的局部前方向量
        this._forward = new THREE.Vector3(0, 0, -1);
        this._tempVec = new THREE.Vector3();
    }

    /**
     * 每帧物理更新
     * @param {number} dt — 真实时间步长（秒），已缩放
     * @param {boolean} isThrusting — 是否按住 W
     * @param {THREE.Vector3|null} shipForward — 飞船当前前方向量（世界空间）
     */
    update(dt, isThrusting, shipForward) {
        // 1. 推力
        if (isThrusting && shipForward) {
            const thrustVec = shipForward.clone().multiplyScalar(this.thrustAccel * dt);
            this.velocity.add(thrustVec);
        }

        // 2. 行星引力
        const totalGravAcc = this._computeGravity();

        // 3. 应用引力加速度
        this.velocity.add(totalGravAcc.multiplyScalar(dt));

        // 4. 速度上限
        const speed = this.velocity.length();
        if (speed > this.maxSpeed) {
            this.velocity.normalize().multiplyScalar(this.maxSpeed);
        }

        // 5. 更新位置
        this.position.add(this.velocity.clone().multiplyScalar(dt));
    }

    /**
     * 计算所有行星对飞船的引力加速度
     * @returns {THREE.Vector3}
     */
    _computeGravity() {
        const totalAcc = new THREE.Vector3();
        for (const planet of Object.values(this.planets)) {
            const toShip = this._tempVec.subVectors(this.position, planet.position);
            const dist = toShip.length();
            // 避免奇点：与星球表面有最小距离
            const minDist = planet.realRadius * 1.1;
            const effectiveDist = Math.max(dist, minDist);
            const accMag = G * planet.mass / (effectiveDist * effectiveDist);
            // 方向指向星球
            toShip.normalize().multiplyScalar(-accMag);
            totalAcc.add(toShip);
        }
        return totalAcc;
    }

    /** 获取当前速率 (m/s) */
    getSpeed() {
        return this.velocity.length();
    }

    /** 获取场景坐标位置（scene units） */
    getScenePosition() {
        return this.position.clone().multiplyScalar(POS_SCALE);
    }

    /** 获取飞船前方向量（世界空间） */
    getForward() {
        return this._forward.clone().applyQuaternion(this.shipQuaternion).normalize();
    }

    /** 获取飞船右方向量 */
    getRight() {
        const right = new THREE.Vector3(1, 0, 0);
        return right.applyQuaternion(this.shipQuaternion).normalize();
    }

    /** 获取飞船上方向量 */
    getUp() {
        const up = new THREE.Vector3(0, 1, 0);
        return up.applyQuaternion(this.shipQuaternion).normalize();
    }

    /**
     * 旋转飞船
     * @param {number} yawDelta — 偏航角增量（弧度）
     * @param {number} pitchDelta — 俯仰角增量（弧度）
     */
    rotateShip(yawDelta, pitchDelta) {
        const yawQ = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 1, 0), yawDelta
        );
        const right = this.getRight();
        const pitchQ = new THREE.Quaternion().setFromAxisAngle(right, pitchDelta);
        this.shipQuaternion.multiply(yawQ);
        this.shipQuaternion.multiply(pitchQ);
        this.shipQuaternion.normalize();
    }

    /** 设置初始位置（SI 米） */
    setPositionSI(siPos) {
        this.position.copy(siPos);
    }

    /** 设置初始速度（SI m/s） */
    setVelocitySI(siVel) {
        this.velocity.copy(siVel);
    }

    /** 设置初始朝向 */
    setForwardDirection(forwardVec) {
        const target = new THREE.Vector3(0, 0, -1);
        this.shipQuaternion.setFromUnitVectors(target, forwardVec.clone().normalize());
    }
}
