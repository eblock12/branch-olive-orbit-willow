import { isSolid, isWater } from "./blocks";
import { CHUNK_HEIGHT } from "./chunkConstants";
import {
  applyEntityGravity,
  entityOnGround,
  moveEntityXZ,
  unstickEntity,
  type EntityBox,
} from "./entityCollision";
import type { World } from "./world";

const SWIM_SPEED = 1.9;
const WATER_GRAVITY = 6;
const WATER_BUOYANCY = 9.2;
const WATER_DRAG = 4.6;
const WATER_ENTER_MAX = 7;
const SURFACE_HOP = 9.6;

export type EntityWaterSample = {
  any: boolean;
  feet: boolean;
  head: boolean;
};

export function sampleEntityWater(
  world: World,
  box: EntityBox,
): EntityWaterSample {
  const ix = Math.floor(box.x);
  const iz = Math.floor(box.z);
  const feet = isWater(world.getBlock(ix, Math.floor(box.y + 0.06), iz));
  const mid = isWater(
    world.getBlock(ix, Math.floor(box.y + box.height * 0.45), iz),
  );
  const head = isWater(
    world.getBlock(ix, Math.floor(box.y + Math.max(0.2, box.height * 0.82)), iz),
  );
  return { any: feet || mid || head, feet, head };
}

/** Nearby dry bank a drowning mob can aim for. */
export function findShore(
  world: World,
  x: number,
  z: number,
  y: number,
  maxR = 12,
): { x: number; z: number } | null {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  for (let r = 2; r <= maxR; r++) {
    const steps = r <= 4 ? 8 : 12;
    const spin = r * 0.37;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2 + spin;
      const sx = ix + Math.round(Math.cos(a) * r);
      const sz = iz + Math.round(Math.sin(a) * r);
      if (isDryBank(world, sx, sz, y)) return { x: sx + 0.5, z: sz + 0.5 };
    }
  }
  return null;
}

export function isDryBank(
  world: World,
  wx: number,
  wz: number,
  fromY: number,
): boolean {
  const y0 = Math.min(CHUNK_HEIGHT - 2, Math.floor(fromY) + 7);
  const y1 = Math.max(1, Math.floor(fromY) - 5);
  for (let y = y0; y >= y1; y--) {
    const id = world.getBlock(wx, y, wz);
    if (isWater(id)) continue;
    if (!isSolid(id)) continue;
    const above = world.getBlock(wx, y + 1, wz);
    const above2 = world.getBlock(wx, y + 2, wz);
    if (isWater(above) || isSolid(above)) continue;
    if (isWater(above2) || isSolid(above2)) continue;
    if (y + 1 > fromY + 3.6) continue;
    return true;
  }
  return false;
}

export function columnHasWaterSurface(world: World, x: number, z: number): boolean {
  const wx = Math.floor(x);
  const wz = Math.floor(z);
  for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
    const id = world.getBlock(wx, y, wz);
    if (isWater(id)) return true;
    if (isSolid(id)) return false;
  }
  return false;
}

/**
 * Water locomotion: drag, buoyancy, swim to surface, paddle toward wish,
 * hop onto a bank. Mutates box. Caller should skip land gravity this frame.
 */
export function applyEntitySwim(
  world: World,
  box: EntityBox,
  vy: number,
  dt: number,
  wishX: number,
  wishZ: number,
  speed = SWIM_SPEED,
): { vy: number; onGround: boolean; atSurface: boolean; hopped: boolean } {
  unstickEntity(world, box);
  const w = sampleEntityWater(world, box);
  const atSurface = w.any && !w.head;
  let hopped = false;

  if (vy < -WATER_ENTER_MAX) vy = -WATER_ENTER_MAX;

  const hop = vy > 4.2;
  const drag = Math.exp(-(hop ? 2.1 : WATER_DRAG) * dt);
  vy *= drag;
  vy += (WATER_BUOYANCY - WATER_GRAVITY) * dt;

  // Always work toward the surface
  const surfTarget = w.head ? speed * 1.2 : atSurface ? 0.28 : speed * 0.7;
  if (!hop && vy < surfTarget) {
    vy = Math.min(surfTarget, vy + 11 * dt);
  }

  const wlen = Math.hypot(wishX, wishZ);
  let ux = 0;
  let uz = 0;
  if (wlen > 1e-4) {
    ux = wishX / wlen;
    uz = wishZ / wlen;
    moveEntityXZ(world, box, ux * speed * dt, uz * speed * dt, 1.15);
  }

  // Don't rest on the seafloor
  if (vy <= 0.02 && w.any) vy = 0.35;

  const g = applyEntityGravity(world, box, vy, dt, hop ? 22 : 0, 18);
  vy = g.vy;

  if (atSurface && wlen > 1e-4) {
    const bx = Math.floor(box.x + ux * 0.85);
    const bz = Math.floor(box.z + uz * 0.85);
    if (isDryBank(world, bx, bz, box.y) && vy < SURFACE_HOP * 0.7) {
      vy = SURFACE_HOP;
      box.y += 0.05;
      hopped = true;
    }
  }

  const stillWet = sampleEntityWater(world, box).any;
  const onGround =
    !stillWet && entityOnGround(world, box.x, box.y, box.z, box.halfW);
  return { vy, onGround, atSurface, hopped };
}
