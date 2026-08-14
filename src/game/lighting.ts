import { blocksLight, lightEmission, lightLoss } from "./blocks";
import { CHUNK_HEIGHT, CHUNK_SIZE } from "./chunkConstants";
import type { Chunk } from "./chunk";

const DIRS: [number, number, number][] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

function idx(lx: number, y: number, lz: number): number {
  return lx + lz * CHUNK_SIZE + y * CHUNK_SIZE * CHUNK_SIZE;
}

/**
 * Recompute sky + block light for one chunk.
 * Writes only this chunk; reads neighbors via accessors (0 / 15 if missing).
 */
export function computeChunkLighting(
  chunk: Chunk,
  getSky: (wx: number, wy: number, wz: number) => number,
  getBlk: (wx: number, wy: number, wz: number) => number,
): void {
  chunk.ensureLight();
  const sky = chunk.skyLight!;
  const blk = chunk.blockLight!;
  sky.fill(0);
  blk.fill(0);
  chunk.emitters.length = 0;

  const baseX = chunk.cx * CHUNK_SIZE;
  const baseZ = chunk.cz * CHUNK_SIZE;
  const q: number[] = [];
  let qh = 0;

  // Vertical sky: 15 from the top until an opaque ceiling
  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      let s = 15;
      for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
        const id = chunk.get(lx, y, lz);
        const i = idx(lx, y, lz);
        if (blocksLight(id)) {
          sky[i] = 0;
          s = 0;
        } else {
          sky[i] = s;
          if (s > 0) s = Math.max(0, s - lightLoss(id));
        }
        const emit = lightEmission(id);
        if (emit > 0) {
          blk[i] = emit;
          chunk.emitters.push(baseX + lx, y, baseZ + lz);
        }
      }
    }
  }

  const enqueue = (i: number) => {
    q.push(i);
  };

  // Seed sky BFS from bright cells + incoming neighbor sky
  q.length = 0;
  qh = 0;
  for (let y = 0; y < CHUNK_HEIGHT; y++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const i = idx(lx, y, lz);
        const id = chunk.get(lx, y, lz);
        if (blocksLight(id)) continue;
        let s = sky[i]!;
        const wx = baseX + lx;
        const wz = baseZ + lz;
        for (const [dx, dy, dz] of DIRS) {
          const nx = lx + dx;
          const ny = y + dy;
          const nz = lz + dz;
          let ns: number;
          if (
            nx >= 0 &&
            nz >= 0 &&
            nx < CHUNK_SIZE &&
            nz < CHUNK_SIZE &&
            ny >= 0 &&
            ny < CHUNK_HEIGHT
          ) {
            continue; // internal handled by BFS
          } else {
            ns = ny >= CHUNK_HEIGHT ? 15 : getSky(wx + dx, ny, wz + dz);
          }
          const incoming = ns - 1 - lightLoss(id);
          if (incoming > s) s = incoming;
        }
        if (s > sky[i]!) sky[i] = s;
        if (s > 1) enqueue(i);
      }
    }
  }

  while (qh < q.length) {
    const i = q[qh++]!;
    const cur = sky[i]!;
    if (cur <= 1) continue;
    const lx = i % CHUNK_SIZE;
    const t = (i / CHUNK_SIZE) | 0;
    const lz = t % CHUNK_SIZE;
    const y = (t / CHUNK_SIZE) | 0;
    for (const [dx, dy, dz] of DIRS) {
      const nx = lx + dx;
      const ny = y + dy;
      const nz = lz + dz;
      if (
        nx < 0 ||
        nz < 0 ||
        nx >= CHUNK_SIZE ||
        nz >= CHUNK_SIZE ||
        ny < 0 ||
        ny >= CHUNK_HEIGHT
      ) {
        continue;
      }
      const nid = chunk.get(nx, ny, nz);
      if (blocksLight(nid)) continue;
      const ni = idx(nx, ny, nz);
      const next = cur - 1 - lightLoss(nid);
      if (next > sky[ni]!) {
        sky[ni] = next;
        if (next > 1) enqueue(ni);
      }
    }
  }

  // Block light BFS from emitters + neighbor bleed
  q.length = 0;
  qh = 0;
  for (let y = 0; y < CHUNK_HEIGHT; y++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const i = idx(lx, y, lz);
        const id = chunk.get(lx, y, lz);
        if (blocksLight(id) && lightEmission(id) <= 0) continue;
        let b = blk[i]!;
        const wx = baseX + lx;
        const wz = baseZ + lz;
        for (const [dx, dy, dz] of DIRS) {
          const nx = lx + dx;
          const ny = y + dy;
          const nz = lz + dz;
          if (
            nx >= 0 &&
            nz >= 0 &&
            nx < CHUNK_SIZE &&
            nz < CHUNK_SIZE &&
            ny >= 0 &&
            ny < CHUNK_HEIGHT
          ) {
            continue;
          }
          const nb = getBlk(wx + dx, ny, wz + dz);
          const incoming = nb - 1 - lightLoss(id);
          if (incoming > b) b = incoming;
        }
        if (b > blk[i]!) blk[i] = b;
        if (b > 1) enqueue(i);
      }
    }
  }

  while (qh < q.length) {
    const i = q[qh++]!;
    const cur = blk[i]!;
    if (cur <= 1) continue;
    const lx = i % CHUNK_SIZE;
    const t = (i / CHUNK_SIZE) | 0;
    const lz = t % CHUNK_SIZE;
    const y = (t / CHUNK_SIZE) | 0;
    for (const [dx, dy, dz] of DIRS) {
      const nx = lx + dx;
      const ny = y + dy;
      const nz = lz + dz;
      if (
        nx < 0 ||
        nz < 0 ||
        nx >= CHUNK_SIZE ||
        nz >= CHUNK_SIZE ||
        ny < 0 ||
        ny >= CHUNK_HEIGHT
      ) {
        continue;
      }
      const nid = chunk.get(nx, ny, nz);
      if (blocksLight(nid) && lightEmission(nid) <= 0) continue;
      const ni = idx(nx, ny, nz);
      const next = cur - 1 - lightLoss(nid);
      if (next > blk[ni]!) {
        blk[ni] = next;
        if (next > 1) enqueue(ni);
      }
    }
  }

  chunk.lightDirty = false;
}

