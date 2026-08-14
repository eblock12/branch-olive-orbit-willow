/// <reference lib="webworker" />
import { generateChunkBlocks } from "./chunkGen";
import {
  Chunk,
  CHUNK_HEIGHT,
  CHUNK_SIZE,
  buildChunkGeometry,
  buildChunkWaterGeometry,
  worldToChunk,
  type ChunkLod,
} from "./chunk";
import { computeChunkLighting, estimateSkyInBlocks } from "./lighting";
import {
  blkView,
  markMeshReady,
  markSlot,
  MAX_SOLID_IDX,
  MAX_SOLID_VERTS,
  MAX_WATER_IDX,
  MAX_WATER_VERTS,
  meshViews,
  SLOT_READY,
  skyView,
  voxelView,
  writeMeshHeader,
} from "./chunkShared";

export type ChunkWorkerInit = {
  type: "init";
  control: SharedArrayBuffer;
  voxels: SharedArrayBuffer;
  meshControl: SharedArrayBuffer;
  mesh: SharedArrayBuffer;
};

export type ChunkWorkerGen = {
  type: "gen";
  id: number;
  cx: number;
  cz: number;
  seed: number;
  slot: number;
};

export type ChunkWorkerMesh = {
  type: "mesh";
  id: number;
  cx: number;
  cz: number;
  slot: number;
  meshSlot: number;
  lod: ChunkLod;
  /** +X, -X, +Z, -Z voxel slots or -1 */
  neigh: [number, number, number, number];
  /** Same order: neighbor light maps are valid */
  neighLit: [boolean, boolean, boolean, boolean];
  epoch: number;
  seed: number;
};

export type ChunkWorkerLegacy = {
  id: number;
  cx: number;
  cz: number;
  seed: number;
};

export type ChunkWorkerRequest =
  | ChunkWorkerInit
  | ChunkWorkerGen
  | ChunkWorkerMesh
  | ChunkWorkerLegacy;

export type ChunkWorkerResponse = {
  type?: "done" | "meshed";
  id: number;
  cx: number;
  cz: number;
  seed?: number;
  slot?: number;
  meshSlot?: number;
  lod?: ChunkLod;
  epoch?: number;
  overflow?: boolean;
  emitters?: number[];
  blocks?: Uint8Array;
};

const ctx: DedicatedWorkerGlobalScope =
  self as unknown as DedicatedWorkerGlobalScope;

let voxels: SharedArrayBuffer | null = null;
let ctrl: Int32Array | null = null;
let mesh: SharedArrayBuffer | null = null;
let meshCtrl: Int32Array | null = null;

ctx.onmessage = (ev: MessageEvent<ChunkWorkerRequest>) => {
  const data = ev.data;
  if ("type" in data && data.type === "init") {
    ctrl = new Int32Array(data.control);
    voxels = data.voxels;
    meshCtrl = new Int32Array(data.meshControl);
    mesh = data.mesh;
    return;
  }

  if ("type" in data && data.type === "gen" && voxels && ctrl) {
    const view = voxelView(voxels, data.slot);
    generateChunkBlocks(data.cx, data.cz, data.seed, view);
    markSlot(ctrl, data.slot, SLOT_READY);
    const res: ChunkWorkerResponse = {
      type: "done",
      id: data.id,
      cx: data.cx,
      cz: data.cz,
      seed: data.seed,
      slot: data.slot,
    };
    ctx.postMessage(res);
    return;
  }

  if ("type" in data && data.type === "mesh" && voxels && mesh && meshCtrl) {
    bakeMesh(data);
    return;
  }

  const legacy = data as ChunkWorkerLegacy;
  const blocks = generateChunkBlocks(legacy.cx, legacy.cz, legacy.seed);
  const res: ChunkWorkerResponse = {
    id: legacy.id,
    cx: legacy.cx,
    cz: legacy.cz,
    seed: legacy.seed,
    blocks,
  };
  ctx.postMessage(res, [blocks.buffer]);
};

