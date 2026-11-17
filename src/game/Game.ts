import * as THREE from 'three';
import { config } from '../config';
import { Contrails } from '../effects/Contrails';
import { initExplosionFlash, spawnExplosion, spawnHitSparks, spawnSplash, updateExplosionFlash } from '../effects/Explosion';
import { FxHub } from '../effects/VoxelParticles';
import { Bullets, Target } from '../entities/Bullets';
import { EnemyFighter } from '../entities/EnemyFighter';
import { Missiles } from '../entities/Missiles';
import { Fighter } from '../entities/Fighter';
import { buildFighter, ENEMY_STYLE, PLAYER_STYLE } from '../entities/FighterModel';
import { buildChute, buildPilot, Parachutist } from '../entities/Parachutist';
import { InputManager } from '../input/InputManager';
import { CameraController } from '../rendering/CameraController';
import { createVoxelMaterial } from '../rendering/Materials';
import { PixelRenderer } from '../rendering/PixelRenderer';
import { Sky } from '../rendering/Sky';
import { HUD } from '../ui/HUD';
import { World } from '../world/World';
import { GameLoop } from './GameLoop';

type State = 'play' | 'paused' | 'dead';

export class Game {
  readonly px: PixelRenderer;
  readonly scene = new THREE.Scene();
  readonly world: World;
  readonly fx = new FxHub();
  readonly bullets = new Bullets();
  readonly missiles = new Missiles();
  readonly input = new InputManager();
  readonly hud = new HUD();
  readonly cam: CameraController;
  readonly player: Fighter;
  readonly enemies: EnemyFighter[] = [];
  private enemyTargets: Target[] = [];
  private playerTargets: Target[];
  private parachutes: Parachutist[] = [];
  private pilotGeo = buildPilot();
  private chuteData = buildChute();
  private mat = createVoxelMaterial();
  private sky = new Sky();
  private contrails: Contrails;
  private loop: GameLoop;
  state: State = 'play';
  kills = 0;
  score = 0;
  private lock: EnemyFighter | null = null;
  private lockTime = 0;
  private missileAmmo = 6;
  private missileReload = 0;
  private missileSide = 0;
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();

  constructor(container: HTMLElement) {
    this.px = new PixelRenderer(container);
    this.world = new World(config.seed);
    this.cam = new CameraController(window.innerWidth / window.innerHeight);

    const playerData = buildFighter(PLAYER_STYLE, 0.5, 1);
    const enemyData = buildFighter(ENEMY_STYLE, 0.62, 2);
    this.player = new Fighter(playerData, this.mat, this.fx, 1.0);
    this.contrails = new Contrails(playerData.wingtips);
    this.player.contrails = this.contrails;

    this.scene.add(this.sky.mesh, this.world.group, this.fx.group, this.bullets.mesh, this.missiles.mesh, this.contrails.group, this.player.root);
    initExplosionFlash(this.scene);

    for (let i = 0; i < config.combat.enemyCount; i++) {
      const e = new EnemyFighter(enemyData, this.mat, this.fx, 0.85);
      this.enemies.push(e);
      this.scene.add(e.root);
      this.enemyTargets.push({
        pos: e.pos,
        get radius() {
          return e.radius * 1.15;
        },
        get alive() {
          return e.alive;
        },
        onHit: (dmg, pt) => this.hitEnemy(e, dmg, pt),
      } as Target);
    }
    this.playerTargets = [
      {
        pos: this.player.pos,
        radius: playerData.radius * 0.8,
        get alive() {
          return true;
        },
        onHit: (dmg) => this.hitPlayer(dmg),
      } as Target,
    ];
    const self = this;
    Object.defineProperty(this.playerTargets[0], 'alive', { get: () => self.player.alive && self.state !== 'paused' });

    this.px.onResize = (w, h) => {
      this.hud.resize(w, h);
      this.cam.setAspect(window.innerWidth / window.innerHeight);
    };
    this.px.resize();

    const params = new URLSearchParams(location.search);
    if (params.has('debug')) this.hud.debugOn = true;
    this.reset();
    if (params.has('pos')) {
      const [x, y, z] = params.get('pos')!.split(',').map(Number);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (Number(params.get('yaw') ?? 0) * Math.PI) / 180);
      this.player.teleport(new THREE.Vector3(x, y, z), q);
      this.world.preload(x, z, 6);
      this.world.clouds.update(this.player.pos);
      this.cam.snap();
    }
    const m = params.get('cam');
    if (m === 'far' || m === 'free' || m === 'cockpit') {
      while (this.cam.mode !== m) this.cam.cycle();
    }

