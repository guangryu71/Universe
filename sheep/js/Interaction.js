// ============================================================
// Interaction.js — E/F 交互系统，射线检测可交互物体
// ============================================================
import * as THREE from 'three';

export class Interaction {
    /**
     * @param {THREE.Camera} camera — 内部场景相机
     * @param {Array} interactables — [{ mesh, type, label, ... }]
     * @param {number} maxDistance — 最大交互距离
     */
    constructor(camera, interactables, maxDistance = 7) {
        this.camera = camera;
        this.interactables = interactables;
        this.maxDistance = maxDistance;
        this.raycaster = new THREE.Raycaster();
        this.raycaster.far = maxDistance;
        this.currentTarget = null;
    }

    /**
     * 每帧更新：检测相机前方是否有可交互物体
     * @returns {{ mesh, type, label } | null}
     */
    update() {
        this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
        const meshes = this.interactables.map(i => i.mesh);
        const intersects = this.raycaster.intersectObjects(meshes, false);

        if (intersects.length > 0 && intersects[0].distance <= this.maxDistance) {
            const hitMesh = intersects[0].object;
            const target = this.interactables.find(i => i.mesh === hitMesh);
            if (target) {
                this.currentTarget = target;
                return target;
            }
        }

        this.currentTarget = null;
        return null;
    }

    /** 按下 E：触发当前目标的交互 */
    onPressE() {
        return this.currentTarget || null;
    }
}