const EDIT_DIRS: [number, number, number][] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

export type LightEditWorld = {
  getBlock(x: number, y: number, z: number): number;
  getSky(x: number, y: number, z: number): number;
  setSky(x: number, y: number, z: number, v: number): void;
  getBlk(x: number, y: number, z: number): number;
  setBlk(x: number, y: number, z: number, v: number): void;
};

/**
 * Incremental sky + block light after a single block swap.
 * Much cheaper than recomputing 9 whole chunks.
 */
export function applyBlockLightEdit(
  wx: number,
  wy: number,
  wz: number,
  prevId: number,
  nextId: number,
  w: LightEditWorld,
): void {
  const emitPrev = lightEmission(prevId);
  const emitNext = lightEmission(nextId);
  const blockPrev = blocksLight(prevId);
  const blockNext = blocksLight(nextId);
  if (emitPrev === emitNext && blockPrev === blockNext) return;
  if (wy < 0 || wy >= CHUNK_HEIGHT) return;

  if (blockPrev !== blockNext) {
    updateSkyAround(wx, wy, wz, w);
  }

  const oldBlk = w.getBlk(wx, wy, wz);
  if (blockNext && !blockPrev) {
    subtractLight(w.getBlk, w.setBlk, w.getBlock, wx, wy, wz, oldBlk, true);
    refillBlock(wx, wy, wz, w);
  } else if (emitNext < oldBlk) {
    subtractLight(w.getBlk, w.setBlk, w.getBlock, wx, wy, wz, oldBlk, true);
    if (emitNext > 0) {
      w.setBlk(wx, wy, wz, emitNext);
      spreadLight(w.getBlk, w.setBlk, w.getBlock, wx, wy, wz, true);
    } else {
      refillBlock(wx, wy, wz, w);
    }
  } else if (emitNext > oldBlk) {
    w.setBlk(wx, wy, wz, emitNext);
    spreadLight(w.getBlk, w.setBlk, w.getBlock, wx, wy, wz, true);
  }
}

function updateSkyAround(
  wx: number,
  wy: number,
  wz: number,
  w: LightEditWorld,
): void {
  const oldCol = new Uint8Array(CHUNK_HEIGHT);
  const neu = new Uint8Array(CHUNK_HEIGHT);
  for (let y = 0; y < CHUNK_HEIGHT; y++) oldCol[y] = w.getSky(wx, y, wz);

  let s = 15;
  for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
    const id = w.getBlock(wx, y, wz);
    if (blocksLight(id)) {
      neu[y] = 0;
      s = 0;
    } else {
      neu[y] = s;
      if (s > 0) s = Math.max(0, s - lightLoss(id));
    }
  }

  for (let y = 0; y < CHUNK_HEIGHT; y++) {
    if (oldCol[y]! > neu[y]!) {
      subtractLight(w.getSky, w.setSky, w.getBlock, wx, y, wz, oldCol[y]!, false);
    }
  }
  for (let y = 0; y < CHUNK_HEIGHT; y++) {
    if (w.getSky(wx, y, wz) !== neu[y]!) w.setSky(wx, y, wz, neu[y]!);
  }
  for (let y = 0; y < CHUNK_HEIGHT; y++) {
    if (neu[y]! > oldCol[y]! && neu[y]! > 1) {
      spreadLight(w.getSky, w.setSky, w.getBlock, wx, y, wz, false);
    }
  }
  void wy;
}

