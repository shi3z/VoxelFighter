import * as THREE from 'three';
import { VoxelBuilder, VoxelModel } from '../voxel/VoxelModel';
import { meshVoxelModel } from '../voxel/VoxelMesher';
import { P } from '../voxel/VoxelPalette';
import { hash2 } from '../world/Noise';

export interface FighterStyle {
  body: number[]; // 機体の装甲色（ランダムに混ぜる）
  stripe: number; // 背面の明るい帯
  belly: number;
  tip: number; // 翼端・垂直尾翼上部
  tipDark: number;
  canopy: number[];
  length: number;
  span: number;
  sweep: number;
  twinFins: boolean;
}

export const PLAYER_STYLE: FighterStyle = {
  body: [P.DG1, P.DG2, P.DG2, P.DG1, P.GREY],
  stripe: P.LGREY,
  belly: P.BLACK,
  tip: P.ORANGE,
  tipDark: P.ORANGE_D,
  canopy: [P.TEAL, P.TEAL_D, P.TEAL_L],
  length: 36,
  span: 15,
  sweep: 1.3,
  twinFins: true,
};

export const ENEMY_STYLE: FighterStyle = {
  body: [P.E_DARK, P.E_MID, P.E_DARK, P.E_MID, P.E_LIGHT],
  stripe: P.E_LIGHT,
  belly: P.E_DARK,
  tip: P.E_ACCENT,
  tipDark: P.RED,
  canopy: [P.E_GLASS, P.RED, P.E_GLASS],
  length: 32,
  span: 13,
  sweep: 0.9,
  twinFins: false,
};

export interface FighterModelData {
  model: VoxelModel;
  geometry: THREE.BufferGeometry;
  voxelSize: number;
  /** メッシュローカル座標（ワールド単位）。機首は -Z */
  nozzles: THREE.Vector3[];
  wingtips: THREE.Vector3[];
  guns: THREE.Vector3[];
  radius: number;
  debrisColors: number[];
}

const lerpArr = (pts: [number, number][], t: number): number => {
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i][0]) {
      const k = (t - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]);
      return pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k;
    }
  }
  return pts[pts.length - 1][1];
};

/**
 * 戦闘機をボクセルとして手続き生成する。t = 機尾からの距離(ボクセル)、z = -t（機首が -Z）。
 * 流線型胴体 / 左右対称の後退翼 / 翼端パーツ / 垂直尾翼 / キャノピー / 双発エンジンノズル。
 */
