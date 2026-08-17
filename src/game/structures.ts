import { Block, isPlant } from "./blocks";
import { Biome, type BiomeId } from "./biomes";
import { hash2, fbm2 } from "./noise";
import { CHUNK_SIZE, CHUNK_HEIGHT, SEA_LEVEL } from "./chunkConstants";

export const STRUCT_CELL = 52;

/** Structure-cell buddy — involution so both ends always generate. */
export function portalPartnerCell(cx: number, cz: number): [number, number] {
  // 20×7 cells × 52 ≈ 1100 blocks; one even/one odd so parity flips back.
  const even = ((cx + cz * 3) & 1) === 0;
  return even ? [cx + 20, cz + 7] : [cx - 20, cz - 7];
}

/** Always-on pair so a rift is walkable from spawn. Cell (1,0) ↔ partner. */
export const STARTER_PORTAL_CELL: [number, number] = [1, 0];

export function isStarterPortalCell(cx: number, cz: number): boolean {
  const [ax, az] = STARTER_PORTAL_CELL;
  if (cx === ax && cz === az) return true;
  const [px, pz] = portalPartnerCell(ax, az);
  return cx === px && cz === pz;
}

export function cellHasLinkedPortal(
  cxCell: number,
  czCell: number,
  seed: number,
): boolean {
  if (isStarterPortalCell(cxCell, czCell)) return true;
  const [px, pz] = portalPartnerCell(cxCell, czCell);
  const ax = cxCell < px || (cxCell === px && czCell < pz) ? cxCell : px;
  const az = ax === cxCell ? czCell : pz;
  return hash2(ax, az, seed + 4242) > 0.93;
}

export function portalAnchor(
  cxCell: number,
  czCell: number,
  seed: number,
): { ox: number; oz: number } {
  const [ax, az] = STARTER_PORTAL_CELL;
  if (cxCell === ax && czCell === az) return { ox: 26, oz: 10 };
  const [px, pz] = portalPartnerCell(ax, az);
  if (cxCell === px && czCell === pz) return { ox: px * STRUCT_CELL + 18, oz: pz * STRUCT_CELL + 18 };
  return {
    ox:
      cxCell * STRUCT_CELL +
      Math.floor(hash2(cxCell, czCell, seed + 100) * (STRUCT_CELL - 8)) +
      4,
    oz:
      czCell * STRUCT_CELL +
      Math.floor(hash2(cxCell, czCell, seed + 101) * (STRUCT_CELL - 8)) +
      4,
  };
}

/** Interior of a generated frame (block mins, exclusive max on x/y). */
export const PORTAL_INNER_W = 3;
export const PORTAL_INNER_H = 4;

type SurfaceFn = (
  wx: number,
  wz: number,
) => { height: number; biome: BiomeId };

type Ctx = {
  blocks: Uint8Array;
  cx: number;
  cz: number;
  seed: number;
  surfaceAt: SurfaceFn;
};

function idx(x: number, y: number, z: number): number {
  return x + z * CHUNK_SIZE + y * CHUNK_SIZE * CHUNK_SIZE;
}

function inChunk(lx: number, ly: number, lz: number): boolean {
  return (
    lx >= 0 &&
    lz >= 0 &&
    ly >= 0 &&
    lx < CHUNK_SIZE &&
    lz < CHUNK_SIZE &&
    ly < CHUNK_HEIGHT
  );
}

function setBlock(
  ctx: Ctx,
  wx: number,
  wy: number,
  wz: number,
  id: number,
  replaceAirOnly = false,
): void {
  const baseX = ctx.cx * CHUNK_SIZE;
  const baseZ = ctx.cz * CHUNK_SIZE;
  const lx = wx - baseX;
  const lz = wz - baseZ;
  if (!inChunk(lx, wy, lz)) return;
  const i = idx(lx, wy, lz);
  if (replaceAirOnly && ctx.blocks[i] !== Block.AIR && ctx.blocks[i] !== Block.WATER) {
    const cur = ctx.blocks[i]!;
    if (cur !== Block.LEAVES && cur !== Block.WOOD && cur !== Block.CACTUS) return;
  }
  if (ctx.blocks[i] === Block.BEDROCK) return;
  ctx.blocks[i] = id;
}

function fillBox(
  ctx: Ctx,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  id: number,
  hollow = false,
): void {
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);
  const minZ = Math.min(z0, z1);
  const maxZ = Math.max(z0, z1);
  for (let y = minY; y <= maxY; y++) {
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        if (hollow) {
          const edge =
            x === minX ||
            x === maxX ||
            y === minY ||
            y === maxY ||
            z === minZ ||
            z === maxZ;
          if (!edge) continue;
        }
        setBlock(ctx, x, y, z, id);
      }
    }
  }
}

