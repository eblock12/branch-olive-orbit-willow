import { Block, type BlockId } from "./blocks";
import { Biome, type BiomeId } from "./biomes";
import { hash2, fbm2 } from "./noise";
import { CHUNK_SIZE, CHUNK_HEIGHT, SEA_LEVEL } from "./chunkConstants";

type SurfaceFn = (
  wx: number,
  wz: number,
) => { height: number; biome: BiomeId };

function idx(x: number, y: number, z: number): number {
  return x + z * CHUNK_SIZE + y * CHUNK_SIZE * CHUNK_SIZE;
}

const MEADOW_FLOWERS: BlockId[] = [
  Block.POPPY,
  Block.DANDELION,
  Block.CORNFLOWER,
  Block.ALLIUM,
  Block.AZURE_BLUET,
  Block.OXEYE_DAISY,
  Block.TULIP_RED,
  Block.TULIP_ORANGE,
  Block.TULIP_PINK,
  Block.TULIP_WHITE,
  Block.BLUEBELL,
  Block.LAVENDER,
  Block.ROSE,
  Block.FIREWEED,
];

/**
 * Scatter cross-shaped plants on valid surfaces inside this chunk.
 */
export function placePlantsInChunk(
  blocks: Uint8Array,
  cx: number,
  cz: number,
  seed: number,
  surfaceAt: SurfaceFn,
): void {
  const baseX = cx * CHUNK_SIZE;
  const baseZ = cz * CHUNK_SIZE;

  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const wx = baseX + lx;
      const wz = baseZ + lz;
      // Keep spawn clearing free of tall clutter
      if (wx * wx + wz * wz < 12 * 12) continue;

      const { height, biome } = surfaceAt(wx, wz);
      if (height <= SEA_LEVEL) {
        // Swamp shallows: cattails
        if (
          biome === Biome.SWAMP &&
          height >= SEA_LEVEL - 2 &&
          height <= SEA_LEVEL
        ) {
          const h = hash2(wx, wz, seed + 501);
          if (h > 0.92) {
            const py = height + 1;
            if (py < CHUNK_HEIGHT && blocks[idx(lx, height, lz)] !== Block.AIR) {
              const above = idx(lx, py, lz);
              if (blocks[above] === Block.AIR || blocks[above] === Block.WATER) {
                blocks[above] = Block.CATTAIL;
              }
            }
          }
        }
        continue;
      }

      const ground = blocks[idx(lx, height, lz)]!;
      const py = height + 1;
      if (py >= CHUNK_HEIGHT) continue;
      if (blocks[idx(lx, py, lz)] !== Block.AIR) continue;

      // Must sit on grass / dirt / sand / snow
      const onGrass =
        ground === Block.GRASS || ground === Block.SNOW_GRASS;
      const onDirt = ground === Block.DIRT;
      const onSand = ground === Block.SAND;
      const onSnow = ground === Block.SNOW || ground === Block.SNOW_GRASS;
      if (!onGrass && !onDirt && !onSand && !onSnow) continue;

      const h = hash2(wx, wz, seed + 9001);
      const patch = fbm2(wx * 0.04, wz * 0.04, seed + 44, 3);

      // Desert: dead bush
      if (biome === Biome.DESERT || (biome === Biome.BEACH && onSand)) {
        if (h > 0.988) blocks[idx(lx, py, lz)] = Block.DEAD_BUSH;
        continue;
      }

      // Mushrooms in dark forest floor patches
      if (
        (biome === Biome.FOREST || biome === Biome.SWAMP) &&
        patch < 0.38 &&
        h > 0.982
      ) {
        blocks[idx(lx, py, lz)] =
          h > 0.991 ? Block.MUSHROOM_RED : Block.MUSHROOM_BROWN;
        continue;
      }

      // Snow: sparse dead grass / fern only
      if (biome === Biome.SNOW || biome === Biome.MOUNTAINS) {
        if (onSnow && h > 0.975) {
          blocks[idx(lx, py, lz)] =
            h > 0.99 ? Block.FERN : Block.SHORT_GRASS;
        }
        continue;
      }

      // Sunflowers in open plains patches
      if (biome === Biome.PLAINS && patch > 0.62 && h > 0.97) {
        blocks[idx(lx, py, lz)] = Block.SUNFLOWER;
        continue;
      }

      // Lavender / fireweed fields
      if (biome === Biome.PLAINS && patch > 0.55 && patch < 0.62 && h > 0.94) {
        blocks[idx(lx, py, lz)] =
          h > 0.97 ? Block.FIREWEED : Block.LAVENDER;
        continue;
      }

      // Short grass carpet
      if (onGrass && h > 0.72 - patch * 0.15) {
        // Density by biome
        const dens =
          biome === Biome.FOREST
            ? 0.86
            : biome === Biome.PLAINS
              ? 0.78
              : biome === Biome.SWAMP
                ? 0.88
                : 0.9;
        if (h > dens) {
          blocks[idx(lx, py, lz)] =
            h > dens + 0.06 ? Block.FERN : Block.SHORT_GRASS;
          continue;
        }
      }

      // Flower scatter
      if (onGrass && h > 0.965) {
        const fi = Math.floor(
          hash2(wx, wz, seed + 77) * MEADOW_FLOWERS.length,
        );
        // Forest: more bluebells / roses; plains: tulips & daisies
        let id = MEADOW_FLOWERS[fi] ?? Block.POPPY;
        if (biome === Biome.FOREST && h > 0.985) id = Block.BLUEBELL;
        if (biome === Biome.SWAMP && h > 0.98) id = Block.BLUEBELL;
        blocks[idx(lx, py, lz)] = id;
      }
    }
  }
}
