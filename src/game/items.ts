import { Block, BLOCKS, isPlant, isDoor, isLadder, isStair, isSlab, shapeMaterial, type BlockId } from "./blocks";

/** Item IDs: 0–199 reserved for blocks; 200+ materials & tools */
export const ITEM_ID_MIN = 200;

export const Item = {
  STICK: 200,
  WOOD_PICK: 201,
  WOOD_AXE: 202,
  WOOD_SHOVEL: 203,
  WOOD_SWORD: 204,
  STONE_PICK: 205,
  STONE_AXE: 206,
  STONE_SHOVEL: 207,
  STONE_SWORD: 208,
  COAL: 209,
  IRON_INGOT: 210,
  IRON_PICK: 211,
  IRON_AXE: 212,
  IRON_SHOVEL: 213,
  IRON_SWORD: 214,
  RAW_PORK: 215,
  COOKED_PORK: 216,
  RAW_BEEF: 217,
  COOKED_BEEF: 218,
  RAW_MUTTON: 219,
  COOKED_MUTTON: 220,
  RAW_CHICKEN: 221,
  COOKED_CHICKEN: 222,
  RAW_RABBIT: 223,
  COOKED_RABBIT: 224,
  ROTTEN_FLESH: 225,
  LEATHER: 226,
  FEATHER: 227,
  WOOL: 228,
  STRING: 229,
  BONE: 230,
  BREAD: 231,
  BOW: 232,
  ARROW: 233,
  LEATHER_HELM: 234,
  LEATHER_CHEST: 235,
  LEATHER_LEGS: 236,
  LEATHER_BOOTS: 237,
  BONE_MEAL: 238,
  IRON_HELM: 239,
  IRON_CHEST: 240,
  IRON_LEGS: 241,
  IRON_BOOTS: 242,
  BUCKET: 243,
  WATER_BUCKET: 244,
} as const;

export type ItemId = number;

export type ToolKind = "pickaxe" | "axe" | "shovel" | "sword" | "bow" | "none";
export type ToolTier = "none" | "wood" | "stone" | "iron";
export type ArmorSlot = "head" | "chest" | "legs" | "feet";

export type ItemDef = {
  id: ItemId;
  name: string;
  maxStack: number;
  /** If set, can be placed as this block */
  placeBlock?: BlockId;
  tool?: ToolKind;
  tier?: ToolTier;
  maxDurability?: number;
  /** Attack damage bonus (caterpillars / future mobs) */
  attack?: number;
  /** Restores health now; hunger value stored for when drain is on */
  food?: { heal: number; hunger: number };
  armor?: { slot: ArmorSlot; points: number };
  /** Hotbar / UI color when no sprite */
  color: string;
};

export type ItemStack = {
  id: ItemId;
  count: number;
  /** Remaining durability for tools */
  durability?: number;
};

