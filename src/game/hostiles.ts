import * as THREE from "three";
import type { World } from "./world";
import type { Player } from "./player";
import {
  createEntityShadow,
  disposeEntityShadow,
  updateEntityShadow,
} from "./entityShadow";
import {
  applyEntityGravity,
  moveEntityXZ,
  unstickEntity,
  type EntityBox,
} from "./entityCollision";
import {
  applyEntitySwim,
  columnHasWaterSurface,
  findShore,
  sampleEntityWater,
} from "./entityWater";
import type { MobPunch } from "./loot";
import {
  createHurtOverlay,
  tickHurtOverlay,
  disposeHurtOverlay,
  knockbackImpulse,
  integrateKnockback,
  HURT_FLASH,
} from "./entityHitFx";

/**
 * Night hostiles — the main danger loop.
 * - shambler: common zombie-like
 * - crawler: fast low croucher
 * - slender: rare tall stalker (teleport-ish close)
 * Burn / flee when the sun is high; spawn only at night outdoors.
 */

export type HostileKind = "shambler" | "crawler" | "slender";

type KindDef = {
  kind: HostileKind;
  hp: number;
  speed: number;
  chaseSpeed: number;
  damage: number;
  attackCd: number;
  halfW: number;
  height: number;
  eyeY: number;
  notice: number;
  attackRange: number;
  shadowR: number;
  /** Relative spawn weight at night */
  weight: number;
  /** 0..1 — only spawn if random < rarity (slender rare) */
  rarity: number;
};

const KINDS: KindDef[] = [
  {
    kind: "shambler",
    hp: 14,
    speed: 1.15,
    chaseSpeed: 2.05,
    damage: 3,
    attackCd: 1.15,
    halfW: 0.32,
    height: 1.75,
    eyeY: 1.55,
    notice: 18,
    attackRange: 1.35,
    shadowR: 0.4,
    weight: 1.2,
    rarity: 1,
  },
  {
    kind: "crawler",
    hp: 8,
    speed: 1.55,
    chaseSpeed: 3.1,
    damage: 2,
    attackCd: 0.75,
    halfW: 0.34,
    height: 0.72,
    eyeY: 0.45,
    notice: 14,
    attackRange: 1.15,
    shadowR: 0.42,
    weight: 0.85,
    rarity: 1,
  },
  {
    kind: "slender",
    hp: 28,
    speed: 1.35,
    chaseSpeed: 2.55,
    damage: 5,
    attackCd: 1.4,
    halfW: 0.22,
    height: 2.85,
    eyeY: 2.55,
    notice: 28,
    attackRange: 1.55,
    shadowR: 0.28,
    weight: 0.2,
    rarity: 0.22,
  },
];

const MAX_ALIVE = 10;
const MAX_SLENDER = 1;
const DESPAWN_DIST = 56;
const SPAWN_CHECK = 2.4;

type Mats = {
  shamblerBody: THREE.MeshLambertMaterial;
  shamblerHead: THREE.MeshLambertMaterial;
  crawlerBody: THREE.MeshLambertMaterial;
  crawlerEye: THREE.MeshLambertMaterial;
  slenderBody: THREE.MeshLambertMaterial;
  slenderHead: THREE.MeshLambertMaterial;
  eyeWhite: THREE.MeshLambertMaterial;
  eyeVoid: THREE.MeshLambertMaterial;
  cloth: THREE.MeshLambertMaterial;
};

function createMats(): Mats {
  return {
    shamblerBody: new THREE.MeshLambertMaterial({ color: 0x4a6b45 }),
    shamblerHead: new THREE.MeshLambertMaterial({ color: 0x6a8a5e }),
    crawlerBody: new THREE.MeshLambertMaterial({ color: 0x3d2a3a }),
    crawlerEye: new THREE.MeshLambertMaterial({
      color: 0xff4466,
      emissive: 0x440011,
    }),
    slenderBody: new THREE.MeshLambertMaterial({ color: 0x1a1a22 }),
    slenderHead: new THREE.MeshLambertMaterial({ color: 0xe8e4dc }),
    eyeWhite: new THREE.MeshLambertMaterial({ color: 0xf0f0f2 }),
    eyeVoid: new THREE.MeshLambertMaterial({ color: 0x0a0a0c }),
    cloth: new THREE.MeshLambertMaterial({ color: 0x121218 }),
  };
}

