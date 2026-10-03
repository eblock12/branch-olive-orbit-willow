import * as THREE from "three";
import { isPlant } from "./blocks";
import type { World } from "./world";

type Bee = {
  mesh: THREE.Group;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  tx: number;
  ty: number;
  tz: number;
  retarget: number;
  wing: number;
  wingSpeed: number;
  phase: number;
  life: number;
  maxLife: number;
  flee: number;
  bodyMat: THREE.MeshLambertMaterial;
  stripeMat: THREE.MeshLambertMaterial;
  wingMat: THREE.MeshLambertMaterial;
};

const MAX_BEES = 16;
const sharedBody = new THREE.BoxGeometry(0.16, 0.12, 0.22);
const sharedStripe = new THREE.BoxGeometry(0.17, 0.13, 0.05);
const sharedHead = new THREE.BoxGeometry(0.1, 0.09, 0.08);
const sharedWing = new THREE.BoxGeometry(0.18, 0.02, 0.12);

/**
 * Daytime flower bees — hover patches, stray over bare grass, flee the player.
 * No hive / honey in this pass.
 */
export class BeeSystem {
  readonly group = new THREE.Group();
  private bees: Bee[] = [];
  private spawnT = 4;
  private dayFactor = 1;
  private buzzT = 0;
  onBuzz: ((x: number, y: number, z: number, vol: number) => void) | null =
    null;

  constructor() {
    this.group.name = "bees";
  }

  setDayFactor(f: number): void {
    this.dayFactor = f;
  }

  get count(): number {
    return this.bees.length;
  }

  update(dt: number, world: World, px: number, py: number, pz: number): void {
    const day = this.dayFactor;
    this.spawnT -= dt;
    if (day > 0.32 && this.bees.length < MAX_BEES && this.spawnT <= 0) {
      this.spawnT = this.bees.length < 4 ? 4 + Math.random() * 5 : 9 + Math.random() * 12;
      const n = Math.random() < 0.45 ? 1 : Math.random() < 0.8 ? 2 : 3;
      for (let i = 0; i < n && this.bees.length < MAX_BEES; i++) {
        this.spawnNear(world, px, py, pz);
      }
    } else if (day <= 0.18) {
      this.spawnT = 4;
    }

    let nearestD = 1e9;
    let nearest: Bee | null = null;

    for (let i = this.bees.length - 1; i >= 0; i--) {
      const b = this.bees[i]!;
      b.life += dt;
      b.wing += dt * b.wingSpeed;
      b.phase += dt;
      b.retarget -= dt;
      if (b.flee > 0) b.flee -= dt;
      if (day < 0.14) b.life += dt * 2.2;
      if (b.life > b.maxLife) {
        this.removeAt(i);
        continue;
      }

      const pdx = b.x - px;
      const pdz = b.z - pz;
      const pdy = b.y - (py + 1.4);
      const pdist = Math.hypot(pdx, pdy, pdz);
      if (pdist < nearestD) {
        nearestD = pdist;
        nearest = b;
      }
      if (pdist < 2.1 && b.flee <= 0) {
        b.flee = 1.6 + Math.random() * 0.8;
        const nx = pdx || 0.1;
        const nz = pdz || 0.1;
        const inv = 1 / Math.hypot(nx, nz);
        b.tx = b.x + nx * inv * (6 + Math.random() * 4);
        b.tz = b.z + nz * inv * (6 + Math.random() * 4);
        b.ty = b.y + 1.2;
        b.retarget = b.flee;
      }

      if (b.retarget <= 0) {
        this.pickTarget(b, world, px, pz);
      }

      const spd = b.flee > 0 ? 5.2 : 2.4;
      const ax = b.tx - b.x;
      const ay = b.ty - b.y;
      const az = b.tz - b.z;
      const ad = Math.hypot(ax, ay, az) || 1;
      b.vx += (ax / ad) * spd * dt * 3.2;
      b.vy += (ay / ad) * spd * dt * 2.4;
      b.vz += (az / ad) * spd * dt * 3.2;
      const damp = Math.exp(-dt * 3.4);
      b.vx *= damp;
      b.vy *= damp;
      b.vz *= damp;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;

      const surf = world.getSurfaceY(Math.floor(b.x), Math.floor(b.z));
      if (Number.isFinite(surf) && b.y < surf + 0.55) {
        b.y = surf + 0.55;
        b.vy = Math.max(0.4, b.vy);
      }

      const bob = Math.sin(b.phase * 7.5) * 0.06;
      b.mesh.position.set(b.x, b.y + bob, b.z);
      if (Math.hypot(b.vx, b.vz) > 0.08) {
        b.mesh.rotation.y = Math.atan2(b.vx, b.vz);
      }
      b.mesh.rotation.x = THREE.MathUtils.clamp(b.vy * 0.12, -0.35, 0.35);

      const flap = Math.sin(b.wing) * 0.7;
      const left = b.mesh.getObjectByName("wingL");
      const right = b.mesh.getObjectByName("wingR");
      if (left) left.rotation.z = 0.35 + flap;
      if (right) right.rotation.z = -0.35 - flap;

      const fadeIn = Math.min(1, b.life * 2);
      const fadeOut = Math.min(1, (b.maxLife - b.life) * 1.1);
      const dayFade = THREE.MathUtils.smoothstep(day, 0.1, 0.38);
      const op = fadeIn * fadeOut * dayFade;
      b.mesh.visible = op > 0.03;
      b.bodyMat.opacity = op;
      b.stripeMat.opacity = op;
      b.wingMat.opacity = op * 0.45;
    }

    this.buzzT -= dt;
    if (nearest && nearestD < 18 && this.buzzT <= 0 && day > 0.2) {
      this.buzzT = 0.09 + Math.random() * 0.05;
      const vol = THREE.MathUtils.clamp(1.15 - nearestD / 16, 0.08, 1);
      this.onBuzz?.(nearest.x, nearest.y, nearest.z, vol);
    }
  }

