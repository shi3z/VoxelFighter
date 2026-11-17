import * as THREE from 'three';
import { config } from '../config';
import { Aircraft } from './Aircraft';
import { Fighter } from './Fighter';
import { Bullets } from './Bullets';
import { World } from '../world/World';

export type EnemyState = 'cruise' | 'chase' | 'attack' | 'evade';

const UP = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);

/** 敵機: 巡航 → 追跡 → 攻撃 → 回避 の状態機械で動く簡易AI */
export class EnemyFighter extends Aircraft {
  state: EnemyState = 'cruise';
  private heading = new THREE.Vector3(0, 0, -1);
  private stateTime = 0;
  private bank = 0;
  private wander = new THREE.Vector3();
  private evadeDir = new THREE.Vector3();
  private fireTimer = 0;
  private burst = 0;
  private cruiseAlt = 150;
  respawnTimer = 0;
  hitFlash = 0;
  private tmp = new THREE.Vector3();
  private want = new THREE.Vector3();
  private m = new THREE.Matrix4();
  private qr = new THREE.Quaternion();
  private zero = new THREE.Vector3();
  readonly turnRate = 1.15 + Math.random() * 0.35;
  readonly baseSpeed = 74 + Math.random() * 18;

  spawn(pos: THREE.Vector3, heading: THREE.Vector3): void {
    this.hp = this.maxHp = config.combat.enemyHp;
    this.alive = true;
    this.state = 'cruise';
    this.stateTime = 0;
    this.heading.copy(heading).normalize();
    this.cruiseAlt = pos.y;
    this.speed = this.baseSpeed;
    this.bank = 0;
    this.root.visible = true;
    this.pickWander(pos);
    this.orient();
    this.teleport(pos, this.quat);
  }

  private pickWander(from: THREE.Vector3): void {
    const a = Math.random() * Math.PI * 2;
    this.wander.set(from.x + Math.cos(a) * 700, 0, from.z + Math.sin(a) * 700);
    this.cruiseAlt = 90 + Math.random() * 140;
  }

  private orient(): void {
    this.m.lookAt(this.zero, this.heading, UP);
    this.quat.setFromRotationMatrix(this.m);
    this.qr.setFromAxisAngle(AZ, -this.bank);
    this.quat.multiply(this.qr);
  }

  /** 現在の向きから want へ最大 rate*dt だけ回頭（機首方向ベクトルを回す） */
  private steer(want: THREE.Vector3, dt: number, rate: number): number {
    const dot = THREE.MathUtils.clamp(this.heading.dot(want), -1, 1);
    const ang = Math.acos(dot);
    if (ang < 1e-4) return 0;
    const step = Math.min(ang, rate * dt);
    this.tmp.crossVectors(this.heading, want);
    if (this.tmp.lengthSq() < 1e-8) this.tmp.set(0, 1, 0); // 真後ろ: 適当に旋回開始
    this.tmp.normalize();
    this.heading.applyAxisAngle(this.tmp, step);
    // 水平成分への回頭量でバンク角を決める
    const turnSign = this.tmp.y; // +なら左旋回
    return (-turnSign * step) / Math.max(dt, 1e-4);
  }

