import * as THREE from 'three';
import { FxHub, rgb } from './VoxelParticles';

const YELLOW = rgb(0xfff0a0);
const YELLOW2 = rgb(0xffd23a);
const ORANGE = rgb(0xff8a1c);
const RED = rgb(0xd8281a);
const DARKRED = rgb(0x6a1410);
const SMOKE0 = rgb(0x2c3138);
const SMOKE1 = rgb(0x5a6a80);

let glowTex: THREE.Texture | null = null;
function getGlow(): THREE.Texture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,220,1)');
  gr.addColorStop(0.3, 'rgba(255,190,60,0.7)');
  gr.addColorStop(1, 'rgba(255,90,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

/**
 * エンジン噴射炎。立方体パーティクルで構成（黄色の芯・オレンジの外周・赤い先端）。
 * 推力に応じて噴射量・初速・長さが変化する。発光感の補助としてのみ加算グローを併用。
 */
export class Exhaust {
  private acc: number[];
  private smokeAcc = 0;
  private glows: THREE.Sprite[] = [];
  private tmp = new THREE.Vector3();
  private dir = new THREE.Vector3();

  constructor(
    private fx: FxHub,
    private nozzles: THREE.Vector3[],
    private scale: number,
    parent: THREE.Object3D,
  ) {
    this.acc = nozzles.map(() => 0);
    for (const n of nozzles) {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: getGlow(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, opacity: 0.85 }),
      );
      s.position.copy(n);
      s.renderOrder = 5;
      parent.add(s);
      this.glows.push(s);
    }
  }

  setVisible(v: boolean): void {
    for (const g of this.glows) g.visible = v;
  }

  /** @param thrust 0..1(+boost 最大1.4程度) */
  update(dt: number, root: THREE.Object3D, velocity: THREE.Vector3, thrust: number): void {
    this.dir.set(0, 0, 1).applyQuaternion(root.quaternion); // 後方
    const k = this.scale;
    const rate = (55 + 150 * thrust) * (0.6 + 0.4 * k);
    for (let i = 0; i < this.nozzles.length; i++) {
      this.tmp.copy(this.nozzles[i]).applyMatrix4(root.matrixWorld);
      this.acc[i] += rate * dt;
      const flick = 0.85 + Math.random() * 0.3;
      const glow = this.glows[i];
      const gs = (4.2 + 4.5 * thrust) * k * flick;
      glow.scale.set(gs, gs, 1);
      (glow.material as THREE.SpriteMaterial).opacity = 0.55 + 0.35 * Math.min(thrust, 1);
      while (this.acc[i] >= 1) {
        this.acc[i] -= 1;
        const r = Math.random();
        const core = r < 0.4;
        const jet = (22 + 34 * thrust) * (0.7 + Math.random() * 0.6);
        const spread = (core ? 0.8 : 2.4) * (0.6 + thrust * 0.4);
        const life = (core ? 0.13 : 0.2) * (0.7 + thrust * 0.6) * (0.75 + Math.random() * 0.5);
        const s = (core ? 0.9 : 1.05) * k * (0.8 + Math.random() * 0.5);
        const back = jet * 0.42;
        this.fx.solid.spawn({
          x: this.tmp.x + (Math.random() - 0.5) * 0.5 * k,
          y: this.tmp.y + (Math.random() - 0.5) * 0.5 * k,
          z: this.tmp.z + (Math.random() - 0.5) * 0.5 * k,
          vx: velocity.x * 0.88 + this.dir.x * back + (Math.random() - 0.5) * spread,
          vy: velocity.y * 0.88 + this.dir.y * back + (Math.random() - 0.5) * spread,
          vz: velocity.z * 0.88 + this.dir.z * back + (Math.random() - 0.5) * spread,
          life,
          s0: s,
          s1: s * (core ? 0.45 : 0.3),
          c0: core ? YELLOW : YELLOW2,
          c1: core ? ORANGE : r < 0.75 ? RED : DARKRED,
        });
      }
    }
    // 煙（半透明の濃灰）
    this.smokeAcc += (3.5 + 3 * thrust) * dt * k;
    while (this.smokeAcc >= 1) {
      this.smokeAcc -= 1;
      const i = Math.floor(Math.random() * this.nozzles.length);
      this.tmp.copy(this.nozzles[i]).applyMatrix4(root.matrixWorld);
      this.fx.smoke.spawn({
        x: this.tmp.x, y: this.tmp.y, z: this.tmp.z,
        vx: velocity.x * 0.97 + (Math.random() - 0.5) * 2, vy: velocity.y * 0.97 + Math.random() * 1.5, vz: velocity.z * 0.97 + (Math.random() - 0.5) * 2,
        life: 1.2 + Math.random() * 0.8,
        s0: 0.8 * k, s1: 3.4 * k,
        c0: SMOKE0, c1: SMOKE1,
        drag: 0.3,
      });
    }
  }
}
