// ============================================================
// PlacementGuides.js — 三维放置引导（移植 三维位置+方向确定系统.html）
// 完整步骤：XZ平面→Y高度→速度水平方向→速度俯仰
// ============================================================
import * as THREE from 'three';
import { SYSTEM_SCALE } from '../js/constants.js';

export class PlacementGuides {
    constructor(scene) {
        this.scene = scene;
        this._origin = new THREE.Vector3(); // 原点偏移（默认场景原点）

        this._boxHelper = null;   // 体积范围框
        this._vLine = null;       // 垂直虚线
        this._arrowHelper = null; // 速度方向箭头
        this._ghostStar = null;   // 幽灵预览球
        this._gridHelper = null;  // 网格参考
        this._axesHelper = null;  // 坐标轴

        this._build();
    }

    _build() {
        const S = SYSTEM_SCALE;

        // 体积范围框（从原点拖到目标点）
        const boxGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
        this._boxHelper = new THREE.LineSegments(boxGeo, new THREE.LineBasicMaterial({
            color: 0x4fc3f7, transparent: true, opacity: 0.5
        }));
        this._boxHelper.visible = false;
        this.scene.add(this._boxHelper);

        // 垂直虚线
        this._vLine = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
            new THREE.LineDashedMaterial({ color: 0x4fc3f7, dashSize: 0.5, gapSize: 0.3, transparent: true, opacity: 0.7 })
        );
        this._vLine.computeLineDistances();
        this._vLine.visible = false;
        this.scene.add(this._vLine);

