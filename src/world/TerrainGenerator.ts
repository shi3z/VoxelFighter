import * as THREE from 'three';
import { config } from '../config';
import { Noise2D, hash2 } from './Noise';

const C = config.world.cell;
const STEP = config.world.step;
const N = config.world.chunkCells;
const MIN_L = -4; // これより深いセルは生成しない（海底の遠景は深海面）
const NONE = -99;
const SKIRT_Y = config.world.seaFloorY;

function hex(h: number): [number, number, number] {
  return [(h >> 16) & 255, (h >> 8) & 255, h & 255];
}
function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
const pack = (c: [number, number, number]) => ((c[0] | 0) << 16) | ((c[1] | 0) << 8) | (c[2] | 0);

const SEA_COLORS = [hex(0xa8f4ec), hex(0x5fdcea), hex(0x2f9ae6), hex(0x0f4fb0)]; // L=-1..-4
const SAND = [hex(0xf2deaa), hex(0xe6cc90)];
const GRASS_L = [hex(0x8ee04c), hex(0x7bd23d)];
const GRASS_M = [hex(0x55c030), hex(0x47b02a)];
const GRASS_D = [hex(0x2f9a2a), hex(0x268a26)];
const FOREST = [hex(0x1d7a24), hex(0x17691f), hex(0x238a28)];
const ROCK = [hex(0x8a8884), hex(0x74726e), hex(0x9c9a95)];
const ROCK_HI = [hex(0xb4b2ad), hex(0xa09e99)];

/** 地形生成: 高さマップ → 段階量子化 → チャンクメッシュ（地表Greedy行統合 + 段差の垂直面） */
export class TerrainGenerator {
  private nIsland: Noise2D;
  private nIslet: Noise2D;
  private nWarp: Noise2D;
  private nDetail: Noise2D;
  private nForest: Noise2D;
  private nRock: Noise2D;

  constructor(readonly seed: number) {
    this.nIsland = new Noise2D(seed * 3 + 1);
    this.nIslet = new Noise2D(seed * 5 + 2);
    this.nWarp = new Noise2D(seed * 7 + 3);
    this.nDetail = new Noise2D(seed * 11 + 4);
    this.nForest = new Noise2D(seed * 13 + 5);
    this.nRock = new Noise2D(seed * 17 + 6);
  }

  /** ワールド座標での連続高さ（単位: ワールド長）。負なら海底 */
  rawHeight(x: number, z: number): number {
    const wx = x + (this.nWarp.value(x * 0.003, z * 0.003) - 0.5) * 220;
    const wz = z + (this.nWarp.value(x * 0.003 + 40, z * 0.003 + 40) - 0.5) * 220;
    const a = this.nIsland.fbm(wx * 0.0016, wz * 0.0016, 5);
    let h = (a - 0.585) * 250;
    const b = this.nIslet.fbm(x * 0.0058, z * 0.0058, 3);
    h = Math.max(h, (b - 0.675) * 170);
    if (h > -6) h += (this.nDetail.fbm(x * 0.028, z * 0.028, 3) - 0.5) * 9;
    return h;
  }

  /** セル(i,j)のレベル。0以上=陸、負=浅い海底、NONE=生成しない */
  levelAt(i: number, j: number): number {
    const h = this.rawHeight((i + 0.5) * C, (j + 0.5) * C);
    const L = Math.floor(h / STEP);
    return L < MIN_L ? NONE : L;
  }

  topY(L: number): number {
    if (L === NONE) return SKIRT_Y;
    if (L === 0) return 1.0;
    return L * STEP;
  }

  /** 衝突判定用の地表高さ（海面以下は0） */
  groundHeight(x: number, z: number): number {
    const h = this.rawHeight(Math.floor(x / C) * C + C / 2, Math.floor(z / C) * C + C / 2);
    const L = Math.floor(h / STEP);
    return L >= 0 ? this.topY(L) : 0;
  }

