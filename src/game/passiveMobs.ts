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

export type PassiveKind = "pig" | "cow" | "sheep" | "chicken" | "rabbit";

const MAX_ALIVE = 28;
const RESPAWN_INTERVAL = 10;
const HIT_RANGE = 2.8;

type KindDef = {
  kind: PassiveKind;
  speed: number;
  fleeSpeed: number;
  hp: number;
  shadowR: number;
  scale: number;
  notice: number;
  weight: number;
  /** Collision half-width at scale 1 */
  halfW: number;
  /** Collision height at scale 1 */
  height: number;
};

const KINDS: KindDef[] = [
  {
    kind: "pig",
    speed: 1.35,
    fleeSpeed: 3.2,
    hp: 6,
    shadowR: 0.38,
    scale: 1,
    notice: 7,
    weight: 1.1,
    halfW: 0.38,
    height: 0.75,
  },
  {
    kind: "cow",
    speed: 1.15,
    fleeSpeed: 2.6,
    hp: 10,
    shadowR: 0.48,
    scale: 1.15,
    notice: 8,
    weight: 1,
    halfW: 0.42,
    height: 1.15,
  },
  {
    kind: "sheep",
    speed: 1.25,
    fleeSpeed: 2.9,
    hp: 6,
    shadowR: 0.4,
    scale: 1,
    notice: 7,
    weight: 1,
    halfW: 0.38,
    height: 0.95,
  },
  {
    kind: "chicken",
    speed: 1.6,
    fleeSpeed: 3.6,
    hp: 3,
    shadowR: 0.22,
    scale: 0.7,
    notice: 5,
    weight: 1.2,
    halfW: 0.22,
    height: 0.55,
  },
  {
    kind: "rabbit",
    speed: 2.0,
    fleeSpeed: 4.2,
    hp: 3,
    shadowR: 0.2,
    scale: 0.55,
    notice: 9,
    weight: 0.85,
    halfW: 0.2,
    height: 0.4,
  },
];

const geoBox = new THREE.BoxGeometry(1, 1, 1);
const geoSphere = new THREE.SphereGeometry(0.5, 8, 6);

function mat(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

function buildPig(): THREE.Group {
  const g = new THREE.Group();
  const bodyM = mat(0xf0a0b0);
  const dark = mat(0xd08090);
  const body = new THREE.Mesh(geoBox, bodyM);
  body.scale.set(0.7, 0.55, 0.95);
  body.position.y = 0.45;
  g.add(body);
  const head = new THREE.Mesh(geoBox, bodyM);
  head.scale.set(0.4, 0.38, 0.35);
  head.position.set(0, 0.5, 0.55);
  g.add(head);
  const snout = new THREE.Mesh(geoBox, dark);
  snout.scale.set(0.22, 0.16, 0.12);
  snout.position.set(0, 0.42, 0.75);
  g.add(snout);
  addLegs(g, 0.18, 0.32, 0.28, 0.32, dark);
  addEyes(g, 0.12, 0.58, 0.68, 0.06);
  return g;
}

function buildCow(): THREE.Group {
  const g = new THREE.Group();
  const bodyM = mat(0x4a3428);
  const spots = mat(0xe8e0d4);
  const headM = mat(0x5a4030);
  const body = new THREE.Mesh(geoBox, bodyM);
  body.scale.set(0.75, 0.7, 1.15);
  body.position.y = 0.7;
  g.add(body);
  const spot = new THREE.Mesh(geoBox, spots);
  spot.scale.set(0.35, 0.35, 0.4);
  spot.position.set(0.22, 0.85, 0.1);
  g.add(spot);
  const head = new THREE.Mesh(geoBox, headM);
  head.scale.set(0.42, 0.4, 0.38);
  head.position.set(0, 0.85, 0.72);
  g.add(head);
  // horns
  for (const s of [-1, 1]) {
    const h = new THREE.Mesh(geoBox, mat(0xf0e8d8));
    h.scale.set(0.08, 0.18, 0.08);
    h.position.set(s * 0.18, 1.12, 0.72);
    g.add(h);
  }
  // udder
  const ud = new THREE.Mesh(geoSphere, mat(0xf2c8c8));
  ud.scale.set(0.22, 0.16, 0.22);
  ud.position.set(0, 0.35, -0.15);
  g.add(ud);
  addLegs(g, 0.16, 0.45, 0.32, 0.4, bodyM);
  addEyes(g, 0.14, 0.92, 0.88, 0.055);
  return g;
}

function buildSheep(): THREE.Group {
  const g = new THREE.Group();
  const wool = mat(0xf2f0ea);
  const face = mat(0x2a2a2e);
  const body = new THREE.Mesh(geoBox, wool);
  body.scale.set(0.72, 0.65, 0.95);
  body.position.y = 0.55;
  g.add(body);
  const head = new THREE.Mesh(geoBox, face);
  head.scale.set(0.32, 0.32, 0.32);
  head.position.set(0, 0.58, 0.58);
  g.add(head);
  addLegs(g, 0.14, 0.35, 0.26, 0.32, face);
  addEyes(g, 0.1, 0.65, 0.72, 0.05);
  return g;
}

function buildChicken(): THREE.Group {
  const g = new THREE.Group();
  const bodyM = mat(0xf0f0f0);
  const comb = mat(0xd03030);
  const beak = mat(0xf0a020);
  const body = new THREE.Mesh(geoBox, bodyM);
  body.scale.set(0.38, 0.35, 0.48);
  body.position.y = 0.38;
  g.add(body);
  const head = new THREE.Mesh(geoBox, bodyM);
  head.scale.set(0.22, 0.24, 0.22);
  head.position.set(0, 0.55, 0.28);
  g.add(head);
  const c = new THREE.Mesh(geoBox, comb);
  c.scale.set(0.06, 0.1, 0.12);
  c.position.set(0, 0.72, 0.28);
  g.add(c);
  const b = new THREE.Mesh(geoBox, beak);
  b.scale.set(0.08, 0.06, 0.12);
  b.position.set(0, 0.52, 0.42);
  g.add(b);
  // wings
  for (const s of [-1, 1]) {
    const w = new THREE.Mesh(geoBox, mat(0xe0e0e0));
    w.scale.set(0.08, 0.22, 0.28);
    w.position.set(s * 0.22, 0.4, 0);
    g.add(w);
  }
  // thin legs
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(geoBox, mat(0xf0a020));
    leg.scale.set(0.05, 0.22, 0.05);
    leg.position.set(s * 0.08, 0.12, 0);
    g.add(leg);
  }
  addEyes(g, 0.07, 0.6, 0.36, 0.04);
  return g;
}

