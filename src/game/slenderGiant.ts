import * as THREE from "three";
import type { World } from "./world";
import type { Player } from "./player";
import { warpMobIfNeeded, type PortalSystem } from "./portals";
import {
  createEntityShadow,
  disposeEntityShadow,
  updateEntityShadow,
} from "./entityShadow";
import { RaggedCloth, type ClothCollider } from "./raggedCloth";
import { isSolid, isWater } from "./blocks";
import { CHUNK_HEIGHT } from "./chunkConstants";
import { columnHasWaterSurface, findShore } from "./entityWater";

/**
 * Slender Giant — rare tall entity with 2-bone leg IK.
 * Alternating plant steps on block tops; torso chain sways to stay upright.
 * Spawns far from the player and only stalks if they wander close.
 */

const THIGH_LEN = 2.4;
const SHIN_LEN = 2.5;
const LEG_LEN = THIGH_LEN + SHIN_LEN;
const HIP_WIDTH = 0.85;
const STEP_DURATION = 1.15;
const STRIDE = 2.0;
const TORSO_SEGMENTS = 3;
const TORSO_SEG_H = 1.15;
const CHASE_RANGE = 32;
/** Max vertical climb/drop per foot plant (blocks) */
const MAX_STEP = 4;

type FootState = {
  planted: THREE.Vector3;
  swingFrom: THREE.Vector3;
  swingTo: THREE.Vector3;
  swinging: boolean;
  t: number;
};

function surfaceY(world: World, x: number, z: number): number {
  const wx = Math.floor(x);
  const wz = Math.floor(z);
  for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
    const id = world.getBlock(wx, y, wz);
    if (isWater(id)) return y + 1;
    if (isSolid(id)) return y + 1;
  }
  return world.getSurfaceY(wx, wz);
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _v5 = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _m4 = new THREE.Matrix4();

/**
 * Analytical 2-bone IK. Knee bends along bendHint (usually forward+up).
 */
function solveTwoBoneIK(
  hip: THREE.Vector3,
  foot: THREE.Vector3,
  lenA: number,
  lenB: number,
  bendHint: THREE.Vector3,
  outKnee: THREE.Vector3,
): void {
  const toFoot = new THREE.Vector3().subVectors(foot, hip);
  let dist = toFoot.length();
  const minD = Math.abs(lenA - lenB) + 0.05;
  const maxD = lenA + lenB - 0.05;

  if (dist < 1e-4) {
    outKnee.copy(hip).addScaledVector(bendHint, lenA * 0.5);
    return;
  }

  // Clamp reach
  if (dist > maxD) {
    toFoot.multiplyScalar(maxD / dist);
    dist = maxD;
    foot = new THREE.Vector3().copy(hip).add(toFoot);
  } else if (dist < minD) {
    toFoot.multiplyScalar(minD / dist);
    dist = minD;
    foot = new THREE.Vector3().copy(hip).add(toFoot);
  }

  const cosA = THREE.MathUtils.clamp(
    (lenA * lenA + dist * dist - lenB * lenB) / (2 * lenA * dist),
    -1,
    1,
  );
  const along = lenA * cosA;
  const h = Math.sqrt(Math.max(0, lenA * lenA - along * along));

  const axis = toFoot.normalize();
  let n = new THREE.Vector3().crossVectors(axis, bendHint);
  if (n.lengthSq() < 1e-8) {
    n.crossVectors(axis, _up);
    if (n.lengthSq() < 1e-8) n.set(1, 0, 0);
  }
  n.normalize();
  const side = new THREE.Vector3().crossVectors(n, axis).normalize();
  if (side.dot(bendHint) < 0) side.negate();

  outKnee.copy(hip).addScaledVector(axis, along).addScaledVector(side, h);
}

