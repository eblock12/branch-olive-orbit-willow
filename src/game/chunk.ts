import * as THREE from "three";
import { Block, BLOCKS, isSolid, isTransparent } from "./blocks";
import { fbm2, shouldPlaceTree, shouldPlaceCactus } from "./noise";
import { sampleBiome, Biome, type BiomeId } from "./biomes";
import { tileUVs } from "./textures";

export const CHUNK_SIZE = 16;
/** Vertical world extent — deep oceans + tall peaks */
export const CHUNK_HEIGHT = 160;
export const SEA_LEVEL = 48;


export type ChunkKey = string;

export function chunkKey(cx: number, cz: number): ChunkKey {
  return `${cx},${cz}`;
}

export function worldToChunk(wx: number, wz: number): [number, number] {
  return [Math.floor(wx / CHUNK_SIZE), Math.floor(wz / CHUNK_SIZE)];
}

export class Chunk {
  readonly cx: number;
  readonly cz: number;
  /** Flat array: index = x + z * SIZE + y * SIZE * SIZE */
  blocks: Uint8Array;
  mesh: THREE.Mesh | null = null;
  dirty = true;

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
    const baseX = this.cx * CHUNK_SIZE;
    const baseZ = this.cz * CHUNK_SIZE;

    const surfaceAt = (
      wx: number,
      wz: number,
    ): {
      height: number;
      biome: BiomeId;
      snowLine: number;
      treeThreshold: number;
      cactus: boolean;
    } => {
      const biome = sampleBiome(wx, wz, seed, SEA_LEVEL);

      // Multi-scale relief: continents → hills → ridges → detail
      const continental = fbm2(wx * 0.0035, wz * 0.0035, seed + 11, 5, 2.0, 0.52);
      const macro = fbm2(wx * 0.008, wz * 0.008, seed + 50, 5, 2.05, 0.5);
      const hills = fbm2(wx * 0.02, wz * 0.02, seed, 6, 2.1, 0.48);
      const detail = fbm2(wx * 0.055, wz * 0.055, seed + 120, 3, 2.2, 0.45);
      const ridge = fbm2(wx * 0.012, wz * 0.012, seed + 80, 4, 2.15, 0.5);
      // Domain warp for less regular slopes
      const warpX = fbm2(wx * 0.015, wz * 0.015, seed + 200, 3, 2, 0.5);
      const warpZ = fbm2(wx * 0.015 + 40, wz * 0.015 + 40, seed + 210, 3, 2, 0.5);
      const warped = fbm2(
        wx * 0.018 + warpX * 4,
        wz * 0.018 + warpZ * 4,
        seed + 220,
        4,
        2.1,
        0.5,
      );

      // Ridged multifractal peaks (0..1, sharp summits)
      const ridged = 1 - Math.abs(ridge * 2 - 1);
      const ridgedPeak = Math.pow(ridged, 1.35);

      let height =
        SEA_LEVEL +
        biome.heightBias +
        (continental - 0.45) * 22 * biome.relief +
        (macro - 0.5) * 28 * biome.relief +
        (hills - 0.45) * 18 * biome.relief +
        (detail - 0.5) * 5 * biome.relief +
        (warped - 0.5) * 10 * biome.relief;

      if (biome.id === Biome.MOUNTAINS) {
        height += ridgedPeak * 48 + ridge * 18 + macro * 12;
        // Occasional spires
        height += Math.pow(ridged, 3.2) * 22;
      } else if (biome.id === Biome.SNOW) {
        height += ridgedPeak * 22 + hills * 8;
      } else if (biome.id === Biome.DESERT) {
        // Rolling dunes
        height +=
          Math.sin(wx * 0.09 + warpX * 6) * 3.5 +
          Math.sin(wz * 0.07 + warpZ * 5) * 2.8 +
          ridged * 4;
      } else if (biome.id === Biome.SWAMP) {
        height = SEA_LEVEL - 2 + hills * 3.5 + detail * 1.5 + (macro - 0.5) * 2;
      } else if (biome.id === Biome.OCEAN) {
        // Deep trenches + seamounts
        height =
          SEA_LEVEL -
          14 -
          macro * 22 -
          hills * 12 -
          ridgedPeak * 18 -
          detail * 4;
        height += Math.pow(1 - ridged, 2) * 6; // abyssal flats
      } else if (biome.id === Biome.BEACH) {
        height = SEA_LEVEL + (hills - 0.4) * 4 + detail * 1.5;
      } else if (biome.id === Biome.FOREST || biome.id === Biome.PLAINS) {
        // Rolling countryside with occasional high ground
        height += ridgedPeak * 6 * biome.relief;
      }

      height = Math.floor(height);
      // Leave headroom for trees / player
      height = Math.max(4, Math.min(CHUNK_HEIGHT - 16, height));
      return {
        height,
        biome: biome.id,
        snowLine: biome.snowLine,
        treeThreshold: biome.treeThreshold,
        cactus: biome.cactus,
      };
    };