function buildRabbit(): THREE.Group {
  const g = new THREE.Group();
  const fur = mat(0xc8a878);
  const belly = mat(0xe8d8c0);
  const body = new THREE.Mesh(geoBox, fur);
  body.scale.set(0.32, 0.3, 0.42);
  body.position.y = 0.28;
  g.add(body);
  const head = new THREE.Mesh(geoBox, fur);
  head.scale.set(0.24, 0.22, 0.24);
  head.position.set(0, 0.4, 0.26);
  g.add(head);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(geoBox, fur);
    ear.scale.set(0.07, 0.28, 0.06);
    ear.position.set(s * 0.08, 0.62, 0.22);
    g.add(ear);
  }
  const tail = new THREE.Mesh(geoSphere, belly);
  tail.scale.setScalar(0.12);
  tail.position.set(0, 0.3, -0.24);
  g.add(tail);
  addLegs(g, 0.08, 0.14, 0.1, 0.12, fur);
  addEyes(g, 0.08, 0.45, 0.36, 0.035);
  return g;
}

function addLegs(
  g: THREE.Group,
  w: number,
  h: number,
  x: number,
  z: number,
  m: THREE.Material,
): void {
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(geoBox, m);
      leg.scale.set(w, h, w);
      leg.position.set(sx * x, h * 0.5, sz * z);
      g.add(leg);
    }
  }
}

function addEyes(
  g: THREE.Group,
  x: number,
  y: number,
  z: number,
  s: number,
): void {
  const eyeM = mat(0x1a1a1e);
  for (const side of [-1, 1]) {
    const e = new THREE.Mesh(geoBox, eyeM);
    e.scale.setScalar(s);
    e.position.set(side * x, y, z);
    g.add(e);
  }
}

function buildMesh(kind: PassiveKind): THREE.Group {
  switch (kind) {
    case "pig":
      return buildPig();
    case "cow":
      return buildCow();
    case "sheep":
      return buildSheep();
    case "chicken":
      return buildChicken();
    case "rabbit":
      return buildRabbit();
  }
}

function pickKind(rng: number): KindDef {
  let t = 0;
  for (const k of KINDS) t += k.weight;
  let r = rng * t;
  for (const k of KINDS) {
    r -= k.weight;
    if (r <= 0) return k;
  }
  return KINDS[0]!;
}

class PassiveMob {
  readonly kind: PassiveKind;
  readonly def: KindDef;
  readonly mesh: THREE.Group;
  readonly shadow: THREE.Mesh;
  x: number;
  y: number;
  z: number;
  vy = 0;
  onGround = true;
  yaw = Math.random() * Math.PI * 2;
  hp: number;
  alive = true;
  private targetX = 0;
  private targetZ = 0;
  private state: "wander" | "idle" | "flee" = "wander";
  private stateT = 0;
  private bob = Math.random() * Math.PI * 2;
  private hop = 0;
  private hurtFlash = 0;
  private stuckT = 0;
  private hopCooldown = 0;
  /** Forward push while airborne after a climb hop */
  private climbHopT = 0;