        // 速度方向箭头（长度 × SYSTEM_SCALE）
        const arrowLen = 6 * S;
        this._arrowHelper = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), arrowLen, 0x81c784, 1.5 * S, 0.8 * S);
        this._arrowHelper.visible = false;
        this.scene.add(this._arrowHelper);

        // 幽灵预览球（wireframe，尺寸可动态调整）
        this._ghostBaseRadius = 0.6;
        this._ghostStar = new THREE.Mesh(
            new THREE.SphereGeometry(this._ghostBaseRadius, 16, 16),
            new THREE.MeshBasicMaterial({ color: 0x4fc3f7, transparent: true, opacity: 0.4, wireframe: true })
        );
        this._ghostStar.visible = false;
        this._ghostStar.scale.setScalar(SYSTEM_SCALE);
        this.scene.add(this._ghostStar);

        // 网格 + 坐标轴（默认隐藏，进入放置模式才显示）
        this._gridHelper = new THREE.GridHelper(60 * S, 60, 0x333344, 0x1a1a2e);
        this._gridHelper.position.y = 0;
        this._gridHelper.visible = false;
        this.scene.add(this._gridHelper);

        this._axesHelper = new THREE.AxesHelper(5 * S);
        this._axesHelper.visible = false;
        this.scene.add(this._axesHelper);
    }

    // ---- 更新方法 ----

    /** 设置原点偏移（默认为场景原点，自定义星系中应设为中心恒星位置） */
    setOrigin(x, y, z) {
        this._origin.set(x, y, z);
        this._gridHelper?.position.set(x, y, z);
        this._axesHelper?.position.set(x, y, z);
    }

    /**
     * 移除自带的有限网格与坐标轴（星球实验室使用 InfiniteGrid 代替）。
     * 之后 show()/hide()/setOrigin() 都不会再操作它们。
     */
    disableGrid() {
        const drop = (obj) => {
            if (!obj) return;
            this.scene.remove(obj);
            obj.geometry?.dispose();
            obj.material?.dispose();
        };
        drop(this._gridHelper);
        drop(this._axesHelper);
        this._gridHelper = null;
        this._axesHelper = null;
    }

    /** XZ 定位：幽灵球到地面点 + 范围框 */
    updateXZ(x, z) {
        const ox = this._origin.x, oz = this._origin.z;
        this._ghostStar.position.set(x, 0, z);
        this._ghostStar.visible = true;
        this._updateBox(x - ox, 0, z - oz);
        this._vLine.visible = false;
        this._arrowHelper.visible = false;
    }

    /** Y 高度：幽灵球到最终高度 + 垂直虚线 + 范围框 */
    updateY(x, y, z) {
        const ox = this._origin.x, oz = this._origin.z;
        this._ghostStar.position.set(x, y, z);
        this._ghostStar.visible = true;
        this._updateVLine(new THREE.Vector3(x, 0, z), y);
        this._updateBox(x - ox, y - this._origin.y, z - oz);
    }

    /** 确认位置后固定幽灵球 */
    showFinalPos(x, y, z) {
        const ox = this._origin.x, oz = this._origin.z;
        this._ghostStar.position.set(x, y, z);
        this._ghostStar.visible = true;
        this._updateBox(x - ox, y - this._origin.y, z - oz);
        this._updateVLine(new THREE.Vector3(x, 0, z), y);
    }

    /** 速度水平方向（绿色箭头，长度随 SYSTEM_SCALE） */
    updateVelocityYaw(origin, dir) {
        const S = SYSTEM_SCALE;
        this._arrowHelper.position.copy(origin);
        this._arrowHelper.setDirection(dir);
        this._arrowHelper.setLength(6 * S, 1.5 * S, 0.8 * S);
        this._arrowHelper.setColor(0x81c784);
        this._arrowHelper.visible = true;
    }

    /** 速度俯仰方向（橙色箭头，长度随 SYSTEM_SCALE） */
    updateVelocityPitch(origin, dir) {
        const S = SYSTEM_SCALE;
        this._arrowHelper.position.copy(origin);
        this._arrowHelper.setDirection(dir);
        this._arrowHelper.setLength(6 * S, 1.5 * S, 0.8 * S);
        this._arrowHelper.setColor(0xffb74d);
        this._arrowHelper.visible = true;
    }

    /** 完成态：固定星体 + 速度线 */
    showDone(pos, velDir) {
        this._ghostStar.visible = false;
        this._boxHelper.visible = false;
        this._vLine.visible = false;
        this._arrowHelper.visible = false;
        // 可在此处添加最终的星体 mesh 和速度线
    }

    // ---- 内部工具 ----

    _updateBox(x, y, z) {
        const min = new THREE.Vector3(0, 0, 0);
        const max = new THREE.Vector3(x, y, z);
        const center = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5);
        const size = new THREE.Vector3().subVectors(max, min);
        this._boxHelper.position.copy(center);
        this._boxHelper.scale.set(
            Math.max(Math.abs(size.x), 0.01),
            Math.max(Math.abs(size.y), 0.01),
            Math.max(Math.abs(size.z), 0.01)
        );
        this._boxHelper.visible = true;
    }

    _updateVLine(base, height) {
        const pts = [base.clone(), base.clone().setY(height)];
        this._vLine.geometry.dispose();
        this._vLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
        this._vLine.computeLineDistances();
        this._vLine.visible = true;
    }

    /** 动态更新预览球大小（由视觉大小输入驱动） */
    setPreviewScale(factor) {
        if (this._ghostStar) {
            this._ghostStar.scale.setScalar(SYSTEM_SCALE * Math.max(0.1, factor || 1));
        }
    }

    show() {
        this._ghostStar.visible = true;
        if (this._gridHelper) this._gridHelper.visible = true;
        if (this._axesHelper) this._axesHelper.visible = true;
    }

    hide() {
        this._ghostStar.visible = false;
        this._boxHelper.visible = false;
        this._vLine.visible = false;
        this._arrowHelper.visible = false;
        if (this._gridHelper) this._gridHelper.visible = false;
        if (this._axesHelper) this._axesHelper.visible = false;
    }

    clearAll() {
        this._ghostStar.visible = false;
        this._boxHelper.visible = false;
        this._vLine.visible = false;
        this._arrowHelper.visible = false;
    }

    dispose() {
        [this._boxHelper, this._vLine, this._arrowHelper, this._ghostStar, this._gridHelper, this._axesHelper]
            .forEach((o) => {
                if (!o) return;
                this.scene.remove(o);
                if (o.geometry) o.geometry.dispose();
                if (o.material) o.material.dispose();
            });
        this._gridHelper = null;
        this._axesHelper = null;
    }
}
