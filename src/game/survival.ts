import { Block, BLOCKS, isPlant, type BlockId } from "./blocks";
import {
  CRAFTABLE_RECIPES,
  ITEM_DEFS,
  type ItemId,
  type ItemStack,
  type Recipe,
  getTool,
  itemMaxStack,
  mineTimeWithTool,
  placeableBlock,
} from "./items";

export const MAX_HEALTH = 20;
export const MAX_HUNGER = 20;
export const HOTBAR_SIZE = 9;
export const MAX_STACK = 64;

export type HotbarSlot = ItemStack | null;

/** @deprecated use mineTimeWithTool — kept for callers that only pass block */
export function mineTime(id: number, toolId?: ItemId | null): number {
  return mineTimeWithTool(id, toolId);
}

/** Item dropped when block is broken (null = nothing) */
export function blockDrop(id: number): BlockId | null {
  if (isPlant(id)) return id as BlockId;
  switch (id) {
    case Block.GRASS:
    case Block.SNOW_GRASS:
      return Block.DIRT;
    case Block.STONE:
      return Block.COBBLE;
    case Block.DIRT:
    case Block.SAND:
    case Block.WOOD:
    case Block.COBBLE:
    case Block.PLANKS:
    case Block.SNOW:
    case Block.CACTUS:
    case Block.ICE:
      return id as BlockId;
    case Block.LEAVES:
      return Math.random() < 0.12 ? Block.PLANKS : null;
    case Block.BEDROCK:
    case Block.WATER:
    case Block.AIR:
      return null;
    default:
      return BLOCKS[id] ? (id as BlockId) : null;
  }
}

export class SurvivalState {
  health = MAX_HEALTH;
  hunger = MAX_HUNGER;
  exhaustion = 0;
  invuln = 0;
  dead = false;
  fallStartY: number | null = null;
  wasOnGround = true;

  slots: HotbarSlot[] = Array.from({ length: HOTBAR_SIZE }, () => null);
  selected = 0;

  miningTarget: { x: number; y: number; z: number; id: number } | null = null;
  mineProgress = 0;

  /** Simple progression flags for tips */
  craftedFirst = false;
  madePick = false;

  constructor() {
    // Soft start: dirt + wood so early crafting is possible
    this.addItem(Block.DIRT, 8);
    this.addItem(Block.WOOD, 3);
  }

  get selectedSlot(): HotbarSlot {
    return this.slots[this.selected] ?? null;
  }

