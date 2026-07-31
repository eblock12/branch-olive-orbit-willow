import * as THREE from "three";
import { Block, isSolid } from "./blocks";
import type { World } from "./world";
import type { Player } from "./player";
import {
  createEntityShadow,
  disposeEntityShadow,
  disposeEntityShadowShared,
  updateEntityShadow,
} from "./entityShadow";

export type CaterpillarMood = "wander" | "eat" | "flee" | "tease" | "steal";

/** Keep whole creature within ~1 block (1 world unit). */
const SEGMENTS = 5;
const BODY_R = 0.11;
const SEG_SPACING = 0.155;
/** Z of segment 0 (head-most body ball), centered so mid-body is at origin. */
const BODY_Z0 = ((SEGMENTS - 1) * SEG_SPACING) / 2;
const SPEED_WANDER = 1.55;
const SPEED_FLEE = 3.4;
const SPEED_TEASE = 2.4;
const PLAYER_NOTICE = 10;
const PLAYER_FLEE = 3.2;
const HIT_RADIUS = 0.4;
const MAX_ALIVE = 14;
const RESPAWN_INTERVAL = 8;
/** Shadow radius — oval stays under body center, ≤ block width. */
const SHADOW_RADIUS = 0.32;

/** Shared materials for all caterpillars */
export type CaterpillarMaterials = {
  bodyA: THREE.MeshLambertMaterial;
  bodyB: THREE.MeshLambertMaterial;
  head: THREE.MeshLambertMaterial;
  eye: THREE.MeshLambertMaterial;
  pupil: THREE.MeshLambertMaterial;
  antenna: THREE.MeshLambertMaterial;
  blush: THREE.MeshLambertMaterial;
};

export function createCaterpillarMaterials(): CaterpillarMaterials {
  return {
    bodyA: new THREE.MeshLambertMaterial({ color: 0x6ecf4a }),
    bodyB: new THREE.MeshLambertMaterial({ color: 0xc8e86a }),
    head: new THREE.MeshLambertMaterial({ color: 0x5ab83d }),
    eye: new THREE.MeshLambertMaterial({ color: 0xf4f4f5 }),
    pupil: new THREE.MeshLambertMaterial({ color: 0x1a1a1e }),
    antenna: new THREE.MeshLambertMaterial({ color: 0x3d6b2e }),
    blush: new THREE.MeshLambertMaterial({ color: 0xe88a9a }),
  };
}

export function disposeCaterpillarMaterials(m: CaterpillarMaterials): void {
  for (const mat of Object.values(m)) mat.dispose();
}

const sharedSphere = new THREE.SphereGeometry(1, 10, 8);
const sharedAnt = new THREE.CylinderGeometry(0.012, 0.015, 0.12, 5);
const sharedLeg = new THREE.BoxGeometry(0.03, 0.05, 0.03);

/**
 * Mesh is centered on the body midpoint (origin = feet center).
 * Head sits at +Z, tail at −Z; total length stays under 1 block.
 */
