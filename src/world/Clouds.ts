import * as THREE from 'three';
import { createVoxelMaterial, shared } from '../rendering/Materials';
import { VoxelBuilder, VoxelModel } from '../voxel/VoxelModel';
import { meshVoxelModel } from '../voxel/VoxelMesher';
import { P } from '../voxel/VoxelPalette';
import { hash2, mulberry32 } from './Noise';

const VOX = 2.6; // 雲のボクセルサイズ
const GRID = 300; // 雲の配置グリッド
const RADIUS = 2300; // 表示半径
const CAP = 56; // バリアントごとの最大インスタンス数
const VARIANTS = 16;

interface CloudDef {
  x: number;
  y: number;
  z: number;
  s: number;
  v: number;
}

/** 面の露出方向で色を割り当てる（上面=白 / 側面=淡青 / 下面=青灰） */
function colorize(b: VoxelBuilder): VoxelBuilder {
  const out = new VoxelBuilder();
  b.forEach((x, y, z) => {
    let c: number = P.CLOUD_SIDE;
    if (!b.has(x, y + 1, z)) c = P.WHITE;
    else if (!b.has(x, y - 1, z)) c = P.CLOUD_BOT;
    else if (!b.has(x, y - 2, z)) c = P.CLOUD_SIDE2;
    out.set(x, y, z, c);
  });
  return out;
}

function ellipsoid(b: VoxelBuilder, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number): void {
  for (let x = Math.floor(cx - rx); x <= cx + rx; x++)
    for (let y = Math.floor(cy - ry); y <= cy + ry; y++)
      for (let z = Math.floor(cz - rz); z <= cz + rz; z++) {
        const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz) ** 2;
        if (d <= 1) b.set(x, y, z, 1);
      }
}

/** 段々の円盤を積んだ「ウェディングケーキ型」。参考映像の雲の形 */
function pancakeCloud(rnd: () => number): VoxelModel {
  const b = new VoxelBuilder();
  const layers = 3 + Math.floor(rnd() * 4);
  const r0 = 5 + rnd() * 6;
  let ox = 0, oz = 0;
  for (let k = 0; k < layers; k++) {
    const r = r0 * (1 - k * (0.5 / layers) - rnd() * 0.08);
    ox += (rnd() - 0.5) * 1.6;
    oz += (rnd() - 0.5) * 1.6;
    const stretch = 1 + rnd() * 0.4;
    for (let x = -Math.ceil(r * stretch); x <= r * stretch; x++)
      for (let z = -Math.ceil(r); z <= r; z++) {
        if ((x / stretch) ** 2 + z * z <= r * r) b.set(Math.round(x + ox), k, Math.round(z + oz), 1);
      }
  }
  return colorize(b).build();
}

/** 丸い積乱雲: 複数の楕円体の合成 */
function cumulusCloud(rnd: () => number): VoxelModel {
  const b = new VoxelBuilder();
  const blobs = 5 + Math.floor(rnd() * 5);
  const R = 5 + rnd() * 5;
  for (let i = 0; i < blobs; i++) {
    const a = rnd() * Math.PI * 2;
    const d = rnd() * R;
    const r = 3 + rnd() * 4.5;
    ellipsoid(b, Math.cos(a) * d, r * 0.45 + rnd() * 3, Math.sin(a) * d, r * 1.15, r * 0.75, r * 1.15);
  }
  // 底を平らに削る
  const flat = new VoxelBuilder();
  b.forEach((x, y, z) => {
    if (y >= 0) flat.set(x, y, z, 1);
  });
  return colorize(flat).build();
}

/** 横長の小さな雲 */
function streakCloud(rnd: () => number): VoxelModel {
  const b = new VoxelBuilder();
  const a = 7 + rnd() * 8;
  const c = 2.5 + rnd() * 2.5;
  ellipsoid(b, 0, 1, 0, a, 1.8, c);
  const bumps = 1 + Math.floor(rnd() * 3);
  for (let i = 0; i < bumps; i++) ellipsoid(b, (rnd() - 0.5) * a, 2.2, (rnd() - 0.5) * c, 3 + rnd() * 2, 2.2, 2.4);
  const flat = new VoxelBuilder();
  b.forEach((x, y, z) => {
    if (y >= 0) flat.set(x, y, z, 1);
  });
  return colorize(flat).build();
}

/**
 * ボクセル雲: 手続き生成した複数形状をバリアントごとに InstancedMesh で描画（バリアント数=ドローコール数）。
 * 雲の配置はグリッドハッシュで決定論的に無限生成する。
 */
