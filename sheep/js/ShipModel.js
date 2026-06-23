// ============================================================
// ShipModel.js — 飞船外观模型 + 内部场景
// ============================================================
import * as THREE from 'three';

// ---------- 材质工厂（带模块级缓存，减少 GPU 状态切换） ----------
const _matCache = new Map();

function _cached(key, factory) {
    if (!_matCache.has(key)) _matCache.set(key, factory());
    return _matCache.get(key);
}

function darkMetal(color = 0x334455) {
    return _cached('dm_' + color, () => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.85 }));
}
function emissiveAccent(color = 0x00ccaa) {
    return _cached('ea_' + color, () => new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.3, emissive: color, emissiveIntensity: 0.6 }));
}
function wallMaterial() {
    return _cached('wall', () => new THREE.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.7, metalness: 0.4 }));
}
function floorMaterial() {
    return _cached('floor', () => new THREE.MeshStandardMaterial({ color: 0x222233, roughness: 0.5, metalness: 0.6 }));
}
function glowLine(color = 0x00ccaa) {
    return _cached('gl_' + color, () => new THREE.MeshBasicMaterial({ color }));
}

export class ShipModel {
    constructor() {
        this.exteriorGroup = null;   // THREE.Group → 放入主场景
        this.interiorScene = null;   // THREE.Scene  → 飞船内部
        this.interactables = [];     // { mesh, type, label, onInteract }
        this.collisionBounds = [];   // { min: Vector3, max: Vector3 } AABB
        this.screen1Mesh = null;
        this.screen2Mesh = null;
        this.cockpitSeatPos = new THREE.Vector3();
        this.cockpitSeatDir = new THREE.Vector3();
        this.spawnPos = new THREE.Vector3();
        this.spawnDir = new THREE.Vector3();

        this._buildExterior();
        this._buildInterior();
    }

