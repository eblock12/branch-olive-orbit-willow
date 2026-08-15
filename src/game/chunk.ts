import * as THREE from "three";
import { Block, BLOCKS, isSolid, isTransparent, isPlant, isWater, isTorch, isDoor, isDoorCell, isLadder, isLadderCell, isSlab, isStairCell, isLeaves, isPortal, stairFacing, shapeMaterial, doorPlane, waterLevel, lightEmission } from "./blocks";
import { tileUVs } from "./textures";
import { grassTintMul } from "./biomes";

export { CHUNK_SIZE, CHUNK_HEIGHT, SEA_LEVEL } from "./chunkConstants";
import { CHUNK_SIZE, CHUNK_HEIGHT } from "./chunkConstants";
import { generateChunkBlocks } from "./chunkGen";

export type ChunkKey = string;

/** 0 = full, 1 = 2× downsampled, 2 = heightfield surface only */
export type ChunkLod = 0 | 1 | 2;

export function chunkKey(cx: number, cz: number): ChunkKey {
  return `${cx},${cz}`;
}

export function worldToChunk(wx: number, wz: number): [number, number] {
  return [Math.floor(wx / CHUNK_SIZE), Math.floor(wz / CHUNK_SIZE)];
}

/** Chunk-ring distance → LOD (cheaper meshes farther away)
 *  Tuned for view radius ~24.
 */
export function lodFromChunkDist(dx: number, dz: number): ChunkLod {
  const d = Math.hypot(dx, dz);
  if (d <= 7) return 0; // ~0–112 blocks — full detail
  if (d <= 13) return 1; // mid ring with foliage
  return 2; // far ring to view edge (~24)
}





export class Chunk {
  readonly cx: number;
  readonly cz: number;
  blocks: Uint8Array;
  skyLight: Uint8Array | null = null;
  blockLight: Uint8Array | null = null;
  lightDirty = true;
  /** World XYZ of light emitters in this chunk (x,y,z triples) */
  emitters: number[] = [];
  mesh: THREE.Mesh | null = null;
  waterMesh: THREE.Mesh | null = null;
  dirty = true;
  /** LOD currently built into mesh (-1 = none) */
  meshLod: number = -1;
  /** Desired LOD from distance */
  targetLod: ChunkLod = 0;
  /** SAB voxel slot, or -1 if this chunk owns a private buffer */
  sharedSlot = -1;
  /** Bumps when the CPU mesh is stale vs an in-flight worker bake */
  meshEpoch = 0;
  /** True after sky/block light has been computed into the maps */
  lightReady = false;
  /** Bitmask of neighbor dirs (+X=1,-X=2,+Z=4,-Z=8) that were lit when last baked */
  bakeMask = 0;

  constructor(cx: number, cz: number) {
    this.cx = cx;
    this.cz = cz;
    this.blocks = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT);
  }

  ensureLight(): void {
    const n = CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT;
    if (!this.skyLight || this.skyLight.length !== n) {
      this.skyLight = new Uint8Array(n);
      this.blockLight = new Uint8Array(n);
    }
  }

  lightIndex(x: number, y: number, z: number): number {
    return x + z * CHUNK_SIZE + y * CHUNK_SIZE * CHUNK_SIZE;
  }

  getSky(x: number, y: number, z: number): number {
    if (!this.skyLight) return 15;
    if (x < 0 || y < 0 || z < 0 || x >= CHUNK_SIZE || z >= CHUNK_SIZE || y >= CHUNK_HEIGHT)
      return 15;
    return this.skyLight[this.lightIndex(x, y, z)]!;
  }

  getBlkLight(x: number, y: number, z: number): number {
    if (!this.blockLight) return 0;
    if (x < 0 || y < 0 || z < 0 || x >= CHUNK_SIZE || z >= CHUNK_SIZE || y >= CHUNK_HEIGHT)
      return 0;
    return this.blockLight[this.lightIndex(x, y, z)]!;
  }

  index(x: number, y: number, z: number): number {
    return x + z * CHUNK_SIZE + y * CHUNK_SIZE * CHUNK_SIZE;
  }

  get(x: number, y: number, z: number): number {
    if (x < 0 || y < 0 || z < 0 || x >= CHUNK_SIZE || z >= CHUNK_SIZE || y >= CHUNK_HEIGHT)
      return Block.AIR;
    return this.blocks[this.index(x, y, z)]!;
  }

  set(x: number, y: number, z: number, id: number): void {
    if (x < 0 || y < 0 || z < 0 || x >= CHUNK_SIZE || z >= CHUNK_SIZE || y >= CHUNK_HEIGHT) return;
    this.blocks[this.index(x, y, z)] = id;
    this.dirty = true;
  }

  generate(seed: number): void {
    this.blocks = generateChunkBlocks(this.cx, this.cz, seed);
    this.dirty = true;
    this.lightDirty = true;
    this.emitters.length = 0;
  }

  applyBlocks(blocks: Uint8Array): void {
    this.blocks = blocks;
    this.dirty = true;
    this.lightDirty = true;
    this.emitters.length = 0;
  }

  dispose(): void {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    if (this.waterMesh) {
      this.waterMesh.geometry.dispose();
      this.waterMesh = null;
    }
    this.meshLod = -1;
  }
}

// Face data: +Y, -Y, +X, -X, +Z, -Z
const FACES: {
  dir: [number, number, number];
  corners: [number, number, number][];
}[] = [
  {
    dir: [0, 1, 0],
    corners: [
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
      [0, 1, 0],
    ],
  },
  {
    dir: [0, -1, 0],
    corners: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
  },
  {
    dir: [1, 0, 0],
    corners: [
      [1, 0, 1],
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
    ],
  },
  {
    dir: [-1, 0, 0],
    corners: [
      [0, 0, 0],
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
    ],
  },
  {
    dir: [0, 0, 1],
    corners: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ],
  },
  {
    dir: [0, 0, -1],
    corners: [
      [1, 0, 0],
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
    ],
  },
];

const FACE_SHADE = [1.0, 0.72, 0.84, 0.84, 0.92, 0.92];

/**
 * Vertex ambient occlusion levels (Minecraft-style).
 * Returns 0..3 where 3 = open (bright), 0 = fully occluded (dark corner).
 */
function aoLevel(side1: boolean, side2: boolean, corner: boolean): number {
  if (side1 && side2) return 0;
  return 3 - (Number(side1) + Number(side2) + Number(corner));
}

/** Map AO level → multiplicative darkening (cheap baked AO). */
function aoShade(level: number): number {
  // 3 → 1.0, 2 → 0.8, 1 → 0.65, 0 → 0.5
  return 0.5 + (level / 3) * 0.5;
}

