import { Block, BLOCKS, type BlockId } from "./blocks";

export const MAX_HEALTH = 20;
export const MAX_HUNGER = 20;
export const HOTBAR_SIZE = 9;
export const MAX_STACK = 64;

export type HotbarSlot = { id: BlockId; count: number } | null;

/** Mining duration in seconds (fist). Bedrock unbreakable. */
export function mineTime(id: number): number {
  switch (id) {
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
      return 0.5;
    case Block.CACTUS:
    case Block.ICE:
      return 0.55;
    case Block.WOOD:
    case Block.PLANKS:
      return 0.9;
    case Block.COBBLE:
    case Block.STONE:
      return 1.6;
    case Block.WATER:
      return Infinity;
    default:
      return 0.7;
  }
}

/** Item dropped when block is broken (null = nothing) */
export function blockDrop(id: number): BlockId | null {
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
      // ~15% stick-as-planks / sapling stand-in: planks scrap
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
  /** 0..1 toward next hunger drain tick */
  exhaustion = 0;
  invuln = 0;
  dead = false;
  /** Fall tracking */
  fallStartY: number | null = null;
  wasOnGround = true;

  slots: HotbarSlot[] = Array.from({ length: HOTBAR_SIZE }, () => null);
  selected = 0;

  /** Mining progress */
  miningTarget: { x: number; y: number; z: number; id: number } | null = null;
  mineProgress = 0;

  constructor() {
    // Soft start: a little dirt so first steps aren't harsh
    this.addItem(Block.DIRT, 8);
  }

  get selectedSlot(): HotbarSlot {
    return this.slots[this.selected] ?? null;
  }

  select(index: number): void {
    this.selected = ((index % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE;
  }

  addItem(id: BlockId, count: number): number {
    let left = count;
    // Stack into existing
    for (let i = 0; i < HOTBAR_SIZE && left > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id && s.count < MAX_STACK) {
        const room = MAX_STACK - s.count;
        const n = Math.min(room, left);
        s.count += n;
        left -= n;
      }
    }
    // Empty slots
    for (let i = 0; i < HOTBAR_SIZE && left > 0; i++) {
      if (!this.slots[i]) {
        const n = Math.min(MAX_STACK, left);
        this.slots[i] = { id, count: n };
        left -= n;
      }
    }
    return count - left; // added
  }

  /** Consume 1 from selected slot; returns block id or null */
  consumeSelected(): BlockId | null {
    const s = this.slots[this.selected];
    if (!s || s.count <= 0) return null;
    const id = s.id;
    s.count--;
    if (s.count <= 0) this.slots[this.selected] = null;
    return id;
  }

  hasSelected(): boolean {
    const s = this.slots[this.selected];
    return !!(s && s.count > 0);
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
      this.health = 0;
      this.dead = true;
    }
    return true;
  }

  heal(amount: number): void {
    if (this.dead) return;
    this.health = Math.min(MAX_HEALTH, this.health + amount);
  }

  update(dt: number, onGround: boolean, y: number, sprinting: boolean, moving: boolean): void {
    if (this.dead) return;
    if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - dt);

    // Fall tracking
    if (onGround) {
      if (!this.wasOnGround && this.fallStartY !== null) {
        const dist = this.fallStartY - y;
        if (dist > 3.5) {
          const dmg = Math.floor(dist - 3);
          if (dmg > 0) this.damage(dmg);
        }
      }
      this.fallStartY = null;
    } else {
      if (this.fallStartY === null) this.fallStartY = y;
      else this.fallStartY = Math.max(this.fallStartY, y);
    }
    this.wasOnGround = onGround;

    // Exhaustion from movement
    if (sprinting && moving) this.addExhaustion(dt * 0.9);
    else if (moving) this.addExhaustion(dt * 0.12);

    // Starvation
    if (this.hunger <= 0) {
      this._starveTimer = (this._starveTimer ?? 0) + dt;
      if (this._starveTimer >= 2) {
        this._starveTimer = 0;
        if (this.health > 1) this.damage(1);
      }
    } else {
      this._starveTimer = 0;
    }

    // Regen when well-fed
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
    if (!mining || id === Block.AIR || !Number.isFinite(mineTime(id))) {
      this.resetMine();
      return false;
    }
    const t = mineTime(id);
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
