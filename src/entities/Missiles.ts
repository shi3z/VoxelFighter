import * as THREE from 'three';
import { createParticleMaterial } from '../rendering/Materials';
import { FxHub, rgb } from '../effects/VoxelParticles';
import type { EnemyFighter } from './EnemyFighter';

const MAX = 16;
const LIFE = 7;
const GUIDE_DELAY = 0.3;
const TURN_RATE = 2.6;
const TOP_SPEED = 300;

interface Missile {
  pos: THREE.Vector3;
  prev: THREE.Vector3;
  heading: THREE.Vector3;
  speed: number;
  age: number;
  target: EnemyFighter | null;
}

const SMOKE0 = rgb(0xf4f6fa);
const SMOKE1 = rgb(0x9aa8bc);
const FLAME0 = rgb(0xfff2a8);
const FLAME1 = rgb(0xff6a1c);

/** ホーミングミサイル。ロック済みの敵へ比例航法風に誘導し、煙の尾を引く。 */
export class Missiles {
  readonly mesh: THREE.InstancedMesh;
  private list: Missile[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private fwd = new THREE.Vector3(0, 0, 1);
  private sc = new THREE.Vector3(1, 1, 1);
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();
  private c = new THREE.Vector3();

  constructor() {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.1, 1.1, 7), createParticleMaterial(1, false), MAX);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3).fill(1), 3);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  get count(): number {
    return this.list.length;
  }

  clear(): void {
    this.list.length = 0;
    this.mesh.count = 0;
  }

  /** 発射。target が null なら無誘導。 */
  fire(pos: THREE.Vector3, dir: THREE.Vector3, baseSpeed: number, target: EnemyFighter | null): void {
    if (this.list.length >= MAX) return;
    this.list.push({ pos: pos.clone(), prev: pos.clone(), heading: dir.clone().normalize(), speed: baseSpeed + 20, age: 0, target });
  }

  /** 固定ステップ更新。命中/着弾時に onDetonate を呼ぶ。 */
  step(
    dt: number,
    enemies: EnemyFighter[],
    fx: FxHub,
    groundHeight: (x: number, z: number) => number,
    onDetonate: (p: THREE.Vector3, direct: EnemyFighter | null) => void,
  ): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const ms = this.list[i];
      ms.age += dt;
      ms.prev.copy(ms.pos);
      ms.speed = Math.min(TOP_SPEED, ms.speed + 260 * dt);

      const t = ms.target;
      if (t && !t.alive) ms.target = null;
      if (ms.target && ms.age > GUIDE_DELAY) {
        const dist = this.a.subVectors(ms.target.pos, ms.pos).length();
        const aim = this.b.copy(ms.target.pos).addScaledVector(ms.target.velocity, (dist / ms.speed) * 0.9);
        const want = this.c.subVectors(aim, ms.pos).normalize();
        const ang = Math.acos(THREE.MathUtils.clamp(ms.heading.dot(want), -1, 1));
        if (ang > 1e-4) {
          const axis = this.a.crossVectors(ms.heading, want);
          if (axis.lengthSq() > 1e-10) ms.heading.applyAxisAngle(axis.normalize(), Math.min(ang, TURN_RATE * dt));
        }
      }
      ms.pos.addScaledVector(ms.heading, ms.speed * dt);

      // 尾: 煙とモーター炎
      fx.smoke.spawn({
        x: ms.prev.x, y: ms.prev.y, z: ms.prev.z, vx: 0, vy: 0.5, vz: 0,
        life: 1.5, s0: 1.4, s1: 3.4, c0: SMOKE0, c1: SMOKE1, drag: 0.5,
      });
      fx.solid.spawn({
        x: ms.prev.x - ms.heading.x * 3.5, y: ms.prev.y - ms.heading.y * 3.5, z: ms.prev.z - ms.heading.z * 3.5,
        vx: 0, vy: 0, vz: 0, life: 0.12, s0: 1.5, s1: 0.4, c0: FLAME0, c1: FLAME1,
      });

      // 衝突: 線分-球。誘導対象以外も当たる。
      let hit: EnemyFighter | null = null;
      let boom = false;
      const d = this.a.subVectors(ms.pos, ms.prev);
      const len2 = d.lengthSq();
      for (const e of enemies) {
        if (!e.alive) continue;
        const s = len2 > 0 ? THREE.MathUtils.clamp(this.b.subVectors(e.pos, ms.prev).dot(d) / len2, 0, 1) : 0;
        this.b.copy(ms.prev).addScaledVector(d, s);
        const r = e.radius + 5;
        if (this.b.distanceToSquared(e.pos) < r * r) {
          hit = e;
          boom = true;
          break;
        }
      }
      if (!boom && (ms.age > LIFE || ms.pos.y < groundHeight(ms.pos.x, ms.pos.z) + 1)) boom = true;
      if (boom) {
        onDetonate(ms.pos, hit);
        this.list.splice(i, 1);
      }
    }
  }

  render(alpha: number, dt: number): void {
    const col = this.mesh.instanceColor!.array as Float32Array;
    for (let i = 0; i < this.list.length; i++) {
      const ms = this.list[i];
      this.a.copy(ms.pos).addScaledVector(ms.heading, (alpha - 1) * ms.speed * dt);
      this.q.setFromUnitVectors(this.fwd, ms.heading);
      this.m.compose(this.a, this.q, this.sc);
      this.mesh.setMatrixAt(i, this.m);
      col[i * 3] = 0.95; col[i * 3 + 1] = 0.95; col[i * 3 + 2] = 1.0;
    }
    this.mesh.count = this.list.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
  }
}