function clearBox(
  ctx: Ctx,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
): void {
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);
  const minZ = Math.min(z0, z1);
  const maxZ = Math.max(z0, z1);
  for (let y = minY; y <= maxY; y++) {
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        setBlock(ctx, x, y, z, Block.AIR);
      }
    }
  }
}

/** Blocks that can hold a structure (not air/water/plants/leaves). */
function isSupportBlock(id: number): boolean {
  if (id === Block.AIR || id === Block.WATER) return false;
  if (id === Block.LEAVES) return false;
  if (isPlant(id)) return false;
  return true;
}

/**
 * Topmost solid Y in this column using actual chunk voxels when available
 * (so caves under the "surface" don't leave floating floors).
 */
function topSolidY(ctx: Ctx, wx: number, wz: number): number {
  const baseX = ctx.cx * CHUNK_SIZE;
  const baseZ = ctx.cz * CHUNK_SIZE;
  const lx = wx - baseX;
  const lz = wz - baseZ;
  if (lx >= 0 && lz >= 0 && lx < CHUNK_SIZE && lz < CHUNK_SIZE) {
    for (let y = CHUNK_HEIGHT - 1; y >= 1; y--) {
      const b = ctx.blocks[idx(lx, y, lz)]!;
      if (isSupportBlock(b)) return y;
    }
    return 1;
  }
  // Outside this chunk — terrain estimate only
  return Math.max(1, ctx.surfaceAt(wx, wz).height);
}

function footprintStats(
  ctx: Ctx,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
): { minY: number; maxY: number; avgY: number; delta: number } {
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minZ = Math.min(z0, z1);
  const maxZ = Math.max(z0, z1);
  let minY = Infinity;
  let maxY = -Infinity;
  let sum = 0;
  let n = 0;
  for (let z = minZ; z <= maxZ; z++) {
    for (let x = minX; x <= maxX; x++) {
      const y = topSolidY(ctx, x, z);
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      sum += y;
      n++;
    }
  }
  if (n === 0) return { minY: 1, maxY: 1, avgY: 1, delta: 0 };
  return {
    minY,
    maxY,
    avgY: sum / n,
    delta: maxY - minY,
  };
}

/**
 * Choose a grounded floor Y for a footprint.
 * Rejects underwater / too steep sites. Floor sits on the lowest solid so
 * nothing hangs in air; hills are flattened down to floorY.
 */
function siteFloorY(
  ctx: Ctx,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  opts?: {
    maxSlope?: number;
    minAboveSea?: number;
    allowUnderwater?: boolean;
  },
): number | null {
  const stats = footprintStats(ctx, x0, z0, x1, z1);
  const minAbove = opts?.minAboveSea ?? 1;
  const maxSlope = opts?.maxSlope ?? 5;
  if (!opts?.allowUnderwater && stats.minY <= SEA_LEVEL + minAbove - 1) {
    return null;
  }
  if (stats.minY <= 2) return null;
  if (stats.delta > maxSlope) return null;
  return stats.minY;
}

/**
 * Make sure every column under [x0..x1]×[z0..z1] has solid blocks from the
 * real ground up to floorY (fills cave mouths / dips). Optionally flattens
 * terrain above the floor so the structure isn't buried in a hillside.
 */
function ensureFoundations(
  ctx: Ctx,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  floorY: number,
  mat: number = Block.COBBLE,
  flattenAbove = true,
): void {
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minZ = Math.min(z0, z1);
  const maxZ = Math.max(z0, z1);
  for (let z = minZ; z <= maxZ; z++) {
    for (let x = minX; x <= maxX; x++) {
      const g = topSolidY(ctx, x, z);
      // Fill stilts / cave gaps up to just below floor
      if (g < floorY) {
        for (let y = g + 1; y < floorY; y++) {
          setBlock(ctx, x, y, z, mat);
        }
        // Pad under floor
        setBlock(ctx, x, floorY - 1, z, mat);
      }
      // Carve hill poking through the floor plane
      if (flattenAbove && g >= floorY) {
        for (let y = floorY; y <= g + 1; y++) {
          // Leave the floor plane for the structure to paint; clear above
          if (y > floorY) setBlock(ctx, x, y, z, Block.AIR);
        }
        // Solid support under floor
        setBlock(ctx, x, floorY - 1, z, mat);
      }
      // Always guarantee a solid under the floor cell
      if (floorY - 1 >= 1) {
        const baseX = ctx.cx * CHUNK_SIZE;
        const baseZ = ctx.cz * CHUNK_SIZE;
        const lx = x - baseX;
        const lz = z - baseZ;
        if (inChunk(lx, floorY - 1, lz)) {
          const under = ctx.blocks[idx(lx, floorY - 1, lz)]!;
          if (!isSupportBlock(under)) {
            setBlock(ctx, x, floorY - 1, z, mat);
          }
        }
      }
    }
  }
}