function smoothstep(t: number): number {
  const x = THREE.MathUtils.clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

function footArcY(t: number, lift: number): number {
  return Math.sin(Math.PI * THREE.MathUtils.clamp(t, 0, 1)) * lift;
}

type Mats = {
  body: THREE.MeshLambertMaterial;
  cloth: THREE.MeshLambertMaterial;
  head: THREE.MeshLambertMaterial;
  leg: THREE.MeshLambertMaterial;
  joint: THREE.MeshLambertMaterial;
  voidEye: THREE.MeshLambertMaterial;
};

function createMats(): Mats {
  return {
    body: new THREE.MeshLambertMaterial({ color: 0x1a1a24 }),
    cloth: new THREE.MeshLambertMaterial({ color: 0x101018 }),
    head: new THREE.MeshLambertMaterial({ color: 0xe6e2d8 }),
    // Legs slightly lighter so they read against ground/shadows
    leg: new THREE.MeshLambertMaterial({ color: 0x2a2a38 }),
    joint: new THREE.MeshLambertMaterial({ color: 0x3a3a4a }),
    voidEye: new THREE.MeshLambertMaterial({ color: 0x050508 }),
  };
}

const geoBox = new THREE.BoxGeometry(1, 1, 1);

/** Bone as a box: origin at TOP joint, extends down local −Y by `len`. */
function makeBoneMesh(
  len: number,
  thickX: number,
  thickZ: number,
  mat: THREE.Material,
): THREE.Mesh {
  const m = new THREE.Mesh(geoBox, mat);
  m.scale.set(thickX, len, thickZ);
  m.position.y = -len * 0.5;
  m.frustumCulled = false;
  m.castShadow = false;
  m.receiveShadow = false;
  return m;
}

/**
 * Aim a group so local −Y points along world-space `dir`.
 * Does not touch position.
 */
function aimLocalNegY(g: THREE.Object3D, dirX: number, dirY: number, dirZ: number): void {
  const len = Math.hypot(dirX, dirY, dirZ);
  if (len < 1e-8) {
    g.quaternion.identity();
    return;
  }
  const dx = dirX / len;
  const dy = dirY / len;
  const dz = dirZ / len;
  // from (0,-1,0) to (dx,dy,dz)
  _v1.set(0, -1, 0);
  _v2.set(dx, dy, dz);
  // Handle near-opposite (setFromUnitVectors unstable near -1)
  const dot = _v1.dot(_v2);
  if (dot < -0.999) {
    g.quaternion.setFromAxisAngle(_v3.set(1, 0, 0), Math.PI);
    return;
  }
  _q.setFromUnitVectors(_v1, _v2);
  g.quaternion.copy(_q);
}

export class SlenderGiant {
  readonly group = new THREE.Group();
  readonly shadow: THREE.Mesh;

  x: number;
  y: number;
  z: number;
  yaw = 0;

  private mats: Mats;
  private pelvis: THREE.Group;
  private torso: THREE.Group[] = [];
  private head: THREE.Mesh;
  /** Leg roots live under `group` in world units (not pelvis) for stable IK. */
  private leftThigh: THREE.Group;
  private leftShin: THREE.Group;
  private rightThigh: THREE.Group;
  private rightShin: THREE.Group;
  private leftArm: THREE.Group;
  private rightArm: THREE.Group;
  /** Shoulder / clavicle anchor for cloth pins */
  private clothAnchor: THREE.Group;
  private shirt: RaggedCloth;
  private prevX = 0;
  private prevZ = 0;
  private clothColliders: ClothCollider[] = [];
  private _colTmpA = new THREE.Vector3();
  private _colTmpB = new THREE.Vector3();

  private leftFoot: FootState;
  private rightFoot: FootState;
  private swingLeg: 0 | 1 | -1 = -1;
  private age = 0;
  private hipSway = 0;
  private kneeL = new THREE.Vector3();
  private kneeR = new THREE.Vector3();
  private footLCur = new THREE.Vector3();
  private footRCur = new THREE.Vector3();
  private hipL = new THREE.Vector3();
  private hipR = new THREE.Vector3();
  alive = true;
  portalCd = 0;
  private wanderT = 4 + Math.random() * 8;
  private wandering = false;
  private stepCool = 0;

  constructor(x: number, y: number, z: number, mats: Mats) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.mats = mats;
    this.shadow = createEntityShadow();
    this.group.frustumCulled = false;

    this.pelvis = new THREE.Group();
    this.pelvis.frustumCulled = false;
    this.group.add(this.pelvis);

    const pelvisMesh = new THREE.Mesh(geoBox, mats.cloth);
    pelvisMesh.scale.set(HIP_WIDTH * 1.5, 0.4, 0.45);
    pelvisMesh.frustumCulled = false;
    this.pelvis.add(pelvisMesh);

    let parent: THREE.Object3D = this.pelvis;
    for (let i = 0; i < TORSO_SEGMENTS; i++) {
      const seg = new THREE.Group();
      seg.position.y = i === 0 ? 0.28 : TORSO_SEG_H;
      const mesh = new THREE.Mesh(geoBox, i === 0 ? mats.cloth : mats.body);
      mesh.scale.set(0.4 - i * 0.04, TORSO_SEG_H, 0.3 - i * 0.02);
      mesh.position.y = TORSO_SEG_H * 0.5;
      mesh.frustumCulled = false;
      seg.add(mesh);
      parent.add(seg);
      this.torso.push(seg);
      parent = seg;
    }

    this.head = new THREE.Mesh(geoBox, mats.head);
    this.head.scale.set(0.42, 0.7, 0.4);
    this.head.position.y = TORSO_SEG_H + 0.4;
    this.head.frustumCulled = false;
    parent.add(this.head);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(geoBox, mats.voidEye);
      eye.scale.set(0.08, 0.06, 0.04);
      eye.position.set(side * 0.1, 0.08, 0.2);
      this.head.add(eye);
    }

    const upper = this.torso[this.torso.length - 1]!;
    this.leftArm = this.buildArm(-1, mats);
    this.rightArm = this.buildArm(1, mats);
    upper.add(this.leftArm);
    upper.add(this.rightArm);

    // Cloth anchor at shoulders (mid upper torso)
    this.clothAnchor = new THREE.Group();
    this.clothAnchor.position.set(0, TORSO_SEG_H * 0.55, 0.02);
    upper.add(this.clothAnchor);

    this.shirt = new RaggedCloth({
      cols: 9,
      rows: 8,
      width: 1.35,
      height: 2.15,
      color: 0x2a2430,
      raggedness: 0.4,
      gravity: 8.0,
      damping: 0.9,
      stiffness: 0.12,
      iterations: 5,
    });
    this.group.add(this.shirt.mesh);

    // Legs — direct children of root group, positioned in world space each frame
    this.leftThigh = new THREE.Group();
    this.rightThigh = new THREE.Group();
    this.leftThigh.frustumCulled = false;
    this.rightThigh.frustumCulled = false;
    this.group.add(this.leftThigh);
    this.group.add(this.rightThigh);

    this.leftThigh.add(makeBoneMesh(THIGH_LEN, 0.28, 0.28, mats.leg));
    this.rightThigh.add(makeBoneMesh(THIGH_LEN, 0.28, 0.28, mats.leg));

    // Knee joint marker
    const kneeL = new THREE.Mesh(geoBox, mats.joint);
    kneeL.scale.set(0.32, 0.28, 0.32);
    kneeL.position.y = -THIGH_LEN;
    kneeL.frustumCulled = false;
    this.leftThigh.add(kneeL);
    const kneeR = new THREE.Mesh(geoBox, mats.joint);
    kneeR.scale.set(0.32, 0.28, 0.32);
    kneeR.position.y = -THIGH_LEN;
    kneeR.frustumCulled = false;
    this.rightThigh.add(kneeR);

    this.leftShin = new THREE.Group();
    this.rightShin = new THREE.Group();
    this.leftShin.frustumCulled = false;
    this.rightShin.frustumCulled = false;
    this.leftShin.position.y = -THIGH_LEN;
    this.rightShin.position.y = -THIGH_LEN;
    this.leftThigh.add(this.leftShin);
    this.rightThigh.add(this.rightShin);

    this.leftShin.add(makeBoneMesh(SHIN_LEN, 0.22, 0.22, mats.leg));
    this.rightShin.add(makeBoneMesh(SHIN_LEN, 0.22, 0.22, mats.leg));

    const lfMesh = new THREE.Mesh(geoBox, mats.cloth);
    lfMesh.scale.set(0.32, 0.14, 0.55);
    lfMesh.position.set(0, -SHIN_LEN - 0.05, 0.12);
    lfMesh.frustumCulled = false;
    this.leftShin.add(lfMesh);

    const rfMesh = new THREE.Mesh(geoBox, mats.cloth);
    rfMesh.scale.set(0.32, 0.14, 0.55);
    rfMesh.position.set(0, -SHIN_LEN - 0.05, 0.12);
    rfMesh.frustumCulled = false;
    this.rightShin.add(rfMesh);

    // Feet start on ground estimate (plantFeet corrects immediately)
    const groundGuess = y - LEG_LEN * 0.92;
    this.leftFoot = {
      planted: new THREE.Vector3(x - HIP_WIDTH * 0.5, groundGuess, z),
      swingFrom: new THREE.Vector3(x - HIP_WIDTH * 0.5, groundGuess, z),
      swingTo: new THREE.Vector3(x - HIP_WIDTH * 0.5, groundGuess, z),
      swinging: false,
      t: 0,
    };
    this.rightFoot = {
      planted: new THREE.Vector3(x + HIP_WIDTH * 0.5, groundGuess, z),
      swingFrom: new THREE.Vector3(x + HIP_WIDTH * 0.5, groundGuess, z),
      swingTo: new THREE.Vector3(x + HIP_WIDTH * 0.5, groundGuess, z),
      swinging: false,
      t: 0,
    };
    this.prevX = x;
    this.prevZ = z;
  }

  private buildArm(side: number, mats: Mats): THREE.Group {
    const root = new THREE.Group();
    root.position.set(side * 0.3, TORSO_SEG_H * 0.7, 0);
    root.add(makeBoneMesh(1.7, 0.12, 0.12, mats.cloth));
    const lowerG = new THREE.Group();
    lowerG.position.y = -1.7;
    lowerG.add(makeBoneMesh(1.8, 0.1, 0.1, mats.body));
    root.add(lowerG);
    root.rotation.z = side * 0.12;
    return root;
  }

  plantFeet(world: World): void {
    const rgtX = Math.cos(this.yaw);
    const rgtZ = -Math.sin(this.yaw);
    const lx = this.x - rgtX * HIP_WIDTH * 0.5;
    const lz = this.z - rgtZ * HIP_WIDTH * 0.5;
    const rx = this.x + rgtX * HIP_WIDTH * 0.5;
    const rz = this.z + rgtZ * HIP_WIDTH * 0.5;
    const ly = surfaceY(world, lx, lz);
    const ry = surfaceY(world, rx, rz);
    this.leftFoot.planted.set(lx, ly, lz);
    this.leftFoot.swingFrom.copy(this.leftFoot.planted);
    this.leftFoot.swingTo.copy(this.leftFoot.planted);
    this.leftFoot.swinging = false;
    this.rightFoot.planted.set(rx, ry, rz);
    this.rightFoot.swingFrom.copy(this.rightFoot.planted);
    this.rightFoot.swingTo.copy(this.rightFoot.planted);
    this.rightFoot.swinging = false;
    this.swingLeg = -1;
    this.y = (ly + ry) * 0.5 + LEG_LEN * 0.9;
    // Immediate pose so first frame has visible legs
    this.writeFoot(this.leftFoot, this.footLCur);
    this.writeFoot(this.rightFoot, this.footRCur);
    const fwdX = Math.sin(this.yaw);
    const fwdZ = Math.cos(this.yaw);
    this.solveLegsIK(
      this.footLCur,
      this.footRCur,
      fwdX,
      fwdZ,
      rgtX,
      rgtZ,
    );
    this.syncMeshes(this.footLCur, this.footRCur);
    this.shirt.resetToAnchor(this.clothAnchor);
  }

  snapAfterWarp(world: World): void {
    this.prevX = this.x;
    this.prevZ = this.z;
    this.plantFeet(world);
  }

  update(
    dt: number,
    world: World,
    player: Player,
    windX = 0,
    windZ = 0,
  ): void {
    if (!this.alive) return;
    this.age += dt;
    if (this.stepCool > 0) this.stepCool -= dt;

    const pdx = player.x - this.x;
    const pdz = player.z - this.z;
    const pDist = Math.hypot(pdx, pdz);
    const chasing = pDist <= CHASE_RANGE;

    this.wanderT -= dt;
    if (!chasing && this.wanderT <= 0) {
      this.wandering = Math.random() < 0.35;
      this.wanderT = this.wandering
        ? 6 + Math.random() * 8
        : 8 + Math.random() * 14;
      if (this.wandering) this.yaw += (Math.random() - 0.5) * 1.4;
    }

    const wading = columnHasWaterSurface(world, this.x, this.z);
    if (wading && (!chasing || pDist > 10)) {
      const shore = findShore(world, this.x, this.z, this.y - LEG_LEN * 0.85, 16);
      if (shore) {
        const desiredYaw = Math.atan2(shore.x - this.x, shore.z - this.z);
        let dyaw = desiredYaw - this.yaw;
        while (dyaw > Math.PI) dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        this.yaw += dyaw * Math.min(1, 1.6 * dt);
        this.wandering = true;
      }
    } else if (chasing) {
      const desiredYaw = pDist > 0.5 ? Math.atan2(pdx, pdz) : this.yaw;
      let dyaw = desiredYaw - this.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      this.yaw += dyaw * Math.min(1, 1.15 * dt);
    } else if (columnHasWaterSurface(world, this.x, this.z)) {
      const shore = findShore(world, this.x, this.z, this.y - LEG_LEN * 0.85, 16);
      if (shore) {
        const desiredYaw = Math.atan2(shore.x - this.x, shore.z - this.z);
        let dyaw = desiredYaw - this.yaw;
        while (dyaw > Math.PI) dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        this.yaw += dyaw * Math.min(1, 1.6 * dt);
        this.wandering = true;
      }
    }

    const walking = chasing || this.wandering;

    const fwdX = Math.sin(this.yaw);
    const fwdZ = Math.cos(this.yaw);
    const rgtX = Math.cos(this.yaw);
    const rgtZ = -Math.sin(this.yaw);

    if (walking) {
      if (this.swingLeg < 0 && this.stepCool <= 0) {
        this.beginStep(world, fwdX, fwdZ, rgtX, rgtZ, 0);
      }

      if (this.swingLeg === 0) {
        this.advanceSwing(this.leftFoot, dt, world);
        if (!this.leftFoot.swinging) {
          this.swingLeg = -1;
          this.beginStep(world, fwdX, fwdZ, rgtX, rgtZ, 1);
        }
      } else if (this.swingLeg === 1) {
        this.advanceSwing(this.rightFoot, dt, world);
        if (!this.rightFoot.swinging) {
          this.swingLeg = -1;
          this.beginStep(world, fwdX, fwdZ, rgtX, rgtZ, 0);
        }
      }
    } else if (this.swingLeg === 0) {
      this.advanceSwing(this.leftFoot, dt, world);
      if (!this.leftFoot.swinging) this.swingLeg = -1;
    } else if (this.swingLeg === 1) {
      this.advanceSwing(this.rightFoot, dt, world);
      if (!this.rightFoot.swinging) this.swingLeg = -1;
    }

    this.writeFoot(this.leftFoot, this.footLCur);
    this.writeFoot(this.rightFoot, this.footRCur);
    const lf = this.footLCur;
    const rf = this.footRCur;

    const midX = (lf.x + rf.x) * 0.5;
    const midZ = (lf.z + rf.z) * 0.5;
    const midY = (lf.y + rf.y) * 0.5;
    const footSep = Math.hypot(lf.x - rf.x, lf.z - rf.z);
    const crouch =
      1 -
      THREE.MathUtils.clamp((footSep - HIP_WIDTH) / (STRIDE * 1.2), 0, 0.25);
    const hipTargetY = midY + LEG_LEN * (0.86 + crouch * 0.05);

    this.x = THREE.MathUtils.damp(this.x, midX, 6, dt);
    this.z = THREE.MathUtils.damp(this.z, midZ, 6, dt);
    this.y = THREE.MathUtils.damp(this.y, hipTargetY, 8, dt);

    const swingT =
      this.swingLeg === 0
        ? this.leftFoot.t
        : this.swingLeg === 1
          ? this.rightFoot.t
          : 0;
    const stanceIsLeft = this.swingLeg === 1 || this.swingLeg < 0;
    const weightSide = stanceIsLeft ? -1 : 1;
    this.hipSway = THREE.MathUtils.damp(
      this.hipSway,
      weightSide * 0.22 * (1 - Math.sin(swingT * Math.PI) * 0.5),
      5,
      dt,
    );

    const slopeX = (rf.y - lf.y) / Math.max(0.2, footSep);
    const targetRoll = -slopeX * 0.35 - this.hipSway * 0.5;
    const targetPitch =
      Math.sin(this.age * 0.7) * 0.03 + Math.sin(swingT * Math.PI) * 0.06;

    this.applyTorsoUpright(targetPitch, targetRoll, dt);
    this.solveLegsIK(lf, rf, fwdX, fwdZ, rgtX, rgtZ);
    this.syncMeshes(lf, rf);

    // Cloth: body wake + world weather wind vector
    const vx = (this.x - this.prevX) / Math.max(1e-4, dt);
    const vz = (this.z - this.prevZ) / Math.max(1e-4, dt);
    this.prevX = this.x;
    this.prevZ = this.z;
    // Relative wind = weather − body velocity (walk into wind billows more)
    const relWX = windX - vx * 0.15;
    const relWZ = windZ - vz * 0.15;
    this.buildClothColliders();
    this.shirt.update(dt, this.clothAnchor, relWX, relWZ, this.clothColliders);
  }

  /** Torso + arms + thighs as soft capsules for cloth. */
  private buildClothColliders(): void {
    const cols = this.clothColliders;
    cols.length = 0;

    this.group.updateMatrixWorld(true);
    this.pelvis.updateMatrixWorld(true);

    // Torso chain: pelvis → each segment center
    const a = this._colTmpA;
    const b = this._colTmpB;
    a.set(0, 0.1, 0).applyMatrix4(this.pelvis.matrixWorld);
    for (let i = 0; i < this.torso.length; i++) {
      const seg = this.torso[i]!;
      seg.updateMatrixWorld(true);
      b.set(0, TORSO_SEG_H * 0.5, 0).applyMatrix4(seg.matrixWorld);
      cols.push({
        ax: a.x,
        ay: a.y,
        az: a.z,
        bx: b.x,
        by: b.y,
        bz: b.z,
        radius: 0.42 - i * 0.03,
      });
      a.copy(b);
    }
    // Head base
    this.head.updateMatrixWorld(true);
    b.set(0, 0, 0).applyMatrix4(this.head.matrixWorld);
    cols.push({
      ax: a.x,
      ay: a.y,
      az: a.z,
      bx: b.x,
      by: b.y,
      bz: b.z,
      radius: 0.3,
    });

    // Arms (upper bone approx)
    for (const arm of [this.leftArm, this.rightArm]) {
      arm.updateMatrixWorld(true);
      a.set(0, 0, 0).applyMatrix4(arm.matrixWorld);
      b.set(0, -1.7, 0).applyMatrix4(arm.matrixWorld);
      cols.push({
        ax: a.x,
        ay: a.y,
        az: a.z,
        bx: b.x,
        by: b.y,
        bz: b.z,
        radius: 0.2,
      });
      // Forearm
      const lower = arm.children.find((c) => c instanceof THREE.Group) as
        | THREE.Group
        | undefined;
      if (lower) {
        lower.updateMatrixWorld(true);
        a.set(0, 0, 0).applyMatrix4(lower.matrixWorld);
        b.set(0, -1.8, 0).applyMatrix4(lower.matrixWorld);
        cols.push({
          ax: a.x,
          ay: a.y,
          az: a.z,
          bx: b.x,
          by: b.y,
          bz: b.z,
          radius: 0.16,
        });
      }
    }

    // Thighs + shins (world-space leg groups)
    for (const [thigh, shin] of [
      [this.leftThigh, this.leftShin],
      [this.rightThigh, this.rightShin],
    ] as const) {
      thigh.updateMatrixWorld(true);
      a.copy(thigh.position);
      // knee ≈ thigh pos + rotated (0,-THIGH_LEN,0)
      b.set(0, -THIGH_LEN, 0).applyMatrix4(thigh.matrixWorld);
      cols.push({
        ax: a.x,
        ay: a.y,
        az: a.z,
        bx: b.x,
        by: b.y,
        bz: b.z,
        radius: 0.26,
      });
      shin.updateMatrixWorld(true);
      a.copy(b);
      b.set(0, -SHIN_LEN, 0).applyMatrix4(shin.matrixWorld);
      cols.push({
        ax: a.x,
        ay: a.y,
        az: a.z,
        bx: b.x,
        by: b.y,
        bz: b.z,
        radius: 0.2,
      });
    }
  }

  private writeFoot(foot: FootState, out: THREE.Vector3): void {
    if (!foot.swinging) {
      out.copy(foot.planted);
      return;
    }
    const u = smoothstep(foot.t);
    out.set(
      THREE.MathUtils.lerp(foot.swingFrom.x, foot.swingTo.x, u),
      THREE.MathUtils.lerp(foot.swingFrom.y, foot.swingTo.y, u) +
        footArcY(foot.t, 0.9),
      THREE.MathUtils.lerp(foot.swingFrom.z, foot.swingTo.z, u),
    );
  }

  private beginStep(
    world: World,
    fwdX: number,
    fwdZ: number,
    rgtX: number,
    rgtZ: number,
    leg: 0 | 1,
  ): void {
    if (this.swingLeg >= 0) return;
    const foot = leg === 0 ? this.leftFoot : this.rightFoot;
    const side = leg === 0 ? -1 : 1;
    const base = foot.planted;
    let bestX = base.x;
    let bestZ = base.z;
    let bestY = base.y;
    let bestScore = -Infinity;
    let found = false;

    for (let i = 0; i < 7; i++) {
      const dist = STRIDE * (0.45 + i * 0.12);
      const sideJ = (i - 3) * 0.08;
      const cx =
        this.x + fwdX * dist + rgtX * (side * HIP_WIDTH * 0.5 + sideJ);
      const cz =
        this.z + fwdZ * dist + rgtZ * (side * HIP_WIDTH * 0.5 + sideJ);
      const cy = surfaceY(world, cx, cz);
      const rise = cy - base.y;
      if (rise > MAX_STEP || rise < -MAX_STEP) continue;
      // Don't plant into a wall column (solid at shin/hip)
      if (world.isSolidAt(cx, base.y + 1.2, cz)) continue;
      if (world.isSolidAt(cx, base.y + 2.2, cz)) continue;
      const score =
        dist * 2 -
        Math.abs(rise) * 2.4 -
        Math.abs(sideJ) * 0.5 +
        (columnHasWaterSurface(world, cx, cz) ? -3.5 : 1.6);
      if (score > bestScore) {
        bestScore = score;
        bestX = cx;
        bestZ = cz;
        bestY = cy;
        found = true;
      }
    }

    if (!found || (Math.hypot(bestX - base.x, bestZ - base.z) < 0.35)) {
      // Sheer wall / no legal foothold — stop and turn
      this.stepCool = 0.55;
      this.yaw += (Math.random() > 0.5 ? 1 : -1) * (0.55 + Math.random() * 0.5);
      return;
    }

    foot.swingFrom.copy(foot.planted);
    foot.swingTo.set(bestX, bestY, bestZ);
    foot.swinging = true;
    foot.t = 0;
    this.swingLeg = leg;
  }

  private advanceSwing(foot: FootState, dt: number, world: World): void {
    if (!foot.swinging) return;
    foot.t += dt / STEP_DURATION;
    if (foot.t >= 1) {
      foot.t = 1;
      const y = surfaceY(world, foot.swingTo.x, foot.swingTo.z);
      const rise = y - foot.swingFrom.y;
      if (rise > MAX_STEP || rise < -MAX_STEP) {
        // Surface disappeared into a cliff mid-step — stay put
        foot.planted.copy(foot.swingFrom);
      } else {
        foot.planted.copy(foot.swingTo);
        foot.planted.y = y;
      }
      foot.swinging = false;
      foot.t = 0;
    }
  }

  private applyTorsoUpright(pitch: number, roll: number, dt: number): void {
    for (let i = 0; i < this.torso.length; i++) {
      const seg = this.torso[i]!;
      const w = (i + 1) / this.torso.length;
      const p = pitch * (0.35 + w * 0.4);
      const r = roll * (0.25 + w * 0.55);
      const counter = w * 0.55;
      seg.rotation.x = THREE.MathUtils.damp(
        seg.rotation.x,
        p * (1 - counter) - pitch * counter * 0.5,
        6,
        dt,
      );
      seg.rotation.z = THREE.MathUtils.damp(
        seg.rotation.z,
        r * (1 - counter) - roll * counter * 0.65,
        6,
        dt,
      );
    }
    this.pelvis.rotation.z = THREE.MathUtils.damp(
      this.pelvis.rotation.z,
      -roll * 0.35 + this.hipSway * 0.25,
      6,
      dt,
    );
    this.pelvis.rotation.x = THREE.MathUtils.damp(
      this.pelvis.rotation.x,
      -pitch * 0.2,
      6,
      dt,
    );
    this.leftArm.rotation.x =
      0.15 + Math.sin(this.age * 1.1) * 0.08 + pitch * 0.5;
    this.rightArm.rotation.x =
      0.15 + Math.sin(this.age * 1.1 + 1) * 0.08 + pitch * 0.5;
  }

  private solveLegsIK(
    lf: THREE.Vector3,
    rf: THREE.Vector3,
    fwdX: number,
    fwdZ: number,
    rgtX: number,
    rgtZ: number,
  ): void {
    this.hipL.set(
      this.x - rgtX * HIP_WIDTH * 0.5 + rgtX * this.hipSway * 0.12,
      this.y,
      this.z - rgtZ * HIP_WIDTH * 0.5 + rgtZ * this.hipSway * 0.12,
    );
    this.hipR.set(
      this.x + rgtX * HIP_WIDTH * 0.5 + rgtX * this.hipSway * 0.12,
      this.y,
      this.z + rgtZ * HIP_WIDTH * 0.5 + rgtZ * this.hipSway * 0.12,
    );

    // Bend hint: forward with slight up so knees pop forward, not sideways
    const bend = _v5.set(fwdX, 0.35, fwdZ).normalize();
    solveTwoBoneIK(this.hipL, lf, THIGH_LEN, SHIN_LEN, bend, this.kneeL);
    solveTwoBoneIK(this.hipR, rf, THIGH_LEN, SHIN_LEN, bend, this.kneeR);

    this.orientLeg(this.leftThigh, this.leftShin, this.hipL, this.kneeL, lf);
    this.orientLeg(this.rightThigh, this.rightShin, this.hipR, this.kneeR, rf);
  }

  private orientLeg(
    thigh: THREE.Group,
    shin: THREE.Group,
    hipW: THREE.Vector3,
    kneeW: THREE.Vector3,
    footW: THREE.Vector3,
  ): void {
    // Thigh root at hip (world, group is identity)
    thigh.position.copy(hipW);
    aimLocalNegY(
      thigh,
      kneeW.x - hipW.x,
      kneeW.y - hipW.y,
      kneeW.z - hipW.z,
    );

    // Shin at knee in thigh local = (0, -THIGH_LEN, 0) when bone aims −Y
    shin.position.set(0, -THIGH_LEN, 0);

    // Foot direction in thigh local space
    thigh.updateMatrixWorld(true);
    _m4.copy(thigh.matrixWorld).invert();
    const footLocal = new THREE.Vector3(footW.x, footW.y, footW.z).applyMatrix4(
      _m4,
    );
    const kneeLocal = new THREE.Vector3(0, -THIGH_LEN, 0);
    aimLocalNegY(
      shin,
      footLocal.x - kneeLocal.x,
      footLocal.y - kneeLocal.y,
      footLocal.z - kneeLocal.z,
    );
  }

  private syncMeshes(lf: THREE.Vector3, rf: THREE.Vector3): void {
    this.pelvis.position.set(this.x, this.y, this.z);
    this.pelvis.rotation.y = this.yaw;

    updateEntityShadow(
      this.shadow,
      (lf.x + rf.x) * 0.5,
      Math.min(lf.y, rf.y),
      (lf.z + rf.z) * 0.5,
      1.15,
      0,
      this.yaw,
      1.5,
      0.75,
    );
  }

  dispose(): void {
    this.shirt.dispose();
    disposeEntityShadow(this.shadow);
  }
}

