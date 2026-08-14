import { Block } from "./blocks";
import { Item, itemMaxStack, type ItemId, type ItemStack } from "./items";
import { clickStacks, mergeIntoSlots, type HotbarSlot } from "./survival";

export const CHEST_SIZE = 27;

export type ChestState = {
  x: number;
  y: number;
  z: number;
  slots: HotbarSlot[];
};

function keyOf(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

function hash3(x: number, y: number, z: number, seed: number): number {
  let n = (x * 374761393 + y * 668265263 + z * 1274126177 + seed * 1103515245) | 0;
  n = (n ^ (n >>> 13)) * 1274126177;
  n = n ^ (n >>> 16);
  return (n >>> 0) / 4294967295;
}

export class ChestSystem {
  private map = new Map<string, ChestState>();

  get(x: number, y: number, z: number): ChestState | undefined {
    return this.map.get(keyOf(x, y, z));
  }

  ensure(
    x: number,
    y: number,
    z: number,
    opts?: { empty?: boolean; seed?: number },
  ): ChestState {
    const k = keyOf(x, y, z);
    let s = this.map.get(k);
    if (!s) {
      s = {
        x,
        y,
        z,
        slots: Array.from({ length: CHEST_SIZE }, () => null),
      };
      if (!opts?.empty) this.seedLoot(s, opts?.seed ?? 1);
      this.map.set(k, s);
    }
    return s;
  }

  remove(x: number, y: number, z: number): ChestState | undefined {
    const k = keyOf(x, y, z);
    const s = this.map.get(k);
    if (s) this.map.delete(k);
    return s;
  }

  contents(s: ChestState): ItemStack[] {
    return s.slots.filter((x): x is ItemStack => !!x).map((x) => ({ ...x }));
  }

  clickSlot(s: ChestState, i: number, cursor: ItemStack | null): ItemStack | null {
    if (i < 0 || i >= CHEST_SIZE) return cursor;
    const r = clickStacks(s.slots[i], cursor);
    s.slots[i] = r.slot;
    return r.cursor;
  }

  insert(s: ChestState, stack: ItemStack): ItemStack | null {
    return mergeIntoSlots(s.slots, stack);
  }

  private seedLoot(s: ChestState, seed: number): void {
    const deep = s.y < 50;
    const n = 3 + Math.floor(hash3(s.x, s.y, s.z, seed) * (deep ? 5 : 3));
    const table: { id: ItemId; lo: number; hi: number; w: number }[] = deep
      ? [
          { id: Item.COAL, lo: 2, hi: 8, w: 3 },
          { id: Block.IRON_ORE, lo: 1, hi: 4, w: 2 },
          { id: Block.TORCH, lo: 4, hi: 12, w: 3 },
          { id: Block.COBBLE, lo: 8, hi: 24, w: 2 },
          { id: Item.IRON_INGOT, lo: 1, hi: 3, w: 2 },
          { id: Item.STICK, lo: 4, hi: 10, w: 2 },
          { id: Item.BONE, lo: 1, hi: 4, w: 2 },
          { id: Item.ROTTEN_FLESH, lo: 1, hi: 3, w: 2 },
          { id: Item.BREAD, lo: 1, hi: 3, w: 2 },
          { id: Item.STONE_SWORD, lo: 1, hi: 1, w: 1 },
        ]
      : [
          { id: Block.PLANKS, lo: 4, hi: 16, w: 3 },
          { id: Block.TORCH, lo: 2, hi: 8, w: 3 },
          { id: Item.STICK, lo: 3, hi: 8, w: 2 },
          { id: Item.COAL, lo: 1, hi: 4, w: 2 },
          { id: Block.WOOD, lo: 2, hi: 6, w: 2 },
          { id: Item.WOOL, lo: 1, hi: 4, w: 3 },
          { id: Item.BREAD, lo: 1, hi: 4, w: 3 },
          { id: Item.COOKED_PORK, lo: 1, hi: 2, w: 1 },
          { id: Item.COOKED_CHICKEN, lo: 1, hi: 2, w: 1 },
          { id: Item.IRON_INGOT, lo: 1, hi: 2, w: 1 },
          { id: Block.POPPY, lo: 1, hi: 4, w: 1 },
          { id: Item.WOOD_SWORD, lo: 1, hi: 1, w: 1 },
        ];
    const used = new Set<number>();
    for (let i = 0; i < n; i++) {
      const h = hash3(s.x + i * 17, s.y, s.z + i * 9, seed + i);
      let wsum = 0;
      for (const t of table) wsum += t.w;
      let pick = h * wsum;
      let row = table[0]!;
      for (const t of table) {
        pick -= t.w;
        if (pick <= 0) {
          row = t;
          break;
        }
      }
      let slot = Math.floor(hash3(s.x, i, s.z, seed + 40) * CHEST_SIZE);
      for (let k = 0; k < CHEST_SIZE && used.has(slot); k++) {
        slot = (slot + 1) % CHEST_SIZE;
      }
      used.add(slot);
      const count = row.lo + Math.floor(hash3(i, s.y, s.z, seed + 7) * (row.hi - row.lo + 1));
      s.slots[slot] = { id: row.id, count: Math.min(itemMaxStack(row.id), count) };
    }
  }
}
