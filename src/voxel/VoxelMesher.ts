import * as THREE from 'three';
import { VoxelModel } from './VoxelModel';
import { paletteRGB } from './VoxelPalette';

/**
 * 面方向ごとのGreedy Meshing。内部の隠れ面は生成しない（隣接ボクセルがあれば面を作らない）。
 * 同一色・同一方向の隣接面は矩形に統合する。1モデル=1ジオメトリ=1ドローコール。
 */
export function meshVoxelModel(model: VoxelModel, voxelSize: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const dims = [model.sx, model.sy, model.sz];
  const [px, py, pz] = model.pivot;
  const pal = model.customPalette;
  const rgb = (c: number): [number, number, number] => (pal ? (pal[c] ?? [1, 0, 1]) : paletteRGB(c));

  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3;
    const v = (d + 2) % 3;
    const x = [0, 0, 0];
    const q = [0, 0, 0];
    q[d] = 1;
    const mask = new Int16Array(dims[u] * dims[v]);
    for (const side of [1, -1]) {
      for (x[d] = 0; x[d] < dims[d]; x[d]++) {
        let n = 0;
        for (x[v] = 0; x[v] < dims[v]; x[v]++) {
          for (x[u] = 0; x[u] < dims[u]; x[u]++) {
            const a = model.get(x[0], x[1], x[2]);
            const b = model.get(x[0] + side * q[0], x[1] + side * q[1], x[2] + side * q[2]);
            mask[n++] = a !== 0 && b === 0 ? a : 0;
          }
        }
        n = 0;
        for (let j = 0; j < dims[v]; j++) {
          for (let i = 0; i < dims[u]; ) {
            const c = mask[n];
            if (c === 0) {
              i++;
              n++;
              continue;
            }
            let w = 1;
            while (i + w < dims[u] && mask[n + w] === c) w++;
            let h = 1;
            outer: while (j + h < dims[v]) {
              for (let k = 0; k < w; k++) if (mask[n + k + h * dims[u]] !== c) break outer;
              h++;
            }
            const base = [0, 0, 0];
            base[d] = x[d] + (side > 0 ? 1 : 0);
            base[u] = i;
            base[v] = j;
            const du = [0, 0, 0];
            du[u] = w;
            const dv = [0, 0, 0];
            dv[v] = h;
            const p0 = base;
            const p1 = [base[0] + du[0], base[1] + du[1], base[2] + du[2]];
            const p2 = [p1[0] + dv[0], p1[1] + dv[1], p1[2] + dv[2]];
            const p3 = [base[0] + dv[0], base[1] + dv[1], base[2] + dv[2]];
            const quad = side > 0 ? [p0, p1, p2, p3] : [p0, p3, p2, p1];
            const vi = pos.length / 3;
            const [r, g, bl] = rgb(c);
            for (const p of quad) {
              pos.push((p[0] - px) * voxelSize, (p[1] - py) * voxelSize, (p[2] - pz) * voxelSize);
              nor.push(side * q[0], side * q[1], side * q[2]);
              col.push(r, g, bl);
            }
            idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
            for (let hh = 0; hh < h; hh++) for (let k = 0; k < w; k++) mask[n + k + hh * dims[u]] = 0;
            i += w;
            n += w;
          }
        }
      }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}