  constructor(kindDef: KindDef, x: number, y: number, z: number) {
    this.def = kindDef;
    this.kind = kindDef.kind;
    this.hp = kindDef.hp;
    this.x = x;
    this.y = y;
    this.z = z;
    this.mesh = buildMesh(kindDef.kind);
    this.mesh.scale.setScalar(kindDef.scale);
    this.shadow = createEntityShadow(kindDef.shadowR);
    this.pickWander();
  }

  private pickWander(): void {
    const a = Math.random() * Math.PI * 2;
    const d = 2 + Math.random() * 7;
    this.targetX = this.x + Math.cos(a) * d;
    this.targetZ = this.z + Math.sin(a) * d;
    this.state = Math.random() < 0.35 ? "idle" : "wander";
    this.stateT = this.state === "idle" ? 1.5 + Math.random() * 3 : 2 + Math.random() * 4;
  }

  hit(fromX: number, fromZ: number, damage: number): "hurt" | "dead" | "miss" {
    if (!this.alive) return "miss";
    this.hp -= damage;
    this.hurtFlash = 0.3;
    this.state = "flee";
    this.stateT = 2.5 + Math.random();
    const dx = this.x - fromX;
    const dz = this.z - fromZ;
    const len = Math.hypot(dx, dz) || 1;
    this.targetX = this.x + (dx / len) * 12;
    this.targetZ = this.z + (dz / len) * 12;
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
    const cy = this.y + 0.45 * this.def.scale;
    const r = 0.45 * this.def.scale;
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
    const s = this.def.scale;
    return {
      x: this.x,
      y: this.y,
      z: this.z,
      halfW: this.def.halfW * s,
      height: this.def.height * s,
    };
  }

  update(dt: number, world: World, player: Player): void {
    if (!this.alive) return;
    this.stateT -= dt;
    this.bob += dt * 6;
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    this.hopCooldown = Math.max(0, this.hopCooldown - dt);
    this.climbHopT = Math.max(0, this.climbHopT - dt);

    const pdx = player.x - this.x;
    const pdz = player.z - this.z;
    const pDist = Math.hypot(pdx, pdz);

    // Rabbits / chickens spook easily
    if (
      this.state !== "flee" &&
      pDist < this.def.notice &&
      (this.kind === "rabbit" || this.kind === "chicken") &&
      pDist < 4
    ) {
      this.state = "flee";
      this.stateT = 1.8;
      this.targetX = this.x - (pdx / (pDist || 1)) * 10;
      this.targetZ = this.z - (pdz / (pDist || 1)) * 10;
    }

    if (this.stateT <= 0) this.pickWander();

    let speed = 0;
    if (this.state === "wander") speed = this.def.speed;
    else if (this.state === "flee") speed = this.def.fleeSpeed;

    const box = this.bodyBox();
    unstickEntity(world, box);
    this.x = box.x;
    this.y = box.y;
    this.z = box.z;

    // Horizontal move — no auto step-up; hop to climb
    if (speed > 0) {
      const tdx = this.targetX - this.x;
      const tdz = this.targetZ - this.z;
      const td = Math.hypot(tdx, tdz);
      if (td < 0.4) {
        this.pickWander();
      } else {
        const desired = Math.atan2(tdx, tdz);
        let dyaw = desired - this.yaw;
        while (dyaw > Math.PI) dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        this.yaw += dyaw * Math.min(1, 6 * dt);

        // Better air control during climb hops so they land on the block
        const airMul = this.onGround ? 1 : this.climbHopT > 0 ? 0.85 : 0.35;
        const step = speed * dt * airMul;
        const dx = Math.sin(this.yaw) * step;
        const dz = Math.cos(this.yaw) * step;
        const beforeX = box.x;
        const beforeZ = box.z;
        const { blocked, canStep } = moveEntityXZ(world, box, dx, dz, 1.05);
        this.x = box.x;
        this.y = box.y;
        this.z = box.z;

        // Climb: real hop instead of teleporting onto the ledge
        if (
          blocked &&
          canStep &&
          this.onGround &&
          this.hopCooldown <= 0 &&
          this.vy <= 0.05
        ) {
          // Clear ~1 block with room to crest
          this.vy = this.kind === "rabbit" || this.kind === "chicken" ? 8.2 : 7.4;
          this.hopCooldown = 0.45;
          this.climbHopT = 0.55;
          this.onGround = false;
        }

        if (
          blocked ||
          Math.hypot(box.x - beforeX, box.z - beforeZ) < step * 0.15
        ) {
          this.stuckT += dt;
          // Only repath if we can't climb — don't give up on a hop-able ledge
          if (this.stuckT > 0.55 && !(canStep && this.hopCooldown > 0)) {
            this.stuckT = 0;
            this.pickWander();
            this.yaw += (Math.random() - 0.5) * Math.PI;
          }
        } else {
          this.stuckT = 0;
        }
      }
    }

    // Gravity / fall — never snap to surface
    {
      const gbox = this.bodyBox();
      const g = applyEntityGravity(world, gbox, this.vy, dt, 28, 40);
      this.vy = g.vy;
      this.onGround = g.onGround;
      this.x = gbox.x;
      this.y = gbox.y;
      this.z = gbox.z;
    }

    // Visual bob — real climb hop uses physics y, keep bob subtle
    if (this.kind === "rabbit" || this.kind === "chicken") {
      this.hop =
        this.onGround && this.state !== "idle"
          ? Math.abs(Math.sin(this.bob * 1.4)) * 0.06
          : 0;
    } else {
      this.hop =
        this.onGround && this.state === "wander"
          ? Math.sin(this.bob) * 0.02
          : 0;
    }

    this.mesh.position.set(this.x, this.y + this.hop, this.z);
    this.mesh.rotation.y = this.yaw;
    if (this.hurtFlash > 0) {
      this.mesh.traverse((o) => {
        if (
          o instanceof THREE.Mesh &&
          o.material instanceof THREE.MeshLambertMaterial
        ) {
          o.material.emissive.setHex(0x551111);
        }
      });
    } else {
      this.mesh.traverse((o) => {
        if (
          o instanceof THREE.Mesh &&
          o.material instanceof THREE.MeshLambertMaterial
        ) {
          o.material.emissive.setHex(0x000000);
        }
      });
    }

    updateEntityShadow(
      this.shadow,
      this.x,
      this.y,
      this.z,
      this.def.shadowR,
      this.hop > 0.05 ? 0.4 : 0,
      this.yaw,
    );
  }