const TOOLS: ItemDef[] = [
  {
    id: Item.STICK,
    name: "Stick",
    maxStack: 64,
    color: "#a07848",
  },
  {
    id: Item.WOOD_PICK,
    name: "Wooden Pickaxe",
    maxStack: 1,
    tool: "pickaxe",
    tier: "wood",
    maxDurability: 60,
    attack: 2,
    color: "#8b6a3a",
  },
  {
    id: Item.WOOD_AXE,
    name: "Wooden Axe",
    maxStack: 1,
    tool: "axe",
    tier: "wood",
    maxDurability: 60,
    attack: 3,
    color: "#8b6a3a",
  },
  {
    id: Item.WOOD_SHOVEL,
    name: "Wooden Shovel",
    maxStack: 1,
    tool: "shovel",
    tier: "wood",
    maxDurability: 60,
    attack: 2,
    color: "#8b6a3a",
  },
  {
    id: Item.WOOD_SWORD,
    name: "Wooden Sword",
    maxStack: 1,
    tool: "sword",
    tier: "wood",
    maxDurability: 60,
    attack: 4,
    color: "#8b6a3a",
  },
  {
    id: Item.STONE_PICK,
    name: "Stone Pickaxe",
    maxStack: 1,
    tool: "pickaxe",
    tier: "stone",
    maxDurability: 140,
    attack: 3,
    color: "#7a7a80",
  },
  {
    id: Item.STONE_AXE,
    name: "Stone Axe",
    maxStack: 1,
    tool: "axe",
    tier: "stone",
    maxDurability: 140,
    attack: 4,
    color: "#7a7a80",
  },
  {
    id: Item.STONE_SHOVEL,
    name: "Stone Shovel",
    maxStack: 1,
    tool: "shovel",
    tier: "stone",
    maxDurability: 140,
    attack: 3,
    color: "#7a7a80",
  },
  {
    id: Item.STONE_SWORD,
    name: "Stone Sword",
    maxStack: 1,
    tool: "sword",
    tier: "stone",
    maxDurability: 140,
    attack: 5,
    color: "#7a7a80",
  },
  {
    id: Item.COAL,
    name: "Coal",
    maxStack: 64,
    color: "#2a2a2e",
  },
  {
    id: Item.IRON_INGOT,
    name: "Iron Ingot",
    maxStack: 64,
    color: "#d0d4dc",
  },
  {
    id: Item.IRON_PICK,
    name: "Iron Pickaxe",
    maxStack: 1,
    tool: "pickaxe",
    tier: "iron",
    maxDurability: 250,
    attack: 4,
    color: "#c8ccd4",
  },
  {
    id: Item.IRON_AXE,
    name: "Iron Axe",
    maxStack: 1,
    tool: "axe",
    tier: "iron",
    maxDurability: 250,
    attack: 5,
    color: "#c8ccd4",
  },
  {
    id: Item.IRON_SHOVEL,
    name: "Iron Shovel",
    maxStack: 1,
    tool: "shovel",
    tier: "iron",
    maxDurability: 250,
    attack: 4,
    color: "#c8ccd4",
  },
  {
    id: Item.IRON_SWORD,
    name: "Iron Sword",
    maxStack: 1,
    tool: "sword",
    tier: "iron",
    maxDurability: 250,
    attack: 7,
    color: "#c8ccd4",
  },
  {
    id: Item.BOW,
    name: "Bow",
    maxStack: 1,
    tool: "bow",
    maxDurability: 80,
    attack: 1,
    color: "#8a6238",
  },
  {
    id: Item.ARROW,
    name: "Arrow",
    maxStack: 64,
    color: "#c8b898",
  },
  {
    id: Item.LEATHER_HELM,
    name: "Leather Cap",
    maxStack: 1,
    maxDurability: 55,
    armor: { slot: "head", points: 1 },
    color: "#8a5a32",
  },
  {
    id: Item.LEATHER_CHEST,
    name: "Leather Tunic",
    maxStack: 1,
    maxDurability: 80,
    armor: { slot: "chest", points: 3 },
    color: "#8a5a32",
  },
  {
    id: Item.LEATHER_LEGS,
    name: "Leather Pants",
    maxStack: 1,
    maxDurability: 75,
    armor: { slot: "legs", points: 2 },
    color: "#8a5a32",
  },
  {
    id: Item.LEATHER_BOOTS,
    name: "Leather Boots",
    maxStack: 1,
    maxDurability: 65,
    armor: { slot: "feet", points: 1 },
    color: "#8a5a32",
  },
  {
    id: Item.IRON_HELM,
    name: "Iron Helmet",
    maxStack: 1,
    maxDurability: 140,
    armor: { slot: "head", points: 2 },
    color: "#c4c8d0",
  },
  {
    id: Item.IRON_CHEST,
    name: "Iron Chestplate",
    maxStack: 1,
    maxDurability: 200,
    armor: { slot: "chest", points: 6 },
    color: "#c4c8d0",
  },
  {
    id: Item.IRON_LEGS,
    name: "Iron Leggings",
    maxStack: 1,
    maxDurability: 185,
    armor: { slot: "legs", points: 5 },
    color: "#c4c8d0",
  },
  {
    id: Item.IRON_BOOTS,
    name: "Iron Boots",
    maxStack: 1,
    maxDurability: 160,
    armor: { slot: "feet", points: 2 },
    color: "#c4c8d0",
  },
  {
    id: Item.BONE_MEAL,
    name: "Bone Meal",
    maxStack: 64,
    color: "#f4f0e4",
  },
  {
    id: Item.BUCKET,
    name: "Bucket",
    maxStack: 16,
    color: "#8a9098",
  },
  {
    id: Item.WATER_BUCKET,
    name: "Water Bucket",
    maxStack: 1,
    color: "#3a7ec8",
  },
];

const FOODS: ItemDef[] = [
  { id: Item.RAW_PORK, name: "Raw Pork", maxStack: 64, food: { heal: 3, hunger: 3 }, color: "#e07080" },
  { id: Item.COOKED_PORK, name: "Cooked Pork", maxStack: 64, food: { heal: 8, hunger: 8 }, color: "#c07040" },
  { id: Item.RAW_BEEF, name: "Raw Beef", maxStack: 64, food: { heal: 3, hunger: 3 }, color: "#c04048" },
  { id: Item.COOKED_BEEF, name: "Steak", maxStack: 64, food: { heal: 8, hunger: 8 }, color: "#8a4a28" },
  { id: Item.RAW_MUTTON, name: "Raw Mutton", maxStack: 64, food: { heal: 3, hunger: 3 }, color: "#d06070" },
  { id: Item.COOKED_MUTTON, name: "Cooked Mutton", maxStack: 64, food: { heal: 8, hunger: 8 }, color: "#a05830" },
  { id: Item.RAW_CHICKEN, name: "Raw Chicken", maxStack: 64, food: { heal: 2, hunger: 2 }, color: "#f0d0b0" },
  { id: Item.COOKED_CHICKEN, name: "Cooked Chicken", maxStack: 64, food: { heal: 6, hunger: 6 }, color: "#d49848" },
  { id: Item.RAW_RABBIT, name: "Raw Rabbit", maxStack: 64, food: { heal: 3, hunger: 3 }, color: "#e8a090" },
  { id: Item.COOKED_RABBIT, name: "Cooked Rabbit", maxStack: 64, food: { heal: 6, hunger: 5 }, color: "#c08048" },
  { id: Item.ROTTEN_FLESH, name: "Rotten Flesh", maxStack: 64, food: { heal: 2, hunger: 4 }, color: "#6a8040" },
  { id: Item.LEATHER, name: "Leather", maxStack: 64, color: "#8a5a32" },
  { id: Item.FEATHER, name: "Feather", maxStack: 64, color: "#f4f0e4" },
  { id: Item.WOOL, name: "Wool", maxStack: 64, color: "#f0ece4" },
  { id: Item.STRING, name: "String", maxStack: 64, color: "#d8d0c4" },
  { id: Item.BONE, name: "Bone", maxStack: 64, color: "#f0ead8" },
  { id: Item.BREAD, name: "Bread", maxStack: 64, food: { heal: 5, hunger: 6 }, color: "#d4a04a" },
];

/** All non-block items */
export const ITEM_DEFS: Record<number, ItemDef> = Object.fromEntries(
  [...TOOLS, ...FOODS].map((t) => [t.id, t]),
);

export function isBlockItem(id: ItemId): boolean {
  return id > 0 && id < ITEM_ID_MIN && !!BLOCKS[id];
}