/**
 * Solid occluder for AO (full cubes only — leaves/water/plants don't cast AO).
 */
function sampleOcc(
  chunk: Chunk,
  getBlock: NeighborGetter,
  baseX: number,
  baseZ: number,
  wx: number,
  wy: number,
  wz: number,
): boolean {
  if (wy < 0) return true;
  if (wy >= CHUNK_HEIGHT) return false;
  const lx = wx - baseX;
  const lz = wz - baseZ;
  let id: number;
  if (
    lx >= 0 &&
    lz >= 0 &&
    lx < CHUNK_SIZE &&
    lz < CHUNK_SIZE
  ) {
    id = chunk.get(lx, wy, lz);
  } else {
    id = getBlock(wx, wy, wz);
  }
  return isOccluder(id);
}

/**
 * Per-corner AO for a unit face on block at (bx,by,bz).
 * Corners match FACES[faceIdx].corners order.
 */
function faceCornerAO(
  chunk: Chunk,
  getBlock: NeighborGetter,
  baseX: number,
  baseZ: number,
  bx: number,
  by: number,
  bz: number,
  faceIdx: number,
): [number, number, number, number] {
  const face = FACES[faceIdx]!;
  const [nx, ny, nz] = face.dir;
  const out: [number, number, number, number] = [1, 1, 1, 1];

  for (let i = 0; i < 4; i++) {
    const c = face.corners[i]!;
    let s1: boolean;
    let s2: boolean;
    let sc: boolean;

    if (ny !== 0) {
      // ±Y: sample in the air plane along X/Z
      const u = c[0]!; // 0|1
      const v = c[2]!;
      const oy = by + (ny > 0 ? 1 : -1);
      const sx = bx + (u === 0 ? -1 : 1);
      const sz = bz + (v === 0 ? -1 : 1);
      s1 = sampleOcc(chunk, getBlock, baseX, baseZ, sx, oy, bz + v);
      s2 = sampleOcc(chunk, getBlock, baseX, baseZ, bx + u, oy, sz);
      sc = sampleOcc(chunk, getBlock, baseX, baseZ, sx, oy, sz);
    } else if (nx !== 0) {
      // ±X: sample along Y/Z
      const u = c[1]!;
      const v = c[2]!;
      const ox = bx + (nx > 0 ? 1 : -1);
      const sy = by + (u === 0 ? -1 : 1);
      const sz = bz + (v === 0 ? -1 : 1);
      s1 = sampleOcc(chunk, getBlock, baseX, baseZ, ox, sy, bz + v);
      s2 = sampleOcc(chunk, getBlock, baseX, baseZ, ox, by + u, sz);
      sc = sampleOcc(chunk, getBlock, baseX, baseZ, ox, sy, sz);
    } else {
      // ±Z: sample along X/Y
      const u = c[0]!;
      const v = c[1]!;
      const oz = bz + (nz > 0 ? 1 : -1);
      const sx = bx + (u === 0 ? -1 : 1);
      const sy = by + (v === 0 ? -1 : 1);
      s1 = sampleOcc(chunk, getBlock, baseX, baseZ, sx, by + v, oz);
      s2 = sampleOcc(chunk, getBlock, baseX, baseZ, bx + u, sy, oz);
      sc = sampleOcc(chunk, getBlock, baseX, baseZ, sx, sy, oz);
    }

    out[i] = aoShade(aoLevel(s1, s2, sc));
  }
  return out;
}

type NeighborGetter = (wx: number, wy: number, wz: number) => number;

/** Optional: true if the chunk containing world XZ is loaded (for border culling) */
export type ChunkLoadedFn = (wx: number, wz: number) => boolean;


function windFactorFor(id: number): number {
  if (isTorch(id)) return 0.18;
  if (isLeaves(id)) return 1;
  if (isPlant(id)) return 0.85;
  return 0;
}

export type LightSample = { block: number; sky: number };
export type LightGetter = (wx: number, wy: number, wz: number) => LightSample;

function usesGrassTint(id: number, faceIdx?: number): boolean {
  if (id === Block.GRASS) return faceIdx === undefined || faceIdx === 0;
  return (
    id === Block.SHORT_GRASS ||
    id === Block.FERN ||
    id === Block.VINE ||
    id === Block.LILY_PAD ||
    id === Block.CATTAIL
  );
}

const FULL_SKY: LightSample = { block: 0, sky: 15 };

function lightAt(
  getLight: LightGetter | undefined,
  wx: number,
  wy: number,
  wz: number,
): LightSample {
  if (!getLight) return FULL_SKY;
  return getLight(wx, wy, wz);
}

function emitQuad(
  m: MeshBuild,
  positions: number[][],
  uvs: [number, number][],
  normal: [number, number, number],
  shade: number,
  /** Single wind weight, or 4 per-corner weights (stem=0 → tip=1 for plants) */
  wind: number | [number, number, number, number],
  doubleSided: boolean,
  light: LightSample = FULL_SKY,
  tint: [number, number, number] = [1, 1, 1],
): void {
  const base = m.base;
  const windAt = (c: number) =>
    typeof wind === "number" ? wind : wind[c]!;
  const lb = Math.min(1, light.block / 15);
  const ls = Math.min(1, light.sky / 15);
  for (let c = 0; c < 4; c++) {
    const p = positions[c]!;
    m.positions.push(p[0]!, p[1]!, p[2]!);
    m.normals.push(normal[0], normal[1], normal[2]);
    const uv = uvs[c]!;
    m.uvs.push(uv[0], uv[1]);
    m.colors.push(shade * tint[0], shade * tint[1], shade * tint[2]);
    m.winds.push(windAt(c));
    m.lights.push(lb, ls);
  }
  m.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  m.base += 4;
  if (doubleSided) {
    const b2 = m.base;
    for (let c = 0; c < 4; c++) {
      const p = positions[c]!;
      m.positions.push(p[0]!, p[1]!, p[2]!);
      m.normals.push(-normal[0], -normal[1], -normal[2]);
      const uv = uvs[c]!;
      m.uvs.push(uv[0], uv[1]);
      m.colors.push(shade * 0.92 * tint[0], shade * 0.92 * tint[1], shade * 0.92 * tint[2]);
      m.winds.push(windAt(c));
      m.lights.push(lb, ls);
    }
    // opposite winding
    m.indices.push(b2, b2 + 2, b2 + 1, b2, b2 + 3, b2 + 2);
    m.base += 4;
  }
}

