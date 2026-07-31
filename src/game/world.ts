import * as THREE from "three";
import { Block, isSolid } from "./blocks";
import {
  Chunk,
  CHUNK_HEIGHT,
  CHUNK_SIZE,
  SEA_LEVEL,
  buildChunkGeometry,
  chunkKey,
  worldToChunk,
  type ChunkKey,
} from "./chunk";
import { sampleBiome, BIOME_LABEL, type BiomeId } from "./biomes";

export class World {
  readonly seed: number;
  readonly chunks = new Map<ChunkKey, Chunk>();
  readonly group = new THREE.Group();
  private material: THREE.MeshLambertMaterial;
  private viewRadius: number;
  private meshQueue: Chunk[] = [];
  private maxMeshesPerFrame: number;

  constructor(
    seed: number,
    material: THREE.MeshLambertMaterial,
    viewRadius = 4,
    maxMeshesPerFrame = 2,
  ) {
    this.seed = seed;
    this.material = material;
    this.viewRadius = viewRadius;
    this.maxMeshesPerFrame = maxMeshesPerFrame;
  }

  getBiomeAt(wx: number, wz: number): BiomeId {
    return sampleBiome(wx, wz, this.seed, SEA_LEVEL).id;
  }

  getBiomeLabel(wx: number, wz: number): string {
    return BIOME_LABEL[this.getBiomeAt(wx, wz)] ?? "Unknown";
  }

  getBlock(wx: number, wy: number, wz: number): number {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return Block.AIR;
    const [cx, cz] = worldToChunk(wx, wz);
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk) return Block.AIR;
    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    return chunk.get(lx, wy, lz);
  }

  setBlock(wx: number, wy: number, wz: number, id: number): boolean {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return false;
    const [cx, cz] = worldToChunk(wx, wz);
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk) return false;
    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const existing = chunk.get(lx, wy, lz);
    if (existing === Block.BEDROCK && id === Block.AIR) return false;
    chunk.set(lx, wy, lz, id);

    // Immediate remesh for edits (player feedback)
    this.remeshChunk(chunk);
    if (lx === 0) this.remeshIfLoaded(cx - 1, cz);
    if (lx === CHUNK_SIZE - 1) this.remeshIfLoaded(cx + 1, cz);
    if (lz === 0) this.remeshIfLoaded(cx, cz - 1);
    if (lz === CHUNK_SIZE - 1) this.remeshIfLoaded(cx, cz + 1);
    return true;
  }

  private remeshIfLoaded(cx: number, cz: number): void {
    const c = this.chunks.get(chunkKey(cx, cz));
    if (c) this.remeshChunk(c);
  }

  isSolidAt(wx: number, wy: number, wz: number): boolean {
    return isSolid(this.getBlock(Math.floor(wx), Math.floor(wy), Math.floor(wz)));
  }

  ensureChunksAround(px: number, pz: number): void {
    const [pcx, pcz] = worldToChunk(Math.floor(px), Math.floor(pz));
    const r = this.viewRadius;
    const needed = new Set<ChunkKey>();

    // Generate nearby chunks (data only) — mesh spreads over frames
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dz * dz > r * r + 1) continue;
        const cx = pcx + dx;
        const cz = pcz + dz;
        const key = chunkKey(cx, cz);
        needed.add(key);
        if (!this.chunks.has(key)) {
          const chunk = new Chunk(cx, cz);
          chunk.generate(this.seed);
          this.chunks.set(key, chunk);
          this.meshQueue.push(chunk);
        } else {
          const chunk = this.chunks.get(key)!;
          if (chunk.dirty && !this.meshQueue.includes(chunk)) {
            this.meshQueue.push(chunk);
          }
        }
      }
    }

    // Prioritize closer chunks
    this.meshQueue.sort((a, b) => {
      const da = (a.cx - pcx) ** 2 + (a.cz - pcz) ** 2;
      const db = (b.cx - pcx) ** 2 + (b.cz - pcz) ** 2;
      return da - db;
    });

    let built = 0;
    while (this.meshQueue.length > 0 && built < this.maxMeshesPerFrame) {
      const chunk = this.meshQueue.shift()!;
      if (!this.chunks.has(chunkKey(chunk.cx, chunk.cz))) continue;
      if (!chunk.dirty && chunk.mesh) continue;
      this.remeshChunk(chunk);
      built++;
    }

    // Unload far chunks
    for (const [key, chunk] of this.chunks) {
      if (!needed.has(key)) {
        if (chunk.mesh) this.group.remove(chunk.mesh);
        chunk.dispose();
        this.chunks.delete(key);
      }
    }
  }

  /** Force-build all pending meshes (spawn) */
  flushMeshes(): void {
    for (const chunk of this.chunks.values()) {
      if (chunk.dirty || !chunk.mesh) this.remeshChunk(chunk);
    }
    this.meshQueue = [];
  }

  /** Attach shared wind depth material to all existing chunk meshes (after wind install). */
  applyWindDepthMaterial(depthMat: THREE.Material): void {
    this.material.userData.windDepthMaterial = depthMat;
    for (const chunk of this.chunks.values()) {
      if (chunk.mesh) {
        chunk.mesh.customDepthMaterial = depthMat;
      }
    }
  }

  remeshChunk(chunk: Chunk): void {
    const geo = buildChunkGeometry(chunk, (wx, wy, wz) => this.getBlock(wx, wy, wz));
    if (chunk.mesh) {
      this.group.remove(chunk.mesh);
      chunk.mesh.geometry.dispose();
      chunk.mesh = null;
    }
    if (geo) {
      const mesh = new THREE.Mesh(geo, this.material);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.updateMatrixWorld(true);
      mesh.frustumCulled = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // Match leaf sway in the shadow map depth pass
      const depthMat = this.material.userData.windDepthMaterial as
        | THREE.Material
        | undefined;
      if (depthMat) mesh.customDepthMaterial = depthMat;
      chunk.mesh = mesh;
      this.group.add(mesh);
    }


    chunk.dirty = false;
  }

  getSurfaceY(wx: number, wz: number): number {
    for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
      if (isSolid(this.getBlock(wx, y, wz))) return y + 1;
    }
    return 20;
  }

  dispose(): void {
    for (const chunk of this.chunks.values()) {
      if (chunk.mesh) this.group.remove(chunk.mesh);
      chunk.dispose();
    }
    this.chunks.clear();
    this.meshQueue = [];
  }
}
