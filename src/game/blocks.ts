/** Block type IDs stored in chunk Uint8Arrays */
export const Block = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  SAND: 4,
  WOOD: 5,
  LEAVES: 6,
  COBBLE: 7,
  PLANKS: 8,
  BEDROCK: 9,
  SNOW: 10,
  ICE: 11,
  WATER: 12,
  CACTUS: 13,
  SNOW_GRASS: 14,
  // —— Plants / flowers (cross-shaped) ——
  SHORT_GRASS: 15,
  FERN: 16,
  DEAD_BUSH: 17,
  POPPY: 18,
  DANDELION: 19,
  CORNFLOWER: 20,
  ALLIUM: 21,
  AZURE_BLUET: 22,
  OXEYE_DAISY: 23,
  TULIP_RED: 24,
  TULIP_ORANGE: 25,
  TULIP_PINK: 26,
  TULIP_WHITE: 27,
  BLUEBELL: 28,
  LAVENDER: 29,
  SUNFLOWER: 30,
  ROSE: 31,
  MUSHROOM_RED: 32,
  MUSHROOM_BROWN: 33,
  CATTAIL: 34,
  FIREWEED: 35,
  // Flowing water levels 7→1 (source is WATER=12)
  WATER7: 36,
  WATER6: 37,
  WATER5: 38,
  WATER4: 39,
  WATER3: 40,
  WATER2: 41,
  WATER1: 42,
  TORCH: 43,
  COAL_ORE: 44,
  IRON_ORE: 45,
  FURNACE: 46,
  FURNACE_LIT: 47,
} as const;

export type BlockId = (typeof Block)[keyof typeof Block];

export type BlockShape = "cube" | "cross";

export type BlockDef = {
  id: BlockId;
  name: string;
  solid: boolean;
  transparent: boolean;
  /** Atlas tile indices: top, bottom, side (cross uses side for both planes) */
  tiles: [number, number, number];
  color: string;
  /** cube = full block; cross = X-shaped plant billboard */
  shape?: BlockShape;
};

/** Atlas is 8×8 grid of 16px tiles (64 slots) */
export const TILE_SIZE = 16;
export const ATLAS_TILES = 8;

function plant(
  id: BlockId,
  name: string,
  tile: number,
  color: string,
): BlockDef {
  return {
    id,
    name,
    solid: false,
    transparent: true,
    tiles: [tile, tile, tile],
    color,
    shape: "cross",
  };
}

