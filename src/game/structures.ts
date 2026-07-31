import { Block } from "./blocks";
import { Biome, type BiomeId } from "./biomes";
import { hash2, fbm2 } from "./noise";
import { CHUNK_SIZE, CHUNK_HEIGHT, SEA_LEVEL } from "./chunkConstants";

const STRUCT_CELL = 52;

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
    // allow replacing leaves/wood for clearings
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

function groundY(ctx: Ctx, wx: number, wz: number): number {
  return ctx.surfaceAt(wx, wz).height;
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

// ─── Structure types ────────────────────────────────────────────

function placeWatchtower(ctx: Ctx, ox: number, oz: number): void {
  const y = groundY(ctx, ox, oz);
  if (y <= SEA_LEVEL + 1) return;
  const H = 10 + Math.floor(hash2(ox, oz, ctx.seed + 3) * 6);
  // Foundation
  fillBox(ctx, ox - 2, y - 1, oz - 2, ox + 2, y, oz + 2, Block.COBBLE);
  // Shaft
  for (let dy = 1; dy <= H; dy++) {
    fillBox(ctx, ox - 1, y + dy, oz - 1, ox + 1, y + dy, oz + 1, Block.COBBLE, true);
    // Floor every few levels
    if (dy % 4 === 0) {
      fillBox(ctx, ox - 1, y + dy, oz - 1, ox + 1, y + dy, oz + 1, Block.PLANKS);
      setBlock(ctx, ox, y + dy, oz, Block.COBBLE); // ladder column support
    }
  }
  // Door
  setBlock(ctx, ox, y + 1, oz - 1, Block.AIR);
  setBlock(ctx, ox, y + 2, oz - 1, Block.AIR);
  // Battlements
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
  // Flag pole
  pillar(ctx, ox, top + 1, oz, 3, Block.WOOD);
  setBlock(ctx, ox, top + 4, oz, Block.LEAVES);
}

function placeCabin(ctx: Ctx, ox: number, oz: number): void {
  const y = groundY(ctx, ox, oz);
  if (y <= SEA_LEVEL) return;
  const w = 4;
  const d = 5;
  const h = 3;
  // Floor
  fillBox(ctx, ox - w, y, oz - d, ox + w, y, oz + d, Block.PLANKS);
  // Walls
  fillBox(ctx, ox - w, y + 1, oz - d, ox + w, y + h, oz + d, Block.WOOD, true);
  // Hollow interior
  clearBox(ctx, ox - w + 1, y + 1, oz - d + 1, ox + w - 1, y + h - 1, oz + d - 1);
  // Door
  setBlock(ctx, ox, y + 1, oz - d, Block.AIR);
  setBlock(ctx, ox, y + 2, oz - d, Block.AIR);
  // Windows
  setBlock(ctx, ox - w, y + 2, oz, Block.AIR);
  setBlock(ctx, ox + w, y + 2, oz, Block.AIR);
  // Roof gable
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
  // Chimney
  pillar(ctx, ox + w - 1, y + 1, oz + d - 1, h + 3, Block.COBBLE);
}

function placeStoneCircle(ctx: Ctx, ox: number, oz: number): void {
  const y = groundY(ctx, ox, oz);
  if (y <= SEA_LEVEL - 1) return;
  const R = 5 + Math.floor(hash2(ox, oz, ctx.seed + 9) * 3);
  const stones = 7 + Math.floor(hash2(ox, oz, ctx.seed + 10) * 5);
  for (let i = 0; i < stones; i++) {
    const a = (i / stones) * Math.PI * 2;
    const sx = ox + Math.round(Math.cos(a) * R);
    const sz = oz + Math.round(Math.sin(a) * R);
    const sy = groundY(ctx, sx, sz);
    const tall = 2 + Math.floor(hash2(sx, sz, ctx.seed + i) * 3);
    pillar(ctx, sx, sy + 1, sz, tall, Block.STONE);
    if (hash2(sx, sz, ctx.seed + 40 + i) > 0.55) {
      setBlock(ctx, sx, sy + tall + 1, sz, Block.COBBLE); // capstone
    }
  }
  // Altar
  fillBox(ctx, ox - 1, y + 1, oz - 1, ox + 1, y + 1, oz + 1, Block.COBBLE);
  setBlock(ctx, ox, y + 2, oz, Block.ICE);
}

function placeObelisk(ctx: Ctx, ox: number, oz: number): void {
  const y = groundY(ctx, ox, oz);
  if (y < SEA_LEVEL - 2) return;
  const H = 14 + Math.floor(hash2(ox, oz, ctx.seed + 11) * 12);
  fillBox(ctx, ox - 2, y, oz - 2, ox + 2, y + 1, oz + 2, Block.STONE);
  for (let dy = 2; dy < H; dy++) {
    const taper = dy > H * 0.7 ? 0 : 1;
    fillBox(ctx, ox - taper, y + dy, oz - taper, ox + taper, y + dy, oz + taper, Block.STONE);
  }
  setBlock(ctx, ox, y + H, oz, Block.ICE);
  setBlock(ctx, ox, y + H + 1, oz, Block.ICE);
}

function placePyramid(ctx: Ctx, ox: number, oz: number): void {
  const y = groundY(ctx, ox, oz);
  if (y < SEA_LEVEL - 1) return;
  const biome = ctx.surfaceAt(ox, oz).biome;
  const mat = biome === Biome.DESERT ? Block.SAND : Block.SAND;
  const core = Block.STONE;
  const base = 6 + Math.floor(hash2(ox, oz, ctx.seed + 12) * 3);
  for (let layer = 0; layer <= base; layer++) {
    const r = base - layer;
    fillBox(ctx, ox - r, y + layer, oz - r, ox + r, y + layer, oz + r, mat);
  }
  // Inner chamber
  clearBox(ctx, ox - 1, y + 1, oz - 1, ox + 1, y + 3, oz + 1);
  setBlock(ctx, ox, y + 1, oz - base, Block.AIR);
  setBlock(ctx, ox, y + 2, oz - base, Block.AIR);
  // Corridor
  for (let z = -base; z <= 0; z++) {
    setBlock(ctx, ox, y + 1, oz + z, Block.AIR);
    setBlock(ctx, ox, y + 2, oz + z, Block.AIR);
  }
  setBlock(ctx, ox, y + 1, oz, core);
}

function placeShipwreck(ctx: Ctx, ox: number, oz: number): void {
  const y = Math.max(groundY(ctx, ox, oz), SEA_LEVEL - 2);
  const len = 8 + Math.floor(hash2(ox, oz, ctx.seed + 13) * 5);
  const dir = hash2(ox, oz, ctx.seed + 14) > 0.5 ? 1 : 0; // along X or Z
  for (let i = -len; i <= len; i++) {
    const t = 1 - Math.abs(i) / (len + 1);
    const beam = Math.max(1, Math.floor(t * 3));
    for (let b = -beam; b <= beam; b++) {
      const wx = dir ? ox + i : ox + b;
      const wz = dir ? oz + b : oz + i;
      setBlock(ctx, wx, y, wz, Block.WOOD);
      if (Math.abs(b) === beam) {
        setBlock(ctx, wx, y + 1, wz, Block.WOOD);
        if (t > 0.4) setBlock(ctx, wx, y + 2, wz, Block.PLANKS);
      }
    }
    // Ribs
    if (i % 3 === 0) {
      const wx = dir ? ox + i : ox;
      const wz = dir ? oz : oz + i;
      setBlock(ctx, wx, y + 1, wz, Block.PLANKS);
    }
  }
  // Broken mast
  const mx = ox;
  const mz = oz;
  pillar(ctx, mx, y + 1, mz, 5, Block.WOOD);
  setBlock(ctx, mx + 1, y + 5, mz, Block.PLANKS);
  setBlock(ctx, mx + 2, y + 4, mz, Block.PLANKS);
}

function placeWell(ctx: Ctx, ox: number, oz: number): void {
  const y = groundY(ctx, ox, oz);
  if (y <= SEA_LEVEL) return;
  fillBox(ctx, ox - 1, y, oz - 1, ox + 1, y + 1, oz + 1, Block.COBBLE, true);
  clearBox(ctx, ox, y - 6, oz, ox, y + 1, oz);
  for (let dy = 0; dy <= 4; dy++) {
    setBlock(ctx, ox, y - dy, oz, Block.WATER);
  }
  // Roof posts
  setBlock(ctx, ox - 1, y + 2, oz - 1, Block.WOOD);
  setBlock(ctx, ox + 1, y + 2, oz - 1, Block.WOOD);
  setBlock(ctx, ox - 1, y + 2, oz + 1, Block.WOOD);
  setBlock(ctx, ox + 1, y + 2, oz + 1, Block.WOOD);
  fillBox(ctx, ox - 1, y + 3, oz - 1, ox + 1, y + 3, oz + 1, Block.PLANKS);
}

function placeGiantMushroom(ctx: Ctx, ox: number, oz: number): void {
  const y = groundY(ctx, ox, oz);
  if (y <= SEA_LEVEL) return;
  const H = 6 + Math.floor(hash2(ox, oz, ctx.seed + 15) * 5);
  pillar(ctx, ox, y + 1, oz, H, Block.WOOD);
  // Cap
  const r = 3 + Math.floor(hash2(ox, oz, ctx.seed + 16) * 2);
  const capY = y + H;
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dz * dz > r * r + 1) continue;
      setBlock(ctx, ox + dx, capY, oz + dz, Block.LEAVES);
      if (dx * dx + dz * dz < (r - 1) * (r - 1)) {
        setBlock(ctx, ox + dx, capY + 1, oz + dz, Block.LEAVES);
      }
    }
  }
}

