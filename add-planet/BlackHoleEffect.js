// ============================================================
// BlackHoleEffect.js — 黑洞着色器效果（移植自 test.html）
// 使用 WebGL2 全屏四边形渲染 raymarching 黑洞
// ============================================================

const BH_FRAG = `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform float uTime;
uniform vec4 uMouse;
out vec4 fragColor;

#define AA 1
#define _Speed 3.0
#define _Steps 12.
#define _Size 0.3

float hash(float x){ return fract(sin(x)*152754.742); }
float hash(vec2 x){ return hash(x.x + hash(x.y)); }
float value(vec2 p, float f) {
    float bl=hash(floor(p*f+vec2(0.,0.))); float br=hash(floor(p*f+vec2(1.,0.)));
    float tl=hash(floor(p*f+vec2(0.,1.))); float tr=hash(floor(p*f+vec2(1.,1.)));
    vec2 fr=fract(p*f); fr=(3.-2.*fr)*fr*fr;
    return mix(mix(bl,br,fr.x),mix(tl,tr,fr.x),fr.y);
}
vec4 background(vec3 ray) {
    vec2 uv=ray.xy; if(abs(ray.x)>0.5)uv.x=ray.z; else if(abs(ray.y)>0.5)uv.y=ray.z;
    float b=value(uv*3.,100.),c=value(uv*2.,20.); b=pow(b,256.); b=clamp(b*100.,0.,1.);
    vec3 s=b*mix(vec3(1.,.6,.2),vec3(.2,.6,1),c); return vec4(s,1.);
}
vec4 raymarchDisk(vec3 ray, vec3 zeroPos) {
    vec3 pos=zeroPos; float lp=length(pos.xz); float d=min(1.,lp*(1./_Size)*0.5)*_Size*0.4*(1./_Steps)/abs(ray.y);
    pos+=d*_Steps*ray*0.5;
    vec2 dp; dp.x=-zeroPos.z*0.01+zeroPos.x; dp.y=zeroPos.x*0.01+zeroPos.z; dp=normalize(dp-zeroPos.xz);
    float pl=dot(ray.xz,dp); pl/=sqrt(lp); pl*=0.5; float rs=pl+0.3; rs*=rs; rs=clamp(rs,0.,1.);
    float dm=clamp((lp-_Size*2.)*(1./_Size)*0.24,0.,1.);
    vec3 ic=mix(vec3(1.,0.8,0.),vec3(0.5,0.13,0.02)*0.2,dm); ic*=mix(vec3(0.4,0.2,0.1),vec3(1.6,2.4,4.),rs); ic*=1.25; rs+=0.12; rs*=rs;
    vec4 o=vec4(0.);
    for(float i=0.;i<_Steps;i++){ pos-=d*ray; float it=clamp(1.-abs((i-0.8)*(1./_Steps)*2.),0.,1.);
        lp=length(pos.xz); float m=1.; m*=clamp((lp-_Size*0.75)*(1./_Size)*1.5,0.,1.); m*=clamp((_Size*10.-lp)*(1./_Size)*0.20,0.,1.); m*=m;
        float u=lp+uTime*_Size*0.3+it*_Size*0.2; vec2 xy; float rt=mod(uTime*_Speed,8192.); xy.x=-pos.z*sin(rt)+pos.x*cos(rt); xy.y=pos.x*sin(rt)+pos.z*cos(rt);
        float x=abs(xy.x/xy.y); float ang=0.02*atan(x); const float f=70.;
        float n=value(vec2(ang,u*(1./_Size)*0.05),f); n=n*0.66+0.33*value(vec2(ang,u*(1./_Size)*0.05),f*2.);
        float ew=n*1.*(1.-clamp(i*(1./_Steps)*2.-1.,0.,1.)); float al=clamp(n*(it+ew)*((1./_Size)*10.+0.01)*d*m,0.,1.);
        vec3 col=2.*mix(vec3(0.3,0.2,0.15)*ic,ic,min(1.,it*2.));
        o=clamp(vec4(col*al+o.rgb*(1.-al),o.a*(1.-al)+al),vec4(0.),vec4(1.));
        lp*=(1./_Size); o.rgb+=rs*(it*1.+0.5)*(1./_Steps)*100.*m/(lp*lp);
    } o.rgb=clamp(o.rgb-0.005,0.,1.); return o;
}
void mainImage(out vec4 c, vec2 fc){
    c=vec4(0.);
    vec2 fc2; fc2.x=fc.x*0.985+fc.y*0.174; fc2.y=fc.y*0.985-fc.x*0.174; fc2+=vec2(-0.06,0.12)*uResolution;
    for(int j=0;j<AA;j++) for(int i=0;i<AA;i++){
        vec3 r=normalize(vec3((fc2-uResolution*.5+vec2(i,j)/float(AA))/uResolution.x,1.));
        vec3 p=vec3(0.,0.05,-(20.*uMouse.xy/uResolution.y-10.)*(20.*uMouse.xy/uResolution.y-10.)*.05);
        vec2 a=vec2(uTime*0.1,.2); a.y=(2.*uMouse.y/uResolution.y)*3.14+0.1+3.14;
        float dl=length(p); Rotate(p,a); a.xy-=min(.3/dl,3.14)*vec2(1,0.5); Rotate(r,a);
        vec4 col=vec4(0.),gl=vec4(0.),oc=vec4(100.);
        for(int di=0;di<20;di++){
            vec3 rd=r; vec3 ro=p; float ld=100.,tl=0.; int bHit=0;
            for(int i=0;i<100;i++){ vec3 q=ro+rd*tl+vec3(0.,0.,0.); float dL=min(length(q),abs(length(q.xy)-_Size+0.07)); dL=min(dL,abs(length(q.xz)-_Size+0.07)); tl+=dL; if(tl>ld){tl=ld;break;} if(dL<0.001){bHit=1;break;} }
            if(bHit>0){vec3 q=ro+rd*tl; vec3 N=normalize(q); N=vec3(0,1,0); float V=dot(N,-rd); V=clamp(V,0.,1.); gl+=vec4(1.5,1.,0.8,0)*0.03*(1./float(AA));}
            c+=background(r)/float(AA)*0.5;
            c+=raymarchDisk(r,p)*0.5;
        }
        c+=gl;
    }
}
void Rotate(inout vec3 v, vec2 a){
    v.yz=cos(a.y)*v.yz+sin(a.y)*vec2(-1,1)*v.zy;
    v.xz=cos(a.x)*v.xz+sin(a.x)*vec2(-1,1)*v.zx;
}
void main(){ mainImage(fragColor,gl_FragCoord.xy); }
`;

