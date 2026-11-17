import * as THREE from 'three';
import { config } from '../config';
import { createVoxelMaterial } from '../rendering/Materials';
import { Clouds } from './Clouds';
import { IslandChunk } from './Island';
import { Ocean } from './Ocean';
import { TerrainGenerator } from './TerrainGenerator';

const SIZE = config.world.chunkCells * config.world.cell;

/** 地形チャンクの動的ロード/破棄、海、雲をまとめて管理する */
export class World {
  readonly group = new THREE.Group();
  readonly terrain: TerrainGenerator;
  readonly ocean: Ocean;
  readonly clouds: Clouds;
  private chunks = new Map<string, IslandChunk>();
  private material = createVoxelMaterial();
  private lastCx = 1e9;
  private lastCz = 1e9;
  private queue: [number, number][] = [];

  constructor(seed: number) {
    this.terrain = new TerrainGenerator(seed);
    this.ocean = new Ocean();
    this.clouds = new Clouds(seed);
    this.group.add(this.ocean.group, this.clouds.group);
  }

  groundHeight(x: number, z: number): number {
    return this.terrain.groundHeight(x, z);
  }

  get chunkCount(): number {
    return this.chunks.size;
  }

  /** 初期表示で遠方まで島が見えるよう、近傍を同期生成する */
  preload(x: number, z: number, radius = 6): void {
    this.refreshQueue(x, z);
    const cx = Math.floor(x / SIZE), cz = Math.floor(z / SIZE);
    for (const [qx, qz] of [...this.queue]) {
      if (Math.hypot(qx - cx, qz - cz) <= radius) this.build(qx, qz);
    }
    this.queue = this.queue.filter(([qx, qz]) => !this.chunks.has(`${qx},${qz}`));
  }

  private build(cx: number, cz: number): void {
    const key = `${cx},${cz}`;
    if (this.chunks.has(key)) return;
    const ch = new IslandChunk(cx, cz, this.terrain, this.material);
    this.chunks.set(key, ch);
    if (ch.mesh) this.group.add(ch.mesh);
  }

  private refreshQueue(x: number, z: number): void {
    const R = config.world.viewRadius;
    const cx = Math.floor(x / SIZE), cz = Math.floor(z / SIZE);
    const want: [number, number, number][] = [];
    const wantKeys = new Set<string>();
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const d = Math.hypot(dx, dz);
        if (d > R + 0.3) continue;
        const k = `${cx + dx},${cz + dz}`;
        wantKeys.add(k);
        if (!this.chunks.has(k)) want.push([cx + dx, cz + dz, d]);
      }
    }
    want.sort((a, b) => a[2] - b[2]);
    this.queue = want.map((w) => [w[0], w[1]]);
    for (const [k, ch] of this.chunks) {
      if (!wantKeys.has(k)) {
        if (ch.mesh) this.group.remove(ch.mesh);
        ch.dispose();
        this.chunks.delete(k);
      }
    }
  }

  update(dt: number, cam: THREE.Vector3): void {
    const cx = Math.floor(cam.x / SIZE), cz = Math.floor(cam.z / SIZE);
    if (cx !== this.lastCx || cz !== this.lastCz) {
      this.lastCx = cx;
      this.lastCz = cz;
      this.refreshQueue(cam.x, cam.z);
    }
    const t0 = performance.now();
    while (this.queue.length && performance.now() - t0 < 5) {
      const [qx, qz] = this.queue.shift()!;
      this.build(qx, qz);
    }
    this.clouds.update(cam);
    this.ocean.update(dt, cam, this.clouds.shadowList(cam));
  }
}
