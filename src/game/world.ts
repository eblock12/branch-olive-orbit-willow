import * as THREE from "three";
import { Block, isSolid } from "./blocks";
import {
  Chunk,
  CHUNK_HEIGHT,
  CHUNK_SIZE,
  SEA_LEVEL,
  buildChunkGeometry,
  buildChunkWaterGeometry,
  chunkKey,
  worldToChunk,
  lodFromChunkDist,
  type ChunkKey,
  type ChunkLod,
} from "./chunk";
import { sampleBiome, BIOME_LABEL, type BiomeId } from "./biomes";
import { generateChunkBlocks } from "./chunkGen";
import type { ChunkWorkerRequest, ChunkWorkerResponse } from "./chunkWorker";

type GenJob = { cx: number; cz: number; key: ChunkKey };

/**
 * Streaming world: voxel generation off main thread (workers),
 * meshing time-budgeted on the main thread.
 */
export class World {
  readonly seed: number;
  readonly chunks = new Map<ChunkKey, Chunk>();
  readonly group = new THREE.Group();
  readonly waterGroup = new THREE.Group();
  private material: THREE.MeshLambertMaterial;
  private waterMaterial: THREE.Material;
  private viewRadius: number;
  private meshQueue: Chunk[] = [];
  private maxMeshesPerFrame: number;
  /** ms budget for meshing per ensureChunksAround call */
  private meshBudgetMs: number;

  private genQueue: GenJob[] = [];
  private pendingGen = new Set<ChunkKey>();
  private generating = new Set<ChunkKey>();
  private workers: Worker[] = [];
  private idleWorkers: Worker[] = [];
  private jobId = 1;
  private jobMeta = new Map<
    number,
    { cx: number; cz: number; key: ChunkKey }
  >();
  private lastPcx = 0;
  private lastPcz = 0;
  private useWorkers = true;

  constructor(
    seed: number,
    material: THREE.MeshLambertMaterial,
    waterMaterial: THREE.Material,
    viewRadius = 4,
    maxMeshesPerFrame = 2,
  ) {
    this.seed = seed;
    this.material = material;
    this.waterMaterial = waterMaterial;
    this.viewRadius = viewRadius;
    this.maxMeshesPerFrame = maxMeshesPerFrame;
    this.meshBudgetMs = 10;


    this.group.add(this.waterGroup);
    this.initWorkers();
  }

  private initWorkers(): void {
    if (typeof Worker === "undefined") {
      this.useWorkers = false;
      return;
    }
    try {
      const n = Math.min(
        2,
        Math.max(1, (navigator.hardwareConcurrency || 2) - 1),
      );
      for (let i = 0; i < n; i++) {
        const w = new Worker(new URL("./chunkWorker.ts", import.meta.url), {
          type: "module",
        });
        w.onmessage = (ev: MessageEvent<ChunkWorkerResponse>) => {
          this.onWorkerResult(w, ev.data);
        };
        w.onerror = () => {
          // Fall back to main-thread generation if workers fail
          this.useWorkers = false;
          this.recycleWorker(w);
        };
        this.workers.push(w);
        this.idleWorkers.push(w);
      }
    } catch {
      this.useWorkers = false;
    }
  }

  private recycleWorker(w: Worker): void {
    if (!this.idleWorkers.includes(w) && this.workers.includes(w)) {
      this.idleWorkers.push(w);
    }
    this.pumpGenQueue();
  }

  private onWorkerResult(w: Worker, data: ChunkWorkerResponse): void {
    const meta = this.jobMeta.get(data.id);
    this.jobMeta.delete(data.id);
    this.recycleWorker(w);
    if (!meta) return;
    const { cx, cz, key } = meta;
    this.generating.delete(key);
    this.pendingGen.delete(key);

    // Drop if no longer needed (player left area)
    const dist =
      (cx - this.lastPcx) * (cx - this.lastPcx) +
      (cz - this.lastPcz) * (cz - this.lastPcz);
    if (dist > (this.viewRadius + 1) * (this.viewRadius + 1)) {
      return;
    }
    if (this.chunks.has(key)) return;

    const chunk = new Chunk(cx, cz);
    chunk.applyBlocks(data.blocks);
    chunk.targetLod = lodFromChunkDist(cx - this.lastPcx, cz - this.lastPcz);
    this.chunks.set(key, chunk);
    this.meshQueue.push(chunk);
    this.invalidateNeighbors(cx, cz);
  }