function placeRuinedPortal(ctx: Ctx, ox: number, oz: number): void {
  const y = groundY(ctx, ox, oz);
  if (y <= SEA_LEVEL - 1) return;
  // Crying-obsidian-ish frame using cobble + ice "portal"
  const h = 5;
  const w = 4;
  for (let dy = 0; dy <= h; dy++) {
    setBlock(ctx, ox, y + dy, oz, Block.COBBLE);
    setBlock(ctx, ox + w, y + dy, oz, Block.COBBLE);
  }
  for (let dx = 0; dx <= w; dx++) {
    setBlock(ctx, ox + dx, y, oz, Block.COBBLE);
    setBlock(ctx, ox + dx, y + h, oz, Block.COBBLE);
  }
  // Broken pieces
  setBlock(ctx, ox - 1, y + 1, oz + 1, Block.COBBLE);
  setBlock(ctx, ox + w + 1, y + 2, oz - 1, Block.COBBLE);
  setBlock(ctx, ox + 1, y - 1, oz, Block.COBBLE);
  // Inner ice "portal" glow
  for (let dy = 1; dy < h; dy++) {
    for (let dx = 1; dx < w; dx++) {
      if (hash2(ox + dx, oz + dy, ctx.seed) > 0.35) {
        setBlock(ctx, ox + dx, y + dy, oz, Block.ICE);
      }
    }
  }
}

