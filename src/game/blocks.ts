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
  CHEST: 48,
  BED: 49,
  /** Wall torches — attached to the neighbor in that direction */
  TORCH_NX: 50,
  TORCH_PX: 51,
  TORCH_NZ: 52,
  TORCH_PZ: 53,
  /** Inventory / recipe item — never stored in the world */
  DOOR: 54,
  /** Inventory item — world uses LADDER_NX…PZ */
  LADDER: 71,
  LADDER_NX: 72,
  LADDER_PX: 73,
  LADDER_NZ: 74,
  LADDER_PZ: 75,
  /** Inventory — world uses PLANKS_STAIR_NX…PZ */
  PLANKS_STAIR: 76,
  PLANKS_STAIR_NX: 77,
  PLANKS_STAIR_PX: 78,
  PLANKS_STAIR_NZ: 79,
  PLANKS_STAIR_PZ: 80,
  PLANKS_SLAB: 81,
  COBBLE_STAIR: 82,
  COBBLE_STAIR_NX: 83,
  COBBLE_STAIR_PX: 84,
  COBBLE_STAIR_NZ: 85,
  COBBLE_STAIR_PZ: 86,
  COBBLE_SLAB: 87,
  BIRCH_WOOD: 88,
  BIRCH_LEAVES: 89,
  SPRUCE_WOOD: 90,
  SPRUCE_LEAVES: 91,
  PUMPKIN: 92,
  LILY_PAD: 93,
  VINE: 94,
  GRAVEL: 95,
  CLAY: 96,
  ARCANE: 97,
  PORTAL: 98,
} as const;

export type BlockId = (typeof Block)[keyof typeof Block];

export type BlockShape = "cube" | "cross" | "slab" | "stair";

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