export class SlenderGiantSystem {
  readonly group = new THREE.Group();
  private mats: Mats;
  private giants: SlenderGiant[] = [];
  private spawnTimer = 70 + Math.random() * 80;

  constructor() {
    this.mats = createMats();
    this.group.frustumCulled = false;
  }

  get count(): number {
    return this.giants.filter((g) => g.alive).length;
  }

  anyNear(x: number, z: number, r: number): boolean {
    const r2 = r * r;
    for (const g of this.giants) {
      if (!g.alive) continue;
      const dx = g.x - x;
      const dz = g.z - z;
      if (dx * dx + dz * dz <= r2) return true;
    }
    return false;
  }

  update(
    dt: number,
    world: World,
    player: Player,
    dayFactor: number,
    windAt?: (x: number, z: number) => { windX: number; windZ: number },
    portals?: PortalSystem | null,
  ): void {
    for (let i = this.giants.length - 1; i >= 0; i--) {
      const g = this.giants[i]!;
      if (!g.alive) {
        this.group.remove(g.group);
        this.group.remove(g.shadow);
        g.dispose();
        this.giants.splice(i, 1);
        continue;
      }
      const px = g.x;
      const py = g.y;
      const pz = g.z;
      const w = windAt?.(g.x, g.z) ?? { windX: 0, windZ: 0 };
      g.update(dt, world, player, w.windX, w.windZ);
      if (g.portalCd > 0) g.portalCd -= dt;
      if (portals && warpMobIfNeeded(portals, world, g, px, py, pz)) {
        g.snapAfterWarp(world);
      }
      const d = portals
        ? portals.shortPathDist(world, g.x, g.z, player.x, player.z)
        : Math.hypot(g.x - player.x, g.z - player.z);
      if (d > 160 && g.portalCd <= 0) g.alive = false;
    }

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 140 + Math.random() * 220;
      const nightBonus = dayFactor < 0.2 ? 0.22 : 0.04;
      if (this.count < 1 && Math.random() < nightBonus) {
        const ang = Math.random() * Math.PI * 2;
        const dist = 56 + Math.random() * 36;
        const x = player.x + Math.cos(ang) * dist;
        const z = player.z + Math.sin(ang) * dist;
        const ground = surfaceY(world, x, z);
        if (ground > 3) {
          const g = new SlenderGiant(x, ground + LEG_LEN * 0.9, z, this.mats);
          g.yaw = Math.random() * Math.PI * 2;
          g.plantFeet(world);
          this.giants.push(g);
          this.group.add(g.group);
          this.group.add(g.shadow);
        }
      }
    }
  }

  dispose(): void {
    for (const g of this.giants) {
      this.group.remove(g.group);
      this.group.remove(g.shadow);
      g.dispose();
    }
    this.giants = [];
    for (const m of Object.values(this.mats)) m.dispose();
  }
}
