// ============================================================
// ShipModel.js — 飞船舱室几何（移植自 飞船.html）
// 椭圆舱室 + 中央下凹地板 + 墙脚门槛 + 球形天花板（与穹顶平滑粘连）+ 圆形底座 + 单个控制台
// 作为 THREE.Group 返回，由 ShipModule 加入主场景
// ============================================================
import * as THREE from 'three';

// 飞船相对星体系统的整体缩放。舱内相机眼高、移动边界、地板高度均应同步应用，
// 这样舱内观感与缩放前一致，而星球相对飞船在视觉上会大很多（巨物感）。
export const SHIP_SCALE = 0.15;

export class ShipModel {
    constructor() {
        this.ROOM = { rx: 7.5, rz: 6.5, h: 4.0 };
        this.group = new THREE.Group();
        this._build();
    }

    _build() {
        const g = this.group, R = this.ROOM;

        // 材质
        const matWall = new THREE.MeshStandardMaterial({ color: 0xe8eef4, roughness: 0.35, metalness: 0.25 });
        const matFloor = new THREE.MeshStandardMaterial({ color: 0xd4dde6, roughness: 0.25, metalness: 0.4, side: THREE.DoubleSide });
        const matAccent = new THREE.MeshStandardMaterial({ color: 0xc0d4e0, roughness: 0.2, metalness: 0.7 });

        const ring = (i, o, color, op=1, y=0.02) => { const m = new THREE.Mesh(new THREE.RingGeometry(i,o,96), new THREE.MeshBasicMaterial({color,transparent:true,opacity:op,side:THREE.DoubleSide})); m.rotation.x=-Math.PI/2; m.position.y=y; return m; };

        // 地板：从中间那圈线（dipRadius）向内缓缓下凹，形成平滑的浅斜坡；
        // 墙脚再起一圈“门槛”（类比古代门槛），内侧坡面更陡，同样平滑过渡。
        const DIP_RADIUS = 3.5;
        const DIP_DEPTH = 0.35;
        const SILL_START = 6.8;
        const SILL_END = R.rx * 0.98;   // 与墙脚对齐（7.35）
        const SILL_HEIGHT = 0.3;        // 位于地板(0)与下方蓝线(0.6)之间
        const smoothstep = (t) => { const k = Math.min(Math.max(t, 0), 1); return k * k * (3 - 2 * k); };
        const floorY = (r) => -DIP_DEPTH * (1 - smoothstep(r / DIP_RADIUS))
                            + SILL_HEIGHT * smoothstep((r - SILL_START) / (SILL_END - SILL_START));
        this._floorY = floorY;

        const floorPts = [];
        const FLOOR_SEG = 128;
        for (let i = 0; i <= FLOOR_SEG; i++) {
            const r = (i / FLOOR_SEG) * R.rx;
            floorPts.push(new THREE.Vector2(Math.max(r, 0.001), floorY(r)));
        }
        const floor = new THREE.Mesh(new THREE.LatheGeometry(floorPts, 128), matFloor);
        floor.scale.set(1, 1, R.rz / R.rx);
        g.add(floor);

        g.add(ring(1.6,1.65,0x00d4ff,0.7, floorY(1.62)+0.02));
        g.add(ring(2.2,2.22,0x4fb8e0,0.4, floorY(2.21)+0.02));
        g.add(ring(3.5,3.52,0x4fb8e0,0.3));
        g.add(ring(5.0,5.04,0x00d4ff,0.5));

        const arc = new THREE.Mesh(new THREE.RingGeometry(0.5,0.55,64,1,0,Math.PI*1.4), new THREE.MeshBasicMaterial({color:0x00d4ff,transparent:true,opacity:0.8}));
        arc.rotation.x=-Math.PI/2; arc.position.y=floorY(0.525)+0.01; this._floorArc=arc; g.add(arc);

        // 墙体 + 球形天花板：用一条连续的 Catmull-Rom 样条生成，
        // 中段先在 y≈2.8 收腰，再平滑外扩成罩住飞船顶部的球形穹顶；
        // 穹顶尺寸对应全息投影最大体积（外壳半径 2.5 × 最大缩放 3 = 7.5）。
        // 单条样条保证了墙体与天花板之间没有折痕（平滑粘连）。
        const shellProfile = [
            new THREE.Vector3(R.rx*0.98, SILL_HEIGHT, 0),  // 墙脚
            new THREE.Vector3(R.rx*1.00, 0.4,          0),
            new THREE.Vector3(R.rx*0.96, 1.2,          0),
            new THREE.Vector3(R.rx*0.90, 2.1,          0),
            new THREE.Vector3(R.rx*0.89, 2.8,          0),  // 收腰（墙体/天花板分界）
            new THREE.Vector3(R.rx*0.94, 3.35,         0),
            new THREE.Vector3(R.rx*1.00, 3.85,         0),
            new THREE.Vector3(R.rx*1.024, 4.5,         0),  // 以下为球形天花板
            new THREE.Vector3(R.rx*1.007, 5.5,         0),
            new THREE.Vector3(R.rx*0.947, 6.6,         0),
            new THREE.Vector3(R.rx*0.84, 7.7,          0),
            new THREE.Vector3(R.rx*0.667, 8.7,         0),
            new THREE.Vector3(R.rx*0.427, 9.4,         0),
            new THREE.Vector3(R.rx*0.16, 9.65,         0),
            new THREE.Vector3(0.001, 9.7,              0),
        ];
        const shellCurve = new THREE.CatmullRomCurve3(shellProfile, false, 'catmullrom', 0.5);
        const shellSamples = shellCurve.getPoints(180);
        let shellSplit = 0;
        for (let i = 0; i < shellSamples.length; i++) {
            if (shellSamples[i].y > 2.8) break;
            shellSplit = i;
        }
        const toProfile2D = (pts) => pts.map(p => new THREE.Vector2(Math.max(p.x, 0.001), p.y));

        const wall = new THREE.Mesh(new THREE.LatheGeometry(toProfile2D(shellSamples.slice(0, shellSplit + 1)), 96), matWall);
        wall.scale.set(1,1,R.rz/R.rx); g.add(wall);

        // 天花板用双面材质，保证从舱内任何角度都能看到穹顶内表面
        const matCeil = new THREE.MeshStandardMaterial({ color: 0xe8eef4, roughness: 0.35, metalness: 0.25, side: THREE.DoubleSide });

        // 天花板加厚：再生成一层沿内法线偏移的内表面，
        // 剖面按「外表面（腰线→顶点）→ 内表面（顶点→腰线）→ 底面封口」闭合，
        // 使穹顶边缘不再是纸片，内外都能看到真实的壳体厚度。
        const CEIL_THICKNESS = 0.22;
        const ceilOuter = shellSamples.slice(shellSplit);
        const ceilOuter2D = toProfile2D(ceilOuter);
        const ceilInner2D = ceilOuter.map((p, i) => {
            const a = ceilOuter[Math.max(0, i - 1)];
            const b = ceilOuter[Math.min(ceilOuter.length - 1, i + 1)];
            const tx = b.x - a.x, ty = b.y - a.y;
            const len = Math.hypot(tx, ty) || 1;
            // 内法线 (-ty, tx) 指向舱内
            const nx = -ty / len, ny = tx / len;
            return new THREE.Vector2(
                Math.max(p.x + nx * CEIL_THICKNESS, 0.001),
                p.y + ny * CEIL_THICKNESS
            );
        });
        const ceilingProfile2D = ceilOuter2D.concat(ceilInner2D.reverse());
        ceilingProfile2D.push(ceilOuter2D[0].clone());   // 腰线处封口，形成可见的壳体边缘
        const ceiling = new THREE.Mesh(new THREE.LatheGeometry(ceilingProfile2D, 96), matCeil);
        ceiling.scale.set(1,1,R.rz/R.rx); g.add(ceiling);

        const wr = (h,s,col,op) => { const p=[]; for(let i=0;i<=64;i++){const a=i/64*Math.PI*2;p.push(new THREE.Vector3(Math.cos(a)*R.rx*s,h,Math.sin(a)*R.rz*s));} g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(p,true),96,0.025,8,true),new THREE.MeshStandardMaterial({color:col,emissive:col,emissiveIntensity:1.2,transparent:true,opacity:op}))); };
        wr(0.6,0.97,0x4fb8e0,0.8);

        // 穹顶中央的圆形灯泡（发光 + 点光源），挂在天花板内表面下方
        const BULB_Y = shellSamples[shellSamples.length - 1].y - CEIL_THICKNESS - 0.02;
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        bulb.position.y = BULB_Y;
        g.add(bulb);
        const bulbGlow = new THREE.Mesh(
            new THREE.SphereGeometry(0.72, 24, 16),
            new THREE.MeshBasicMaterial({ color: 0xeaf6ff, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false })
        );
        bulbGlow.position.y = BULB_Y;
        g.add(bulbGlow);
        // 点光源的强度/作用距离工作在世界坐标：舱室缩放后按 s^decay 补偿，
        // 保证舱内亮度与缩放前一致
        const bulbLight = new THREE.PointLight(0xeaf6ff, 2.2 * Math.pow(SHIP_SCALE, 1.1), 0, 1.1);
        bulbLight.position.y = BULB_Y - 0.2;
        g.add(bulbLight);

        // 底座（正圆形，随中央下凹的地板整体下沉，保持贴合）
        const bg = new THREE.Group();
        bg.position.y = -DIP_DEPTH;
        const bs = new THREE.Shape(); bs.absellipse(0,0,1.2,1.2,0,Math.PI*2,false,0);
        const base = new THREE.Mesh(new THREE.ExtrudeGeometry(bs,{depth:0.2,bevelEnabled:true,bevelThickness:0.1,bevelSize:0.1,bevelSegments:6,curveSegments:48}),matAccent);
        base.rotation.x=-Math.PI/2; base.position.y=0.1; bg.add(base);
        g.add(bg);

        // 控制台（只保留一个，位于初始视角左前方）
        g.add(this._console(Math.PI*3/4));

        this._topNodes = new THREE.Group();
        for(let i=0;i<6;i++){const a=i/6*Math.PI*2,n=new THREE.Mesh(new THREE.OctahedronGeometry(0.12,0),new THREE.MeshStandardMaterial({color:0xc0d4e0,emissive:0x00d4ff,emissiveIntensity:0.5,metalness:0.8,roughness:0.2})); n.position.set(Math.cos(a)*2.5,3.7,Math.sin(a)*2.2);n.userData={baseY:3.7,i};this._topNodes.add(n);}
        g.add(this._topNodes);

        for(let i=0;i<12;i++){const a=i/12*Math.PI*2,p=[];for(let j=0;j<=20;j++){const t=j/20,r=2+t*4.5;p.push(new THREE.Vector3(Math.cos(a+t*0.3)*r,floorY(r)+0.03,Math.sin(a+t*0.3)*r*(R.rz/R.rx)));} g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(p),30,0.008,4,false),new THREE.MeshBasicMaterial({color:0x4fb8e0,transparent:true,opacity:0.3})));}

        // 灯光
        g.add(new THREE.AmbientLight(0xb8d4e8,0.55));
        g.add(new THREE.HemisphereLight(0xffffff,0x4a6580,0.6));
        const tl=new THREE.PointLight(0xeaf6ff,0.7 * Math.pow(SHIP_SCALE, 1.5), 15 * SHIP_SCALE, 1.5); tl.position.set(0,3.8,0); g.add(tl);
    }

    _console(a) {
        const R=this.ROOM,g=new THREE.Group();
        const s=new THREE.Shape(); s.absellipse(0,0,0.8,0.4,0,Math.PI,false,0);
        const conBody = new THREE.Mesh(new THREE.ExtrudeGeometry(s,{depth:0.8,bevelEnabled:true,bevelThickness:0.05,bevelSize:0.05,bevelSegments:4,curveSegments:32}),new THREE.MeshStandardMaterial({color:0xc0d4e0,roughness:0.2,metalness:0.7}));
        conBody.rotation.x = -Math.PI / 2; g.add(conBody);
        const sc=new THREE.Mesh(new THREE.PlaneGeometry(1.2,0.5),new THREE.MeshBasicMaterial({color:0x002a3a,transparent:true,opacity:0.8}));sc.rotation.x=-Math.PI/2+0.3;sc.position.set(0,0.05,0);g.add(sc);
        const fr=new THREE.Mesh(new THREE.PlaneGeometry(1.25,0.55),new THREE.MeshBasicMaterial({color:0x00d4ff,transparent:true,opacity:0.6}));fr.rotation.x=-Math.PI/2+0.3;fr.position.set(0,0.04,0);g.add(fr);
        for(let i=0;i<5;i++){const b=new THREE.Mesh(new THREE.SphereGeometry(0.04,8,8),new THREE.MeshBasicMaterial({color:i%2===0?0x00d4ff:0xff9c4f}));b.position.set(-0.4+i*0.2,0.06,0.3);g.add(b);}
        g.position.set(Math.cos(a)*R.rx*0.85,0.5,Math.sin(a)*R.rz*0.85);g.lookAt(0,0.5,0);
        return g;
    }

    updateDecor(time, dt) {
        if(this._floorArc) this._floorArc.rotation.z+=dt*0.2;
        if(this._topNodes) this._topNodes.children.forEach((n,i)=>{n.position.y=n.userData.baseY+Math.sin(time*1.5+i)*0.1;n.rotation.y+=dt*0.5;n.rotation.x+=dt*0.3;});
    }

    /** 给定舱室本地坐标，返回地板高度（中央下凹为负，墙脚门槛为正） */
    getFloorHeight(x, z) {
        if (!this._floorY) return 0;
        const R = this.ROOM;
        const rc = Math.sqrt(x * x + (z * R.rx / R.rz) ** 2);
        return this._floorY(rc);
    }

    getShipGroup() { return this.group; }
    getRoom() { return this.ROOM; }
}
