import { fbm2, fbm3, ridged3, hash2 } from "./noise";

/**
 * Large, elaborate cave systems:
 *  - mega cavern halls (low-frequency 3D cheese)
 *  - spaghetti tunnels (ridged 3D)
 *  - vertical shafts / atriums
 *  - huge surface mouths / sinkholes that connect into the network
 */

const MOUTH_CELL = 72; // spacing between potential surface entrances

/** Surface mouth parameters at a world XZ (nearest strong mouth, if any) */
function sampleMouth(
  wx: number,
  wz: number,
  seed: number,
): { dist: number; radius: number; depth: number; strength: number } | null {
  const cx0 = Math.floor(wx / MOUTH_CELL);
  const cz0 = Math.floor(wz / MOUTH_CELL);
  let best: {
    dist: number;
    radius: number;
    depth: number;
    strength: number;
  } | null = null;

  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = cx0 + dx;
      const cz = cz0 + dz;
      const h = hash2(cx, cz, seed + 9001);
      // ~38% of cells host a mouth — many grand entrances across the world
      if (h < 0.62) continue;

      const ox = cx * MOUTH_CELL + hash2(cx, cz, seed + 11) * MOUTH_CELL;
      const oz = cz * MOUTH_CELL + hash2(cx, cz, seed + 22) * MOUTH_CELL;
      const dist = Math.hypot(wx - ox, wz - oz);

      // Extremely large mouths: 10–42 block radius, 24–90 deep
      const sizeRoll = hash2(cx, cz, seed + 33);
      const radius = 10 + sizeRoll * 32 + hash2(cx, cz, seed + 34) * 8;
      const depth = 24 + hash2(cx, cz, seed + 44) * 50 + sizeRoll * 16;
      const strength = 0.55 + (1 - h) * 0.45;

      if (dist < radius * 1.15) {
        if (!best || dist / radius < best.dist / best.radius) {
          best = { dist, radius, depth, strength };
        }
      }
    }
  }
  return best;
}

/**
 * Returns true if this solid cell should be carved into cave air (or later water).
 * surfaceY = solid surface height at this column.
 */
