import * as THREE from 'three';
import { config } from '../config';
import { FOG_FN, shared } from '../rendering/Materials';

export const MAX_SHADOWS = 48;

const SEG = 256; // スナップ単位

/**
 * 海面: 巨大な水平面をShaderMaterialで描画。ピクセル状の波模様・白い反射・雲の影を持つ。
 * 浅瀬は地形メッシュ(海底セル)が水面越しに透けて見える方式。その下に深海面を敷く。
 */
export class Ocean {
  readonly group = new THREE.Group();
  private water: THREE.Mesh;
  private floor: THREE.Mesh;
  private uniforms: Record<string, THREE.IUniform>;

  constructor() {
    const shadows = Array.from({ length: MAX_SHADOWS }, () => new THREE.Vector4(0, 0, 0, 0));
    this.uniforms = {
      uSun: shared.uSun,
      uFogColor: shared.uFogColor,
      uFogNear: shared.uFogNear,
      uFogFar: shared.uFogFar,
      uTime: shared.uTime,
      uShadows: { value: shadows },
      uShadowN: { value: 0 },
    };
    const R = config.world.fogFar * 1.35;
    const wg = new THREE.PlaneGeometry(R * 2, R * 2, 1, 1);
    wg.rotateX(-Math.PI / 2);
    const wm = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec3 vW;
        void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec4 uShadows[${MAX_SHADOWS}]; uniform int uShadowN;
        varying vec3 vW;
        ${FOG_FN}
        float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        float vn(vec2 p){
          vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y);
        }
        void main(){
          vec2 p = vW.xz;
          float t = uTime;
          float dist = length(vW - cameraPosition);
          // ゆっくり流れる色むら（段階量子化 → ピクセルアート的な色の島）
          float n = vn(p * 0.0085 + vec2(t * 0.05, t * 0.03)) * 0.55 + vn(p * 0.027 - vec2(t * 0.07, -t * 0.02)) * 0.45;
          n = floor(n * 4.0) / 4.0;
          vec3 c0 = vec3(0.045, 0.20, 0.55);
          vec3 c1 = vec3(0.060, 0.28, 0.66);
          vec3 c2 = vec3(0.075, 0.37, 0.76);
          vec3 c3 = vec3(0.10, 0.50, 0.82);
          vec3 col = n < 0.25 ? c0 : (n < 0.5 ? c1 : (n < 0.75 ? c2 : c3));
          // エメラルドの差し色
          float em = vn(p * 0.004 + 31.0);
          if (em > 0.74) col = mix(col, vec3(0.05, 0.55, 0.62), 0.5);
          // 雲の影（濃い紺）
          float sh = 0.0;
          for (int i = 0; i < ${MAX_SHADOWS}; i++) {
            if (i >= uShadowN) break;
            vec4 s = uShadows[i];
            vec2 d = p - s.xy;
            float r = s.z * (1.0 + (vn(p * 0.09 + float(i)) - 0.5) * 0.45);
            if (dot(d, d) < r * r) sh = 1.0;
          }
          col = mix(col, vec3(0.02, 0.11, 0.38), sh * 0.82);
          // 白いピクセル状の波頭・反射（時間で明滅し、流れる）
          vec2 g = p / vec2(1.7, 0.85);
          vec2 cell = floor(g);
          float slice = floor(t * 1.1 + h21(cell) * 9.0);
          float r = h21(cell + slice * 13.7);
          vec2 f = fract(g);
          float spark = step(0.962, r) * step(f.y, 0.5) * step(f.x, 0.85);
          float fade = 1.0 - smoothstep(450.0, 1500.0, dist);
          spark *= fade;
          // もう少し大きな泡のすじ
          vec2 g2 = p / vec2(5.2, 1.6);
          vec2 c2c = floor(g2);
          float r2 = h21(c2c + floor(t * 0.6 + h21(c2c) * 5.0) * 7.1);
          vec2 f2 = fract(g2);
          float streak = step(0.985, r2) * step(f2.y, 0.45) * step(0.1, f2.x) * step(f2.x, 0.9) * fade;
          col = mix(col, vec3(0.80, 0.93, 1.0), clamp(spark + streak, 0.0, 1.0));
          float alpha = mix(0.66, 1.0, clamp(spark + streak, 0.0, 1.0));
          col = applyFog(col, vW);
          gl_FragColor = vec4(col, alpha);
        }`,
    });
    this.water = new THREE.Mesh(wg, wm);
    this.water.renderOrder = 1;
    this.water.frustumCulled = false;

    const fg = new THREE.PlaneGeometry(R * 2, R * 2, 1, 1);
    fg.rotateX(-Math.PI / 2);
    const n = 4;
    const arr: number[] = [];
    for (let i = 0; i < n; i++) arr.push(0.04, 0.2, 0.52);
    fg.setAttribute('aColor', new THREE.Float32BufferAttribute(Array.from({ length: n * 3 }, (_, i) => [0.04, 0.2, 0.54][i % 3]), 3));
    const fm = new THREE.ShaderMaterial({
      uniforms: { uFogColor: shared.uFogColor, uFogNear: shared.uFogNear, uFogFar: shared.uFogFar },
      vertexShader: /* glsl */ `
        attribute vec3 aColor; varying vec3 vC; varying vec3 vW;
        void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vW = wp.xyz; vC = aColor; gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: /* glsl */ `
        varying vec3 vC; varying vec3 vW; ${FOG_FN}
        void main(){ gl_FragColor = vec4(applyFog(vC, vW), 1.0); }`,
    });
    this.floor = new THREE.Mesh(fg, fm);
    this.floor.position.y = config.world.seaFloorY;
    this.floor.frustumCulled = false;
    this.floor.renderOrder = -1;
    this.group.add(this.floor, this.water);
  }

  update(dt: number, cam: THREE.Vector3, shadows: THREE.Vector4[]): void {
    shared.uTime.value += dt;
    const sx = Math.round(cam.x / SEG) * SEG;
    const sz = Math.round(cam.z / SEG) * SEG;
    this.water.position.set(sx, 0, sz);
    this.floor.position.set(sx, config.world.seaFloorY, sz);
    const arr = this.uniforms.uShadows.value as THREE.Vector4[];
    const n = Math.min(shadows.length, MAX_SHADOWS);
    for (let i = 0; i < n; i++) arr[i].copy(shadows[i]);
    this.uniforms.uShadowN.value = n;
  }
}