    const surfaceBlock = (biome: BiomeId, height: number, snowLine: number): number => {
      if (biome === Biome.DESERT || biome === Biome.BEACH) return Block.SAND;
      if (biome === Biome.OCEAN) return height < SEA_LEVEL - 2 ? Block.SAND : Block.SAND;
      if (biome === Biome.MOUNTAINS && height >= snowLine) return Block.SNOW;
      if (biome === Biome.MOUNTAINS && height >= snowLine - 6) return Block.STONE;
      if (biome === Biome.SNOW || height >= snowLine) return Block.SNOW_GRASS;
      if (biome === Biome.SWAMP) return Block.GRASS;
      return Block.GRASS;
    };

    const fillBlock = (biome: BiomeId, y: number, height: number): number => {
      if (biome === Biome.DESERT || biome === Biome.BEACH || biome === Biome.OCEAN) {
        return Block.SAND;
      }
      if (biome === Biome.MOUNTAINS && height > SEA_LEVEL + 12) {
        return y > height - 3 ? Block.STONE : Block.STONE;
      }
      return Block.DIRT;
    };

    // Pass 1: terrain columns + water
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = baseX + lx;
        const wz = baseZ + lz;
        const { height, biome, snowLine } = surfaceAt(wx, wz);
        const topId = surfaceBlock(biome, height, snowLine);

        for (let y = 0; y < CHUNK_HEIGHT; y++) {
          let id: number = Block.AIR;
          if (y === 0) {
            id = Block.BEDROCK;
          } else if (y < height - 4) {
            id = Block.STONE;
          } else if (y < height) {
            id = fillBlock(biome, y, height);
          } else if (y === height) {
            id = topId;
          } else if (y <= SEA_LEVEL && y > height) {
            // Water fills air below sea level
            if (
              biome === Biome.OCEAN ||
              biome === Biome.SWAMP ||
              biome === Biome.BEACH ||
              height < SEA_LEVEL
            ) {
              id = Block.WATER;
            }
          }

          // Frozen surface on cold biomes
          if (id === Block.WATER && y === Math.min(SEA_LEVEL, height + 1)) {
            const cold =
              biome === Biome.SNOW ||
              sampleBiome(wx, wz, seed, SEA_LEVEL).temperature < 0.3;
            if (cold && y === SEA_LEVEL) id = Block.ICE;
          }


          this.blocks[this.index(lx, y, lz)] = id;
        }