/** Minecraft-style X cross for flowers / tall grass */
function emitCrossPlant(
  m: MeshBuild,
  wx: number,
  wy: number,
  wz: number,
  id: number,
  wind: number,
  light: LightSample,
): void {
  const def = BLOCKS[id];
  if (!def) return;
  const { u0, v0, u1, v1 } = tileUVs(def.tiles[2]!);
  // Match cube face convention: world-bottom → v0, world-top → v1
  // (stem painted at bottom of tile / high canvas Y)
  const uvPairs: [number, number][] = [
    [u0, v0],
    [u1, v0],
    [u1, v1],
    [u0, v1],
  ];
  // Inset slightly so planes sit inside the cell
  const inset = 0.05;
  const x0 = wx + inset;
  const x1 = wx + 1 - inset;
  const z0 = wz + inset;
  const z1 = wz + 1 - inset;
  const y0 = wy;
  const y1 = wy + 1;

  // Bottom corners stay planted (wind 0); top corners take full sway → shear
  const tip = Math.min(1.2, wind * 1.15);
  const plantWinds: [number, number, number, number] = [0, 0, tip, tip];
  const tint = usesGrassTint(id)
    ? grassTintMul(wx, wz, m.seed)
    : ([1, 1, 1] as [number, number, number]);

  // Plane A: (x0,z0) -> (x1,z1) — verts: bot, bot, top, top
  emitQuad(
    m,
    [
      [x0, y0, z0],
      [x1, y0, z1],
      [x1, y1, z1],
      [x0, y1, z0],
    ],
    uvPairs,
    [0.707, 0, -0.707],
    1,
    plantWinds,
    true,
    light,
    tint,
  );
  // Plane B: (x0,z1) -> (x1,z0)
  emitQuad(
    m,
    [
      [x0, y0, z1],
      [x1, y0, z0],
      [x1, y1, z0],
      [x0, y1, z1],
    ],
    uvPairs,
    [0.707, 0, 0.707],
    1,
    plantWinds,
    true,
    light,
    tint,
  );
}

/** Wall torch: X-cross leaned out from the attachment wall. */
function emitWallTorch(
  m: MeshBuild,
  wx: number,
  wy: number,
  wz: number,
  id: number,
  wind: number,
  light: LightSample,
): void {
  const def = BLOCKS[id];
  if (!def) return;
  const { u0, v0, u1, v1 } = tileUVs(def.tiles[2]!);
  const uvPairs: [number, number][] = [
    [u0, v0],
    [u1, v0],
    [u1, v1],
    [u0, v1],
  ];
  let ax = 0;
  let az = 0;
  if (id === Block.TORCH_NX) ax = -1;
  else if (id === Block.TORCH_PX) ax = 1;
  else if (id === Block.TORCH_NZ) az = -1;
  else az = 1;

  const theta = 0.4;
  const s = Math.sin(theta);
  const c = Math.cos(theta);
  const outX = -ax;
  const outZ = -az;
  const inset = 0.1;
  const baseY = 0.2;
  const half = 0.36;
  const cx = wx + 0.5 + ax * (0.5 - inset);
  const cz = wz + 0.5 + az * (0.5 - inset);
  const cy = wy + baseY;

  const xf = (lx: number, ly: number, lz: number): [number, number, number] => [
    cx + lx + ly * s * outX,
    cy + ly * c,
    cz + lz + ly * s * outZ,
  ];

  const tip = Math.min(0.6, wind * 0.9);
  const plantWinds: [number, number, number, number] = [0, 0, tip, tip];

  emitQuad(
    m,
    [xf(-half, 0, -half), xf(half, 0, half), xf(half, 0.92, half), xf(-half, 0.92, -half)],
    uvPairs,
    [0.707 * c + 0.2 * outX, s, -0.707 * c + 0.2 * outZ],
    1,
    plantWinds,
    true,
    light,
  );
  emitQuad(
    m,
    [xf(-half, 0, half), xf(half, 0, -half), xf(half, 0.92, -half), xf(-half, 0.92, half)],
    uvPairs,
    [0.707 * c + 0.2 * outX, s, 0.707 * c + 0.2 * outZ],
    1,
    plantWinds,
    true,
    light,
  );
}

function emitDoorPanel(
  m: MeshBuild,
  wx: number,
  wy: number,
  wz: number,
  id: number,
  light: LightSample,
): void {
  const plane = doorPlane(id);
  const t = 0.12;
  let ox = wx;
  let oz = wz;
  let sx = 1;
  let sz = 1;
  if (plane === 0) {
    sx = t;
  } else if (plane === 1) {
    ox = wx + 1 - t;
    sx = t;
  } else if (plane === 2) {
    sz = t;
  } else {
    oz = wz + 1 - t;
    sz = t;
  }
  for (let f = 0; f < 6; f++) {
    emitFace(m, ox, wy, oz, sx, 1, sz, f, id, 0, undefined, light);
  }
}

function emitLadder(
  m: MeshBuild,
  wx: number,
  wy: number,
  wz: number,
  id: number,
  light: LightSample,
): void {
  const def = BLOCKS[id];
  if (!def) return;
  const { u0, v0, u1, v1 } = tileUVs(def.tiles[2]!);
  const uvPairs: [number, number][] = [
    [u0, v0],
    [u1, v0],
    [u1, v1],
    [u0, v1],
  ];
  const inset = 0.08;
  let pts: number[][];
  let nrm: [number, number, number];
  if (id === Block.LADDER_NX) {
    const x = wx + inset;
    pts = [
      [x, wy, wz + 1],
      [x, wy, wz],
      [x, wy + 1, wz],
      [x, wy + 1, wz + 1],
    ];
    nrm = [1, 0, 0];
  } else if (id === Block.LADDER_PX) {
    const x = wx + 1 - inset;
    pts = [
      [x, wy, wz],
      [x, wy, wz + 1],
      [x, wy + 1, wz + 1],
      [x, wy + 1, wz],
    ];
    nrm = [-1, 0, 0];
  } else if (id === Block.LADDER_NZ) {
    const z = wz + inset;
    pts = [
      [wx, wy, z],
      [wx + 1, wy, z],
      [wx + 1, wy + 1, z],
      [wx, wy + 1, z],
    ];
    nrm = [0, 0, 1];
  } else {
    const z = wz + 1 - inset;
    pts = [
      [wx + 1, wy, z],
      [wx, wy, z],
      [wx, wy + 1, z],
      [wx + 1, wy + 1, z],
    ];
    nrm = [0, 0, -1];
  }
  emitQuad(m, pts, uvPairs, nrm, 1, [0, 0, 0, 0], true, light);
}