export const BLOCKS: Record<number, BlockDef> = {
  [Block.AIR]: {
    id: Block.AIR,
    name: "Air",
    solid: false,
    transparent: true,
    tiles: [0, 0, 0],
    color: "transparent",
  },
  [Block.GRASS]: {
    id: Block.GRASS,
    name: "Grass",
    solid: true,
    transparent: false,
    tiles: [0, 2, 1],
    color: "#5a9e4b",
  },
  [Block.DIRT]: {
    id: Block.DIRT,
    name: "Dirt",
    solid: true,
    transparent: false,
    tiles: [2, 2, 2],
    color: "#8b5a2b",
  },
  [Block.STONE]: {
    id: Block.STONE,
    name: "Stone",
    solid: true,
    transparent: false,
    tiles: [3, 3, 3],
    color: "#7a7a7e",
  },
  [Block.SAND]: {
    id: Block.SAND,
    name: "Sand",
    solid: true,
    transparent: false,
    tiles: [4, 4, 4],
    color: "#d4c08a",
  },
  [Block.WOOD]: {
    id: Block.WOOD,
    name: "Wood",
    solid: true,
    transparent: false,
    tiles: [5, 5, 6],
    color: "#6b4a2e",
  },
  [Block.LEAVES]: {
    id: Block.LEAVES,
    name: "Leaves",
    solid: true,
    transparent: true,
    tiles: [7, 7, 7],
    color: "#3d7a3a",
  },
  [Block.COBBLE]: {
    id: Block.COBBLE,
    name: "Cobble",
    solid: true,
    transparent: false,
    tiles: [8, 8, 8],
    color: "#6a6a6e",
  },
  [Block.PLANKS]: {
    id: Block.PLANKS,
    name: "Planks",
    solid: true,
    transparent: false,
    tiles: [9, 9, 9],
    color: "#b8955a",
  },
  [Block.BEDROCK]: {
    id: Block.BEDROCK,
    name: "Bedrock",
    solid: true,
    transparent: false,
    tiles: [10, 10, 10],
    color: "#2a2a2e",
  },
  [Block.SNOW]: {
    id: Block.SNOW,
    name: "Snow",
    solid: true,
    transparent: false,
    tiles: [11, 11, 11],
    color: "#e8eef5",
  },
  [Block.ICE]: {
    id: Block.ICE,
    name: "Ice",
    solid: true,
    transparent: true,
    tiles: [12, 12, 12],
    color: "#8ec8e8",
  },
  [Block.WATER]: {
    id: Block.WATER,
    name: "Water",
    solid: false,
    transparent: true,
    tiles: [13, 13, 13],
    color: "#3a7ec8",
  },
  [Block.WATER7]: {
    id: Block.WATER7,
    name: "Water",
    solid: false,
    transparent: true,
    tiles: [13, 13, 13],
    color: "#3a7ec8",
  },
  [Block.WATER6]: {
    id: Block.WATER6,
    name: "Water",
    solid: false,
    transparent: true,
    tiles: [13, 13, 13],
    color: "#3a7ec8",
  },
  [Block.WATER5]: {
    id: Block.WATER5,
    name: "Water",
    solid: false,
    transparent: true,
    tiles: [13, 13, 13],
    color: "#3a7ec8",
  },
  [Block.WATER4]: {
    id: Block.WATER4,
    name: "Water",
    solid: false,
    transparent: true,
    tiles: [13, 13, 13],
    color: "#3a7ec8",
  },
  [Block.WATER3]: {
    id: Block.WATER3,
    name: "Water",
    solid: false,
    transparent: true,
    tiles: [13, 13, 13],
    color: "#3a7ec8",
  },
  [Block.WATER2]: {
    id: Block.WATER2,
    name: "Water",
    solid: false,
    transparent: true,
    tiles: [13, 13, 13],
    color: "#3a7ec8",
  },
  [Block.WATER1]: {
    id: Block.WATER1,
    name: "Water",
    solid: false,
    transparent: true,
    tiles: [13, 13, 13],
    color: "#3a7ec8",
  },
  [Block.CACTUS]: {
    id: Block.CACTUS,
    name: "Cactus",
    solid: true,
    transparent: false,
    tiles: [14, 14, 14],
    color: "#3d8f4a",
  },
  [Block.SNOW_GRASS]: {
    id: Block.SNOW_GRASS,
    name: "Snowy Grass",
    solid: true,
    transparent: false,
    tiles: [11, 2, 15],
    color: "#c8d4c8",
  },
  // Plants — atlas tiles 16+
  [Block.SHORT_GRASS]: plant(Block.SHORT_GRASS, "Short Grass", 16, "#5aad48"),
  [Block.FERN]: plant(Block.FERN, "Fern", 17, "#3d8f4a"),
  [Block.DEAD_BUSH]: plant(Block.DEAD_BUSH, "Dead Bush", 18, "#8a6a3a"),
  [Block.POPPY]: plant(Block.POPPY, "Poppy", 19, "#d43c3c"),
  [Block.DANDELION]: plant(Block.DANDELION, "Dandelion", 20, "#f0d030"),
  [Block.CORNFLOWER]: plant(Block.CORNFLOWER, "Cornflower", 21, "#4a78d4"),
  [Block.ALLIUM]: plant(Block.ALLIUM, "Allium", 22, "#c060d0"),
  [Block.AZURE_BLUET]: plant(Block.AZURE_BLUET, "Azure Bluet", 23, "#e8eef8"),
  [Block.OXEYE_DAISY]: plant(Block.OXEYE_DAISY, "Oxeye Daisy", 24, "#f4f0e8"),
  [Block.TULIP_RED]: plant(Block.TULIP_RED, "Red Tulip", 25, "#e03040"),
  [Block.TULIP_ORANGE]: plant(Block.TULIP_ORANGE, "Orange Tulip", 26, "#e88830"),
  [Block.TULIP_PINK]: plant(Block.TULIP_PINK, "Pink Tulip", 27, "#e888b0"),
  [Block.TULIP_WHITE]: plant(Block.TULIP_WHITE, "White Tulip", 28, "#f2f0ea"),
  [Block.BLUEBELL]: plant(Block.BLUEBELL, "Bluebell", 29, "#6080e0"),
  [Block.LAVENDER]: plant(Block.LAVENDER, "Lavender", 30, "#a070c8"),
  [Block.SUNFLOWER]: plant(Block.SUNFLOWER, "Sunflower", 31, "#f0c020"),
  [Block.ROSE]: plant(Block.ROSE, "Rose", 32, "#c02840"),
  [Block.MUSHROOM_RED]: plant(Block.MUSHROOM_RED, "Red Mushroom", 33, "#c84040"),
  [Block.MUSHROOM_BROWN]: plant(
    Block.MUSHROOM_BROWN,
    "Brown Mushroom",
    34,
    "#8a6a48",
  ),
  [Block.CATTAIL]: plant(Block.CATTAIL, "Cattail", 35, "#6a8a48"),
  [Block.FIREWEED]: plant(Block.FIREWEED, "Fireweed", 36, "#d05090"),
  [Block.TORCH]: plant(Block.TORCH, "Torch", 37, "#f0a020"),
  [Block.COAL_ORE]: {
    id: Block.COAL_ORE,
    name: "Coal Ore",
    solid: true,
    transparent: false,
    tiles: [38, 38, 38],
    color: "#3a3a3e",
  },
  [Block.IRON_ORE]: {
    id: Block.IRON_ORE,
    name: "Iron Ore",
    solid: true,
    transparent: false,
    tiles: [39, 39, 39],
    color: "#c4a078",
  },
  [Block.FURNACE]: {
    id: Block.FURNACE,
    name: "Furnace",
    solid: true,
    transparent: false,
    tiles: [40, 40, 42],
    color: "#6a6460",
  },
  [Block.FURNACE_LIT]: {
    id: Block.FURNACE_LIT,
    name: "Furnace",
    solid: true,
    transparent: false,
    tiles: [40, 40, 43],
    color: "#c87830",
  },
};