  dispose(): void {
    disposeEntityShadow(this.shadow);
    // geometries are shared — only clear group
    this.mesh.clear();
  }
}

export class PassiveMobSystem {
  readonly group = new THREE.Group();
  private list: PassiveMob[] = [];
  private spawnTimer = 2;
  private killed = 0;

  get count(): number {
    return this.list.filter((m) => m.alive).length;
  }

  get stats(): { alive: number; kinds: Record<string, number> } {
    const kinds: Record<string, number> = {};
    for (const m of this.list) {
      if (!m.alive) continue;
      kinds[m.kind] = (kinds[m.kind] ?? 0) + 1;
    }
    return { alive: this.count, kinds };
  }

  seedAround(world: World, cx: number, cz: number, n: number): void {
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + Math.random();
      const dist = 8 + Math.random() * 22;
      this.spawnAt(world, cx + Math.cos(ang) * dist, cz + Math.sin(ang) * dist);
    }
  }

  spawnAt(world: World, x: number, z: number): PassiveMob | null {
    if (this.count >= MAX_ALIVE) return null;
    const def = pickKind(Math.random());
    const y = world.getSurfaceY(Math.floor(x), Math.floor(z));
    // Prefer dry land
    if (y < 49) return null; // roughly sea level 48
    const m = new PassiveMob(def, x, y, z);
    this.list.push(m);
    this.group.add(m.mesh);
    this.group.add(m.shadow);
    return m;
  }

  update(dt: number, world: World, player: Player): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const m = this.list[i]!;
      if (!m.alive) {
        this.group.remove(m.mesh);
        this.group.remove(m.shadow);
        m.dispose();
        this.list.splice(i, 1);
        continue;
      }
      m.update(dt, world, player);
      const d = Math.hypot(m.x - player.x, m.z - player.z);
      if (d > 72) {
        this.group.remove(m.mesh);
        this.group.remove(m.shadow);
        m.dispose();
        this.list.splice(i, 1);
      }
    }

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = RESPAWN_INTERVAL + Math.random() * 6;
      if (this.count < MAX_ALIVE - 4) {
        const ang = Math.random() * Math.PI * 2;
        const dist = 18 + Math.random() * 28;
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
    damage = 1,
  ): "hurt" | "dead" | null {
    let bestT = Math.min(maxDist, HIT_RANGE);
    let best: PassiveMob | null = null;
    for (const m of this.list) {
      const t = m.rayHit(ox, oy, oz, dx, dy, dz, bestT);
      if (t !== null && t < bestT) {
        bestT = t;
        best = m;
      }
    }
    if (!best) return null;
    const result = best.hit(ox, oz, damage);
    if (result === "dead") this.killed++;
    return result === "miss" ? null : result;
  }

  dispose(): void {
    for (const m of this.list) {
      this.group.remove(m.mesh);
      this.group.remove(m.shadow);
      m.dispose();
    }
    this.list = [];
  }
}