export class BlackHoleEffect {
    constructor() {
        this.canvas = null;
        this.gl = null;
        this._animId = null;
    }

    show(duration = 3000) {
        if (this.canvas) return;
        this.canvas = document.createElement('canvas');
        this.canvas.style.cssText = 'position:fixed;inset:0;z-index:900;pointer-events:none;opacity:0;transition:opacity 0.5s;';
        document.body.appendChild(this.canvas);

        const gl = this.canvas.getContext('webgl2');
        if (!gl) { this.canvas.remove(); this.canvas = null; return; }
        this.gl = gl;

        const dpr = Math.min(window.devicePixelRatio, 2);
        this.canvas.width = window.innerWidth * dpr;
        this.canvas.height = window.innerHeight * dpr;
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);

        // 编译着色器
        const vs = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vs, `#version 300 es\nin vec2 aP;void main(){gl_Position=vec4(aP,0.,1.);}`);
        gl.compileShader(vs);

        const fs = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fs, BH_FRAG);
        gl.compileShader(fs);

        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);

        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            console.warn('[BH] Shader compile failed'); this.canvas.remove(); this.canvas = null; return;
        }

        const verts = new Float32Array([-1,-1, 1,-1, -1,1, 1,1]);
        const vao = gl.createVertexArray();
        const vbo = gl.createBuffer();
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
        const posLoc = gl.getAttribLocation(prog, 'aP');
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

        const uRes = gl.getUniformLocation(prog, 'uResolution');
        const uTime = gl.getUniformLocation(prog, 'uTime');
        const uMouse = gl.getUniformLocation(prog, 'uMouse');

        gl.useProgram(prog);
        gl.bindVertexArray(vao);

        const start = performance.now();
        this.canvas.style.opacity = '1';

        const render = (now) => {
            const t = (now - start) * 0.001;
            gl.uniform2f(uRes, this.canvas.width, this.canvas.height);
            gl.uniform1f(uTime, t);
            gl.uniform4f(uMouse, 0, 0, 0, 0);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            if (t < duration * 0.001) this._animId = requestAnimationFrame(render);
            else this.hide();
        };
        this._animId = requestAnimationFrame(render);
    }

    hide() {
        if (this._animId) { cancelAnimationFrame(this._animId); this._animId = null; }
        if (this.canvas) {
            this.canvas.style.opacity = '0';
            setTimeout(() => { this.canvas?.remove(); this.canvas = null; this.gl = null; }, 500);
        }
    }
}