export class Clouds {
  readonly group = new THREE.Group();
  private meshes: THREE.InstancedMesh[] = [];
  private radii: number[] = [];
  private defs = new Map<string, CloudDef[]>();
  private active: CloudDef[] = [];
  private lastX = 1e9;
  private lastZ = 1e9;
  private tmp = new THREE.Matrix4();
  private shadowVecs: THREE.Vector4[] = [];
  get count(): number {
    return this.active.length;
  }

  constructor(private seed: number) {
    const mat = createVoxelMaterial(0.8);
    const rnd = mulberry32(seed * 91 + 5);
    for (let v = 0; v < VARIANTS; v++) {
      const kind = v % 4;
      const model = kind === 3 ? streakCloud(rnd) : kind === 2 ? cumulusCloud(rnd) : pancakeCloud(rnd);
      const geo = meshVoxelModel(model, VOX);
      // ピボットを底面中心に
      const m = new THREE.InstancedMesh(geo, mat, CAP);
      m.count = 0;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.meshes.push(m);
      this.radii.push(Math.max(model.sx, model.sz) * VOX * 0.5);
      this.group.add(m);
    }
  }

  private cellDefs(gx: number, gz: number): CloudDef[] {
    const key = gx + ',' + gz;
    let d = this.defs.get(key);
    if (d) return d;
    d = [];
    const r = hash2(gx, gz, this.seed + 77);
    const n = r < 0.18 ? 0 : r < 0.62 ? 1 : r < 0.9 ? 2 : 3;
    for (let i = 0; i < n; i++) {
      const h = (k: number) => hash2(gx * 7 + i, gz * 13 + k, this.seed + 999);
      const low = h(5) < 0.72;
      d.push({
        x: (gx + h(1)) * GRID,
        z: (gz + h(2)) * GRID,
        y: low ? 18 + h(3) * 70 : 110 + h(3) * 120,
        s: 0.7 + h(4) * 1.1,
        v: Math.floor(h(6) * VARIANTS) % VARIANTS,
      });
    }
    this.defs.set(key, d);
    if (this.defs.size > 4000) this.defs.clear();
    return d;
  }

  update(cam: THREE.Vector3): void {
    if (Math.hypot(cam.x - this.lastX, cam.z - this.lastZ) < 80) return;
    this.lastX = cam.x;
    this.lastZ = cam.z;
    const gx0 = Math.floor((cam.x - RADIUS) / GRID), gx1 = Math.floor((cam.x + RADIUS) / GRID);
    const gz0 = Math.floor((cam.z - RADIUS) / GRID), gz1 = Math.floor((cam.z + RADIUS) / GRID);
    this.active = [];
    const counts = new Array(VARIANTS).fill(0);
    for (let gz = gz0; gz <= gz1; gz++)
      for (let gx = gx0; gx <= gx1; gx++)
        for (const c of this.cellDefs(gx, gz)) {
          if (Math.hypot(c.x - cam.x, c.z - cam.z) > RADIUS) continue;
          if (counts[c.v] >= CAP) continue;
          const m = this.meshes[c.v];
          this.tmp.makeScale(c.s, c.s, c.s).setPosition(c.x, c.y, c.z);
          m.setMatrixAt(counts[c.v]++, this.tmp);
          this.active.push(c);
        }
    for (let v = 0; v < VARIANTS; v++) {
      this.meshes[v].count = counts[v];
      this.meshes[v].instanceMatrix.needsUpdate = true;
    }
  }

  /** 海面に落とす雲の影（x,z,半径）。カメラに近い順 */
  shadowList(cam: THREE.Vector3): THREE.Vector4[] {
    const sun = shared.uSun.value;
    const ox = -sun.x / sun.y;
    const oz = -sun.z / sun.y;
    const list = this.active
      .map((c) => ({ c, d: Math.hypot(c.x - cam.x, c.z - cam.z) }))
      .filter((e) => e.d < 1600 && e.c.y < 200)
      .sort((a, b) => a.d - b.d)
      .slice(0, 48);
    while (this.shadowVecs.length < list.length) this.shadowVecs.push(new THREE.Vector4());
    this.shadowVecs.length = list.length;
    list.forEach((e, i) => {
      const c = e.c;
      this.shadowVecs[i].set(c.x + ox * c.y, c.z + oz * c.y, this.radii[c.v] * c.s * 0.85, 0);
    });
    return this.shadowVecs;
  }
}
