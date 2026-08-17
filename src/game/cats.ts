import * as THREE from "three";
import type { World } from "./world";
import type { Player } from "./player";
import { warpMobIfNeeded, type PortalSystem } from "./portals";
import {
  createEntityShadow,
  disposeEntityShadow,
  updateEntityShadow,
} from "./entityShadow";
import {
  applyEntityGravity,
  moveEntityXZ,
  type EntityBox,
} from "./entityCollision";
import { applyEntitySwim, findShore, sampleEntityWater } from "./entityWater";
import type { MobPunch } from "./loot";
import {
  createHurtOverlay,
  tickHurtOverlay,
  disposeHurtOverlay,
  knockbackImpulse,
  integrateKnockback,
  HURT_FLASH,
  beginDeath,
  applyDeathPose,
  DEATH_DUR,
  type DeathAnim,
} from "./entityHitFx";
import { Block, isWater } from "./blocks";
import { Item, type ItemId } from "./items";

export type CatCoat =
  | "tabby"
  | "orange"
  | "black"
  | "tuxedo"
  | "gray"
  | "siamese"
  | "calico";

type CatState =
  | "loaf"
  | "sit"
  | "stretch"
  | "wander"
  | "zoomies"
  | "curious"
  | "follow"
  | "hunt"
  | "pounce"
  | "flee"
  | "hiss"
  | "chest"
  | "sleep"
  | "gift";

export type CatSense = {
  findPrey: (
    x: number,
    z: number,
    r: number,
  ) => { x: number; y: number; z: number; scare: () => void } | null;
  findHostile: (
    x: number,
    z: number,
    r: number,
  ) => { x: number; y: number; z: number } | null;
  batDrop: (
    x: number,
    y: number,
    z: number,
    r: number,
    vx: number,
    vz: number,
  ) => boolean;
  spawnGift: (id: ItemId, x: number, y: number, z: number) => void;
  dayFactor: number;
  holdingTreat: boolean;
};

const MAX_ALIVE = 7;
const HIT_RANGE = 2.6;
const TREATS = new Set<number>([
  Item.RAW_RABBIT,
  Item.RAW_CHICKEN,
  Item.RAW_PORK,
  Item.RAW_BEEF,
  Item.RAW_MUTTON,
  Item.STRING,
]);

const COATS: Record<
  CatCoat,
  { body: number; mark: number; belly: number; eye: number }
> = {
  tabby: { body: 0xc48a3a, mark: 0x6a3e18, belly: 0xe8c898, eye: 0x7ecf4a },
  orange: { body: 0xe09030, mark: 0xb05814, belly: 0xf4d0a0, eye: 0x5aa8e0 },
  black: { body: 0x1a1a1e, mark: 0x0c0c10, belly: 0x2a2a32, eye: 0xe8c44a },
  tuxedo: { body: 0x1c1c22, mark: 0x101014, belly: 0xf2f0ea, eye: 0x7ecf4a },
  gray: { body: 0x8a8a92, mark: 0x5a5a64, belly: 0xd4d4da, eye: 0xb8d86a },
  siamese: { body: 0xe8d8c0, mark: 0x3a2a22, belly: 0xf6eee4, eye: 0x48a0d8 },
  calico: { body: 0xf0d8b0, mark: 0xc04028, belly: 0x1c1c22, eye: 0xe8c44a },
};

const COAT_LIST = Object.keys(COATS) as CatCoat[];

const geoBox = new THREE.BoxGeometry(1, 1, 1);

