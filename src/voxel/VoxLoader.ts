import { VoxelModel } from './VoxelModel';

/**
 * MagicaVoxel .vox (v150) 読み込み層。ゲーム本体はこのファイルにのみ依存せず、
 * VoxelModel さえ得られれば良い構造になっている（初期版は手続き生成のみ使用）。
 * 先頭モデル1つのみ対応（SIZE / XYZI / RGBA）。MagicaVoxelはZ-up、本ゲームはY-upなので軸を入れ替える。
 */
export function parseVox(buffer: ArrayBuffer): VoxelModel {
  const dv = new DataView(buffer);
  const tag = (o: number) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  if (tag(0) !== 'VOX ') throw new Error('Not a .vox file');
  let off = 8;
  let size: [number, number, number] | null = null;
  let voxels: [number, number, number, number][] | null = null;
  let palette: [number, number, number][] | null = null;
  const parseChunks = (start: number, end: number) => {
    let o = start;
    while (o < end) {
      const id = tag(o);
      const n = dv.getUint32(o + 4, true);
      const m = dv.getUint32(o + 8, true);
      const body = o + 12;
      if (id === 'SIZE' && !size) size = [dv.getUint32(body, true), dv.getUint32(body + 4, true), dv.getUint32(body + 8, true)];
      else if (id === 'XYZI' && !voxels) {
        const cnt = dv.getUint32(body, true);
        voxels = [];
        for (let i = 0; i < cnt; i++) {
          const b = body + 4 + i * 4;
          voxels.push([dv.getUint8(b), dv.getUint8(b + 1), dv.getUint8(b + 2), dv.getUint8(b + 3)]);
        }
      } else if (id === 'RGBA') {
        palette = [[0, 0, 0]];
        for (let i = 0; i < 255; i++) {
          const b = body + i * 4;
          palette.push([dv.getUint8(b) / 255, dv.getUint8(b + 1) / 255, dv.getUint8(b + 2) / 255]);
        }
      } else if (id === 'MAIN') {
        parseChunks(body + n, body + n + m);
      }
      o = body + n + (id === 'MAIN' ? m : 0);
    }
  };
  parseChunks(off, buffer.byteLength);
  if (!size || !voxels) throw new Error('Empty .vox');
  const [sx, sy, sz] = size as [number, number, number];
  // vox(x,y,z) -> game(x, z, -y)
  const model = new VoxelModel(sx, sz, sy);
  for (const [x, y, z, c] of voxels as [number, number, number, number][]) model.set(x, z, sy - 1 - y, c);
  model.pivot = [sx / 2, sz / 2, sy / 2];
  model.customPalette = (palette as [number, number, number][] | null) ?? undefined;
  return model;
}

export async function loadVox(url: string): Promise<VoxelModel> {
  const res = await fetch(url);
  return parseVox(await res.arrayBuffer());
}