function placeSkyIslet(ctx: Ctx, ox: number, oz: number): void {
  // Floating island high above surface
  const base = groundY(ctx, ox, oz);
  if (base < SEA_LEVEL) return;
  const y = Math.min(CHUNK_HEIGHT - 12, base + 18 + Math.floor(hash2(ox, oz, ctx.seed + 17) * 14));
  const r = 3 + Math.floor(hash2(ox, oz, ctx.seed + 18) * 3);
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > r + 0.2) continue;
      const depth = Math.floor((1 - dist / (r + 0.5)) * 3) + 1;
      for (let dy = 0; dy < depth; dy++) {
        const id = dy === depth - 1 ? Block.GRASS : dy === 0 ? Block.STONE : Block.DIRT;
        setBlock(ctx, ox + dx, y - dy, oz + dz, id);
      }
    }
  }
  // Mini tree
  pillar(ctx, ox, y + 1, oz, 3, Block.WOOD);
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      setBlock(ctx, ox + dx, y + 4, oz + dz, Block.LEAVES, true);
      setBlock(ctx, ox + dx, y + 5, oz + dz, Block.LEAVES, true);
    }
  }
  // Vine drip under island
  for (let i = 0; i < 4; i++) {
    const vx = ox + Math.floor(hash2(ox, i, ctx.seed) * r * 2) - r;
    const vz = oz + Math.floor(hash2(oz, i, ctx.seed + 1) * r * 2) - r;
    for (let dy = 1; dy <= 3; dy++) {
      setBlock(ctx, vx, y - 1 - dy, vz, Block.LEAVES, true);
    }
  }
}