export function isTool(id: ItemId): boolean {
  return !!ITEM_DEFS[id]?.tool && ITEM_DEFS[id]!.tool !== "none";
}

export function isFood(id: ItemId): boolean {
  return !!ITEM_DEFS[id]?.food;
}

export function isBow(id: ItemId | null | undefined): boolean {
  return !!id && ITEM_DEFS[id]?.tool === "bow";
}

export function isArrow(id: ItemId | null | undefined): boolean {
  return id === Item.ARROW;
}

export function isBoneMeal(id: ItemId | null | undefined): boolean {
  return id === Item.BONE_MEAL;
}

export function isEmptyBucket(id: ItemId | null | undefined): boolean {
  return id === Item.BUCKET;
}

export function isWaterBucket(id: ItemId | null | undefined): boolean {
  return id === Item.WATER_BUCKET;
}

export function armorInfo(
  id: ItemId | null | undefined,
): { slot: ArmorSlot; points: number; slotIndex: number } | null {
  if (!id) return null;
  const a = ITEM_DEFS[id]?.armor;
  if (!a) return null;
  const slotIndex = a.slot === "head" ? 0 : a.slot === "chest" ? 1 : a.slot === "legs" ? 2 : 3;
  return { slot: a.slot, points: a.points, slotIndex };
}

export function itemName(id: ItemId): string {
  if (ITEM_DEFS[id]) return ITEM_DEFS[id]!.name;
  return BLOCKS[id]?.name ?? "Unknown";
}

export function itemMaxStack(id: ItemId): number {
  if (ITEM_DEFS[id]) return ITEM_DEFS[id]!.maxStack;
  return 64;
}

export function itemColor(id: ItemId): string {
  if (ITEM_DEFS[id]) return ITEM_DEFS[id]!.color;
  return BLOCKS[id]?.color ?? "#888";
}

export function placeableBlock(id: ItemId): BlockId | null {
  if (isBlockItem(id)) return id as BlockId;
  return ITEM_DEFS[id]?.placeBlock ?? null;
}

export function getTool(id: ItemId | null | undefined): {
  kind: ToolKind;
  tier: ToolTier;
  attack: number;
} {
  if (!id) return { kind: "none", tier: "none", attack: 1 };
  const def = ITEM_DEFS[id];
  if (!def?.tool) return { kind: "none", tier: "none", attack: 1 };
  return {
    kind: def.tool,
    tier: def.tier ?? "none",
    attack: def.attack ?? 1,
  };
}

/** Base fist mine times (seconds) */
export function baseMineTime(blockId: number): number {
  if (isPlant(blockId)) return 0.05;
  if (isDoor(blockId) || isLadder(blockId)) return 0.4;
  if (isStair(blockId) || isSlab(blockId)) {
    return shapeMaterial(blockId) === Block.PLANKS ? 1.0 : 1.5;
  }
  switch (blockId) {
    case Block.BEDROCK:
      return Infinity;
    case Block.LEAVES:
    case Block.BIRCH_LEAVES:
    case Block.SPRUCE_LEAVES:
    case Block.JACARANDA_LEAVES:
    case Block.REDWOOD_LEAVES:
    case Block.JUNGLE_LEAVES:
    case Block.MUSHROOM_CAP_RED:
    case Block.MUSHROOM_CAP_CYAN:
      return 0.28;
    case Block.SNOW:
    case Block.SNOW_GRASS:
      return 0.35;
    case Block.DIRT:
    case Block.GRASS:
    case Block.SAND:
    case Block.GRAVEL:
    case Block.CLAY:
    case Block.MYCELIUM:
      return 0.55;
    case Block.CACTUS:
    case Block.ICE:
      return 0.55;
    case Block.WOOD:
    case Block.BIRCH_WOOD:
    case Block.SPRUCE_WOOD:
    case Block.REDWOOD_WOOD:
    case Block.JUNGLE_WOOD:
    case Block.MUSHROOM_STEM:
    case Block.PLANKS:
    case Block.PLANKS_STAIR:
    case Block.PLANKS_SLAB:
    case Block.CHEST:
    case Block.BED:
    case Block.PUMPKIN:
      return 1.0;
    case Block.COBBLE:
    case Block.COBBLE_STAIR:
    case Block.COBBLE_SLAB:
    case Block.STONE:
    case Block.COAL_ORE:
    case Block.FURNACE:
    case Block.FURNACE_LIT:
      return 2.2;
    case Block.IRON_ORE:
      return 2.8;
    case Block.ARCANE:
      return 8.5;
    case Block.PORTAL:
      return 0.35;
    case Block.WATER:
      return Infinity;
    default:
      return 0.75;
  }
}