function mat(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

function addEyes(head: THREE.Group, x: number, y: number, z: number, s: number, iris: number): void {
  const white = mat(0xf4f4f2);
  const dark = mat(0x121214);
  const col = mat(iris);
  for (const side of [-1, 1]) {
    const e = new THREE.Group();
    e.name = side < 0 ? "eyeL" : "eyeR";
    e.position.set(side * x, y, z);
    const w = new THREE.Mesh(geoBox, white);
    w.scale.set(s, s * 1.05, s * 0.35);
    e.add(w);
    const i = new THREE.Mesh(geoBox, col);
    i.scale.set(s * 0.55, s * 0.85, s * 0.4);
    i.position.z = 0.02;
    e.add(i);
    const p = new THREE.Mesh(geoBox, dark);
    p.scale.set(s * 0.22, s * 0.7, s * 0.42);
    p.position.z = 0.035;
    e.add(p);
    const lid = new THREE.Mesh(geoBox, mat(0x2a2a30));
    lid.name = "lid";
    lid.scale.set(s * 1.05, s * 0.08, s * 0.45);
    lid.position.y = s * 0.55;
    lid.visible = false;
    e.add(lid);
    head.add(e);
  }
}

function buildCat(coat: CatCoat): THREE.Group {
  const c = COATS[coat];
  const bodyM = mat(c.body);
  const markM = mat(c.mark);
  const bellyM = mat(c.belly);
  const g = new THREE.Group();

  const body = new THREE.Mesh(geoBox, bodyM);
  body.name = "body";
  body.scale.set(0.34, 0.26, 0.52);
  body.position.y = 0.28;
  g.add(body);
  const belly = new THREE.Mesh(geoBox, bellyM);
  belly.scale.set(0.22, 0.12, 0.36);
  belly.position.set(0, 0.18, 0.02);
  g.add(belly);
  const stripe = new THREE.Mesh(geoBox, markM);
  stripe.scale.set(0.36, 0.08, 0.18);
  stripe.position.set(0, 0.4, -0.04);
  g.add(stripe);

  const head = new THREE.Group();
  head.name = "head";
  head.position.set(0, 0.4, 0.28);
  const skull = new THREE.Mesh(geoBox, bodyM);
  skull.scale.set(0.3, 0.26, 0.28);
  head.add(skull);
  const muzzle = new THREE.Mesh(geoBox, bellyM);
  muzzle.scale.set(0.16, 0.1, 0.12);
  muzzle.position.set(0, -0.06, 0.16);
  head.add(muzzle);
  const nose = new THREE.Mesh(geoBox, mat(0xd08090));
  nose.scale.set(0.05, 0.04, 0.04);
  nose.position.set(0, -0.03, 0.23);
  head.add(nose);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(geoBox, bodyM);
    ear.scale.set(0.1, 0.14, 0.06);
    ear.position.set(s * 0.12, 0.18, -0.02);
    ear.rotation.z = s * -0.25;
    head.add(ear);
    const inner = new THREE.Mesh(geoBox, mat(0xe8a0a8));
    inner.scale.set(0.05, 0.08, 0.04);
    inner.position.set(s * 0.12, 0.17, 0.01);
    head.add(inner);
  }
  addEyes(head, 0.08, 0.04, 0.14, 0.07, c.eye);
  g.add(head);

  const tail = new THREE.Group();
  tail.name = "tail";
  tail.position.set(0, 0.34, -0.26);
  let parent: THREE.Object3D = tail;
  for (let i = 0; i < 3; i++) {
    const seg = new THREE.Mesh(geoBox, i === 2 ? markM : bodyM);
    seg.name = `tail${i}`;
    seg.scale.set(0.07, 0.07, 0.16);
    seg.position.set(0, 0.02, -0.12);
    parent.add(seg);
    parent = seg;
  }
  g.add(tail);

  const addLeg = (name: string, x: number, z: number) => {
    const leg = new THREE.Mesh(geoBox, markM);
    leg.name = name;
    leg.scale.set(0.08, 0.2, 0.08);
    leg.position.set(x, 0.1, z);
    g.add(leg);
  };
  addLeg("legFL", -0.1, 0.16);
  addLeg("legFR", 0.1, 0.16);
  addLeg("legBL", -0.1, -0.16);
  addLeg("legBR", 0.1, -0.16);

  return g;
}

export function isCatTreat(id: ItemId | null | undefined): boolean {
  return !!id && TREATS.has(id);
}

