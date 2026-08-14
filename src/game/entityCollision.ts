import { cellCollidesAABB } from "./blocks";
import type { World } from "./world";

export type EntityBox = {
  x: number;
  y: number;
  z: number;
  halfW: number;
  height: number;
};

/**
 * Axis-aligned box vs solid voxels.
 * halfW is half-width on X/Z; height is full body height from feet.
 */
export function entityCollides(
  world: World,
  x: number,
  y: number,
  z: number,
  halfW: number,
  height: number,
): boolean {
  const eps = 1e-4;
  const minX = Math.floor(x - halfW);
  const maxX = Math.floor(x + halfW - eps);
  const minY = Math.floor(y + eps);
  const maxY = Math.floor(y + height - eps);
  const minZ = Math.floor(z - halfW);
  const maxZ = Math.floor(z + halfW - eps);

  for (let by = minY; by <= maxY; by++) {
    for (let bz = minZ; bz <= maxZ; bz++) {
      for (let bx = minX; bx <= maxX; bx++) {
        if (
          cellCollidesAABB(
            world.getBlock(bx, by, bz),
            bx,
            by,
            bz,
            x - halfW,
            y + eps,
            z - halfW,
            x + halfW - eps,
            y + height - eps,
            z + halfW - eps,
          )
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

/** True if a solid exists under the feet (within small probe). */
export function entityOnGround(
  world: World,
  x: number,
  y: number,
  z: number,
  halfW: number,
  probe = 0.08,
): boolean {
  return entityCollides(world, x, y - probe, z, halfW, probe + 0.02);
}

/**
 * Move entity on XZ with axis separation and wall slide.
 * Does NOT auto-step onto blocks — callers must hop (vy impulse) to climb.
 * Mutates `box.x/y/z`.
 * `canStep` = blocked by a ~1-block ledge that a hop could clear.
 */
export function moveEntityXZ(
  world: World,
  box: EntityBox,
  dx: number,
  dz: number,
  /** If > 0, only used to *detect* climbable ledges (never teleports). */
  stepProbe = 1.05,
): { blocked: boolean; canStep: boolean } {
  let blocked = false;
  let canStep = false;

  const dist = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.min(6, Math.ceil(dist / 0.25)));
  const sdx = dx / steps;
  const sdz = dz / steps;

  for (let i = 0; i < steps; i++) {
    const r = moveEntityXZOnce(world, box, sdx, sdz, stepProbe);
    if (r.blocked) blocked = true;
    if (r.canStep) canStep = true;
  }
  return { blocked, canStep };
}

function moveEntityXZOnce(
  world: World,
  box: EntityBox,
  dx: number,
  dz: number,
  stepProbe: number,
): { blocked: boolean; canStep: boolean } {
  let blocked = false;
  let canStep = false;
  const { halfW, height } = box;

  if (dx !== 0) {
    const nx = box.x + dx;
    if (!entityCollides(world, nx, box.y, box.z, halfW, height)) {
      box.x = nx;
    } else {
      if (
        stepProbe > 0 &&
        !entityCollides(world, box.x, box.y + stepProbe, box.z, halfW, height) &&
        !entityCollides(world, nx, box.y + stepProbe, box.z, halfW, height)
      ) {
        canStep = true;
      }
      if (dx > 0) {
        const edge = Math.floor(box.x + halfW + dx) - halfW - 1e-4;
        if (
          edge > box.x &&
          !entityCollides(world, edge, box.y, box.z, halfW, height)
        ) {
          box.x = edge;
        }
      } else {
        const edge = Math.floor(box.x - halfW + dx) + 1 + halfW + 1e-4;
        if (
          edge < box.x &&
          !entityCollides(world, edge, box.y, box.z, halfW, height)
        ) {
          box.x = edge;
        }
      }
      blocked = true;
    }
  }

  if (dz !== 0) {
    const nz = box.z + dz;
    if (!entityCollides(world, box.x, box.y, nz, halfW, height)) {
      box.z = nz;
    } else {
      if (
        stepProbe > 0 &&
        !entityCollides(world, box.x, box.y + stepProbe, box.z, halfW, height) &&
        !entityCollides(world, box.x, box.y + stepProbe, nz, halfW, height)
      ) {
        canStep = true;
      }
      if (dz > 0) {
        const edge = Math.floor(box.z + halfW + dz) - halfW - 1e-4;
        if (
          edge > box.z &&
          !entityCollides(world, box.x, box.y, edge, halfW, height)
        ) {
          box.z = edge;
        }
      } else {
        const edge = Math.floor(box.z - halfW + dz) + 1 + halfW + 1e-4;
        if (
          edge < box.z &&
          !entityCollides(world, box.x, box.y, edge, halfW, height)
        ) {
          box.z = edge;
        }
      }
      blocked = true;
    }
  }

  return { blocked, canStep };
}

/**
 * Integrate vertical motion with gravity + AABB collision.
 * No teleporting to surface Y — entities fall smoothly off edges/cliffs.
 */
export function applyEntityGravity(
  world: World,
  box: EntityBox,
  vy: number,
  dt: number,
  gravity = 28,
  terminal = 42,
): { vy: number; onGround: boolean } {
  unstickEntity(world, box);

  let onGround = entityOnGround(world, box.x, box.y, box.z, box.halfW);
  if (onGround && vy <= 0.01) {
    // Resting: nudge into contact without large snaps
    refineGroundContact(world, box);
    return { vy: 0, onGround: true };
  }

  // Apply gravity
  vy -= gravity * dt;
  if (vy < -terminal) vy = -terminal;

  // Sub-step Y so we don't tunnel through floors
  let dy = vy * dt;
  const maxStep = 0.3;
  const steps = Math.max(1, Math.min(12, Math.ceil(Math.abs(dy) / maxStep)));
  const sdy = dy / steps;

  for (let i = 0; i < steps; i++) {
    const ny = box.y + sdy;
    if (!entityCollides(world, box.x, ny, box.z, box.halfW, box.height)) {
      box.y = ny;
      continue;
    }
    // Hit something — binary search contact
    if (sdy < 0) {
      // Floor
      let lo = 0;
      let hi = -sdy;
      for (let k = 0; k < 8; k++) {
        const mid = (lo + hi) * 0.5;
        if (
          entityCollides(
            world,
            box.x,
            box.y - mid,
            box.z,
            box.halfW,
            box.height,
          )
        )
          hi = mid;
        else lo = mid;
      }
      box.y -= lo;
      vy = 0;
      onGround = true;
      refineGroundContact(world, box);
      return { vy: 0, onGround: true };
    } else {
      // Ceiling
      let lo = 0;
      let hi = sdy;
      for (let k = 0; k < 8; k++) {
        const mid = (lo + hi) * 0.5;
        if (
          entityCollides(
            world,
            box.x,
            box.y + mid,
            box.z,
            box.halfW,
            box.height,
          )
        )
          hi = mid;
        else lo = mid;
      }
      box.y += lo;
      vy = 0;
      break;
    }
  }

  onGround = entityOnGround(world, box.x, box.y, box.z, box.halfW);
  if (onGround && vy < 0) vy = 0;
  return { vy, onGround };
}

/** Micro-adjust feet to sit cleanly on top of solid (≤0.12 blocks). */
function refineGroundContact(world: World, box: EntityBox): void {
  // If slightly floating, drop a little
  if (
    !entityCollides(world, box.x, box.y - 0.02, box.z, box.halfW, box.height)
  ) {
    let drop = 0;
    while (
      drop < 0.12 &&
      !entityCollides(
        world,
        box.x,
        box.y - 0.02,
        box.z,
        box.halfW,
        box.height,
      )
    ) {
      box.y -= 0.02;
      drop += 0.02;
    }
    // back up one step into free space then contact
    if (entityCollides(world, box.x, box.y, box.z, box.halfW, box.height)) {
      box.y += 0.02;
    }
  }
  // If embedded, push up a little
  if (entityCollides(world, box.x, box.y, box.z, box.halfW, box.height)) {
    for (let i = 0; i < 8; i++) {
      box.y += 0.05;
      if (!entityCollides(world, box.x, box.y, box.z, box.halfW, box.height)) {
        break;
      }
    }
  }
}

/**
 * @deprecated Prefer applyEntityGravity — kept for spawn placement only.
 * Instant place on surface (spawn / respawn), not per-frame.
 */
export function snapEntityToGround(world: World, box: EntityBox): void {
  const sx = Math.floor(box.x);
  const sz = Math.floor(box.z);
  const surface = world.getSurfaceY(sx, sz);
  box.y = surface;
  // Ensure not inside a block
  for (let i = 0; i < 12; i++) {
    if (!entityCollides(world, box.x, box.y, box.z, box.halfW, box.height)) break;
    box.y += 0.25;
  }
  unstickEntity(world, box);
}

/** Push entity out of solid voxels (upward preferred, then horizontal). */
export function unstickEntity(world: World, box: EntityBox): void {
  if (!entityCollides(world, box.x, box.y, box.z, box.halfW, box.height)) return;

  for (let i = 1; i <= 8; i++) {
    const ny = box.y + i * 0.25;
    if (!entityCollides(world, box.x, ny, box.z, box.halfW, box.height)) {
      box.y = ny;
      return;
    }
  }
  for (const [ox, oz] of [
    [0.5, 0],
    [-0.5, 0],
    [0, 0.5],
    [0, -0.5],
    [0.5, 0.5],
    [-0.5, -0.5],
  ] as const) {
    if (
      !entityCollides(
        world,
        box.x + ox,
        box.y,
        box.z + oz,
        box.halfW,
        box.height,
      )
    ) {
      box.x += ox;
      box.z += oz;
      return;
    }
  }
}