function buildCaterpillarMesh(mats: CaterpillarMaterials): THREE.Group {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.name = "body";
  root.add(body);

  for (let i = 0; i < SEGMENTS; i++) {
    const seg = new THREE.Mesh(sharedSphere, i % 2 === 0 ? mats.bodyA : mats.bodyB);
    const s = BODY_R * (1 - i * 0.035);
    seg.scale.set(s * 1.05, s * 0.95, s * 1.08);
    // Centered along Z: head-most segment at +BODY_Z0
    seg.position.set(0, s, BODY_Z0 - i * SEG_SPACING);
    body.add(seg);
  }

  // Head slightly in front of first segment (still inside 1-block envelope)
  const headZ = BODY_Z0 + BODY_R * 0.55;
  const head = new THREE.Mesh(sharedSphere, mats.head);
  head.scale.set(BODY_R * 1.12, BODY_R * 1.05, BODY_R * 1.15);
  head.position.set(0, BODY_R * 1.0, headZ);
  body.add(head);

  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(sharedSphere, mats.eye);
    eye.scale.setScalar(0.045);
    eye.position.set(side * 0.055, BODY_R * 1.25, headZ + BODY_R * 0.45);
    body.add(eye);
    const pupil = new THREE.Mesh(sharedSphere, mats.pupil);
    pupil.scale.setScalar(0.022);
    pupil.position.set(side * 0.055, BODY_R * 1.27, headZ + BODY_R * 0.55);
    body.add(pupil);
    const blush = new THREE.Mesh(sharedSphere, mats.blush);
    blush.scale.set(0.03, 0.018, 0.018);
    blush.position.set(side * 0.07, BODY_R * 1.0, headZ + BODY_R * 0.2);
    body.add(blush);
  }

  for (const side of [-1, 1]) {
    const ant = new THREE.Mesh(sharedAnt, mats.antenna);
    ant.position.set(side * 0.04, BODY_R * 1.55, headZ + BODY_R * 0.15);
    ant.rotation.z = side * 0.35;
    ant.rotation.x = -0.4;
    body.add(ant);
    const tip = new THREE.Mesh(sharedSphere, mats.bodyB);
    tip.scale.setScalar(0.025);
    tip.position.set(side * 0.055, BODY_R * 1.7, headZ + BODY_R * 0.05);
    body.add(tip);
  }

  for (let i = 0; i < SEGMENTS - 1; i++) {
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(sharedLeg, mats.antenna);
      leg.position.set(
        side * BODY_R * 0.9,
        0.015,
        BODY_Z0 - i * SEG_SPACING,
      );
      body.add(leg);
    }
  }

  return root;
}

export class NaughtyCaterpillar {
  readonly mesh: THREE.Group;
  readonly shadow: THREE.Mesh;
  x: number;
  y: number;
  z: number;
  yaw = 0;
  mood: CaterpillarMood = "wander";
  hp = 3;
  alive = true;
  private bob = Math.random() * Math.PI * 2;
  private stateT = 0;
  private nextThink = 0;
  private eatCooldown = 0;
  private targetX = 0;
  private targetZ = 0;
  private hurtFlash = 0;
  private wiggle = 0;

  constructor(x: number, y: number, z: number, mats: CaterpillarMaterials) {
    this.mesh = buildCaterpillarMesh(mats);
    this.shadow = createEntityShadow(SHADOW_RADIUS);
    this.x = x;
    this.y = y;
    this.z = z;
    this.yaw = Math.random() * Math.PI * 2;
    this.pickWanderTarget();
    this.syncMesh();
  }

  private pickWanderTarget(): void {
    const a = Math.random() * Math.PI * 2;
    const d = 3 + Math.random() * 8;
    this.targetX = this.x + Math.cos(a) * d;
    this.targetZ = this.z + Math.sin(a) * d;
  }

  hit(fromX: number, fromZ: number): "hurt" | "dead" | "miss" {
    if (!this.alive) return "miss";
    this.hp -= 1;
    this.hurtFlash = 0.35;
    this.mood = "flee";
    this.stateT = 1.8 + Math.random();
    const dx = this.x - fromX;
    const dz = this.z - fromZ;
    const len = Math.hypot(dx, dz) || 1;
    this.targetX = this.x + (dx / len) * 10;
    this.targetZ = this.z + (dz / len) * 10;
    if (this.hp <= 0) {
      this.alive = false;
      this.mesh.visible = false;
      this.shadow.visible = false;
      return "dead";
    }
    return "hurt";
  }

