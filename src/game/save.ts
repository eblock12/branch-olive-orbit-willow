import type { ItemStack } from "./items";
import type { HotbarSlot } from "./survival";

export const SAVE_KEY = "blockworld.save.v1";

/** Old tool/material IDs (100–144) now live at 200–244 so blocks can use 100+. */
function migrateLegacyItemId(id: number, durability?: number): number {
  if (id < 100 || id > 144) return id;
  // 100–106 overlap new blocks. Tools always carry durability; blocks don't.
  if (id >= 101 && id <= 106 && durability == null) return id;
  return id + 100;
}

export type SavedStack = {
  id: number;
  count: number;
  durability?: number;
};

export type WorldSave = {
  v: 1;
  seed: number;
  savedAt: number;
  dayTime: number;
  player: {
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
    health: number;
    hunger: number;
    selected: number;
    slots: (SavedStack | null)[];
    armor: (SavedStack | null)[];
    bedSpawn: { x: number; y: number; z: number } | null;
    craftedFirst: boolean;
    madePick: boolean;
    madeFurnace: boolean;
    smeltedIron: boolean;
    madeBow: boolean;
    madeArmor: boolean;
  };
  /** Per-chunk sparse edits: "cx,cz" → [packed, id, packed, id, ...] */
  edits: Record<string, number[]>;
  chests: {
    x: number;
    y: number;
    z: number;
    slots: (SavedStack | null)[];
  }[];
  furnaces: {
    x: number;
    y: number;
    z: number;
    input: SavedStack | null;
    fuel: SavedStack | null;
    output: SavedStack | null;
    burnLeft: number;
    burnMax: number;
    cook: number;
  }[];
};

export function packEdit(lx: number, y: number, lz: number): number {
  return (lx & 15) | ((lz & 15) << 4) | ((y & 255) << 8);
}

export function unpackEdit(k: number): { lx: number; y: number; lz: number } {
  return { lx: k & 15, lz: (k >> 4) & 15, y: (k >> 8) & 255 };
}

export function stackToSaved(s: ItemStack | null | undefined): SavedStack | null {
  if (!s || s.count <= 0) return null;
  return s.durability != null
    ? { id: s.id, count: s.count, durability: s.durability }
    : { id: s.id, count: s.count };
}

export function savedToStack(s: SavedStack | null | undefined): HotbarSlot {
  if (!s || s.count <= 0) return null;
  const id = migrateLegacyItemId(s.id, s.durability);
  return s.durability != null
    ? { id, count: s.count, durability: s.durability }
    : { id, count: s.count };
}

export function loadWorldSave(): WorldSave | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as WorldSave;
    if (!data || data.v !== 1 || !Number.isFinite(data.seed)) return null;
    return data;
  } catch {
    return null;
  }
}

export function writeWorldSave(data: WorldSave): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function clearWorldSave(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}