/** Atlas is 8 columns × 9 rows of 16px tiles */
export const TILE_SIZE = 16;
export const ATLAS_COLS = 8;
export const ATLAS_ROWS = 9;
/** Column count — tile index is `col + row * ATLAS_TILES` */
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
  [Block.TORCH_NX]: plant(Block.TORCH_NX, "Torch", 37, "#f0a020"),
  [Block.TORCH_PX]: plant(Block.TORCH_PX, "Torch", 37, "#f0a020"),
  [Block.TORCH_NZ]: plant(Block.TORCH_NZ, "Torch", 37, "#f0a020"),
  [Block.TORCH_PZ]: plant(Block.TORCH_PZ, "Torch", 37, "#f0a020"),
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
  [Block.CHEST]: {
    id: Block.CHEST,
    name: "Chest",
    solid: true,
    transparent: false,
    tiles: [44, 46, 45],
    color: "#b07a32",
  },
  [Block.BED]: {
    id: Block.BED,
    name: "Bed",
    solid: true,
    transparent: false,
    tiles: [47, 47, 48],
    color: "#b04048",
  },
  [Block.DOOR]: {
    id: Block.DOOR,
    name: "Door",
    solid: false,
    transparent: true,
    tiles: [49, 49, 49],
    color: "#8a6238",
  },
  [Block.LADDER]: {
    id: Block.LADDER,
    name: "Ladder",
    solid: false,
    transparent: true,
    tiles: [50, 50, 50],
    color: "#7a5430",
  },
  [Block.LADDER_NX]: {
    id: Block.LADDER_NX,
    name: "Ladder",
    solid: false,
    transparent: true,
    tiles: [50, 50, 50],
    color: "#7a5430",
  },
  [Block.LADDER_PX]: {
    id: Block.LADDER_PX,
    name: "Ladder",
    solid: false,
    transparent: true,
    tiles: [50, 50, 50],
    color: "#7a5430",
  },
  [Block.LADDER_NZ]: {
    id: Block.LADDER_NZ,
    name: "Ladder",
    solid: false,
    transparent: true,
    tiles: [50, 50, 50],
    color: "#7a5430",
  },
  [Block.LADDER_PZ]: {
    id: Block.LADDER_PZ,
    name: "Ladder",
    solid: false,
    transparent: true,
    tiles: [50, 50, 50],
    color: "#7a5430",
  },
  [Block.PLANKS_STAIR]: {
    id: Block.PLANKS_STAIR,
    name: "Oak Stairs",
    solid: true,
    transparent: true,
    tiles: [9, 9, 9],
    color: "#b8955a",
    shape: "stair",
  },
  [Block.PLANKS_SLAB]: {
    id: Block.PLANKS_SLAB,
    name: "Oak Slab",
    solid: true,
    transparent: true,
    tiles: [9, 9, 9],
    color: "#b8955a",
    shape: "slab",
  },
  [Block.COBBLE_STAIR]: {
    id: Block.COBBLE_STAIR,
    name: "Cobble Stairs",
    solid: true,
    transparent: true,
    tiles: [8, 8, 8],
    color: "#6a6a6e",
    shape: "stair",
  },
  [Block.COBBLE_SLAB]: {
    id: Block.COBBLE_SLAB,
    name: "Cobble Slab",
    solid: true,
    transparent: true,
    tiles: [8, 8, 8],
    color: "#6a6a6e",
    shape: "slab",
  },
  [Block.BIRCH_WOOD]: {
    id: Block.BIRCH_WOOD,
    name: "Birch Log",
    solid: true,
    transparent: false,
    tiles: [52, 52, 53],
    color: "#d8d0c0",
  },
  [Block.BIRCH_LEAVES]: {
    id: Block.BIRCH_LEAVES,
    name: "Birch Leaves",
    solid: true,
    transparent: true,
    tiles: [54, 54, 54],
    color: "#8fbe4a",
  },
  [Block.SPRUCE_WOOD]: {
    id: Block.SPRUCE_WOOD,
    name: "Spruce Log",
    solid: true,
    transparent: false,
    tiles: [55, 55, 56],
    color: "#3d2a1c",
  },
  [Block.SPRUCE_LEAVES]: {
    id: Block.SPRUCE_LEAVES,
    name: "Spruce Leaves",
    solid: true,
    transparent: true,
    tiles: [57, 57, 57],
    color: "#2a5a3a",
  },
  [Block.PUMPKIN]: {
    id: Block.PUMPKIN,
    name: "Pumpkin",
    solid: true,
    transparent: false,
    tiles: [58, 58, 59],
    color: "#d07820",
  },
  [Block.LILY_PAD]: plant(Block.LILY_PAD, "Lily Pad", 60, "#3d8a3a"),
  [Block.VINE]: plant(Block.VINE, "Vine", 61, "#3a7a38"),
  [Block.GRAVEL]: {
    id: Block.GRAVEL,
    name: "Gravel",
    solid: true,
    transparent: false,
    tiles: [62, 62, 62],
    color: "#8a8680",
  },
  [Block.CLAY]: {
    id: Block.CLAY,
    name: "Clay",
    solid: true,
    transparent: false,
    tiles: [63, 63, 63],
    color: "#a09088",
  },
  [Block.ARCANE]: {
    id: Block.ARCANE,
    name: "Voidstone",
    solid: true,
    transparent: false,
    tiles: [64, 64, 64],
    color: "#2a1038",
  },
  [Block.PORTAL]: {
    id: Block.PORTAL,
    name: "Rift",
    solid: false,
    transparent: true,
    tiles: [65, 65, 65],
    color: "#7a28c8",
  },
};

/** Hotbar / creative placeables (includes a selection of flora) */
export const PLACEABLE: BlockId[] = [
  Block.GRASS,
  Block.DIRT,
  Block.STONE,
  Block.SAND,
  Block.WOOD,
  Block.BIRCH_WOOD,
  Block.SPRUCE_WOOD,
  Block.LEAVES,
  Block.BIRCH_LEAVES,
  Block.SPRUCE_LEAVES,
  Block.PUMPKIN,
  Block.GRAVEL,
  Block.CLAY,
  Block.ARCANE,
  Block.PORTAL,
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
  Block.CHEST,
  Block.BED,
  Block.DOOR,
  Block.LADDER,
  Block.PLANKS_STAIR,
  Block.PLANKS_SLAB,
  Block.COBBLE_STAIR,
  Block.COBBLE_SLAB,
];

/** Packed door cells in the world: 55–70 (facing + upper + open). */
export const DOOR_LO = 55;
export const DOOR_HI = 70;

/** facing: 0=-X 1=+X 2=-Z 3=+Z */
export function doorId(facing: number, upper: boolean, open: boolean): number {
  return DOOR_LO + (facing & 3) + (upper ? 4 : 0) + (open ? 8 : 0);
}

export function isDoor(id: number): boolean {
  return (id >= DOOR_LO && id <= DOOR_HI) || id === Block.DOOR;
}