function emitPartialBox(
  m: MeshBuild,
  wx: number,
  wy: number,
  wz: number,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  id: number,
  light: LightSample,
): void {
  const pad = 0.001;
  const ox = wx + x0 + pad;
  const oy = wy + y0 + pad;
  const oz = wz + z0 + pad;
  const sx = Math.max(0.02, x1 - x0 - pad * 2);
  const sy = Math.max(0.02, y1 - y0 - pad * 2);
  const sz = Math.max(0.02, z1 - z0 - pad * 2);
  for (let f = 0; f < 6; f++) {
    emitFace(m, ox, oy, oz, sx, sy, sz, f, id, 0, undefined, light);
  }
}

function emitShapeBlock(
  m: MeshBuild,
  wx: number,
  wy: number,
  wz: number,
  id: number,
  light: LightSample,
): void {
  if (isSlab(id)) {
    emitPartialBox(m, wx, wy, wz, 0, 0, 0, 1, 0.5, 1, id, light);
    return;
  }
  if (!isStairCell(id)) return;
  emitPartialBox(m, wx, wy, wz, 0, 0, 0, 1, 0.5, 1, id, light);
  const f = stairFacing(id);
  if (f === 0) emitPartialBox(m, wx, wy, wz, 0, 0.5, 0, 0.5, 1, 1, id, light);
  else if (f === 1) emitPartialBox(m, wx, wy, wz, 0.5, 0.5, 0, 1, 1, 1, id, light);
  else if (f === 2) emitPartialBox(m, wx, wy, wz, 0, 0.5, 0, 1, 1, 0.5, id, light);
  else emitPartialBox(m, wx, wy, wz, 0, 0.5, 0.5, 1, 1, 1, id, light);
}

type MeshBuild = {
  positions: number[];
  normals: number[];
  uvs: number[];
  colors: number[];
  winds: number[];
  lights: number[];
  indices: number[];
  base: number;
  seed: number;
};

function newMeshBuild(seed = 0): MeshBuild {
  return {
    positions: [],
    normals: [],
    uvs: [],
    colors: [],
    winds: [],
    lights: [],
    indices: [],
    base: 0,
    seed,
  };
}

function emitFace(
  m: MeshBuild,
  ox: number,
  oy: number,
  oz: number,
  scaleX: number,
  scaleY: number,
  scaleZ: number,
  faceIdx: number,
  id: number,
  wind: number,
  /** Per-corner AO multipliers (1 = none). Length 4 matching face corners. */
  cornerAO?: readonly number[],
  light: LightSample = FULL_SKY,
): void {
  const def = BLOCKS[id];
  if (!def) return;
  const face = FACES[faceIdx]!;
  const [dx, dy, dz] = face.dir;
  const tile = faceIdx === 0 ? def.tiles[0] : faceIdx === 1 ? def.tiles[1] : def.tiles[2];
  const { u0, v0, u1, v1 } = tileUVs(tile);
  const shade = FACE_SHADE[faceIdx]!;
  const uvPairs: [number, number][] = [
    [u0, v0],
    [u1, v0],
    [u1, v1],
    [u0, v1],
  ];
  for (let c = 0; c < 4; c++) {
    const corner = face.corners[c]!;
    m.positions.push(
      ox + corner[0] * scaleX,
      oy + corner[1] * scaleY,
      oz + corner[2] * scaleZ,
    );
    m.normals.push(dx, dy, dz);
    const uv = uvPairs[c]!;
    m.uvs.push(uv[0], uv[1]);
    const ao = cornerAO ? cornerAO[c]! : 1;
    const s = shade * ao;
    const tint =
      usesGrassTint(id, faceIdx) ? grassTintMul(ox, oz, m.seed) : [1, 1, 1];
    m.colors.push(s * tint[0], s * tint[1], s * tint[2]);
    m.winds.push(wind);
    m.lights.push(Math.min(1, light.block / 15), Math.min(1, light.sky / 15));
  }
  m.indices.push(m.base, m.base + 1, m.base + 2, m.base, m.base + 2, m.base + 3);
  m.base += 4;
}

function finalizeMesh(m: MeshBuild): THREE.BufferGeometry | null {
  if (m.positions.length === 0) return null;
  return geometryFromPacked({
    positions: new Float32Array(m.positions),
    normals: new Float32Array(m.normals),
    uvs: new Float32Array(m.uvs),
    colors: new Float32Array(m.colors),
    winds: new Float32Array(m.winds),
    lights: new Float32Array(m.lights),
    indices: new Uint32Array(m.indices),
  });
}

export function geometryFromPacked(d: {
  positions: Float32Array;
  normals: Float32Array;
  uvs?: Float32Array;
  colors: Float32Array;
  winds?: Float32Array;
  lights?: Float32Array;
  indices: Uint32Array;
}): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(d.positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(d.normals, 3));
  if (d.uvs) geo.setAttribute("uv", new THREE.Float32BufferAttribute(d.uvs, 2));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(d.colors, 3));
  if (d.winds) geo.setAttribute("wind", new THREE.Float32BufferAttribute(d.winds, 1));
  if (d.lights) geo.setAttribute("light", new THREE.Float32BufferAttribute(d.lights, 2));
  geo.setIndex(new THREE.Uint32BufferAttribute(d.indices, 1));
  geo.computeBoundingSphere();
  return geo;
}

function sampleOpaque(
  chunk: Chunk,
  getBlock: NeighborGetter,
  wx: number,
  wy: number,
  wz: number,
  lx: number,
  ly: number,
  lz: number,
): number {
  let id: number;
  if (
    lx >= 0 &&
    ly >= 0 &&
    lz >= 0 &&
    lx < CHUNK_SIZE &&
    lz < CHUNK_SIZE &&
    ly < CHUNK_HEIGHT
  ) {
    id = chunk.get(lx, ly, lz);
  } else {
    id = getBlock(wx, wy, wz);
  }
  if (isWater(id) || id === Block.AIR) return Block.AIR;
  return id;
}

/** Dominant solid id in a step×step×1 cell (skips air/water) */
function dominantCell(
  chunk: Chunk,
  lx: number,
  y: number,
  lz: number,
  step: number,
  opts?: { includeFoliage?: boolean },
): number {
  const includeFoliage = opts?.includeFoliage ?? false;
  const counts = new Map<number, number>();
  let best: number = Block.AIR;
  let bestN = 0;

  for (let dz = 0; dz < step; dz++) {
    for (let dx = 0; dx < step; dx++) {
      const x = lx + dx;
      const z = lz + dz;
      if (x >= CHUNK_SIZE || z >= CHUNK_SIZE) continue;
      let id = chunk.get(x, y, z);
      if (id === Block.AIR || isWater(id)) continue;
      // Plants never contribute to LOD mesh (too thin at range)
      if (isPlant(id) || isDoor(id) || isLadder(id)) continue;
      if (isStairCell(id) || isSlab(id)) id = shapeMaterial(id);
      if (
        !includeFoliage &&
        (isLeaves(id) || id === Block.CACTUS)
      ) {
        continue;
      }
      const weight = includeFoliage && (isLeaves(id) || id === Block.CACTUS) ? 1 : 2;
      const n = (counts.get(id) ?? 0) + weight;
      counts.set(id, n);
      if (n > bestN) {
        bestN = n;
        best = id;
      }
    }
  }
  return best;
}