export function shouldCarveCave(
  wx: number,
  wy: number,
  wz: number,
  surfaceY: number,
  seed: number,
): boolean {
  // Protect bedrock band + leave a thin crust except at mouths
  if (wy <= 1) return false;
  if (wy > surfaceY + 2) return false;

  // --- Surface mouths / sinkholes (elaborate grand entrances) ---
  const mouth = sampleMouth(wx, wz, seed);
  if (mouth) {
    const { dist, radius, depth, strength } = mouth;
    const t = dist / Math.max(0.001, radius);
    // Bowl: deep in center, flaring lip at surface
    const bowlFloor = surfaceY - depth * (1 - t * t) * strength;
    // Jagged rim via noise
    const rimJitter =
      (fbm2(wx * 0.11, wz * 0.11, seed + 55, 3) - 0.5) * 4 * (1 - t);
    if (wy >= bowlFloor + rimJitter && wy <= surfaceY + 1 && t < 1.05) {
      // Keep outer lip irregular
      const lip = fbm2(wx * 0.07, wz * 0.07, seed + 66, 2);
      if (t < 0.92 || lip > 0.4) return true;
    }
    // Throat tunnel from bowl into the deep system
    if (t < 0.35 && wy < surfaceY && wy > bowlFloor - 8) {
      return true;
    }
  }

  // Below-surface only for the rest of the network (mouths already handled)
  if (wy >= surfaceY) return false;
  // Thin surface crust (2–4 blocks) unless mouth carved it
  if (wy > surfaceY - 3 && !mouth) {
    // Occasional crevasse cracks to surface
    const crack = ridged3(wx * 0.09, wy * 0.12, wz * 0.09, seed + 77, 3);
    if (crack < 0.88) return false;
  }

  // Domain warp — twisting, organic layout
  const w1 = fbm3(wx * 0.018, wy * 0.02, wz * 0.018, seed + 100, 3);
  const w2 = fbm3(wx * 0.018 + 40, wy * 0.02 + 20, wz * 0.018 + 10, seed + 101, 3);
  const w3 = fbm3(wx * 0.018 + 90, wy * 0.02 + 50, wz * 0.018 + 70, seed + 102, 3);
  const x = wx + (w1 - 0.5) * 28;
  const y = wy + (w2 - 0.5) * 18;
  const z = wz + (w3 - 0.5) * 28;

  // --- Mega cavern halls (huge voids) ---
  const hall = fbm3(x * 0.0075, y * 0.009, z * 0.0075, seed + 200, 5, 2.0, 0.52);
  // Thick shell band → vast chambers
  if (hall > 0.58 && hall < 0.74 && wy < surfaceY - 4) {
    // Irregular walls
    const wall = fbm3(x * 0.04, y * 0.05, z * 0.04, seed + 201, 2);
    if (wall > 0.32) return true;
  }

  // Even larger "cathedral" voids — rarer, enormous
  const cathedral = fbm3(x * 0.0045, y * 0.0055, z * 0.0045, seed + 210, 4);
  if (cathedral > 0.64 && cathedral < 0.71 && wy < surfaceY - 8 && wy > 6) {
    return true;
  }

  // --- Spaghetti / worm tunnels (connected arteries) ---
  const tube = ridged3(x * 0.035, y * 0.04, z * 0.035, seed + 300, 4);
  if (tube > 0.78) {
    // Vary radius with secondary noise
    const fat = fbm3(x * 0.02, y * 0.02, z * 0.02, seed + 301, 2);
    if (tube > 0.86 - fat * 0.08) return true;
  }
  // Second tunnel network at different scale (cross-links)
  const tube2 = ridged3(x * 0.055 + 30, y * 0.06, z * 0.055 + 30, seed + 310, 3);
  if (tube2 > 0.84) return true;

  // --- Vertical atriums / shafts ---
  const shaft = ridged3(x * 0.06, y * 0.015, z * 0.06, seed + 400, 3);
  const shaftMask = fbm2(wx * 0.03, wz * 0.03, seed + 401, 3);
  if (shaft > 0.87 && shaftMask > 0.55 && wy < surfaceY - 2) {
    return true;
  }

  // --- Cheese caves mid-depth ---
  const cheese = fbm3(x * 0.022, y * 0.028, z * 0.022, seed + 500, 4);
  if (cheese > 0.68 && wy > 5 && wy < surfaceY - 6) {
    const shell = fbm3(x * 0.05, y * 0.05, z * 0.05, seed + 501, 2);
    if (shell > 0.4) return true;
  }

  // --- Layered galleries (horizontal strata voids) ---
  const layer = Math.sin(y * 0.11 + fbm3(x * 0.02, 0, z * 0.02, seed + 600, 2) * 4);
  const layerN = fbm3(x * 0.03, y * 0.08, z * 0.03, seed + 601, 3);
  if (Math.abs(layer) < 0.12 && layerN > 0.6 && wy > 8 && wy < surfaceY - 5) {
    return true;
  }

  return false;
}

/**
 * Should this carved cell become water?
 * Water always fills as a flat table (never "towers" above the local surface).
 * - Ocean floor caves: fill up to seaLevel only
 * - Inland: flat underground lakes with a single water-table Y from noise
 */
export function shouldFloodCave(
  wy: number,
  surfaceY: number,
  seaLevel: number,
  wx: number,
  wz: number,
  seed: number,
): boolean {
  // Never place water at or above sea level in caves (surface plane owns that)
  if (wy >= seaLevel) return false;
  // Never flood into the open air above ground
  if (wy >= surfaceY) return false;

  // Under true ocean / coastal seafloor: flood open cells up to the flat sea plane
  if (surfaceY < seaLevel) {
    return wy < seaLevel;
  }

  // Inland underground lakes — single flat water table height
  const lake = fbm2(wx * 0.02, wz * 0.02, seed + 700, 3);
  if (lake <= 0.74) return false;
  if (wy >= surfaceY - 10) return false; // keep dry crust under land

  // Flat table: same Y across a region (smooth with low-freq noise)
  const table =
    seaLevel -
    10 -
    Math.floor(fbm2(wx * 0.008, wz * 0.008, seed + 711, 2) * 14) -
    Math.floor((lake - 0.74) * 8);
  const waterTop = Math.min(table, surfaceY - 12, seaLevel - 2);
  if (waterTop < 6) return false;
  // Fill only at/below the flat plane (not above)
  return wy <= waterTop;
}
