import * as THREE from 'three';
import { config } from '../config';
import { Controls } from '../input/InputManager';
import { Aircraft } from './Aircraft';

const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const WORLD_UP = new THREE.Vector3(0, 1, 0);

/** プレイヤー機: 簡易アーケード飛行モデル */
export class Fighter extends Aircraft {
  throttle = 0.55;
  boostEnergy = 1;
  boosting = false;
  private pitchV = 0;
  private yawV = 0;
  private rollV = 0;
  private qa = new THREE.Quaternion();
  private fwd = new THREE.Vector3();
  private rgt = new THREE.Vector3();
  private upv = new THREE.Vector3();
  fireCooldown = 0;
  gunSide = 0;
  invuln = 0;

  reset(pos: THREE.Vector3, quat: THREE.Quaternion): void {
    this.hp = this.maxHp = config.combat.playerHp;
    this.alive = true;
    this.throttle = 0.55;
    this.boostEnergy = 1;
    this.pitchV = this.yawV = this.rollV = 0;
    this.speed = config.flight.minSpeed + (config.flight.maxSpeed - config.flight.minSpeed) * 0.55;
    this.teleport(pos, quat);
    this.root.visible = true;
  }

  step(dt: number, c: Controls): void {
    const f = config.flight;
    this.snapshot();
    this.invuln = Math.max(0, this.invuln - dt);

    // スロットルとブースト
    this.throttle = Math.min(1, Math.max(0, this.throttle + c.throttleDelta * 0.55 * dt));
    this.boosting = c.boost && this.boostEnergy > 0.02;
    this.boostEnergy = Math.min(1, Math.max(0, this.boostEnergy + (this.boosting ? -f.boostDrain : f.boostRegen) * dt));

    // 入力に対する角速度の慣性（鈍重になりすぎない応答）
    const k = 1 - Math.exp(-f.response * dt);
    this.pitchV += (c.pitch * f.pitchRate - this.pitchV) * k;
    this.yawV += (c.yaw * f.yawRate - this.yawV) * k;
    this.rollV += (c.roll * f.rollRate - this.rollV) * k;

    this.right(this.rgt);
    this.up(this.upv);
    this.forward(this.fwd);

    // 水平に戻ろうとする自動ロール補正（宙返り中・背面時は無効）
    let rollRate = this.rollV;
    if (Math.abs(c.roll) < 0.05 && this.upv.y > 0.15) rollRate += this.rgt.y * f.autoLevel;

    // ローカル軸まわりの回転（ピッチ: +X, ヨー: +Y(右旋回は負), ロール: +Z(右ロールは負)）
    this.qa.setFromAxisAngle(AX, this.pitchV * dt);
    this.quat.multiply(this.qa);
    this.qa.setFromAxisAngle(AY, -this.yawV * dt);
    this.quat.multiply(this.qa);
    this.qa.setFromAxisAngle(AZ, -rollRate * dt);
    this.quat.multiply(this.qa);

    // バンクによる自動旋回（右翼が下がるほど右へ曲がる）
    const bankFactor = Math.min(1, Math.max(0, this.upv.y + 0.35));
    this.qa.setFromAxisAngle(WORLD_UP, this.rgt.y * f.bankTurn * bankFactor * dt);
    this.quat.premultiply(this.qa);
    this.quat.normalize();

    // 速度: スロットル + ブースト + 重力（降下で加速/上昇で減速）
    const target =
      f.minSpeed + (f.maxSpeed - f.minSpeed) * this.throttle + (this.boosting ? f.boostExtra : 0) - this.fwd.y * f.gravityPitch;
    const a = f.accel * (this.boosting ? 2 : 1);
    this.speed += Math.max(-a * dt, Math.min(a * dt, target - this.speed));
    this.speed = Math.max(f.minSpeed * 0.82, this.speed);
    this.thrust = Math.min(1.4, (this.speed - f.minSpeed * 0.6) / (f.maxSpeed - f.minSpeed * 0.6)) * (this.boosting ? 1.15 : 1);

    this.forward(this.fwd);
    this.velocity.copy(this.fwd).multiplyScalar(this.speed);
    this.pos.addScaledVector(this.velocity, dt);

    // 高度上限: 超えると機首が下がる
    if (this.pos.y > 520) {
      this.qa.setFromAxisAngle(AX, -0.9 * dt);
      this.quat.multiply(this.qa);
    }
  }

  /** ピッチ・ロール角（HUD用）。ロールは右翼上げが正 */
  attitude(): { pitch: number; roll: number } {
    this.forward(this.fwd);
    this.right(this.rgt);
    this.up(this.upv);
    return { pitch: Math.asin(THREE.MathUtils.clamp(this.fwd.y, -1, 1)), roll: Math.atan2(this.rgt.y, this.upv.y) };
  }
}
