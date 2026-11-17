import * as THREE from 'three';
import { config } from '../config';
import { createParticleMaterial } from '../rendering/Materials';

export interface Target {
  pos: THREE.Vector3;
  radius: number;
  alive: boolean;
  onHit(damage: number, point: THREE.Vector3, owner: number): void;
}

const MAX = 400;

/** 弾丸プール。細長いボクセル(立方体)を1つのInstancedMeshで描画し、線分-球の連続衝突判定を行う。 */
export class Bullets {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  private p = new Float32Array(MAX * 3);
  private v = new Float32Array(MAX * 3);
  private life = new Float32Array(MAX);
  private owner = new Uint8Array(MAX); // 0=player 1=enemy
  private dmg = new Float32Array(MAX);
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();
  private d = new THREE.Vector3();
  private sc = new THREE.Vector3(1, 1, 1);
  private fwd = new THREE.Vector3(0, 0, 1);
  private pp = new THREE.Vector3();

  constructor() {
    const geo = new THREE.BoxGeometry(0.55, 0.55, 5);
    this.mesh = new THREE.InstancedMesh(geo, createParticleMaterial(1, false), MAX);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  get count(): number {
    return this.n;
  }

  clear(): void {
    this.n = 0;
    this.mesh.count = 0;
  }

  fire(pos: THREE.Vector3, dir: THREE.Vector3, baseVel: THREE.Vector3, owner: number, damage: number, speed = config.combat.bulletSpeed): void {
    const i = this.n < MAX ? this.n++ : Math.floor(Math.random() * MAX);
    this.p[i * 3] = pos.x; this.p[i * 3 + 1] = pos.y; this.p[i * 3 + 2] = pos.z;
    this.v[i * 3] = dir.x * speed + baseVel.x * 0.4;
    this.v[i * 3 + 1] = dir.y * speed + baseVel.y * 0.4;
    this.v[i * 3 + 2] = dir.z * speed + baseVel.z * 0.4;
    this.life[i] = config.combat.bulletLife;
    this.owner[i] = owner;
    this.dmg[i] = damage;
    const col = this.mesh.instanceColor!.array as Float32Array;
    if (owner === 0) col.set([1.0, 0.95, 0.45], i * 3);
    else col.set([1.0, 0.3, 0.35], i * 3);
  }

  /** 固定ステップ更新。targets[owner] に対して判定する（owner=0の弾は enemyTargets、1の弾は playerTargets） */
  step(dt: number, hitsFor0: Target[], hitsFor1: Target[]): void {
    for (let i = 0; i < this.n; ) {
      this.a.set(this.p[i * 3], this.p[i * 3 + 1], this.p[i * 3 + 2]);
      this.life[i] -= dt;
      this.p[i * 3] += this.v[i * 3] * dt;
      this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt;
      this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      this.b.set(this.p[i * 3], this.p[i * 3 + 1], this.p[i * 3 + 2]);
      let dead = this.life[i] <= 0 || this.b.y < 0.5;
      if (!dead) {
        const targets = this.owner[i] === 0 ? hitsFor0 : hitsFor1;
        this.d.subVectors(this.b, this.a);
        const len2 = this.d.lengthSq();
        for (const t of targets) {
          if (!t.alive) continue;
          // 線分と球の最近接点
          const s = len2 > 0 ? THREE.MathUtils.clamp(this.pp.subVectors(t.pos, this.a).dot(this.d) / len2, 0, 1) : 0;
          this.pp.copy(this.a).addScaledVector(this.d, s);
          if (this.pp.distanceToSquared(t.pos) < t.radius * t.radius) {
            t.onHit(this.dmg[i], this.pp, this.owner[i]);
            dead = true;
            break;
          }
        }
      }
      if (dead) {
        const l = --this.n;
        if (i !== l) {
          for (let k = 0; k < 3; k++) {
            this.p[i * 3 + k] = this.p[l * 3 + k];
            this.v[i * 3 + k] = this.v[l * 3 + k];
          }
          this.life[i] = this.life[l];
          this.owner[i] = this.owner[l];
          this.dmg[i] = this.dmg[l];
          const col = this.mesh.instanceColor!.array as Float32Array;
          col.set(col.subarray(l * 3, l * 3 + 3), i * 3);
        }
        continue;
      }
      i++;
    }
  }

  /** 描画: 補間(alpha)した位置に弾の進行方向向きで配置 */
  render(alpha: number, dt: number): void {
    for (let i = 0; i < this.n; i++) {
      this.d.set(this.v[i * 3], this.v[i * 3 + 1], this.v[i * 3 + 2]);
      this.pp.set(this.p[i * 3], this.p[i * 3 + 1], this.p[i * 3 + 2]).addScaledVector(this.d, (alpha - 1) * dt);
      this.d.normalize();
      this.q.setFromUnitVectors(this.fwd, this.d);
      this.m.compose(this.pp, this.q, this.sc);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
  }
}