const geoBox = new THREE.BoxGeometry(1, 1, 1);
const geoSphere = new THREE.SphereGeometry(1, 8, 6);

function buildHostileMesh(kind: HostileKind, mats: Mats): THREE.Group {
  const root = new THREE.Group();
  if (kind === "shambler") {
    const torso = new THREE.Mesh(geoBox, mats.shamblerBody);
    torso.scale.set(0.55, 0.85, 0.32);
    torso.position.y = 1.05;
    root.add(torso);
    const head = new THREE.Mesh(geoBox, mats.shamblerHead);
    head.scale.set(0.42, 0.42, 0.42);
    head.position.y = 1.65;
    root.add(head);
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(geoBox, mats.shamblerBody);
      arm.scale.set(0.18, 0.7, 0.18);
      arm.position.set(side * 0.38, 1.05, 0);
      arm.rotation.z = side * 0.15;
      root.add(arm);
      const leg = new THREE.Mesh(geoBox, mats.shamblerBody);
      leg.scale.set(0.2, 0.65, 0.2);
      leg.position.set(side * 0.14, 0.35, 0);
      root.add(leg);
      const eye = new THREE.Mesh(geoSphere, mats.eyeVoid);
      eye.scale.setScalar(0.06);
      eye.position.set(side * 0.1, 1.7, 0.2);
      root.add(eye);
    }
  } else if (kind === "crawler") {
    const body = new THREE.Mesh(geoBox, mats.crawlerBody);
    body.scale.set(0.7, 0.28, 0.85);
    body.position.y = 0.28;
    root.add(body);
    const head = new THREE.Mesh(geoBox, mats.crawlerBody);
    head.scale.set(0.35, 0.28, 0.4);
    head.position.set(0, 0.35, 0.45);
    root.add(head);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(geoSphere, mats.crawlerEye);
      eye.scale.setScalar(0.07);
      eye.position.set(side * 0.12, 0.42, 0.62);
      root.add(eye);
      for (let i = 0; i < 3; i++) {
        const leg = new THREE.Mesh(geoBox, mats.crawlerBody);
        leg.scale.set(0.08, 0.22, 0.08);
        leg.position.set(side * 0.38, 0.12, -0.25 + i * 0.25);
        leg.rotation.z = side * 0.5;
        root.add(leg);
      }
    }
  } else {
    // Slender — tall, thin, featureless face
    const torso = new THREE.Mesh(geoBox, mats.cloth);
    torso.scale.set(0.32, 1.5, 0.22);
    torso.position.y = 1.4;
    root.add(torso);
    const head = new THREE.Mesh(geoBox, mats.slenderHead);
    head.scale.set(0.28, 0.42, 0.28);
    head.position.y = 2.45;
    root.add(head);
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(geoBox, mats.cloth);
      arm.scale.set(0.1, 1.35, 0.1);
      arm.position.set(side * 0.28, 1.35, 0);
      root.add(arm);
      const leg = new THREE.Mesh(geoBox, mats.cloth);
      leg.scale.set(0.12, 0.95, 0.12);
      leg.position.set(side * 0.1, 0.48, 0);
      root.add(leg);
      // Empty sockets
      const socket = new THREE.Mesh(geoSphere, mats.eyeVoid);
      socket.scale.set(0.05, 0.04, 0.02);
      socket.position.set(side * 0.07, 2.5, 0.14);
      root.add(socket);
    }
  }
  return root;
}

class Hostile {
  readonly kind: HostileKind;
  readonly def: KindDef;
  readonly mesh: THREE.Group;
  readonly shadow: THREE.Mesh;
  x: number;
  y: number;
  z: number;
  yaw = 0;
  vy = 0;
  onGround = false;
  hp: number;
  alive = true;
  attackCd = 0;
  hurtFlash = 0;
  climbHopT = 0;
  climbDx = 0;
  climbDz = 0;
  hopCooldown = 0;
  age = 0;
  private shoreX = 0;
  private shoreZ = 0;
  private shoreT = 0;
  private inWater = false;
  private kbX = 0;
  private kbZ = 0;
  private hurtOverlay: THREE.Mesh;
  /** Slender: occasional lunge / reappear */
  abilityCd = 3 + Math.random() * 4;
  private walkPhase = Math.random() * 10;