function preferredTool(blockId: number): ToolKind {
  if (
    blockId === Block.STONE ||
    blockId === Block.COBBLE ||
    blockId === Block.ICE ||
    blockId === Block.BEDROCK ||
    blockId === Block.COAL_ORE ||
    blockId === Block.IRON_ORE ||
    blockId === Block.ARCANE ||
    blockId === Block.FURNACE ||
    blockId === Block.FURNACE_LIT ||
    ((isStair(blockId) || isSlab(blockId)) && shapeMaterial(blockId) === Block.COBBLE)
  ) {
    return "pickaxe";
  }
  if (
    blockId === Block.WOOD ||
    blockId === Block.BIRCH_WOOD ||
    blockId === Block.SPRUCE_WOOD ||
    blockId === Block.REDWOOD_WOOD ||
    blockId === Block.JUNGLE_WOOD ||
    blockId === Block.MUSHROOM_STEM ||
    blockId === Block.PLANKS ||
    blockId === Block.LEAVES ||
    blockId === Block.BIRCH_LEAVES ||
    blockId === Block.SPRUCE_LEAVES ||
    blockId === Block.JACARANDA_LEAVES ||
    blockId === Block.REDWOOD_LEAVES ||
    blockId === Block.JUNGLE_LEAVES ||
    blockId === Block.MUSHROOM_CAP_RED ||
    blockId === Block.MUSHROOM_CAP_CYAN ||
    blockId === Block.CHEST ||
    blockId === Block.BED ||
    isDoor(blockId) ||
    isLadder(blockId) ||
    ((isStair(blockId) || isSlab(blockId)) && shapeMaterial(blockId) === Block.PLANKS)
  ) {
    return "axe";
  }
  if (
    blockId === Block.DIRT ||
    blockId === Block.GRASS ||
    blockId === Block.SAND ||
    blockId === Block.GRAVEL ||
    blockId === Block.CLAY ||
    blockId === Block.MYCELIUM ||
    blockId === Block.SNOW ||
    blockId === Block.SNOW_GRASS
  ) {
    return "shovel";
  }
  return "none";
}

const TIER_MULT: Record<ToolTier, number> = {
  none: 1,
  wood: 2.2,
  stone: 4.0,
  iron: 6.4,
};

const TIER_RANK: Record<ToolTier, number> = {
  none: 0,
  wood: 1,
  stone: 2,
  iron: 3,
};

/** Minimum pick tier to drop this block (none = anyone). */
export function harvestTier(blockId: number): ToolTier {
  if (blockId === Block.IRON_ORE) return "stone";
  if (
    blockId === Block.COAL_ORE ||
    blockId === Block.STONE ||
    blockId === Block.COBBLE ||
    blockId === Block.FURNACE ||
    blockId === Block.FURNACE_LIT
  ) {
    return "wood";
  }
  return "none";
}

export function canHarvest(blockId: number, toolItemId?: ItemId | null): boolean {
  const need = harvestTier(blockId);
  if (need === "none") return true;
  const tool = getTool(toolItemId);
  if (tool.kind !== "pickaxe") return false;
  return TIER_RANK[tool.tier] >= TIER_RANK[need];
}

/**
 * Effective mine time with held tool.
 * Correct tool + tier speeds up; wrong tool on stone is very slow.
 */
export function mineTimeWithTool(blockId: number, toolItemId?: ItemId | null): number {
  const base = baseMineTime(blockId);
  if (!Number.isFinite(base)) return base;
  if (isPlant(blockId)) return base;

  const tool = getTool(toolItemId);
  const prefer = preferredTool(blockId);

  // Stone-likes without a pick are painfully slow
  if (
    (blockId === Block.STONE ||
      blockId === Block.COBBLE ||
      blockId === Block.COAL_ORE ||
      blockId === Block.IRON_ORE ||
      blockId === Block.FURNACE ||
      blockId === Block.FURNACE_LIT) &&
    tool.kind !== "pickaxe"
  ) {
    return base * 3.5;
  }
  // Weak pick on iron still mines, just slowly — no drop (see canHarvest)
  if (blockId === Block.IRON_ORE && TIER_RANK[tool.tier] < TIER_RANK.stone) {
    return base * 2.2;
  }

  if (tool.kind === "none" || prefer === "none") {
    return base;
  }
  if (tool.kind !== prefer) {
    return base * 1.15; // slight penalty
  }
  return base / TIER_MULT[tool.tier];
}

export type Recipe = {
  id: string;
  name: string;
  /** Ingredients as itemId → count */
  inputs: { id: ItemId; count: number }[];
  output: { id: ItemId; count: number };
  /** Optional shape hint for UI */
  hint?: string;
};