/** Single-column foundation (posts, stones, masts). */
function ensureColumnGrounded(
  ctx: Ctx,
  wx: number,
  wz: number,
  baseY: number,
  mat: number = Block.COBBLE,
): number {
  const g = topSolidY(ctx, wx, wz);
  if (g < baseY - 1) {
    for (let y = g + 1; y < baseY; y++) setBlock(ctx, wx, y, wz, mat);
  }
  if (baseY - 1 >= 1 && g < baseY) {
    setBlock(ctx, wx, baseY - 1, wz, mat);
  }
  return Math.max(g, baseY - 1);
}

function pillar(
  ctx: Ctx,
  wx: number,
  y0: number,
  wz: number,
  h: number,
  id: number,
): void {
  for (let i = 0; i < h; i++) setBlock(ctx, wx, y0 + i, wz, id);
}

/** One loot chest on/above a solid cell. */
function placeLootChest(ctx: Ctx, wx: number, wy: number, wz: number): void {
  const g = topSolidY(ctx, wx, wz);
  const y = wy > g ? wy : g + 1;
  if (y < 2 || y >= CHUNK_HEIGHT - 1) return;
  setBlock(ctx, wx, y, wz, Block.CHEST);
}

// ─── Structure types ────────────────────────────────────────────

function placeWatchtower(ctx: Ctx, ox: number, oz: number): void {
  const floor = siteFloorY(ctx, ox - 2, oz - 2, ox + 2, oz + 2, {
    maxSlope: 4,
    minAboveSea: 2,
  });
  if (floor === null) return;
  const y = floor;
  ensureFoundations(ctx, ox - 2, oz - 2, ox + 2, oz + 2, y, Block.COBBLE);
  const H = 10 + Math.floor(hash2(ox, oz, ctx.seed + 3) * 6);
  fillBox(ctx, ox - 2, y - 1, oz - 2, ox + 2, y, oz + 2, Block.COBBLE);
  for (let dy = 1; dy <= H; dy++) {
    fillBox(ctx, ox - 1, y + dy, oz - 1, ox + 1, y + dy, oz + 1, Block.COBBLE, true);
    if (dy % 4 === 0) {
      fillBox(ctx, ox - 1, y + dy, oz - 1, ox + 1, y + dy, oz + 1, Block.PLANKS);
      setBlock(ctx, ox, y + dy, oz, Block.COBBLE);
    }
  }
  setBlock(ctx, ox, y + 1, oz - 1, Block.AIR);
  setBlock(ctx, ox, y + 2, oz - 1, Block.AIR);
  const top = y + H;
  fillBox(ctx, ox - 2, top, oz - 2, ox + 2, top, oz + 2, Block.COBBLE);
  for (const [dx, dz] of [
    [-2, -2],
    [2, -2],
    [-2, 2],
    [2, 2],
    [0, -2],
    [0, 2],
    [-2, 0],
    [2, 0],
  ] as const) {
    setBlock(ctx, ox + dx, top + 1, oz + dz, Block.COBBLE);
  }
  pillar(ctx, ox, top + 1, oz, 3, Block.WOOD);
  setBlock(ctx, ox, top + 4, oz, Block.LEAVES);
  setBlock(ctx, ox + 1, y + 1, oz, Block.CHEST);
}

function placeCabin(ctx: Ctx, ox: number, oz: number): void {
  const w = 4;
  const d = 5;
  const floor = siteFloorY(ctx, ox - w, oz - d, ox + w, oz + d, {
    maxSlope: 3,
    minAboveSea: 1,
  });
  if (floor === null) return;
  const y = floor;
  ensureFoundations(ctx, ox - w, oz - d, ox + w, oz + d, y, Block.COBBLE);
  const h = 3;
  fillBox(ctx, ox - w, y, oz - d, ox + w, y, oz + d, Block.PLANKS);
  fillBox(ctx, ox - w, y + 1, oz - d, ox + w, y + h, oz + d, Block.WOOD, true);
  clearBox(ctx, ox - w + 1, y + 1, oz - d + 1, ox + w - 1, y + h - 1, oz + d - 1);
  setBlock(ctx, ox, y + 1, oz - d, Block.AIR);
  setBlock(ctx, ox, y + 2, oz - d, Block.AIR);
  setBlock(ctx, ox - w, y + 2, oz, Block.AIR);
  setBlock(ctx, ox + w, y + 2, oz, Block.AIR);
  for (let layer = 0; layer <= w + 1; layer++) {
    fillBox(
      ctx,
      ox - w + layer,
      y + h + layer,
      oz - d,
      ox + w - layer,
      y + h + layer,
      oz + d,
      Block.PLANKS,
    );
  }
  pillar(ctx, ox + w - 1, y + 1, oz + d - 1, h + 3, Block.COBBLE);
  setBlock(ctx, ox + w - 1, y + 1, oz - d + 1, Block.CHEST);
  setBlock(ctx, ox - w + 1, y + 1, oz + d - 1, Block.BED);
}