  constructor(kind: HostileKind, x: number, y: number, z: number, mats: Mats) {
    this.kind = kind;
    this.def = KINDS.find((k) => k.kind === kind)!;
    this.x = x;
    this.y = y;
    this.z = z;
    this.hp = this.def.hp;
    this.mesh = buildHostileMesh(kind, mats);
    this.mesh.position.set(x, y, z);
    this.shadow = createEntityShadow();
    this.hurtOverlay = createHurtOverlay(
      this.def.halfW * 2,
      this.def.height,
      this.def.halfW * 2,
      this.def.height * 0.5,
    );
    this.mesh.add(this.hurtOverlay);
  }

  hit(fromX: number, fromZ: number, damage: number): "hurt" | "dead" | "miss" {
    if (!this.alive) return "miss";
    this.hp -= damage;
    this.hurtFlash = HURT_FLASH;
    const kb = knockbackImpulse(this.x, this.z, fromX, fromZ, 11.5);
    this.kbX = kb.kbX;
    this.kbZ = kb.kbZ;
    this.vy = Math.max(this.vy, kb.vy);
    this.onGround = false;
    if (this.hp <= 0) {
      this.alive = false;
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
    const cy = this.y + this.def.height * 0.5;
    const r =
      this.kind === "slender" ? 0.5 : this.kind === "crawler" ? 0.55 : 0.55;
    const a = dx * dx + dy * dy + dz * dz;
    if (a < 1e-8) return null;
    const bb = 2 * (dx * (ox - this.x) + dy * (oy - cy) + dz * (oz - this.z));
    const cc =
      (ox - this.x) ** 2 + (oy - cy) ** 2 + (oz - this.z) ** 2 - r * r;
    const disc = bb * bb - 4 * a * cc;
    if (disc < 0) return null;
    const t0 = (-bb - Math.sqrt(disc)) / (2 * a);
    if (t0 >= 0 && t0 <= maxDist) return t0;
    const t1 = (-bb + Math.sqrt(disc)) / (2 * a);
    if (t1 >= 0 && t1 <= maxDist) return t1;
    return null;
  }

  update(
    dt: number,
    world: World,
    player: Player,
    dayFactor: number,
  ): { damage: number } | null {
    if (!this.alive) return null;
    this.age += dt;
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    this.hopCooldown = Math.max(0, this.hopCooldown - dt);
    this.climbHopT = Math.max(0, this.climbHopT - dt);
    this.abilityCd = Math.max(0, this.abilityCd - dt);
    this.walkPhase += dt * (this.kind === "crawler" ? 10 : 7);

    // Daylight burn / flee
    const sunKill = dayFactor > 0.55;
    if (sunKill) {
      // Take sun damage when open sky-ish (always for now)
      this.hp -= dt * (this.kind === "slender" ? 4 : 6);
      if (this.hp <= 0) {
        this.alive = false;
        return null;
      }
    }

    const pdx = player.x - this.x;
    const pdz = player.z - this.z;
    const pDist = Math.hypot(pdx, pdz);
    const pdy = player.y - this.y;

    // Day: wander away; night: hunt
    let tx = this.x;
    let tz = this.z;
    let speed = this.def.speed;

    if (sunKill) {
      // Flee from player / random
      const len = pDist || 1;
      tx = this.x - (pdx / len) * 10;
      tz = this.z - (pdz / len) * 10;
      speed = this.def.chaseSpeed * 0.85;
    } else if (pDist < this.def.notice) {
      tx = player.x;
      tz = player.z;
      speed = this.def.chaseSpeed;
      // Slender: rare blink closer when far but noticed
      if (
        this.kind === "slender" &&
        this.abilityCd <= 0 &&
        pDist > 8 &&
        pDist < 22 &&
        Math.random() < 0.35
      ) {
        const ang = Math.atan2(pdx, pdz) + (Math.random() - 0.5) * 0.6;
        const dist = 4 + Math.random() * 3;
        const nx = player.x - Math.sin(ang) * dist;
        const nz = player.z - Math.cos(ang) * dist;
        const ny = world.getSurfaceY(Math.floor(nx), Math.floor(nz));
        if (ny > 2 && !this.wouldCollide(world, nx, ny, nz)) {
          this.x = nx;
          this.y = ny;
          this.z = nz;
          this.abilityCd = 6 + Math.random() * 5;
        } else {
          this.abilityCd = 2;
        }
      }
    } else {
      // Idle pace
      tx = this.x + Math.sin(this.age * 0.3 + this.walkPhase) * 4;
      tz = this.z + Math.cos(this.age * 0.25) * 4;
      speed = this.def.speed * 0.45;
    }

    const wetBox: EntityBox = {
      x: this.x,
      y: this.y,
      z: this.z,
      halfW: this.def.halfW,
      height: this.def.height,
    };
    this.inWater = sampleEntityWater(world, wetBox).any;
    if (this.hurtFlash > 0.18) {
      speed *= 0.12;
    }
    if (this.inWater) {
      this.shoreT -= dt;
      if (this.shoreT <= 0) {
        this.shoreT = 0.4 + Math.random() * 0.3;
        const shore = findShore(world, this.x, this.z, this.y, 14);
        if (shore) {
          this.shoreX = shore.x;
          this.shoreZ = shore.z;
        }
      }
      if (this.shoreX || this.shoreZ) {
        tx = this.shoreX;
        tz = this.shoreZ;
      }
      const wx = tx - this.x;
      const wz = tz - this.z;
      if (Math.hypot(wx, wz) > 0.08) {
        const desired = Math.atan2(wx, wz);
        let dyaw = desired - this.yaw;
        while (dyaw > Math.PI) dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        this.yaw += dyaw * Math.min(1, 5 * dt);
      }
      const r = applyEntitySwim(world, wetBox, this.vy, dt, wx, wz, 1.7);
      this.vy = r.vy;
      this.onGround = r.onGround;
      this.x = wetBox.x;
      this.y = wetBox.y;
      this.z = wetBox.z;
      if (r.hopped) {
        this.hopCooldown = 0.4;
        this.climbHopT = 0.55;
        this.climbDx = Math.sin(this.yaw);
        this.climbDz = Math.cos(this.yaw);
      }
    } else {

    const tdx = tx - this.x;
    const tdz = tz - this.z;
    const tDist = Math.hypot(tdx, tdz);
    if (tDist > 0.12) {
      const desired = Math.atan2(tdx, tdz);
      let dyaw = desired - this.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      this.yaw += dyaw * Math.min(1, 5 * dt);

      const climbing = this.climbHopT > 0;
      const airMul = this.onGround ? 1 : climbing ? 1.35 : 0.45;
      let step = speed * dt * airMul;
      if (climbing && !this.onGround) step = Math.max(step, 3.5 * dt);
      let mx = Math.sin(this.yaw) * step;
      let mz = Math.cos(this.yaw) * step;
      if (climbing && (this.climbDx || this.climbDz)) {
        const cl = Math.hypot(this.climbDx, this.climbDz) || 1;
        const boost = 2.6 * dt;
        mx += (this.climbDx / cl) * boost;
        mz += (this.climbDz / cl) * boost;
      }
      this.tryMove(world, mx, mz);
    }

    // Gravity
    {
      const box: EntityBox = {
        x: this.x,
        y: this.y,
        z: this.z,
        halfW: this.def.halfW,
        height: this.def.height,
      };
      const g = applyEntityGravity(world, box, this.vy, dt, 28, 42);
      this.vy = g.vy;
      this.onGround = g.onGround;
      this.x = box.x;
      this.y = box.y;
      this.z = box.z;
      unstickEntity(world, box);
      this.x = box.x;
      this.y = box.y;
      this.z = box.z;
    }
    }

    {
      const box: EntityBox = {
        x: this.x,
        y: this.y,
        z: this.z,
        halfW: this.def.halfW,
        height: this.def.height,
      };
      const kb = integrateKnockback(
        world,
        box,
        this.kbX,
        this.kbZ,
        dt,
        this.onGround,
      );
      this.x = box.x;
      this.y = box.y;
      this.z = box.z;
      this.kbX = kb.kbX;
      this.kbZ = kb.kbZ;
    }

    // Melee
    let hit: { damage: number } | null = null;
    if (
      !sunKill &&
      this.attackCd <= 0 &&
      pDist < this.def.attackRange &&
      Math.abs(pdy) < this.def.height + 0.4
    ) {
      this.attackCd = this.def.attackCd;
      hit = { damage: this.def.damage };
    }

    this.syncMesh();
    return hit;
  }

  private wouldCollide(
    world: World,
    x: number,
    y: number,
    z: number,
  ): boolean {
    const box: EntityBox = {
      x,
      y,
      z,
      halfW: this.def.halfW,
      height: this.def.height,
    };
    // cheap: feet + head
    void box;
    const sy = world.getSurfaceY(Math.floor(x), Math.floor(z));
    return Math.abs(sy - y) > 2.5;
  }

  private tryMove(world: World, mx: number, mz: number): void {
    const box: EntityBox = {
      x: this.x,
      y: this.y,
      z: this.z,
      halfW: this.def.halfW,
      height: this.def.height,
    };
    const r = moveEntityXZ(world, box, mx, mz, 1.05);
    this.x = box.x;
    this.y = box.y;
    this.z = box.z;
    if (r.blocked && r.canStep && this.onGround && this.hopCooldown <= 0) {
      this.vy = 9.6;
      this.climbHopT = 0.7;
      this.climbDx = mx;
      this.climbDz = mz;
      this.hopCooldown = 0.45;
    }
  }

  private syncMesh(): void {
    this.mesh.position.set(this.x, this.y, this.z);
    this.mesh.rotation.y = this.yaw;
    // Walk bob
    const bob = this.onGround
      ? Math.sin(this.walkPhase) * 0.03
      : 0;
    this.mesh.position.y = this.y + bob;
    // Hurt flash
    const s = this.hurtFlash > 0 ? 1 + this.hurtFlash * 0.22 : 1;
    this.mesh.scale.setScalar(s);
    tickHurtOverlay(this.hurtOverlay, this.hurtFlash);
    updateEntityShadow(
      this.shadow,
      this.x,
      this.y,
      this.z,
      this.def.shadowR,
      0,
      this.yaw,
      this.kind === "slender" ? 0.7 : 1.1,
      this.kind === "slender" ? 0.55 : 0.95,
    );
  }

  dispose(): void {
    disposeHurtOverlay(this.hurtOverlay);
    disposeEntityShadow(this.shadow);
  }
}

export class HostileSystem {
  readonly group = new THREE.Group();
  private mats: Mats;
  private list: Hostile[] = [];
  private spawnTimer = 3;
  private killed = 0;
  private lastDayFactor = 1;

