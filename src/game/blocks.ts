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
} as const;

export type BlockId = (typeof Block)[keyof typeof Block];

export type BlockDef = {
  id: BlockId;
  name: string;
  solid: boolean;
  transparent: boolean;
  /** Atlas tile indices: top, bottom, side */
  tiles: [number, number, number];
  /** Hotbar color swatch */
  color: string;
};

/** Texture atlas is a 4×4 grid of 16px tiles */
export const TILE_SIZE = 16;
export const ATLAS_TILES = 4;

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
    tiles: [11, 2, 15], // snow top, dirt bottom, snowy side
    color: "#c8d4c8",
  },
};

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
];

export function isSolid(id: number): boolean {
  const def = BLOCKS[id];
  return def ? def.solid : false;
}

export function isTransparent(id: number): boolean {
  const def = BLOCKS[id];
  return def ? def.transparent : true;
}
