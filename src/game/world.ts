import * as THREE from "three";
import { Block, isPlant, isSolid, isWater, isSourceWater, isTorch, isDoor, isDoorCell, isLadder, isLadderCell, canSupportTorch, canSupportLadder, torchAttachDir, ladderAttachDir, doorIsUpper, doorMateId, waterLevel, waterIdForLevel, lightEmission, blocksLight } from "./blocks";
import { computeChunkLighting, applyBlockLightEdit, estimateColumnSky } from "./lighting";
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
import { packEdit, unpackEdit } from "./save";

type GenJob = { cx: number; cz: number; key: ChunkKey };

export type BlockPop = {
  x: number;
  y: number;
  z: number;
  id: number;
};

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

  /** Neighbor / support checks queued by setBlock */
  private scheduled = new Map<string, { x: number; y: number; z: number }>();
  private waterQ = new Map<string, { x: number; y: number; z: number }>();
  private tickAcc = 0;
  private waterAcc = 0;
  private tickRng = 1;
  private remeshLater = new Set<Chunk>();
  private lightTouched = new Set<Chunk>();
  private chestIndex = new Map<string, { x: number; y: number; z: number }>();
  /** Sparse player/sim edits applied on top of generated terrain */
  private voxelEdits = new Map<ChunkKey, Map<number, number>>();
  editsDirty = false;

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
    this.applyEditsToChunk(chunk);
    this.indexChestsInChunk(chunk);
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
        n.lightDirty = true;
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
      this.applyEditsToChunk(chunk);
      this.indexChestsInChunk(chunk);
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
    this.applyEditsToChunk(chunk);
    this.indexChestsInChunk(chunk);
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

  getSkyLight(wx: number, wy: number, wz: number): number {
    if (wy >= CHUNK_HEIGHT) return 15;
    if (wy < 0) return 0;
    const [cx, cz] = worldToChunk(wx, wz);
    const chunk = this.chunks.get(chunkKey(cx, cz));
    // Unloaded ring is open sky — never a black well that infects the border.
    if (!chunk) return 15;
    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    if (!chunk.skyLight) return estimateColumnSky(chunk, lx, wy, lz);
    return chunk.getSky(lx, wy, lz);
  }

  getBlockLight(wx: number, wy: number, wz: number): number {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return 0;
    const [cx, cz] = worldToChunk(wx, wz);
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk || !chunk.blockLight) return 0;
    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    return chunk.getBlkLight(lx, wy, lz);
  }

  chestsNear(
    px: number,
    py: number,
    pz: number,
    r: number,
  ): { x: number; y: number; z: number }[] {
    const out: { x: number; y: number; z: number }[] = [];
    const r2 = r * r;
    for (const p of this.chestIndex.values()) {
      const dx = p.x + 0.5 - px;
      const dy = p.y + 0.5 - py;
      const dz = p.z + 0.5 - pz;
      if (dx * dx + dy * dy + dz * dz <= r2) out.push(p);
    }
    return out;
  }

  private noteChestCell(
    wx: number,
    wy: number,
    wz: number,
    prev: number,
    next: number,
  ): void {
    const k = `${wx},${wy},${wz}`;
    if (prev === Block.CHEST) this.chestIndex.delete(k);
    if (next === Block.CHEST) this.chestIndex.set(k, { x: wx, y: wy, z: wz });
  }

  private indexChestsInChunk(chunk: Chunk): void {
    const baseX = chunk.cx * CHUNK_SIZE;
    const baseZ = chunk.cz * CHUNK_SIZE;
    for (const [k, p] of this.chestIndex) {
      const [ccx, ccz] = worldToChunk(p.x, p.z);
      if (ccx === chunk.cx && ccz === chunk.cz) this.chestIndex.delete(k);
    }
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          if (chunk.get(lx, y, lz) !== Block.CHEST) continue;
          const wx = baseX + lx;
          const wz = baseZ + lz;
          this.chestIndex.set(`${wx},${y},${wz}`, { x: wx, y, z: wz });
        }
      }
    }
  }

  private dropChestsInChunk(chunk: Chunk): void {
    for (const [k, p] of this.chestIndex) {
      const [ccx, ccz] = worldToChunk(p.x, p.z);
      if (ccx === chunk.cx && ccz === chunk.cz) this.chestIndex.delete(k);
    }
  }

  private setSkyLight(wx: number, wy: number, wz: number, v: number): void {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return;
    const [cx, cz] = worldToChunk(wx, wz);
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk?.skyLight) return;
    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const i = chunk.lightIndex(lx, wy, lz);
    if (chunk.skyLight[i] === v) return;
    chunk.skyLight[i] = v;
    this.lightTouched.add(chunk);
  }

  private setBlockLight(wx: number, wy: number, wz: number, v: number): void {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return;
    const [cx, cz] = worldToChunk(wx, wz);
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk?.blockLight) return;
    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const i = chunk.lightIndex(lx, wy, lz);
    if (chunk.blockLight[i] === v) return;
    chunk.blockLight[i] = v;
    this.lightTouched.add(chunk);
  }

  private syncEmitters(
    chunk: Chunk,
    wx: number,
    wy: number,
    wz: number,
    prevId: number,
    nextId: number,
  ): void {
    const prev = lightEmission(prevId);
    const next = lightEmission(nextId);
    if (prev === next) return;
    const e = chunk.emitters;
    if (prev > 0) {
      for (let i = 0; i < e.length; i += 3) {
        if (e[i] === wx && e[i + 1] === wy && e[i + 2] === wz) {
          e.splice(i, 3);
          break;
        }
      }
    }
    if (next > 0) e.push(wx, wy, wz);
  }

  collectEmitters(
    px: number,
    py: number,
    pz: number,
    maxDist: number,
    maxN: number,
  ): { x: number; y: number; z: number }[] {
    const out: { x: number; y: number; z: number; d: number }[] = [];
    const [pcx, pcz] = worldToChunk(Math.floor(px), Math.floor(pz));
    const ring = 2;
    for (let dz = -ring; dz <= ring; dz++) {
      for (let dx = -ring; dx <= ring; dx++) {
        const chunk = this.chunks.get(chunkKey(pcx + dx, pcz + dz));
        if (!chunk) continue;
        const e = chunk.emitters;
        for (let i = 0; i < e.length; i += 3) {
          const x = e[i]!;
          const y = e[i + 1]!;
          const z = e[i + 2]!;
          const d = Math.hypot(x + 0.5 - px, y + 0.4 - py, z + 0.5 - pz);
          if (d <= maxDist) out.push({ x, y, z, d });
        }
      }
    }
    out.sort((a, b) => a.d - b.d);
    return out.slice(0, maxN);
  }

  setBlock(wx: number, wy: number, wz: number, id: number): boolean {
    return this.writeBlock(wx, wy, wz, id, true);
  }

  private writeBlock(
    wx: number,
    wy: number,
    wz: number,
    id: number,
    remeshNow: boolean,
  ): boolean {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return false;
    const [cx, cz] = worldToChunk(wx, wz);
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk) return false;
    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const existing = chunk.get(lx, wy, lz);
    if (existing === id) return true;
    if (existing === Block.BEDROCK && id === Block.AIR) return false;
    chunk.set(lx, wy, lz, id);
    this.recordEdit(cx, cz, lx, wy, lz, id);
    chunk.targetLod = 0;
    this.noteChestCell(wx, wy, wz, existing, id);

    const lightChange =
      lightEmission(existing) !== lightEmission(id) ||
      blocksLight(existing) !== blocksLight(id);

    this.lightTouched.clear();
    if (lightChange && chunk.skyLight && chunk.blockLight) {
      applyBlockLightEdit(wx, wy, wz, existing, id, {
        getBlock: (x, y, z) => this.getBlock(x, y, z),
        getSky: (x, y, z) => this.getSkyLight(x, y, z),
        setSky: (x, y, z, v) => this.setSkyLight(x, y, z, v),
        getBlk: (x, y, z) => this.getBlockLight(x, y, z),
        setBlk: (x, y, z, v) => this.setBlockLight(x, y, z, v),
      });
      this.syncEmitters(chunk, wx, wy, wz, existing, id);
    } else if (lightChange) {
      chunk.lightDirty = true;
    }

    if (remeshNow) {
      chunk.meshLod = -1;
      this.remeshChunk(chunk);
      if (lx === 0) this.remeshIfLoaded(cx - 1, cz);
      if (lx === CHUNK_SIZE - 1) this.remeshIfLoaded(cx + 1, cz);
      if (lz === 0) this.remeshIfLoaded(cx, cz - 1);
      if (lz === CHUNK_SIZE - 1) this.remeshIfLoaded(cx, cz + 1);
      for (const c of this.lightTouched) {
        if (c === chunk) continue;
        c.dirty = true;
        this.remeshLater.add(c);
      }
    } else {
      this.remeshLater.add(chunk);
      if (lx === 0) {
        const n = this.chunks.get(chunkKey(cx - 1, cz));
        if (n) this.remeshLater.add(n);
      }
      if (lx === CHUNK_SIZE - 1) {
        const n = this.chunks.get(chunkKey(cx + 1, cz));
        if (n) this.remeshLater.add(n);
      }
      if (lz === 0) {
        const n = this.chunks.get(chunkKey(cx, cz - 1));
        if (n) this.remeshLater.add(n);
      }
      if (lz === CHUNK_SIZE - 1) {
        const n = this.chunks.get(chunkKey(cx, cz + 1));
        if (n) this.remeshLater.add(n);
      }
      for (const c of this.lightTouched) this.remeshLater.add(c);
    }

    this.scheduleTick(wx, wy, wz);
    this.scheduleTick(wx, wy + 1, wz);
    this.scheduleTick(wx, wy - 1, wz);
    this.scheduleTick(wx + 1, wy, wz);
    this.scheduleTick(wx - 1, wy, wz);
    this.scheduleTick(wx, wy, wz + 1);
    this.scheduleTick(wx, wy, wz - 1);
    this.scheduleWaterAround(wx, wy, wz);
    return true;
  }

  private markLightDirtyAround(cx: number, cz: number): void {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const c = this.chunks.get(chunkKey(cx + dx, cz + dz));
        if (c) c.lightDirty = true;
      }
    }
  }

  private relightChunk(chunk: Chunk): void {
    computeChunkLighting(
      chunk,
      (wx, wy, wz) => this.getSkyLight(wx, wy, wz),
      (wx, wy, wz) => this.getBlockLight(wx, wy, wz),
    );
  }

  /** Light existing neighbors before we sample their maps onto our faces. */
  private ensureLitNeighbors(chunk: Chunk): void {
    const selfUnlit = chunk.lightDirty || !chunk.skyLight;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const n = this.chunks.get(chunkKey(chunk.cx + dx, chunk.cz + dz));
      if (!n || (!n.lightDirty && n.skyLight)) continue;
      this.relightChunk(n);
      // They used this chunk's old/empty map — relight again once we fill it.
      if (selfUnlit) n.lightDirty = true;
    }
  }

  private scheduleWaterAround(wx: number, wy: number, wz: number): void {
    this.queueWater(wx, wy, wz);
    this.queueWater(wx + 1, wy, wz);
    this.queueWater(wx - 1, wy, wz);
    this.queueWater(wx, wy, wz + 1);
    this.queueWater(wx, wy, wz - 1);
    this.queueWater(wx, wy - 1, wz);
    this.queueWater(wx, wy + 1, wz);
  }

  private queueWater(wx: number, wy: number, wz: number): void {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return;
    if (this.waterQ.size >= 2048) return;
    const key = `${wx},${wy},${wz}`;
    if (this.waterQ.has(key)) return;
    this.waterQ.set(key, { x: wx, y: wy, z: wz });
  }

  private scheduleTick(wx: number, wy: number, wz: number): void {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return;
    if (this.scheduled.size >= 768) return;
    const key = `${wx},${wy},${wz}`;
    if (this.scheduled.has(key)) return;
    this.scheduled.set(key, { x: wx, y: wy, z: wz });
  }

  /**
   * Occasional chunk ticks + drain scheduled support checks + water flow.
   * Plants with no solid block underneath pop and are returned as drops.
   */
  tick(dt: number, px: number, pz: number): BlockPop[] {
    const popped: BlockPop[] = [];

    // Immediate scheduled (player broke dirt under a flower, etc.)
    if (this.scheduled.size > 0) {
      const batch = this.scheduled;
      this.scheduled = new Map();
      let n = 0;
      for (const pos of batch.values()) {
        if (n++ > 64) {
          this.scheduleTick(pos.x, pos.y, pos.z);
          continue;
        }
        this.tryPopUnsupported(pos.x, pos.y, pos.z, popped);
        this.trySmotherGrass(pos.x, pos.y, pos.z);
      }
    }

    this.tickAcc += dt;
    if (this.tickAcc >= 0.22) {
      this.tickAcc = 0;
      this.randomChunkTicks(px, pz, popped);
      this.flushTickRemesh();
    }

    this.waterAcc += dt;
    if (this.waterAcc >= 0.16) {
      this.waterAcc = 0;
      this.tickWater(popped);
      this.flushTickRemesh();
    }
    return popped;
  }

  private tickWater(popped: BlockPop[]): void {
    if (this.waterQ.size === 0) return;
    const batch = this.waterQ;
    this.waterQ = new Map();
    let n = 0;
    for (const pos of batch.values()) {
      if (n++ > 56) {
        this.queueWater(pos.x, pos.y, pos.z);
        continue;
      }
      this.tickWaterCell(pos.x, pos.y, pos.z, popped);
    }
  }

  private flushTickRemesh(): void {
    if (this.remeshLater.size === 0) return;
    for (const chunk of this.remeshLater) {
      if (!this.chunks.has(chunkKey(chunk.cx, chunk.cz))) continue;
      chunk.dirty = true;
      if (!this.meshQueue.includes(chunk)) this.meshQueue.push(chunk);
    }
    this.remeshLater.clear();
  }

  /**
   * Minecraft-like: sources stay; flowing decays by 1 per step, falls first,
   * two horizontal sources create a new source. Plants in the way wash out.
   */
  private tickWaterCell(
    wx: number,
    wy: number,
    wz: number,
    popped: BlockPop[],
  ): void {
    const id = this.getBlock(wx, wy, wz);
    if (isSolid(id) && !isPlant(id)) return;

    const below = this.getBlock(wx, wy - 1, wz);
    const above = this.getBlock(wx, wy + 1, wz);

    let incoming = 0;
    let sources = 0;
    const dirs: [number, number][] = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [dx, dz] of dirs) {
      const n = this.getBlock(wx + dx, wy, wz + dz);
      if (isSourceWater(n)) {
        sources++;
        incoming = Math.max(incoming, 8);
      } else if (isWater(n)) {
        incoming = Math.max(incoming, waterLevel(n));
      }
    }
    if (isWater(above)) incoming = Math.max(incoming, 8);
    if (sources >= 2) incoming = 8;

    const newLevel = incoming >= 8 ? 8 : incoming - 1;
    const isSrc = isSourceWater(id);

    // Source never evaporates or weakens
    if (isSrc) {
      this.tryFloodDown(wx, wy, wz, 7, popped);
      this.tryFloodSides(wx, wy, wz, 7, popped);
      return;
    }

    if (newLevel < 1) {
      if (isWater(id)) this.writeBlock(wx, wy, wz, Block.AIR, false);
      return;
    }

    if (isPlant(id)) {
      if (!this.writeBlock(wx, wy, wz, Block.AIR, false)) return;
      popped.push({ x: wx, y: wy, z: wz, id });
    }

    const desired = waterIdForLevel(newLevel);
    if (this.getBlock(wx, wy, wz) !== desired) {
      this.writeBlock(wx, wy, wz, desired, false);
    }

    // Fall first
    if (this.canWaterEnter(below)) {
      this.placeFlow(wx, wy - 1, wz, Math.max(newLevel, 7), popped);
    }
    if (newLevel > 1) {
      this.tryFloodSides(wx, wy, wz, newLevel - 1, popped);
    }
    void below;
  }

  private canWaterEnter(id: number): boolean {
    return id === Block.AIR || isPlant(id) || (isWater(id) && !isSourceWater(id));
  }

  private tryFloodDown(
    wx: number,
    wy: number,
    wz: number,
    level: number,
    popped: BlockPop[],
  ): void {
    this.placeFlow(wx, wy - 1, wz, level, popped);
  }

  private tryFloodSides(
    wx: number,
    wy: number,
    wz: number,
    level: number,
    popped: BlockPop[],
  ): void {
    if (level < 1) return;
    this.placeFlow(wx + 1, wy, wz, level, popped);
    this.placeFlow(wx - 1, wy, wz, level, popped);
    this.placeFlow(wx, wy, wz + 1, level, popped);
    this.placeFlow(wx, wy, wz - 1, level, popped);
  }

  private placeFlow(
    wx: number,
    wy: number,
    wz: number,
    level: number,
    popped: BlockPop[],
  ): void {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return;
    const cur = this.getBlock(wx, wy, wz);
    if (!this.canWaterEnter(cur)) return;
    if (isPlant(cur)) {
      if (!this.writeBlock(wx, wy, wz, Block.AIR, false)) return;
      popped.push({ x: wx, y: wy, z: wz, id: cur });
    }
    const next = waterIdForLevel(level);
    if (waterLevel(cur) >= waterLevel(next) && isWater(cur)) return;
    this.writeBlock(wx, wy, wz, next, false);
  }

  private randomChunkTicks(px: number, pz: number, out: BlockPop[]): void {
    const [pcx, pcz] = worldToChunk(Math.floor(px), Math.floor(pz));
    const ring = 2; // ~5×5 chunks, nearby only
    let checks = 0;
    const budget = 36;
    for (let dz = -ring; dz <= ring && checks < budget; dz++) {
      for (let dx = -ring; dx <= ring && checks < budget; dx++) {
        const chunk = this.chunks.get(chunkKey(pcx + dx, pcz + dz));
        if (!chunk || chunk.meshLod > 0) continue;
        // A few random columns per nearby chunk
        const samples = 3;
        for (let s = 0; s < samples && checks < budget; s++) {
          this.tickRng = (this.tickRng * 1664525 + 1013904223) >>> 0;
          const lx = this.tickRng % CHUNK_SIZE;
          this.tickRng = (this.tickRng * 1664525 + 1013904223) >>> 0;
          const lz = this.tickRng % CHUNK_SIZE;
          const wx = chunk.cx * CHUNK_SIZE + lx;
          const wz = chunk.cz * CHUNK_SIZE + lz;
          // Scan a short vertical band around the surface (plants live here)
          let top = -1;
          for (let y = CHUNK_HEIGHT - 1; y >= 1; y--) {
            if (chunk.get(lx, y, lz) !== Block.AIR) {
              top = y;
              break;
            }
          }
          if (top < 1) continue;
          const y0 = Math.max(1, top - 2);
          for (let y = y0; y <= top; y++) {
            this.tryPopUnsupported(wx, y, wz, out);
            this.tryGrassSpread(wx, y, wz);
            const id = this.getBlock(wx, y, wz);
            if (isWater(id)) this.queueWater(wx, y, wz);
          }
          checks++;
        }
      }
    }
  }

  private tryPopUnsupported(
    wx: number,
    wy: number,
    wz: number,
    out: BlockPop[],
  ): void {
    const id = this.getBlock(wx, wy, wz);
    if (!isPlant(id) && !isLadderCell(id) && !isDoorCell(id)) return;
    if (isTorch(id)) {
      const [ax, ay, az] = torchAttachDir(id);
      if (canSupportTorch(this.getBlock(wx + ax, wy + ay, wz + az))) return;
    } else if (isLadderCell(id)) {
      const [ax, ay, az] = ladderAttachDir(id);
      if (canSupportLadder(this.getBlock(wx + ax, wy + ay, wz + az))) return;
    } else if (isDoorCell(id)) {
      const mateY = wy + (doorIsUpper(id) ? -1 : 1);
      const mate = this.getBlock(wx, mateY, wz);
      const mateOk = mate === doorMateId(id);
      if (doorIsUpper(id)) {
        if (mateOk) return;
      } else {
        const below = this.getBlock(wx, wy - 1, wz);
        const floorOk =
          isSolid(below) && !isPlant(below) && !isDoor(below) && !isLadder(below);
        if (mateOk && floorOk) return;
      }
      this.writeBlock(wx, wy, wz, Block.AIR, false);
      if (isDoorCell(mate)) this.writeBlock(wx, mateY, wz, Block.AIR, false);
      out.push({ x: wx, y: wy, z: wz, id: Block.DOOR });
      return;
    } else {
      const below = this.getBlock(wx, wy - 1, wz);
      if (isSolid(below) && !isPlant(below)) return;
    }
    if (!this.setBlock(wx, wy, wz, Block.AIR)) return;
    out.push({ x: wx, y: wy, z: wz, id });
  }

  private nextTickRand(): number {
    this.tickRng = (this.tickRng * 1664525 + 1013904223) >>> 0;
    return this.tickRng;
  }

  /** Opaque cube sitting on grass — snow / leaves / plants do not count. */
  private smothersGrass(id: number): boolean {
    if (id === Block.AIR || isPlant(id) || isWater(id)) return false;
    if (id === Block.LEAVES || id === Block.ICE || id === Block.SNOW) return false;
    return isSolid(id);
  }

  private canGrassGrowOn(wx: number, wy: number, wz: number): boolean {
    const above = this.getBlock(wx, wy + 1, wz);
    if (this.smothersGrass(above) || isWater(above)) return false;
    const light = Math.max(
      this.getSkyLight(wx, wy + 1, wz),
      this.getBlockLight(wx, wy + 1, wz),
    );
    return light >= 8;
  }

  private grassKindFor(wx: number, wy: number, wz: number, src: number): number {
    const above = this.getBlock(wx, wy + 1, wz);
    if (src === Block.SNOW_GRASS || above === Block.SNOW) return Block.SNOW_GRASS;
    return Block.GRASS;
  }

  private trySmotherGrass(wx: number, wy: number, wz: number): void {
    const id = this.getBlock(wx, wy, wz);
    if (id !== Block.GRASS && id !== Block.SNOW_GRASS) return;
    if (!this.smothersGrass(this.getBlock(wx, wy + 1, wz))) return;
    this.writeBlock(wx, wy, wz, Block.DIRT, false);
  }

  /**
   * Very slow Minecraft-like spread: a ticked grass/dirt cell may convert
   * one nearby dirt if it has light and isn't buried.
   */
  private tryGrassSpread(wx: number, wy: number, wz: number): void {
    const id = this.getBlock(wx, wy, wz);
    if (id === Block.GRASS || id === Block.SNOW_GRASS) {
      this.trySmotherGrass(wx, wy, wz);
      if (this.getBlock(wx, wy, wz) !== id) return;
      // Most attempts are same-level cardinal dirt; rarely step up/down
      let tx = wx;
      let ty = wy;
      let tz = wz;
      if ((this.nextTickRand() % 5) === 0) {
        tx += (this.nextTickRand() % 3) - 1;
        ty += (this.nextTickRand() % 5) - 2;
        tz += (this.nextTickRand() % 3) - 1;
      } else {
        const dirs: [number, number][] = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ];
        const [dx, dz] = dirs[this.nextTickRand() % 4]!;
        tx += dx;
        tz += dz;
      }
      if (tx === wx && ty === wy && tz === wz) return;
      if (this.getBlock(tx, ty, tz) !== Block.DIRT) return;
      if (!this.canGrassGrowOn(tx, ty, tz)) return;
      this.writeBlock(tx, ty, tz, this.grassKindFor(tx, ty, tz, id), false);
      return;
    }
    if (id !== Block.DIRT) return;
    if (!this.canGrassGrowOn(wx, wy, wz)) return;
    // Dirt is even slower — only look for a donor if it wins a 1/4 roll
    if ((this.nextTickRand() & 3) !== 0) return;
    const dirs: [number, number, number][] = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 0, 1],
      [0, 0, -1],
      [1, 1, 0],
      [-1, 1, 0],
      [0, 1, 1],
      [0, 1, -1],
      [1, -1, 0],
      [-1, -1, 0],
      [0, -1, 1],
      [0, -1, -1],
    ];
    const [dx, dy, dz] = dirs[this.nextTickRand() % dirs.length]!;
    const src = this.getBlock(wx + dx, wy + dy, wz + dz);
    if (src !== Block.GRASS && src !== Block.SNOW_GRASS) return;
    if (this.smothersGrass(this.getBlock(wx + dx, wy + dy + 1, wz + dz))) return;
    this.writeBlock(wx, wy, wz, this.grassKindFor(wx, wy, wz, src), false);
  }

  /**
   * Instant grow: dirt → grass, or burst plants on / around grass.
   * Returns true if something changed (consume bone meal).
   */
  applyBoneMeal(wx: number, wy: number, wz: number): boolean {
    const id = this.getBlock(wx, wy, wz);
    if (id === Block.DIRT) {
      if (!this.canGrassGrowOn(wx, wy, wz)) return false;
      this.writeBlock(wx, wy, wz, this.grassKindFor(wx, wy, wz, Block.GRASS), true);
      return true;
    }
    let gx = wx;
    let gy = wy;
    let gz = wz;
    if (isPlant(id) && !isTorch(id)) {
      gx = wx;
      gy = wy - 1;
      gz = wz;
    }
    const ground = this.getBlock(gx, gy, gz);
    if (ground !== Block.GRASS && ground !== Block.SNOW_GRASS) return false;

    const flowers = [
      Block.SHORT_GRASS,
      Block.SHORT_GRASS,
      Block.FERN,
      Block.POPPY,
      Block.DANDELION,
      Block.CORNFLOWER,
      Block.ALLIUM,
      Block.OXEYE_DAISY,
      Block.TULIP_RED,
      Block.TULIP_PINK,
    ];
    let grew = 0;
    for (let i = 0; i < 14; i++) {
      const dx = ((this.nextTickRand() % 7) - 3) | 0;
      const dz = ((this.nextTickRand() % 7) - 3) | 0;
      const tx = gx + dx;
      const tz = gz + dz;
      const ty = gy + ((this.nextTickRand() % 3) - 1);
      const g = this.getBlock(tx, ty, tz);
      if (g !== Block.GRASS && g !== Block.SNOW_GRASS && g !== Block.DIRT) continue;
      if (g === Block.DIRT) {
        if (this.canGrassGrowOn(tx, ty, tz)) {
          this.writeBlock(tx, ty, tz, this.grassKindFor(tx, ty, tz, ground), true);
          grew++;
        }
        continue;
      }
      const above = this.getBlock(tx, ty + 1, tz);
      if (above !== Block.AIR) continue;
      const plant = flowers[this.nextTickRand() % flowers.length]!;
      this.writeBlock(tx, ty + 1, tz, plant, true);
      grew++;
    }
    return grew > 0;
  }

  private recordEdit(
    cx: number,
    cz: number,
    lx: number,
    y: number,
    lz: number,
    id: number,
  ): void {
    const key = chunkKey(cx, cz);
    let m = this.voxelEdits.get(key);
    if (!m) {
      m = new Map();
      this.voxelEdits.set(key, m);
    }
    m.set(packEdit(lx, y, lz), id & 255);
    this.editsDirty = true;
  }

  private applyEditsToChunk(chunk: Chunk): void {
    const m = this.voxelEdits.get(chunkKey(chunk.cx, chunk.cz));
    if (!m || m.size === 0) return;
    for (const [k, id] of m) {
      const { lx, y, lz } = unpackEdit(k);
      if (y < 0 || y >= CHUNK_HEIGHT) continue;
      chunk.set(lx, y, lz, id);
    }
    chunk.lightDirty = true;
    chunk.dirty = true;
  }

  importEdits(data: Record<string, number[]>): void {
    this.voxelEdits.clear();
    for (const [key, flat] of Object.entries(data)) {
      if (!flat || flat.length < 2) continue;
      const m = new Map<number, number>();
      for (let i = 0; i + 1 < flat.length; i += 2) {
        m.set(flat[i]! | 0, flat[i + 1]! & 255);
      }
      this.voxelEdits.set(key as ChunkKey, m);
    }
    this.editsDirty = false;
  }

  exportEdits(): Record<string, number[]> {
    const out: Record<string, number[]> = {};
    for (const [key, m] of this.voxelEdits) {
      if (m.size === 0) continue;
      const flat: number[] = [];
      for (const [k, id] of m) {
        flat.push(k, id);
      }
      out[key] = flat;
    }
    return out;
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

    this.flushTickRemesh();

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
        this.dropChestsInChunk(chunk);
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
        this.generateSync(this.lastPcx + dx, this.lastPcz + dz);
      }
    }
    // Generate the ring first, then mesh — so lighting can read neighbors.
    for (let dz = -rSync; dz <= rSync; dz++) {
      for (let dx = -rSync; dx <= rSync; dx++) {
        if (dx * dx + dz * dz > rSync * rSync + 1) continue;
        const chunk = this.chunks.get(
          chunkKey(this.lastPcx + dx, this.lastPcz + dz),
        );
        if (chunk && (chunk.dirty || !chunk.mesh)) this.remeshChunk(chunk);
      }
    }
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

    this.ensureLitNeighbors(chunk);
    if (chunk.lightDirty || !chunk.skyLight) {
      this.relightChunk(chunk);
    }

    const getLight = (wx: number, wy: number, wz: number) => ({
      block: this.getBlockLight(wx, wy, wz),
      sky: this.getSkyLight(wx, wy, wz),
    });

    const geo = buildChunkGeometry(chunk, getBlock, lod, undefined, getLight);
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

  /** First water surface or solid top — rain should stop here, not the seafloor. */
  getRainHitY(wx: number, wz: number): number {
    for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
      const id = this.getBlock(wx, y, wz);
      if (isWater(id)) return y + (id === Block.WATER ? 0.92 : 0.4);
      if (isSolid(id) && !isPlant(id)) return y + 1;
    }
    return 0;
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
      if (isWater(id) || id === Block.ICE) return null;
      if (isSolid(id)) return null;
    }

    // Surface block itself shouldn't be underwater column
    // (water might sit beside; only care about this column)
    return feet;
  }

  /** Snapshot of async gen / mesh queues for the debug HUD. */
  getQueueStats(): {
    queued: number;
    generating: number;
    mesh: number;
    loaded: number;
    workers: number;
    idleWorkers: number;
  } {
    return {
      queued: this.genQueue.length,
      generating: this.generating.size,
      mesh: this.meshQueue.length,
      loaded: this.chunks.size,
      workers: this.workers.length,
      idleWorkers: this.idleWorkers.length,
    };
  }
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