  constructor() {
    this.mats = createMats();
  }

  get count(): number {
    return this.list.filter((h) => h.alive).length;
  }

  get slenderCount(): number {
    return this.list.filter((h) => h.alive && h.kind === "slender").length;
  }

  get stats(): { alive: number; killed: number; slender: number } {
    return {
      alive: this.count,
      killed: this.killed,
      slender: this.slenderCount,
    };
  }

  anyNear(x: number, z: number, r: number): boolean {
    const r2 = r * r;
    for (const h of this.list) {
      if (!h.alive) continue;
      const dx = h.x - x;
      const dz = h.z - z;
      if (dx * dx + dz * dz <= r2) return true;
    }
    return false;
  }

  update(
    dt: number,
    world: World,
    player: Player,
    dayFactor: number,
  ): { damage: number; kind: HostileKind }[] {
    this.lastDayFactor = dayFactor;
    const hits: { damage: number; kind: HostileKind }[] = [];

    for (let i = this.list.length - 1; i >= 0; i--) {
      const h = this.list[i]!;
      if (!h.alive) {
        this.group.remove(h.mesh);
        this.group.remove(h.shadow);
        h.dispose();
        this.list.splice(i, 1);
        continue;
      }
      const d = Math.hypot(h.x - player.x, h.z - player.z);
      if (d > DESPAWN_DIST) {
        this.group.remove(h.mesh);
        this.group.remove(h.shadow);
        h.dispose();
        this.list.splice(i, 1);
        continue;
      }
      const hit = h.update(dt, world, player, dayFactor);
      if (hit) hits.push({ damage: hit.damage, kind: h.kind });
    }

    // Night spawning
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = SPAWN_CHECK + Math.random() * 1.5;
      if (dayFactor < 0.35 && this.count < MAX_ALIVE) {
        // Stronger pressure deeper into night
        const night = 1 - dayFactor;
        const rolls = night > 0.85 ? 2 : 1;
        for (let r = 0; r < rolls; r++) {
          if (this.count >= MAX_ALIVE) break;
          this.trySpawnNear(world, player, dayFactor);
        }
      } else if (dayFactor > 0.7) {
        // Daytime: slowly cull remaining hostiles far away
        for (let i = this.list.length - 1; i >= 0; i--) {
          const h = this.list[i]!;
          const d = Math.hypot(h.x - player.x, h.z - player.z);
          if (d > 28 || h.hp < h.def.hp * 0.5) {
            h.alive = false;
          }
        }
      }
    }

