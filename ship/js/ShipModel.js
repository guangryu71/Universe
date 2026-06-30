// ============================================================
// ShipModel.js — 飞船舱室几何（移植自 飞船.html）
// 椭圆舱室+窗户+底座+控制台+墙面板+装饰
// 作为 THREE.Group 返回，由 ShipModule 加入主场景
// ============================================================
import * as THREE from 'three';

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
        const matFloor = new THREE.MeshStandardMaterial({ color: 0xd4dde6, roughness: 0.25, metalness: 0.4 });
        const matAccent = new THREE.MeshStandardMaterial({ color: 0xc0d4e0, roughness: 0.2, metalness: 0.7 });
        const matGlass = new THREE.MeshPhysicalMaterial({ color: 0xaecde0, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false });

        const ellipse = (rx, ry) => { const s = new THREE.Shape(); s.absellipse(0,0,rx,ry,0,Math.PI*2,false,0); return s; };
        const ring = (i, o, color, op=1, y=0.02) => { const m = new THREE.Mesh(new THREE.RingGeometry(i,o,96), new THREE.MeshBasicMaterial({color,transparent:true,opacity:op,side:THREE.DoubleSide})); m.rotation.x=-Math.PI/2; m.position.y=y; return m; };

        // 地板
        const floor = new THREE.Mesh(new THREE.ShapeGeometry(ellipse(R.rx,R.rz),96), matFloor);
        floor.rotation.x = -Math.PI / 2;
        g.add(floor);
        g.add(ring(1.6,1.65,0x00d4ff,0.7)); g.add(ring(2.2,2.22,0x4fb8e0,0.4));
        g.add(ring(3.5,3.52,0x4fb8e0,0.3)); g.add(ring(5.0,5.04,0x00d4ff,0.5));

        const arc = new THREE.Mesh(new THREE.RingGeometry(0.5,0.55,64,1,0,Math.PI*1.4), new THREE.MeshBasicMaterial({color:0x00d4ff,transparent:true,opacity:0.8}));
        arc.rotation.x=-Math.PI/2; arc.position.y=0.03; this._floorArc=arc; g.add(arc);

        // 墙壁
        const wp = [0.001,0,R.rx*0.98,0,R.rx*1.0,0.4,R.rx*0.96,1.2,R.rx*0.88,2.4,R.rx*0.72,3.4,R.rx*0.42,3.85,0.001,3.95];
        const pts = []; for(let i=0;i<wp.length;i+=2) pts.push(new THREE.Vector2(wp[i],wp[i+1]));
        const wall = new THREE.Mesh(new THREE.LatheGeometry(pts,96), matWall);
        wall.scale.set(1,1,R.rz/R.rx); g.add(wall);

        // 墙体发光条
        for(let i=0;i<8;i++) {
            const a=i/8*Math.PI*2, p=[];
            for(let j=0;j<=20;j++) { const t=j/20,s=1-t*t*0.3; p.push(new THREE.Vector3(Math.cos(a)*R.rx*s*0.98,t*3.8,Math.sin(a)*R.rz*s*0.98)); }
            g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(p),40,0.015,6,false), new THREE.MeshBasicMaterial({color:0x00d4ff,transparent:true,opacity:0.4})));
        }

        const wr = (h,s,col,op) => { const p=[]; for(let i=0;i<=64;i++){const a=i/64*Math.PI*2;p.push(new THREE.Vector3(Math.cos(a)*R.rx*s,h,Math.sin(a)*R.rz*s));} g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(p,true),96,0.025,8,true),new THREE.MeshStandardMaterial({color:col,emissive:col,emissiveIntensity:1.2,transparent:true,opacity:op}))); };
        wr(0.6,0.97,0x4fb8e0,0.8); wr(2.5,0.84,0x00d4ff,0.6); wr(3.6,0.5,0x4fb8e0,0.5);

        // 天花板
        const cp = [0.001,4.0,R.rx*0.42,3.95,R.rx*0.72,3.6,R.rx*0.88,2.8,R.rx*0.96,1.5,R.rx*1.0,0.2,0.001,0];
        const cp3 = []; for(let i=0;i<cp.length;i+=2) cp3.push(new THREE.Vector2(cp[i],cp[i+1]));
        const ceil = new THREE.Mesh(new THREE.LatheGeometry(cp3,96),matWall);
        ceil.scale.set(1,1,R.rz/R.rx); ceil.position.y=R.h; g.add(ceil);
        for(let i=1;i<=4;i++) wr(3.95-i*0.05,0.1+i*0.1,0x4fb8e0,0.3);

        // 窗户×4
        for(const a of [0,Math.PI/2,Math.PI,Math.PI*1.5]) g.add(this._window(a));

        // 底座
        const bg = new THREE.Group();
        const bs = new THREE.Shape(); bs.absellipse(0,0,1.2,0.9,0,Math.PI*2,false,0);
        const bh = new THREE.Path(); bh.absellipse(0,0,0.4,0.3,0,Math.PI*2,false,0);
        bs.holes.push(bh);
        const base = new THREE.Mesh(new THREE.ExtrudeGeometry(bs,{depth:0.2,bevelEnabled:true,bevelThickness:0.1,bevelSize:0.1,bevelSegments:6,curveSegments:48}),matAccent);
        base.rotation.x=-Math.PI/2; base.position.y=0.1; bg.add(base);
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.08,0.15,1.5,16),new THREE.MeshStandardMaterial({color:0x002a3a,emissive:0x00d4ff,emissiveIntensity:1.8,transparent:true,opacity:0.7}));
        pillar.position.y=0.9; bg.add(pillar);
        for(let i=0;i<3;i++){const r=0.5+i*0.2, rg=new THREE.Mesh(new THREE.TorusGeometry(r,0.015,6,48),new THREE.MeshBasicMaterial({color:0x00d4ff,transparent:true,opacity:0.5-i*0.1})); rg.rotation.x=-Math.PI/2; rg.position.y=0.05; rg.scale.set(1,1,0.75); bg.add(rg);}
        const bm = new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.4,1.5,16,1,true),new THREE.ShaderMaterial({
            uniforms:{uTime:{value:0}},vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
            fragmentShader:`varying vec2 vUv;uniform float uTime;void main(){float a=(1.0-vUv.y)*0.5;a*=0.7+0.3*sin(uTime*3.0+vUv.y*10.0);gl_FragColor=vec4(0.0,0.83,1.0,a);}`,
            transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending
        }));
        bm.position.y=0.95; this._beamMat=bm.material; bg.add(bm); g.add(bg);

        // 控制台、面板、装饰
        for(const a of [Math.PI/4,Math.PI*3/4,Math.PI*5/4,Math.PI*7/4]) g.add(this._console(a));
        for(const a of [Math.PI/4+0.2,Math.PI*3/4-0.2,Math.PI*5/4+0.2,Math.PI*7/4-0.2]) g.add(this._wallPanel(a));

        this._topNodes = new THREE.Group();
        for(let i=0;i<6;i++){const a=i/6*Math.PI*2,n=new THREE.Mesh(new THREE.OctahedronGeometry(0.12,0),new THREE.MeshStandardMaterial({color:0xc0d4e0,emissive:0x00d4ff,emissiveIntensity:0.5,metalness:0.8,roughness:0.2})); n.position.set(Math.cos(a)*2.5,3.7,Math.sin(a)*2.2);n.userData={baseY:3.7,i};this._topNodes.add(n);}
        g.add(this._topNodes);

        for(let i=0;i<12;i++){const a=i/12*Math.PI*2,p=[];for(let j=0;j<=20;j++){const t=j/20,r=2+t*4.5;p.push(new THREE.Vector3(Math.cos(a+t*0.3)*r,0.04,Math.sin(a+t*0.3)*r*(R.rz/R.rx)));} g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(p),30,0.008,4,false),new THREE.MeshBasicMaterial({color:0x4fb8e0,transparent:true,opacity:0.3})));}

        // 灯光
        g.add(new THREE.AmbientLight(0xb8d4e8,0.55));
        g.add(new THREE.HemisphereLight(0xffffff,0x4a6580,0.6));
        const tl=new THREE.PointLight(0xeaf6ff,0.7,15,1.5); tl.position.set(0,3.8,0); g.add(tl);
        this._holLight=new THREE.PointLight(0x00d4ff,1.4,8,1.5); this._holLight.position.set(0,1.2,0); g.add(this._holLight);
    }

    _window(a) {
        const R=this.ROOM,g=new THREE.Group();
        const fs=new THREE.Shape(); fs.absellipse(0,0,1.4,1.0,0,Math.PI*2,false,0);
        const h=new THREE.Path(); h.absellipse(0,0,1.2,0.8,0,Math.PI*2,false,0); fs.holes.push(h);
        const frameMesh = new THREE.Mesh(new THREE.ExtrudeGeometry(fs,{depth:0.15,bevelEnabled:true,bevelThickness:0.04,bevelSize:0.04,bevelSegments:4}),new THREE.MeshStandardMaterial({color:0xc0d4e0,roughness:0.2,metalness:0.7}));
        frameMesh.position.z = -0.05; g.add(frameMesh);
        const gl=new THREE.Mesh(new THREE.CircleGeometry(1.2,64),new THREE.MeshPhysicalMaterial({color:0xaecde0,roughness:0.05,metalness:0.1,transparent:true,opacity:0.2,side:THREE.DoubleSide,depthWrite:false}));
        gl.scale.set(1,0.8,1);gl.position.z=0.05;g.add(gl);
        [0x00d4ff,0x4fb8e0].forEach((c,i)=>{const e=new THREE.Mesh(new THREE.TorusGeometry(1.15+i*0.15,0.02-i*0.01,8-i*2,64-i*16),new THREE.MeshBasicMaterial({color:c,transparent:true,opacity:0.6-i*0.2}));e.scale.set(1,0.78,1);g.add(e);});
        g.position.set(Math.cos(a)*R.rx*0.96,1.8,Math.sin(a)*(R.rz*0.96));g.lookAt(0,1.8,0);g.rotateY(Math.PI);
        return g;
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

    _wallPanel(a) {
        const R=this.ROOM,g=new THREE.Group();
        g.add(new THREE.Mesh(new THREE.PlaneGeometry(1.8,1.2),new THREE.MeshStandardMaterial({color:0xd4dde6,roughness:0.2,metalness:0.7,emissive:0x4fb8e0,emissiveIntensity:0.05})));
        for(let i=0;i<3;i++){const l=new THREE.Mesh(new THREE.PlaneGeometry(1.6,0.02),new THREE.MeshBasicMaterial({color:0x00d4ff,transparent:true,opacity:0.6}));l.position.set(0,0.4-i*0.15,0.01);g.add(l);}
        const sc=new THREE.Mesh(new THREE.PlaneGeometry(0.5,0.3),new THREE.MeshBasicMaterial({color:0x002a3a,transparent:true,opacity:0.9}));sc.position.set(-0.55,-0.1,0.01);g.add(sc);
        g.position.set(Math.cos(a)*R.rx*0.95,2.6,Math.sin(a)*R.rz*0.95);g.lookAt(0,2.6,0);
        return g;
    }

    updateDecor(time, dt) {
        if(this._floorArc) this._floorArc.rotation.z+=dt*0.2;
        if(this._topNodes) this._topNodes.children.forEach((n,i)=>{n.position.y=n.userData.baseY+Math.sin(time*1.5+i)*0.1;n.rotation.y+=dt*0.5;n.rotation.x+=dt*0.3;});
        if(this._beamMat) this._beamMat.uniforms.uTime.value=time;
        if(this._holLight) this._holLight.intensity=1.2+Math.sin(time*1.5)*0.3;
    }

    getShipGroup() { return this.group; }
    getRoom() { return this.ROOM; }
}
