import * as THREE from "three";
import { moveEntityXZ, type EntityBox } from "./entityCollision";
import type { World } from "./world";

export const HURT_FLASH = 0.5;

const overlayGeo = new THREE.BoxGeometry(1, 1, 1);

/** Bright additive-looking box so hits read even on shared materials. */
export function createHurtOverlay(
  w: number,
  h: number,
  d: number,
  y: number,
): THREE.Mesh {
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
  });
  const m = new THREE.Mesh(overlayGeo, mat);
  m.name = "hurtOverlay";
  m.scale.set(w * 1.18, h * 1.1, d * 1.18);
  m.position.y = y;
  m.visible = false;
  m.renderOrder = 4;
  return m;
}

export function tickHurtOverlay(mesh: THREE.Mesh, hurtT: number): void {
  const mat = mesh.material as THREE.MeshBasicMaterial;
  if (hurtT <= 0) {
    mesh.visible = false;
    return;
  }
  mesh.visible = true;
  const u = hurtT / HURT_FLASH;
  if (u > 0.52) {
    mat.color.setHex(0xffffff);
    mat.opacity = 0.88;
  } else {
    mat.color.setRGB(1, 0.2 + u * 0.45, 0.14);
    mat.opacity = 0.12 + u * 0.78;
  }
}

export function disposeHurtOverlay(mesh: THREE.Mesh): void {
  (mesh.material as THREE.Material).dispose();
}

export function knockbackImpulse(
  ex: number,
  ez: number,
  fromX: number,
  fromZ: number,
  power = 11,
): { kbX: number; kbZ: number; vy: number } {
  const dx = ex - fromX;
  const dz = ez - fromZ;
  const len = Math.hypot(dx, dz) || 1;
  return {
    kbX: (dx / len) * power,
    kbZ: (dz / len) * power,
    vy: 6.6,
  };
}

export function integrateKnockback(
  world: World,
  box: EntityBox,
  kbX: number,
  kbZ: number,
  dt: number,
  onGround: boolean,
): { kbX: number; kbZ: number } {
  const spd = Math.hypot(kbX, kbZ);
  if (spd < 0.18) return { kbX: 0, kbZ: 0 };
  moveEntityXZ(world, box, kbX * dt, kbZ * dt, 0.35);
  const damp = onGround ? 7.5 : 2.2;
  const k = Math.exp(-damp * dt);
  return { kbX: kbX * k, kbZ: kbZ * k };
}

export const DEATH_FLOP = 0.45;
export const DEATH_HOLD = 2;
export const DEATH_POP = 0.22;
export const DEATH_DUR = DEATH_FLOP + DEATH_HOLD + DEATH_POP;

export type DeathAnim = {
  t: number;
  sign: number;
};

export function beginDeath(fromX: number, fromZ: number, x: number, z: number): DeathAnim {
  const side = (x - fromX) * 0.31 + (z - fromZ);
  return { t: DEATH_DUR, sign: side >= 0 ? 1 : -1 };
}

/** Flop onto the side, lie still, then squash for the smoke pop. */
export function applyDeathPose(
  mesh: THREE.Group,
  x: number,
  y: number,
  z: number,
  yaw: number,
  height: number,
  death: DeathAnim,
  baseScale = 1,
): number {
  const elapsed = DEATH_DUR - Math.max(0, death.t);
  const flopU = Math.min(1, elapsed / DEATH_FLOP);
  const ease = flopU * flopU * (3 - 2 * flopU);
  const tilt = ease * (Math.PI * 0.52);
  mesh.rotation.order = "YXZ";
  mesh.rotation.y = yaw;
  mesh.rotation.x = ease * 0.2;
  mesh.rotation.z = death.sign * tilt;
  const lift = Math.sin(tilt) * Math.min(height, 1.5) * 0.3;
  mesh.position.set(x, y + lift, z);
  const pop = death.t < DEATH_POP ? 1 - death.t / DEATH_POP : 0;
  mesh.scale.setScalar(baseScale * (1 - pop * pop * 0.94));
  return elapsed / DEATH_DUR;
}
