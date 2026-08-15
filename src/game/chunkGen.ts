import { Block, isLeaves, isLog, isSolid } from "./blocks";
import { fbm2, hash2, shouldPlaceTree, shouldPlaceCactus } from "./noise";
import { sampleBiome, terrainInfluence, Biome, type BiomeId } from "./biomes";
import { shouldCarveCave, shouldFloodCave } from "./caves";
import { placeStructuresInChunk } from "./structures";
import { placePlantsInChunk } from "./plants";
import { placeOresInChunk } from "./ores";
import { CHUNK_SIZE, CHUNK_HEIGHT, SEA_LEVEL } from "./chunkConstants";

function index(x: number, y: number, z: number): number {
  return x + z * CHUNK_SIZE + y * CHUNK_SIZE * CHUNK_SIZE;
}

/**
 * Force water into flat horizontal planes:
 * - Nothing above SEA_LEVEL
 * - Surface water is a continuous fill from top solid → SEA_LEVEL only
 * - No floating water (air below)
 * - Underground water keeps a single flat top per column (no thin vertical spikes)
 */
function normalizeWater(blocks: Uint8Array, surfH: Int16Array): void {
  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const surface = surfH[lx + lz * CHUNK_SIZE]!;

      // Strip any water above sea level (prevents towers / spills)
      for (let y = SEA_LEVEL + 1; y < CHUNK_HEIGHT; y++) {
        const i = index(lx, y, lz);
        if (blocks[i] === Block.WATER) blocks[i] = Block.AIR;
      }

      // --- Surface water: flat plane at SEA_LEVEL ---
      if (surface < SEA_LEVEL) {
        // Clear open column then refill solid slab seafloor → sea
        for (let y = surface + 1; y <= SEA_LEVEL; y++) {
          const i = index(lx, y, lz);
          const cur = blocks[i]!;
          // Don't overwrite ice sheet
          if (cur === Block.ICE) continue;
          if (
            cur === Block.AIR ||
            cur === Block.WATER ||
            isLeaves(cur) ||
            isLog(cur)
          ) {
            blocks[i] = Block.WATER;
          }
        }
        // Ensure nothing water-like sits above the plane
        for (let y = SEA_LEVEL + 1; y < CHUNK_HEIGHT; y++) {
          const i = index(lx, y, lz);
          if (blocks[i] === Block.WATER) blocks[i] = Block.AIR;
        }
      } else {
        // Land: no surface water above the ground
        for (let y = surface + 1; y <= SEA_LEVEL; y++) {
          const i = index(lx, y, lz);
          if (blocks[i] === Block.WATER) blocks[i] = Block.AIR;
        }
      }

      // --- Remove floating water (air/plant below) bottom-up, then flatten tops ---
      // First pass: water must rest on solid or water
      for (let y = 1; y < CHUNK_HEIGHT; y++) {
        const i = index(lx, y, lz);
        if (blocks[i] !== Block.WATER) continue;
        const below = blocks[index(lx, y - 1, lz)]!;
        if (
          below === Block.AIR ||
          isLeaves(below) ||
          isLog(below)
        ) {
          // drop: clear floating cell
          blocks[i] = Block.AIR;
        }
      }

      // Second pass: underground water — find top water cell under solid ground
      // and remove isolated 1-wide spikes above the main body by keeping only
      // water that has water or solid neighbors below continuously from floor.
      if (surface >= SEA_LEVEL) {
        // Find highest water below surface
        let topW = -1;
        for (let y = Math.min(surface - 1, SEA_LEVEL - 1); y >= 1; y--) {
          if (blocks[index(lx, y, lz)] === Block.WATER) {
            topW = y;
            break;
          }
        }
        if (topW > 0) {
          // Ensure solid fill from first solid/bedrock support up to topW
          // Remove water above topW already none; remove water gaps
          let supported = false;
          for (let y = 1; y <= topW; y++) {
            const i = index(lx, y, lz);
            const cur = blocks[i]!;
            if (cur === Block.WATER) {
              if (!supported) {
                // Check if resting on solid
                const b = blocks[index(lx, y - 1, lz)]!;
                if (b === Block.AIR) {
                  blocks[i] = Block.AIR;
                  continue;
                }
                supported = true;
              }
            } else if (cur !== Block.AIR && cur !== Block.WATER) {
              // solid resets support for water above
              supported = true;
            } else if (cur === Block.AIR && supported) {
              // air gap under a water top — will clear water above gap
              // mark unsupported
              supported = false;
            }
          }
          // Clear any water above first gap: re-scan
          let underWater = false;
          for (let y = 1; y <= topW; y++) {
            const i = index(lx, y, lz);
            if (blocks[i] === Block.WATER) {
              const b = blocks[index(lx, y - 1, lz)]!;
              if (b !== Block.WATER && b !== Block.BEDROCK && !isSolidId(b)) {
                blocks[i] = Block.AIR;
                underWater = false;
              } else {
                underWater = true;
              }
            } else if (blocks[i] !== Block.AIR) {
              underWater = false;
            } else if (underWater) {
              // air inside water column - stop water above
              underWater = false;
            }
          }
          // Final: water column should be contiguous from lowest water to topW
          let lowW = -1;
          for (let y = 1; y <= topW; y++) {
            if (blocks[index(lx, y, lz)] === Block.WATER) {
              lowW = y;
              break;
            }
          }
          if (lowW > 0) {
            // Recompute actual top after clears
            let hi = lowW;
            for (let y = lowW; y <= topW; y++) {
              if (blocks[index(lx, y, lz)] === Block.WATER) hi = y;
              else break; // stop at first gap — flat top at last water
            }
            // Remove water above contiguous stack (kills towers above lake)
            for (let y = hi + 1; y < surface; y++) {
              const i = index(lx, y, lz);
              if (blocks[i] === Block.WATER) blocks[i] = Block.AIR;
            }
          }
        }
      }
    }
  }
}