        // Mountain snow dusting on stone tops
        if (biome === Biome.MOUNTAINS && height >= snowLine - 2) {
          const hy = height;
          if (hy > 0 && hy < CHUNK_HEIGHT) {
            this.blocks[this.index(lx, hy, lz)] =
              height >= snowLine ? Block.SNOW : Block.STONE;
          }
        }
      }
    }

    // Pass 2: trees / cactus — sample outside chunk for canopy wrap
    const CANOPY = 2;
    for (let oz = -CANOPY; oz < CHUNK_SIZE + CANOPY; oz++) {
      for (let ox = -CANOPY; ox < CHUNK_SIZE + CANOPY; ox++) {
        const wx = baseX + ox;
        const wz = baseZ + oz;
        const { height, biome, treeThreshold, cactus } = surfaceAt(wx, wz);
        if (height <= SEA_LEVEL) continue;
        if (biome === Biome.OCEAN || biome === Biome.BEACH) continue;

        // Cactus in desert
        if (cactus) {
          if (!shouldPlaceCactus(wx, wz, seed)) continue;
          if (ox < 0 || oz < 0 || ox >= CHUNK_SIZE || oz >= CHUNK_SIZE) continue;
          const h = 2 + Math.floor(fbm2(wx, wz, seed + 3) * 3);
          for (let t = 1; t <= h; t++) {
            const ty = height + t;
            if (ty < CHUNK_HEIGHT) this.blocks[this.index(ox, ty, oz)] = Block.CACTUS;
          }
          continue;
        }

        if (biome === Biome.DESERT) continue;
        if (!shouldPlaceTree(wx, wz, seed, treeThreshold)) continue;

        // Snow / mountain: taller thin spruce-like
        const isTall =
          biome === Biome.SNOW || biome === Biome.MOUNTAINS || biome === Biome.FOREST;
        const trunkH = isTall
          ? 5 + Math.floor(fbm2(wx, wz, seed + 7) * 4)
          : 4 + Math.floor(fbm2(wx, wz, seed + 7) * 3);
        const top = height + trunkH;
        const canopyR = biome === Biome.FOREST ? 2 : biome === Biome.SNOW ? 1 : 2;

        if (ox >= 0 && oz >= 0 && ox < CHUNK_SIZE && oz < CHUNK_SIZE) {
          for (let t = 1; t <= trunkH; t++) {
            const ty = height + t;
            if (ty >= 0 && ty < CHUNK_HEIGHT) {
              this.blocks[this.index(ox, ty, oz)] = Block.WOOD;
            }
          }
        }

        for (let dy = -2; dy <= 3; dy++) {
          for (let dx = -canopyR; dx <= canopyR; dx++) {
            for (let dz = -canopyR; dz <= canopyR; dz++) {
              const dist = Math.abs(dx) + Math.abs(dz);
              if (biome === Biome.SNOW || biome === Biome.MOUNTAINS) {
                // Conical spruce
                const layerR = Math.max(0, 2 - Math.floor((dy + 2) * 0.6));
                if (dist > layerR) continue;
              } else {
                if (dy === -2 && dist > 1) continue;
                if (dy === -1 && dist > 2) continue;
                if (dy === 0 && dist > 2) continue;
                if (dy === 1 && dist > 2) continue;
                if (dy === 2 && dist > 1) continue;
                if (dy === 3 && dist > 0) continue;
                if (Math.abs(dx) === canopyR && Math.abs(dz) === canopyR && dy < 2) {
                  continue;
                }
              }
              if (dx === 0 && dz === 0 && dy <= 0) continue;

              const lx2 = ox + dx;
              const lz2 = oz + dz;
              const ly = top + dy;
              if (
                lx2 < 0 ||
                lz2 < 0 ||
                lx2 >= CHUNK_SIZE ||
                lz2 >= CHUNK_SIZE ||
                ly < 0 ||
                ly >= CHUNK_HEIGHT
              ) {
                continue;
              }
              const idx = this.index(lx2, ly, lz2);
              if (this.blocks[idx] === Block.AIR) {
                this.blocks[idx] = Block.LEAVES;
              }
            }
          }
        }
      }
    }

    this.dirty = true;
  }

  dispose(): void {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
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

type NeighborGetter = (wx: number, wy: number, wz: number) => number;

/** Wind factor for shader sway: leaves only (wood stays rigid) */
function windFactorFor(id: number): number {
  if (id === Block.LEAVES) return 1;
  return 0;
}

export function buildChunkGeometry(
  chunk: Chunk,
  getBlock: NeighborGetter,
): THREE.BufferGeometry | null {
  const baseX = chunk.cx * CHUNK_SIZE;
  const baseZ = chunk.cz * CHUNK_SIZE;

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const winds: number[] = [];
  const indices: number[] = [];
  let base = 0;

  for (let y = 0; y < CHUNK_HEIGHT; y++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const id = chunk.get(lx, y, lz);
        if (id === Block.AIR) continue;
        const def = BLOCKS[id];
        if (!def) continue;

        const wx = baseX + lx;
        const wy = y;
        const wz = baseZ + lz;
        const wind = windFactorFor(id);
        // Slight height boost on leaves for more sway aloft
        const heightBoost =
          id === Block.LEAVES ? 0.15 + (y / CHUNK_HEIGHT) * 0.35 : 0;

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


          // Cull face only against fully opaque solid blocks
          if (isSolid(neighbor) && !isTransparent(neighbor)) {
            continue;
          }
          // Don't draw internal water/ice faces
          if (id === Block.WATER && neighbor === Block.WATER) continue;
          if (id === Block.ICE && neighbor === Block.ICE) continue;

          const tile =
            f === 0 ? def.tiles[0] : f === 1 ? def.tiles[1] : def.tiles[2];
          const { u0, v0, u1, v1 } = tileUVs(tile);
          const shade = FACE_SHADE[f]!;
          // Vertex colors: slight biome-agnostic face light
          const cr = shade;
          const cg = shade;
          const cb = shade;

          const uvPairs: [number, number][] = [
            [u0, v0],
            [u1, v0],
            [u1, v1],
            [u0, v1],
          ];

          for (let c = 0; c < 4; c++) {
            const corner = face.corners[c]!;
            positions.push(wx + corner[0], wy + corner[1], wz + corner[2]);
            normals.push(dx, dy, dz);
            const uv = uvPairs[c]!;
            uvs.push(uv[0], uv[1]);
            colors.push(cr, cg, cb);
            winds.push(Math.min(1, wind + heightBoost * wind));
          }

          // CCW winding for outward normal
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
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute("wind", new THREE.Float32BufferAttribute(winds, 1));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}