function isOccluder(id: number): boolean {
  return id !== Block.AIR && !isWater(id) && isSolid(id) && !isTransparent(id);
}

export function buildChunkGeometry(
  chunk: Chunk,
  getBlock: NeighborGetter,
  lod: ChunkLod = 0,
  _isLoaded?: ChunkLoadedFn,
  getLight?: LightGetter,
  seed = 0,
): THREE.BufferGeometry | null {
  if (lod === 0) return buildLod0(chunk, getBlock, getLight, seed);
  if (lod === 1) return buildLod1(chunk, getBlock, getLight, seed);
  return buildLod2(chunk, getBlock, getLight, seed);
}


/** Full resolution */
function buildLod0(
  chunk: Chunk,
  getBlock: NeighborGetter,
  getLight?: LightGetter,
  seed = 0,
): THREE.BufferGeometry | null {
  const baseX = chunk.cx * CHUNK_SIZE;
  const baseZ = chunk.cz * CHUNK_SIZE;
  const m = newMeshBuild(seed);

  for (let y = 0; y < CHUNK_HEIGHT; y++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const id = chunk.get(lx, y, lz);
        if (id === Block.AIR || isWater(id) || id === Block.CHEST || isPortal(id)) continue;
        const def = BLOCKS[id];
        if (!def) continue;

        const wx = baseX + lx;
        const wy = y;
        const wz = baseZ + lz;
        const wind = windFactorFor(id);
        const heightBoost =
          isLeaves(id) || isPlant(id)
            ? 0.15 + (y / CHUNK_HEIGHT) * 0.35
            : 0;
        const w = Math.min(1, wind + heightBoost * wind);

        if (isDoorCell(id)) {
          emitDoorPanel(m, wx, wy, wz, id, lightAt(getLight, wx, wy, wz));
          continue;
        }
        if (isLadderCell(id)) {
          emitLadder(m, wx, wy, wz, id, lightAt(getLight, wx, wy, wz));
          continue;
        }
        if (isSlab(id) || isStairCell(id)) {
          emitShapeBlock(m, wx, wy, wz, id, lightAt(getLight, wx, wy, wz));
          continue;
        }

        // Cross-shaped plants (flowers, grass, ferns…)
        if (def.shape === "cross" || isPlant(id)) {
          const self = lightAt(getLight, wx, wy, wz);
          const emit = lightEmission(id);
          const lit = {
            block: Math.max(self.block, emit),
            sky: self.sky,
          };
          if (isTorch(id) && id !== Block.TORCH) {
            emitWallTorch(m, wx, wy, wz, id, w, lit);
          } else {
            emitCrossPlant(m, wx, wy, wz, id, w, lit);
          }
          continue;
        }

        for (let f = 0; f < 6; f++) {
          const face = FACES[f]!;
          const [dx, dy, dz] = face.dir;
          const nx = lx + dx;
          const ny = y + dy;
          const nz = lz + dz;
          let neighbor: number;
          if (
            nx >= 0 &&
            ny >= 0 &&
            nz >= 0 &&
            nx < CHUNK_SIZE &&
            nz < CHUNK_SIZE &&
            ny < CHUNK_HEIGHT
          ) {
            neighbor = chunk.get(nx, ny, nz);
          } else {
            neighbor = getBlock(wx + dx, wy + dy, wz + dz);
          }
          if (neighbor === Block.CHEST) {
            // Custom chest model — don't occlude neighbor faces
          } else if (isSolid(neighbor) && !isTransparent(neighbor)) continue;
          if (id === Block.ICE && neighbor === Block.ICE) continue;

          const ao = faceCornerAO(
            chunk,
            getBlock,
            baseX,
            baseZ,
            wx,
            wy,
            wz,
            f,
          );
          emitFace(
            m,
            wx,
            wy,
            wz,
            1,
            1,
            1,
            f,
            id,
            w,
            ao,
            lightAt(getLight, wx + dx, wy + dy, wz + dz),
          );
        }
      }
    }
  }
  return finalizeMesh(m);
}

/** 2× downsampled voxels, includes foliage */
function buildLod1(
  chunk: Chunk,
  getBlock: NeighborGetter,
  getLight?: LightGetter,
  seed = 0,
): THREE.BufferGeometry | null {
  const baseX = chunk.cx * CHUNK_SIZE;
  const baseZ = chunk.cz * CHUNK_SIZE;
  const step = 2;
  const m = newMeshBuild(seed);
  const cellOpts = { includeFoliage: true };

  for (let y = 0; y < CHUNK_HEIGHT; y++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz += step) {
      for (let lx = 0; lx < CHUNK_SIZE; lx += step) {
        const id = dominantCell(chunk, lx, y, lz, step, cellOpts);
        if (id === Block.AIR || isPortal(id)) continue;
        const wx = baseX + lx;
        const wz = baseZ + lz;
        const sx = Math.min(step, CHUNK_SIZE - lx);
        const sz = Math.min(step, CHUNK_SIZE - lz);
        const wind =
          isLeaves(id)
            ? Math.min(1, 0.15 + (y / CHUNK_HEIGHT) * 0.35)
            : 0;

        for (let f = 0; f < 6; f++) {
          const face = FACES[f]!;
          const [dx, dy, dz] = face.dir;
          const nlx = lx + dx * step;
          const nly = y + dy;
          const nlz = lz + dz * step;
          let neighbor: number;
          if (dy !== 0) {
            neighbor =
              nly >= 0 && nly < CHUNK_HEIGHT
                ? dominantCell(chunk, lx, nly, lz, step, cellOpts)
                : Block.AIR;
          } else {
            neighbor = dominantCell(chunk, nlx, y, nlz, step, cellOpts);
            if (
              nlx < 0 ||
              nlz < 0 ||
              nlx >= CHUNK_SIZE ||
              nlz >= CHUNK_SIZE
            ) {
              neighbor = sampleOpaque(
                chunk,
                getBlock,
                wx + (dx > 0 ? sx : dx < 0 ? -1 : 0),
                y,
                wz + (dz > 0 ? sz : dz < 0 ? -1 : 0),
                nlx,
                y,
                nlz,
              );
              if (nlx < 0 || nlz < 0 || nlx >= CHUNK_SIZE || nlz >= CHUNK_SIZE) {
                let anySolid = false;
                for (let i = 0; i < step && !anySolid; i++) {
                  const swx = dx !== 0 ? wx + (dx > 0 ? sx : -1) : wx + i;
                  const swz = dz !== 0 ? wz + (dz > 0 ? sz : -1) : wz + i;
                  const bid = getBlock(swx, y, swz);
          if (isOccluder(bid) || isLeaves(bid)) anySolid = true;
                }
                if (anySolid) continue;
                neighbor = Block.AIR;
              }
            }
          }
          // Leaves are transparent-ish — still occlude other leaves at LOD1
          if (isOccluder(neighbor)) continue;
          if (isLeaves(id) && isLeaves(neighbor)) continue;
          if (id === Block.ICE && neighbor === Block.ICE) continue;
          emitFace(
            m,
            wx,
            y,
            wz,
            sx,
            1,
            sz,
            f,
            id,
            wind,
            undefined,
            lightAt(getLight, wx + Math.max(0, dx) * (sx - 1) + dx, y + dy, wz + Math.max(0, dz) * (sz - 1) + dz),
          );
        }
      }
    }
  }
  return finalizeMesh(m);
}