function refillBlock(wx: number, wy: number, wz: number, w: LightEditWorld): void {
  const emit = lightEmission(w.getBlock(wx, wy, wz));
  if (emit > w.getBlk(wx, wy, wz)) w.setBlk(wx, wy, wz, emit);
  for (const [dx, dy, dz] of EDIT_DIRS) {
    const nx = wx + dx;
    const ny = wy + dy;
    const nz = wz + dz;
    if (ny < 0 || ny >= CHUNK_HEIGHT) continue;
    if (w.getBlk(nx, ny, nz) > 1) {
      spreadLight(w.getBlk, w.setBlk, w.getBlock, nx, ny, nz, true);
    }
  }
  if (w.getBlk(wx, wy, wz) > 1) {
    spreadLight(w.getBlk, w.setBlk, w.getBlock, wx, wy, wz, true);
  }
}

function subtractLight(
  get: (x: number, y: number, z: number) => number,
  set: (x: number, y: number, z: number, v: number) => void,
  getBlock: (x: number, y: number, z: number) => number,
  x: number,
  y: number,
  z: number,
  oldVal: number,
  isBlock: boolean,
): void {
  if (oldVal <= 0) return;
  const qx: number[] = [x];
  const qy: number[] = [y];
  const qz: number[] = [z];
  const qv: number[] = [oldVal];
  set(x, y, z, 0);
  const seeds: number[] = [];
  let qh = 0;
  while (qh < qx.length && qh < 12000) {
    const cx = qx[qh]!;
    const cy = qy[qh]!;
    const cz = qz[qh]!;
    const cv = qv[qh]!;
    qh++;
    for (const [dx, dy, dz] of EDIT_DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      const nz = cz + dz;
      if (ny < 0 || ny >= CHUNK_HEIGHT) continue;
      const nl = get(nx, ny, nz);
      if (nl <= 0) continue;
      if (nl < cv) {
        qx.push(nx);
        qy.push(ny);
        qz.push(nz);
        qv.push(nl);
        set(nx, ny, nz, 0);
      } else {
        seeds.push(nx, ny, nz);
      }
    }
  }
  for (let i = 0; i < seeds.length; i += 3) {
    spreadLight(get, set, getBlock, seeds[i]!, seeds[i + 1]!, seeds[i + 2]!, isBlock);
  }
}

function spreadLight(
  get: (x: number, y: number, z: number) => number,
  set: (x: number, y: number, z: number, v: number) => void,
  getBlock: (x: number, y: number, z: number) => number,
  x: number,
  y: number,
  z: number,
  isBlock: boolean,
): void {
  const qx = [x];
  const qy = [y];
  const qz = [z];
  let qh = 0;
  while (qh < qx.length && qh < 12000) {
    const cx = qx[qh]!;
    const cy = qy[qh]!;
    const cz = qz[qh]!;
    qh++;
    const cur = get(cx, cy, cz);
    if (cur <= 1) continue;
    for (const [dx, dy, dz] of EDIT_DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      const nz = cz + dz;
      if (ny < 0 || ny >= CHUNK_HEIGHT) continue;
      const nid = getBlock(nx, ny, nz);
      if (isBlock) {
        if (blocksLight(nid) && lightEmission(nid) <= 0) continue;
      } else if (blocksLight(nid)) {
        continue;
      }
      const next = cur - 1 - lightLoss(nid);
      if (next > get(nx, ny, nz)) {
        set(nx, ny, nz, next);
        if (next > 1) {
          qx.push(nx);
          qy.push(ny);
          qz.push(nz);
        }
      }
    }
  }
}

export function defaultSkyAt(wy: number): number {
  if (wy < 0) return 0;
  return 15;
}

/** Column-only sky (no horizontal flood). Used when a neighbor isn't lit yet. */
export function estimateColumnSky(
  chunk: Chunk,
  lx: number,
  y: number,
  lz: number,
): number {
  if (y >= CHUNK_HEIGHT) return 15;
  if (y < 0) return 0;
  let s = 15;
  for (let yy = CHUNK_HEIGHT - 1; yy >= y; yy--) {
    const id = chunk.get(lx, yy, lz);
    if (blocksLight(id)) {
      s = 0;
    } else if (yy > y && s > 0) {
      s = Math.max(0, s - lightLoss(id));
    }
  }
  if (blocksLight(chunk.get(lx, y, lz))) return 0;
  return s;
}
