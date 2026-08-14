import { fbm2 } from "./noise";

/** World biomes — selected from temperature + moisture climate noise */
export const Biome = {
  OCEAN: "ocean",
  BEACH: "beach",
  PLAINS: "plains",
  FOREST: "forest",
  DESERT: "desert",
  MOUNTAINS: "mountains",
  SNOW: "snow",
  SWAMP: "swamp",
} as const;

export type BiomeId = (typeof Biome)[keyof typeof Biome];

export const BIOME_LABEL: Record<BiomeId, string> = {
  ocean: "Ocean",
  beach: "Beach",
  plains: "Plains",
  forest: "Forest",
  desert: "Desert",
  mountains: "Mountains",
  snow: "Snowy Peaks",
  swamp: "Swamp",
};

export type BiomeSample = {
  id: BiomeId;
  /** 0 cold … 1 hot */
  temperature: number;
  /** 0 dry … 1 wet */
  moisture: number;
  continental: number;
  /** Base continental height bias before local relief */
  heightBias: number;
  /** Multiplier on relief noise */
  relief: number;
  /** Tree placement threshold (higher = fewer trees) */
  treeThreshold: number;
  /** Prefer cactus instead of trees */
  cactus: boolean;
  /** Snow cap above this surface height */
  snowLine: number;
};

/** Climate fields vary slowly so biomes form large regions */
export function sampleClimate(
  wx: number,
  wz: number,
  seed: number,
): { temperature: number; moisture: number; continental: number } {
  const temperature = fbm2(wx * 0.0045, wz * 0.0045, seed + 900, 4, 2.0, 0.55);
  const moisture = fbm2(wx * 0.0055, wz * 0.0055, seed + 1400, 4, 2.1, 0.52);
  // Continentalness: low = ocean basins, high = inland
  const continental = fbm2(wx * 0.0032, wz * 0.0032, seed + 400, 5, 2.0, 0.5);
  return { temperature, moisture, continental };
}

