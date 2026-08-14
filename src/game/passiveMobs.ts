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
  beginDeath,
  applyDeathPose,
  DEATH_DUR,
  type DeathAnim,
} from "./entityHitFx";

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

  const headG = new THREE.Group();
  headG.name = "head";
  headG.position.set(0, 0.5, 0.55);
  const head = new THREE.Mesh(geoBox, bodyM);
  head.scale.set(0.4, 0.38, 0.35);
  headG.add(head);
  const snout = new THREE.Mesh(geoBox, dark);
  snout.scale.set(0.22, 0.16, 0.12);
  snout.position.set(0, -0.08, 0.2);
  headG.add(snout);
  addEyes(headG, 0.11, 0.06, 0.17, 0.07);
  g.add(headG);

  addLegs(g, 0.18, 0.32, 0.28, 0.32, dark);
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

  const headG = new THREE.Group();
  headG.name = "head";
  headG.position.set(0, 0.85, 0.72);
  const head = new THREE.Mesh(geoBox, headM);
  head.scale.set(0.42, 0.4, 0.38);
  headG.add(head);
  for (const s of [-1, 1]) {
    const h = new THREE.Mesh(geoBox, mat(0xf0e8d8));
    h.scale.set(0.08, 0.18, 0.08);
    h.position.set(s * 0.18, 0.27, 0);
    headG.add(h);
  }
  addEyes(headG, 0.13, 0.05, 0.2, 0.065);
  g.add(headG);

  const ud = new THREE.Mesh(geoSphere, mat(0xf2c8c8));
  ud.scale.set(0.22, 0.16, 0.22);
  ud.position.set(0, 0.35, -0.15);
  g.add(ud);
  addLegs(g, 0.16, 0.45, 0.32, 0.4, bodyM);
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

  const headG = new THREE.Group();
  headG.name = "head";
  headG.position.set(0, 0.58, 0.58);
  const head = new THREE.Mesh(geoBox, face);
  head.scale.set(0.32, 0.32, 0.32);
  headG.add(head);
  addEyes(headG, 0.09, 0.06, 0.16, 0.055);
  g.add(headG);

  addLegs(g, 0.14, 0.35, 0.26, 0.32, face);
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

  const headG = new THREE.Group();
  headG.name = "head";
  headG.position.set(0, 0.55, 0.28);
  const head = new THREE.Mesh(geoBox, bodyM);
  head.scale.set(0.22, 0.24, 0.22);
  headG.add(head);
  const c = new THREE.Mesh(geoBox, comb);
  c.scale.set(0.06, 0.1, 0.12);
  c.position.set(0, 0.17, 0);
  headG.add(c);
  const b = new THREE.Mesh(geoBox, beak);
  b.scale.set(0.08, 0.06, 0.12);
  b.position.set(0, -0.03, 0.14);
  headG.add(b);
  addEyes(headG, 0.065, 0.03, 0.12, 0.045);
  g.add(headG);

  for (const s of [-1, 1]) {
    const w = new THREE.Mesh(geoBox, mat(0xe0e0e0));
    w.scale.set(0.08, 0.22, 0.28);
    w.position.set(s * 0.22, 0.4, 0);
    g.add(w);
  }
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(geoBox, mat(0xf0a020));
    leg.scale.set(0.05, 0.22, 0.05);
    leg.position.set(s * 0.08, 0.12, 0);
    g.add(leg);
  }
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

  const headG = new THREE.Group();
  headG.name = "head";
  headG.position.set(0, 0.4, 0.26);
  const head = new THREE.Mesh(geoBox, fur);
  head.scale.set(0.24, 0.22, 0.24);
  headG.add(head);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(geoBox, fur);
    ear.scale.set(0.07, 0.28, 0.06);
    ear.position.set(s * 0.08, 0.22, -0.04);
    headG.add(ear);
  }
  addEyes(headG, 0.07, 0.04, 0.12, 0.04);
  g.add(headG);

  const tail = new THREE.Mesh(geoSphere, belly);
  tail.scale.setScalar(0.12);
  tail.position.set(0, 0.3, -0.24);
  g.add(tail);
  addLegs(g, 0.08, 0.14, 0.1, 0.12, fur);
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
  // Minecraft-style: white sclera + dark pupil, slightly proud of the face
  const whiteM = mat(0xf5f5f8);
  const pupilM = mat(0x14141a);
  const whiteD = s * 1.15;
  const pupilD = s * 0.55;
  const zWhite = z + s * 0.35;
  const zPupil = zWhite + s * 0.28;
  for (const side of [-1, 1] as const) {
    const white = new THREE.Mesh(geoBox, whiteM);
    white.name = "eyeWhite";
    const wScale = { x: whiteD, y: whiteD * 0.85, z: whiteD * 0.35 };
    white.scale.set(wScale.x, wScale.y, wScale.z);
    white.position.set(side * x, y, zWhite);
    white.userData.baseScale = wScale;
    white.userData.isEye = true;
    g.add(white);

    const pupil = new THREE.Mesh(geoBox, pupilM);
    pupil.name = "eyePupil";
    const pScale = { x: pupilD, y: pupilD, z: pupilD * 0.4 };
    pupil.scale.set(pScale.x, pScale.y, pScale.z);
    pupil.position.set(side * (x - s * 0.08), y - s * 0.02, zPupil);
    pupil.userData.baseScale = pScale;
    pupil.userData.isEye = true;
    g.add(pupil);
  }
}

