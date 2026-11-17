import * as THREE from 'three';
import { Fighter } from '../entities/Fighter';
import { EnemyFighter } from '../entities/EnemyFighter';

const $ = (id: string) => document.getElementById(id)!;

/** 控えめなHUD: 低解像度オーバーレイcanvas(照準・方位矢印・コックピット) + DOMテキスト */
export class HUD {
  private cv = $('overlay') as HTMLCanvasElement;
  private ctx = this.cv.getContext('2d')!;
  private el = {
    spd: $('spd'), alt: $('alt'), kills: $('kills'), score: $('score'),
    hp: $('hpbar').firstElementChild as HTMLElement,
    th: $('thbar').firstElementChild as HTMLElement,
    bs: $('bsbar').firstElementChild as HTMLElement,
    msg: $('msg'), msl: $('msl'), lk: $('lk'), dbg: $('dbg'), flash: $('flash'), help: $('help'),
  };
  private v = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  debugOn = false;
  private flash = 0;
  private fps = 60;
  private acc = 0;
  private frames = 0;
  private helpT = 12;
  private blink = 0;

  resize(w: number, h: number): void {
    this.cv.width = w;
    this.cv.height = h;
  }

  hitFlash(a = 0.35): void {
    this.flash = Math.max(this.flash, a);
  }

  message(html: string): void {
    this.el.msg.innerHTML = html;
  }

  private px(x: number, y: number, c: string, w = 1, h = 1): void {
    this.ctx.fillStyle = c;
    this.ctx.fillRect(x | 0, y | 0, w, h);
  }

  private circle(cx: number, cy: number, r: number, c: string): void {
    cx = Math.round(cx);
    cy = Math.round(cy);
    let x = r, y = 0, err = 0;
    this.ctx.fillStyle = c;
    const plot = (a: number, b: number) => this.ctx.fillRect(cx + a, cy + b, 1, 1);
    while (x >= y) {
      plot(x, y); plot(y, x); plot(-y, x); plot(-x, y); plot(-x, -y); plot(-y, -x); plot(y, -x); plot(x, -y);
      y++;
      err += 1 + 2 * y;
      if (2 * (err - x) + 1 > 0) {
        x--;
        err += 1 - 2 * x;
      }
    }
  }

  private line(x0: number, y0: number, x1: number, y1: number, c: string): void {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let e = dx + dy;
    this.ctx.fillStyle = c;
    for (let i = 0; i < 400; i++) {
      this.ctx.fillRect(x0, y0, 1, 1);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * e;
      if (e2 >= dy) { e += dy; x0 += sx; }
      if (e2 <= dx) { e += dx; y0 += sy; }
    }
  }

  private project(p: THREE.Vector3, cam: THREE.PerspectiveCamera, out: THREE.Vector3): boolean {
    out.copy(p).project(cam);
    out.x = (out.x * 0.5 + 0.5) * this.cv.width;
    out.y = (-out.y * 0.5 + 0.5) * this.cv.height;
    return out.z < 1;
  }

  update(
    dt: number,
    player: Fighter,
    enemies: EnemyFighter[],
    cam: THREE.PerspectiveCamera,
    lock: EnemyFighter | null,
    opts: { lockProgress: number; missiles: number; kills: number; score: number; cockpit: boolean; dead: boolean; paused: boolean },
    dbg: { calls: number; tris: number; chunks: number; clouds: number; particles: number },
  ): void {
    const W = this.cv.width, H = this.cv.height;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);

