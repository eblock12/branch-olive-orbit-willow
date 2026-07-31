import { Block, BLOCKS, isPlant, type BlockId } from "./blocks";

/** Item IDs: 0–99 reserved for blocks; 100+ materials & tools */
export const Item = {
  STICK: 100,
  WOOD_PICK: 101,
  WOOD_AXE: 102,
  WOOD_SHOVEL: 103,
  WOOD_SWORD: 104,
  STONE_PICK: 105,
  STONE_AXE: 106,
  STONE_SHOVEL: 107,
  STONE_SWORD: 108,
} as const;

export type ItemId = number;

export type ToolKind = "pickaxe" | "axe" | "shovel" | "sword" | "none";
export type ToolTier = "none" | "wood" | "stone";

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
];

/** All non-block items */
export const ITEM_DEFS: Record<number, ItemDef> = Object.fromEntries(
  TOOLS.map((t) => [t.id, t]),
);

export function isBlockItem(id: ItemId): boolean {
  return id > 0 && id < 100 && !!BLOCKS[id];
}

export function isTool(id: ItemId): boolean {
  return !!ITEM_DEFS[id]?.tool && ITEM_DEFS[id]!.tool !== "none";
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
  switch (blockId) {
    case Block.BEDROCK:
      return Infinity;
    case Block.LEAVES:
      return 0.28;
    case Block.SNOW:
    case Block.SNOW_GRASS:
      return 0.35;
    case Block.DIRT:
    case Block.GRASS:
    case Block.SAND:
      return 0.55;
    case Block.CACTUS:
    case Block.ICE:
      return 0.55;
    case Block.WOOD:
    case Block.PLANKS:
      return 1.0;
    case Block.COBBLE:
    case Block.STONE:
      return 2.2;
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
    blockId === Block.BEDROCK
  ) {
    return "pickaxe";
  }
  if (
    blockId === Block.WOOD ||
    blockId === Block.PLANKS ||
    blockId === Block.LEAVES
  ) {
    return "axe";
  }
  if (
    blockId === Block.DIRT ||
    blockId === Block.GRASS ||
    blockId === Block.SAND ||
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
};

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

  // Stone/cobble requires at least wood pick
  if (
    (blockId === Block.STONE || blockId === Block.COBBLE) &&
    tool.kind !== "pickaxe"
  ) {
    return base * 3.5; // agonizingly slow without pick
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
  const tier = def?.tier ?? "wood";
  const head = tier === "stone" ? stone : wood;
  const headDark = tier === "stone" ? stoneDark : woodDark;
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
    ctx.fillStyle = tier === "stone" ? "#b0b4bc" : "#d4c4a0";
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