/** Far LOD: solid heightfield columns (no hollow shells / cave holes) */
function buildLod2(
  chunk: Chunk,
  getBlock: NeighborGetter,
  getLight?: LightGetter,
  seed = 0,
): THREE.BufferGeometry | null {
  const baseX = chunk.cx * CHUNK_SIZE;
  const baseZ = chunk.cz * CHUNK_SIZE;
  const step = 2;
  const cols = Math.ceil(CHUNK_SIZE / step);
  const height = new Int16Array(cols * cols);
  const topId = new Uint8Array(cols * cols);
  const fillId = new Uint8Array(cols * cols);

  for (let iz = 0; iz < cols; iz++) {
    for (let ix = 0; ix < cols; ix++) {
      const lx = ix * step;
      const lz = iz * step;
      let h = 0;
      let tid: number = Block.STONE;
      let fid: number = Block.STONE;
      // Surface only — first solid from top (ignore water/leaves)
      for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
        const id = dominantCell(chunk, lx, y, lz, step, {
          includeFoliage: false,
        });
        if (id === Block.AIR || isWater(id)) continue;
        if (isLeaves(id) || id === Block.CACTUS || isPortal(id)) continue;
        h = y;
        tid = id;
        // Sample a bit below for cliff material
        const below = dominantCell(chunk, lx, Math.max(0, y - 2), lz, step);
        fid =
          below !== Block.AIR && !isWater(below) && !isLeaves(below)
            ? below
            : id === Block.GRASS || id === Block.SNOW_GRASS
              ? Block.DIRT
              : id;
        break;
      }
      height[ix + iz * cols] = h;
      topId[ix + iz * cols] = tid;
      fillId[ix + iz * cols] = fid;
    }
  }

  const m = newMeshBuild(seed);

  const neighborH = (ix: number, iz: number, faceIdx: number): number => {
    const nix =
      faceIdx === 2 ? ix + 1 : faceIdx === 3 ? ix - 1 : ix;
    const niz =
      faceIdx === 4 ? iz + 1 : faceIdx === 5 ? iz - 1 : iz;
    if (nix >= 0 && niz >= 0 && nix < cols && niz < cols) {
      return height[nix + niz * cols]!;
    }
    // Outside this chunk: sample world surface (cheap vertical scan)
    const lx = ix * step;
    const lz = iz * step;
    const sx = Math.min(step, CHUNK_SIZE - lx);
    const sz = Math.min(step, CHUNK_SIZE - lz);
    const wx = baseX + lx;
    const wz = baseZ + lz;
    const sdx =
      faceIdx === 2 ? sx : faceIdx === 3 ? -1 : Math.floor(sx / 2);
    const sdz =
      faceIdx === 4 ? sz : faceIdx === 5 ? -1 : Math.floor(sz / 2);
    for (let sy = CHUNK_HEIGHT - 1; sy >= 0; sy--) {
      const bid = getBlock(wx + sdx, sy, wz + sdz);
      if (
        bid !== Block.AIR &&
        !isWater(bid) &&
        !isLeaves(bid) &&
        bid !== Block.CACTUS &&
        isSolid(bid)
      ) {
        return sy;
      }
    }
    return 0;
  };

  for (let iz = 0; iz < cols; iz++) {
    for (let ix = 0; ix < cols; ix++) {
      const lx = ix * step;
      const lz = iz * step;
      const h = height[ix + iz * cols]!;
      const id = topId[ix + iz * cols]!;
      const fill = fillId[ix + iz * cols]!;
      if (h <= 0) continue;
      const wx = baseX + lx;
      const wz = baseZ + lz;
      const sx = Math.min(step, CHUNK_SIZE - lx);
      const sz = Math.min(step, CHUNK_SIZE - lz);

      // Top face at surface (emitFace places unit cube at y; top face is y+1 plane)
      emitFace(m, wx, h, wz, sx, 1, sz, 0, id, 0);

      // Four walls — face indices: 2=+X 3=-X 4=+Z 5=-Z
      for (const faceIdx of [2, 3, 4, 5] as const) {
        const nh = neighborH(ix, iz, faceIdx);
        if (nh >= h) continue;

        // One tall side quad from nh to h+1 instead of stacked unit faces
        // (fewer gaps, solid-looking cliffs)
        const wallH = h - nh;
        if (wallH <= 0) continue;
        // Bottom of wall sits on neighbor surface top (nh+1 in block space)
        // emitFace with scaleY = wallH, position y = nh + 1? 
        // Unit cube at (wx, y, wz) has bottom at y and top at y+scaleY.
        // We want wall from world Y = nh+1 to world Y = h+1 (surface top).
        // So y = nh+1, scaleY = h - nh.
        const wallY = nh + 1;
        const scaleY = h - nh;
        if (scaleY < 1) continue;
        emitFace(m, wx, wallY, wz, sx, scaleY, sz, faceIdx, fill || Block.STONE, 0);
      }
    }
  }
  return finalizeMesh(m);
}

export function buildChunkWaterGeometry(
  chunk: Chunk,
  getBlock: NeighborGetter,
  lod: ChunkLod = 0,
  isLoaded?: ChunkLoadedFn,
): THREE.BufferGeometry | null {
  if (lod >= 2) return buildWaterLodFar(chunk, getBlock);
  if (lod === 1) return buildWaterLodMid(chunk, getBlock);
  return buildWaterLod0(chunk, getBlock, isLoaded);
}

