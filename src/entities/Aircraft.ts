import * as THREE from 'three';
import { Exhaust } from '../effects/Exhaust';
import { Contrails } from '../effects/Contrails';
import { FxHub } from '../effects/VoxelParticles';
import { FighterModelData } from './FighterModel';

const FWD = new THREE.Vector3(0, 0, -1);

/** 位置・姿勢をQuaternionで管理する戦闘機の共通基底。単一の親Transform(root)に全パーツをまとめる。 */
export class Aircraft {
  readonly root = new THREE.Object3D();
  readonly mesh: THREE.Mesh;
  readonly exhaust: Exhaust;
  readonly pos = new THREE.Vector3();
  readonly quat = new THREE.Quaternion();
  readonly prevPos = new THREE.Vector3();
  readonly prevQuat = new THREE.Quaternion();
  readonly velocity = new THREE.Vector3();
  speed = 80;
  hp = 100;
  maxHp = 100;
  alive = true;
  thrust = 0.6;
  contrails?: Contrails;

  constructor(
    readonly data: FighterModelData,
    material: THREE.Material,
    fx: FxHub,
    exhaustScale: number,
  ) {
    this.mesh = new THREE.Mesh(data.geometry, material);
    this.root.add(this.mesh);
    this.exhaust = new Exhaust(fx, data.nozzles, exhaustScale, this.root);
  }

  get radius(): number {
    return this.data.radius;
  }

  forward(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(FWD).applyQuaternion(this.quat);
  }
  up(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(0, 1, 0).applyQuaternion(this.quat);
  }
  right(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(1, 0, 0).applyQuaternion(this.quat);
  }

  snapshot(): void {
    this.prevPos.copy(this.pos);
    this.prevQuat.copy(this.quat);
  }

  /** 固定ステップ間の補間でrootへ反映 */
  syncRender(alpha: number): void {
    this.root.position.lerpVectors(this.prevPos, this.pos, alpha);
    this.root.quaternion.slerpQuaternions(this.prevQuat, this.quat, alpha);
    this.root.updateMatrixWorld(true);
  }

  teleport(p: THREE.Vector3, q: THREE.Quaternion): void {
    this.pos.copy(p);
    this.quat.copy(q);
    this.prevPos.copy(p);
    this.prevQuat.copy(q);
    this.root.position.copy(p);
    this.root.quaternion.copy(q);
    this.root.updateMatrixWorld(true);
    this.contrails?.reset();
  }
}
