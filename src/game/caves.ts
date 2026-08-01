import { fbm2, fbm3, ridged3, hash2 } from "./noise";

/**
 * Cave systems — mostly hidden under a solid surface crust.
 *  - rare tiny surface entrances (1–3 block holes, not craters)
 *  - short winding throats that branch into tunnels
 *  - larger halls / cathedrals deeper underground
 *  - spaghetti tunnels, shafts, cheese voids, galleries
 */

/** Grid spacing between potential surface entrances */
const ENTRANCE_CELL = 96;

/** Minimum solid blocks of crust above normal caves (entrances punch through) */
const CRUST = 5;

type Entrance = {
  ox: number;
  oz: number;
  dist: number;
  /** Horizontal radius of the surface hole (tiny) */
  radius: number;
  /** How deep the throat dives before joining the network */
  throatDepth: number;
  strength: number;
  id: number;
};

/**
 * Nearest small surface entrance, if any.
 * Intentional poke-holes — not sinkhole bowls.
 */
function sampleEntrance(
  wx: number,
  wz: number,
  seed: number,
): Entrance | null {
  const cx0 = Math.floor(wx / ENTRANCE_CELL);
  const cz0 = Math.floor(wz / ENTRANCE_CELL);
  let best: Entrance | null = null;

  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = cx0 + dx;
      const cz = cz0 + dz;
      const h = hash2(cx, cz, seed + 9001);
      // ~12% of cells — sparse
      if (h < 0.88) continue;

      const ox =
        cx * ENTRANCE_CELL +
        8 +
        hash2(cx, cz, seed + 11) * (ENTRANCE_CELL - 16);
      const oz =
        cz * ENTRANCE_CELL +
        8 +
        hash2(cx, cz, seed + 22) * (ENTRANCE_CELL - 16);
      const dist = Math.hypot(wx - ox, wz - oz);

      // Tiny mouths: ~1.2–2.8 block radius
      const sizeRoll = hash2(cx, cz, seed + 33);
      const radius = 1.15 + sizeRoll * 1.4 + hash2(cx, cz, seed + 34) * 0.35;
      const throatDepth = 12 + hash2(cx, cz, seed + 44) * 18 + sizeRoll * 8;
      const strength = 0.75 + (1 - h) * 0.25;
      const id = ((cx * 73856093) ^ (cz * 19349663) ^ seed) >>> 0;

      // Consider within a bit past the hole for throat wobble
      if (dist < Math.max(radius * 3.5, 8)) {
        if (!best || dist < best.dist) {
          best = { ox, oz, dist, radius, throatDepth, strength, id };
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
  if (wy <= 1) return false;
  if (wy > surfaceY + 1) return false;

  const entrance = sampleEntrance(wx, wz, seed);
  const depthBelow = surfaceY - wy;

  // --- Tiny surface entrance + winding throat with branches ---
  if (entrance) {
    const { ox, oz, radius, throatDepth, strength, id } = entrance;
    const maxThroat = throatDepth * strength;

    // Wiggle throat axis with depth so paths snake, not drill straight down
    const wobbleX =
      (fbm2(wy * 0.14 + id * 0.01, oz * 0.03, seed + 61, 3) - 0.5) *
      Math.min(5, 0.4 + depthBelow * 0.22);
    const wobbleZ =
      (fbm2(ox * 0.03, wy * 0.14 + id * 0.02, seed + 62, 3) - 0.5) *
      Math.min(5, 0.4 + depthBelow * 0.22);
    const d = Math.hypot(wx - (ox + wobbleX), wz - (oz + wobbleZ));

    // Surface hole only — small disk at top 1–2 blocks
    if (wy >= surfaceY - 1 && wy <= surfaceY) {
      const lip =
        (fbm2(wx * 0.5 + id * 0.01, wz * 0.5, seed + 55, 2) - 0.5) * 0.4;
      if (d < radius * (0.95 + lip)) return true;
    }

    // Throat body: narrow near surface, eases open as it deepens
    if (depthBelow > 0 && depthBelow <= maxThroat + 6) {
      const open =
        radius * 0.75 +
        Math.min(3.2, depthBelow * 0.12) +
        (fbm2(wx * 0.18, wy * 0.12, seed + 63, 2) - 0.5) * 0.9;

      if (d < open) return true;

      // Side branches peel off into horizontal tunnels
      if (depthBelow > 5 && d < open + 2.5) {
        const branch = ridged3(
          wx * 0.09 + id * 0.001,
          wy * 0.11,
          wz * 0.09,
          seed + 70,
          3,
        );
        if (branch > 0.8) return true;
      }

      // Extra fork near throat bottom — feeds the main network
      if (depthBelow > maxThroat * 0.55 && depthBelow < maxThroat + 4) {
        const fork = ridged3(
          wx * 0.06,
          wy * 0.05,
          wz * 0.06,
          seed + id + 80,
          3,
        );
        if (fork > 0.76 && d < open + 4) return true;
      }
    }
  }

  // Buried crust: no random surface breakthroughs
  if (depthBelow < CRUST) return false;

  // Domain warp — twisting, organic layout
  const w1 = fbm3(wx * 0.018, wy * 0.02, wz * 0.018, seed + 100, 3);
  const w2 = fbm3(
    wx * 0.018 + 40,
    wy * 0.02 + 20,
    wz * 0.018 + 10,
    seed + 101,
    3,
  );
  const w3 = fbm3(
    wx * 0.018 + 90,
    wy * 0.02 + 50,
    wz * 0.018 + 70,
    seed + 102,
    3,
  );
  const x = wx + (w1 - 0.5) * 28;
  const y = wy + (w2 - 0.5) * 18;
  const z = wz + (w3 - 0.5) * 28;

  const deep = Math.min(1, Math.max(0, (depthBelow - CRUST) / 40));

  // --- Branching spaghetti tunnels ---
  const tube = ridged3(x * 0.035, y * 0.04, z * 0.035, seed + 300, 4);
  const fat = fbm3(x * 0.02, y * 0.02, z * 0.02, seed + 301, 2);
  if (tube > 0.84 - fat * 0.07 - deep * 0.02) return true;

  const tube2 = ridged3(
    x * 0.055 + 30,
    y * 0.06,
    z * 0.055 + 30,
    seed + 310,
    3,
  );
  if (tube2 > 0.855 - deep * 0.015) return true;

  const tube3 = ridged3(
    x * 0.08 + 12,
    y * 0.09,
    z * 0.08 + 12,
    seed + 320,
    2,
  );
  if (tube3 > 0.88 && depthBelow > CRUST + 4) return true;

  // --- Mega halls / cathedrals (deeper only) ---
  const hall = fbm3(
    x * 0.0075,
    y * 0.009,
    z * 0.0075,
    seed + 200,
    5,
    2.0,
    0.52,
  );
  if (hall > 0.58 && hall < 0.74 && depthBelow > CRUST + 6) {
    const wall = fbm3(x * 0.04, y * 0.05, z * 0.04, seed + 201, 2);
    if (wall > 0.32) return true;
  }

  const cathedral = fbm3(x * 0.0045, y * 0.0055, z * 0.0045, seed + 210, 4);
  if (
    cathedral > 0.64 &&
    cathedral < 0.71 &&
    depthBelow > CRUST + 12 &&
    wy > 6
  ) {
    return true;
  }

  // --- Shafts (never break crust) ---
  const shaft = ridged3(x * 0.06, y * 0.015, z * 0.06, seed + 400, 3);
  const shaftMask = fbm2(wx * 0.03, wz * 0.03, seed + 401, 3);
  if (shaft > 0.87 && shaftMask > 0.55 && depthBelow > CRUST + 2) {
    return true;
  }

  // --- Cheese + galleries ---
  const cheese = fbm3(x * 0.022, y * 0.028, z * 0.022, seed + 500, 4);
  if (cheese > 0.68 && wy > 5 && depthBelow > CRUST + 4) {
    const shell = fbm3(x * 0.05, y * 0.05, z * 0.05, seed + 501, 2);
    if (shell > 0.4) return true;
  }

  const layer =
    Math.sin(y * 0.11 + fbm3(x * 0.02, 0, z * 0.02, seed + 600, 2) * 4);
  const layerN = fbm3(x * 0.03, y * 0.08, z * 0.03, seed + 601, 3);
  if (
    Math.abs(layer) < 0.12 &&
    layerN > 0.6 &&
    wy > 8 &&
    depthBelow > CRUST + 3
  ) {
    return true;
  }

  return false;
}

/**
 * Should this carved cell become water?
 * Water always fills as a flat table (never "towers" above the local surface).
 */
export function shouldFloodCave(
  wy: number,
  surfaceY: number,
  seaLevel: number,
  wx: number,
  wz: number,
  seed: number,
): boolean {
  if (wy >= seaLevel) return false;
  if (wy >= surfaceY) return false;

  if (surfaceY < seaLevel) {
    return wy < seaLevel;
  }

  const lake = fbm2(wx * 0.02, wz * 0.02, seed + 700, 3);
  if (lake <= 0.74) return false;
  if (wy >= surfaceY - 10) return false;

  const table =
    seaLevel -
    10 -
    Math.floor(fbm2(wx * 0.008, wz * 0.008, seed + 711, 2) * 14) -
    Math.floor((lake - 0.74) * 8);
  const waterTop = Math.min(table, surfaceY - 12, seaLevel - 2);
  if (waterTop < 6) return false;
  return wy <= waterTop;
}