function isSolidId(id: number): boolean {
  return isSolid(id);
}

/** Pure voxel fill for one chunk — safe to run in a Web Worker */
export function generateChunkBlocks(
  cx: number,
  cz: number,
  seed: number,
  out?: Uint8Array,
): Uint8Array {
  const blocks = out ?? new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT);
  if (out) blocks.fill(0);
  const getLocal = (x: number, y: number, z: number): number => {
    if (x < 0 || y < 0 || z < 0 || x >= CHUNK_SIZE || z >= CHUNK_SIZE || y >= CHUNK_HEIGHT)
      return Block.AIR;
    return blocks[index(x, y, z)]!;
  };

  const baseX = cx * CHUNK_SIZE;
  const baseZ = cz * CHUNK_SIZE;

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

    const heightHint =
      SEA_LEVEL +
      (biome.continental - 0.45) * 22 +
      (macro - 0.5) * 28 +
      (hills - 0.45) * 18;
    const inf = terrainInfluence(
      biome.temperature,
      biome.moisture,
      biome.continental,
      heightHint,
      SEA_LEVEL,
    );

    const relief =
      1.12 +
      inf.mountain * 0.78 +
      inf.snow * 0.18 -
      inf.ocean * 0.55 -
      inf.beach * 0.5 -
      inf.swamp * 0.65 -
      inf.desert * 0.4;
    const bias =
      inf.mountain * 14 +
      inf.snow * 5 +
      inf.desert * -2 +
      inf.swamp * -3 +
      inf.beach * -2 +
      inf.ocean * -14;

    let height =
      SEA_LEVEL +
      bias +
      (continental - 0.45) * 22 * relief +
      (macro - 0.5) * 28 * relief +
      (hills - 0.45) * 18 * relief +
      (detail - 0.5) * 5 * relief +
      (warped - 0.5) * 10 * relief;

    // Peak extras fade with mountain weight — no more sliced ridgelines
    height +=
      inf.mountain *
      (ridgedPeak * 48 + ridge * 18 + macro * 12 + Math.pow(ridged, 3.2) * 22);
    height += inf.snow * (1 - inf.mountain * 0.55) * (ridgedPeak * 22 + hills * 8);
    const dunes =
      Math.sin(wx * 0.09 + warpX * 6) * 3.5 +
      Math.sin(wz * 0.07 + warpZ * 5) * 2.8 +
      ridged * 4;
    height += inf.desert * dunes;
    // Gentle countryside folds where mountains haven't taken over
    height +=
      (1 - inf.ocean) *
      (1 - inf.beach) *
      (1 - inf.swamp) *
      (1 - inf.desert) *
      (1 - inf.mountain) *
      ridgedPeak *
      6;

    const swampH = SEA_LEVEL - 2 + hills * 3.5 + detail * 1.5 + (macro - 0.5) * 2;
    height = height * (1 - inf.swamp) + swampH * inf.swamp;

    const desertH = SEA_LEVEL - 1 + hills * 5 + detail * 2 + dunes;
    height = height * (1 - inf.desert) + desertH * inf.desert;

    const beachH = SEA_LEVEL + (hills - 0.4) * 4 + detail * 1.5;
    height = height * (1 - inf.beach) + beachH * inf.beach;

    const oceanH =
      SEA_LEVEL -
      14 -
      macro * 22 -
      hills * 12 -
      ridgedPeak * 18 -
      detail * 4 +
      Math.pow(1 - ridged, 2) * 6;
    height = height * (1 - inf.ocean) + oceanH * inf.ocean;

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


  const surfaceBlock = (
    biome: BiomeId,
    height: number,
    snowLine: number,
    wx: number,
    wz: number,
  ): number => {
    if (biome === Biome.DESERT) return Block.SAND;
    if (biome === Biome.BEACH) {
      return hash2(wx, wz, seed + 78) > 0.68 && height <= SEA_LEVEL + 2
        ? Block.GRAVEL
        : Block.SAND;
    }
    if (biome === Biome.OCEAN) return Block.SAND;
    if (biome === Biome.MOUNTAINS && height >= snowLine) return Block.SNOW;
    if (biome === Biome.MOUNTAINS && height >= snowLine - 6) {
      return hash2(wx, wz, seed + 79) > 0.8 ? Block.GRAVEL : Block.STONE;
    }
    if (biome === Biome.SNOW || height >= snowLine) return Block.SNOW_GRASS;
    if (biome === Biome.SWAMP) {
      return hash2(wx, wz, seed + 77) > 0.55 ? Block.CLAY : Block.GRASS;
    }
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
      const topId = surfaceBlock(biome, height, snowLine, wx, wz);

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
          // Flat sea plane: fill only between seafloor and SEA_LEVEL (never above)
          if (height < SEA_LEVEL) {
            id = Block.WATER;
          }
        }

        // Frozen surface — only the flat top layer at SEA_LEVEL
        if (id === Block.WATER && y === SEA_LEVEL) {
          const cold =
            biome === Biome.SNOW ||
            sampleBiome(wx, wz, seed, SEA_LEVEL).temperature < 0.3;
          if (cold) id = Block.ICE;
        }


        blocks[index(lx, y, lz)] = id;
      }

      // Mountain snow dusting on stone tops
      if (biome === Biome.MOUNTAINS && height >= snowLine - 2) {
        const hy = height;
        if (hy > 0 && hy < CHUNK_HEIGHT) {
          blocks[index(lx, hy, lz)] =
            height >= snowLine ? Block.SNOW : Block.STONE;
        }
      }
    }
  }

  // Pass 1b: elaborate cave systems + surface mouths
  // Cache surface heights for this chunk (and small skirt for consistency)
  const surfH = new Int16Array(CHUNK_SIZE * CHUNK_SIZE);
  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const { height } = surfaceAt(baseX + lx, baseZ + lz);
      surfH[lx + lz * CHUNK_SIZE] = height;
    }
  }
  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const wx = baseX + lx;
      const wz = baseZ + lz;
      const height = surfH[lx + lz * CHUNK_SIZE]!;
      for (let y = 2; y <= height + 1 && y < CHUNK_HEIGHT; y++) {
        const idx = index(lx, y, lz);
        const cur = blocks[idx]!;
        if (cur === Block.BEDROCK || cur === Block.AIR || cur === Block.WATER) {
          continue;
        }
        if (!shouldCarveCave(wx, y, wz, height, seed)) continue;

        // Carve — flood if underground lake / under sea
        if (shouldFloodCave(y, height, SEA_LEVEL, wx, wz, seed)) {
          blocks[idx] = Block.WATER;
        } else {
          blocks[idx] = Block.AIR;
        }
      }
    }
  }

  // Pass 1c: enforce flat water planes — no towers / floating water columns
  normalizeWater(blocks, surfH);

  // Pass 1d: coal + iron in stone (after caves so walls get bonus veins)
  placeOresInChunk(blocks, cx, cz, seed);

  // Pass 2: trees / cactus — sample outside chunk for canopy wrap
  const CANOPY = 3;
  for (let oz = -CANOPY; oz < CHUNK_SIZE + CANOPY; oz++) {
    for (let ox = -CANOPY; ox < CHUNK_SIZE + CANOPY; ox++) {
      const wx = baseX + ox;
      const wz = baseZ + oz;
      const { height, biome, treeThreshold, cactus } = surfaceAt(wx, wz);
      if (height <= SEA_LEVEL) continue;
      if (biome === Biome.OCEAN || biome === Biome.BEACH) continue;

      // No vegetation in open cave mouths / sinkholes
      if (
        ox >= 0 &&
        oz >= 0 &&
        ox < CHUNK_SIZE &&
        oz < CHUNK_SIZE &&
        getLocal(ox, height, oz) === Block.AIR
      ) {
        continue;
      }
      if (shouldCarveCave(wx, height, wz, height, seed)) continue;

      // Cactus in desert
      if (cactus) {
        if (height > SEA_LEVEL + 14) continue;
        if (!shouldPlaceCactus(wx, wz, seed)) continue;
        if (ox < 0 || oz < 0 || ox >= CHUNK_SIZE || oz >= CHUNK_SIZE) continue;
        const h = 2 + Math.floor(fbm2(wx, wz, seed + 3) * 3);
        for (let t = 1; t <= h; t++) {
          const ty = height + t;
          if (ty < CHUNK_HEIGHT) blocks[index(ox, ty, oz)] = Block.CACTUS;
        }
        continue;
      }

      if (biome === Biome.DESERT) continue;
      if (!shouldPlaceTree(wx, wz, seed, treeThreshold)) continue;

      const pick = fbm2(wx * 0.8, wz * 0.8, seed + 19);
      type Species = "oak" | "birch" | "spruce" | "willow" | "jacaranda";
      let species: Species = "oak";
      if (biome === Biome.SNOW || biome === Biome.MOUNTAINS) species = "spruce";
      else if (biome === Biome.SWAMP) species = pick > 0.35 ? "willow" : "oak";
      else if (biome === Biome.LAVENDER_FIELD)
        species = pick > 0.35 ? "jacaranda" : "birch";
      else if (biome === Biome.PLAINS) species = pick > 0.58 ? "birch" : "oak";
      else if (biome === Biome.FOREST) {
        species = pick > 0.7 ? "birch" : pick < 0.18 ? "spruce" : "oak";
      }

      const wood =
        species === "birch" || species === "jacaranda"
          ? Block.BIRCH_WOOD
          : species === "spruce"
            ? Block.SPRUCE_WOOD
            : Block.WOOD;
      const leaf =
        species === "jacaranda"
          ? Block.JACARANDA_LEAVES
          : species === "birch"
            ? Block.BIRCH_LEAVES
            : species === "spruce"
              ? Block.SPRUCE_LEAVES
              : Block.LEAVES;

      const trunkH =
        species === "birch" || species === "jacaranda"
          ? 6 + Math.floor(fbm2(wx, wz, seed + 7) * 4)
          : species === "spruce"
            ? 6 + Math.floor(fbm2(wx, wz, seed + 7) * 5)
            : species === "willow"
              ? 3 + Math.floor(fbm2(wx, wz, seed + 7) * 3)
              : 4 + Math.floor(fbm2(wx, wz, seed + 7) * 3);
      const top = height + trunkH;
      const canopyR =
        species === "willow" || species === "jacaranda"
          ? 3
          : species === "spruce"
            ? 2
            : 2;

      if (ox >= 0 && oz >= 0 && ox < CHUNK_SIZE && oz < CHUNK_SIZE) {
        for (let t = 1; t <= trunkH; t++) {
          const ty = height + t;
          if (ty >= 0 && ty < CHUNK_HEIGHT) {
            blocks[index(ox, ty, oz)] = wood;
          }
        }
      }

      for (let dy = -2; dy <= 4; dy++) {
        for (let dx = -canopyR; dx <= canopyR; dx++) {
          for (let dz = -canopyR; dz <= canopyR; dz++) {
            const dist = Math.abs(dx) + Math.abs(dz);
            if (species === "spruce") {
              const layerR = Math.max(0, 2 - Math.floor((dy + 2) * 0.55));
              if (dist > layerR) continue;
            } else if (species === "willow") {
              if (dy < 0 || dy > 2) continue;
              if (dy === 0 && dist > 3) continue;
              if (dy === 1 && dist > 3) continue;
              if (dy === 2 && dist > 2) continue;
              if (Math.abs(dx) === 3 && Math.abs(dz) === 3) continue;
            } else if (species === "birch" || species === "jacaranda") {
              if (dy === -2 && dist > 0) continue;
              if (dy === -1 && dist > 1) continue;
              if (dy === 0 && dist > 2) continue;
              if (dy === 1 && dist > 2) continue;
              if (dy === 2 && dist > 1) continue;
              if (dy > 2 && dist > 0) continue;
              if (Math.abs(dx) === 2 && Math.abs(dz) === 2 && dy < 1) continue;
            } else {
              if (dy === -2 && dist > 1) continue;
              if (dy === -1 && dist > 2) continue;
              if (dy === 0 && dist > 2) continue;
              if (dy === 1 && dist > 2) continue;
              if (dy === 2 && dist > 1) continue;
              if (dy === 3 && dist > 0) continue;
              if (dy > 3) continue;
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
            const idx = index(lx2, ly, lz2);
            if (blocks[idx] === Block.AIR) {
              blocks[idx] = leaf;
            }

            // Willow / forest vines from the canopy rim
            if (
              (species === "willow" || (species === "oak" && biome === Biome.FOREST)) &&
              dist >= canopyR - 1 &&
              dy >= 0 &&
              dy <= 1 &&
              fbm2(wx + dx, wz + dz, seed + 41) > 0.72
            ) {
              const hang = species === "willow" ? 3 : 2;
              for (let v = 1; v <= hang; v++) {
                const vy = ly - v;
                if (vy <= height || vy < 0) break;
                const vi = index(lx2, vy, lz2);
                if (blocks[vi] !== Block.AIR) break;
                blocks[vi] = Block.VINE;
              }
            }
          }
        }
      }
    }
  }

  // Pass 3: structures (towers, ruins, shipwrecks, …) — after terrain/trees
  placeStructuresInChunk(blocks, cx, cz, seed, surfaceAt);

  // Pass 4: flowers, grass, ferns, mushrooms (cross-shaped)
  placePlantsInChunk(blocks, cx, cz, seed, surfaceAt);

  // ready for meshing
  return blocks;
}
