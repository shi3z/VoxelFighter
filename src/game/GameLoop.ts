/** 固定タイムステップの物理更新 + requestAnimationFrame描画（補間用alphaを渡す） */
export class GameLoop {
  private acc = 0;
  private last = 0;
  private raf = 0;
  running = false;

  constructor(
    private step: number,
    private update: (dt: number) => void,
    private render: (alpha: number, frameDt: number) => void,
  ) {}

  start(): void {
    this.running = true;
    this.last = performance.now();
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick);
      const frameDt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.acc += frameDt;
      let n = 0;
      while (this.acc >= this.step && n < 6) {
        this.update(this.step);
        this.acc -= this.step;
        n++;
      }
      if (n === 6) this.acc = 0;
      this.render(this.acc / this.step, frameDt);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.running = false;
  }
}