    // ==================== 外部模型（主场景） ====================
    _buildExterior() {
        const g = new THREE.Group();

        // -- 主船体：前宽后窄 --
        const hullGeo = new THREE.CylinderGeometry(0.12, 0.08, 0.8, 8);
        const hull = new THREE.Mesh(hullGeo, darkMetal(0x334455));
        hull.rotation.x = Math.PI / 2;
        hull.position.z = -0.05;
        g.add(hull);

        // 船体中段加宽
        const midGeo = new THREE.CylinderGeometry(0.14, 0.12, 0.3, 8);
        const mid = new THREE.Mesh(midGeo, darkMetal(0x3a4a5a));
        mid.rotation.x = Math.PI / 2;
        mid.position.z = 0.15;
        g.add(mid);

        // -- 前部玻璃穹顶 --
        const domeGeo = new THREE.SphereGeometry(0.14, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
        const domeMat = new THREE.MeshPhysicalMaterial({
            color: 0x88ccff,
            roughness: 0.05,
            metalness: 0.05,
            transparent: true,
            opacity: 0.35,
            envMapIntensity: 0.5,
        });
        const dome = new THREE.Mesh(domeGeo, domeMat);
        dome.position.z = 0.42;
        g.add(dome);

        // 穹顶边框（环形）
        const rimGeo = new THREE.TorusGeometry(0.14, 0.01, 8, 24);
        const rim = new THREE.Mesh(rimGeo, darkMetal(0x556677));
        rim.position.z = 0.42;
        g.add(rim);

        // -- 尾部引擎 --
        for (let i = -1; i <= 1; i += 2) {
            const engGeo = new THREE.CylinderGeometry(0.03, 0.04, 0.18, 8);
            const eng = new THREE.Mesh(engGeo, darkMetal(0x222233));
            eng.rotation.x = Math.PI / 2;
            eng.position.set(i * 0.06, 0, -0.42);
            g.add(eng);

            // 引擎发光
            const glowGeo = new THREE.CylinderGeometry(0.025, 0.02, 0.04, 8);
            const glow = new THREE.Mesh(glowGeo, emissiveAccent(0x00aaff));
            glow.rotation.x = Math.PI / 2;
            glow.position.set(i * 0.06, 0, -0.52);
            g.add(glow);
        }

        // -- 侧翼 --
        for (let i = -1; i <= 1; i += 2) {
            const wingGeo = new THREE.BoxGeometry(0.02, 0.08, 0.25);
            const wing = new THREE.Mesh(wingGeo, darkMetal(0x3a4050));
            wing.position.set(i * 0.14, 0, 0.0);
            g.add(wing);
        }

        // -- 装饰发光线 --
        for (let z = -0.3; z <= 0.3; z += 0.2) {
            const lineGeo = new THREE.TorusGeometry(0.13, 0.004, 8, 16);
            const line = new THREE.Mesh(lineGeo, glowLine(0x00cc88));
            line.position.z = z;
            g.add(line);
        }

        this.exteriorGroup = g;
    }

    // ==================== 内部场景 ====================
    _buildInterior() {
        const scene = new THREE.Scene();
        // 背景设为 null → 主场景透过穹顶可见
        scene.background = null;
        scene.fog = new THREE.Fog(0x050510, 10, 28);

        // --- 光照（明亮舒适） ---
        const ambient = new THREE.AmbientLight(0x334466, 2.5);
        scene.add(ambient);

        // 主走廊灯
        const mainLight = new THREE.PointLight(0xeeddcc, 40, 18, 1.5);
        mainLight.position.set(0, 2.5, -2);
        scene.add(mainLight);

        // 驾驶舱蓝光
        const cockpitLight = new THREE.PointLight(0x6699cc, 35, 12, 2);
        cockpitLight.position.set(0, 2.2, 7);
        scene.add(cockpitLight);

        // 尾部暖光
        const tailLight = new THREE.PointLight(0xdd9944, 30, 12, 2);
        tailLight.position.set(0, 2.0, -7);
        scene.add(tailLight);

        // 投影仪区域
        const projLight = new THREE.PointLight(0x00cc88, 25, 8, 2);
        projLight.position.set(0, 2.5, 1);
        scene.add(projLight);

        // 中央补充光源
        const centerLight = new THREE.PointLight(0xaaccff, 20, 10, 2);
        centerLight.position.set(0, 2.0, 1.5);
        scene.add(centerLight);

        // 墙壁暗藏灯带（走廊两侧）
        for (let z = -6; z <= 4; z += 3) {
            for (let s = -1; s <= 1; s += 2) {
                const stripLight = new THREE.PointLight(0x4488aa, 8, 4, 3);
                stripLight.position.set(s * 2.8, 1.0, z);
                scene.add(stripLight);
            }
        }

        // --- 建筑结构 ---
        this._buildRoomShell(scene);   // 外壳：地板、天花板、墙壁
        this._buildCockpit(scene);     // 驾驶舱（前部）
        this._buildCentralRoom(scene); // 中央房间 + 投影仪 + 屏幕
        this._buildTail(scene);        // 尾部生活区

        this.interiorScene = scene;
    }

    // ------ 外壳 ------
    _buildRoomShell(scene) {
        const L = 10, W = 3.2, H = 2.2;  // 半长、半宽、半高
        const T = 0.15; // 壁厚

        // 地板
        const floorGeo = new THREE.BoxGeometry(W * 2 + T, T, L * 2 + T);
        const floor = new THREE.Mesh(floorGeo, floorMaterial());
        floor.position.y = -H;
        scene.add(floor);

        // 天花板
        const ceilGeo = new THREE.BoxGeometry(W * 2 + T, T, L * 2 + T);
        const ceil = new THREE.Mesh(ceilGeo, wallMaterial());
        ceil.position.y = H;
        scene.add(ceil);

        // 左墙
        const lwGeo = new THREE.BoxGeometry(T, H * 2, L * 2 + T);
        const lw = new THREE.Mesh(lwGeo, wallMaterial());
        lw.position.x = -W;
        scene.add(lw);

        // 右墙
        const rwGeo = new THREE.BoxGeometry(T, H * 2, L * 2 + T);
        const rw = new THREE.Mesh(rwGeo, wallMaterial());
        rw.position.x = W;
        scene.add(rw);

        // 前墙（驾驶舱方向，有开口通往驾驶舱）
        const fwGeo = new THREE.BoxGeometry(W * 2 + T, H * 2, T);
        const fw = new THREE.Mesh(fwGeo, wallMaterial());
        fw.position.z = L - 5; // 驾驶舱隔断在 z=5
        // 开门洞：用简单的左右两块
        fw.scale.set(0.35, 1, 1);
        fw.position.x = W * 0.65;
        scene.add(fw);
        const fw2 = new THREE.Mesh(fwGeo.clone(), wallMaterial());
        fw2.scale.set(0.35, 1, 1);
        fw2.position.x = -W * 0.65;
        fw2.position.z = L - 5;
        scene.add(fw2);

        // 后墙（尾部隔断，z=-3 附近）
        const bwGeo = new THREE.BoxGeometry(W * 2 + T, H * 2, T);
        const bw = new THREE.Mesh(bwGeo, wallMaterial());
        bw.position.z = -3;
        bw.scale.set(0.35, 1, 1);
        bw.position.x = W * 0.65;
        scene.add(bw);
        const bw2 = new THREE.Mesh(bwGeo.clone(), wallMaterial());
        bw2.scale.set(0.35, 1, 1);
        bw2.position.x = -W * 0.65;
        bw2.position.z = -3;
        scene.add(bw2);

        // --- 地板网格 ---
        for (let z = -9; z <= 7; z += 1.2) {
            const gGeo = new THREE.BoxGeometry(W * 1.8, 0.01, 0.03);
            const gLine = new THREE.Mesh(gGeo, glowLine(0x112233));
            gLine.position.y = -H + T * 1.2;
            gLine.position.z = z;
            scene.add(gLine);
        }
        for (let x = -W + 0.2; x <= W - 0.2; x += 1.2) {
            const gGeo = new THREE.BoxGeometry(0.03, 0.01, L * 2);
            const gLine = new THREE.Mesh(gGeo, glowLine(0x112233));
            gLine.position.set(x, -H + T * 1.2, 0);
            scene.add(gLine);
        }

        // --- 天花板网格（贴到顶部） ---
        for (let z = -9; z <= 7; z += 1.2) {
            const gGeo = new THREE.BoxGeometry(W * 1.8, 0.01, 0.03);
            const gLine = new THREE.Mesh(gGeo, glowLine(0x223344));
            gLine.position.y = H - T * 1.2;
            gLine.position.z = z;
            scene.add(gLine);
        }
        for (let x = -W + 0.2; x <= W - 0.2; x += 1.2) {
            const gGeo = new THREE.BoxGeometry(0.03, 0.01, L * 2);
            const gLine = new THREE.Mesh(gGeo, glowLine(0x223344));
            gLine.position.set(x, H - T * 1.2, 0);
            scene.add(gLine);
        }

        // --- 墙壁碰撞体 ---
        this._addWallColliders();
    }

    // ------ 驾驶舱（前部 z: 5 ~ 10） ------
    _buildCockpit(scene) {
        // 驾驶舱地板抬高
        const cFloorGeo = new THREE.BoxGeometry(3.0, 0.1, 4.5);
        const cFloor = new THREE.Mesh(cFloorGeo, floorMaterial());
        cFloor.position.set(0, -2.05, 7.5);
        scene.add(cFloor);

        // 半球面穹顶玻璃（透明，可见外面星系）
        const domeGeo = new THREE.SphereGeometry(3.2, 40, 20, 0, Math.PI * 2, 0, Math.PI * 0.48);
        const domeMat = new THREE.MeshPhysicalMaterial({
            color: 0x8899bb,
            roughness: 0.05,
            metalness: 0.02,
            transparent: true,
            opacity: 0.10,
            side: THREE.DoubleSide,
            depthWrite: false,
        });
        const innerDome = new THREE.Mesh(domeGeo, domeMat);
        innerDome.position.set(0, 0.8, 9.2);
        scene.add(innerDome);

        // 穹顶结构肋条
        for (let i = 0; i < 6; i++) {
            const angle = (i / 6) * Math.PI * 2;
            const ribGeo = new THREE.CylinderGeometry(0.02, 0.02, 3.5, 6);
            const rib = new THREE.Mesh(ribGeo, darkMetal(0x445566));
            rib.position.set(
                Math.cos(angle) * 1.5,
                0.5,
                8.5 + Math.sin(angle) * 0.3
            );
            rib.rotation.z = Math.PI / 2;
            rib.rotation.y = angle;
            scene.add(rib);
        }

        // 驾驶员座椅
        const seatBaseGeo = new THREE.CylinderGeometry(0.3, 0.35, 0.5, 12);
        const seatBase = new THREE.Mesh(seatBaseGeo, darkMetal(0x445566));
        seatBase.position.set(0, -1.5, 6.5);
        scene.add(seatBase);

        const seatBackGeo = new THREE.BoxGeometry(0.5, 0.8, 0.1);
        const seatBack = new THREE.Mesh(seatBackGeo, darkMetal(0x3a4a5a));
        seatBack.position.set(0, -0.9, 6.2);
        scene.add(seatBack);

        // 座椅扶手
        for (let s = -1; s <= 1; s += 2) {
            const armGeo = new THREE.BoxGeometry(0.08, 0.1, 0.4);
            const arm = new THREE.Mesh(armGeo, darkMetal(0x4a5a6a));
            arm.position.set(s * 0.3, -1.0, 6.5);
            scene.add(arm);
        }

        // 控制台（右侧，不遮挡前方视野）
        const consoleGeo = new THREE.BoxGeometry(0.7, 0.25, 0.5);
        const consoleMesh = new THREE.Mesh(consoleGeo, darkMetal(0x334455));
        consoleMesh.position.set(0.9, -1.0, 6.8);
        consoleMesh.rotation.x = -0.35;
        scene.add(consoleMesh);

        // 控制台发光面板
        const panelGeo = new THREE.PlaneGeometry(0.55, 0.15);
        const panelMat = new THREE.MeshBasicMaterial({ color: 0x0088cc, side: THREE.DoubleSide });
        const panel = new THREE.Mesh(panelGeo, panelMat);
        panel.position.set(0.9, -0.87, 6.9);
        panel.rotation.x = -0.35;
        scene.add(panel);

        // 操纵杆（座椅前方中央）
        const stickGeo = new THREE.CylinderGeometry(0.03, 0.04, 0.4, 8);
        const stick = new THREE.Mesh(stickGeo, darkMetal(0x556677));
        stick.position.set(0.2, -1.1, 7.0);
        stick.rotation.x = 0.2;
        scene.add(stick);

        // 座椅交互点（大标记球，便于检测）
        const seatMarkerGeo = new THREE.SphereGeometry(0.8, 8, 8);
        const seatMarkerMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.0 });
        const seatMarker = new THREE.Mesh(seatMarkerGeo, seatMarkerMat);
        seatMarker.position.set(0, -0.5, 6.5);
        seatMarker.name = 'cockpit_seat';
        scene.add(seatMarker);