    return hits;
  }

  private trySpawnNear(
    world: World,
    player: Player,
    dayFactor: number,
  ): void {
    const ang = Math.random() * Math.PI * 2;
    // Prefer behind / not in face; mid distance
    const dist = 16 + Math.random() * 14;
    const x = player.x + Math.cos(ang) * dist;
    const z = player.z + Math.sin(ang) * dist;
    const y = world.getSurfaceY(Math.floor(x), Math.floor(z));
    if (y <= 2) return;
    if (columnHasWaterSurface(world, x, z)) return;
    // Keep away from other hostiles
    for (const h of this.list) {
      if (Math.hypot(h.x - x, h.z - z) < 5) return;
    }

    const kind = this.pickKind(dayFactor);
    if (!kind) return;
    if (kind === "slender" && this.slenderCount >= MAX_SLENDER) return;

    const h = new Hostile(kind, x, y, z, this.mats);
    this.list.push(h);
    this.group.add(h.mesh);
    this.group.add(h.shadow);
  }

  private pickKind(dayFactor: number): HostileKind | null {
    // Deep night favors slender rolls
    const deepNight = dayFactor < 0.12;
    let total = 0;
    const opts: { def: KindDef; w: number }[] = [];
    for (const def of KINDS) {
      if (def.kind === "slender") {
        if (!deepNight && Math.random() > def.rarity * 0.5) continue;
        if (deepNight && Math.random() > def.rarity * 1.4) continue;
        if (this.slenderCount >= MAX_SLENDER) continue;
      }
      const w = def.weight * (def.kind === "slender" && deepNight ? 1.8 : 1);
      opts.push({ def, w });
      total += w;
    }
    if (total <= 0) return null;
    let r = Math.random() * total;
    for (const o of opts) {
      r -= o.w;
      if (r <= 0) return o.def.kind;
    }
    return opts[opts.length - 1]!.def.kind;
  }

  tryPunch(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxDist: number,
    damage = 1,
  ): MobPunch | null {
    let bestT = maxDist;
    let best: Hostile | null = null;
    for (const h of this.list) {
      const t = h.rayHit(ox, oy, oz, dx, dy, dz, maxDist);
      if (t !== null && t < bestT) {
        bestT = t;
        best = h;
      }
    }
    if (!best) return null;
    const r = best.hit(ox, oz, damage);
    if (r === "miss") return null;
    if (r === "dead") this.killed++;
    return { outcome: r, kind: best.kind, x: best.x, y: best.y, z: best.z };
  }

  dispose(): void {
    for (const h of this.list) {
      this.group.remove(h.mesh);
      this.group.remove(h.shadow);
      h.dispose();
    }
    this.list = [];
    for (const m of Object.values(this.mats)) m.dispose();
  }
}