export function isDoorCell(id: number): boolean {
  return id >= DOOR_LO && id <= DOOR_HI;
}

export function doorFacing(id: number): number {
  return (id - DOOR_LO) & 3;
}

export function doorIsUpper(id: number): boolean {
  return ((id - DOOR_LO) & 4) !== 0;
}

export function doorIsOpen(id: number): boolean {
  return ((id - DOOR_LO) & 8) !== 0;
}

export function doorToggle(id: number): number {
  return isDoorCell(id) ? id ^ 8 : id;
}

export function doorMateId(id: number): number {
  return isDoorCell(id) ? id ^ 4 : id;
}

/** Closed door's slab face, or the swung face when open. */
export function doorPlane(id: number): 0 | 1 | 2 | 3 {
  const f = doorFacing(id);
  if (!doorIsOpen(id)) return f as 0 | 1 | 2 | 3;
  return ([2, 3, 1, 0] as const)[f]!;
}

export function doorFacingFromLook(lx: number, lz: number): number {
  if (Math.abs(lx) >= Math.abs(lz)) return lx >= 0 ? 1 : 0;
  return lz >= 0 ? 3 : 2;
}

export function isLadder(id: number): boolean {
  return (
    id === Block.LADDER ||
    id === Block.LADDER_NX ||
    id === Block.LADDER_PX ||
    id === Block.LADDER_NZ ||
    id === Block.LADDER_PZ
  );
}

export function isLadderCell(id: number): boolean {
  return (
    id === Block.LADDER_NX ||
    id === Block.LADDER_PX ||
    id === Block.LADDER_NZ ||
    id === Block.LADDER_PZ
  );
}

export function ladderAttachDir(id: number): [number, number, number] {
  switch (id) {
    case Block.LADDER_NX:
      return [-1, 0, 0];
    case Block.LADDER_PX:
      return [1, 0, 0];
    case Block.LADDER_NZ:
      return [0, 0, -1];
    case Block.LADDER_PZ:
      return [0, 0, 1];
    default:
      return [0, 0, 0];
  }
}

export function ladderIdFromHitFace(
  nx: number,
  ny: number,
  nz: number,
): number | null {
  if (ny !== 0) return null;
  if (nx === 1) return Block.LADDER_NX;
  if (nx === -1) return Block.LADDER_PX;
  if (nz === 1) return Block.LADDER_NZ;
  if (nz === -1) return Block.LADDER_PZ;
  return null;
}

export function canSupportLadder(id: number): boolean {
  if (isDoor(id) || isLadder(id) || isTorch(id)) return false;
  if (!isSolid(id) || isPlant(id) || isWater(id)) return false;
  if (isLeaves(id) || id === Block.ICE || id === Block.CACTUS) return false;
  return true;
}

function registerDoorCells(): void {
  for (let i = DOOR_LO; i <= DOOR_HI; i++) {
    BLOCKS[i] = {
      id: i as BlockId,
      name: "Door",
      solid: !doorIsOpen(i),
      transparent: true,
      tiles: [doorIsUpper(i) ? 51 : 49, 49, doorIsUpper(i) ? 51 : 49],
      color: "#8a6238",
    };
  }
}
registerDoorCells();

function registerStairCells(): void {
  const specs: { lo: number; name: string; tiles: [number, number, number]; color: string }[] = [
    { lo: Block.PLANKS_STAIR_NX, name: "Oak Stairs", tiles: [9, 9, 9], color: "#b8955a" },
    { lo: Block.COBBLE_STAIR_NX, name: "Cobble Stairs", tiles: [8, 8, 8], color: "#6a6a6e" },
  ];
  for (const s of specs) {
    for (let i = 0; i < 4; i++) {
      const id = s.lo + i;
      BLOCKS[id] = {
        id: id as BlockId,
        name: s.name,
        solid: true,
        transparent: true,
        tiles: s.tiles,
        color: s.color,
        shape: "stair",
      };
    }
  }
}
registerStairCells();

export function isSlab(id: number): boolean {
  return id === Block.PLANKS_SLAB || id === Block.COBBLE_SLAB;
}

export function isStairItem(id: number): boolean {
  return id === Block.PLANKS_STAIR || id === Block.COBBLE_STAIR;
}

export function isStairCell(id: number): boolean {
  return (
    (id >= Block.PLANKS_STAIR_NX && id <= Block.PLANKS_STAIR_PZ) ||
    (id >= Block.COBBLE_STAIR_NX && id <= Block.COBBLE_STAIR_PZ)
  );
}