/** Apply blink: openAmount 1 = open, 0 = fully closed (squash Y). */
function setEyeOpen(mesh: THREE.Object3D, openAmount: number): void {
  mesh.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !o.userData.isEye) return;
    const base = o.userData.baseScale as { x: number; y: number; z: number };
    if (!base) return;
    const open = Math.max(0.04, Math.min(1, openAmount));
    o.scale.set(base.x, base.y * open, base.z);
    o.visible = open > 0.06;
  });
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
  dying: DeathAnim | null = null;
  private targetX = 0;
  private targetZ = 0;
  private state: "wander" | "idle" | "flee" | "look" = "wander";
  private stateT = 0;
  private bob = Math.random() * Math.PI * 2;
  private hop = 0;
  private hurtFlash = 0;
  private stuckT = 0;
  private hopCooldown = 0;
  /** Forward push while airborne after a climb hop */
  private climbHopT = 0;
  private climbDx = 0;
  private climbDz = 0;
  private shoreX = 0;
  private shoreZ = 0;
  private shoreT = 0;
  private inWater = false;
  private kbX = 0;
  private kbZ = 0;
  private hurtOverlay: THREE.Mesh;
  /** Seconds until next blink starts */
  private blinkWait = 1 + Math.random() * 3;
  /** Blink progress 0..1 while blinking; <0 when idle open */
  private blinkT = -1;
  /** Head yaw relative to body (radians) */
  private headYaw = 0;
  /** Cooldown before next curious look-at-player */
  private lookCooldown = 2 + Math.random() * 5;
  private headObj: THREE.Object3D | null = null;

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
    this.headObj = this.mesh.getObjectByName("head") ?? null;
    this.hurtOverlay = createHurtOverlay(
      (kindDef.halfW * 2) / kindDef.scale,
      kindDef.height / kindDef.scale,
      (kindDef.halfW * 2.2) / kindDef.scale,
      (kindDef.height * 0.5) / kindDef.scale,
    );
    this.mesh.add(this.hurtOverlay);
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
    if (!this.alive || this.dying) return "miss";
    this.hp -= damage;
    this.hurtFlash = HURT_FLASH;
    this.state = "flee";
    this.stateT = 2.5 + Math.random();
    const kb = knockbackImpulse(this.x, this.z, fromX, fromZ, 10.5);
    this.kbX = kb.kbX;
    this.kbZ = kb.kbZ;
    this.vy = Math.max(this.vy, kb.vy);
    this.onGround = false;
    const dx = this.x - fromX;
    const dz = this.z - fromZ;
    const len = Math.hypot(dx, dz) || 1;
    this.targetX = this.x + (dx / len) * 12;
    this.targetZ = this.z + (dz / len) * 12;
    if (this.hp <= 0) {
      this.alive = false;
      this.dying = beginDeath(fromX, fromZ, this.x, this.z);
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

  private tickSwim(dt: number, world: World, box: EntityBox): void {
    this.shoreT -= dt;
    if (this.shoreT <= 0) {
      this.shoreT = 0.45 + Math.random() * 0.25;
      const shore = findShore(world, this.x, this.z, this.y, 14);
      if (shore) {
        this.shoreX = shore.x;
        this.shoreZ = shore.z;
        this.targetX = shore.x;
        this.targetZ = shore.z;
      }
    }
    let wx = this.targetX - this.x;
    let wz = this.targetZ - this.z;
    if (Math.hypot(wx, wz) < 0.35) {
      const shore = findShore(world, this.x, this.z, this.y, 14);
      if (shore) {
        this.targetX = shore.x;
        this.targetZ = shore.z;
        wx = shore.x - this.x;
        wz = shore.z - this.z;
      }
    }
    if (Math.hypot(wx, wz) > 0.05) {
      const desired = Math.atan2(wx, wz);
      let dyaw = desired - this.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      this.yaw += dyaw * Math.min(1, 5 * dt);
    }
    const r = applyEntitySwim(world, box, this.vy, dt, wx, wz, 1.85);
    this.vy = r.vy;
    this.onGround = r.onGround;
    this.x = box.x;
    this.y = box.y;
    this.z = box.z;
    if (r.hopped) {
      this.hopCooldown = 0.4;
      this.climbHopT = 0.55;
      this.climbDx = Math.sin(this.yaw);
      this.climbDz = Math.cos(this.yaw);
    }
    if (this.state === "idle" || this.state === "look") {
      this.state = "wander";
      this.stateT = 2;
    }
  }

  update(dt: number, world: World, player: Player): void {
    if (!this.alive) return;
    this.stateT -= dt;
    this.bob += dt * 6;
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    this.hopCooldown = Math.max(0, this.hopCooldown - dt);
    this.climbHopT = Math.max(0, this.climbHopT - dt);
    this.lookCooldown = Math.max(0, this.lookCooldown - dt);

    const pdx = player.x - this.x;
    const pdz = player.z - this.z;
    const pDist = Math.hypot(pdx, pdz);
    const pYaw = Math.atan2(pdx, pdz);

    // Rabbits / chickens spook easily (breaks look)
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

    // Occasionally stop and stare at a nearby player
    if (
      this.state !== "flee" &&
      this.state !== "look" &&
      this.lookCooldown <= 0 &&
      pDist > 1.4 &&
      pDist < this.def.notice * 1.15
    ) {
      // Pigs/cows/sheep more curious; prey animals less so
      const chance =
        this.kind === "rabbit" || this.kind === "chicken" ? 0.35 : 0.7;
      if (Math.random() < chance) {
        this.state = "look";
        this.stateT =
          this.kind === "rabbit" || this.kind === "chicken"
            ? 1.2 + Math.random() * 1.8
            : 2.5 + Math.random() * 4;
        this.lookCooldown = 7 + Math.random() * 12;
      } else {
        this.lookCooldown = 2 + Math.random() * 4;
      }
    }

    // End look if player leaves or timer done
    if (this.state === "look") {
      if (pDist > this.def.notice * 1.5 || pDist < 0.9) {
        this.stateT = 0;
      }
    }

    if (this.stateT <= 0 && this.state !== "flee") this.pickWander();

    let speed = 0;
    if (this.state === "wander") speed = this.def.speed;
    else if (this.state === "flee") speed = this.def.fleeSpeed;
    if (this.hurtFlash > 0.18) speed *= 0.1;
    // idle + look → stop

    const box = this.bodyBox();
    unstickEntity(world, box);
    this.x = box.x;
    this.y = box.y;
    this.z = box.z;

    const wet = sampleEntityWater(world, box);
    this.inWater = wet.any;
    if (wet.any) {
      this.tickSwim(dt, world, box);
    } else if (speed > 0) {
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

        // Strong air control + directed push during climb hops
        const climbing = this.climbHopT > 0;
        const airMul = this.onGround ? 1 : climbing ? 1.35 : 0.4;
        let step = speed * dt * airMul;
        // Extra forward shove toward the ledge while cresting
        if (climbing && !this.onGround) {
          step = Math.max(step, 3.8 * dt);
        }
        let dx = Math.sin(this.yaw) * step;
        let dz = Math.cos(this.yaw) * step;
        if (climbing && (this.climbDx !== 0 || this.climbDz !== 0)) {
          // Bias movement into the ledge, not just along yaw
          const clen = Math.hypot(this.climbDx, this.climbDz) || 1;
          const boost = 2.6 * dt * (this.climbHopT > 0.25 ? 1.2 : 0.85);
          dx += (this.climbDx / clen) * boost;
          dz += (this.climbDz / clen) * boost;
        }
        const beforeX = box.x;
        const beforeZ = box.z;
        const { blocked, canStep } = moveEntityXZ(world, box, dx, dz, 1.15);
        this.x = box.x;
        this.y = box.y;
        this.z = box.z;

        // Climb: real hop — must clear ~1 block (v²/2g ≥ 1.15 @ g=28 → v≥8.0+)
        if (
          blocked &&
          canStep &&
          this.onGround &&
          this.hopCooldown <= 0 &&
          this.vy <= 0.05
        ) {
          // Clear 1-block ledge with margin (apex ≈ 1.6–1.9 blocks)
          this.vy =
            this.kind === "rabbit" || this.kind === "chicken" ? 11.2 : 10.4;
          this.hopCooldown = 0.35;
          this.climbHopT = 0.75;
          this.climbDx = Math.sin(this.yaw);
          this.climbDz = Math.cos(this.yaw);
          // Nudge off the ground so the first gravity step goes up cleanly
          this.y += 0.06;
          box.y = this.y;
          this.onGround = false;
        }

        if (
          blocked ||
          Math.hypot(box.x - beforeX, box.z - beforeZ) < step * 0.12
        ) {
          this.stuckT += dt;
          // Don't repath while climbing or when a hop is available
          if (
            this.stuckT > 0.7 &&
            !climbing &&
            !(canStep && this.hopCooldown <= 0.05)
          ) {
            this.stuckT = 0;
            this.pickWander();
            this.yaw += (Math.random() - 0.5) * Math.PI;
          }
        } else {
          this.stuckT = 0;
        }
      }
    }

    // Head look / ease back to center
    {
      const maxHead = 0.95; // ~54°
      let targetHead = 0;
      if (this.state === "look" && pDist > 0.5) {
        // Desired facing toward player, relative to body
        let rel = pYaw - this.yaw;
        while (rel > Math.PI) rel -= Math.PI * 2;
        while (rel < -Math.PI) rel += Math.PI * 2;
        targetHead = Math.max(-maxHead, Math.min(maxHead, rel));
        // Slow body turn so they square up a bit while watching
        this.yaw += rel * Math.min(1, 1.8 * dt);
        // Recompute head after body turned
        rel = pYaw - this.yaw;
        while (rel > Math.PI) rel -= Math.PI * 2;
        while (rel < -Math.PI) rel += Math.PI * 2;
        targetHead = Math.max(-maxHead, Math.min(maxHead, rel));
      }
      const turnRate = this.state === "look" ? 7 : 5;
      this.headYaw += (targetHead - this.headYaw) * Math.min(1, turnRate * dt);
      if (this.headObj) this.headObj.rotation.y = this.headYaw;
    }

    // Gravity / fall — never snap to surface (swim already integrated)
    if (!this.inWater) {
      const gbox = this.bodyBox();
      const g = applyEntityGravity(world, gbox, this.vy, dt, 28, 40);
      this.vy = g.vy;
      this.onGround = g.onGround;
      this.x = gbox.x;
      this.y = gbox.y;
      this.z = gbox.z;
    }

    {
      const kbox = this.bodyBox();
      const kb = integrateKnockback(
        world,
        kbox,
        this.kbX,
        this.kbZ,
        dt,
        this.onGround,
      );
      this.x = kbox.x;
      this.y = kbox.y;
      this.z = kbox.z;
      this.kbX = kb.kbX;
      this.kbZ = kb.kbZ;
    }

    // Visual bob — paddle in water, hop on land
    if (this.inWater) {
      this.hop = Math.sin(this.bob * 2.2) * 0.04;
    } else if (this.kind === "rabbit" || this.kind === "chicken") {
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

    // Blinking — quick close/open every few seconds
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const dur = 0.14;
      // 0→1→0 over `dur` seconds
      const u = Math.min(1, this.blinkT / dur);
      const close = u < 0.45 ? u / 0.45 : u < 0.55 ? 1 : 1 - (u - 0.55) / 0.45;
      setEyeOpen(this.mesh, 1 - close * 0.96);
      if (this.blinkT >= dur) {
        this.blinkT = -1;
        setEyeOpen(this.mesh, 1);
        // Occasional double-blink
        this.blinkWait =
          Math.random() < 0.18
            ? 0.12 + Math.random() * 0.15
            : 2.2 + Math.random() * 4.5;
      }
    } else {
      this.blinkWait -= dt;
      if (this.blinkWait <= 0) {
        this.blinkT = 0;
      }
    }

    tickHurtOverlay(this.hurtOverlay, this.hurtFlash);
    if (this.hurtFlash > 0) {
      this.mesh.scale.setScalar(this.def.scale * (1 + this.hurtFlash * 0.2));
    } else {
      this.mesh.scale.setScalar(this.def.scale);
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

  tickCorpse(dt: number, world: World): boolean {
    if (!this.dying) return true;
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    const box = this.bodyBox();
    const g = applyEntityGravity(world, box, this.vy, dt, 28, 42);
    this.vy = g.vy;
    this.onGround = g.onGround;
    const kb = integrateKnockback(world, box, this.kbX, this.kbZ, dt, this.onGround);
    this.x = box.x;
    this.y = box.y;
    this.z = box.z;
    this.kbX = kb.kbX;
    this.kbZ = kb.kbZ;
    const s = this.def.scale;
    applyDeathPose(
      this.mesh,
      this.x,
      this.y,
      this.z,
      this.yaw,
      this.def.height * s,
      this.dying,
      s,
    );
    tickHurtOverlay(this.hurtOverlay, this.hurtFlash);
    updateEntityShadow(
      this.shadow,
      this.x,
      this.y,
      this.z,
      this.def.shadowR * (1.05 + (1 - this.dying.t / DEATH_DUR) * 0.4),
      0,
      this.yaw,
    );
    this.dying.t -= dt;
    return this.dying.t <= 0;
  }

  dispose(): void {
    disposeHurtOverlay(this.hurtOverlay);
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
  private deaths: { x: number; y: number; z: number }[] = [];

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
        if (m.dying && !m.tickCorpse(dt, world)) continue;
        if (m.dying) {
          this.deaths.push({
            x: m.x,
            y: m.y + m.def.height * m.def.scale * 0.4,
            z: m.z,
          });
        }
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
  ): MobPunch | null {
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
    if (result === "miss") return null;
    if (result === "dead") this.killed++;
    return { outcome: result, kind: best.kind, x: best.x, y: best.y, z: best.z };
  }

  consumeDeaths(): { x: number; y: number; z: number }[] {
    const out = this.deaths;
    this.deaths = [];
    return out;
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