export function buildFighter(style: FighterStyle, voxelSize: number, seed: number): FighterModelData {
  const b = new VoxelBuilder();
  const L = style.length;
  const rnd = (x: number, y: number, z: number, k = 0) => hash2(x * 3 + k, y * 5 + z * 7, seed);
  const bodyCol = (x: number, y: number, z: number, k = 0) => style.body[Math.floor(rnd(x, y, z, k) * style.body.length) % style.body.length];

  // --- 胴体: 断面が楕円で変化する流線型 ---
  const rxProf: [number, number][] = [[0, 2.6], [8, 3.4], [16, 3.5], [24, 2.6], [L - 6, 1.5], [L - 1, 0.6]];
  const ryProf: [number, number][] = [[0, 2.0], [10, 2.8], [18, 2.9], [26, 2.0], [L - 5, 1.1], [L - 1, 0.5]];
  for (let t = 0; t < L; t++) {
    const rx = lerpArr(rxProf, t);
    const ry = lerpArr(ryProf, t);
    const yc = t > L - 12 ? -(t - (L - 12)) * 0.09 : 0;
    for (let x = -4; x <= 4; x++) {
      for (let y = -4; y <= 4; y++) {
        const e = (x / rx) ** 2 + ((y - yc) / ry) ** 2;
        if (e > 1.0) continue;
        let c = bodyCol(x, y, t);
        if (y - yc < -ry * 0.45) c = style.belly;
        else if (y - yc > ry * 0.45 && Math.abs(x) <= 1 && t > 7 && t < L - 9) c = style.stripe;
        else if (t % 7 === 3 && rnd(x, y, t, 4) > 0.5) c = style.belly;
        b.set(x, y, -t, c);
      }
    }
  }

  // --- 双発ナセル（機尾）と排気ノズル ---
  const nozzleX = style.twinFins ? 3 : 2.4;
  const nozzles: [number, number, number][] = [];
  for (const sx of [-1, 1]) {
    const cx = sx * nozzleX;
    for (let t = 0; t < 14; t++) {
      const r = t < 10 ? 2.15 : 2.15 - (t - 9) * 0.4;
      for (let x = -3; x <= 3; x++)
        for (let y = -3; y <= 3; y++) {
          const d = Math.hypot(x, y + 0.2);
          if (d > r) continue;
          let c = bodyCol(cx + x, y, t, 9);
          if (t === 0) c = d > 1.2 ? P.ORANGE_D : P.BLACK;
          else if (t === 1 && d > 1.5) c = style.tipDark;
          b.set(Math.round(cx + x), y, -t, c);
        }
    }
    nozzles.push([cx, -0.2, -0.8]);
  }

  // --- 主翼（後退翼）: 翼端は上反角でオレンジ ---
  const half = style.span;
  for (const sx of [-1, 1]) {
    for (let w = 3; w <= half; w++) {
      const lead = 24 - (w - 3) * style.sweep;
      const trail = 2 + (w - 3) * 0.3;
      const dihedral = w > 9 ? Math.floor((w - 9) * 0.35) : 0;
      for (let t = Math.round(trail); t <= Math.round(lead); t++) {
        const tipZone = w >= half - 2;
        let c = tipZone ? (t % 2 ? style.tip : style.tipDark) : bodyCol(w * sx, 0, t, 2);
        if (!tipZone && (t === Math.round(trail) || w % 5 === 0)) c = style.belly;
        b.set(sx * w, -1 + dihedral, -t, c);
        if (w <= 8) b.set(sx * w, -2 + dihedral, -t, w < 6 ? style.belly : bodyCol(w, -1, t, 3));
        if (tipZone && t > Math.round(lead) - 4) b.set(sx * w, dihedral, -t, style.tip);
      }
    }
  }
  // 翼端の小フィン（上向き）
  for (const sx of [-1, 1]) {
    const w = half;
    const dh = Math.floor((w - 9) * 0.35);
    for (let k = 1; k <= 4; k++) for (let t = 5 + k; t <= 11 - Math.floor(k / 2); t++) b.set(sx * w, -1 + dh + k, -t, k >= 3 ? style.tip : style.tipDark);
  }

  // --- 垂直尾翼 ---
  const finXs = style.twinFins ? [-5, 5] : [0];
  for (const fx of finXs) {
    const sgn = Math.sign(fx) || 1;
    for (let h = 0; h < 9; h++) {
      const t0 = 1 + Math.floor(h * 0.5);
      const t1 = 10 - Math.floor(h * 0.75);
      const lean = style.twinFins ? Math.floor(h * 0.3) * sgn : 0;
      for (let t = t0; t <= t1; t++) {
        const c = h >= 6 ? style.tip : h >= 5 ? style.tipDark : bodyCol(fx, h, t, 6);
        const baseY = style.twinFins ? 1 : 2;
        b.set(fx + lean, baseY + h, -t, c);
        if (style.twinFins) b.set(fx + lean - sgn, baseY + h, -t, c === style.tip ? style.tipDark : bodyCol(fx, h, t, 7));
      }
    }
  }

  // --- キャノピー ---
  const cz = L * 0.58;
  for (let t = Math.floor(cz - 6); t <= cz + 6; t++)
    for (let x = -3; x <= 3; x++)
      for (let y = 0; y <= 5; y++) {
        const e = (x / 2.3) ** 2 + ((y - 1.4) / 2.7) ** 2 + ((t - cz) / 5.8) ** 2;
        if (e > 1) continue;
        if (y < 1 && Math.abs(x) > 1) continue;
        const k = y >= 3 ? 2 : (x + t) % 2 === 0 ? 0 : 1;
        b.set(x, y + 1, -t, style.canopy[Math.min(k, style.canopy.length - 1)]);
      }

  // --- 機首プローブ ---
  for (let t = L; t < L + 3; t++) b.set(0, 0, -t, t === L + 2 ? P.ORANGE : P.GREY);

  const model = b.build([0, 0, -L / 2]);
  const geometry = meshVoxelModel(model, voxelSize);
  const dh = Math.floor((half - 9) * 0.35);
  const shift = L / 2; // pivot はz中心
  const loc = (x: number, y: number, tz: number) => new THREE.Vector3(x * voxelSize, y * voxelSize, (-tz + shift) * voxelSize);
  const wingtips = [loc(-half, -1 + dh + 2, 8), loc(half, -1 + dh + 2, 8)];
  return {
    model,
    geometry,
    voxelSize,
    nozzles: nozzles.map((n) => loc(n[0], n[1], n[2])),
    wingtips,
    guns: [loc(-6, -1, L * 0.55), loc(6, -1, L * 0.55)],
    radius: (L + 4) * 0.5 * voxelSize,
    debrisColors: [...style.body, style.tip, style.tipDark, style.belly, style.canopy[0]],
  };
}