function placeDungeonMouth(ctx: Ctx, ox: number, oz: number): void {
  const y = groundY(ctx, ox, oz);
  if (y <= SEA_LEVEL + 2) return;
  // Cobble frame over a shaft
  fillBox(ctx, ox - 2, y, oz - 2, ox + 2, y + 1, oz + 2, Block.COBBLE);
  clearBox(ctx, ox - 1, y - 12, oz - 1, ox + 1, y + 1, oz + 1);
  // Stairs-ish ledges
  for (let i = 0; i < 10; i++) {
    const sy = y - 1 - i;
    setBlock(ctx, ox - 1 + (i % 3), sy, oz - 1, Block.COBBLE);
  }
  // Torch substitutes: ice lanterns
  setBlock(ctx, ox - 2, y + 2, oz, Block.ICE);
  setBlock(ctx, ox + 2, y + 2, oz, Block.ICE);
  // Arch
  setBlock(ctx, ox - 1, y + 2, oz - 2, Block.COBBLE);
  setBlock(ctx, ox, y + 3, oz - 2, Block.COBBLE);
  setBlock(ctx, ox + 1, y + 2, oz - 2, Block.COBBLE);
}

function placeBridgeRuin(ctx: Ctx, ox: number, oz: number): void {
  const y = Math.max(groundY(ctx, ox, oz), SEA_LEVEL + 1);
  const len = 10 + Math.floor(hash2(ox, oz, ctx.seed + 19) * 8);
  const alongX = hash2(ox, oz, ctx.seed + 20) > 0.5;
  for (let i = -len; i <= len; i++) {
    if (hash2(ox + i, oz, ctx.seed + 21) < 0.12) continue; // missing segments
    const wx = alongX ? ox + i : ox;
    const wz = alongX ? oz : oz + i;
    setBlock(ctx, wx, y + 3, wz, Block.COBBLE);
    setBlock(ctx, wx, y + 3, wz + (alongX ? 1 : 0), Block.COBBLE);
    if (i % 4 === 0) {
      pillar(ctx, wx, groundY(ctx, wx, wz) + 1, wz, y + 3 - groundY(ctx, wx, wz), Block.STONE);
    }
  }
}

function placeIceSpire(ctx: Ctx, ox: number, oz: number): void {
  const y = groundY(ctx, ox, oz);
  const H = 10 + Math.floor(hash2(ox, oz, ctx.seed + 22) * 16);
  for (let dy = 0; dy < H; dy++) {
    const r = Math.max(0, 2 - Math.floor(dy / (H / 3)));
    fillBox(ctx, ox - r, y + dy, oz - r, ox + r, y + dy, oz + r, Block.ICE);
  }
  // Crystals at base
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const sx = ox + Math.round(Math.cos(a) * 3);
    const sz = oz + Math.round(Math.sin(a) * 3);
    pillar(ctx, sx, y + 1, sz, 2 + (i % 3), Block.ICE);
  }
}