/** Hermite blend, 0 below e0 and 1 above e1. */
export function smooth01(e0: number, e1: number, x: number): number {
  if (e1 === e0) return x >= e1 ? 1 : 0;
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Soft climate weights for height blending (not the discrete paint biome). */
export type TerrainInfluence = {
  ocean: number;
  beach: number;
  mountain: number;
  snow: number;
  desert: number;
  swamp: number;
};

export function terrainInfluence(
  temperature: number,
  moisture: number,
  continental: number,
  heightHint: number,
  seaLevel: number,
): TerrainInfluence {
  const ocean = 1 - smooth01(0.26, 0.41, continental);
  const nearCoast =
    smooth01(0.26, 0.36, continental) * (1 - smooth01(0.40, 0.52, continental));
  const lowLand = 1 - smooth01(seaLevel + 1, seaLevel + 8, heightHint);
  const beach = Math.min(
    1,
    (1 - ocean) * nearCoast * lowLand +
      ocean * smooth01(seaLevel - 5, seaLevel + 2, heightHint) * 0.4,
  );

  const inland = 1 - ocean;
  // Climate first: hot + dry is dune country, even on high continentalness.
  const desert =
    inland *
    smooth01(0.54, 0.68, temperature) *
    (1 - smooth01(0.30, 0.44, moisture));

  const mountain =
    inland *
    (1 - desert) *
    (1 - beach) *
    smooth01(0.52, 0.78, continental) *
    smooth01(seaLevel - 2, seaLevel + 18, heightHint);

  const snow = inland * (1 - desert) * (1 - smooth01(0.26, 0.40, temperature));
  const swamp =
    inland *
    (1 - mountain) *
    (1 - desert) *
    smooth01(0.54, 0.70, moisture) *
    (1 - smooth01(0.48, 0.62, continental)) *
    (1 - smooth01(seaLevel + 2, seaLevel + 9, heightHint));

  return { ocean, beach, mountain, snow, desert, swamp };
}

export function biomeFromClimate(
  temperature: number,
  moisture: number,
  continental: number,
  heightHint: number,
  seaLevel: number,
): BiomeId {
  // Deep / shallow ocean from continental basins
  if (continental < 0.34) {
    if (heightHint < seaLevel - 1) return Biome.OCEAN;
    return Biome.BEACH;
  }
  if (continental < 0.4 && heightHint <= seaLevel + 2) return Biome.BEACH;

  // Cold
  if (temperature < 0.32) {
    if (heightHint > seaLevel + 12 || continental > 0.62) return Biome.SNOW;
    if (moisture > 0.55) return Biome.SNOW;
    return Biome.SNOW;
  }

  // Hot dry
  if (temperature > 0.62 && moisture < 0.38) return Biome.DESERT;

  // Mountains on high continental + high local relief hint
  if (continental > 0.68 && heightHint > seaLevel + 10) return Biome.MOUNTAINS;

  // Wet lowlands
  if (moisture > 0.62 && continental < 0.55 && heightHint < seaLevel + 5) {
    return Biome.SWAMP;
  }

  // Forests
  if (moisture > 0.48 && temperature > 0.35 && temperature < 0.72) {
    return Biome.FOREST;
  }

  // Default plains
  if (heightHint > seaLevel + 14 && continental > 0.6) return Biome.MOUNTAINS;

  return Biome.PLAINS;
}

export function getBiomeParams(id: BiomeId): Omit<BiomeSample, "temperature" | "moisture" | "continental"> {
  switch (id) {
    case Biome.OCEAN:
      return {
        id,
        heightBias: -18,
        relief: 0.55,
        treeThreshold: 1.1,
        cactus: false,
        snowLine: 200,
      };
    case Biome.BEACH:
      return {
        id,
        heightBias: -2,
        relief: 0.45,
        treeThreshold: 1.1,
        cactus: false,
        snowLine: 200,
      };
    case Biome.PLAINS:
      return {
        id,
        heightBias: 0,
        relief: 1.15,
        treeThreshold: 0.985,
        cactus: false,
        snowLine: 95,
      };
    case Biome.FOREST:
      return {
        id,
        heightBias: 2,
        relief: 1.2,
        treeThreshold: 0.955,
        cactus: false,
        snowLine: 98,
      };
    case Biome.DESERT:
      return {
        id,
        heightBias: -2,
        relief: 0.95,
        treeThreshold: 1.1,
        cactus: true,
        snowLine: 200,
      };
    case Biome.MOUNTAINS:
      return {
        id,
        heightBias: 14,
        relief: 1.9,
        treeThreshold: 0.992,
        cactus: false,
        snowLine: 88,
      };
    case Biome.SNOW:
      return {
        id,
        heightBias: 6,
        relief: 1.35,
        treeThreshold: 0.978,
        cactus: false,
        snowLine: 58,
      };
    case Biome.SWAMP:
      return {
        id,
        heightBias: -4,
        relief: 0.4,
        treeThreshold: 0.97,
        cactus: false,
        snowLine: 200,
      };
    default:
      return {
        id: Biome.PLAINS,
        heightBias: 0,
        relief: 1.15,
        treeThreshold: 0.985,
        cactus: false,
        snowLine: 95,
      };
  }
}

/**
 * Full biome sample at world XZ. Uses a cheap height hint so ocean/beach
 * classification stays consistent with final terrain.
 */
export function sampleBiome(wx: number, wz: number, seed: number, seaLevel: number): BiomeSample {
  const { temperature, moisture, continental } = sampleClimate(wx, wz, seed);
  // Height hint aligned with multi-scale relief (see chunk.surfaceAt)
  const macro = fbm2(wx * 0.008, wz * 0.008, seed + 50, 5, 2.05, 0.5);
  const hills = fbm2(wx * 0.02, wz * 0.02, seed, 6, 2.1, 0.48);
  const heightHint =
    seaLevel +
    (continental - 0.45) * 22 +
    (macro - 0.5) * 28 +
    (hills - 0.45) * 18;
  const id = biomeFromClimate(temperature, moisture, continental, heightHint, seaLevel);
  const params = getBiomeParams(id);
  return {
    ...params,
    temperature,
    moisture,
    continental,
  };
}

/**
 * Authored grass-top / short-grass average. Vertex tint is relative to this
 * so plains stay as-painted and inventory icons don't need a special path.
 */
export const GRASS_TINT_REF: [number, number, number] = [0.42, 0.64, 0.30];

function mix3(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  const u = Math.max(0, Math.min(1, t));
  return [
    a[0] + (b[0] - a[0]) * u,
    a[1] + (b[1] - a[1]) * u,
    a[2] + (b[2] - a[2]) * u,
  ];
}

/** Continuous climate grass color (Minecraft-style temp × moisture triangle). */
export function grassTintAt(
  wx: number,
  wz: number,
  seed: number,
): [number, number, number] {
  const { temperature, moisture, continental } = sampleClimate(wx, wz, seed);
  const macro = fbm2(wx * 0.008, wz * 0.008, seed + 50, 5, 2.05, 0.5);
  const hills = fbm2(wx * 0.02, wz * 0.02, seed, 6, 2.1, 0.48);
  const heightHint =
    62 + (continental - 0.45) * 22 + (macro - 0.5) * 28 + (hills - 0.45) * 18;
  const inf = terrainInfluence(temperature, moisture, continental, heightHint, 62);

  const t = Math.max(0, Math.min(1, temperature));
  const rain = Math.max(0, Math.min(1, moisture)) * t;
  const dry: [number, number, number] = [0.74, 0.68, 0.28];
  const lush: [number, number, number] = [0.34, 0.72, 0.26];
  const cold: [number, number, number] = [0.58, 0.70, 0.58];
  let c = mix3(cold, mix3(dry, lush, rain), t);

  c = mix3(c, [0.34, 0.40, 0.18], inf.swamp * 0.85);
  c = mix3(c, [0.64, 0.73, 0.64], inf.snow * 0.7);
  c = mix3(c, [0.42, 0.54, 0.32], inf.mountain * 0.45);
  c = mix3(c, dry, inf.desert * 0.55);
  c = mix3(c, [0.50, 0.66, 0.34], inf.beach * 0.25);
  return c;
}

/** Multiplier vs the authored grass tile (1,1,1 on typical plains). */
export function grassTintMul(
  wx: number,
  wz: number,
  seed: number,
): [number, number, number] {
  const [r, g, b] = grassTintAt(wx, wz, seed);
  return [
    r / GRASS_TINT_REF[0],
    g / GRASS_TINT_REF[1],
    b / GRASS_TINT_REF[2],
  ];
}

