import { Block } from "./blocks";
import { Item, itemMaxStack, type ItemId, type ItemStack } from "./items";

export type FurnaceSlot = "input" | "fuel" | "output";

export type FurnaceState = {
  x: number;
  y: number;
  z: number;
  input: ItemStack | null;
  fuel: ItemStack | null;
  output: ItemStack | null;
  /** Seconds remaining on current fuel unit */
  burnLeft: number;
  /** Seconds the current fuel unit started with */
  burnMax: number;
  /** Seconds cooked on current input (0..COOK_TIME) */
  cook: number;
};

export const COOK_TIME = 8;

const SMELT: Record<number, { out: ItemId; count: number }> = {
  [Block.IRON_ORE]: { out: Item.IRON_INGOT, count: 1 },
  [Block.COBBLE]: { out: Block.STONE, count: 1 },
  [Item.RAW_PORK]: { out: Item.COOKED_PORK, count: 1 },
  [Item.RAW_BEEF]: { out: Item.COOKED_BEEF, count: 1 },
  [Item.RAW_MUTTON]: { out: Item.COOKED_MUTTON, count: 1 },
  [Item.RAW_CHICKEN]: { out: Item.COOKED_CHICKEN, count: 1 },
  [Item.RAW_RABBIT]: { out: Item.COOKED_RABBIT, count: 1 },
};

const FUEL_SECONDS: Record<number, number> = {
  [Item.COAL]: 80,
  [Block.WOOD]: 15,
  [Block.PLANKS]: 15,
  [Item.STICK]: 5,
};

export function smeltResult(id: ItemId): { out: ItemId; count: number } | null {
  return SMELT[id] ?? null;
}

export function fuelSeconds(id: ItemId): number {
  return FUEL_SECONDS[id] ?? 0;
}

export function isSmeltable(id: ItemId): boolean {
  return !!SMELT[id];
}

export function isFuel(id: ItemId): boolean {
  return (FUEL_SECONDS[id] ?? 0) > 0;
}

function keyOf(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

function canStackInto(slot: ItemStack | null, id: ItemId, n: number): boolean {
  if (!slot) return true;
  if (slot.id !== id) return false;
  return slot.count + n <= itemMaxStack(id);
}

export class FurnaceSystem {
  private map = new Map<string, FurnaceState>();

  get(x: number, y: number, z: number): FurnaceState | undefined {
    return this.map.get(keyOf(x, y, z));
  }

  ensure(x: number, y: number, z: number): FurnaceState {
    const k = keyOf(x, y, z);
    let s = this.map.get(k);
    if (!s) {
      s = {
        x,
        y,
        z,
        input: null,
        fuel: null,
        output: null,
        burnLeft: 0,
        burnMax: 0,
        cook: 0,
      };
      this.map.set(k, s);
    }
    return s;
  }

  remove(x: number, y: number, z: number): FurnaceState | undefined {
    const k = keyOf(x, y, z);
    const s = this.map.get(k);
    if (s) this.map.delete(k);
    return s;
  }

  contents(s: FurnaceState): ItemStack[] {
    const out: ItemStack[] = [];
    if (s.input) out.push({ ...s.input });
    if (s.fuel) out.push({ ...s.fuel });
    if (s.output) out.push({ ...s.output });
    return out;
  }

  /**
   * Advance all furnaces. Returns positions whose lit state flipped
   * so the world can swap FURNACE / FURNACE_LIT.
   */
  update(dt: number): { x: number; y: number; z: number; lit: boolean }[] {
    const flips: { x: number; y: number; z: number; lit: boolean }[] = [];
    for (const s of this.map.values()) {
      const wasLit = s.burnLeft > 0;
      this.tickOne(s, dt);
      const lit = s.burnLeft > 0;
      if (lit !== wasLit) flips.push({ x: s.x, y: s.y, z: s.z, lit });
    }
    return flips;
  }

  private tickOne(s: FurnaceState, dt: number): void {
    const recipe = s.input ? smeltResult(s.input.id) : null;
    const canOutput =
      !!recipe && canStackInto(s.output, recipe.out, recipe.count);
    const canCook = !!recipe && canOutput;

    if (s.burnLeft > 0) {
      s.burnLeft = Math.max(0, s.burnLeft - dt);
    }

    if (canCook && s.burnLeft <= 0) {
      const fuelId = s.fuel?.id;
      const burn = fuelId != null ? fuelSeconds(fuelId) : 0;
      if (burn > 0 && s.fuel) {
        s.fuel.count--;
        if (s.fuel.count <= 0) s.fuel = null;
        s.burnLeft = burn;
        s.burnMax = burn;
      }
    }

    if (canCook && s.burnLeft > 0) {
      s.cook += dt;
      if (s.cook >= COOK_TIME && s.input && recipe) {
        s.input.count--;
        if (s.input.count <= 0) s.input = null;
        if (s.output && s.output.id === recipe.out) {
          s.output.count += recipe.count;
        } else {
          s.output = { id: recipe.out, count: recipe.count };
        }
        s.cook = 0;
      }
    } else {
      s.cook = Math.max(0, s.cook - dt * 2);
    }

    if (s.burnLeft <= 0) s.burnMax = 0;
  }
}
