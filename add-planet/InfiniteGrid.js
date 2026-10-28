// ============================================================
// InfiniteGrid.js — 星球实验室的无限三维参考网格
//
// 网格画在一张跟随相机水平移动的大平面上，线条位置由世界坐标
// 在片元着色器里计算，因此相机移动时线条固定在空间中、并向远处
// 持续延伸（类似 Minecraft 区块随视角动态加载的观感）。
// X 轴（红）、Z 轴（蓝）由着色器绘制，Y 轴（绿）是一条贯穿
// 相机可视范围的长直线，三者共同构成三维参考系。
// ============================================================

import * as THREE from 'three';

const VERT = /* glsl */`
    varying vec3 vWorld;
    void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
    }
`;

const FRAG = /* glsl */`
    precision highp float;

    uniform float uCell;
    uniform float uMajor;
    uniform float uFadeStart;
    uniform float uFadeEnd;
    uniform float uOpacity;
    uniform vec3  uMinorColor;
    uniform vec3  uMajorColor;
    uniform vec3  uAxisXColor;
    uniform vec3  uAxisZColor;
    uniform vec3  uCameraPos;

    varying vec3 vWorld;

    // 1 像素宽的网格线（用屏幕空间导数做抗锯齿）
    float lineMask(vec2 p, float cell) {
        vec2 c = p / cell;
        vec2 d = abs(fract(c - 0.5) - 0.5) / max(fwidth(c), vec2(1e-6));
        return 1.0 - min(min(d.x, d.y), 1.0);
    }

    // 坐标轴：|coord| 越小越亮
    float axisMask(float coord) {
        float w = max(fwidth(coord), 1e-6);
        return 1.0 - smoothstep(0.0, 1.6 * w, abs(coord));
    }

    void main() {
        vec2 p = vWorld.xz;

        float minor = lineMask(p, uCell);
        float major = lineMask(p, uCell * uMajor);
        float xAxis = axisMask(vWorld.z); // 沿 X 轴延伸的线（z = 0）
        float zAxis = axisMask(vWorld.x); // 沿 Z 轴延伸的线（x = 0）

        vec3 color = uMinorColor;
        float alpha = minor * 0.24;

        if (major > 0.001) color = mix(color, uMajorColor, major);
        alpha = max(alpha, major * 0.52);

        if (xAxis > 0.001) color = mix(color, uAxisXColor, xAxis);
        alpha = max(alpha, xAxis * 0.9);

        if (zAxis > 0.001) color = mix(color, uAxisZColor, zAxis);
        alpha = max(alpha, zAxis * 0.9);

        float dist = distance(vWorld, uCameraPos);
        float fade = 1.0 - smoothstep(uFadeStart, uFadeEnd, dist);
        alpha *= fade * uOpacity;

        if (alpha < 0.002) discard;
        gl_FragColor = vec4(color, alpha);
    }
`;

const PLANE_SIZE = 120000;
const Y_AXIS_LENGTH = 50000;

export class InfiniteGrid {
    constructor() {
        this.group = new THREE.Group();
        this.group.name = 'infinite-grid';

        this.material = new THREE.ShaderMaterial({
            uniforms: {
                uCell: { value: 50 },
                uMajor: { value: 5 },
                uFadeStart: { value: 700 },
                uFadeEnd: { value: 4000 },
                uOpacity: { value: 1 },
                uMinorColor: { value: new THREE.Color(0x33445c) },
                uMajorColor: { value: new THREE.Color(0x4e6a88) },
                uAxisXColor: { value: new THREE.Color(0xff5555) },
                uAxisZColor: { value: new THREE.Color(0x5599ff) },
                uCameraPos: { value: new THREE.Vector3() },
            },
            vertexShader: VERT,
            fragmentShader: FRAG,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
        });

        const plane = new THREE.Mesh(new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE), this.material);
        plane.rotation.x = -Math.PI / 2;
        plane.renderOrder = -1;
        this.plane = plane;
        this.group.add(plane);

        // Y 轴：贯穿相机可及范围的绿色竖线
        const yGeo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, -Y_AXIS_LENGTH, 0),
            new THREE.Vector3(0, Y_AXIS_LENGTH, 0),
        ]);
        this.yAxis = new THREE.Line(yGeo, new THREE.LineBasicMaterial({
            color: 0x44ff44,
            transparent: true,
            opacity: 0.4,
            depthWrite: false,
        }));
        this.group.add(this.yAxis);
    }

    /**
     * 每帧调用：网格平面跟随相机水平位置，并按视距调整远处淡出。
     * @param {THREE.Camera} camera
     * @param {THREE.Vector3} [target] - OrbitControls 的焦点
     */
    update(camera, target) {
        this.plane.position.set(camera.position.x, 0, camera.position.z);

        const dist = target
            ? camera.position.distanceTo(target)
            : Math.max(camera.position.length(), 1);

        const fadeStart = THREE.MathUtils.clamp(dist * 2.0, 600, 30000);
        const fadeEnd = THREE.MathUtils.clamp(dist * 9.0, 2600, 50000);

        const u = this.material.uniforms;
        u.uFadeStart.value = fadeStart;
        u.uFadeEnd.value = fadeEnd;
        u.uCameraPos.value.copy(camera.position);
    }

    setVisible(visible) {
        this.group.visible = !!visible;
    }

    dispose() {
        this.group.traverse((obj) => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) obj.material.dispose();
        });
        if (this.group.parent) this.group.parent.remove(this.group);
    }
}
