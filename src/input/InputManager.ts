export interface Controls {
  pitch: number; // +1 = 機首上げ
  yaw: number; // +1 = 右旋回
  roll: number; // +1 = 右ロール
  throttleDelta: number; // -1..1
  boost: boolean;
  fire: boolean;
}

/** キーボード・マウス・ゲームパッド入力を統合する */
export class InputManager {
  private down = new Set<string>();
  private pressed = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  private dragging = false;
  private padPrev: boolean[] = [];
  gamepadActive = false;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
    window.addEventListener('mousedown', () => (this.dragging = true));
    window.addEventListener('mouseup', () => (this.dragging = false));
    window.addEventListener('mousemove', (e) => {
      if (this.dragging) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }
  /** このフレームで押されたか（消費する） */
  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }
  endFrame(): void {
    this.pressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
  }

  /** ゲームパッドのボタンの立ち上がり */
  padPressed(i: number): boolean {
    const pads = navigator.getGamepads?.() ?? [];
    for (const p of pads) {
      if (!p) continue;
      const now = !!p.buttons[i]?.pressed;
      const prev = this.padPrev[i] ?? false;
      this.padPrev[i] = now;
      return now && !prev;
    }
    return false;
  }

  read(invertPitch: boolean): Controls {
    const k = (c: string) => (this.down.has(c) ? 1 : 0);
    let pitch = k('ArrowUp') - k('ArrowDown');
    if (invertPitch) pitch = -pitch; // カーソルキーのみ反転
    let yaw = k('ArrowRight') - k('ArrowLeft');
    let roll = k('KeyD') - k('KeyA');
    let throttleDelta = k('KeyW') - k('KeyS');
    let boost = this.down.has('ShiftLeft') || this.down.has('ShiftRight');
    let fire = this.down.has('Space');

    const pads = navigator.getGamepads?.() ?? [];
    for (const p of pads) {
      if (!p) continue;
      const dz = (v: number) => (Math.abs(v) < 0.14 ? 0 : v);
      const lx = dz(p.axes[0] ?? 0), ly = dz(p.axes[1] ?? 0), rx = dz(p.axes[2] ?? 0);
      if (lx || ly || rx || p.buttons.some((b) => b.pressed)) this.gamepadActive = true;
      pitch += -ly;
      yaw += lx;
      roll += rx;
      if (p.buttons[12]?.pressed) throttleDelta += 1;
      if (p.buttons[13]?.pressed) throttleDelta -= 1;
      if (p.buttons[4]?.pressed) roll -= 1;
      if (p.buttons[5]?.pressed) roll += 1;
      if (p.buttons[7]?.pressed || p.buttons[0]?.pressed) fire = true;
      if (p.buttons[6]?.pressed || p.buttons[1]?.pressed) boost = true;
      break;
    }
    const c = (v: number) => Math.max(-1, Math.min(1, v));
    return { pitch: c(pitch), yaw: c(yaw), roll: c(roll), throttleDelta: c(throttleDelta), boost, fire };
  }
}