  private invalidateNeighbors(cx: number, cz: number): void {
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const n = this.chunks.get(chunkKey(cx + dx, cz + dz));
      if (n) {
        n.dirty = true;
        if (!this.meshQueue.includes(n)) this.meshQueue.push(n);
      }
    }
  }

  private enqueueGen(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    if (this.chunks.has(key)) return;
    if (this.pendingGen.has(key) || this.generating.has(key)) return;
    this.pendingGen.add(key);
    this.genQueue.push({ cx, cz, key });
  }

  private pumpGenQueue(): void {
    // Sort queue by distance to player
    this.genQueue.sort((a, b) => {
      const da = (a.cx - this.lastPcx) ** 2 + (a.cz - this.lastPcz) ** 2;
      const db = (b.cx - this.lastPcx) ** 2 + (b.cz - this.lastPcz) ** 2;
      return da - db;
    });

    if (!this.useWorkers || this.workers.length === 0) {
      // Main-thread: generate at most 1 chunk per pump to avoid spikes
      const job = this.genQueue.shift();
      if (!job) return;
      this.pendingGen.delete(job.key);
      if (this.chunks.has(job.key)) return;
      const chunk = new Chunk(job.cx, job.cz);
      chunk.applyBlocks(generateChunkBlocks(job.cx, job.cz, this.seed));
      this.chunks.set(job.key, chunk);
      this.meshQueue.push(chunk);
      return;
    }

    while (this.idleWorkers.length > 0 && this.genQueue.length > 0) {
      const job = this.genQueue.shift()!;
      if (this.chunks.has(job.key) || this.generating.has(job.key)) {
        this.pendingGen.delete(job.key);
        continue;
      }
      const w = this.idleWorkers.pop()!;
      const id = this.jobId++;
      this.generating.add(job.key);
      this.pendingGen.delete(job.key);
      this.jobMeta.set(id, { cx: job.cx, cz: job.cz, key: job.key });
      const req: ChunkWorkerRequest = {
        id,
        cx: job.cx,
        cz: job.cz,
        seed: this.seed,
      };
      w.postMessage(req);
    }
  }

  /** Synchronously generate a chunk (spawn / critical path). */
  private generateSync(cx: number, cz: number): Chunk {
    const key = chunkKey(cx, cz);
    let chunk = this.chunks.get(key);
    if (chunk) return chunk;
    this.pendingGen.delete(key);
    this.generating.delete(key);
    this.genQueue = this.genQueue.filter((j) => j.key !== key);
    chunk = new Chunk(cx, cz);
    chunk.applyBlocks(generateChunkBlocks(cx, cz, this.seed));
    chunk.targetLod = lodFromChunkDist(cx - this.lastPcx, cz - this.lastPcz);
    this.chunks.set(key, chunk);
    return chunk;
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
    // Edited chunks always full detail
    chunk.targetLod = 0;
    chunk.meshLod = -1;

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
    return isSolid(
      this.getBlock(Math.floor(wx), Math.floor(wy), Math.floor(wz)),
    );
  }

  ensureChunksAround(px: number, pz: number): void {
    const [pcx, pcz] = worldToChunk(Math.floor(px), Math.floor(pz));
    this.lastPcx = pcx;
    this.lastPcz = pcz;
    const r = this.viewRadius;
    const needed = new Set<ChunkKey>();

    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dz * dz > r * r + 1) continue;
        const cx = pcx + dx;
        const cz = pcz + dz;
        const key = chunkKey(cx, cz);
        needed.add(key);
        if (!this.chunks.has(key)) {
          this.enqueueGen(cx, cz);
        } else {
          const chunk = this.chunks.get(key)!;
          const desired = lodFromChunkDist(cx - pcx, cz - pcz);
          if (chunk.targetLod !== desired) {
            chunk.targetLod = desired;
            // Only remesh when LOD actually changes from what's built
            if (chunk.meshLod !== desired) {
              chunk.dirty = true;
            }
          }
          if (chunk.dirty && !this.meshQueue.includes(chunk)) {
            this.meshQueue.push(chunk);
          }
        }
      }
    }

    // Drop gen jobs that are no longer needed
    this.genQueue = this.genQueue.filter((j) => {
      if (needed.has(j.key)) return true;
      this.pendingGen.delete(j.key);
      return false;
    });

    this.pumpGenQueue();

    // Time-budgeted meshing (never block a full frame on many remeshes)
    this.meshQueue.sort((a, b) => {
      const da = (a.cx - pcx) ** 2 + (a.cz - pcz) ** 2;
      const db = (b.cx - pcx) ** 2 + (b.cz - pcz) ** 2;
      return da - db;
    });

    const t0 = performance.now();
    let built = 0;
    while (this.meshQueue.length > 0 && built < this.maxMeshesPerFrame) {
      if (performance.now() - t0 > this.meshBudgetMs) break;
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
        if (chunk.waterMesh) this.waterGroup.remove(chunk.waterMesh);
        chunk.dispose();
        this.chunks.delete(key);
      }
    }
  }

  /**
   * Block until nearby chunks exist and are meshed (initial spawn).
   * Generates a smaller sync radius so the player has solid ground immediately;
   * the rest of the view distance streams in async.
   */
  flushMeshes(): void {
    const rSync = Math.min(3, this.viewRadius);
    for (let dz = -rSync; dz <= rSync; dz++) {
      for (let dx = -rSync; dx <= rSync; dx++) {
        if (dx * dx + dz * dz > rSync * rSync + 1) continue;
        const cx = this.lastPcx + dx;
        const cz = this.lastPcz + dz;
        const chunk = this.generateSync(cx, cz);
        if (chunk.dirty || !chunk.mesh) this.remeshChunk(chunk);
      }
    }
    // Also mesh anything already generated
    for (const chunk of this.chunks.values()) {
      if (chunk.dirty || !chunk.mesh) this.remeshChunk(chunk);
    }
    this.meshQueue = [];
  }

  applyWindDepthMaterial(depthMat: THREE.Material): void {
    this.material.userData.windDepthMaterial = depthMat;
    for (const chunk of this.chunks.values()) {
      if (chunk.mesh) {
        chunk.mesh.customDepthMaterial = depthMat;
      }
    }
  }

  remeshChunk(chunk: Chunk): void {
    const getBlock = (wx: number, wy: number, wz: number) =>
      this.getBlock(wx, wy, wz);
    const isLoaded = (wx: number, wz: number) => {
      const [cx, cz] = worldToChunk(Math.floor(wx), Math.floor(wz));
      return this.chunks.has(chunkKey(cx, cz));
    };

    // Prefer target LOD; default from current player ring
    let lod: ChunkLod = chunk.targetLod;
    if (chunk.meshLod < 0 && lod === 0) {
      lod = lodFromChunkDist(chunk.cx - this.lastPcx, chunk.cz - this.lastPcz);
      chunk.targetLod = lod;
    }
    // Player edits should always use full detail when nearby
    if (
      lodFromChunkDist(chunk.cx - this.lastPcx, chunk.cz - this.lastPcz) === 0
    ) {
      lod = 0;
      chunk.targetLod = 0;
    }

    const geo = buildChunkGeometry(chunk, getBlock, lod);
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
      // Far LOD doesn't need to cast expensive shadows
      mesh.castShadow = lod === 0;
      mesh.receiveShadow = lod < 2;
      const depthMat = this.material.userData.windDepthMaterial as
        | THREE.Material
        | undefined;
      if (depthMat && lod === 0) mesh.customDepthMaterial = depthMat;
      chunk.mesh = mesh;
      this.group.add(mesh);
    }

    const wgeo = buildChunkWaterGeometry(chunk, getBlock, lod, isLoaded);
    if (chunk.waterMesh) {
      this.waterGroup.remove(chunk.waterMesh);
      chunk.waterMesh.geometry.dispose();
      chunk.waterMesh = null;
    }
    if (wgeo) {
      const wmesh = new THREE.Mesh(wgeo, this.waterMaterial);
      wmesh.matrixAutoUpdate = false;
      wmesh.updateMatrix();
      wmesh.updateMatrixWorld(true);
      wmesh.frustumCulled = true;
      wmesh.castShadow = false;
      wmesh.receiveShadow = lod < 2;
      wmesh.renderOrder = 3;
      chunk.waterMesh = wmesh;
      this.waterGroup.add(wmesh);
    }

    chunk.meshLod = lod;
    chunk.dirty = false;
  }

  getSurfaceY(wx: number, wz: number): number {
    for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
      if (isSolid(this.getBlock(wx, y, wz))) return y + 1;
    }
    return SEA_LEVEL + 2;
  }

  /**
   * Feet Y for a dry land spawn, or null if column is ocean/underwater/blocked.
   * Requires the top solid block to be above sea level with air for the player body.
   */
  getDrySpawnY(wx: number, wz: number): number | null {
    let solidY = -1;
    for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
      const id = this.getBlock(wx, y, wz);
      if (isSolid(id)) {
        solidY = y;
        break;
      }
    }
    if (solidY < 0) return null;

    const feet = solidY + 1;
    // Never spawn at or below sea level (covers ocean floor under water)
    if (feet < SEA_LEVEL + 1) return null;

    // Feet + body + head must be free of water and solids
    for (let y = feet; y <= feet + 2; y++) {
      const id = this.getBlock(wx, y, wz);
      if (id === Block.WATER || id === Block.ICE) return null;
      if (isSolid(id)) return null;
    }

    // Surface block itself shouldn't be underwater column
    // (water might sit beside; only care about this column)
    return feet;
  }

  /** Ensure chunk data exists at world XZ (sync generate). */
  ensureChunkAt(wx: number, wz: number): void {
    const [cx, cz] = worldToChunk(Math.floor(wx), Math.floor(wz));
    this.generateSync(cx, cz);
  }

  dispose(): void {
    for (const chunk of this.chunks.values()) {
      if (chunk.mesh) this.group.remove(chunk.mesh);
      if (chunk.waterMesh) this.waterGroup.remove(chunk.waterMesh);
      chunk.dispose();
    }
    this.chunks.clear();
    this.meshQueue = [];
    this.genQueue = [];
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.idleWorkers = [];
  }
}
