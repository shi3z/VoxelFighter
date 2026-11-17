import * as THREE from 'three';
import { config } from '../config';
import { Aircraft } from '../entities/Aircraft';

export type CamMode = 'chase' | 'far' | 'free' | 'cockpit';
export const CAM_MODES: CamMode[] = ['chase', 'far', 'free', 'cockpit'];

const UP = new THREE.Vector3(0, 1, 0);

/**
 * 三人称追従カメラ。位置・回転ともにSpring-Damperで駆動し、急旋回時に遅れて追従する。
 * ロール追従は部分的（画面は適度に傾く）。FOVは速度に応じてスプリングで変化。
 */
export class CameraController {
  readonly camera: THREE.PerspectiveCamera;
  mode: CamMode = 'chase';
  private vel = new THREE.Vector3();
  private angVel = new THREE.Vector3();
  private q = new THREE.Quaternion();
  private fov: number = config.camera.fov;
  private fovVel = 0;
  private freeYaw = 0.6;
  private freePitch = 0.3;
  private shake = 0;
  private m = new THREE.Matrix4();
  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();
  private errQ = new THREE.Quaternion();
  private desQ = new THREE.Quaternion();
  private pitchQ = new THREE.Quaternion();
  private offQ = new THREE.Quaternion();
  private initialised = false;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(config.camera.fov, aspect, 1, 9000);
  }

  cycle(): CamMode {
    this.mode = CAM_MODES[(CAM_MODES.indexOf(this.mode) + 1) % CAM_MODES.length];
    this.initialised = false;
    return this.mode;
  }

  addShake(a: number): void {
    this.shake = Math.min(1.5, this.shake + a);
  }

  snap(): void {
    this.initialised = false;
  }

  setAspect(a: number): void {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number, target: Aircraft, boostK: number, drag: { dx: number; dy: number }, groundY: (x: number, z: number) => number): void {
    dt = Math.min(dt, 1 / 20);
    const cc = config.camera;
    const tq = target.root.quaternion;
    const tp = target.root.position;
    const cam = this.camera;

    // 目標FOV（加速で広げ、減速で戻す）
    const fovT = (this.mode === 'cockpit' ? 74 : cc.fov) + cc.fovBoost * boostK;
    const fa = 60 * (fovT - this.fov) - 12 * this.fovVel;
    this.fovVel += fa * dt;
    this.fov += this.fovVel * dt;
    cam.fov = this.fov;
    cam.updateProjectionMatrix();

    if (this.mode === 'cockpit') {
      this.tmpV.set(0, 1.55, -1.6).applyQuaternion(tq).add(tp);
      cam.position.copy(this.tmpV);
      cam.quaternion.copy(tq);
      this.q.copy(tq);
      this.vel.copy(target.velocity);
      this.initialised = false;
      return;
    }

    if (this.mode === 'free') {
      this.freeYaw -= drag.dx * 0.006;
      this.freePitch = THREE.MathUtils.clamp(this.freePitch + drag.dy * 0.005, -1.2, 1.4);
      if (Math.abs(drag.dx) + Math.abs(drag.dy) < 0.1) this.freeYaw += dt * 0.12; // 自動周回
      const d = cc.freeDistance;
      this.tmpV.set(Math.sin(this.freeYaw) * Math.cos(this.freePitch), Math.sin(this.freePitch), Math.cos(this.freeYaw) * Math.cos(this.freePitch)).multiplyScalar(d).add(tp);
      const k = 1 - Math.exp(-8 * dt);
      if (!this.initialised) cam.position.copy(this.tmpV);
      else cam.position.lerp(this.tmpV, k);
      // 機体と一緒に移動するので追従分を加える
      cam.position.addScaledVector(target.velocity, dt * (1 - k));
      this.m.lookAt(cam.position, tp, UP);
      cam.quaternion.setFromRotationMatrix(this.m);
      this.q.copy(cam.quaternion);
      this.initialised = true;
      return;
    }

    const far = this.mode === 'far';
    const dist = far ? cc.far.distance : cc.chase.distance;
    const height = far ? cc.far.height : cc.chase.height;

    // 目標姿勢: 機体の進行方向に向き、ロールは rollFollow の割合だけ追従
    this.tmpV.set(0, 1, 0).applyQuaternion(tq); // 機体のup
    this.tmpV2.copy(UP).multiplyScalar(1 - cc.rollFollow).addScaledVector(this.tmpV, cc.rollFollow).normalize();
    this.tmpV.set(0, 0, -1).applyQuaternion(tq); // 機体のforward
    this.m.lookAt(new THREE.Vector3(), this.tmpV, this.tmpV2);
    this.desQ.setFromRotationMatrix(this.m);
    this.pitchQ.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -cc.pitchDown * (far ? 1.2 : 1));
    this.desQ.multiply(this.pitchQ);

    if (!this.initialised) {
      this.q.copy(this.desQ);
      this.offQ.copy(this.q).multiply(this.tmpQ.copy(this.pitchQ).invert());
      this.tmpV.set(0, height, dist).applyQuaternion(this.offQ).add(tp);
      cam.position.copy(this.tmpV);
      this.vel.copy(target.velocity);
      this.angVel.set(0, 0, 0);
      this.initialised = true;
    }

    // 回転のSpring-Damper（最短弧の誤差回転ベクトルに対するバネ）
    this.errQ.copy(this.desQ).multiply(this.tmpQ.copy(this.q).invert());
    if (this.errQ.w < 0) {
      this.errQ.x = -this.errQ.x; this.errQ.y = -this.errQ.y; this.errQ.z = -this.errQ.z; this.errQ.w = -this.errQ.w;
    }
    const w = Math.min(1, this.errQ.w);
    const angle = 2 * Math.acos(w);
    const s = Math.sqrt(Math.max(1e-12, 1 - w * w));
    this.tmpV.set(this.errQ.x / s, this.errQ.y / s, this.errQ.z / s).multiplyScalar(angle);
    if (angle < 1e-5) this.tmpV.set(0, 0, 0);
    this.angVel.addScaledVector(this.tmpV, cc.rotStiffness * dt).addScaledVector(this.angVel, -cc.rotDamping * dt);
    const av = this.angVel.length();
    if (av > 1e-6) {
      this.tmpQ.setFromAxisAngle(this.tmpV.copy(this.angVel).divideScalar(av), av * dt);
      this.q.premultiply(this.tmpQ).normalize();
    }

    // 位置のSpring-Damper（目標の速度に対する相対運動）
    // オフセットはピッチダウンを除いた姿勢で適用（機体が画面中央付近に収まる）
    this.offQ.copy(this.q).multiply(this.tmpQ.copy(this.pitchQ).invert());
    this.tmpV.set(0, height, dist).applyQuaternion(this.offQ).add(tp);
    this.tmpV2.subVectors(this.tmpV, cam.position);
    const rel = this.tmpV.copy(this.vel).sub(target.velocity);
    this.vel.addScaledVector(this.tmpV2, cc.posStiffness * dt).addScaledVector(rel, -cc.posDamping * dt);
    cam.position.addScaledVector(this.vel, dt);

    // 地面・海面にめり込まない
    const gy = Math.max(groundY(cam.position.x, cam.position.z), 0) + 4;
    if (cam.position.y < gy) cam.position.y = gy;

    cam.quaternion.copy(this.q);

    // 被弾シェイク
    if (this.shake > 0.001) {
      cam.position.x += (Math.random() - 0.5) * this.shake * 1.4;
      cam.position.y += (Math.random() - 0.5) * this.shake * 1.4;
      this.shake *= Math.exp(-7 * dt);
    }
  }
}