    this.loop = new GameLoop(
      config.fixedStep,
      (dt) => this.fixedUpdate(dt),
      (a, dt) => this.frame(a, dt),
    );
  }

  start(): void {
    this.loop.start();
  }

  reset(): void {
    this.state = 'play';
    this.kills = 0;
    this.score = 0;
    this.hud.message('');
    this.bullets.clear();
    this.missiles.clear();
    this.lockTime = 0;
    this.missileAmmo = 6;
    this.missileReload = 0;
    this.fx.clear();
    for (const p of this.parachutes) {
      this.scene.remove(p.root);
      p.dispose();
    }
    this.parachutes = [];
    const q = new THREE.Quaternion();
    const sx = config.flight.startX, sz = config.flight.startZ;
    this.player.reset(new THREE.Vector3(sx, config.flight.startAltitude, sz), q);
    this.player.fireCooldown = 0;
    // 最初から前方に敵が見えるよう配置
    this.enemies.forEach((e, i) => {
      const a = (i / this.enemies.length) * Math.PI * 2 + 0.4;
      const r = i < 2 ? 520 + i * 160 : 900 + Math.random() * 700;
      const ang = i < 2 ? -Math.PI / 2 + (i ? 0.45 : -0.4) : a;
      const pos = new THREE.Vector3(sx + Math.cos(ang) * r, 110 + Math.random() * 90, sz + Math.sin(ang) * r);
      e.spawn(pos, new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5));
      e.respawnTimer = 0;
      e.exhaust.setVisible(true);
    });
    this.world.preload(sx, sz, 6);
    this.world.clouds.update(this.player.pos);
    this.cam.snap();
    this.player.syncRender(1);
  }

  // ---------------- 戦闘ロジック ----------------

  private findLock(): EnemyFighter | null {
    let best: EnemyFighter | null = null;
    let bestScore = 0.93;
    const f = this.player.forward(this.tmpA);
    for (const e of this.enemies) {
      if (!e.alive) continue;
      this.tmpB.subVectors(e.pos, this.player.pos);
      const d = this.tmpB.length();
      if (d > 1300 || d < 10) continue;
      const dot = f.dot(this.tmpB.divideScalar(d));
      if (dot > bestScore) {
        bestScore = dot;
        best = e;
      }
    }
    return best;
  }

  private hitEnemy(e: EnemyFighter, dmg: number, pt: THREE.Vector3): void {
    if (!e.alive) return;
    e.hp -= dmg;
    e.hitFlash = 0.15;
    spawnHitSparks(this.fx, pt, e.data.debrisColors);
    if (e.state === 'cruise') e.state = 'chase';
    if (e.hp <= 0) this.destroyEnemy(e);
  }

  private destroyEnemy(e: EnemyFighter): void {
    e.alive = false;
    e.root.visible = false;
    e.respawnTimer = config.combat.respawnDelay;
    spawnExplosion(this.fx, e.pos, e.velocity, 1.25, e.data.debrisColors);
    this.kills++;
    this.score += 100;
    const p = new Parachutist(e.pos.clone().add(new THREE.Vector3(0, 3, 0)), e.velocity, this.mat, this.pilotGeo, this.chuteData);
    this.parachutes.push(p);
    this.scene.add(p.root);
    if (e.pos.distanceTo(this.player.pos) < 250) this.cam.addShake(0.5);
  }

  private detonate(pt: THREE.Vector3, direct: EnemyFighter | null): void {
    spawnExplosion(this.fx, pt, this.tmpB.set(0, 0, 0), 0.8, this.player.data.debrisColors);
    if (direct) this.hitEnemy(direct, 120, pt);
    for (const e of this.enemies) if (e !== direct && e.alive && e.pos.distanceTo(pt) < 45) this.hitEnemy(e, 70, e.pos);
    if (pt.distanceTo(this.player.pos) < 200) this.cam.addShake(0.3);
  }

  private hitPlayer(dmg: number): void {
    if (!this.player.alive || this.player.invuln > 0) return;
    this.player.hp -= dmg;
    this.hud.hitFlash(0.3);
    this.cam.addShake(0.5);
    spawnHitSparks(this.fx, this.player.pos, this.player.data.debrisColors);
    if (this.player.hp <= 0) this.crashPlayer();
  }

  private crashPlayer(): void {
    if (!this.player.alive) return;
    this.player.alive = false;
    this.player.root.visible = false;
    spawnExplosion(this.fx, this.player.pos, this.player.velocity, 1.5, this.player.data.debrisColors);
    this.state = 'dead';
    this.hud.message('DESTROYED<small>PRESS R TO RESTART</small>');
    this.cam.addShake(1);
  }

  private respawnEnemy(e: EnemyFighter): void {
    const a = Math.random() * Math.PI * 2;
    const r = 1100 + Math.random() * 700;
    const base = this.player.alive ? this.player.pos : new THREE.Vector3();
    const pos = new THREE.Vector3(base.x + Math.cos(a) * r, THREE.MathUtils.clamp(base.y + (Math.random() - 0.5) * 120, 100, 300), base.z + Math.sin(a) * r);
    e.spawn(pos, new THREE.Vector3(base.x - pos.x, 0, base.z - pos.z));
    e.exhaust.setVisible(true);
  }

  // ---------------- 更新 ----------------

  private fixedUpdate(dt: number): void {
    if (this.state === 'paused') return;
    const c = this.input.read(config.flight.invertPitch);
    const p = this.player;

    if (p.alive) {
      p.step(dt, c);
      const nl = this.findLock();
      this.lockTime = nl && nl === this.lock ? this.lockTime + dt : 0;
      this.lock = nl;
      this.missileReload += dt;
      if (this.missileAmmo < 6 && this.missileReload > 6) {
        this.missileAmmo++;
        this.missileReload = 0;
      }
      if ((this.input.wasPressed('KeyX') || this.input.padPressed(2)) && this.missileAmmo > 0) {
        this.missileAmmo--;
        this.missileSide ^= 1;
        const tgt = this.lock && this.lockTime >= 1 ? this.lock : null;
        const mp = p.data.guns[this.missileSide].clone().add(new THREE.Vector3(this.missileSide ? 2.5 : -2.5, -1.2, 0)).applyQuaternion(p.quat).add(p.pos);
        this.missiles.fire(mp, p.forward(this.tmpA), p.speed, tgt);
        this.cam.addShake(0.15);
      }
      p.fireCooldown -= dt;
      if (c.fire && p.fireCooldown <= 0) {
        p.fireCooldown = 1 / config.combat.fireRate;
        const dir = p.forward(this.tmpA).clone();
        if (this.lock) {
          const toT = this.tmpB.subVectors(this.lock.pos, p.pos);
          const dist = toT.length();
          const tt = dist / config.combat.bulletSpeed;
          toT.copy(this.lock.pos).addScaledVector(this.lock.velocity, tt).sub(p.pos).normalize();
          if (dir.dot(toT) > 0.97) dir.lerp(toT, config.combat.aimAssist).normalize();
        }
        p.gunSide ^= 1;
        const gun = p.data.guns[p.gunSide].clone().applyQuaternion(p.quat).add(p.pos);
        this.bullets.fire(gun, dir, p.velocity, 0, config.combat.playerDamage);
      }
      // 地面・海面との衝突
      const gh = this.world.groundHeight(p.pos.x, p.pos.z);
      if (p.pos.y < gh + 3) this.crashPlayer();
    }
    this.playerTargets[0].pos.copy(p.pos);

    for (const e of this.enemies) {
      if (e.alive) {
        const attackers = this.enemies.filter((o) => o.alive && o.state === 'attack').length;
        e.step(dt, p, this.world, this.bullets, attackers < 2 || e.state === 'attack');
        const gh = this.world.groundHeight(e.pos.x, e.pos.z);
        if (e.pos.y < gh + 4) this.destroyEnemy(e);
        else if (p.alive && e.pos.distanceTo(p.pos) < e.radius + p.radius * 0.7) {
          // 空中衝突
          this.destroyEnemy(e);
          this.hitPlayer(35);
        }
      } else {
        e.respawnTimer -= dt;
        if (e.respawnTimer <= 0) this.respawnEnemy(e);
      }
    }

    this.bullets.step(dt, this.enemyTargets, this.playerTargets);
    this.missiles.step(dt, this.enemies, this.fx, (x, z) => this.world.groundHeight(x, z), (pt, direct) => this.detonate(pt, direct));

    for (let i = this.parachutes.length - 1; i >= 0; i--) {
      const pc = this.parachutes[i];
      const r = pc.step(dt, this.world.groundHeight(pc.pos.x, pc.pos.z));
      if (r === 'water') spawnSplash(this.fx, pc.pos.x, pc.pos.z);
      if (pc.done) {
        this.scene.remove(pc.root);
        pc.dispose();
        this.parachutes.splice(i, 1);
      }
    }
  }

  private frame(alpha: number, frameDt: number): void {
    const inp = this.input;
    // 入力イベント
    if (inp.wasPressed('KeyR') || inp.padPressed(8)) this.reset();
    if (inp.wasPressed('KeyP') || inp.padPressed(9)) {
      if (this.state === 'play') this.state = 'paused';
      else if (this.state === 'paused') {
        this.state = 'play';
        this.hud.message('');
      }
    }
    if (inp.wasPressed('KeyC') || inp.padPressed(3)) this.cam.cycle();
    if (inp.wasPressed('F3') || inp.wasPressed('Backquote')) this.hud.debugOn = !this.hud.debugOn;
    const dt = this.state === 'paused' ? 0 : frameDt;

    const p = this.player;
    p.syncRender(this.state === 'paused' ? 1 : alpha);
    for (const e of this.enemies) if (e.alive) e.syncRender(this.state === 'paused' ? 1 : alpha);
    this.missiles.render(this.state === 'paused' ? 1 : alpha, config.fixedStep);
    this.bullets.render(this.state === 'paused' ? 1 : alpha, config.fixedStep);

    const f = config.flight;
    const boostK = THREE.MathUtils.clamp((p.speed - f.minSpeed) / (f.maxSpeed + f.boostExtra - f.minSpeed), 0, 1);
    this.cam.update(frameDt * (dt > 0 ? 1 : 0), p, boostK, { dx: inp.mouseDX, dy: inp.mouseDY }, (x, z) => this.world.groundHeight(x, z));
    const cockpit = this.cam.mode === 'cockpit';
    p.root.visible = p.alive && !cockpit;
    p.exhaust.setVisible(p.alive && !cockpit);

    if (dt > 0) {
      if (p.alive && !cockpit) p.exhaust.update(dt, p.root, p.velocity, p.thrust);
      for (const e of this.enemies) if (e.alive) e.exhaust.update(dt, e.root, e.velocity, e.thrust);
      this.contrails.update(dt, p.root, p.alive);
      this.fx.update(dt);
      updateExplosionFlash(dt);
    }
    this.world.update(dt, this.cam.camera.position);
    this.sky.follow(this.cam.camera.position);

    this.hud.update(
      frameDt,
      p,
      this.enemies,
      this.cam.camera,
      this.lock,
      { lockProgress: Math.min(1, this.lockTime / 1), missiles: this.missileAmmo, kills: this.kills, score: this.score, cockpit, dead: this.state === 'dead', paused: this.state === 'paused' },
      {
        calls: this.px.stats.calls,
        tris: this.px.stats.triangles,
        chunks: this.world.chunkCount,
        clouds: this.world.clouds.count,
        particles: this.fx.solid.count + this.fx.smoke.count + this.bullets.count + this.missiles.count,
      },
    );
    this.cam.camera.updateMatrixWorld(true);
    this.px.render(this.scene, this.cam.camera);
    inp.endFrame();
  }
}