export function isStair(id: number): boolean {
  return isStairItem(id) || isStairCell(id);
}

export function stairFacing(id: number): number {
  if (id >= Block.PLANKS_STAIR_NX && id <= Block.PLANKS_STAIR_PZ) {
    return id - Block.PLANKS_STAIR_NX;
  }
  if (id >= Block.COBBLE_STAIR_NX && id <= Block.COBBLE_STAIR_PZ) {
    return id - Block.COBBLE_STAIR_NX;
  }
  return 3;
}

export function stairIdFromItem(item: number, facing: number): number {
  const f = facing & 3;
  if (item === Block.PLANKS_STAIR) return Block.PLANKS_STAIR_NX + f;
  if (item === Block.COBBLE_STAIR) return Block.COBBLE_STAIR_NX + f;
  return item;
}

export function stairItemFromCell(id: number): number {
  if (id >= Block.PLANKS_STAIR_NX && id <= Block.PLANKS_STAIR_PZ) {
    return Block.PLANKS_STAIR;
  }
  if (id >= Block.COBBLE_STAIR_NX && id <= Block.COBBLE_STAIR_PZ) {
    return Block.COBBLE_STAIR;
  }
  return id;
}

export function shapeMaterial(id: number): number {
  if (
    id === Block.PLANKS_SLAB ||
    id === Block.PLANKS_STAIR ||
    (id >= Block.PLANKS_STAIR_NX && id <= Block.PLANKS_STAIR_PZ)
  ) {
    return Block.PLANKS;
  }
  if (
    id === Block.COBBLE_SLAB ||
    id === Block.COBBLE_STAIR ||
    (id >= Block.COBBLE_STAIR_NX && id <= Block.COBBLE_STAIR_PZ)
  ) {
    return Block.COBBLE;
  }
  return id;
}

export type LocalBox = {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
};

/** Local 0–1 occupancy. `full` = whole cell; empty = no collision. */
export function collisionBoxes(id: number): LocalBox[] | "full" | null {
  if (isSlab(id)) {
    return [{ x0: 0, y0: 0, z0: 0, x1: 1, y1: 0.5, z1: 1 }];
  }
  if (isStairCell(id)) {
    const f = stairFacing(id);
    const boxes: LocalBox[] = [{ x0: 0, y0: 0, z0: 0, x1: 1, y1: 0.5, z1: 1 }];
    if (f === 0) boxes.push({ x0: 0, y0: 0.5, z0: 0, x1: 0.5, y1: 1, z1: 1 });
    else if (f === 1) boxes.push({ x0: 0.5, y0: 0.5, z0: 0, x1: 1, y1: 1, z1: 1 });
    else if (f === 2) boxes.push({ x0: 0, y0: 0.5, z0: 0, x1: 1, y1: 1, z1: 0.5 });
    else boxes.push({ x0: 0, y0: 0.5, z0: 0.5, x1: 1, y1: 1, z1: 1 });
    return boxes;
  }
  if (isPlant(id) || isLadder(id) || isTorch(id) || isWater(id)) return null;
  if (!isSolid(id)) return null;
  return "full";
}

export function cellCollidesAABB(
  id: number,
  bx: number,
  by: number,
  bz: number,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): boolean {
  const boxes = collisionBoxes(id);
  if (!boxes) return false;
  if (boxes === "full") return true;
  for (const b of boxes) {
    if (
      maxX > bx + b.x0 &&
      minX < bx + b.x1 &&
      maxY > by + b.y0 &&
      minY < by + b.y1 &&
      maxZ > bz + b.z0 &&
      minZ < bz + b.z1
    ) {
      return true;
    }
  }
  return false;
}

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

export function isLog(id: number): boolean {
  return id === Block.WOOD || id === Block.BIRCH_WOOD || id === Block.SPRUCE_WOOD;
}

export function isLeaves(id: number): boolean {
  return (
    id === Block.LEAVES ||
    id === Block.BIRCH_LEAVES ||
    id === Block.SPRUCE_LEAVES
  );
}

export function isFurnace(id: number): boolean {
  return id === Block.FURNACE || id === Block.FURNACE_LIT;
}

export function isChest(id: number): boolean {
  return id === Block.CHEST;
}

