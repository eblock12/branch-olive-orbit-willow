import * as THREE from "three";
import { Block, BLOCKS, isSolid, isTransparent, isPlant } from "./blocks";
import { tileUVs } from "./textures";

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
  mesh: THREE.Mesh | null = null;
  waterMesh: THREE.Mesh | null = null;
  dirty = true;
  /** LOD currently built into mesh (-1 = none) */
  meshLod: number = -1;
  /** Desired LOD from distance */
  targetLod: ChunkLod = 0;

  constructor(cx: number, cz: number) {
    this.cx = cx;
    this.cz = cz;
    this.blocks = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT);
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
  }

  applyBlocks(blocks: Uint8Array): void {
    this.blocks = blocks;
    this.dirty = true;
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
  if (id === Block.LEAVES) return 1;
  if (isPlant(id)) return 0.85;
  return 0;
}

function emitQuad(
  m: MeshBuild,
  positions: number[][],
  uvs: [number, number][],
  normal: [number, number, number],
  shade: number,
  wind: number,
  doubleSided: boolean,
): void {
  const base = m.base;
  for (let c = 0; c < 4; c++) {
    const p = positions[c]!;
    m.positions.push(p[0]!, p[1]!, p[2]!);
    m.normals.push(normal[0], normal[1], normal[2]);
    const uv = uvs[c]!;
    m.uvs.push(uv[0], uv[1]);
    m.colors.push(shade, shade, shade);
    m.winds.push(wind);
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
      m.colors.push(shade * 0.92, shade * 0.92, shade * 0.92);
      m.winds.push(wind);
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

  // Plane A: (x0,z0) -> (x1,z1)
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
    wind,
    true,
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
    0.95,
    wind,
    true,
  );
}

type MeshBuild = {
  positions: number[];
  normals: number[];
  uvs: number[];
  colors: number[];
  winds: number[];
  indices: number[];
  base: number;
};

function newMeshBuild(): MeshBuild {
  return {
    positions: [],
    normals: [],
    uvs: [],
    colors: [],
    winds: [],
    indices: [],
    base: 0,
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
    m.colors.push(s, s, s);
    m.winds.push(wind);
  }
  m.indices.push(m.base, m.base + 1, m.base + 2, m.base, m.base + 2, m.base + 3);
  m.base += 4;
}