  private cellColor(i: number, j: number, L: number): number {
    const x = (i + 0.5) * C;
    const z = (j + 0.5) * C;
    const r = hash2(i, j, this.seed);
    if (L < 0) {
      const c = SEA_COLORS[Math.min(-L, 4) - 1];
      if (L === -1) return pack(r > 0.55 ? hex(0xf2fffa) : c); // 白い波打ち際
      if (L === -2 && r > 0.88) return pack(hex(0xcffbf6));
      return pack(r > 0.8 ? mix(c, [255, 255, 255], 0.18) : c);
    }
    if (L === 0) return pack(SAND[r > 0.5 ? 1 : 0]);
    const forest = this.nForest.fbm(x * 0.011, z * 0.011, 3);
    const rock = this.nRock.fbm(x * 0.008 + 50, z * 0.008, 3);
    if (L >= 15) return pack(ROCK_HI[r > 0.5 ? 1 : 0]);
    if (L >= 12 || (L >= 4 && rock > 0.72)) return pack(ROCK[Math.floor(r * 2.99)]);
    if (L <= 2) return pack(GRASS_L[r > 0.5 ? 1 : 0]);
    if (forest > 0.56) return pack(FOREST[Math.floor(r * 2.99)]);
    if (L >= 8) return pack(GRASS_D[r > 0.5 ? 1 : 0]);
    return pack(GRASS_M[r > 0.5 ? 1 : 0]);
  }

  /** 粗いサンプリングで「完全に深海だけ」のチャンクを早期スキップ */
  chunkEmpty(cx: number, cz: number): boolean {
    const size = N * C;
    let maxH = -1e9;
    for (let a = 0; a <= 8; a++) for (let b = 0; b <= 8; b++) {
      maxH = Math.max(maxH, this.rawHeight(cx * size + (a * size) / 8, cz * size + (b * size) / 8));
    }
    return maxH < MIN_L * STEP - 30;
  }

  buildChunk(cx: number, cz: number): THREE.BufferGeometry | null {
    if (this.chunkEmpty(cx, cz)) return null;
    const B = N + 2;
    const lv = new Int16Array(B * B);
    const cols = new Int32Array(B * B);
    let any = false;
    for (let j = -1; j <= N; j++) {
      for (let i = -1; i <= N; i++) {
        const gi = cx * N + i;
        const gj = cz * N + j;
        const L = this.levelAt(gi, gj);
        lv[(j + 1) * B + (i + 1)] = L;
        if (L !== NONE && i >= 0 && j >= 0 && i < N && j < N) {
          cols[(j + 1) * B + (i + 1)] = this.cellColor(gi, gj, L);
          any = true;
        }
      }
    }
    if (!any) return null;

    const pos: number[] = [];
    const nor: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const quad = (v: number[][], n: number[], rgb: number) => {
      const vi = pos.length / 3;
      const r = ((rgb >> 16) & 255) / 255;
      const g = ((rgb >> 8) & 255) / 255;
      const b = (rgb & 255) / 255;
      for (const p of v) {
        pos.push(p[0], p[1], p[2]);
        nor.push(n[0], n[1], n[2]);
        col.push(r, g, b);
      }
      idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
    };
    const at = (i: number, j: number) => lv[(j + 1) * B + (i + 1)];
    const cAt = (i: number, j: number) => cols[(j + 1) * B + (i + 1)];

    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; ) {
        const L = at(i, j);
        if (L === NONE) {
          i++;
          continue;
        }
        const c = cAt(i, j);
        let k = i + 1;
        while (k < N && at(k, j) === L && cAt(k, j) === c) k++;
        const y = this.topY(L);
        const x0 = i * C, x1 = k * C, z0 = j * C, z1 = (j + 1) * C;
        quad([[x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0]], [0, 1, 0], c);
        i = k;
      }
    }

    // 段差の垂直面
    const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dz] of dirs) {
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const L = at(i, j);
          if (L === NONE) continue;
          const nTop = this.topY(at(i + dx, j + dz));
          const top = this.topY(L);
          if (top <= nTop) continue;
          const c = cAt(i, j);
          const len = 1;
          const rgb = c;
          if (dx === 1) {
            const X = (i + 1) * C, za = j * C, zb = (j + len) * C;
            quad([[X, nTop, za], [X, top, za], [X, top, zb], [X, nTop, zb]], [1, 0, 0], rgb);
          } else if (dx === -1) {
            const X = i * C, za = j * C, zb = (j + len) * C;
            quad([[X, nTop, zb], [X, top, zb], [X, top, za], [X, nTop, za]], [-1, 0, 0], rgb);
          } else if (dz === 1) {
            const Z = (j + 1) * C, xa = i * C, xb = (i + len) * C;
            quad([[xb, nTop, Z], [xb, top, Z], [xa, top, Z], [xa, nTop, Z]], [0, 0, 1], rgb);
          } else {
            const Z = j * C, xa = i * C, xb = (i + len) * C;
            quad([[xa, nTop, Z], [xa, top, Z], [xb, top, Z], [xb, nTop, Z]], [0, 0, -1], rgb);
          }
        }
      }
    }

    if (pos.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }
}
