/** 整数座標(x,y,z)と色インデックスを持つ密なボクセルグリッド。 */
export class VoxelModel {
  readonly data: Uint8Array;
  /** 回転・原点とするボクセル座標（グリッド内） */
  pivot: [number, number, number] = [0, 0, 0];
  /** 任意のカスタムRGBパレット（未指定ならVoxelPaletteを使用）。.vox読み込み用 */
  customPalette?: [number, number, number][];

  constructor(
    readonly sx: number,
    readonly sy: number,
    readonly sz: number,
  ) {
    this.data = new Uint8Array(sx * sy * sz);
  }

  index(x: number, y: number, z: number): number {
    return x + this.sx * (y + this.sy * z);
  }
  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.sx && y < this.sy && z < this.sz;
  }
  get(x: number, y: number, z: number): number {
    return this.inBounds(x, y, z) ? this.data[this.index(x, y, z)] : 0;
  }
  set(x: number, y: number, z: number, c: number): void {
    if (this.inBounds(x, y, z)) this.data[this.index(x, y, z)] = c;
  }
  count(): number {
    let n = 0;
    for (let i = 0; i < this.data.length; i++) if (this.data[i]) n++;
    return n;
  }
}

/** 疎なボクセル集合を作ってから VoxelModel に確定させるビルダー（座標は負でも可）。 */
export class VoxelBuilder {
  private map = new Map<number, [number, number, number, number]>();
  private static key(x: number, y: number, z: number) {
    return x + 512 + 1024 * (y + 512 + 1024 * (z + 512));
  }
  set(x: number, y: number, z: number, c: number): void {
    x = Math.round(x);
    y = Math.round(y);
    z = Math.round(z);
    if (c === 0) this.map.delete(VoxelBuilder.key(x, y, z));
    else this.map.set(VoxelBuilder.key(x, y, z), [x, y, z, c]);
  }
  get(x: number, y: number, z: number): number {
    return this.map.get(VoxelBuilder.key(Math.round(x), Math.round(y), Math.round(z)))?.[3] ?? 0;
  }
  has(x: number, y: number, z: number): boolean {
    return this.get(x, y, z) !== 0;
  }
  forEach(fn: (x: number, y: number, z: number, c: number) => void): void {
    for (const v of this.map.values()) fn(v[0], v[1], v[2], v[3]);
  }
  get size(): number {
    return this.map.size;
  }
  /** @param pivot ビルダー座標系での原点（省略時は箱の中心） */
  build(pivot?: [number, number, number]): VoxelModel {
    let minX = 1e9, minY = 1e9, minZ = 1e9, maxX = -1e9, maxY = -1e9, maxZ = -1e9;
    for (const [x, y, z] of this.map.values()) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    if (this.map.size === 0) return new VoxelModel(1, 1, 1);
    const m = new VoxelModel(maxX - minX + 1, maxY - minY + 1, maxZ - minZ + 1);
    for (const [x, y, z, c] of this.map.values()) m.set(x - minX, y - minY, z - minZ, c);
    // pivot はボクセル中心基準のビルダー座標。グリッド上の「角基準」座標へ変換する
    m.pivot = pivot
      ? [pivot[0] - minX + 0.5, pivot[1] - minY + 0.5, pivot[2] - minZ + 0.5]
      : [m.sx / 2, m.sy / 2, m.sz / 2];
    return m;
  }
}