  private pickTarget(b: Bee, world: World, px: number, pz: number): void {
    b.retarget = 1.6 + Math.random() * 2.8;
    let bestX = b.x + (Math.random() - 0.5) * 10;
    let bestZ = b.z + (Math.random() - 0.5) * 10;
    let found = false;
    for (let k = 0; k < 8; k++) {
      const sx = Math.floor(b.x + (Math.random() - 0.5) * 14);
      const sz = Math.floor(b.z + (Math.random() - 0.5) * 14);
      const sy = world.getSurfaceY(sx, sz);
      if (!Number.isFinite(sy)) continue;
      const id = world.getBlock(sx, sy + 1, sz);
      if (isPlant(id)) {
        bestX = sx + 0.5;
        bestZ = sz + 0.5;
        found = true;
        break;
      }
    }
    const surf = world.getSurfaceY(Math.floor(bestX), Math.floor(bestZ));
    const ground = Number.isFinite(surf) ? surf : b.y;
    b.tx = bestX;
    b.tz = bestZ;
    b.ty = ground + (found ? 1.15 + Math.random() * 0.5 : 1.6 + Math.random() * 1.1);
    // Don't wander too far from the player
    if (Math.hypot(b.tx - px, b.tz - pz) > 42) {
      b.tx = px + (Math.random() - 0.5) * 16;
      b.tz = pz + (Math.random() - 0.5) * 16;
    }
  }

  private spawnNear(world: World, px: number, py: number, pz: number): void {
    const ang = Math.random() * Math.PI * 2;
    const dist = 6 + Math.random() * 18;
    const x = px + Math.cos(ang) * dist;
    const z = pz + Math.sin(ang) * dist;
    const surf = world.getSurfaceY(Math.floor(x), Math.floor(z));
    const y = (Number.isFinite(surf) ? surf : py) + 1.4 + Math.random() * 0.8;

    const bodyMat = new THREE.MeshLambertMaterial({
      color: 0xf0c030,
      flatShading: true,
      transparent: true,
      opacity: 0,
    });
    const stripeMat = new THREE.MeshLambertMaterial({
      color: 0x1a140c,
      flatShading: true,
      transparent: true,
      opacity: 0,
    });
    const wingMat = new THREE.MeshLambertMaterial({
      color: 0xd8e8f0,
      flatShading: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });

    const mesh = new THREE.Group();
    const body = new THREE.Mesh(sharedBody, bodyMat);
    body.castShadow = true;
    mesh.add(body);
    const s0 = new THREE.Mesh(sharedStripe, stripeMat);
    s0.position.z = -0.04;
    mesh.add(s0);
    const s1 = new THREE.Mesh(sharedStripe, stripeMat);
    s1.position.z = 0.05;
    mesh.add(s1);
    const head = new THREE.Mesh(sharedHead, stripeMat);
    head.position.set(0, 0.01, 0.14);
    mesh.add(head);
    const wingL = new THREE.Mesh(sharedWing, wingMat);
    wingL.name = "wingL";
    wingL.position.set(0.12, 0.07, 0.02);
    mesh.add(wingL);
    const wingR = new THREE.Mesh(sharedWing, wingMat);
    wingR.name = "wingR";
    wingR.position.set(-0.12, 0.07, 0.02);
    mesh.add(wingR);
    mesh.scale.setScalar(0.85 + Math.random() * 0.3);
    this.group.add(mesh);

    const bee: Bee = {
      mesh,
      x,
      y,
      z,
      vx: 0,
      vy: 0,
      vz: 0,
      tx: x,
      ty: y,
      tz: z,
      retarget: 0.2,
      wing: Math.random() * Math.PI * 2,
      wingSpeed: 28 + Math.random() * 10,
      phase: Math.random() * Math.PI * 2,
      life: 0,
      maxLife: 40 + Math.random() * 50,
      flee: 0,
      bodyMat,
      stripeMat,
      wingMat,
    };
    this.pickTarget(bee, world, px, pz);
    this.bees.push(bee);
  }

  private removeAt(i: number): void {
    const b = this.bees[i];
    if (!b) return;
    this.group.remove(b.mesh);
    b.bodyMat.dispose();
    b.stripeMat.dispose();
    b.wingMat.dispose();
    this.bees.splice(i, 1);
  }

  dispose(): void {
    for (let i = this.bees.length - 1; i >= 0; i--) this.removeAt(i);
  }
}
