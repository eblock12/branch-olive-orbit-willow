import { Block, BLOCKS, isPlant, isTorch, isDoor, isLadder, isStair, stairItemFromCell, type BlockId } from "./blocks";
import {
  CRAFTABLE_RECIPES,
  ITEM_DEFS,
  Item,
  type ItemId,
  type ItemStack,
  type Recipe,
  canHarvest,
  getTool,
  itemMaxStack,
  mineTimeWithTool,
  placeableBlock,
  armorInfo,
} from "./items";

export const MAX_HEALTH = 20;
export const MAX_HUNGER = 20;
export const HOTBAR_SIZE = 9;
export const INV_SIZE = 27;
export const MAX_STACK = 64;

export type HotbarSlot = ItemStack | null;

/** @deprecated use mineTimeWithTool — kept for callers that only pass block */
export function mineTime(id: number, toolId?: ItemId | null): number {
  return mineTimeWithTool(id, toolId);
}

/** Item dropped when block is broken (null = nothing) */
export function blockDrop(id: number): ItemId | null {
  if (isPlant(id) && !isTorch(id)) return id as BlockId;
  if (isDoor(id)) return Block.DOOR;
  if (isLadder(id)) return Block.LADDER;
  if (isStair(id)) return stairItemFromCell(id) as BlockId;
  switch (id) {
    case Block.GRASS:
    case Block.SNOW_GRASS:
      return Block.DIRT;
    case Block.STONE:
      return Block.COBBLE;
    case Block.COAL_ORE:
      return Item.COAL;
    case Block.IRON_ORE:
      return Block.IRON_ORE;
    case Block.FURNACE:
    case Block.FURNACE_LIT:
      return Block.FURNACE;
    case Block.CHEST:
      return Block.CHEST;
    case Block.BED:
      return Block.BED;
    case Block.TORCH:
    case Block.TORCH_NX:
    case Block.TORCH_PX:
    case Block.TORCH_NZ:
    case Block.TORCH_PZ:
      return Block.TORCH;
    case Block.LADDER:
    case Block.LADDER_NX:
    case Block.LADDER_PX:
    case Block.LADDER_NZ:
    case Block.LADDER_PZ:
      return Block.LADDER;
    case Block.DIRT:
    case Block.SAND:
    case Block.WOOD:
    case Block.BIRCH_WOOD:
    case Block.SPRUCE_WOOD:
    case Block.COBBLE:
    case Block.PLANKS:
    case Block.SNOW:
    case Block.CACTUS:
    case Block.CLAY:
    case Block.ARCANE:
    case Block.PORTAL:
      return id as BlockId;
    case Block.LEAVES:
    case Block.BIRCH_LEAVES:
    case Block.SPRUCE_LEAVES:
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

  slots: HotbarSlot[] = Array.from({ length: INV_SIZE }, () => null);
  /** head, chest, legs, feet */
  armor: HotbarSlot[] = [null, null, null, null];
  selected = 0;
  /** Stack held on the inventory cursor (furnace / craft). */
  cursor: ItemStack | null = null;

  miningTarget: { x: number; y: number; z: number; id: number } | null = null;
  mineProgress = 0;

  /** Simple progression flags for tips */
  craftedFirst = false;
  madePick = false;
  madeFurnace = false;
  smeltedIron = false;
  madeBow = false;
  madeArmor = false;
  /** Debug: craft without consuming / requiring inputs */
  freeCraft = false;
  bedSpawn: { x: number; y: number; z: number } | null = null;

  constructor() {
    // Soft start: dirt + wood so early crafting is possible
    this.addItem(Block.DIRT, 8);
    this.addItem(Block.WOOD, 3);
    this.addItem(Block.TORCH, 6);
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
      for (let i = 0; i < INV_SIZE && left > 0; i++) {
        const s = this.slots[i];
        if (s && s.id === id && s.count < maxStack) {
          const room = maxStack - s.count;
          const n = Math.min(room, left);
          s.count += n;
          left -= n;
        }
      }
    }

    for (let i = 0; i < INV_SIZE && left > 0; i++) {
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
    for (let i = 0; i < INV_SIZE && need > 0; i++) {
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
    if (!this.freeCraft) {
      for (const inp of recipe.inputs) {
        if (this.countOf(inp.id) < inp.count) return false;
      }
    }
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
    if (!this.freeCraft) {
      for (const inp of recipe.inputs) {
        this.removeItem(inp.id, inp.count);
      }
    }
    const out = recipe.output;
    const maxD = ITEM_DEFS[out.id]?.maxDurability;
    this.addItem(out.id, out.count, maxD);
    this.craftedFirst = true;
    if (out.id === Block.FURNACE) this.madeFurnace = true;
    if (ITEM_DEFS[out.id]?.tool === "pickaxe") this.madePick = true;
    if (out.id === Item.BOW) this.madeBow = true;
    if (ITEM_DEFS[out.id]?.armor) this.madeArmor = true;
    return true;
  }

  /** Remove 1 (or the whole stack) from the selected slot. */
  dropSelected(all = false): ItemId | null {
    const s = this.slots[this.selected];
    if (!s || s.count <= 0) return null;
    const id = s.id;
    if (all) {
      this.slots[this.selected] = null;
    } else {
      s.count--;
      if (s.count <= 0) this.slots[this.selected] = null;
    }
    return id;
  }

  /** Left-click any inventory slot: pick up, place, merge, or swap. */
  clickSlot(i: number): void {
    if (i < 0 || i >= INV_SIZE) return;
    const r = clickStacks(this.slots[i], this.cursor);
    this.slots[i] = r.slot;
    this.cursor = r.cursor;
    if (i < HOTBAR_SIZE) this.select(i);
  }

  /** @deprecated use clickSlot */
  clickHotbar(i: number): void {
    this.clickSlot(i);
  }

  /** Put as much of `stack` as will fit into the hotbar. Returns leftover. */
  insertStack(stack: ItemStack): ItemStack | null {
    const added = this.addItem(stack.id, stack.count, stack.durability);
    const left = stack.count - added;
    if (left <= 0) return null;
    return { ...stack, count: left };
  }

  /** Return cursor into inventory. Leftover stays on the cursor. */
  parkCursor(): void {
    if (!this.cursor) return;
    this.cursor = this.insertStack(this.cursor);
  }

  /**
   * Move as much as possible from slots[i] into dest (another bag).
   * Returns true if anything moved.
   */
  shiftInto(i: number, dest: HotbarSlot[]): boolean {
    const src = this.slots[i];
    if (!src) return false;
    const left = mergeIntoSlots(dest, src);
    this.slots[i] = left;
    return !left || left.count < src.count;
  }

  shiftFrom(srcSlots: HotbarSlot[], i: number): boolean {
    const src = srcSlots[i];
    if (!src) return false;
    const left = mergeIntoSlots(this.slots, src);
    srcSlots[i] = left;
    return !left || left.count < src.count;
  }

  /** Shift-click: hotbar ↔ backpack. */
  shiftHotbarBackpack(i: number): boolean {
    const src = this.slots[i];
    if (!src) return false;
    const destStart = i < HOTBAR_SIZE ? HOTBAR_SIZE : 0;
    const destEnd = i < HOTBAR_SIZE ? INV_SIZE : HOTBAR_SIZE;
    const dest: HotbarSlot[] = this.slots.slice(destStart, destEnd);
    const left = mergeIntoSlots(dest, src);
    for (let k = 0; k < dest.length; k++) this.slots[destStart + k] = dest[k]!;
    this.slots[i] = left;
    return true;
  }

  consumeSelected(): ItemId | null {
    const s = this.slots[this.selected];
    if (!s || s.count <= 0) return null;
    if (placeableBlock(s.id) === null) return null;
    const id = s.id;
    s.count--;
    if (s.count <= 0) this.slots[this.selected] = null;
    return id;
  }

  /** Eat held food. Heals now; hunger fill is stored for later. */
  eatSelected(): boolean {
    const s = this.slots[this.selected];
    if (!s) return false;
    const food = ITEM_DEFS[s.id]?.food;
    if (!food) return false;
    if (this.health >= MAX_HEALTH && this.hunger >= MAX_HUNGER) return false;
    this.heal(food.heal);
    this.hunger = Math.min(MAX_HUNGER, this.hunger + food.hunger);
    s.count--;
    if (s.count <= 0) this.slots[this.selected] = null;
    return true;
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
    // Hunger drain disabled for now
    void amount;
  }

  damage(amount: number): boolean {
    if (this.dead || this.invuln > 0 || amount <= 0) return false;
    let dmg = amount;
    if (amount < 18) {
      const pts = this.armorPoints();
      if (pts > 0) {
        dmg = Math.max(1, Math.round(amount * (1 - Math.min(0.55, pts * 0.07))));
        this.wearArmor(1);
      }
    }
    this.health = Math.max(0, this.health - dmg);
    this.invuln = 0.6;
    if (this.health <= 0) {
      this.dead = true;
      this.health = 0;
    }
    return true;
  }

  armorPoints(): number {
    let n = 0;
    for (const s of this.armor) {
      if (!s) continue;
      n += armorInfo(s.id)?.points ?? 0;
    }
    return n;
  }

  equipSelectedArmor(): boolean {
    const s = this.slots[this.selected];
    if (!s) return false;
    const info = armorInfo(s.id);
    if (!info) return false;
    const worn = this.armor[info.slotIndex] ?? null;
    const piece: ItemStack = {
      id: s.id,
      count: 1,
      durability: s.durability ?? ITEM_DEFS[s.id]?.maxDurability,
    };
    s.count--;
    if (s.count <= 0) this.slots[this.selected] = null;
    this.armor[info.slotIndex] = piece;
    if (worn) this.addItem(worn.id, worn.count, worn.durability);
    this.madeArmor = true;
    return true;
  }

  /** Click an armor doll slot: pick up, place, or swap if the piece fits. */
  clickArmor(i: number): void {
    if (i < 0 || i > 3) return;
    const worn = this.armor[i];
    const cur = this.cursor;
    if (cur) {
      const info = armorInfo(cur.id);
      if (!info || info.slotIndex !== i) return;
      const piece: ItemStack = {
        id: cur.id,
        count: 1,
        durability: cur.durability ?? ITEM_DEFS[cur.id]?.maxDurability,
      };
      const leftover =
        cur.count > 1 ? { ...cur, count: cur.count - 1 } : null;
      this.armor[i] = piece;
      this.cursor = leftover ?? worn;
      this.madeArmor = true;
    } else if (worn) {
      this.cursor = worn;
      this.armor[i] = null;
    }
  }

  /** Shift-click a bag slot: swap that piece onto the matching doll slot. */
  equipFromSlot(i: number): boolean {
    if (i < 0 || i >= this.slots.length) return false;
    const s = this.slots[i];
    if (!s) return false;
    const info = armorInfo(s.id);
    if (!info) return false;
    const worn = this.armor[info.slotIndex] ?? null;
    this.armor[info.slotIndex] = {
      id: s.id,
      count: 1,
      durability: s.durability ?? ITEM_DEFS[s.id]?.maxDurability,
    };
    this.slots[i] = worn;
    this.madeArmor = true;
    return true;
  }

  private wearArmor(amount: number): void {
    const worn: number[] = [];
    for (let i = 0; i < 4; i++) if (this.armor[i]) worn.push(i);
    if (worn.length === 0) return;
    const i = worn[(Math.random() * worn.length) | 0]!;
    const s = this.armor[i]!;
    const maxD = ITEM_DEFS[s.id]?.maxDurability ?? 40;
    s.durability = (s.durability ?? maxD) - amount;
    if (s.durability <= 0) this.armor[i] = null;
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
    // Hunger drain / starvation disabled for now
    void moving;
    void sprinting;
    void inWater;

    // Keep natural regen while "well fed"
    if (this.hunger >= 18 && this.health < MAX_HEALTH) {
      this._regenTimer = (this._regenTimer ?? 0) + dt;
      if (this._regenTimer >= 2) {
        this._regenTimer = 0;
        this.heal(1);
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

  /** Empty inventory + cursor. Returns every stack that was held. */
  dumpInventory(): ItemStack[] {
    const out: ItemStack[] = [];
    for (let i = 0; i < INV_SIZE; i++) {
      const s = this.slots[i];
      if (s && s.count > 0) out.push({ ...s });
      this.slots[i] = null;
    }
    if (this.cursor && this.cursor.count > 0) out.push({ ...this.cursor });
    this.cursor = null;
    for (let i = 0; i < 4; i++) {
      const s = this.armor[i];
      if (s && s.count > 0) out.push({ ...s });
      this.armor[i] = null;
    }
    return out;
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

/** Minecraft-style left click between a slot and the cursor. */
export function clickStacks(
  slot: ItemStack | null,
  cursor: ItemStack | null,
): { slot: ItemStack | null; cursor: ItemStack | null } {
  if (!cursor) {
    if (!slot) return { slot, cursor };
    return { slot: null, cursor: { ...slot } };
  }
  if (!slot) {
    return { slot: { ...cursor }, cursor: null };
  }
  if (slot.id === cursor.id && itemMaxStack(slot.id) > 1) {
    const max = itemMaxStack(slot.id);
    const n = Math.min(cursor.count, max - slot.count);
    if (n > 0) {
      slot = { ...slot, count: slot.count + n };
      const left = cursor.count - n;
      return { slot, cursor: left > 0 ? { ...cursor, count: left } : null };
    }
  }
  return { slot: { ...cursor }, cursor: { ...slot } };
}

/** Merge `from` into `dest` slots. Returns leftover or null. */
export function mergeIntoSlots(
  dest: HotbarSlot[],
  from: ItemStack,
): ItemStack | null {
  const max = itemMaxStack(from.id);
  let left = from.count;
  if (max > 1) {
    for (let i = 0; i < dest.length && left > 0; i++) {
      const s = dest[i];
      if (s && s.id === from.id && s.count < max) {
        const n = Math.min(max - s.count, left);
        s.count += n;
        left -= n;
      }
    }
  }
  for (let i = 0; i < dest.length && left > 0; i++) {
    if (!dest[i]) {
      const n = Math.min(max, left);
      dest[i] = {
        id: from.id,
        count: n,
        durability: from.durability,
      };
      left -= n;
    }
  }
  if (left <= 0) return null;
  return { ...from, count: left };
}

export { CRAFTABLE_RECIPES, getTool, placeableBlock, canHarvest };
export type { Recipe, ItemId, ItemStack };