export const RECIPES: Recipe[] = [
  {
    id: "planks",
    name: "Oak Planks",
    inputs: [{ id: Block.WOOD, count: 1 }],
    output: { id: Block.PLANKS, count: 4 },
    hint: "Log → 4 planks",
  },
  {
    id: "planks_birch",
    name: "Birch Planks",
    inputs: [{ id: Block.BIRCH_WOOD, count: 1 }],
    output: { id: Block.PLANKS, count: 4 },
    hint: "Birch log → 4 planks",
  },
  {
    id: "planks_spruce",
    name: "Spruce Planks",
    inputs: [{ id: Block.SPRUCE_WOOD, count: 1 }],
    output: { id: Block.PLANKS, count: 4 },
    hint: "Spruce log → 4 planks",
  },
  {
    id: "planks_redwood",
    name: "Redwood Planks",
    inputs: [{ id: Block.REDWOOD_WOOD, count: 1 }],
    output: { id: Block.PLANKS, count: 4 },
    hint: "Redwood log → 4 planks",
  },
  {
    id: "planks_jungle",
    name: "Jungle Planks",
    inputs: [{ id: Block.JUNGLE_WOOD, count: 1 }],
    output: { id: Block.PLANKS, count: 4 },
    hint: "Jungle log → 4 planks",
  },
  {
    id: "planks_stairs",
    name: "Oak Stairs",
    inputs: [{ id: Block.PLANKS, count: 6 }],
    output: { id: Block.PLANKS_STAIR, count: 4 },
    hint: "Faces you when placed",
  },
  {
    id: "planks_slabs",
    name: "Oak Slabs",
    inputs: [{ id: Block.PLANKS, count: 3 }],
    output: { id: Block.PLANKS_SLAB, count: 6 },
    hint: "Half-block · stack for a full plank",
  },
  {
    id: "cobble_stairs",
    name: "Cobble Stairs",
    inputs: [{ id: Block.COBBLE, count: 6 }],
    output: { id: Block.COBBLE_STAIR, count: 4 },
    hint: "Stone steps",
  },
  {
    id: "cobble_slabs",
    name: "Cobble Slabs",
    inputs: [{ id: Block.COBBLE, count: 3 }],
    output: { id: Block.COBBLE_SLAB, count: 6 },
    hint: "Half cobble",
  },
  {
    id: "sticks",
    name: "Sticks",
    inputs: [{ id: Block.PLANKS, count: 2 }],
    output: { id: Item.STICK, count: 4 },
    hint: "2 planks → 4 sticks",
  },
  {
    id: "wood_pick",
    name: "Wooden Pickaxe",
    inputs: [
      { id: Block.PLANKS, count: 3 },
      { id: Item.STICK, count: 2 },
    ],
    output: { id: Item.WOOD_PICK, count: 1 },
    hint: "Mine stone faster",
  },
  {
    id: "wood_axe",
    name: "Wooden Axe",
    inputs: [
      { id: Block.PLANKS, count: 3 },
      { id: Item.STICK, count: 2 },
    ],
    output: { id: Item.WOOD_AXE, count: 1 },
    hint: "Chop wood faster",
  },
  {
    id: "wood_shovel",
    name: "Wooden Shovel",
    inputs: [
      { id: Block.PLANKS, count: 1 },
      { id: Item.STICK, count: 2 },
    ],
    output: { id: Item.WOOD_SHOVEL, count: 1 },
    hint: "Dig dirt/sand faster",
  },
  {
    id: "wood_sword",
    name: "Wooden Sword",
    inputs: [
      { id: Block.PLANKS, count: 2 },
      { id: Item.STICK, count: 1 },
    ],
    output: { id: Item.WOOD_SWORD, count: 1 },
    hint: "Fight caterpillars",
  },
  {
    id: "stone_pick",
    name: "Stone Pickaxe",
    inputs: [
      { id: Block.COBBLE, count: 3 },
      { id: Item.STICK, count: 2 },
    ],
    output: { id: Item.STONE_PICK, count: 1 },
    hint: "Much faster mining",
  },
  {
    id: "stone_axe",
    name: "Stone Axe",
    inputs: [
      { id: Block.COBBLE, count: 3 },
      { id: Item.STICK, count: 2 },
    ],
    output: { id: Item.STONE_AXE, count: 1 },
  },
  {
    id: "stone_shovel",
    name: "Stone Shovel",
    inputs: [
      { id: Block.COBBLE, count: 1 },
      { id: Item.STICK, count: 2 },
    ],
    output: { id: Item.STONE_SHOVEL, count: 1 },
  },
  {
    id: "stone_sword",
    name: "Stone Sword",
    inputs: [
      { id: Block.COBBLE, count: 2 },
      { id: Item.STICK, count: 1 },
    ],
    output: { id: Item.STONE_SWORD, count: 1 },
  },
  {
    id: "torch",
    name: "Torch",
    inputs: [
      { id: Item.STICK, count: 1 },
      { id: Block.PLANKS, count: 1 },
    ],
    output: { id: Block.TORCH, count: 4 },
    hint: "Light caves and the night",
  },
  {
    id: "torch_coal",
    name: "Torch",
    inputs: [
      { id: Item.STICK, count: 1 },
      { id: Item.COAL, count: 1 },
    ],
    output: { id: Block.TORCH, count: 4 },
    hint: "Coal burns brighter — 4 torches",
  },
  {
    id: "furnace",
    name: "Furnace",
    inputs: [{ id: Block.COBBLE, count: 8 }],
    output: { id: Block.FURNACE, count: 1 },
    hint: "Right-click to smelt ore",
  },
  {
    id: "chest",
    name: "Chest",
    inputs: [{ id: Block.PLANKS, count: 8 }],
    output: { id: Block.CHEST, count: 1 },
    hint: "27 slots — stash your extras",
  },
  {
    id: "door",
    name: "Door",
    inputs: [{ id: Block.PLANKS, count: 6 }],
    output: { id: Block.DOOR, count: 3 },
    hint: "Right-click to open — two blocks tall",
  },
  {
    id: "ladder",
    name: "Ladder",
    inputs: [{ id: Item.STICK, count: 7 }],
    output: { id: Block.LADDER, count: 3 },
    hint: "Hang on a wall and climb caves",
  },
  {
    id: "bed",
    name: "Bed",
    inputs: [
      { id: Item.WOOL, count: 3 },
      { id: Block.PLANKS, count: 3 },
    ],
    output: { id: Block.BED, count: 1 },
    hint: "Sleep through the night",
  },
  {
    id: "iron_pick",
    name: "Iron Pickaxe",
    inputs: [
      { id: Item.IRON_INGOT, count: 3 },
      { id: Item.STICK, count: 2 },
    ],
    output: { id: Item.IRON_PICK, count: 1 },
    hint: "The midgame pick",
  },
  {
    id: "iron_axe",
    name: "Iron Axe",
    inputs: [
      { id: Item.IRON_INGOT, count: 3 },
      { id: Item.STICK, count: 2 },
    ],
    output: { id: Item.IRON_AXE, count: 1 },
  },
  {
    id: "iron_shovel",
    name: "Iron Shovel",
    inputs: [
      { id: Item.IRON_INGOT, count: 1 },
      { id: Item.STICK, count: 2 },
    ],
    output: { id: Item.IRON_SHOVEL, count: 1 },
  },
  {
    id: "iron_sword",
    name: "Iron Sword",
    inputs: [
      { id: Item.IRON_INGOT, count: 2 },
      { id: Item.STICK, count: 1 },
    ],
    output: { id: Item.IRON_SWORD, count: 1 },
    hint: "Serious reach and damage",
  },
  {
    id: "bow",
    name: "Bow",
    inputs: [
      { id: Item.STICK, count: 3 },
      { id: Item.STRING, count: 3 },
    ],
    output: { id: Item.BOW, count: 1 },
    hint: "String + sticks · needs arrows",
  },
  {
    id: "arrows",
    name: "Arrows",
    inputs: [
      { id: Item.STICK, count: 1 },
      { id: Item.FEATHER, count: 1 },
      { id: Item.BONE, count: 1 },
    ],
    output: { id: Item.ARROW, count: 4 },
    hint: "Bone tip · feather fletching",
  },
  {
    id: "bone_meal",
    name: "Bone Meal",
    inputs: [{ id: Item.BONE, count: 1 }],
    output: { id: Item.BONE_MEAL, count: 3 },
    hint: "Right-click grass or dirt to grow",
  },
  {
    id: "leather_helm",
    name: "Leather Cap",
    inputs: [{ id: Item.LEATHER, count: 5 }],
    output: { id: Item.LEATHER_HELM, count: 1 },
    hint: "Hunt cows · soak hits",
  },
  {
    id: "leather_chest",
    name: "Leather Tunic",
    inputs: [{ id: Item.LEATHER, count: 8 }],
    output: { id: Item.LEATHER_CHEST, count: 1 },
    hint: "Best leather piece",
  },
  {
    id: "leather_legs",
    name: "Leather Pants",
    inputs: [{ id: Item.LEATHER, count: 7 }],
    output: { id: Item.LEATHER_LEGS, count: 1 },
  },
  {
    id: "leather_boots",
    name: "Leather Boots",
    inputs: [{ id: Item.LEATHER, count: 4 }],
    output: { id: Item.LEATHER_BOOTS, count: 1 },
  },
  {
    id: "iron_helm",
    name: "Iron Helmet",
    inputs: [{ id: Item.IRON_INGOT, count: 5 }],
    output: { id: Item.IRON_HELM, count: 1 },
    hint: "Smelt ore · 2 armor",
  },
  {
    id: "iron_chest",
    name: "Iron Chestplate",
    inputs: [{ id: Item.IRON_INGOT, count: 8 }],
    output: { id: Item.IRON_CHEST, count: 1 },
    hint: "Best iron piece · 6 armor",
  },
  {
    id: "iron_legs",
    name: "Iron Leggings",
    inputs: [{ id: Item.IRON_INGOT, count: 7 }],
    output: { id: Item.IRON_LEGS, count: 1 },
    hint: "5 armor",
  },
  {
    id: "iron_boots",
    name: "Iron Boots",
    inputs: [{ id: Item.IRON_INGOT, count: 4 }],
    output: { id: Item.IRON_BOOTS, count: 1 },
    hint: "2 armor",
  },
  {
    id: "bucket",
    name: "Bucket",
    inputs: [{ id: Item.IRON_INGOT, count: 3 }],
    output: { id: Item.BUCKET, count: 1 },
    hint: "Scoop source water",
  },
  {
    id: "crafting_cobble",
    name: "Cobblestone (hint)",
    inputs: [],
    output: { id: Block.COBBLE, count: 0 },
    hint: "Mine stone with a pickaxe",
  },
];

