import * as THREE from 'three';
import { FOG_FN, shared } from '../rendering/Materials';

const MAX = 260;

/** 翼端の位置履歴から描く白い飛行軌跡。時間とともに透明になる。 */
class Trail {
  readonly line: THREE.Line;
  private pos = new Float32Array(MAX * 3);
  private alpha = new Float32Array(MAX);
  private hist: { x: number; y: number; z: number; t: number }[] = [];
  private geo = new THREE.BufferGeometry();
  private lastT = -1;

  constructor(private life: number) {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uFogColor: shared.uFogColor, uFogNear: shared.uFogNear, uFogFar: shared.uFogFar },
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `attribute float aAlpha; varying float vA; varying vec3 vW;
        void main(){ vA = aAlpha; vec4 wp = modelMatrix * vec4(position,1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: /* glsl */ `varying float vA; varying vec3 vW; ${FOG_FN}
        void main(){ vec3 c = applyFog(vec3(1.0), vW); gl_FragColor = vec4(c, vA); }`,
    });
    this.line = new THREE.Line(this.geo, mat);
    this.line.frustumCulled = false;
    this.line.renderOrder = 4;
    this.geo.setDrawRange(0, 0);
  }

  reset(): void {
    this.hist.length = 0;
    this.geo.setDrawRange(0, 0);
    this.lastT = -1;
  }

  update(now: number, p: THREE.Vector3, emit: boolean): void {
    if (emit && now - this.lastT >= 1 / 60) {
      this.lastT = now;
      this.hist.push({ x: p.x, y: p.y, z: p.z, t: now });
      if (this.hist.length > MAX) this.hist.shift();
    }
    while (this.hist.length && now - this.hist[0].t > this.life) this.hist.shift();
    const n = this.hist.length;
    for (let i = 0; i < n; i++) {
      const h = this.hist[n - 1 - i]; // 新しい順
      this.pos[i * 3] = h.x; this.pos[i * 3 + 1] = h.y; this.pos[i * 3 + 2] = h.z;
      const a = 1 - (now - h.t) / this.life;
      this.alpha[i] = Math.min(1, a * 1.6) * 0.95;
    }
    this.geo.setDrawRange(0, n);
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
  }
}

export class Contrails {
  readonly group = new THREE.Group();
  private trails: Trail[];
  private tmp = new THREE.Vector3();
  private clock = 0;

  constructor(private tips: THREE.Vector3[], life = 3.4) {
    this.trails = tips.map(() => new Trail(life));
    for (const t of this.trails) this.group.add(t.line);
  }

  reset(): void {
    this.trails.forEach((t) => t.reset());
  }

  update(dt: number, root: THREE.Object3D, emit = true): void {
    this.clock += dt;
    for (let i = 0; i < this.trails.length; i++) {
      this.tmp.copy(this.tips[i]).applyMatrix4(root.matrixWorld);
      this.trails[i].update(this.clock, this.tmp, emit);
    }
  }
}
