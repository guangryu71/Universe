// ============================================================
// PlacementGuides.js — 可视化放置引导元素（Three.js）
// 预览球体、XZ投影线、Y高度线、速度箭头
// 供 BodyEditor 和 PlanetLab 共用
// ============================================================
import * as THREE from 'three';

export class PlacementGuides {
    constructor(scene) {
        this.scene = scene;
        this.group = new THREE.Group();
        this.group.visible = false;
        this.scene.add(this.group);

        this._build();
    }

    _build() {
        // 投影线（XZ 面）
        this.xzLine = this._createLine(0xff4444);
        // 高度线（Y）
        this.yLine = this._createLine(0x44ff44);
        // 速度方向线
        this.vLine = this._createLine(0xffcc00);
        // 速度箭头
        const coneGeo = new THREE.ConeGeometry(0.12, 0.35, 8, 4);
        const coneMat = new THREE.MeshBasicMaterial({ color: 0xffcc00 });
        this.vArrow = new THREE.Mesh(coneGeo, coneMat);
        this.vArrow.visible = false;
        this.group.add(this.vArrow);

        // 预览球体
        const sphereGeo = new THREE.SphereGeometry(0.8, 24, 24);
        const sphereMat = new THREE.MeshStandardMaterial({
            color: 0x00cc66, roughness: 0.5, metalness: 0.2,
            transparent: true, opacity: 0.7,
        });
        this.previewSphere = new THREE.Mesh(sphereGeo, sphereMat);
        this.previewSphere.visible = false;
        this.scene.add(this.previewSphere);
    }

    _createLine(color) {
        const geo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(), new THREE.Vector3()
        ]);
        const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
            color, transparent: true, opacity: 0.6, depthTest: true,
        }));
        this.group.add(line);
        return line;
    }

    _updateLine(line, from, to) {
        const p = line.geometry.attributes.position.array;
        p[0]=from.x; p[1]=from.y; p[2]=from.z;
        p[3]=to.x;   p[4]=to.y;   p[5]=to.z;
        line.geometry.attributes.position.needsUpdate = true;
    }

    // ---- 公开方法 ----

    show() { this.group.visible = true; this.previewSphere.visible = true; }
    hide() { this.group.visible = false; this.previewSphere.visible = false; }

    /** 更新 XZ 投影线 + 预览球 */
    updateXZ(x, z) {
        this.previewSphere.position.set(x, 0, z);
        this._updateLine(this.xzLine, new THREE.Vector3(x, 0, 0), new THREE.Vector3(x, 0, z));
    }

    /** 更新 Y 高度线 + 预览球 */
    updateY(x, y, z) {
        this.previewSphere.position.set(x, y, z);
        this._updateLine(this.yLine, new THREE.Vector3(x, -20, z), new THREE.Vector3(x, 20, z));
    }

    /** 更新速度箭头 */
    updateVelocityArrow(fromPos, dirWorld) {
        const arrowEnd = fromPos.clone().add(dirWorld.clone().multiplyScalar(3));
        this._updateLine(this.vLine, fromPos, arrowEnd);
        this.vArrow.position.copy(arrowEnd);
        this.vArrow.lookAt(arrowEnd.clone().add(dirWorld));
        this.vArrow.visible = true;
    }

    /** 隐藏速度箭头 */
    hideVelocityArrow() {
        this.vArrow.visible = false;
        this._updateLine(this.vLine, new THREE.Vector3(), new THREE.Vector3());
    }

    /** 清除所有引导线 */
    clearAll() {
        this._updateLine(this.xzLine, new THREE.Vector3(), new THREE.Vector3());
        this._updateLine(this.yLine, new THREE.Vector3(), new THREE.Vector3());
        this._updateLine(this.vLine, new THREE.Vector3(), new THREE.Vector3());
        this.vArrow.visible = false;
    }

    /** 销毁 */
    dispose() {
        this.scene.remove(this.group);
        this.scene.remove(this.previewSphere);
        this.group.traverse(obj => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) obj.material.dispose();
        });
        this.previewSphere.geometry?.dispose();
        this.previewSphere.material?.dispose();
    }
}