        this.cockpitSeatPos.set(0, -0.5, 6.5);
        this.cockpitSeatDir.set(0, 0, 1);
        this.interactables.push({
            mesh: seatMarker, type: 'seat',
            label: '按 E 坐上驾驶位',
            position: this.cockpitSeatPos,
            direction: this.cockpitSeatDir,
        });
    }

    // ------ 中央房间（z: -3 ~ 5） ------
    _buildCentralRoom(scene) {
        // 天花板投影仪
        const projBodyGeo = new THREE.CylinderGeometry(0.15, 0.2, 0.4, 12);
        const projBody = new THREE.Mesh(projBodyGeo, darkMetal(0x334455));
        projBody.position.set(0, 2.0, 1.5);
        scene.add(projBody);

        const projLensGeo = new THREE.CylinderGeometry(0.08, 0.12, 0.15, 12);
        const projLens = new THREE.Mesh(projLensGeo, emissiveAccent(0x00cc88));
        projLens.position.set(0, 1.7, 1.5);
        scene.add(projLens);

        // 投影仪安装臂
        const armGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6);
        const arm = new THREE.Mesh(armGeo, darkMetal(0x445566));
        arm.position.set(0, 2.25, 1.5);
        scene.add(arm);

        // 屏幕 1 — 当前星系视图（左墙）
        const scr1Geo = new THREE.PlaneGeometry(2.0, 1.2);
        const scr1Mat = new THREE.MeshBasicMaterial({ color: 0x003322 });
        const scr1 = new THREE.Mesh(scr1Geo, scr1Mat);
        scr1.position.set(-3.1, 0.3, 1.5);
        scr1.rotation.y = Math.PI / 2;
        scr1.name = 'screen1';
        scene.add(scr1);
        this.screen1Mesh = scr1;
        this.screen1Material = scr1Mat;

        // 屏幕 1 边框
        const scr1FrameGeo = new THREE.BoxGeometry(2.2, 1.4, 0.05);
        const scr1Frame = new THREE.Mesh(scr1FrameGeo, darkMetal(0x334455));
        scr1Frame.position.copy(scr1.position);
        scr1Frame.rotation.y = Math.PI / 2;
        scene.add(scr1Frame);

        // 屏幕 2 — 星系选择（右墙）
        const scr2Geo = new THREE.PlaneGeometry(2.0, 1.2);
        const scr2Mat = new THREE.MeshBasicMaterial({ color: 0x332200 });
        const scr2 = new THREE.Mesh(scr2Geo, scr2Mat);
        scr2.position.set(3.1, 0.3, 1.5);
        scr2.rotation.y = -Math.PI / 2;
        scr2.name = 'screen2';
        scene.add(scr2);
        this.screen2Mesh = scr2;
        this.screen2Material = scr2Mat;

        // 屏幕 2 边框
        const scr2FrameGeo = new THREE.BoxGeometry(2.2, 1.4, 0.05);
        const scr2Frame = new THREE.Mesh(scr2FrameGeo, darkMetal(0x334455));
        scr2Frame.position.copy(scr2.position);
        scr2Frame.rotation.y = -Math.PI / 2;
        scene.add(scr2Frame);

        // 屏幕交互标记（大范围，视角看向屏幕即触发）
        const scr1MarkerGeo = new THREE.SphereGeometry(1.0, 8, 8);
        const scr1Marker = new THREE.Mesh(scr1MarkerGeo,
            new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.0 }));
        scr1Marker.position.copy(scr1.position);
        scr1Marker.position.x += 1.5;
        scr1Marker.name = 'screen1_marker';
        scene.add(scr1Marker);

        const scr2MarkerGeo = new THREE.SphereGeometry(1.0, 8, 8);
        const scr2Marker = new THREE.Mesh(scr2MarkerGeo,
            new THREE.MeshBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0.0 }));
        scr2Marker.position.copy(scr2.position);
        scr2Marker.position.x -= 1.5;
        scr2Marker.name = 'screen2_marker';
        scene.add(scr2Marker);

        this.interactables.push({
            mesh: scr1Marker, type: 'screen1',
            label: '按 E 查看当前星系',
            screenNum: 1,
        });
        this.interactables.push({
            mesh: scr2Marker, type: 'screen2',
            label: '按住 E 查看星系选择',
            screenNum: 2,
        });

        // --- 左右侧窗（透明可见外面） ---
        for (let s = -1; s <= 1; s += 2) {
            const winGeo = new THREE.PlaneGeometry(2.5, 1.5);
            const winMat = new THREE.MeshPhysicalMaterial({
                color: 0x8899bb, roughness: 0.05, metalness: 0.02,
                transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false,
            });
            const win = new THREE.Mesh(winGeo, winMat);
            win.position.set(s * 3.15, 0.5, 0);
            win.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
            win.name = 'side_window';
            scene.add(win);

            // 窗框
            const frameGeo = new THREE.BoxGeometry(0.08, 1.7, 2.7);
            const frame = new THREE.Mesh(frameGeo, darkMetal(0x445566));
            frame.position.set(s * 3.1, 0.5, 0);
            scene.add(frame);
        }

        // 房间中部：无遮挡柱子，保持开阔视野观看屏幕
    }

    // ------ 尾部生活区（z: -10 ~ -3） ------
    _buildTail(scene) {
        // 休眠舱（前移，远离尾部墙壁）
        const podGeo = new THREE.CylinderGeometry(0.5, 0.5, 2.0, 16, 1, true, 0, Math.PI * 1.5);
        const pod = new THREE.Mesh(podGeo, new THREE.MeshStandardMaterial({
            color: 0x223344, roughness: 0.3, metalness: 0.7, side: THREE.DoubleSide,
        }));
        pod.rotation.x = Math.PI / 2;
        pod.position.set(0, -0.4, -5.5);
        scene.add(pod);

        // 休眠舱内部发光
        const podInnerGeo = new THREE.CylinderGeometry(0.45, 0.45, 1.9, 16);
        const podInner = new THREE.Mesh(podInnerGeo,
            new THREE.MeshBasicMaterial({ color: 0x112233, transparent: true, opacity: 0.5 }));
        podInner.rotation.x = Math.PI / 2;
        podInner.position.copy(pod.position);
        scene.add(podInner);

        // 休眠舱基座
        const podBaseGeo = new THREE.BoxGeometry(1.2, 0.15, 2.2);
        const podBase = new THREE.Mesh(podBaseGeo, darkMetal(0x3a4a5a));
        podBase.position.set(0, -1.6, -5.5);
        scene.add(podBase);

        // 置物柜
        const lockerGeo = new THREE.BoxGeometry(0.8, 1.5, 0.4);
        const locker = new THREE.Mesh(lockerGeo, darkMetal(0x3a4a5a));
        locker.position.set(2.2, -0.7, -5.5);
        scene.add(locker);

        // 尾部屏幕（信息面板）
        const infoGeo = new THREE.PlaneGeometry(0.6, 0.4);
        const infoMat = new THREE.MeshBasicMaterial({ color: 0x004466 });
        const infoScreen = new THREE.Mesh(infoGeo, infoMat);
        infoScreen.position.set(0, -0.5, -9.9);
        scene.add(infoScreen);

        // 玩家出生点（休眠舱旁边）
        this.spawnPos.set(0, -0.8, -4.5);
        this.spawnDir.set(0, 0, 1);
    }

    // ------ 碰撞辅助：墙壁段 ------
    _addWallColliders() {
        const W = 3.2, H = 2.2, L = 10, T = 0.3;
        // 左墙
        this.collisionBounds.push({ min: new THREE.Vector3(-W - T, -H, -L), max: new THREE.Vector3(-W + T, H, L) });
        // 右墙
        this.collisionBounds.push({ min: new THREE.Vector3(W - T, -H, -L), max: new THREE.Vector3(W + T, H, L) });
        // 地板
        this.collisionBounds.push({ min: new THREE.Vector3(-W, -H - T, -L), max: new THREE.Vector3(W, -H + T, L) });
        // 天花板
        this.collisionBounds.push({ min: new THREE.Vector3(-W, H - T, -L), max: new THREE.Vector3(W, H + T, L) });
        // 前墙（驾驶舱隔断，z = L - 5 = 5）留门洞
        this.collisionBounds.push({ min: new THREE.Vector3(-W, -H, 4.8 - T), max: new THREE.Vector3(-0.8, H, 5.2 + T) });
        this.collisionBounds.push({ min: new THREE.Vector3(0.8, -H, 4.8 - T), max: new THREE.Vector3(W, H, 5.2 + T) });
        // 后墙（尾部隔断，z = -3）留门洞
        this.collisionBounds.push({ min: new THREE.Vector3(-W, -H, -3.2 - T), max: new THREE.Vector3(-0.8, H, -2.8 + T) });
        this.collisionBounds.push({ min: new THREE.Vector3(0.8, -H, -3.2 - T), max: new THREE.Vector3(W, H, -2.8 + T) });
        // 后部墙（z = -L = -10）
        this.collisionBounds.push({ min: new THREE.Vector3(-W, -H, -L - T), max: new THREE.Vector3(W, H, -L + T) });
        // 前部墙（z = L = 10，驾驶舱末端）
        this.collisionBounds.push({ min: new THREE.Vector3(-W, -H, 9.5 - T), max: new THREE.Vector3(W, H, 10 + T) });
    }

    // ==================== 公共访问器 ====================
    getExteriorGroup() { return this.exteriorGroup; }
    getInteriorScene() { return this.interiorScene; }
    getInteractables() { return this.interactables; }
    getCollisionBounds() { return this.collisionBounds; }
    getSpawnPoint() { return { position: this.spawnPos.clone(), direction: this.spawnDir.clone() }; }
    getCockpitSeat() { return { position: this.cockpitSeatPos.clone(), direction: this.cockpitSeatDir.clone() }; }
}