class Cat {
  readonly coat: CatCoat;
  readonly mesh: THREE.Group;
  readonly shadow: THREE.Mesh;
  x: number;
  y: number;
  z: number;
  vy = 0;
  onGround = true;
  yaw = Math.random() * Math.PI * 2;
  portalCd = 0;
  hp = 5;
  alive = true;
  friend = false;
  dying: DeathAnim | null = null;
  private state: CatState = "wander";
  private stateT = 1;
  private targetX = 0;
  private targetZ = 0;
  private bob = Math.random() * Math.PI * 2;
  private hopCooldown = 0;
  private climbHopT = 0;
  private climbDx = 0;
  private climbDz = 0;
  private stuckT = 0;
  private inWater = false;
  private kbX = 0;
  private kbZ = 0;
  private hurtFlash = 0;
  private hurtOverlay: THREE.Mesh;
  private blinkWait = 1 + Math.random() * 4;
  private blinkT = -1;
  private headYaw = 0;
  private tailPhase = Math.random() * Math.PI * 2;
  private pose = 0;
  private giftCd = 40 + Math.random() * 50;
  private batCd = 4;
  private huntCd = 6;
  private meowCd = 0;
  private headObj: THREE.Object3D | null = null;
  private tailObj: THREE.Object3D | null = null;
  private lastMeow = false;

  constructor(coat: CatCoat, x: number, y: number, z: number) {
    this.coat = coat;
    this.x = x;
    this.y = y;
    this.z = z;
    this.mesh = buildCat(coat);
    this.shadow = createEntityShadow(0.22);
    this.headObj = this.mesh.getObjectByName("head");
    this.tailObj = this.mesh.getObjectByName("tail");
    this.hurtOverlay = createHurtOverlay(0.5, 0.55, 0.55, 0.28);
    this.mesh.add(this.hurtOverlay);
    this.pickLoafOrWander();
  }

  get justMeowed(): boolean {
    const v = this.lastMeow;
    this.lastMeow = false;
    return v;
  }

  private pickLoafOrWander(): void {
    if (Math.random() < 0.45) {
      this.state = Math.random() < 0.55 ? "loaf" : "sit";
      this.stateT = 3 + Math.random() * 8;
    } else {
      this.state = "wander";
      this.stateT = 2 + Math.random() * 5;
      this.randTarget(4);
    }
  }

  private randTarget(span: number): void {
    const a = Math.random() * Math.PI * 2;
    const d = 1.5 + Math.random() * span;
    this.targetX = this.x + Math.cos(a) * d;
    this.targetZ = this.z + Math.sin(a) * d;
  }

  feed(): boolean {
    if (!this.alive) return false;
    this.friend = true;
    this.state = "curious";
    this.stateT = 2.5;
    this.lastMeow = true;
    this.meowCd = 2;
    this.giftCd = Math.min(this.giftCd, 12);
    return true;
  }

