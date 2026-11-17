import * as THREE from 'three';
import { paletteRGB } from '../voxel/VoxelPalette';
import { FxHub, rgb } from './VoxelParticles';

const FIRE = [rgb(0xfff2a8), rgb(0xffd23a), rgb(0xff8a1c)];
const FIRE_END = [rgb(0xe03a14), rgb(0xa8240f), rgb(0x4a1a14)];
const SPARK = rgb(0xfff6c8);

let flash: THREE.Sprite | null = null;
const flashes: { s: THREE.Sprite; t: number; size: number }[] = [];

export function initExplosionFlash(scene: THREE.Object3D): void {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.4, 'rgba(255,200,90,0.8)');
  gr.addColorStop(1, 'rgba(255,120,20,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  for (let i = 0; i < 6; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    s.visible = false;
    s.renderOrder = 6;
    scene.add(s);
    flashes.push({ s, t: 0, size: 1 });
  }
  flash = flashes[0].s;
}

export function updateExplosionFlash(dt: number): void {
  for (const f of flashes) {
    if (!f.s.visible) continue;
    f.t += dt;
    const k = f.t / 0.35;
    if (k >= 1) {
      f.s.visible = false;
      continue;
    }
    const s = f.size * (0.5 + k * 1.2);
    f.s.scale.set(s, s, 1);
    (f.s.material as THREE.SpriteMaterial).opacity = 1 - k;
  }
  void flash;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** 球状に飛び散るボクセルの爆発。破片は機体の色で重力落下する。 */
export function spawnExplosion(fx: FxHub, p: THREE.Vector3, vel: THREE.Vector3, size: number, debrisColors: number[]): void {
  // 発光フラッシュ
  const f = flashes.find((x) => !x.s.visible);
  if (f) {
    f.s.visible = true;
    f.s.position.copy(p);
    f.t = 0;
    f.size = 26 * size;
  }
  const dir = new THREE.Vector3();
  const rnd3 = () => dir.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
  for (let i = 0; i < 70; i++) {
    rnd3();
    const sp = rand(6, 38) * size;
    const k = Math.floor(Math.random() * 3);
    fx.solid.spawn({
      x: p.x + dir.x * 2 * size, y: p.y + dir.y * 2 * size, z: p.z + dir.z * 2 * size,
      vx: vel.x * 0.5 + dir.x * sp, vy: vel.y * 0.5 + dir.y * sp, vz: vel.z * 0.5 + dir.z * sp,
      life: rand(0.5, 1.2), s0: rand(2, 4.2) * size, s1: 0.4 * size,
      c0: FIRE[k], c1: FIRE_END[k], drag: 1.2,
    });
  }
  for (let i = 0; i < 22; i++) {
    rnd3();
    const sp = rand(3, 16) * size;
    fx.smoke.spawn({
      x: p.x + dir.x * 3 * size, y: p.y + dir.y * 3 * size, z: p.z + dir.z * 3 * size,
      vx: vel.x * 0.4 + dir.x * sp, vy: vel.y * 0.4 + dir.y * sp + 3, vz: vel.z * 0.4 + dir.z * sp,
      life: rand(1.2, 2.4), s0: rand(1.6, 3) * size, s1: rand(3.5, 6) * size,
      c0: rgb(0x30343c), c1: rgb(0x8896a8), drag: 0.8,
    });
  }
  for (let i = 0; i < 55; i++) {
    rnd3();
    const sp = rand(10, 48) * size;
    const [r, g, b] = paletteRGB(debrisColors[Math.floor(Math.random() * debrisColors.length)]);
    fx.solid.spawn({
      x: p.x + dir.x * size, y: p.y + dir.y * size, z: p.z + dir.z * size,
      vx: vel.x * 0.7 + dir.x * sp, vy: vel.y * 0.7 + dir.y * sp + 8, vz: vel.z * 0.7 + dir.z * sp,
      life: rand(1.8, 3.2), s0: rand(0.7, 1.7) * size, s1: rand(0.5, 1.1) * size,
      c0: [r, g, b], c1: [r * 0.7, g * 0.7, b * 0.7], gravity: 38, drag: 0.15,
    });
  }
  for (let i = 0; i < 30; i++) {
    rnd3();
    const sp = rand(25, 80) * size;
    fx.solid.spawn({
      x: p.x, y: p.y, z: p.z,
      vx: dir.x * sp + vel.x * 0.5, vy: dir.y * sp + vel.y * 0.5, vz: dir.z * sp + vel.z * 0.5,
      life: rand(0.3, 0.8), s0: 0.45, s1: 0.1, c0: SPARK, c1: FIRE[2], gravity: 20, drag: 0.3,
    });
  }
}

/** 被弾時の小さな火花と破片 */
export function spawnHitSparks(fx: FxHub, p: THREE.Vector3, debrisColors: number[]): void {
  const dir = new THREE.Vector3();
  for (let i = 0; i < 12; i++) {
    dir.set(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize();
    const sp = rand(10, 36);
    const useDebris = i % 3 === 0;
    const c = useDebris ? paletteRGB(debrisColors[Math.floor(Math.random() * debrisColors.length)]) : SPARK;
    fx.solid.spawn({
      x: p.x, y: p.y, z: p.z, vx: dir.x * sp, vy: dir.y * sp, vz: dir.z * sp,
      life: rand(0.25, 0.7), s0: useDebris ? 0.8 : 0.5, s1: 0.15,
      c0: c as [number, number, number], c1: FIRE[2], gravity: useDebris ? 30 : 10, drag: 0.5,
    });
  }
}

/** 水しぶき（パラシュート着水など） */
export function spawnSplash(fx: FxHub, x: number, z: number): void {
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = rand(3, 12);
    fx.solid.spawn({
      x, y: 0.5, z, vx: Math.cos(a) * sp, vy: rand(6, 20), vz: Math.sin(a) * sp,
      life: rand(0.6, 1.2), s0: rand(0.7, 1.4), s1: 0.3, c0: rgb(0xffffff), c1: rgb(0x6cc0f0), gravity: 34,
    });
  }
}