    // DOM
    this.el.spd.textContent = String(Math.round(player.speed * 3.6)).padStart(3, '0');
    this.el.alt.textContent = String(Math.max(0, Math.round(player.pos.y))).padStart(3, '0');
    this.el.kills.textContent = String(opts.kills);
    this.el.score.textContent = String(opts.score).padStart(6, '0');
    this.el.hp.style.width = `${Math.max(0, (player.hp / player.maxHp) * 100)}%`;
    this.el.hp.style.background = player.hp / player.maxHp < 0.3 ? '#ff5a4a' : '#7dff6a';
    this.el.th.style.width = `${player.throttle * 100}%`;
    this.el.bs.style.width = `${player.boostEnergy * 100}%`;
    this.flash = Math.max(0, this.flash - dt * 1.6);
    this.el.flash.style.opacity = String(this.flash);
    this.el.msl.textContent = '▮'.repeat(opts.missiles) + '▯'.repeat(6 - opts.missiles);
    const locked = lock !== null && opts.lockProgress >= 1;
    this.el.lk.textContent = lock && !opts.dead ? (locked ? 'MISSILE LOCK  [X]' : 'LOCKING…') : '';
    this.el.lk.style.color = locked ? '#ff5a4a' : '#ffd54a';
    this.blink += dt;
    this.helpT -= dt;
    this.el.help.style.opacity = this.helpT > 0 ? '0.8' : '0';

