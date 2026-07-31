import { isSolid } from "./blocks";

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

/**
 * Amanatides & Woo grid DDA through the voxel world.
 * Returns the first solid block along the ray, with the face entered from.
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
  // Normalize direction
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

  // If starting inside solid, still need face — step until we leave then re-enter? 
  // Standard: check starting cell first if solid and origin is "just inside"
  let faceX = 0;
  let faceY = 0;
  let faceZ = 0;
  let t = 0;

  // If the origin cell is solid, we're inside a block — skip until free then hit next
  // For mining, camera is never inside solid due to collision.

  for (let i = 0; i < 256; i++) {
    if (t > maxDist) return null;

    const id = getBlock(x, y, z);
    if (isSolid(id)) {
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