function placeStoneCircle(ctx: Ctx, ox: number, oz: number): void {
  const R = 5 + Math.floor(hash2(ox, oz, ctx.seed + 9) * 3);
  const floor = siteFloorY(ctx, ox - R, oz - R, ox + R, oz + R, {
    maxSlope: 6,
    minAboveSea: 0,
  });
  if (floor === null) return;
  ensureFoundations(ctx, ox - 1, oz - 1, ox + 1, oz + 1, floor, Block.COBBLE);
  const stones = 7 + Math.floor(hash2(ox, oz, ctx.seed + 10) * 5);
  for (let i = 0; i < stones; i++) {
    const a = (i / stones) * Math.PI * 2;
    const sx = ox + Math.round(Math.cos(a) * R);
    const sz = oz + Math.round(Math.sin(a) * R);
    const sy = topSolidY(ctx, sx, sz);
    if (sy <= SEA_LEVEL - 1) continue;
    ensureColumnGrounded(ctx, sx, sz, sy + 1, Block.STONE);
    const tall = 2 + Math.floor(hash2(sx, sz, ctx.seed + i) * 3);
    pillar(ctx, sx, sy + 1, sz, tall, Block.STONE);
    if (hash2(sx, sz, ctx.seed + 40 + i) > 0.55) {
      setBlock(ctx, sx, sy + tall + 1, sz, Block.COBBLE);
    }
  }
  fillBox(ctx, ox - 1, floor + 1, oz - 1, ox + 1, floor + 1, oz + 1, Block.COBBLE);
  setBlock(ctx, ox, floor + 2, oz, Block.ICE);
  placeLootChest(ctx, ox + 2, floor + 1, oz);
}

function placeObelisk(ctx: Ctx, ox: number, oz: number): void {
  const floor = siteFloorY(ctx, ox - 2, oz - 2, ox + 2, oz + 2, {
    maxSlope: 4,
    minAboveSea: -1,
  });
  if (floor === null) return;
  const y = floor;
  ensureFoundations(ctx, ox - 2, oz - 2, ox + 2, oz + 2, y, Block.STONE);
  const H = 14 + Math.floor(hash2(ox, oz, ctx.seed + 11) * 12);
  fillBox(ctx, ox - 2, y, oz - 2, ox + 2, y + 1, oz + 2, Block.STONE);
  for (let dy = 2; dy < H; dy++) {
    const taper = dy > H * 0.7 ? 0 : 1;
    fillBox(
      ctx,
      ox - taper,
      y + dy,
      oz - taper,
      ox + taper,
      y + dy,
      oz + taper,
      Block.STONE,
    );
  }
  setBlock(ctx, ox, y + H, oz, Block.ICE);
  setBlock(ctx, ox, y + H + 1, oz, Block.ICE);
  placeLootChest(ctx, ox + 2, y + 1, oz + 1);
}

function placePyramid(ctx: Ctx, ox: number, oz: number): void {
  const base = 6 + Math.floor(hash2(ox, oz, ctx.seed + 12) * 3);
  const floor = siteFloorY(ctx, ox - base, oz - base, ox + base, oz + base, {
    maxSlope: 4,
    minAboveSea: 0,
  });
  if (floor === null) return;
  const y = floor;
  ensureFoundations(
    ctx,
    ox - base,
    oz - base,
    ox + base,
    oz + base,
    y,
    Block.SAND,
  );
  const mat = Block.SAND;
  const core = Block.STONE;
  for (let layer = 0; layer <= base; layer++) {
    const r = base - layer;
    fillBox(ctx, ox - r, y + layer, oz - r, ox + r, y + layer, oz + r, mat);
  }
  clearBox(ctx, ox - 1, y + 1, oz - 1, ox + 1, y + 3, oz + 1);
  setBlock(ctx, ox, y + 1, oz - base, Block.AIR);
  setBlock(ctx, ox, y + 2, oz - base, Block.AIR);
  for (let z = -base; z <= 0; z++) {
    setBlock(ctx, ox, y + 1, oz + z, Block.AIR);
    setBlock(ctx, ox, y + 2, oz + z, Block.AIR);
  }
  setBlock(ctx, ox, y + 1, oz, core);
  setBlock(ctx, ox + 1, y + 1, oz, Block.CHEST);
}

