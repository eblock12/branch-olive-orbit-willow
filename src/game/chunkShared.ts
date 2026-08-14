import { CHUNK_HEIGHT, CHUNK_SIZE } from "./chunkConstants";

/** One column-major chunk of block ids. */
export const VOXEL_BYTES = CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT;
/** blocks + sky + block-light */
export const SLOT_PAYLOAD = VOXEL_BYTES * 3;

/**
 * Slots cover the loaded world + in-flight gen.
 * 16-radius ≈ 800 chunks; 1024 leaves headroom for the ready queue.
 */
export const SLOT_COUNT = 1024;

export const SLOT_FREE = 0;
export const SLOT_BUSY = 1;
export const SLOT_READY = 2;
export const SLOT_BOUND = 3;

/** Int32 fields per voxel slot */
export const CTRL_STATUS = 0;
export const CTRL_JOB = 1;
export const CTRL_CX = 2;
export const CTRL_CZ = 3;
export const CTRL_STRIDE = 8;

/** Scratch slots for worker-built meshes (not one-per-chunk). */
export const MESH_SLOT_COUNT = 8;
export const MESH_FREE = 0;
export const MESH_BUSY = 1;
export const MESH_READY = 2;

export const MAX_SOLID_VERTS = 49152;
export const MAX_SOLID_IDX = 73728;
export const MAX_WATER_VERTS = 16384;
export const MAX_WATER_IDX = 24576;

export const MH_STATUS = 0;
export const MH_VERTS = 1;
export const MH_IDX = 2;
export const MH_WVERTS = 3;
export const MH_WIDX = 4;
export const MH_OVERFLOW = 5;
export const MH_STRIDE = 8;

const F32 = 4;
const solidFloats =
  MAX_SOLID_VERTS * 3 +
  MAX_SOLID_VERTS * 3 +
  MAX_SOLID_VERTS * 2 +
  MAX_SOLID_VERTS * 3 +
  MAX_SOLID_VERTS +
  MAX_SOLID_VERTS * 2;
const waterFloats =
  MAX_WATER_VERTS * 3 + MAX_WATER_VERTS * 3 + MAX_WATER_VERTS * 3;
export const MESH_PAYLOAD_BYTES =
  solidFloats * F32 +
  MAX_SOLID_IDX * 4 +
  waterFloats * F32 +
  MAX_WATER_IDX * 4;

export type ChunkShare = {
  control: SharedArrayBuffer;
  voxels: SharedArrayBuffer;
  meshControl: SharedArrayBuffer;
  mesh: SharedArrayBuffer;
  ctrl: Int32Array;
  meshCtrl: Int32Array;
  slotCount: number;
};

export function sharedMemoryAvailable(): boolean {
  try {
    if (typeof SharedArrayBuffer === "undefined") return false;
    if (typeof crossOriginIsolated !== "undefined" && !crossOriginIsolated) {
      return false;
    }
    new SharedArrayBuffer(8);
    return true;
  } catch {
    return false;
  }
}

export function createChunkShare(): ChunkShare | null {
  if (!sharedMemoryAvailable()) return null;
  try {
    const control = new SharedArrayBuffer(SLOT_COUNT * CTRL_STRIDE * 4);
    const voxels = new SharedArrayBuffer(SLOT_COUNT * SLOT_PAYLOAD);
    const meshControl = new SharedArrayBuffer(MESH_SLOT_COUNT * MH_STRIDE * 4);
    const mesh = new SharedArrayBuffer(MESH_SLOT_COUNT * MESH_PAYLOAD_BYTES);
    return {
      control,
      voxels,
      meshControl,
      mesh,
      ctrl: new Int32Array(control),
      meshCtrl: new Int32Array(meshControl),
      slotCount: SLOT_COUNT,
    };
  } catch {
    return null;
  }
}

export function ctrlIndex(slot: number, field: number): number {
  return slot * CTRL_STRIDE + field;
}

export function voxelView(voxels: SharedArrayBuffer, slot: number): Uint8Array {
  return new Uint8Array(voxels, slot * SLOT_PAYLOAD, VOXEL_BYTES);
}

export function skyView(voxels: SharedArrayBuffer, slot: number): Uint8Array {
  return new Uint8Array(voxels, slot * SLOT_PAYLOAD + VOXEL_BYTES, VOXEL_BYTES);
}

export function blkView(voxels: SharedArrayBuffer, slot: number): Uint8Array {
  return new Uint8Array(
    voxels,
    slot * SLOT_PAYLOAD + VOXEL_BYTES * 2,
    VOXEL_BYTES,
  );
}

