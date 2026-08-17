import { isMineable, isPlant, plantHitbox, isSourceWater } from "./blocks";

export type VoxelHit = {
  x: number;
  y: number;
  z: number;
  /** Face normal of the surface hit (points outward from the solid block) */
  nx: number;
  ny: number;
  nz: number;
  distance: number;
};

/** Ray vs AABB. Returns entry t (>=0) or null. */
function rayAabb(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): { t: number; nx: number; ny: number; nz: number } | null {
  let t0 = 0;
  let t1 = Infinity;
  let nx = 0;
  let ny = 0;
  let nz = 0;

  const axes: [number, number, number, number][] = [
    [ox, dx, minX, maxX],
    [oy, dy, minY, maxY],
    [oz, dz, minZ, maxZ],
  ];
  for (let a = 0; a < 3; a++) {
    const [o, d, mn, mx] = axes[a]!;
    if (Math.abs(d) < 1e-12) {
      if (o < mn || o > mx) return null;
      continue;
    }
    const inv = 1 / d;
    let ta = (mn - o) * inv;
    let tb = (mx - o) * inv;
    let nEnter = d > 0 ? -1 : 1;
    if (ta > tb) {
      const tmp = ta;
      ta = tb;
      tb = tmp;
      nEnter = -nEnter;
    }
    if (ta > t0) {
      t0 = ta;
      nx = a === 0 ? nEnter : 0;
      ny = a === 1 ? nEnter : 0;
      nz = a === 2 ? nEnter : 0;
    }
    if (tb < t1) t1 = tb;
    if (t0 > t1) return null;
  }
  if (t1 < 0) return null;
  return { t: t0, nx, ny, nz };
}

/**
 * Amanatides & Woo grid DDA through the voxel world.
 * Returns the first mineable block along the ray (solids + plants/flowers).
 * Plants use a tight center hitbox so rays can pass the corners to blocks behind.
 */
export function raycastVoxel(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDist: number,
  getBlock: (x: number, y: number, z: number) => number,
): VoxelHit | null {
  const len = Math.hypot(dx, dy, dz) || 1;
  dx /= len;
  dy /= len;
  dz /= len;

  let x = Math.floor(ox);
  let y = Math.floor(oy);
  let z = Math.floor(oz);

  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;

  const tDeltaX = stepX !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dz) : Infinity;

  let tMaxX =
    stepX > 0 ? (Math.floor(ox) + 1 - ox) * tDeltaX : stepX < 0 ? (ox - Math.floor(ox)) * tDeltaX : Infinity;
  let tMaxY =
    stepY > 0 ? (Math.floor(oy) + 1 - oy) * tDeltaY : stepY < 0 ? (oy - Math.floor(oy)) * tDeltaY : Infinity;
  let tMaxZ =
    stepZ > 0 ? (Math.floor(oz) + 1 - oz) * tDeltaZ : stepZ < 0 ? (oz - Math.floor(oz)) * tDeltaZ : Infinity;

  let faceX = 0;
  let faceY = 0;
  let faceZ = 0;
  let t = 0;

  for (let i = 0; i < 256; i++) {
    if (t > maxDist) return null;

    const id = getBlock(x, y, z);
    if (isPlant(id)) {
      const box = plantHitbox(id);
      const hit = rayAabb(
        ox,
        oy,
        oz,
        dx,
        dy,
        dz,
        x + box.minX,
        y + box.minY,
        z + box.minZ,
        x + box.maxX,
        y + box.maxY,
        z + box.maxZ,
      );
      if (hit && hit.t <= maxDist && hit.t >= 0) {
        return {
          x,
          y,
          z,
          nx: hit.nx,
          ny: hit.ny,
          nz: hit.nz,
          distance: hit.t,
        };
      }
      // Missed the stem — keep going (dirt / stone behind)
    } else if (isMineable(id)) {
      return {
        x,
        y,
        z,
        nx: -faceX,
        ny: -faceY,
        nz: -faceZ,
        distance: t,
      };
    }

    if (tMaxX < tMaxY) {
      if (tMaxX < tMaxZ) {
        t = tMaxX;
        tMaxX += tDeltaX;
        x += stepX;
        faceX = stepX;
        faceY = 0;
        faceZ = 0;
      } else {
        t = tMaxZ;
        tMaxZ += tDeltaZ;
        z += stepZ;
        faceX = 0;
        faceY = 0;
        faceZ = stepZ;
      }
    } else {
      if (tMaxY < tMaxZ) {
        t = tMaxY;
        tMaxY += tDeltaY;
        y += stepY;
        faceX = 0;
        faceY = stepY;
        faceZ = 0;
      } else {
        t = tMaxZ;
        tMaxZ += tDeltaZ;
        z += stepZ;
        faceX = 0;
        faceY = 0;
        faceZ = stepZ;
      }
    }
  }

  return null;
}

/** First still-water source along the look ray (skips flowing and solids). */
export function raycastWaterSource(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDist: number,
  getBlock: (x: number, y: number, z: number) => number,
): VoxelHit | null {
  const len = Math.hypot(dx, dy, dz) || 1;
  dx /= len;
  dy /= len;
  dz /= len;
  let x = Math.floor(ox);
  let y = Math.floor(oy);
  let z = Math.floor(oz);
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const tDeltaX = stepX !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dz) : Infinity;
  let tMaxX =
    stepX > 0 ? (Math.floor(ox) + 1 - ox) * tDeltaX : stepX < 0 ? (ox - Math.floor(ox)) * tDeltaX : Infinity;
  let tMaxY =
    stepY > 0 ? (Math.floor(oy) + 1 - oy) * tDeltaY : stepY < 0 ? (oy - Math.floor(oy)) * tDeltaY : Infinity;
  let tMaxZ =
    stepZ > 0 ? (Math.floor(oz) + 1 - oz) * tDeltaZ : stepZ < 0 ? (oz - Math.floor(oz)) * tDeltaZ : Infinity;
  let t = 0;
  for (let i = 0; i < 256; i++) {
    if (t > maxDist) return null;
    if (isSourceWater(getBlock(x, y, z))) {
      return { x, y, z, nx: 0, ny: 1, nz: 0, distance: t };
    }
    if (tMaxX < tMaxY) {
      if (tMaxX < tMaxZ) {
        t = tMaxX;
        tMaxX += tDeltaX;
        x += stepX;
      } else {
        t = tMaxZ;
        tMaxZ += tDeltaZ;
        z += stepZ;
      }
    } else if (tMaxY < tMaxZ) {
      t = tMaxY;
      tMaxY += tDeltaY;
      y += stepY;
    } else {
      t = tMaxZ;
      tMaxZ += tDeltaZ;
      z += stepZ;
    }
  }
  return null;
}
