import * as THREE from 'three';
import { config } from '../config';
import { TerrainGenerator } from './TerrainGenerator';

const SIZE = config.world.chunkCells * config.world.cell;

/** 地形チャンク（=島の一部）。1チャンク1メッシュ。Frustum Cullingはメッシュのバウンディング球で自動適用。 */
export class IslandChunk {
  mesh: THREE.Mesh | null = null;
  constructor(
    readonly cx: number,
    readonly cz: number,
    gen: TerrainGenerator,
    material: THREE.Material,
  ) {
    const g = gen.buildChunk(cx, cz);
    if (g) {
      this.mesh = new THREE.Mesh(g, material);
      this.mesh.position.set(cx * SIZE, 0, cz * SIZE);
      this.mesh.matrixAutoUpdate = false;
      this.mesh.updateMatrix();
    }
  }
  dispose(): void {
    this.mesh?.geometry.dispose();
  }
}