/**
 * Resolve neighbor for water face culling.
 * Unloaded chunks are treated as water so we don't emit vertical seam walls
 * along borders (they remesh when the neighbor arrives).
 */
function waterNeighbor(
  chunk: Chunk,
  getBlock: NeighborGetter,
  isLoaded: ChunkLoadedFn | undefined,
  lx: number,
  ly: number,
  lz: number,
  wx: number,
  wy: number,
  wz: number,
  dx: number,
  dy: number,
  dz: number,
): number {
  const nx = lx + dx;
  const ny = ly + dy;
  const nz = lz + dz;
  if (
    nx >= 0 &&
    ny >= 0 &&
    nz >= 0 &&
    nx < CHUNK_SIZE &&
    nz < CHUNK_SIZE &&
    ny < CHUNK_HEIGHT
  ) {
    return chunk.get(nx, ny, nz);
  }
  const nwx = wx + dx;
  const nwy = wy + dy;
  const nwz = wz + dz;
  // Vertical out of world
  if (nwy < 0 || nwy >= CHUNK_HEIGHT) return Block.AIR;

  const neighbor = getBlock(nwx, nwy, nwz);
  // Horizontal border into unloaded chunk → assume continuous water (no wall)
  if (
    (dx !== 0 || dz !== 0) &&
    neighbor === Block.AIR &&
    isLoaded &&
    !isLoaded(nwx, nwz)
  ) {
    return Block.WATER;
  }
  return neighbor;
}

function waterTopH(cell: number, surface: boolean): number {
  // Any cell with water above fills the cube so columns don't show shelves.
  if (!surface) return 1;
  const lvl = waterLevel(cell);
  if (lvl >= 8) return 0.875;
  return 0.14 + (lvl / 8) * 0.72;
}

function buildWaterLod0(
  chunk: Chunk,
  getBlock: NeighborGetter,
  isLoaded?: ChunkLoadedFn,
): THREE.BufferGeometry | null {
  const baseX = chunk.cx * CHUNK_SIZE;
  const baseZ = chunk.cz * CHUNK_SIZE;
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  let base = 0;

  const emitQuad = (
    verts: [number, number, number][],
    n: [number, number, number],
    isTop: boolean,
    h0: number,
    h1: number,
    lvl: number,
  ) => {
    const hs = [h0, h0, h1, h1];
    for (let c = 0; c < 4; c++) {
      const p = verts[c]!;
      positions.push(p[0]!, p[1]!, p[2]!);
      normals.push(n[0], n[1], n[2]);
      colors.push(isTop ? 1 : 0, hs[c]!, lvl / 8);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    base += 4;
  };

  const cellInfo = (
    lx: number,
    y: number,
    lz: number,
  ): { topH: number; lvl: number; surface: boolean } | null => {
    const cell = chunk.get(lx, y, lz);
    if (!isWater(cell)) return null;
    const wx = baseX + lx;
    const wz = baseZ + lz;
    const above = waterNeighbor(
      chunk, getBlock, isLoaded, lx, y, lz, wx, y, wz, 0, 1, 0,
    );
    const surface = !isWater(above);
    return { topH: waterTopH(cell, surface), lvl: waterLevel(cell), surface };
  };

  const needsSide = (
    lx: number,
    y: number,
    lz: number,
    dx: number,
    dz: number,
  ): { topH: number; lvl: number } | null => {
    const info = cellInfo(lx, y, lz);
    if (!info) return null;
    const wx = baseX + lx;
    const wz = baseZ + lz;
    const neighbor = waterNeighbor(
      chunk, getBlock, isLoaded, lx, y, lz, wx, y, wz, dx, 0, dz,
    );
    if (isWater(neighbor)) return null;
    if (isSolid(neighbor) && !isTransparent(neighbor)) return null;
    return { topH: info.topH, lvl: info.lvl };
  };

  const used = new Uint8Array(CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE);
  const uidx = (lx: number, y: number, lz: number) =>
    lx + lz * CHUNK_SIZE + y * CHUNK_SIZE * CHUNK_SIZE;

  // Side faces — greedy-merge along the face and up the column so a
  // waterfall is one sheet, not a stack of cubes.
  const sideSpecs: {
    dx: number;
    dz: number;
    n: [number, number, number];
    verts: (
      wx: number,
      y0: number,
      y1: number,
      wz: number,
      along: number,
    ) => [number, number, number][];
    // u-axis is Z for ±X faces, X for ±Z faces
    uIsZ: boolean;
  }[] = [
    {
      dx: 1,
      dz: 0,
      n: [1, 0, 0],
      uIsZ: true,
      verts: (wx, y0, y1, wz, w) => [
        [wx + 1, y0, wz + w],
        [wx + 1, y0, wz],
        [wx + 1, y1, wz],
        [wx + 1, y1, wz + w],
      ],
    },
    {
      dx: -1,
      dz: 0,
      n: [-1, 0, 0],
      uIsZ: true,
      verts: (wx, y0, y1, wz, w) => [
        [wx, y0, wz],
        [wx, y0, wz + w],
        [wx, y1, wz + w],
        [wx, y1, wz],
      ],
    },
    {
      dx: 0,
      dz: 1,
      n: [0, 0, 1],
      uIsZ: false,
      verts: (wx, y0, y1, wz, w) => [
        [wx, y0, wz + 1],
        [wx + w, y0, wz + 1],
        [wx + w, y1, wz + 1],
        [wx, y1, wz + 1],
      ],
    },
    {
      dx: 0,
      dz: -1,
      n: [0, 0, -1],
      uIsZ: false,
      verts: (wx, y0, y1, wz, w) => [
        [wx + w, y0, wz],
        [wx, y0, wz],
        [wx, y1, wz],
        [wx + w, y1, wz],
      ],
    },
  ];

  for (const spec of sideSpecs) {
    used.fill(0);
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          if (used[uidx(lx, y, lz)]) continue;
          const need = needsSide(lx, y, lz, spec.dx, spec.dz);
          if (!need) continue;

          // Grow along the face (Z for ±X, X for ±Z)
          let run = 1;
          if (spec.uIsZ) {
            while (lz + run < CHUNK_SIZE) {
              if (used[uidx(lx, y, lz + run)]) break;
              const n = needsSide(lx, y, lz + run, spec.dx, spec.dz);
              if (!n || Math.abs(n.topH - need.topH) > 1e-4) break;
              run++;
            }
          } else {
            while (lx + run < CHUNK_SIZE) {
              if (used[uidx(lx + run, y, lz)]) break;
              const n = needsSide(lx + run, y, lz, spec.dx, spec.dz);
              if (!n || Math.abs(n.topH - need.topH) > 1e-4) break;
              run++;
            }
          }

          // Grow up — only full-height cells stack into one sheet
          let rise = 1;
          if (Math.abs(need.topH - 1) < 1e-4) {
            growY: while (y + rise < CHUNK_HEIGHT) {
              if (spec.uIsZ) {
                for (let o = 0; o < run; o++) {
                  if (used[uidx(lx, y + rise, lz + o)]) break growY;
                  const n = needsSide(lx, y + rise, lz + o, spec.dx, spec.dz);
                  if (!n || Math.abs(n.topH - 1) > 1e-4) break growY;
                }
              } else {
                for (let o = 0; o < run; o++) {
                  if (used[uidx(lx + o, y + rise, lz)]) break growY;
                  const n = needsSide(lx + o, y + rise, lz, spec.dx, spec.dz);
                  if (!n || Math.abs(n.topH - 1) > 1e-4) break growY;
                }
              }
              rise++;
            }
          }

          for (let ry = 0; ry < rise; ry++) {
            if (spec.uIsZ) {
              for (let o = 0; o < run; o++) used[uidx(lx, y + ry, lz + o)] = 1;
            } else {
              for (let o = 0; o < run; o++) used[uidx(lx + o, y + ry, lz)] = 1;
            }
          }

          const wx = baseX + lx;
          const wz = baseZ + lz;
          const y0 = y;
          const y1 = y + (rise - 1) + need.topH;
          const along = run;
          emitQuad(
            spec.verts(wx, y0, y1, wz, along),
            spec.n,
            false,
            0,
            1,
            need.lvl,
          );
        }
      }
    }
  }

  // Bottoms — only when something see-through is underneath
  for (let y = 0; y < CHUNK_HEIGHT; y++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        if (!isWater(chunk.get(lx, y, lz))) continue;
        const wx = baseX + lx;
        const wz = baseZ + lz;
        const below = waterNeighbor(
          chunk, getBlock, isLoaded, lx, y, lz, wx, y, wz, 0, -1, 0,
        );
        if (isWater(below)) continue;
        if (isSolid(below) && !isTransparent(below)) continue;
        emitQuad(
          [
            [wx, y, wz],
            [wx + 1, y, wz],
            [wx + 1, y, wz + 1],
            [wx, y, wz + 1],
          ],
          [0, -1, 0],
          false,
          0,
          0,
          8,
        );
      }
    }
  }

  // Tops: merge contiguous same-height surface into larger quads
  const usedTop = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
  for (let y = 0; y < CHUNK_HEIGHT; y++) {
    usedTop.fill(0);
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const ui = lx + lz * CHUNK_SIZE;
        if (usedTop[ui]) continue;
        const info = cellInfo(lx, y, lz);
        if (!info || !info.surface) continue;
        const above = waterNeighbor(
          chunk, getBlock, isLoaded, lx, y, lz, baseX + lx, y, baseZ + lz, 0, 1, 0,
        );
        if (isSolid(above) && !isTransparent(above)) continue;
        const topH = info.topH;
        const lvl = info.lvl;

        let w = 1;
        while (lx + w < CHUNK_SIZE) {
          if (usedTop[lx + w + lz * CHUNK_SIZE]) break;
          const n = cellInfo(lx + w, y, lz);
          if (!n || !n.surface || Math.abs(n.topH - topH) > 1e-4) break;
          w++;
        }
        let d = 1;
        expandZ: while (lz + d < CHUNK_SIZE) {
          for (let ox = 0; ox < w; ox++) {
            if (usedTop[lx + ox + (lz + d) * CHUNK_SIZE]) break expandZ;
            const n = cellInfo(lx + ox, y, lz + d);
            if (!n || !n.surface || Math.abs(n.topH - topH) > 1e-4) break expandZ;
          }
          d++;
        }
        for (let oz = 0; oz < d; oz++) {
          for (let ox = 0; ox < w; ox++) {
            usedTop[lx + ox + (lz + oz) * CHUNK_SIZE] = 1;
          }
        }
        const wx0 = baseX + lx;
        const wz0 = baseZ + lz;
        const yTop = y + topH;
        emitQuad(
          [
            [wx0, yTop, wz0 + d],
            [wx0 + w, yTop, wz0 + d],
            [wx0 + w, yTop, wz0],
            [wx0, yTop, wz0],
          ],
          [0, 1, 0],
          true,
          1,
          1,
          lvl,
        );
      }
    }
  }

  if (positions.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}