  step(dt: number, player: Fighter, world: World, bullets: Bullets, canAttack = true): void {
    this.snapshot();
    this.stateTime += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    const toP = this.tmp.subVectors(player.pos, this.pos);
    const dist = toP.length();
    const dirToP = toP.clone().divideScalar(Math.max(dist, 1e-3));
    const dot = this.heading.dot(dirToP);
    const playerFwd = player.forward();
    const playerAimsAtMe = player.alive && playerFwd.dot(dirToP) < -0.93 && dist < 650;

    // 状態遷移
    switch (this.state) {
      case 'cruise':
        if (player.alive && dist < 1500) this.setState('chase');
        break;
      case 'chase':
        if (!player.alive || dist > 2300) this.setState('cruise');
        else if (canAttack && dist < 420 && dot > 0.86) this.setState('attack');
        else if (playerAimsAtMe && Math.random() < dt * 0.9) this.setState('evade');
        break;
      case 'attack':
        if (dist < 85 || this.stateTime > 3.6 || dist > 650) this.setState(dist < 85 ? 'evade' : 'chase');
        else if (playerAimsAtMe && Math.random() < dt * 0.6) this.setState('evade');
        break;
      case 'evade':
        if (this.stateTime > 1.8 + (this.burst % 2)) this.setState('chase');
        break;
    }

    // 目標方向
    const want = this.want;
    let speedT = this.baseSpeed;
    let rate = this.turnRate;
    switch (this.state) {
      case 'cruise': {
        want.set(this.wander.x - this.pos.x, this.cruiseAlt - this.pos.y, this.wander.z - this.pos.z);
        want.y = THREE.MathUtils.clamp(want.y, -120, 120);
        want.normalize();
        if (Math.hypot(this.wander.x - this.pos.x, this.wander.z - this.pos.z) < 120) this.pickWander(this.pos);
        rate *= 0.6;
        break;
      }
      case 'chase':
      case 'attack': {
        // 偏差射撃: プレイヤーの未来位置へ
        const lead = Math.min(1.2, dist / 520);
        want.copy(player.pos).addScaledVector(player.velocity, lead * 0.6).sub(this.pos).normalize();
        speedT = this.state === 'chase' ? this.baseSpeed + 22 : this.baseSpeed + 8;
        break;
      }
      case 'evade': {
        want.copy(this.evadeDir);
        speedT = this.baseSpeed + 38;
        rate *= 1.5;
        break;
      }
    }
    // 地面・海面の回避
    const ahead = this.pos.clone().addScaledVector(this.heading, 260);
    const gh = Math.max(world.groundHeight(ahead.x, ahead.z), world.groundHeight(this.pos.x, this.pos.z));
    if (ahead.y < gh + 45 || this.pos.y < 40) {
      want.y = Math.max(want.y, 0.7);
      want.normalize();
      rate *= 1.6;
    }
    if (this.pos.y > 460) {
      want.y = Math.min(want.y, -0.3);
      want.normalize();
    }
    const turnRateNow = this.steer(want, dt, rate);
    // 機首ピッチを制限して真上/真下の特異点を回避
    if (Math.abs(this.heading.y) > 0.9) {
      this.heading.y = Math.sign(this.heading.y) * 0.9;
      this.heading.normalize();
    }
    const targetBank = THREE.MathUtils.clamp(turnRateNow * 0.55, -1.2, 1.2) * (this.state === 'evade' ? 1.6 : 1);
    this.bank += (targetBank - this.bank) * (1 - Math.exp(-4 * dt));
    this.orient();

    this.speed += (speedT - this.speed) * (1 - Math.exp(-1.2 * dt));
    this.thrust = 0.5 + (this.speed - this.baseSpeed) / 60;
    this.velocity.copy(this.heading).multiplyScalar(this.speed);
    this.pos.addScaledVector(this.velocity, dt);

    // 射撃: 照準が合ったらバースト
    this.fireTimer -= dt;
    if (this.state === 'attack' && player.alive && dot > 0.975 && dist < 560) {
      if (this.fireTimer <= 0) {
        this.burst++;
        this.fireTimer = 0.14;
        const d = dirToP.clone();
        d.addScaledVector(player.velocity, 0.0003 * dist * 0.5).normalize();
        d.x += (Math.random() - 0.5) * 0.07;
        d.y += (Math.random() - 0.5) * 0.07;
        d.normalize();
        const gun = this.data.guns[this.burst % 2].clone().applyQuaternion(this.quat).add(this.pos);
        bullets.fire(gun, d, this.velocity, 1, config.combat.enemyDamage, 380);
        if (this.burst % 6 === 0) this.fireTimer = 1.1;
      }
    }
  }

  private setState(s: EnemyState): void {
    this.state = s;
    this.stateTime = 0;
    if (s === 'evade') {
      // 横へ急旋回しながら上昇/降下
      const side = Math.random() < 0.5 ? -1 : 1;
      this.evadeDir.crossVectors(this.heading, UP).normalize().multiplyScalar(side);
      this.evadeDir.y = (Math.random() - 0.4) * 0.8;
      this.evadeDir.addScaledVector(this.heading, 0.35).normalize();
    }
  }
}