  hit(fromX: number, fromZ: number, damage: number): "hurt" | "dead" | "miss" {
    if (!this.alive || this.dying) return "miss";
    this.hp -= damage;
    this.hurtFlash = HURT_FLASH;
    this.state = "flee";
    this.stateT = 3;
    const kb = knockbackImpulse(this.x, this.z, fromX, fromZ, 11);
    this.kbX = kb.kbX;
    this.kbZ = kb.kbZ;
    this.vy = Math.max(this.vy, kb.vy);
    this.onGround = false;
    const dx = this.x - fromX;
    const dz = this.z - fromZ;
    const len = Math.hypot(dx, dz) || 1;
    this.targetX = this.x + (dx / len) * 14;
    this.targetZ = this.z + (dz / len) * 14;
    if (this.hp <= 0) {
      this.alive = false;
      this.dying = beginDeath(fromX, fromZ, this.x, this.z);
      return "dead";
    }
    this.lastMeow = true;
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
    const cy = this.y + 0.28;
    const r = 0.32;
    const ocx = ox - this.x;
    const ocy = oy - cy;
    const ocz = oz - this.z;
    const b = ocx * dx + ocy * dy + ocz * dz;
    const c = ocx * ocx + ocy * ocy + ocz * ocz - r * r;
    const disc = b * b - c;
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc);
    if (t < 0 || t > maxDist) return null;
    return t;
  }

  private bodyBox(): EntityBox {
    return { x: this.x, y: this.y, z: this.z, halfW: 0.2, height: 0.48 };
  }

  private waterAhead(world: World, dist = 1.4): boolean {
    const x = Math.floor(this.x + Math.sin(this.yaw) * dist);
    const z = Math.floor(this.z + Math.cos(this.yaw) * dist);
    const y = Math.floor(this.y + 0.1);
    return isWater(world.getBlock(x, y, z)) || isWater(world.getBlock(x, y - 1, z));
  }

  update(dt: number, world: World, player: Player, sense: CatSense): void {
    if (!this.alive) return;
    this.stateT -= dt;
    this.bob += dt * (this.state === "zoomies" ? 14 : 7);
    this.tailPhase += dt * (this.state === "zoomies" ? 16 : 5);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    this.hopCooldown = Math.max(0, this.hopCooldown - dt);
    this.climbHopT = Math.max(0, this.climbHopT - dt);
    this.giftCd = Math.max(0, this.giftCd - dt);
    this.batCd = Math.max(0, this.batCd - dt);
    this.huntCd = Math.max(0, this.huntCd - dt);
    this.meowCd = Math.max(0, this.meowCd - dt);

    const pdx = player.x - this.x;
    const pdz = player.z - this.z;
    const pDist = Math.hypot(pdx, pdz);
    const pYaw = Math.atan2(pdx, pdz);
    const night = sense.dayFactor < 0.35;
    const dusk = sense.dayFactor > 0.3 && sense.dayFactor < 0.55;

    const wet = sampleEntityWater(world, this.bodyBox());
    this.inWater = wet.submerged || wet.inWater;
    if (this.inWater && this.state !== "flee") {
      this.state = "flee";
      this.stateT = 3;
      const shore = findShore(world, this.x, this.z, this.y, 16);
      if (shore) {
        this.targetX = shore.x;
        this.targetZ = shore.z;
      }
    }

    const hostile = sense.findHostile(this.x, this.z, 9);
    if (hostile && this.state !== "flee" && this.state !== "hiss" && this.state !== "pounce") {
      this.state = "hiss";
      this.stateT = 1.4 + Math.random();
      this.targetX = hostile.x;
      this.targetZ = hostile.z;
      if (this.meowCd <= 0) {
        this.lastMeow = true;
        this.meowCd = 3;
      }
    }

    this.think(dt, world, player, sense, pDist, pdx, pdz, night, dusk);
    this.move(dt, world, pDist, pYaw);
    this.animate(dt, pDist, pYaw, night);
    tickHurtOverlay(this.hurtOverlay, this.hurtFlash);
    this.mesh.position.set(this.x, this.y, this.z);
    this.mesh.rotation.y = this.yaw;
    updateEntityShadow(this.shadow, world, this.x, this.y, this.z, 0.22, 0, this.yaw);
  }

  private think(
    dt: number,
    world: World,
    player: Player,
    sense: CatSense,
    pDist: number,
    pdx: number,
    pdz: number,
    night: boolean,
    dusk: boolean,
  ): void {
    if (this.state === "flee" || this.state === "pounce" || this.state === "hiss") {
      if (this.stateT > 0) return;
    }

    if (this.waterAhead(world) && this.state !== "flee" && this.state !== "chest") {
      this.yaw += (Math.random() > 0.5 ? 1 : -1) * (0.8 + Math.random());
      this.randTarget(3);
      this.state = "wander";
      this.stateT = 1.5;
    }

    if (
      this.batCd <= 0 &&
      (this.state === "wander" || this.state === "curious") &&
      sense.batDrop(this.x, this.y + 0.3, this.z, 1.1, Math.sin(this.yaw) * 3.2, Math.cos(this.yaw) * 3.2)
    ) {
      this.batCd = 5 + Math.random() * 8;
      this.state = "sit";
      this.stateT = 1.2;
    }

    if (
      this.huntCd <= 0 &&
      this.state !== "flee" &&
      this.state !== "sleep" &&
      this.state !== "chest"
    ) {
      const prey = sense.findPrey(this.x, this.z, 10);
      if (prey) {
        this.state = "hunt";
        this.stateT = 4;
        this.targetX = prey.x;
        this.targetZ = prey.z;
        this.huntCd = 14 + Math.random() * 10;
      }
    }

    if (this.friend && this.giftCd <= 0 && pDist < 5 && this.onGround) {
      this.state = "gift";
      this.stateT = 2;
      this.targetX = player.x;
      this.targetZ = player.z;
      this.giftCd = 55 + Math.random() * 40;
    }

    if (this.state === "hunt") {
      const prey = sense.findPrey(this.x, this.z, 11);
      if (prey) {
        this.targetX = prey.x;
        this.targetZ = prey.z;
        if (Math.hypot(prey.x - this.x, prey.z - this.z) < 1.35) {
          this.state = "pounce";
          this.stateT = 0.55;
          this.vy = 8.2;
          this.onGround = false;
          this.y += 0.05;
          prey.scare();
          this.lastMeow = true;
        }
      } else if (this.stateT <= 0) {
        this.pickLoafOrWander();
      }
      return;
    }

    if (this.state === "pounce") {
      if (this.stateT <= 0) this.pickLoafOrWander();
      return;
    }

    if (this.state === "hiss") {
      if (this.stateT <= 0) {
        this.state = "flee";
        this.stateT = 2;
        const hx = this.targetX - this.x;
        const hz = this.targetZ - this.z;
        const len = Math.hypot(hx, hz) || 1;
        this.targetX = this.x - (hx / len) * 8;
        this.targetZ = this.z - (hz / len) * 8;
      }
      return;
    }

    if (this.state === "gift") {
      this.targetX = player.x;
      this.targetZ = player.z;
      if (pDist < 1.8 || this.stateT <= 0) {
        const gift = Math.random() < 0.5 ? Item.STRING : Item.FEATHER;
        sense.spawnGift(gift, this.x, this.y + 0.3, this.z);
        this.state = "sit";
        this.stateT = 2;
        this.lastMeow = true;
      }
      return;
    }

    if (this.state === "follow" || (this.friend && pDist > 7 && this.state !== "flee")) {
      this.state = "follow";
      this.targetX = player.x - (pdx / (pDist || 1)) * 2.4;
      this.targetZ = player.z - (pdz / (pDist || 1)) * 2.4;
      if (pDist < 2.6) {
        this.state = Math.random() < 0.5 ? "sit" : "loaf";
        this.stateT = 2 + Math.random() * 4;
      }
      return;
    }

    if (sense.holdingTreat && pDist < 9 && this.state !== "flee") {
      this.state = "curious";
      this.targetX = player.x;
      this.targetZ = player.z;
      this.stateT = 2;
    }

    if (this.state === "curious") {
      this.targetX = player.x;
      this.targetZ = player.z;
      if (pDist < 1.7) {
        this.state = "sit";
        this.stateT = 2 + Math.random() * 3;
        if (this.meowCd <= 0) {
          this.lastMeow = true;
          this.meowCd = 5;
        }
      }
      if (this.stateT <= 0 && pDist > 3) this.pickLoafOrWander();
      return;
    }

    if (this.state === "chest") {
      if (Math.hypot(this.targetX - this.x, this.targetZ - this.z) < 0.45) {
        this.state = night ? "sleep" : "sit";
        this.stateT = 6 + Math.random() * 8;
      } else if (this.stateT <= 0) this.pickLoafOrWander();
      return;
    }

    if (this.stateT > 0) return;

    if (night && Math.random() < 0.4) {
      this.state = "sleep";
      this.stateT = 8 + Math.random() * 14;
      return;
    }
    if (dusk && Math.random() < 0.35) {
      this.state = "zoomies";
      this.stateT = 2 + Math.random() * 2.5;
      this.randTarget(8);
      return;
    }
    if (Math.random() < 0.12) {
      this.state = "zoomies";
      this.stateT = 1.6 + Math.random() * 2;
      this.randTarget(9);
      return;
    }
    if (Math.random() < 0.18) {
      const chests = world.chestsNear(this.x, this.y, this.z, 10);
      if (chests.length > 0) {
        const ch = chests[(Math.random() * chests.length) | 0]!;
        this.state = "chest";
        this.stateT = 8;
        this.targetX = ch.x + 0.5;
        this.targetZ = ch.z + 0.5;
        return;
      }
    }
    if (this.state === "sit" || this.state === "loaf" || this.state === "sleep") {
      this.state = "stretch";
      this.stateT = 0.85;
      return;
    }
    if (pDist < 6 && Math.random() < 0.28) {
      this.state = "curious";
      this.stateT = 3;
      return;
    }
    this.pickLoafOrWander();
  }

  private move(dt: number, world: World, _pDist: number, _pYaw: number): void {
    const parked =
      this.state === "sit" ||
      this.state === "loaf" ||
      this.state === "sleep" ||
      this.state === "stretch" ||
      this.state === "hiss";
    const box = this.bodyBox();

    if (this.inWater) {
      let wx = this.targetX - this.x;
      let wz = this.targetZ - this.z;
      if (Math.hypot(wx, wz) > 0.05) {
        this.yaw = Math.atan2(wx, wz);
      }
      const r = applyEntitySwim(world, box, this.vy, dt, wx, wz, 2.1);
      this.vy = r.vy;
      this.onGround = r.onGround;
      this.x = box.x;
      this.y = box.y;
      this.z = box.z;
    } else if (!parked) {
      const tx = this.targetX - this.x;
      const tz = this.targetZ - this.z;
      const dist = Math.hypot(tx, tz);
      if (dist > 0.18) {
        const desired = Math.atan2(tx, tz);
        let dyaw = desired - this.yaw;
        while (dyaw > Math.PI) dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        const turn = this.state === "zoomies" ? 10 : 6;
        this.yaw += dyaw * Math.min(1, turn * dt);
        const speed =
          this.state === "zoomies"
            ? 5.4
            : this.state === "pounce"
              ? 4.6
              : this.state === "flee"
                ? 3.8
                : this.state === "hunt"
                  ? 1.15
                  : 1.55;
        let step = speed * dt;
        if (this.climbHopT > 0 && !this.onGround) step = Math.max(step, 3.4 * dt);
        let dx = Math.sin(this.yaw) * step;
        let dz = Math.cos(this.yaw) * step;
        const { blocked, canStep } = moveEntityXZ(world, box, dx, dz, 1.15);
        this.x = box.x;
        this.y = box.y;
        this.z = box.z;
        if (blocked && canStep && this.onGround && this.hopCooldown <= 0) {
          this.vy = 10.6;
          this.hopCooldown = 0.3;
          this.climbHopT = 0.7;
          this.y += 0.05;
          this.onGround = false;
        } else if (blocked) {
          this.stuckT += dt;
          if (this.stuckT > 0.55) {
            this.stuckT = 0;
            this.yaw += (Math.random() - 0.5) * 1.8;
            this.randTarget(3);
          }
        } else this.stuckT = 0;
      }
    }

    if (!this.inWater) {
      const gbox = this.bodyBox();
      const g = applyEntityGravity(world, gbox, this.vy, dt, 28, 40);
      this.vy = g.vy;
      this.onGround = g.onGround;
      this.x = gbox.x;
      this.y = gbox.y;
      this.z = gbox.z;
    }

    const kbox = this.bodyBox();
    const kb = integrateKnockback(world, kbox, this.kbX, this.kbZ, dt, this.onGround);
    this.x = kbox.x;
    this.y = kbox.y;
    this.z = kbox.z;
    this.kbX = kb.kbX;
    this.kbZ = kb.kbZ;
    void dt;
  }

  private animate(dt: number, pDist: number, pYaw: number, night: boolean): void {
    let wantPose = 0;
    if (this.state === "loaf") wantPose = 1;
    else if (this.state === "sit") wantPose = 0.7;
    else if (this.state === "sleep") wantPose = 1.15;
    else if (this.state === "stretch") wantPose = -0.7;
    else if (this.state === "hiss") wantPose = -0.35;
    this.pose += (wantPose - this.pose) * Math.min(1, 8 * dt);

    const body = this.mesh.getObjectByName("body");
    if (body) {
      body.rotation.x = this.pose * 0.35;
      body.position.y = 0.28 - Math.max(0, this.pose) * 0.08;
    }
    const crouch = Math.max(0, this.pose);
    for (const n of ["legFL", "legFR", "legBL", "legBR"]) {
      const leg = this.mesh.getObjectByName(n);
      if (!leg) continue;
      leg.scale.y = 0.2 * (1 - crouch * 0.45);
      const walk =
        this.state === "sit" || this.state === "loaf" || this.state === "sleep"
          ? 0
          : Math.sin(this.bob + (n.endsWith("L") ? 0 : Math.PI)) * 0.35;
      leg.rotation.x = walk * (this.state === "zoomies" ? 1.4 : 0.8);
    }

    if (this.tailObj) {
      const wag =
        this.state === "hiss"
          ? Math.sin(this.tailPhase * 3) * 0.9
          : this.state === "sleep"
            ? 0.08
            : Math.sin(this.tailPhase) * 0.45;
      this.tailObj.rotation.y = wag;
      this.tailObj.rotation.x = this.state === "hiss" ? 0.8 : 0.25 + this.pose * 0.2;
    }

    let targetHead = 0;
    if (
      (this.state === "curious" || this.state === "sit" || this.state === "follow") &&
      pDist < 8
    ) {
      let rel = pYaw - this.yaw;
      while (rel > Math.PI) rel -= Math.PI * 2;
      while (rel < -Math.PI) rel += Math.PI * 2;
      targetHead = Math.max(-0.9, Math.min(0.9, rel));
    }
    this.headYaw += (targetHead - this.headYaw) * Math.min(1, 6 * dt);
    if (this.headObj) {
      this.headObj.rotation.y = this.headYaw;
      this.headObj.rotation.x = this.state === "sleep" ? 0.35 : this.state === "stretch" ? -0.25 : 0;
    }

    this.blinkWait -= dt;
    if (this.blinkT < 0 && this.blinkWait <= 0) {
      this.blinkT = 0;
      this.blinkWait = this.state === "sleep" ? 0.2 : 2 + Math.random() * 5;
    }
    let lidOn = this.state === "sleep";
    if (this.blinkT >= 0) {
      this.blinkT += dt * (this.state === "sleep" ? 2 : 8);
      lidOn = this.blinkT < 1;
      if (this.blinkT >= 1) this.blinkT = -1;
    }
    for (const name of ["eyeL", "eyeR"]) {
      const e = this.mesh.getObjectByName(name);
      const lid = e?.getObjectByName("lid");
      if (lid) lid.visible = lidOn;
    }
    void night;
  }

  tickCorpse(dt: number, world: World): boolean {
    if (!this.dying) return false;
    applyDeathPose(this.mesh, this.dying);
    updateEntityShadow(
      this.shadow,
      world,
      this.x,
      this.y,
      this.z,
      0.26,
      0,
      this.yaw,
    );
    this.dying.t -= dt;
    return this.dying.t <= 0;
  }

  dispose(): void {
    disposeHurtOverlay(this.hurtOverlay);
    disposeEntityShadow(this.shadow);
    this.mesh.clear();
  }
}