  select(index: number): void {
    this.selected = ((index % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE;
  }

  countOf(id: ItemId): number {
    let n = 0;
    for (const s of this.slots) {
      if (s && s.id === id) n += s.count;
    }
    return n;
  }

  addItem(id: ItemId, count: number, durability?: number): number {
    if (count <= 0) return 0;
    const maxStack = itemMaxStack(id);
    let left = count;
    const isTool = maxStack === 1;

    if (!isTool) {
      for (let i = 0; i < HOTBAR_SIZE && left > 0; i++) {
        const s = this.slots[i];
        if (s && s.id === id && s.count < maxStack) {
          const room = maxStack - s.count;
          const n = Math.min(room, left);
          s.count += n;
          left -= n;
        }
      }
    }

    for (let i = 0; i < HOTBAR_SIZE && left > 0; i++) {
      if (!this.slots[i]) {
        if (isTool) {
          const maxD = ITEM_DEFS[id]?.maxDurability;
          this.slots[i] = {
            id,
            count: 1,
            durability: durability ?? maxD,
          };
          left -= 1;
        } else {
          const n = Math.min(maxStack, left);
          this.slots[i] = { id, count: n };
          left -= n;
        }
      }
    }
    return count - left;
  }

  /** Remove up to `count` of item across inventory. Returns removed amount. */
  removeItem(id: ItemId, count: number): number {
    let need = count;
    for (let i = 0; i < HOTBAR_SIZE && need > 0; i++) {
      const s = this.slots[i];
      if (!s || s.id !== id) continue;
      const n = Math.min(s.count, need);
      s.count -= n;
      need -= n;
      if (s.count <= 0) this.slots[i] = null;
    }
    return count - need;
  }

  canCraft(recipe: Recipe): boolean {
    if (recipe.output.count <= 0) return false;
    for (const inp of recipe.inputs) {
      if (this.countOf(inp.id) < inp.count) return false;
    }
    // Need room for output (simplified: at least one empty or stackable slot)
    return this.canFit(recipe.output.id, recipe.output.count);
  }

  canFit(id: ItemId, count: number): boolean {
    const maxStack = itemMaxStack(id);
    let room = 0;
    for (const s of this.slots) {
      if (!s) room += maxStack;
      else if (s.id === id && maxStack > 1) room += maxStack - s.count;
    }
    return room >= count;
  }

  craft(recipe: Recipe): boolean {
    if (!this.canCraft(recipe)) return false;
    for (const inp of recipe.inputs) {
      this.removeItem(inp.id, inp.count);
    }
    const out = recipe.output;
    const maxD = ITEM_DEFS[out.id]?.maxDurability;
    this.addItem(out.id, out.count, maxD);
    this.craftedFirst = true;
    if (
      out.id === 101 ||
      out.id === 105 ||
      ITEM_DEFS[out.id]?.tool === "pickaxe"
    ) {
      this.madePick = true;
    }
    return true;
  }

  /** Consume 1 placeable block from selected; tools not consumable this way */
  consumeSelected(): ItemId | null {
    const s = this.slots[this.selected];
    if (!s || s.count <= 0) return null;
    if (placeableBlock(s.id) === null) return null;
    const id = s.id;
    s.count--;
    if (s.count <= 0) this.slots[this.selected] = null;
    return id;
  }

  hasSelectedPlaceable(): boolean {
    const s = this.slots[this.selected];
    return !!(s && s.count > 0 && placeableBlock(s.id) !== null);
  }

  hasSelected(): boolean {
    const s = this.slots[this.selected];
    return !!(s && s.count > 0);
  }

  /** Damage held tool after mining; returns true if tool broke */
  damageHeldTool(amount = 1): boolean {
    const s = this.slots[this.selected];
    if (!s) return false;
    const def = ITEM_DEFS[s.id];
    if (!def?.maxDurability) return false;
    s.durability = (s.durability ?? def.maxDurability) - amount;
    if (s.durability <= 0) {
      this.slots[this.selected] = null;
      return true;
    }
    return false;
  }

  heldToolId(): ItemId | null {
    return this.slots[this.selected]?.id ?? null;
  }

  addExhaustion(amount: number): void {
    this.exhaustion += amount;
    while (this.exhaustion >= 4 && this.hunger > 0) {
      this.exhaustion -= 4;
      this.hunger = Math.max(0, this.hunger - 1);
    }
  }

  damage(amount: number): boolean {
    if (this.dead || this.invuln > 0 || amount <= 0) return false;
    this.health = Math.max(0, this.health - amount);
    this.invuln = 0.6;
    if (this.health <= 0) {
      this.dead = true;
      this.health = 0;
    }
    return true;
  }

  heal(amount: number): void {
    if (this.dead) return;
    this.health = Math.min(MAX_HEALTH, this.health + amount);
  }

  tickInvuln(dt: number): void {
    this.invuln = Math.max(0, this.invuln - dt);
  }

  /**
   * Full survival tick: invuln, fall damage, hunger.
   */
  update(
    dt: number,
    onGround: boolean,
    y: number,
    sprinting: boolean,
    moving: boolean,
    inWater: boolean,
  ): void {
    this.tickInvuln(dt);

    // Fall damage
    if (inWater) {
      this.fallStartY = null;
    } else if (!onGround) {
      if (this.fallStartY === null) this.fallStartY = y;
    } else {
      if (this.fallStartY !== null) {
        const dist = this.fallStartY - y;
        if (dist > 3.5) {
          const dmg = Math.floor(dist - 3);
          if (dmg > 0) this.damage(dmg);
        }
        this.fallStartY = null;
      }
    }
    this.wasOnGround = onGround;

    this.updateHunger(dt, moving, sprinting, inWater);
  }

  updateHunger(dt: number, moving: boolean, sprinting: boolean, inWater: boolean): void {
    let drain = 0.02 * dt;
    if (moving) drain += 0.04 * dt;
    if (sprinting) drain += 0.08 * dt;
    if (inWater) drain += 0.03 * dt;
    this.addExhaustion(drain * 4);

    if (this.hunger <= 0) {
      this._starveTimer = (this._starveTimer ?? 0) + dt;
      if (this._starveTimer >= 4) {
        this._starveTimer = 0;
        if (this.health > 1) this.damage(1);
      }
    } else {
      this._starveTimer = 0;
    }

    if (this.hunger >= 18 && this.health < MAX_HEALTH) {
      this._regenTimer = (this._regenTimer ?? 0) + dt;
      if (this._regenTimer >= 2) {
        this._regenTimer = 0;
        this.heal(1);
        this.addExhaustion(1.2);
      }
    } else {
      this._regenTimer = 0;
    }
  }

  private _starveTimer = 0;
  private _regenTimer = 0;

  resetMine(): void {
    this.miningTarget = null;
    this.mineProgress = 0;
  }

  /** Hold-to-mine. Returns true when block should break. */
  tickMine(
    dt: number,
    x: number,
    y: number,
    z: number,
    id: number,
    mining: boolean,
  ): boolean {
    if (!mining || id === Block.AIR || !Number.isFinite(mineTimeWithTool(id, this.heldToolId()))) {
      this.resetMine();
      return false;
    }
    const t = mineTimeWithTool(id, this.heldToolId());
    if (
      !this.miningTarget ||
      this.miningTarget.x !== x ||
      this.miningTarget.y !== y ||
      this.miningTarget.z !== z ||
      this.miningTarget.id !== id
    ) {
      this.miningTarget = { x, y, z, id };
      this.mineProgress = 0;
    }
    this.mineProgress += dt / t;
    this.addExhaustion(dt * 0.35);
    if (this.mineProgress >= 1) {
      this.resetMine();
      return true;
    }
    return false;
  }

  respawn(): void {
    this.health = MAX_HEALTH;
    this.hunger = Math.max(6, Math.floor(MAX_HUNGER * 0.5));
    this.exhaustion = 0;
    this.dead = false;
    this.invuln = 2;
    this.resetMine();
    this.fallStartY = null;
    this.wasOnGround = true;
  }
}

export { CRAFTABLE_RECIPES, getTool, placeableBlock };
export type { Recipe, ItemId, ItemStack };
