import * as THREE from 'three';
import { createParticleMaterial } from '../rendering/Materials';

export interface SpawnOpts {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number;
  s0: number; s1: number;
  c0: [number, number, number];
  c1: [number, number, number];
  gravity?: number;
  drag?: number;
}

/**
 * 立方体ボクセルのパーティクルプール。1つのInstancedMesh = 1ドローコール。
 * 生存粒子を配列先頭に詰める（swap-remove）ので、生成/破棄でアロケーションが発生しない。
 */
export class VoxelParticles {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  private px: Float32Array; private py: Float32Array; private pz: Float32Array;
  private vx: Float32Array; private vy: Float32Array; private vz: Float32Array;
  private age: Float32Array; private life: Float32Array;
  private s0: Float32Array; private s1: Float32Array;
  private c0: Float32Array; private c1: Float32Array;
  private grav: Float32Array; private drag: Float32Array;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private sc = new THREE.Vector3();
  private pp = new THREE.Vector3();

  constructor(readonly capacity: number, transparent = false, opacity = 1) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    this.mesh = new THREE.InstancedMesh(geo, createParticleMaterial(opacity, transparent), capacity);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    if (transparent) this.mesh.renderOrder = 3;
    const f = () => new Float32Array(capacity);
    this.px = f(); this.py = f(); this.pz = f();
    this.vx = f(); this.vy = f(); this.vz = f();
    this.age = f(); this.life = f();
    this.s0 = f(); this.s1 = f();
    this.grav = f(); this.drag = f();
    this.c0 = new Float32Array(capacity * 3);
    this.c1 = new Float32Array(capacity * 3);
  }

  get count(): number {
    return this.n;
  }

  spawn(o: SpawnOpts): void {
    let i = this.n;
    if (i >= this.capacity) i = Math.floor(Math.random() * this.capacity); // 満杯時は上書き
    else this.n++;
    this.px[i] = o.x; this.py[i] = o.y; this.pz[i] = o.z;
    this.vx[i] = o.vx; this.vy[i] = o.vy; this.vz[i] = o.vz;
    this.age[i] = 0; this.life[i] = o.life;
    this.s0[i] = o.s0; this.s1[i] = o.s1;
    this.grav[i] = o.gravity ?? 0;
    this.drag[i] = o.drag ?? 0;
    this.c0.set(o.c0, i * 3);
    this.c1.set(o.c1, i * 3);
  }

  clear(): void {
    this.n = 0;
    this.mesh.count = 0;
  }

  update(dt: number): void {
    const col = this.mesh.instanceColor!.array as Float32Array;
    for (let i = 0; i < this.n; ) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        const l = --this.n;
        if (i !== l) {
          this.px[i] = this.px[l]; this.py[i] = this.py[l]; this.pz[i] = this.pz[l];
          this.vx[i] = this.vx[l]; this.vy[i] = this.vy[l]; this.vz[i] = this.vz[l];
          this.age[i] = this.age[l]; this.life[i] = this.life[l];
          this.s0[i] = this.s0[l]; this.s1[i] = this.s1[l];
          this.grav[i] = this.grav[l]; this.drag[i] = this.drag[l];
          for (let k = 0; k < 3; k++) {
            this.c0[i * 3 + k] = this.c0[l * 3 + k];
            this.c1[i * 3 + k] = this.c1[l * 3 + k];
          }
        }
        continue;
      }
      const d = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= d; this.vy[i] = this.vy[i] * d - this.grav[i] * dt; this.vz[i] *= d;
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
      const t = this.age[i] / this.life[i];
      const s = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      this.pp.set(this.px[i], this.py[i], this.pz[i]);
      this.sc.set(s, s, s);
      this.m.compose(this.pp, this.q, this.sc);
      this.mesh.setMatrixAt(i, this.m);
      for (let k = 0; k < 3; k++) col[i * 3 + k] = this.c0[i * 3 + k] + (this.c1[i * 3 + k] - this.c0[i * 3 + k]) * t;
      i++;
    }
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
  }
}

/** 炎・煙・破片で共有するパーティクル群 */
export class FxHub {
  readonly solid = new VoxelParticles(3500);
  readonly smoke = new VoxelParticles(1200, true, 0.34);
  readonly group = new THREE.Group();
  constructor() {
    this.group.add(this.solid.mesh, this.smoke.mesh);
  }
  update(dt: number): void {
    this.solid.update(dt);
    this.smoke.update(dt);
  }
  clear(): void {
    this.solid.clear();
    this.smoke.clear();
  }
}

export const rgb = (h: number): [number, number, number] => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