/** Recipes the player can actually craft (hide meta hints with 0 output) */
export const CRAFTABLE_RECIPES = RECIPES.filter((r) => r.output.count > 0);

/** Procedural tool/stick icons as data URLs */
const iconCache = new Map<number, string>();

export function itemIconDataUrl(id: ItemId): string | null {
  if (isBlockItem(id)) return null; // use atlas
  if (iconCache.has(id)) return iconCache.get(id)!;
  const url = paintItemIcon(id);
  iconCache.set(id, url);
  return url;
}

function paintItemIcon(id: ItemId): string {
  const c = document.createElement("canvas");
  c.width = 32;
  c.height = 32;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, 32, 32);
  const def = ITEM_DEFS[id];
  const wood = "#9a7340";
  const woodDark = "#6b4a28";
  const stone = "#8a8a90";
  const stoneDark = "#5a5a60";
  const iron = "#d4d8e0";
  const ironDark = "#8a909a";
  const tier = def?.tier ?? "wood";
  const head = tier === "iron" ? iron : tier === "stone" ? stone : wood;
  const headDark = tier === "iron" ? ironDark : tier === "stone" ? stoneDark : woodDark;
  const stick = "#6b4a28";

  const stickLine = (x0: number, y0: number, x1: number, y1: number) => {
    ctx.strokeStyle = stick;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  };

  if (id === Item.STICK) {
    stickLine(10, 26, 22, 6);
    return c.toDataURL("image/png");
  }

  if (id === Item.COAL) {
    ctx.fillStyle = "#2c2c30";
    ctx.beginPath();
    ctx.moveTo(10, 24);
    ctx.lineTo(7, 16);
    ctx.lineTo(12, 8);
    ctx.lineTo(22, 10);
    ctx.lineTo(25, 20);
    ctx.lineTo(18, 26);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#1a1a1c";
    ctx.fillRect(12, 14, 3, 3);
    ctx.fillStyle = "#5a5a62";
    ctx.fillRect(16, 12, 2, 2);
    return c.toDataURL("image/png");
  }

  if (id === Item.IRON_INGOT) {
    ctx.fillStyle = "#b8bcc4";
    ctx.fillRect(6, 12, 20, 10);
    ctx.fillStyle = "#e8ecf2";
    ctx.fillRect(6, 12, 20, 3);
    ctx.fillStyle = "#7a8088";
    ctx.fillRect(6, 20, 20, 2);
    ctx.fillStyle = "#d0d4dc";
    ctx.fillRect(8, 15, 6, 3);
    return c.toDataURL("image/png");
  }

  if (id === Item.LEATHER) {
    ctx.fillStyle = "#8a5a32";
    ctx.beginPath();
    ctx.moveTo(8, 10);
    ctx.lineTo(16, 6);
    ctx.lineTo(24, 10);
    ctx.lineTo(26, 22);
    ctx.lineTo(6, 22);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#6a4020";
    ctx.fillRect(12, 14, 8, 4);
    return c.toDataURL("image/png");
  }
  if (id === Item.FEATHER) {
    ctx.fillStyle = "#f4f0e4";
    ctx.beginPath();
    ctx.moveTo(16, 4);
    ctx.quadraticCurveTo(26, 14, 18, 28);
    ctx.quadraticCurveTo(10, 16, 16, 4);
    ctx.fill();
    ctx.strokeStyle = "#c8c0b0";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(16, 6);
    ctx.lineTo(16, 26);
    ctx.stroke();
    return c.toDataURL("image/png");
  }
  if (id === Item.WOOL) {
    ctx.fillStyle = "#f0ece4";
    ctx.beginPath();
    ctx.arc(12, 16, 7, 0, Math.PI * 2);
    ctx.arc(20, 16, 7, 0, Math.PI * 2);
    ctx.arc(16, 11, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#d8d4cc";
    ctx.fillRect(14, 18, 4, 3);
    return c.toDataURL("image/png");
  }
  if (id === Item.STRING) {
    ctx.strokeStyle = "#d8d0c4";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(8, 8);
    ctx.bezierCurveTo(20, 10, 10, 18, 24, 24);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(10, 6);
    ctx.bezierCurveTo(22, 12, 8, 20, 22, 26);
    ctx.stroke();
    return c.toDataURL("image/png");
  }
  if (id === Item.BONE) {
    ctx.fillStyle = "#f0ead8";
    ctx.fillRect(14, 8, 4, 16);
    ctx.beginPath();
    ctx.arc(13, 8, 4, 0, Math.PI * 2);
    ctx.arc(19, 8, 4, 0, Math.PI * 2);
    ctx.arc(13, 24, 4, 0, Math.PI * 2);
    ctx.arc(19, 24, 4, 0, Math.PI * 2);
    ctx.fill();
    return c.toDataURL("image/png");
  }
  if (id === Item.BREAD) {
    ctx.fillStyle = "#c88838";
    ctx.beginPath();
    ctx.ellipse(16, 18, 12, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#e8b868";
    ctx.beginPath();
    ctx.ellipse(16, 15, 11, 6, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f4d090";
    ctx.beginPath();
    ctx.ellipse(16, 14, 7, 3.2, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#a86828";
    ctx.fillRect(8, 18, 2, 2);
    ctx.fillRect(22, 17, 2, 2);
    return c.toDataURL("image/png");
  }
  if (id === Item.BOW) {
    ctx.strokeStyle = "#8a6238";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(18, 16, 11, -2.2, 2.2);
    ctx.stroke();
    ctx.strokeStyle = "#d8d0c4";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(14, 6);
    ctx.lineTo(14, 26);
    ctx.stroke();
    return c.toDataURL("image/png");
  }
  if (id === Item.ARROW) {
    ctx.fillStyle = "#6b4a28";
    ctx.fillRect(8, 14, 16, 3);
    ctx.fillStyle = "#c8c0b0";
    ctx.beginPath();
    ctx.moveTo(22, 11);
    ctx.lineTo(30, 15.5);
    ctx.lineTo(22, 20);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#f4f0e4";
    ctx.beginPath();
    ctx.moveTo(8, 12);
    ctx.lineTo(4, 10);
    ctx.lineTo(8, 16);
    ctx.lineTo(4, 21);
    ctx.lineTo(8, 19);
    ctx.closePath();
    ctx.fill();
    return c.toDataURL("image/png");
  }
  if (id === Item.BONE_MEAL) {
    ctx.fillStyle = "#f4f0e4";
    ctx.beginPath();
    ctx.arc(12, 18, 5, 0, Math.PI * 2);
    ctx.arc(18, 14, 6, 0, Math.PI * 2);
    ctx.arc(21, 20, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#e0d8c8";
    ctx.fillRect(14, 16, 3, 3);
    return c.toDataURL("image/png");
  }
  if (id === Item.BUCKET || id === Item.WATER_BUCKET) {
    ctx.fillStyle = "#8a9098";
    ctx.beginPath();
    ctx.moveTo(8, 10);
    ctx.lineTo(10, 26);
    ctx.lineTo(22, 26);
    ctx.lineTo(24, 10);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#c4c8d0";
    ctx.fillRect(8, 8, 16, 4);
    ctx.fillStyle = "#6a7078";
    ctx.fillRect(7, 10, 18, 2);
    if (id === Item.WATER_BUCKET) {
      ctx.fillStyle = "#3a7ec8";
      ctx.fillRect(11, 14, 10, 10);
      ctx.fillStyle = "#6ab0e0";
      ctx.fillRect(12, 15, 8, 3);
    }
    return c.toDataURL("image/png");
  }
  if (id === Item.LEATHER_HELM) {
    ctx.fillStyle = "#8a5a32";
    ctx.fillRect(8, 10, 16, 12);
    ctx.fillStyle = "#6a4020";
    ctx.fillRect(8, 10, 16, 3);
    ctx.fillStyle = "#c49a6c";
    ctx.fillRect(12, 16, 8, 6);
    return c.toDataURL("image/png");
  }
  if (id === Item.LEATHER_CHEST) {
    ctx.fillStyle = "#8a5a32";
    ctx.fillRect(8, 8, 16, 18);
    ctx.fillStyle = "#6a4020";
    ctx.fillRect(8, 8, 5, 7);
    ctx.fillRect(19, 8, 5, 7);
    ctx.fillStyle = "#a07040";
    ctx.fillRect(12, 14, 8, 8);
    return c.toDataURL("image/png");
  }
  if (id === Item.LEATHER_LEGS) {
    ctx.fillStyle = "#8a5a32";
    ctx.fillRect(9, 6, 14, 8);
    ctx.fillRect(9, 13, 6, 14);
    ctx.fillRect(17, 13, 6, 14);
    ctx.fillStyle = "#6a4020";
    ctx.fillRect(9, 24, 6, 3);
    ctx.fillRect(17, 24, 6, 3);
    return c.toDataURL("image/png");
  }
  if (id === Item.LEATHER_BOOTS) {
    ctx.fillStyle = "#6a4020";
    ctx.fillRect(6, 18, 8, 8);
    ctx.fillRect(18, 18, 8, 8);
    ctx.fillStyle = "#8a5a32";
    ctx.fillRect(6, 14, 8, 6);
    ctx.fillRect(18, 14, 8, 6);
    return c.toDataURL("image/png");
  }
  if (
    id === Item.IRON_HELM ||
    id === Item.IRON_CHEST ||
    id === Item.IRON_LEGS ||
    id === Item.IRON_BOOTS
  ) {
    const mid = "#c4c8d0";
    const dark = "#7a8088";
    const hi = "#e8ecf2";
    if (id === Item.IRON_HELM) {
      ctx.fillStyle = mid;
      ctx.fillRect(8, 9, 16, 13);
      ctx.fillStyle = dark;
      ctx.fillRect(8, 9, 16, 3);
      ctx.fillStyle = "#3a4048";
      ctx.fillRect(12, 16, 8, 6);
      ctx.fillStyle = hi;
      ctx.fillRect(10, 11, 4, 2);
    } else if (id === Item.IRON_CHEST) {
      ctx.fillStyle = mid;
      ctx.fillRect(8, 8, 16, 18);
      ctx.fillStyle = dark;
      ctx.fillRect(8, 8, 5, 7);
      ctx.fillRect(19, 8, 5, 7);
      ctx.fillStyle = hi;
      ctx.fillRect(13, 14, 6, 3);
      ctx.fillStyle = dark;
      ctx.fillRect(15, 18, 2, 6);
    } else if (id === Item.IRON_LEGS) {
      ctx.fillStyle = mid;
      ctx.fillRect(9, 6, 14, 8);
      ctx.fillRect(9, 13, 6, 14);
      ctx.fillRect(17, 13, 6, 14);
      ctx.fillStyle = dark;
      ctx.fillRect(9, 24, 6, 3);
      ctx.fillRect(17, 24, 6, 3);
      ctx.fillStyle = hi;
      ctx.fillRect(11, 8, 4, 2);
    } else {
      ctx.fillStyle = dark;
      ctx.fillRect(6, 18, 8, 8);
      ctx.fillRect(18, 18, 8, 8);
      ctx.fillStyle = mid;
      ctx.fillRect(6, 14, 8, 6);
      ctx.fillRect(18, 14, 8, 6);
      ctx.fillStyle = hi;
      ctx.fillRect(7, 15, 3, 2);
      ctx.fillRect(19, 15, 3, 2);
    }
    return c.toDataURL("image/png");
  }

  const food = def?.food;
  if (food) {
    const cooked = id === Item.COOKED_PORK || id === Item.COOKED_BEEF ||
      id === Item.COOKED_MUTTON || id === Item.COOKED_CHICKEN || id === Item.COOKED_RABBIT;
    const rotten = id === Item.ROTTEN_FLESH;
    ctx.fillStyle = rotten ? "#6a8040" : cooked ? "#a05828" : "#d05058";
    ctx.beginPath();
    ctx.ellipse(16, 17, 10, 7, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rotten ? "#4a6030" : cooked ? "#6a3818" : "#f0c0b0";
    ctx.beginPath();
    ctx.ellipse(13, 15, 4, 3, -0.3, 0, Math.PI * 2);
    ctx.fill();
    if (cooked) {
      ctx.fillStyle = "#3a2010";
      ctx.fillRect(10, 14, 2, 2);
      ctx.fillRect(18, 18, 2, 2);
    }
    return c.toDataURL("image/png");
  }

  const kind = def?.tool;
  // diagonal stick handle
  stickLine(12, 24, 22, 10);

  ctx.fillStyle = head;
  ctx.strokeStyle = headDark;
  ctx.lineWidth = 1;

  if (kind === "pickaxe") {
    // crescent head
    ctx.beginPath();
    ctx.arc(11, 10, 7, -0.2, Math.PI + 0.2);
    ctx.lineTo(11, 10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (kind === "axe") {
    ctx.beginPath();
    ctx.moveTo(8, 6);
    ctx.lineTo(16, 8);
    ctx.lineTo(16, 14);
    ctx.lineTo(8, 16);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (kind === "shovel") {
    ctx.beginPath();
    ctx.ellipse(10, 10, 5, 6, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (kind === "sword") {
    // blade
    ctx.fillStyle = tier === "iron" ? "#e8ecf4" : tier === "stone" ? "#b0b4bc" : "#d4c4a0";
    ctx.beginPath();
    ctx.moveTo(10, 20);
    ctx.lineTo(14, 6);
    ctx.lineTo(18, 8);
    ctx.lineTo(14, 22);
    ctx.closePath();
    ctx.fill();
    // guard
    ctx.fillStyle = head;
    ctx.fillRect(8, 18, 12, 3);
  }

  return c.toDataURL("image/png");
}