/** Mid LOD: only water top faces, 2× cells */
function buildWaterLodMid(
  chunk: Chunk,
  getBlock: NeighborGetter,
): THREE.BufferGeometry | null {
  const baseX = chunk.cx * CHUNK_SIZE;
  const baseZ = chunk.cz * CHUNK_SIZE;
  const step = 2;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  let base = 0;

  for (let lz = 0; lz < CHUNK_SIZE; lz += step) {
    for (let lx = 0; lx < CHUNK_SIZE; lx += step) {
      // highest water in cell
      let top = -1;
      for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
        let any = false;
        for (let dz = 0; dz < step && !any; dz++) {
          for (let dx = 0; dx < step && !any; dx++) {
            if (lx + dx < CHUNK_SIZE && lz + dz < CHUNK_SIZE) {
              if (isWater(chunk.get(lx + dx, y, lz + dz))) any = true;
            }
          }
        }
        if (any) {
          top = y;
          break;
        }
      }
      if (top < 0) continue;
      // only if air/transparent above
      const above = chunk.get(lx, top + 1, lz);
      if (isWater(above)) continue;
      if (isSolid(above) && !isTransparent(above)) continue;

      const wx = baseX + lx;
      const wz = baseZ + lz;
      const sx = Math.min(step, CHUNK_SIZE - lx);
      const sz = Math.min(step, CHUNK_SIZE - lz);
      const y = top + 1 - 0.02;
      // top quad
      positions.push(wx, y, wz + sz, wx + sx, y, wz + sz, wx + sx, y, wz, wx, y, wz);
      for (let i = 0; i < 4; i++) normals.push(0, 1, 0);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      base += 4;
      void getBlock;
    }
  }
  if (positions.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  const cols = new Float32Array((positions.length / 3) * 3);
  for (let i = 0; i < cols.length; i += 3) {
    cols[i] = 1;
    cols[i + 1] = 1;
    cols[i + 2] = 1;
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}

function buildWaterLodFar(
  chunk: Chunk,
  getBlock: NeighborGetter,
): THREE.BufferGeometry | null {
  // Same as mid — surface water only is enough at range
  return buildWaterLodMid(chunk, getBlock);
}