  rayHit(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxDist: number,
  ): number | null {
    if (!this.alive) return null;
    // Center of mass (body midpoint), not the head
    const cx = this.x;
    const cy = this.y + BODY_R * 1.1;
    const cz = this.z;
    const r = HIT_RADIUS;
    const ocx = ox - cx;
    const ocy = oy - cy;
    const ocz = oz - cz;
    const b = ocx * dx + ocy * dy + ocz * dz;
    const c = ocx * ocx + ocy * ocy + ocz * ocz - r * r;
    const disc = b * b - c;
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc);
    if (t >= 0 && t <= maxDist) return t;
    const t2 = -b + Math.sqrt(disc);
    if (t2 >= 0 && t2 <= maxDist) return t2;
    return null;
  }

  update(dt: number, world: World, player: Player): void {
    if (!this.alive) return;
    this.bob += dt * 8;
    this.wiggle += dt * 10;
    this.stateT -= dt;
    this.eatCooldown = Math.max(0, this.eatCooldown - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    this.nextThink -= dt;

    const pdx = player.x - this.x;
    const pdz = player.z - this.z;
    const pDist = Math.hypot(pdx, pdz);

    if (this.nextThink <= 0) {
      this.nextThink = 0.35 + Math.random() * 0.4;
      this.think(world, player, pDist, pdx, pdz);
    }

    let speed = SPEED_WANDER;
    if (this.mood === "flee") speed = SPEED_FLEE;
    else if (this.mood === "tease") speed = SPEED_TEASE;
    else if (this.mood === "eat") speed = SPEED_WANDER * 0.45;
    else if (this.mood === "steal") speed = SPEED_TEASE * 0.85;

    const tdx = this.targetX - this.x;
    const tdz = this.targetZ - this.z;
    const tDist = Math.hypot(tdx, tdz);
    if (tDist > 0.15) {
      const desiredYaw = Math.atan2(tdx, tdz);
      let dyaw = desiredYaw - this.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      this.yaw += dyaw * Math.min(1, 6 * dt);

      const step = speed * dt;
      const nx = this.x + Math.sin(this.yaw) * step;
      const nz = this.z + Math.cos(this.yaw) * step;
      this.tryMove(world, nx, nz);
    } else if (this.mood === "wander") {
      this.pickWanderTarget();
    }

    this.snapToGround(world);

    if (this.mood === "eat" && this.eatCooldown <= 0) {
      this.tryEat(world);
    }
    if (this.mood === "steal" && this.eatCooldown <= 0) {
      this.tryStealNearPlayer(world, player);
    }
    if (this.mood === "tease" && pDist < 1.1) {
      const len = pDist || 1;
      player.vx += (pdx / len) * 2.5;
      player.vz += (pdz / len) * 2.5;
      this.mood = "flee";
      this.stateT = 1.2;
      this.targetX = this.x - (pdx / len) * 6;
      this.targetZ = this.z - (pdz / len) * 6;
    }

    this.syncMesh();
  }

  private think(
    world: World,
    player: Player,
    pDist: number,
    pdx: number,
    pdz: number,
  ): void {
    if (this.mood === "flee" && this.stateT > 0) return;

    if (pDist < PLAYER_FLEE && this.hp < 3) {
      this.mood = "flee";
      this.stateT = 1.5;
      const len = pDist || 1;
      this.targetX = this.x - (pdx / len) * 8;
      this.targetZ = this.z - (pdz / len) * 8;
      return;
    }

    const food = this.findFood(world);
    if (food && Math.random() < 0.55) {
      this.mood = "eat";
      this.targetX = food.x + 0.5;
      this.targetZ = food.z + 0.5;
      this.stateT = 2.5;
      return;
    }

    if (pDist < PLAYER_NOTICE && pDist > 2 && Math.random() < 0.25) {
      this.mood = "tease";
      this.targetX = player.x + (Math.random() - 0.5) * 2;
      this.targetZ = player.z + (Math.random() - 0.5) * 2;
      this.stateT = 2;
      return;
    }

    if (pDist < 8 && Math.random() < 0.2) {
      this.mood = "steal";
      this.targetX = player.x + (Math.random() - 0.5) * 4;
      this.targetZ = player.z + (Math.random() - 0.5) * 4;
      this.stateT = 3;
      return;
    }

    this.mood = "wander";
    if (Math.random() < 0.4) this.pickWanderTarget();
  }

  private findFood(world: World): { x: number; y: number; z: number } | null {
    const bx = Math.floor(this.x);
    const bz = Math.floor(this.z);
    let best: { x: number; y: number; z: number } | null = null;
    let bestD = 999;
    for (let dz = -4; dz <= 4; dz++) {
      for (let dx = -4; dx <= 4; dx++) {
        const wx = bx + dx;
        const wz = bz + dz;
        const sy = world.getSurfaceY(wx, wz) - 1;
        const id = world.getBlock(wx, sy, wz);
        if (id === Block.LEAVES || id === Block.GRASS || id === Block.WOOD) {
          const d = dx * dx + dz * dz;
          if (d < bestD) {
            bestD = d;
            best = { x: wx, y: sy, z: wz };
          }
        }
        for (let y = sy; y < sy + 6; y++) {
          if (world.getBlock(wx, y, wz) === Block.LEAVES) {
            const d = dx * dx + dz * dz;
            if (d < bestD) {
              bestD = d;
              best = { x: wx, y, z: wz };
            }
            break;
          }
        }
      }
    }
    return best;
  }

  private tryEat(world: World): void {
    const bx = Math.floor(this.x);
    const bz = Math.floor(this.z);
    for (let dy = 0; dy <= 3; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const wx = bx + dx;
          const wz = bz + dz;
          const wy = Math.floor(this.y) + dy;
          const id = world.getBlock(wx, wy, wz);
          if (
            id === Block.LEAVES ||
            id === Block.GRASS ||
            id === Block.WOOD ||
            id === Block.PLANKS
          ) {
            if (id === Block.GRASS) {
              world.setBlock(wx, wy, wz, Block.DIRT);
            } else {
              world.setBlock(wx, wy, wz, Block.AIR);
              if (Math.random() < 0.35) {
                const gy = world.getSurfaceY(wx, wz);
                if (world.getBlock(wx, gy, wz) === Block.AIR) {
                  world.setBlock(wx, gy, wz, Block.DIRT);
                }
              }
            }
            this.eatCooldown = 0.9 + Math.random() * 0.5;
            this.wiggle = 0;
            return;
          }
        }
      }
    }
    if (this.stateT <= 0) {
      this.mood = "wander";
      this.pickWanderTarget();
    }
  }

  private tryStealNearPlayer(world: World, player: Player): void {
    const bx = Math.floor(player.x);
    const bz = Math.floor(player.z);
    for (let dz = -3; dz <= 3; dz++) {
      for (let dx = -3; dx <= 3; dx++) {
        const wx = bx + dx;
        const wz = bz + dz;
        for (let y = Math.floor(player.y); y <= Math.floor(player.y) + 3; y++) {
          const id = world.getBlock(wx, y, wz);
          if (
            id === Block.COBBLE ||
            id === Block.PLANKS ||
            id === Block.STONE ||
            id === Block.SAND
          ) {
            world.setBlock(wx, y, wz, Block.AIR);
            this.eatCooldown = 1.2;
            const tx = Math.floor(this.x + (Math.random() - 0.5) * 2);
            const tz = Math.floor(this.z + (Math.random() - 0.5) * 2);
            const ty = world.getSurfaceY(tx, tz);
            if (world.getBlock(tx, ty, tz) === Block.AIR) {
              world.setBlock(tx, ty, tz, Math.random() < 0.5 ? Block.DIRT : Block.SAND);
            }
            this.mood = "flee";
            this.stateT = 2;
            this.targetX = this.x + (this.x - player.x) * 0.5 - 4;
            this.targetZ = this.z + (this.z - player.z) * 0.5 - 4;
            return;
          }
        }
      }
    }
  }

  private tryMove(world: World, nx: number, nz: number): void {
    const feetY = this.y + 0.05;
    if (!isSolid(world.getBlock(Math.floor(nx), Math.floor(feetY), Math.floor(this.z)))) {
      this.x = nx;
    } else {
      this.pickWanderTarget();
    }
    if (!isSolid(world.getBlock(Math.floor(this.x), Math.floor(feetY), Math.floor(nz)))) {
      this.z = nz;
    } else {
      this.pickWanderTarget();
    }
    const headY = this.y + 0.35;
    if (isSolid(world.getBlock(Math.floor(this.x), Math.floor(headY), Math.floor(this.z)))) {
      this.x -= Math.sin(this.yaw) * 0.1;
      this.z -= Math.cos(this.yaw) * 0.1;
      this.pickWanderTarget();
    }
  }

  private snapToGround(world: World): void {
    const sy = world.getSurfaceY(Math.floor(this.x), Math.floor(this.z));
    this.y += (sy - this.y) * 0.35;
    if (Math.abs(this.y - sy) < 0.05) this.y = sy;
  }

  private syncMesh(): void {
    const hop = Math.abs(Math.sin(this.bob)) * 0.04;
    // Mesh origin = body center; shadow uses the same x/z
    this.mesh.position.set(this.x, this.y + hop, this.z);
    this.mesh.rotation.y = this.yaw;
    const body = this.mesh.getObjectByName("body");
    if (body) {
      body.rotation.y = Math.sin(this.wiggle) * 0.1;
      body.position.x = Math.sin(this.wiggle * 1.3) * 0.02;
    }
    const s = this.hurtFlash > 0 ? 1 + Math.sin(this.hurtFlash * 40) * 0.1 : 1;
    this.mesh.scale.setScalar(s);

    // Blob centered on entity (body mid), slight oval along facing — not shifted to head
    updateEntityShadow(
      this.shadow,
      this.x,
      this.y,
      this.z,
      SHADOW_RADIUS,
      hop / 0.04,
      this.yaw,
      1.15, // length (along body) — stays ≤ ~1 block
      0.95, // width
    );
  }

  dispose(): void {
    disposeEntityShadow(this.shadow);
  }
}