/** Hotbar / creative placeables (includes a selection of flora) */
export const PLACEABLE: BlockId[] = [
  Block.GRASS,
  Block.DIRT,
  Block.STONE,
  Block.SAND,
  Block.WOOD,
  Block.LEAVES,
  Block.COBBLE,
  Block.PLANKS,
  Block.SNOW,
  Block.ICE,
  Block.CACTUS,
  Block.SNOW_GRASS,
  Block.SHORT_GRASS,
  Block.FERN,
  Block.POPPY,
  Block.DANDELION,
  Block.CORNFLOWER,
  Block.ALLIUM,
  Block.OXEYE_DAISY,
  Block.TULIP_RED,
  Block.TULIP_PINK,
  Block.LAVENDER,
  Block.SUNFLOWER,
  Block.ROSE,
  Block.MUSHROOM_RED,
  Block.MUSHROOM_BROWN,
  Block.CATTAIL,
  Block.TORCH,
  Block.COAL_ORE,
  Block.IRON_ORE,
  Block.FURNACE,
];

export function isSolid(id: number): boolean {
  const def = BLOCKS[id];
  return def ? def.solid : false;
}

export function isTransparent(id: number): boolean {
  const def = BLOCKS[id];
  return def ? def.transparent : true;
}

export function isWater(id: number): boolean {
  return id === Block.WATER || (id >= Block.WATER7 && id <= Block.WATER1);
}

/** 8 = source, 1–7 = flowing, 0 = not water */
export function waterLevel(id: number): number {
  if (id === Block.WATER) return 8;
  if (id >= Block.WATER7 && id <= Block.WATER1) return Block.WATER1 - id + 1;
  return 0;
}

/** Level 8 → source, 1–7 → flowing, else air */
export function waterIdForLevel(level: number): number {
  if (level >= 8) return Block.WATER;
  if (level <= 0) return Block.AIR;
  return Block.WATER1 - level + 1;
}

export function isSourceWater(id: number): boolean {
  return id === Block.WATER;
}

export function isPlant(id: number): boolean {
  const def = BLOCKS[id];
  return def?.shape === "cross";
}

export function isCrossBlock(id: number): boolean {
  return isPlant(id);
}

export function isFurnace(id: number): boolean {
  return id === Block.FURNACE || id === Block.FURNACE_LIT;
}

/** How much light this block emits (0–15). */
export function lightEmission(id: number): number {
  if (id === Block.TORCH) return 14;
  if (id === Block.FURNACE_LIT) return 13;
  return 0;
}

/** Fully stops light (solid cubes). Leaves / water / plants do not. */
export function blocksLight(id: number): boolean {
  if (id === Block.AIR || isWater(id) || isPlant(id)) return false;
  if (id === Block.LEAVES || id === Block.ICE) return false;
  return isSolid(id);
}

/** Extra light lost when passing through this cell. */
export function lightLoss(id: number): number {
  if (id === Block.LEAVES) return 1;
  if (isWater(id) || id === Block.ICE) return 2;
  return 0;
}

/** Tight selection box for cross plants (local 0–1). Corners of the cell are empty. */
export const PLANT_HITBOX = {
  minX: 0.3,
  maxX: 0.7,
  minY: 0,
  maxY: 0.88,
  minZ: 0.3,
  maxZ: 0.7,
} as const;

/** Blocks the player can mine / target with the crosshair (solids + plants) */
export function isMineable(id: number): boolean {
  if (id === 0) return false; // air
  if (isWater(id)) return false;
  if (id === Block.BEDROCK) return true; // targetable but unbreakable via mineTime
  if (isPlant(id)) return true;
  return isSolid(id);
}