export function isPortal(id: number): boolean {
  return id === Block.PORTAL;
}

export function isBed(id: number): boolean {
  return id === Block.BED;
}

/** How much light this block emits (0–15). */
export function lightEmission(id: number): number {
  if (isTorch(id)) return 14;
  if (id === Block.FURNACE_LIT) return 13;
  if (id === Block.PORTAL) return 12;
  if (id === Block.ARCANE) return 8;
  return 0;
}

/** Fully stops light (solid cubes). Leaves / water / plants do not. */
export function blocksLight(id: number): boolean {
  if (id === Block.AIR || isWater(id) || isPlant(id) || isPortal(id)) return false;
  if (isLeaves(id) || id === Block.ICE) return false;
  if (isDoor(id) || isLadder(id)) return false;
  return isSolid(id);
}

/** Extra light lost when passing through this cell. */
export function lightLoss(id: number): number {
  if (id === Block.PORTAL) return 1;
  if (isLeaves(id)) return 1;
  if (isWater(id) || id === Block.ICE) return 2;
  return 0;
}

export function isTorch(id: number): boolean {
  return (
    id === Block.TORCH ||
    id === Block.TORCH_NX ||
    id === Block.TORCH_PX ||
    id === Block.TORCH_NZ ||
    id === Block.TORCH_PZ
  );
}

/** Direction from the torch cell to the block it hangs on. */
export function torchAttachDir(id: number): [number, number, number] {
  switch (id) {
    case Block.TORCH_NX:
      return [-1, 0, 0];
    case Block.TORCH_PX:
      return [1, 0, 0];
    case Block.TORCH_NZ:
      return [0, 0, -1];
    case Block.TORCH_PZ:
      return [0, 0, 1];
    default:
      return [0, -1, 0];
  }
}

export function canSupportTorch(id: number): boolean {
  if (!isSolid(id) || isPlant(id) || isWater(id) || isTorch(id)) return false;
  if (isDoor(id) || isLadder(id)) return false;
  if (isLeaves(id) || id === Block.ICE || id === Block.CACTUS) return false;
  return true;
}

/**
 * Hit face normal of the support block → torch id to place in the adjacent cell.
 * Ceiling (ny = -1) is rejected.
 */
export function torchIdFromHitFace(
  nx: number,
  ny: number,
  nz: number,
): number | null {
  if (ny === 1) return Block.TORCH;
  if (ny === -1) return null;
  if (nx === 1) return Block.TORCH_NX;
  if (nx === -1) return Block.TORCH_PX;
  if (nz === 1) return Block.TORCH_NZ;
  if (nz === -1) return Block.TORCH_PZ;
  return Block.TORCH;
}

export type PlantBox = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
};

/** Tight selection box for cross plants (local 0–1). Corners of the cell are empty. */
export const PLANT_HITBOX: PlantBox = {
  minX: 0.3,
  maxX: 0.7,
  minY: 0,
  maxY: 0.88,
  minZ: 0.3,
  maxZ: 0.7,
} as const;

export function plantHitbox(id: number): PlantBox {
  switch (id) {
    case Block.TORCH_NX:
      return { minX: 0, maxX: 0.44, minY: 0.1, maxY: 0.94, minZ: 0.28, maxZ: 0.72 };
    case Block.TORCH_PX:
      return { minX: 0.56, maxX: 1, minY: 0.1, maxY: 0.94, minZ: 0.28, maxZ: 0.72 };
    case Block.TORCH_NZ:
      return { minX: 0.28, maxX: 0.72, minY: 0.1, maxY: 0.94, minZ: 0, maxZ: 0.44 };
    case Block.TORCH_PZ:
      return { minX: 0.28, maxX: 0.72, minY: 0.1, maxY: 0.94, minZ: 0.56, maxZ: 1 };
    case Block.TORCH:
      return { minX: 0.32, maxX: 0.68, minY: 0, maxY: 0.9, minZ: 0.32, maxZ: 0.68 };
    default:
      return PLANT_HITBOX;
  }
}

/** Blocks the player can mine / target with the crosshair (solids + plants) */
export function isMineable(id: number): boolean {
  if (id === 0) return false; // air
  if (isWater(id)) return false;
  if (id === Block.BEDROCK) return true; // targetable but unbreakable via mineTime
  if (isPlant(id) || isDoor(id) || isLadder(id) || isPortal(id)) return true;
  return isSolid(id);
}