function placeShipwreck(ctx: Ctx, ox: number, oz: number): void {
  // Rest on seafloor / beach solids, not floating mid-water column
  const g = topSolidY(ctx, ox, oz);
  if (g < 3) return;
  const y = Math.min(Math.max(g, SEA_LEVEL - 4), SEA_LEVEL);
  const len = 8 + Math.floor(hash2(ox, oz, ctx.seed + 13) * 5);
  const dir = hash2(ox, oz, ctx.seed + 14) > 0.5 ? 1 : 0;
  for (let i = -len; i <= len; i++) {
    const t = 1 - Math.abs(i) / (len + 1);
    const beam = Math.max(1, Math.floor(t * 3));
    for (let b = -beam; b <= beam; b++) {
      const wx = dir ? ox + i : ox + b;
      const wz = dir ? oz + b : oz + i;
      // Local ground so hull follows sand/rock, not a flat float
      const gy = topSolidY(ctx, wx, wz);
      const deck = Math.min(Math.max(gy, SEA_LEVEL - 4), y + 1);
      ensureColumnGrounded(ctx, wx, wz, deck, Block.SAND);
      setBlock(ctx, wx, deck, wz, Block.WOOD);
      if (Math.abs(b) === beam) {
        setBlock(ctx, wx, deck + 1, wz, Block.WOOD);
        if (t > 0.4) setBlock(ctx, wx, deck + 2, wz, Block.PLANKS);
      }
    }
    if (i % 3 === 0) {
      const wx = dir ? ox + i : ox;
      const wz = dir ? oz : oz + i;
      const gy = topSolidY(ctx, wx, wz);
      const deck = Math.min(Math.max(gy, SEA_LEVEL - 4), y + 1);
      setBlock(ctx, wx, deck + 1, wz, Block.PLANKS);
    }
  }
  const mastBase = Math.max(topSolidY(ctx, ox, oz), SEA_LEVEL - 3);
  ensureColumnGrounded(ctx, ox, oz, mastBase + 1, Block.WOOD);
  pillar(ctx, ox, mastBase + 1, oz, 5, Block.WOOD);
  setBlock(ctx, ox + 1, mastBase + 5, oz, Block.PLANKS);
  setBlock(ctx, ox + 2, mastBase + 4, oz, Block.PLANKS);
  placeLootChest(ctx, ox - 2, mastBase + 1, oz);
}

function placeWell(ctx: Ctx, ox: number, oz: number): void {
  const floor = siteFloorY(ctx, ox - 1, oz - 1, ox + 1, oz + 1, {
    maxSlope: 3,
    minAboveSea: 1,
  });
  if (floor === null) return;
  const y = floor;
  ensureFoundations(ctx, ox - 1, oz - 1, ox + 1, oz + 1, y, Block.COBBLE);
  fillBox(ctx, ox - 1, y, oz - 1, ox + 1, y + 1, oz + 1, Block.COBBLE, true);
  clearBox(ctx, ox, y - 6, oz, ox, y + 1, oz);
  for (let dy = 0; dy <= 4; dy++) {
    setBlock(ctx, ox, y - dy, oz, Block.WATER);
  }
  setBlock(ctx, ox - 1, y + 2, oz - 1, Block.WOOD);
  setBlock(ctx, ox + 1, y + 2, oz - 1, Block.WOOD);
  setBlock(ctx, ox - 1, y + 2, oz + 1, Block.WOOD);
  setBlock(ctx, ox + 1, y + 2, oz + 1, Block.WOOD);
  fillBox(ctx, ox - 1, y + 3, oz - 1, ox + 1, y + 3, oz + 1, Block.PLANKS);
  placeLootChest(ctx, ox + 2, y + 1, oz);
}

function placeGiantMushroom(ctx: Ctx, ox: number, oz: number): void {
  const floor = siteFloorY(ctx, ox, oz, ox, oz, {
    maxSlope: 2,
    minAboveSea: 1,
  });
  if (floor === null) return;
  const y = floor;
  ensureColumnGrounded(ctx, ox, oz, y + 1, Block.DIRT);
  const H = 6 + Math.floor(hash2(ox, oz, ctx.seed + 15) * 5);
  pillar(ctx, ox, y + 1, oz, H, Block.MUSHROOM_STEM);
  const r = 3 + Math.floor(hash2(ox, oz, ctx.seed + 16) * 2);
  const capY = y + H;
  const cap =
    hash2(ox, oz, ctx.seed + 17) > 0.5
      ? Block.MUSHROOM_CAP_CYAN
      : Block.MUSHROOM_CAP_RED;
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dz * dz > r * r + 1) continue;
      setBlock(ctx, ox + dx, capY, oz + dz, cap);
      if (dx * dx + dz * dz < (r - 1) * (r - 1)) {
        setBlock(ctx, ox + dx, capY + 1, oz + dz, cap);
      }
    }
  }
  placeLootChest(ctx, ox + 2, y + 1, oz + 2);
}

