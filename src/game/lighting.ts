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

export function defaultSkyAt(wy: number): number {
  if (wy < 0) return 0;
  return 15;
}