function placeArena(ctx: Ctx, ox: number, oz: number): void {
  const y = groundY(ctx, ox, oz);
  if (y <= SEA_LEVEL) return;
  const R = 7;
  for (let dz = -R; dz <= R; dz++) {
    for (let dx = -R; dx <= R; dx++) {
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > R) continue;
      const sy = groundY(ctx, ox + dx, oz + dz);
      // Flatten floor
      setBlock(ctx, ox + dx, y, oz + dz, Block.COBBLE);
      if (sy > y) {
        for (let yy = y + 1; yy <= sy + 2; yy++) setBlock(ctx, ox + dx, yy, oz + dz, Block.AIR);
      }
      // Wall ring
      if (dist > R - 1.2 && dist <= R) {
        pillar(ctx, ox + dx, y + 1, oz + dz, 3, Block.STONE);
      }
    }
  }
  // Center pillar
  pillar(ctx, ox, y + 1, oz, 2, Block.COBBLE);
  setBlock(ctx, ox, y + 3, oz, Block.ICE);
}

const STRUCTURES: Array<{
  name: string;
  weight: number;
  place: (ctx: Ctx, ox: number, oz: number) => void;
  /** Biomes where this is more likely; empty = anywhere suitable */
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
  { name: "mushroom", weight: 0.75, place: placeGiantMushroom, biomes: [Biome.FOREST, Biome.SWAMP, Biome.PLAINS] },
  { name: "portal", weight: 0.55, place: placeRuinedPortal, avoidOcean: true },
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
  // Density: ~14% of structure cells spawn something
  if (roll < 0.86) return null;

  // Build weighted list filtered by biome
  let total = 0;
  const picks: Array<{ s: (typeof STRUCTURES)[number]; w: number }> = [];
  for (const s of STRUCTURES) {
    if (s.avoidOcean && (biome === Biome.OCEAN || biome === Biome.BEACH)) {
      if (s.name !== "shipwreck") continue;
    }
    if (s.biomes && !s.biomes.includes(biome)) {
      // still allow rarely
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

  // Structure origins live on STRUCT_CELL grid; visit neighbors so edges span chunks
  const minCellX = Math.floor((baseX - 24) / STRUCT_CELL);
  const maxCellX = Math.floor((baseX + CHUNK_SIZE + 24) / STRUCT_CELL);
  const minCellZ = Math.floor((baseZ - 24) / STRUCT_CELL);
  const maxCellZ = Math.floor((baseZ + CHUNK_SIZE + 24) / STRUCT_CELL);

  for (let czCell = minCellZ; czCell <= maxCellZ; czCell++) {
    for (let cxCell = minCellX; cxCell <= maxCellX; cxCell++) {
      // Skip near world spawn so player isn't inside a pyramid
      const ox =
        cxCell * STRUCT_CELL +
        Math.floor(hash2(cxCell, czCell, seed + 100) * (STRUCT_CELL - 8)) +
        4;
      const oz =
        czCell * STRUCT_CELL +
        Math.floor(hash2(cxCell, czCell, seed + 101) * (STRUCT_CELL - 8)) +
        4;
      if (ox * ox + oz * oz < 40 * 40) continue;

      const { height, biome } = surfaceAt(ox, oz);
      // Don't plant structures mid-air over deep oceans with no interest (except shipwrecks)
      void height;
      const s = pickStructure(ox, oz, seed, biome);
      if (!s) continue;

      // Extra noise gate for variety clusters
      if (fbm2(ox * 0.02, oz * 0.02, seed + 50, 2) < 0.28) continue;

      s.place(ctx, ox, oz);
    }
  }
}