function placeRuinedPortal(
  ctx: Ctx,
  ox: number,
  oz: number,
  force = false,
): void {
  const w = 4;
  const h = 5;
  const padX0 = ox - 2;
  const padX1 = ox + w + 2;
  const padZ0 = oz - 2;
  const padZ1 = oz + 2;
  let floor = siteFloorY(ctx, padX0, padZ0, padX1, padZ1, {
    maxSlope: force ? 8 : 2,
    minAboveSea: force ? -4 : 1,
    allowUnderwater: force,
  });
  if (floor === null && force) {
    floor = Math.max(SEA_LEVEL + 2, ctx.surfaceAt(ox, oz).height);
  }
  if (floor === null) return;
  if (floor + h + 3 >= CHUNK_HEIGHT) return;
  const y = floor;

  ensureFoundations(ctx, padX0, padZ0, padX1, padZ1, y, Block.ARCANE);

  // 5×5×5 air pocket around the opening (and a bit of walk-up on both faces)
  const ccx = ox + 2;
  const ccy = y + 3;
  const ccz = oz;
  for (let dz = -2; dz <= 2; dz++) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const wx = ccx + dx;
        const wy = ccy + dy;
        const wz = ccz + dz;
        if (wy <= y) continue;
        setBlock(ctx, wx, wy, wz, Block.AIR);
      }
    }
  }

  // Complete voidstone ring on solid ground
  for (let dy = 0; dy <= h; dy++) {
    setBlock(ctx, ox, y + dy, oz, Block.ARCANE);
    setBlock(ctx, ox + w, y + dy, oz, Block.ARCANE);
  }
  for (let dx = 0; dx <= w; dx++) {
    setBlock(ctx, ox + dx, y, oz, Block.ARCANE);
    setBlock(ctx, ox + dx, y + h, oz, Block.ARCANE);
  }
  for (const dz of [-1, 1]) {
    setBlock(ctx, ox, y, oz + dz, Block.ARCANE);
    setBlock(ctx, ox + w, y, oz + dz, Block.ARCANE);
    setBlock(ctx, ox, y + h, oz + dz, Block.ARCANE);
    setBlock(ctx, ox + w, y + h, oz + dz, Block.ARCANE);
  }
  for (let dy = 1; dy < h; dy++) {
    for (let dx = 1; dx < w; dx++) {
      setBlock(ctx, ox + dx, y + dy, oz, Block.PORTAL);
    }
  }
  ensureColumnGrounded(ctx, ox + 1, oz, y, Block.ARCANE);
  // Loot off to the side so it doesn't sit in the walk-through
  placeLootChest(ctx, ox + 2, y + 1, oz + 3);
}

/** Grounded rocky butte (was a floating sky island). */
function placeSkyIslet(ctx: Ctx, ox: number, oz: number): void {
  const r = 3 + Math.floor(hash2(ox, oz, ctx.seed + 18) * 3);
  const floor = siteFloorY(ctx, ox - r, oz - r, ox + r, oz + r, {
    maxSlope: 5,
    minAboveSea: 2,
  });
  if (floor === null) return;
  const y = floor;
  // Solid pedestal from real ground up so it never floats
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > r + 0.2) continue;
      const g = topSolidY(ctx, ox + dx, oz + dz);
      const top =
        y + 2 + Math.floor((1 - dist / (r + 0.5)) * 3);
      for (let yy = g + 1; yy <= top; yy++) {
        const id =
          yy === top
            ? Block.GRASS
            : yy >= top - 1
              ? Block.DIRT
              : Block.STONE;
        setBlock(ctx, ox + dx, yy, oz + dz, id);
      }
    }
  }
  const topY = y + 5;
  pillar(ctx, ox, topY, oz, 3, Block.WOOD);
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      setBlock(ctx, ox + dx, topY + 3, oz + dz, Block.LEAVES, true);
      setBlock(ctx, ox + dx, topY + 4, oz + dz, Block.LEAVES, true);
    }
  }
  placeLootChest(ctx, ox + 2, topY, oz);
}

function placeDungeonMouth(ctx: Ctx, ox: number, oz: number): void {
  const floor = siteFloorY(ctx, ox - 2, oz - 2, ox + 2, oz + 2, {
    maxSlope: 4,
    minAboveSea: 2,
  });
  if (floor === null) return;
  const y = floor;
  ensureFoundations(ctx, ox - 2, oz - 2, ox + 2, oz + 2, y, Block.COBBLE);
  fillBox(ctx, ox - 2, y, oz - 2, ox + 2, y + 1, oz + 2, Block.COBBLE);
  clearBox(ctx, ox - 1, y - 12, oz - 1, ox + 1, y + 1, oz + 1);
  for (let i = 0; i < 10; i++) {
    const sy = y - 1 - i;
    setBlock(ctx, ox - 1 + (i % 3), sy, oz - 1, Block.COBBLE);
  }
  setBlock(ctx, ox - 2, y + 2, oz, Block.ICE);
  setBlock(ctx, ox + 2, y + 2, oz, Block.ICE);
  setBlock(ctx, ox - 1, y + 2, oz - 2, Block.COBBLE);
  setBlock(ctx, ox, y + 3, oz - 2, Block.COBBLE);
  setBlock(ctx, ox + 1, y + 2, oz - 2, Block.COBBLE);
  setBlock(ctx, ox, y - 11, oz, Block.CHEST);
}