function bakeMesh(job: ChunkWorkerMesh): void {
  const vox = voxels!;
  const chunk = new Chunk(job.cx, job.cz);
  chunk.applyBlocks(voxelView(vox, job.slot));
  chunk.skyLight = skyView(vox, job.slot);
  chunk.blockLight = blkView(vox, job.slot);
  chunk.sharedSlot = job.slot;

  const neighViews: (Uint8Array | null)[] = job.neigh.map((s) =>
    s >= 0 ? voxelView(vox, s) : null,
  );
  const neighSky: (Uint8Array | null)[] = job.neigh.map((s) =>
    s >= 0 ? skyView(vox, s) : null,
  );
  const neighBlk: (Uint8Array | null)[] = job.neigh.map((s) =>
    s >= 0 ? blkView(vox, s) : null,
  );
  const neighCx = [job.cx + 1, job.cx - 1, job.cx, job.cx];
  const neighCz = [job.cz, job.cz, job.cz + 1, job.cz - 1];

  const sampleVox = (wx: number, wy: number, wz: number): number => {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return 0;
    const [cx, cz] = worldToChunk(wx, wz);
    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const i = lx + lz * CHUNK_SIZE + wy * CHUNK_SIZE * CHUNK_SIZE;
    if (cx === job.cx && cz === job.cz) return chunk.blocks[i]!;
    for (let n = 0; n < 4; n++) {
      if (cx === neighCx[n] && cz === neighCz[n] && neighViews[n]) {
        return neighViews[n]![i]!;
      }
    }
    return 0;
  };

  const sampleSky = (wx: number, wy: number, wz: number): number => {
    if (wy >= CHUNK_HEIGHT) return 15;
    if (wy < 0) return 0;
    const [cx, cz] = worldToChunk(wx, wz);
    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const i = lx + lz * CHUNK_SIZE + wy * CHUNK_SIZE * CHUNK_SIZE;
    if (cx === job.cx && cz === job.cz) {
      return chunk.skyLight ? chunk.skyLight[i]! : 15;
    }
    for (let n = 0; n < 4; n++) {
      if (cx !== neighCx[n] || cz !== neighCz[n]) continue;
      if (job.neighLit[n] && neighSky[n]) return neighSky[n]![i]!;
      if (neighViews[n]) return estimateSkyInBlocks(neighViews[n]!, lx, wy, lz);
    }
    return 15;
  };

  const sampleBlk = (wx: number, wy: number, wz: number): number => {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return 0;
    const [cx, cz] = worldToChunk(wx, wz);
    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const i = lx + lz * CHUNK_SIZE + wy * CHUNK_SIZE * CHUNK_SIZE;
    if (cx === job.cx && cz === job.cz) {
      return chunk.blockLight ? chunk.blockLight[i]! : 0;
    }
    for (let n = 0; n < 4; n++) {
      if (cx !== neighCx[n] || cz !== neighCz[n]) continue;
      if (job.neighLit[n] && neighBlk[n]) return neighBlk[n]![i]!;
      return 0;
    }
    return 0;
  };

  if (job.lod < 2) {
    computeChunkLighting(chunk, sampleSky, sampleBlk);
  }

  const getLight = (wx: number, wy: number, wz: number) => ({
    block: sampleBlk(wx, wy, wz),
    sky: sampleSky(wx, wy, wz),
  });
  const isLoaded = (wx: number, wz: number) => {
    const [cx, cz] = worldToChunk(wx, wz);
    if (cx === job.cx && cz === job.cz) return true;
    for (let n = 0; n < 4; n++) {
      if (cx === neighCx[n] && cz === neighCz[n] && job.neigh[n]! >= 0) {
        return true;
      }
    }
    return false;
  };

  const geo = buildChunkGeometry(chunk, sampleVox, job.lod, undefined, getLight, job.seed);
  const wgeo = buildChunkWaterGeometry(chunk, sampleVox, job.lod, isLoaded);

  const views = meshViews(mesh!, job.meshSlot);
  let overflow = false;
  let verts = 0;
  let idx = 0;
  let wverts = 0;
  let widx = 0;

  if (geo) {
    const p = geo.getAttribute("position")!.array;
    verts = (p.length / 3) | 0;
    const ia = geo.getIndex()?.array;
    idx = ia ? ia.length : 0;
    if (verts > MAX_SOLID_VERTS || idx > MAX_SOLID_IDX) overflow = true;
    else {
      views.pos.set(p as ArrayLike<number>);
      views.nrm.set(geo.getAttribute("normal")!.array as ArrayLike<number>);
      views.uv.set(geo.getAttribute("uv")!.array as ArrayLike<number>);
      views.col.set(geo.getAttribute("color")!.array as ArrayLike<number>);
      views.wind.set(geo.getAttribute("wind")!.array as ArrayLike<number>);
      views.light.set(geo.getAttribute("light")!.array as ArrayLike<number>);
      if (ia) views.idx.set(ia as ArrayLike<number>);
    }
    geo.dispose();
  }
  if (wgeo && !overflow) {
    const p = wgeo.getAttribute("position")!.array;
    wverts = (p.length / 3) | 0;
    const ia = wgeo.getIndex()?.array;
    widx = ia ? ia.length : 0;
    if (wverts > MAX_WATER_VERTS || widx > MAX_WATER_IDX) overflow = true;
    else {
      views.wpos.set(p as ArrayLike<number>);
      views.wnrm.set(wgeo.getAttribute("normal")!.array as ArrayLike<number>);
      views.wcol.set(wgeo.getAttribute("color")!.array as ArrayLike<number>);
      if (ia) views.widx.set(ia as ArrayLike<number>);
    }
    wgeo.dispose();
  } else if (wgeo) {
    wgeo.dispose();
  }

  writeMeshHeader(
    meshCtrl!,
    job.meshSlot,
    overflow ? 0 : verts,
    overflow ? 0 : idx,
    overflow ? 0 : wverts,
    overflow ? 0 : widx,
    overflow ? 1 : 0,
  );
  markMeshReady(meshCtrl!, job.meshSlot);

  const res: ChunkWorkerResponse = {
    type: "meshed",
    id: job.id,
    cx: job.cx,
    cz: job.cz,
    slot: job.slot,
    meshSlot: job.meshSlot,
    lod: job.lod,
    epoch: job.epoch,
    overflow,
    emitters: chunk.emitters.slice(),
  };
  ctx.postMessage(res);
}
