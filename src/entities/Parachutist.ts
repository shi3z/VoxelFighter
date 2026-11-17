import * as THREE from 'three';
import { VoxelBuilder } from '../voxel/VoxelModel';
import { meshVoxelModel } from '../voxel/VoxelMesher';
import { P } from '../voxel/VoxelPalette';

/** パイロット（小さなボクセル人形） */
export function buildPilot(): THREE.BufferGeometry {
  const b = new VoxelBuilder();
  // 脚
  for (let y = 0; y < 3; y++) {
    b.set(-1, y, 0, y === 0 ? P.DG1 : P.SUIT);
    b.set(1, y, 0, y === 0 ? P.DG1 : P.SUIT);
  }
  // 胴体
  for (let y = 3; y < 7; y++) for (let x = -1; x <= 1; x++) for (let z = -1; z <= 0; z++) b.set(x, y, z, y === 5 ? P.DG2 : P.SUIT);
  // 腕（パラシュートの紐を握る）
  for (let y = 5; y < 10; y++) {
    b.set(-3, y, 0, P.SUIT);
    b.set(3, y, 0, P.SUIT);
  }
  b.set(-3, 10, 0, P.SKIN);
  b.set(3, 10, 0, P.SKIN);
  // ヘルメット
  for (let x = -1; x <= 1; x++) for (let y = 7; y <= 9; y++) for (let z = -1; z <= 0; z++) b.set(x, y, z, P.HELMET);
  b.set(-1, 8, 1, P.TEAL);
  b.set(0, 8, 1, P.TEAL);
  b.set(1, 8, 1, P.TEAL);
  return meshVoxelModel(b.build([0, 0, 0]), 0.4);
}

/** ボクセルで造形したパラシュート（半球 + 赤白ストライプ） */
export function buildChute(): { geo: THREE.BufferGeometry; rimRadius: number; height: number } {
  const b = new VoxelBuilder();
  const R = 9;
  for (let x = -R; x <= R; x++)
    for (let y = 0; y <= R; y++)
      for (let z = -R; z <= R; z++) {
        const d = Math.hypot(x, y * 1.2, z);
        if (d > R || d < R - 1.6) continue;
        const ang = Math.atan2(z, x);
        const stripe = Math.floor(((ang + Math.PI) / (Math.PI * 2)) * 10) % 2 === 0;
        b.set(x, y, z, stripe ? P.CHUTE_RED : P.CHUTE_WHITE);
      }
  const model = b.build([0, 0, 0]);
  return { geo: meshVoxelModel(model, 0.45), rimRadius: R * 0.45, height: R * 0.45 };
}

export class Parachutist {
  readonly root = new THREE.Group();
  private chute: THREE.Mesh;
  private pilot: THREE.Mesh;
  private ropes: THREE.LineSegments;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  private t = 0;
  private phase = Math.random() * 6;
  done = false;
  landed = false;
  private landT = 0;
  private drift: THREE.Vector3;

  constructor(
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    material: THREE.Material,
    private pilotGeo: THREE.BufferGeometry,
    private chuteData: { geo: THREE.BufferGeometry; rimRadius: number; height: number },
  ) {
    this.pos.copy(pos);
    this.vel.copy(vel).multiplyScalar(0.25);
    this.vel.y += 20; // 脱出時の射出
    this.drift = new THREE.Vector3((Math.random() - 0.5) * 6, 0, (Math.random() - 0.5) * 6);
    this.pilot = new THREE.Mesh(pilotGeo, material);
    this.chute = new THREE.Mesh(chuteData.geo, material);
    this.chute.position.y = 6.5;
    this.chute.scale.setScalar(0.01);
    const rp = new Float32Array(8 * 2 * 3);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const rx = Math.cos(a) * chuteData.rimRadius * 0.9;
      const rz = Math.sin(a) * chuteData.rimRadius * 0.9;
      rp.set([rx, 6.5, rz, Math.sign(rx) * 0.6, 4.2, 0], i * 6);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    this.ropes = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xeeeeee, fog: false }));
    this.ropes.scale.setScalar(0.01);
    this.root.add(this.pilot, this.chute, this.ropes);
    this.root.position.copy(pos);
  }

  step(dt: number, groundY: number): 'airborne' | 'water' | 'ground' | 'gone' {
    this.t += dt;
    if (this.landed) {
      this.landT += dt;
      if (this.landT > 2) this.done = true;
      return 'gone';
    }
    // 開傘: 0.5秒後から0.5秒でパラシュートが開く → 終端速度で降下
    const open = THREE.MathUtils.clamp((this.t - 0.5) / 0.5, 0, 1);
    this.chute.scale.setScalar(Math.max(0.01, open));
    this.ropes.scale.setScalar(Math.max(0.01, open));
    const terminal = -7 - (1 - open) * 30;
    this.vel.y += (terminal - this.vel.y) * (1 - Math.exp(-(open > 0 ? 2.2 : 0.4) * dt));
    this.vel.x += (this.drift.x - this.vel.x) * (1 - Math.exp(-0.8 * dt));
    this.vel.z += (this.drift.z - this.vel.z) * (1 - Math.exp(-0.8 * dt));
    this.pos.addScaledVector(this.vel, dt);
    const sway = Math.sin(this.t * 2 + this.phase) * 0.14 * open;
    this.root.rotation.z = sway;
    this.root.rotation.x = Math.cos(this.t * 1.6 + this.phase) * 0.08 * open;
    this.root.position.copy(this.pos);
    if (this.pos.y <= Math.max(groundY, 0.5)) {
      this.landed = true;
      this.root.visible = groundY > 1;
      if (groundY <= 1) {
        this.done = true;
        return 'water';
      }
      return 'ground';
    }
    return 'airborne';
  }

  dispose(): void {
    this.ropes.geometry.dispose();
    (this.ropes.material as THREE.Material).dispose();
  }
}