function placeBridgeRuin(ctx: Ctx, ox: number, oz: number): void {
  const len = 10 + Math.floor(hash2(ox, oz, ctx.seed + 19) * 8);
  const alongX = hash2(ox, oz, ctx.seed + 20) > 0.5;
  // Deck height from center support — must clear local ground
  const centerG = topSolidY(ctx, ox, oz);
  if (centerG < 3) return;
  const y = Math.max(centerG + 2, SEA_LEVEL + 1);
  for (let i = -len; i <= len; i++) {
    if (hash2(ox + i, oz, ctx.seed + 21) < 0.12) continue;
    const wx = alongX ? ox + i : ox;
    const wz = alongX ? oz : oz + i;
    const g = topSolidY(ctx, wx, wz);
    // Always support deck with a pillar — no floating planks
    if (g < y + 3) {
      for (let yy = g + 1; yy <= y + 2; yy++) {
        setBlock(ctx, wx, yy, wz, Block.STONE);
      }
    }
    setBlock(ctx, wx, y + 3, wz, Block.COBBLE);
    setBlock(ctx, wx, y + 3, wz + (alongX ? 1 : 0), Block.COBBLE);
    if (alongX) {
      const g2 = topSolidY(ctx, wx, wz + 1);
      if (g2 < y + 3) {
        for (let yy = g2 + 1; yy <= y + 2; yy++) {
          setBlock(ctx, wx, yy, wz + 1, Block.STONE);
        }
      }
    }
  }
  setBlock(ctx, ox, y + 4, oz, Block.CHEST);
}

function placeIceSpire(ctx: Ctx, ox: number, oz: number): void {
  const floor = siteFloorY(ctx, ox - 2, oz - 2, ox + 2, oz + 2, {
    maxSlope: 5,
    minAboveSea: -2,
    allowUnderwater: false,
  });
  if (floor === null) return;
  const y = floor;
  ensureFoundations(ctx, ox - 2, oz - 2, ox + 2, oz + 2, y, Block.ICE);
  const H = 10 + Math.floor(hash2(ox, oz, ctx.seed + 22) * 16);
  for (let dy = 0; dy < H; dy++) {
    const r = Math.max(0, 2 - Math.floor(dy / (H / 3)));
    fillBox(ctx, ox - r, y + dy, oz - r, ox + r, y + dy, oz + r, Block.ICE);
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const sx = ox + Math.round(Math.cos(a) * 3);
    const sz = oz + Math.round(Math.sin(a) * 3);
    const sy = topSolidY(ctx, sx, sz);
    if (sy <= 2) continue;
    ensureColumnGrounded(ctx, sx, sz, sy + 1, Block.ICE);
    pillar(ctx, sx, sy + 1, sz, 2 + (i % 3), Block.ICE);
  }
  placeLootChest(ctx, ox + 3, y + 1, oz);
}

function placeArena(ctx: Ctx, ox: number, oz: number): void {
  const R = 7;
  const floor = siteFloorY(ctx, ox - R, oz - R, ox + R, oz + R, {
    maxSlope: 6,
    minAboveSea: 1,
  });
  if (floor === null) return;
  const y = floor;
  ensureFoundations(ctx, ox - R, oz - R, ox + R, oz + R, y, Block.COBBLE, true);
  for (let dz = -R; dz <= R; dz++) {
    for (let dx = -R; dx <= R; dx++) {
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > R) continue;
      setBlock(ctx, ox + dx, y, oz + dz, Block.COBBLE);
      if (dist > R - 1.2 && dist <= R) {
        pillar(ctx, ox + dx, y + 1, oz + dz, 3, Block.STONE);
      }
    }
  }
  pillar(ctx, ox, y + 1, oz, 2, Block.COBBLE);
  setBlock(ctx, ox, y + 3, oz, Block.ICE);
  placeLootChest(ctx, ox + 2, y + 1, oz);
}