export class CaterpillarSystem {
  readonly group = new THREE.Group();
  private mats: CaterpillarMaterials;
  private list: NaughtyCaterpillar[] = [];
  private spawnTimer = 2;
  private killed = 0;

  constructor() {
    this.mats = createCaterpillarMaterials();
  }

  get count(): number {
    return this.list.filter((c) => c.alive).length;
  }

  get stats(): { alive: number; banished: number } {
    return { alive: this.count, banished: this.killed };
  }

  distanceToNearest(px: number, py: number, pz: number): number {
    let best = Infinity;
    for (const c of this.list) {
      if (!c.alive) continue;
      const d = Math.hypot(c.x - px, c.y - py, c.z - pz);
      if (d < best) best = d;
    }
    return best;
  }

  seedAround(world: World, cx: number, cz: number, n: number): void {
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + Math.random();
      const dist = 6 + Math.random() * 14;
      this.spawnAt(world, cx + Math.cos(ang) * dist, cz + Math.sin(ang) * dist);
    }
  }

  spawnAt(world: World, x: number, z: number): NaughtyCaterpillar | null {
    if (this.count >= MAX_ALIVE) return null;
    const y = world.getSurfaceY(Math.floor(x), Math.floor(z));
    const c = new NaughtyCaterpillar(x, y, z, this.mats);
    this.list.push(c);
    this.group.add(c.mesh);
    this.group.add(c.shadow);
    return c;
  }

  update(dt: number, world: World, player: Player): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i]!;
      if (!c.alive) {
        this.group.remove(c.mesh);
        this.group.remove(c.shadow);
        c.dispose();
        this.list.splice(i, 1);
        continue;
      }
      c.update(dt, world, player);
      const d = Math.hypot(c.x - player.x, c.z - player.z);
      if (d > 48) {
        this.group.remove(c.mesh);
        this.group.remove(c.shadow);
        c.dispose();
        this.list.splice(i, 1);
      }
    }

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = RESPAWN_INTERVAL + Math.random() * 4;
      if (this.count < 8) {
        const ang = Math.random() * Math.PI * 2;
        const dist = 12 + Math.random() * 16;
        this.spawnAt(
          world,
          player.x + Math.cos(ang) * dist,
          player.z + Math.sin(ang) * dist,
        );
      }
    }
  }

  tryPunch(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxDist: number,
  ): "hurt" | "dead" | null {
    let bestT = maxDist;
    let best: NaughtyCaterpillar | null = null;
    for (const c of this.list) {
      const t = c.rayHit(ox, oy, oz, dx, dy, dz, maxDist);
      if (t !== null && t < bestT) {
        bestT = t;
        best = c;
      }
    }
    if (!best) return null;
    const result = best.hit(ox, oz);
    if (result === "dead") this.killed++;
    return result === "miss" ? null : result;
  }

  dispose(): void {
    for (const c of this.list) {
      this.group.remove(c.mesh);
      this.group.remove(c.shadow);
      c.dispose();
    }
    this.list = [];
    disposeCaterpillarMaterials(this.mats);
    disposeEntityShadowShared();
  }
}