    if (!opts.dead) {
      // 照準: 機体の前方
      this.v.copy(player.forward()).multiplyScalar(300).add(player.root.position);
      if (this.project(this.v, cam, this.v2)) {
        const x = this.v2.x, y = this.v2.y;
        this.circle(x, y, 13, '#ffd54a');
        this.circle(x, y, 12, '#ffd54a');
        this.px(x - 1, y, '#ffd54a', 3, 1);
        this.px(x, y - 1, '#ffd54a', 1, 3);
        for (const [dx, dy] of [[-18, 0], [16, 0], [0, -18], [0, 16]]) this.px(x + dx, y + dy, '#ffd54a', dx ? 3 : 1, dx ? 1 : 3);
      }
      // ロックオン + 画面外の敵の方向矢印
      for (const e of enemies) {
        if (!e.alive) continue;
        const front = this.project(e.root.position, cam, this.v2);
        const onScreen = front && this.v2.x > 8 && this.v2.x < W - 8 && this.v2.y > 8 && this.v2.y < H - 8;
        if (onScreen) {
          if (e === lock) {
            const r0 = Math.max(9, Math.min(26, 3000 / Math.max(80, e.root.position.distanceTo(cam.position)) * 0.9));
            const prog = opts.lockProgress;
            const col = prog >= 1 ? '#ff3a3a' : '#ffd54a';
            const r = Math.round(r0 + (1 - prog) * 14);
            if (prog >= 1 && Math.floor(this.blink * 8) % 2 === 0) this.circle(this.v2.x, this.v2.y, Math.round(r0) + 3, col);
            this.circle(this.v2.x, this.v2.y, r, col);
            const s = r + 4;
            for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
              this.px(this.v2.x + sx * s - (sx > 0 ? 3 : 0), this.v2.y + sy * s, col, 4, 1);
              this.px(this.v2.x + sx * s, this.v2.y + sy * s - (sy > 0 ? 3 : 0), col, 1, 4);
            }
          }
        } else {
          // 画面端の矢印
          this.v.copy(e.root.position).applyMatrix4(cam.matrixWorldInverse);
          let ax = this.v.x, ay = -this.v.y;
          if (this.v.z > 0) { ax = -ax; ay = -ay; }
          const len = Math.hypot(ax, ay) || 1;
          ax /= len; ay /= len;
          const cx = W / 2 + ax * (W / 2 - 14) * 0.98, cy = H / 2 + ay * (H / 2 - 14) * 0.98;
          const px = Math.max(10, Math.min(W - 10, cx)), py = Math.max(10, Math.min(H - 10, cy));
          this.line(px, py, px - ax * 7 - ay * 4, py - ay * 7 + ax * 4, '#ff5a4a');
          this.line(px, py, px - ax * 7 + ay * 4, py - ay * 7 - ax * 4, '#ff5a4a');
        }
      }
    }

    if (opts.cockpit && !opts.dead) this.cockpit(player, W, H);

    // デバッグ
    this.acc += dt;
    this.frames++;
    if (this.acc >= 0.5) {
      this.fps = this.frames / this.acc;
      this.acc = 0;
      this.frames = 0;
    }
    this.el.dbg.style.display = this.debugOn ? 'block' : 'none';
    if (this.debugOn) {
      const p = player.pos;
      this.el.dbg.textContent =
        `FPS ${this.fps.toFixed(0)}  render ${W}x${H}\n` +
        `Draw calls ${dbg.calls}  Tris ${(dbg.tris / 1000).toFixed(1)}k\n` +
        `Pos ${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)}\n` +
        `Speed ${player.speed.toFixed(1)} u/s  thr ${player.throttle.toFixed(2)}\n` +
        `Chunks ${dbg.chunks}  Clouds ${dbg.clouds}  Particles ${dbg.particles}`;
    }
    if (opts.paused) this.message('PAUSED<small>P to resume</small>');
  }

  /** コックピット視点の簡易ピクセルアート計器 */
  private cockpit(player: Fighter, W: number, H: number): void {
    const { pitch, roll } = player.attitude();
    const top = Math.round(H * 0.68);
    // パネル
    this.ctx.fillStyle = '#272a30';
    this.ctx.beginPath();
    this.ctx.moveTo(0, top + 6); this.ctx.lineTo(W * 0.2, top + 6); this.ctx.lineTo(W * 0.27, top - 4);
    this.ctx.lineTo(W * 0.73, top - 4); this.ctx.lineTo(W * 0.8, top + 6); this.ctx.lineTo(W, top + 6);
    this.ctx.lineTo(W, H); this.ctx.lineTo(0, H); this.ctx.closePath();
    this.ctx.fill();
    this.px(0, top + 6, '#4a4f58', W * 0.2, 1);
    this.px(W * 0.27, top - 4, '#4a4f58', W * 0.46, 1);
    this.px(W * 0.8, top + 6, '#4a4f58', W * 0.2, 1);
    this.px(0, top + 14, '#16181c', W, 2);
    // 警告灯
    for (let i = 0; i < 5; i++) this.px(W / 2 - 40 + i * 17, top + 4, i < 3 ? '#f07a28' : '#8a3a14', 14, 5);
    // 姿勢指示器
    const cx = Math.round(W / 2), cy = Math.round(top + (H - top) * 0.55);
    const R = Math.round((H - top) * 0.36);
    this.circle(cx, cy, R + 4, '#9aa0aa');
    this.circle(cx, cy, R + 3, '#5a606a');
    const cr = Math.cos(roll), sr = Math.sin(roll);
    for (let y = -R; y <= R; y++)
      for (let x = -R; x <= R; x++) {
        if (x * x + y * y > R * R) continue;
        const yy = -x * sr + y * cr; // 水平線に対する位置
        const hor = pitch * R * 1.6;
        const sky = yy < hor;
        const shade = Math.floor(Math.abs(yy - hor) / 14) % 2;
        this.px(cx + x, cy + y, sky ? (shade ? '#4f98e0' : '#6aaef0') : shade ? '#8a5a2a' : '#7a4a20');
        if (Math.abs(yy - hor) < 0.6) this.px(cx + x, cy + y, '#ffffff');
      }
    this.px(cx - 14, cy, '#ffc83a', 10, 1);
    this.px(cx + 5, cy, '#ffc83a', 10, 1);
    this.px(cx, cy - 1, '#ffc83a', 1, 3);
    // 左右のゲージ
    for (const gx of [cx - R * 2.1, cx + R * 2.1]) {
      this.circle(gx, cy, Math.round(R * 0.62), '#aab0ba');
      const a = (gx < cx ? player.speed / 190 : player.throttle) * Math.PI * 1.5 + Math.PI * 0.75;
      this.line(gx, cy, gx + Math.cos(a) * R * 0.5, cy + Math.sin(a) * R * 0.5, '#ff7a30');
    }
    // 緑のHUD
    const G = '#5dff8a';
    const hx = Math.round(W / 2), hy = Math.round(H * 0.38);
    for (let k = -2; k <= 2; k++) {
      const yy = k * 18 + pitch * 90;
      const px0 = hx - 40 * cr + yy * sr * 0, py0 = hy + yy * cr;
      if (Math.abs(yy) > 80) continue;
      this.line(hx - 30, py0 - 0, hx - 12, py0 + 0, G);
      this.line(hx + 12, py0, hx + 30, py0, G);
      void px0;
    }
    this.line(hx - 8, hy + 20, hx, hy + 14, G);
    this.line(hx + 8, hy + 20, hx, hy + 14, G);
  }
}