const STRUCTURES: Array<{
  name: string;
  weight: number;
  place: (ctx: Ctx, ox: number, oz: number) => void;
  biomes?: BiomeId[];
  avoidOcean?: boolean;
}> = [
  { name: "watchtower", weight: 1.1, place: placeWatchtower, avoidOcean: true },
  { name: "cabin", weight: 1.0, place: placeCabin, avoidOcean: true },
  { name: "stone_circle", weight: 0.9, place: placeStoneCircle, avoidOcean: true },
  { name: "obelisk", weight: 0.85, place: placeObelisk },
  { name: "pyramid", weight: 0.7, place: placePyramid, biomes: [Biome.DESERT, Biome.BEACH] },
  { name: "shipwreck", weight: 0.9, place: placeShipwreck, biomes: [Biome.OCEAN, Biome.BEACH, Biome.SWAMP] },
  { name: "well", weight: 0.8, place: placeWell, avoidOcean: true },
  { name: "mushroom", weight: 0.75, place: placeGiantMushroom, biomes: [Biome.FOREST, Biome.SWAMP, Biome.PLAINS, Biome.RAINFOREST, Biome.FUNGAL] },
  { name: "portal", weight: 0.85, place: placeRuinedPortal, avoidOcean: true },
  { name: "sky_islet", weight: 0.5, place: placeSkyIslet, avoidOcean: true },
  { name: "dungeon", weight: 0.65, place: placeDungeonMouth, avoidOcean: true },
  { name: "bridge", weight: 0.7, place: placeBridgeRuin },
  { name: "ice_spire", weight: 0.7, place: placeIceSpire, biomes: [Biome.SNOW, Biome.MOUNTAINS] },
  { name: "arena", weight: 0.45, place: placeArena, avoidOcean: true },
];

function pickStructure(
  ox: number,
  oz: number,
  seed: number,
  biome: BiomeId,
): (typeof STRUCTURES)[number] | null {
  const roll = hash2(ox, oz, seed + 7777);
  if (roll < 0.86) return null;

  let total = 0;
  const picks: Array<{ s: (typeof STRUCTURES)[number]; w: number }> = [];
  for (const s of STRUCTURES) {
    if (s.avoidOcean && (biome === Biome.OCEAN || biome === Biome.BEACH)) {
      if (s.name !== "shipwreck") continue;
    }
    if (s.biomes && !s.biomes.includes(biome)) {
      if (hash2(ox, oz, seed + s.weight * 99) < 0.92) continue;
    }
    let w = s.weight;
    if (s.biomes?.includes(biome)) w *= 1.8;
    picks.push({ s, w });
    total += w;
  }
  if (total <= 0 || picks.length === 0) return null;
  let r = hash2(ox, oz, seed + 8888) * total;
  for (const p of picks) {
    r -= p.w;
    if (r <= 0) return p.s;
  }
  return picks[picks.length - 1]!.s;
}

/**
 * Place all structures that overlap this chunk.
 * Deterministic from world seed + structure grid cell.
 */
export function placeStructuresInChunk(
  blocks: Uint8Array,
  cx: number,
  cz: number,
  seed: number,
  surfaceAt: SurfaceFn,
): void {
  const ctx: Ctx = { blocks, cx, cz, seed, surfaceAt };
  const baseX = cx * CHUNK_SIZE;
  const baseZ = cz * CHUNK_SIZE;

  const minCellX = Math.floor((baseX - 24) / STRUCT_CELL);
  const maxCellX = Math.floor((baseX + CHUNK_SIZE + 24) / STRUCT_CELL);
  const minCellZ = Math.floor((baseZ - 24) / STRUCT_CELL);
  const maxCellZ = Math.floor((baseZ + CHUNK_SIZE + 24) / STRUCT_CELL);

  for (let czCell = minCellZ; czCell <= maxCellZ; czCell++) {
    for (let cxCell = minCellX; cxCell <= maxCellX; cxCell++) {
      const ox =
        cxCell * STRUCT_CELL +
        Math.floor(hash2(cxCell, czCell, seed + 100) * (STRUCT_CELL - 8)) +
        4;
      const oz =
        czCell * STRUCT_CELL +
        Math.floor(hash2(cxCell, czCell, seed + 101) * (STRUCT_CELL - 8)) +
        4;
      if (ox * ox + oz * oz < 40 * 40 && !isStarterPortalCell(cxCell, czCell)) {
        continue;
      }

      const { biome } = surfaceAt(ox, oz);
      if (topSolidY(ctx, ox, oz) <= 2 && !isStarterPortalCell(cxCell, czCell)) {
        continue;
      }

      if (cellHasLinkedPortal(cxCell, czCell, seed)) {
        const a = portalAnchor(cxCell, czCell, seed);
        placeRuinedPortal(ctx, a.ox, a.oz, isStarterPortalCell(cxCell, czCell));
        continue;
      }

      const s = pickStructure(ox, oz, seed, biome);
      if (!s) continue;
      if (s.name === "portal") continue;

      if (fbm2(ox * 0.02, oz * 0.02, seed + 50, 2) < 0.28) continue;

      s.place(ctx, ox, oz);
    }
  }
}