export class CatSystem {
  readonly group = new THREE.Group();
  private list: Cat[] = [];
  private spawnTimer = 8;
  private deaths: { x: number; y: number; z: number }[] = [];

  get count(): number {
    return this.list.filter((c) => c.alive).length;
  }

  seedAround(world: World, cx: number, cz: number, n: number): void {
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = 10 + Math.random() * 18;
      this.spawnAt(world, cx + Math.cos(ang) * dist, cz + Math.sin(ang) * dist);
    }
  }

  spawnAt(world: World, x: number, z: number): Cat | null {
    if (this.count >= MAX_ALIVE) return null;
    const y = world.getSurfaceY(Math.floor(x), Math.floor(z));
    if (y < 50) return null;
    if (world.getBlock(Math.floor(x), y - 1, Math.floor(z)) === Block.WATER) return null;
    const coat = COAT_LIST[(Math.random() * COAT_LIST.length) | 0]!;
    const c = new Cat(coat, x, y, z);
    this.list.push(c);
    this.group.add(c.mesh);
    this.group.add(c.shadow);
    return c;
  }

  update(
    dt: number,
    world: World,
    player: Player,
    sense: CatSense,
    portals?: PortalSystem | null,
  ): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i]!;
      if (!c.alive) {
        if (c.dying && !c.tickCorpse(dt, world)) continue;
        if (c.dying) {
          this.deaths.push({ x: c.x, y: c.y + 0.2, z: c.z });
        }
        this.group.remove(c.mesh);
        this.group.remove(c.shadow);
        c.dispose();
        this.list.splice(i, 1);
        continue;
      }
      const px = c.x;
      const py = c.y;
      const pz = c.z;
      c.update(dt, world, player, sense);
      if (c.portalCd > 0) c.portalCd -= dt;
      if (portals && warpMobIfNeeded(portals, world, c, px, py, pz)) {
        c.mesh.position.set(c.x, c.y, c.z);
      }
      const d = portals
        ? portals.shortPathDist(world, c.x, c.z, player.x, player.z)
        : Math.hypot(c.x - player.x, c.z - player.z);
      if (d > 80 && c.portalCd <= 0 && !c.friend) {
        this.group.remove(c.mesh);
        this.group.remove(c.shadow);
        c.dispose();
        this.list.splice(i, 1);
      }
    }

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 14 + Math.random() * 10;
      if (this.count < MAX_ALIVE - 1) {
        const ang = Math.random() * Math.PI * 2;
        const dist = 16 + Math.random() * 22;
        this.spawnAt(world, player.x + Math.cos(ang) * dist, player.z + Math.sin(ang) * dist);
      }
    }
  }

  tryFeed(player: Player, itemId: ItemId): boolean {
    if (!isCatTreat(itemId)) return false;
    let best: Cat | null = null;
    let bestD = 2.8;
    for (const c of this.list) {
      if (!c.alive) continue;
      const d = Math.hypot(c.x - player.x, c.z - player.z, c.y - player.y);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best ? best.feed() : false;
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
    let bestT = Math.min(maxDist, HIT_RANGE);
    let best: Cat | null = null;
    for (const c of this.list) {
      const t = c.rayHit(ox, oy, oz, dx, dy, dz, bestT);
      if (t !== null && t < bestT) {
        bestT = t;
        best = c;
      }
    }
    if (!best) return null;
    const result = best.hit(ox, oz, damage);
    if (result === "miss") return null;
    return { outcome: result, kind: "cat", x: best.x, y: best.y, z: best.z };
  }

  consumeDeaths(): { x: number; y: number; z: number }[] {
    const out = this.deaths;
    this.deaths = [];
    return out;
  }

  consumeMeows(): boolean {
    let any = false;
    for (const c of this.list) if (c.justMeowed) any = true;
    return any;
  }

  dispose(): void {
    for (const c of this.list) {
      this.group.remove(c.mesh);
      this.group.remove(c.shadow);
      c.dispose();
    }
    this.list = [];
  }
}