function finalizeMesh(m: MeshBuild): THREE.BufferGeometry | null {
  if (m.positions.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(m.positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(m.normals, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(m.uvs, 2));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(m.colors, 3));
  geo.setAttribute("wind", new THREE.Float32BufferAttribute(m.winds, 1));
  geo.setIndex(m.indices);
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
  if (id === Block.WATER || id === Block.AIR) return Block.AIR;
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
      const id = chunk.get(x, y, z);
      if (id === Block.AIR || id === Block.WATER) continue;
      // Plants never contribute to LOD mesh (too thin at range)
      if (isPlant(id)) continue;
      if (
        !includeFoliage &&
        (id === Block.LEAVES || id === Block.CACTUS)
      ) {
        continue;
      }
      const weight =
        includeFoliage && (id === Block.LEAVES || id === Block.CACTUS)
          ? 1
          : 2;
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
  return id !== Block.AIR && id !== Block.WATER && isSolid(id) && !isTransparent(id);
}

export function buildChunkGeometry(
  chunk: Chunk,
  getBlock: NeighborGetter,
  lod: ChunkLod = 0,
  _isLoaded?: ChunkLoadedFn,
): THREE.BufferGeometry | null {
  if (lod === 0) return buildLod0(chunk, getBlock);
  if (lod === 1) return buildLod1(chunk, getBlock);
  return buildLod2(chunk, getBlock);
}


/** Full resolution */
function buildLod0(
  chunk: Chunk,
  getBlock: NeighborGetter,
): THREE.BufferGeometry | null {
  const baseX = chunk.cx * CHUNK_SIZE;
  const baseZ = chunk.cz * CHUNK_SIZE;
  const m = newMeshBuild();

  for (let y = 0; y < CHUNK_HEIGHT; y++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const id = chunk.get(lx, y, lz);
        if (id === Block.AIR || id === Block.WATER) continue;
        const def = BLOCKS[id];
        if (!def) continue;

        const wx = baseX + lx;
        const wy = y;
        const wz = baseZ + lz;
        const wind = windFactorFor(id);
        const heightBoost =
          id === Block.LEAVES || isPlant(id)
            ? 0.15 + (y / CHUNK_HEIGHT) * 0.35
            : 0;
        const w = Math.min(1, wind + heightBoost * wind);

        // Cross-shaped plants (flowers, grass, ferns…)
        if (def.shape === "cross" || isPlant(id)) {
          emitCrossPlant(m, wx, wy, wz, id, w);
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
          if (isSolid(neighbor) && !isTransparent(neighbor)) continue;
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
          emitFace(m, wx, wy, wz, 1, 1, 1, f, id, w, ao);
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
): THREE.BufferGeometry | null {
  const baseX = chunk.cx * CHUNK_SIZE;
  const baseZ = chunk.cz * CHUNK_SIZE;
  const step = 2;
  const m = newMeshBuild();
  const cellOpts = { includeFoliage: true };

  for (let y = 0; y < CHUNK_HEIGHT; y++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz += step) {
      for (let lx = 0; lx < CHUNK_SIZE; lx += step) {
        const id = dominantCell(chunk, lx, y, lz, step, cellOpts);
        if (id === Block.AIR) continue;
        const wx = baseX + lx;
        const wz = baseZ + lz;
        const sx = Math.min(step, CHUNK_SIZE - lx);
        const sz = Math.min(step, CHUNK_SIZE - lz);
        const wind =
          id === Block.LEAVES
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
                  if (isOccluder(bid) || bid === Block.LEAVES) anySolid = true;
                }
                if (anySolid) continue;
                neighbor = Block.AIR;
              }
            }
          }
          // Leaves are transparent-ish — still occlude other leaves at LOD1
          if (isOccluder(neighbor)) continue;
          if (id === Block.LEAVES && neighbor === Block.LEAVES) continue;
          if (id === Block.ICE && neighbor === Block.ICE) continue;
          emitFace(m, wx, y, wz, sx, 1, sz, f, id, wind);
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
        if (id === Block.AIR || id === Block.WATER) continue;
        if (id === Block.LEAVES || id === Block.CACTUS) continue;
        h = y;
        tid = id;
        // Sample a bit below for cliff material
        const below = dominantCell(chunk, lx, Math.max(0, y - 2), lz, step);
        fid =
          below !== Block.AIR && below !== Block.WATER && below !== Block.LEAVES
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

  const m = newMeshBuild();

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
        bid !== Block.WATER &&
        bid !== Block.LEAVES &&
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

function buildWaterLod0(
  chunk: Chunk,
  getBlock: NeighborGetter,
  isLoaded?: ChunkLoadedFn,
): THREE.BufferGeometry | null {
  const baseX = chunk.cx * CHUNK_SIZE;
  const baseZ = chunk.cz * CHUNK_SIZE;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  let base = 0;

  for (let y = 0; y < CHUNK_HEIGHT; y++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        if (chunk.get(lx, y, lz) !== Block.WATER) continue;
        const wx = baseX + lx;
        const wy = y;
        const wz = baseZ + lz;
        for (let f = 0; f < 6; f++) {
          const face = FACES[f]!;
          const [dx, dy, dz] = face.dir;
          const neighbor = waterNeighbor(
            chunk,
            getBlock,
            isLoaded,
            lx,
            y,
            lz,
            wx,
            wy,
            wz,
            dx,
            dy,
            dz,
          );
          if (neighbor === Block.WATER) continue;
          if (isSolid(neighbor) && !isTransparent(neighbor)) continue;

          // Skip bottom faces under more water (already handled) and
          // skip side faces that only face transparent non-air underwater columns —
          // still draw against true air (shore / surface drops).
          for (let c = 0; c < 4; c++) {
            const corner = face.corners[c]!;
            const yOff = f === 0 ? -0.02 : 0;
            positions.push(
              wx + corner[0],
              wy + corner[1] + yOff,
              wz + corner[2],
            );
            normals.push(dx, dy, dz);
          }
          indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
          base += 4;
        }
      }
    }
  }
  if (positions.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
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
              if (chunk.get(lx + dx, y, lz + dz) === Block.WATER) any = true;
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
      if (above === Block.WATER) continue;
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