export function allocSlot(ctrl: Int32Array, slotCount = SLOT_COUNT): number {
  for (let i = 0; i < slotCount; i++) {
    if (
      Atomics.compareExchange(
        ctrl,
        ctrlIndex(i, CTRL_STATUS),
        SLOT_FREE,
        SLOT_BUSY,
      ) === SLOT_FREE
    ) {
      return i;
    }
  }
  return -1;
}

export function writeSlotJob(
  ctrl: Int32Array,
  slot: number,
  jobId: number,
  cx: number,
  cz: number,
): void {
  Atomics.store(ctrl, ctrlIndex(slot, CTRL_JOB), jobId);
  Atomics.store(ctrl, ctrlIndex(slot, CTRL_CX), cx);
  Atomics.store(ctrl, ctrlIndex(slot, CTRL_CZ), cz);
}

export function markSlot(ctrl: Int32Array, slot: number, status: number): void {
  Atomics.store(ctrl, ctrlIndex(slot, CTRL_STATUS), status);
}

export function freeSlot(ctrl: Int32Array, slot: number): void {
  Atomics.store(ctrl, ctrlIndex(slot, CTRL_JOB), 0);
  Atomics.store(ctrl, ctrlIndex(slot, CTRL_STATUS), SLOT_FREE);
}

export function allocMeshSlot(meshCtrl: Int32Array): number {
  for (let i = 0; i < MESH_SLOT_COUNT; i++) {
    if (
      Atomics.compareExchange(
        meshCtrl,
        i * MH_STRIDE + MH_STATUS,
        MESH_FREE,
        MESH_BUSY,
      ) === MESH_FREE
    ) {
      Atomics.store(meshCtrl, i * MH_STRIDE + MH_OVERFLOW, 0);
      return i;
    }
  }
  return -1;
}

export function freeMeshSlot(meshCtrl: Int32Array, slot: number): void {
  Atomics.store(meshCtrl, slot * MH_STRIDE + MH_STATUS, MESH_FREE);
}

export function markMeshReady(meshCtrl: Int32Array, slot: number): void {
  Atomics.store(meshCtrl, slot * MH_STRIDE + MH_STATUS, MESH_READY);
}

export type MeshScratchViews = {
  pos: Float32Array;
  nrm: Float32Array;
  uv: Float32Array;
  col: Float32Array;
  wind: Float32Array;
  light: Float32Array;
  idx: Uint32Array;
  wpos: Float32Array;
  wnrm: Float32Array;
  wcol: Float32Array;
  widx: Uint32Array;
};

export function meshViews(
  mesh: SharedArrayBuffer,
  slot: number,
): MeshScratchViews {
  let off = slot * MESH_PAYLOAD_BYTES;
  const takeF = (n: number) => {
    const a = new Float32Array(mesh, off, n);
    off += n * 4;
    return a;
  };
  const takeU = (n: number) => {
    const a = new Uint32Array(mesh, off, n);
    off += n * 4;
    return a;
  };
  return {
    pos: takeF(MAX_SOLID_VERTS * 3),
    nrm: takeF(MAX_SOLID_VERTS * 3),
    uv: takeF(MAX_SOLID_VERTS * 2),
    col: takeF(MAX_SOLID_VERTS * 3),
    wind: takeF(MAX_SOLID_VERTS),
    light: takeF(MAX_SOLID_VERTS * 2),
    idx: takeU(MAX_SOLID_IDX),
    wpos: takeF(MAX_WATER_VERTS * 3),
    wnrm: takeF(MAX_WATER_VERTS * 3),
    wcol: takeF(MAX_WATER_VERTS * 3),
    widx: takeU(MAX_WATER_IDX),
  };
}

export function writeMeshHeader(
  meshCtrl: Int32Array,
  slot: number,
  verts: number,
  idx: number,
  wverts: number,
  widx: number,
  overflow: number,
): void {
  const b = slot * MH_STRIDE;
  Atomics.store(meshCtrl, b + MH_VERTS, verts);
  Atomics.store(meshCtrl, b + MH_IDX, idx);
  Atomics.store(meshCtrl, b + MH_WVERTS, wverts);
  Atomics.store(meshCtrl, b + MH_WIDX, widx);
  Atomics.store(meshCtrl, b + MH_OVERFLOW, overflow);
}

export function readMeshHeader(
  meshCtrl: Int32Array,
  slot: number,
): {
  verts: number;
  idx: number;
  wverts: number;
  widx: number;
  overflow: boolean;
} {
  const b = slot * MH_STRIDE;
  return {
    verts: Atomics.load(meshCtrl, b + MH_VERTS),
    idx: Atomics.load(meshCtrl, b + MH_IDX),
    wverts: Atomics.load(meshCtrl, b + MH_WVERTS),
    widx: Atomics.load(meshCtrl, b + MH_WIDX),
    overflow: Atomics.load(meshCtrl, b + MH_OVERFLOW) !== 0,
  };
}
