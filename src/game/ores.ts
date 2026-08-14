import { Block } from "./blocks";
import { CHUNK_HEIGHT, CHUNK_SIZE } from "./chunkConstants";

function idx(x: number, y: number, z: number): number {
  return x + z * CHUNK_SIZE + y * CHUNK_SIZE * CHUNK_SIZE;
}

function hash3(x: number, y: number, z: number, s: number): number {
  let n = (x * 374761393 + y * 668265263 + z * 1274126177 + s * 1103515245) | 0;
  n = (n ^ (n >>> 13)) * 1274126177;
  n = n ^ (n >>> 16);
  return (n >>> 0) / 4294967295;
}

function splatVein(
  blocks: Uint8Array,
  ox: number,
  oy: number,
  oz: number,
  ore: number,
  size: number,
  seed: number,
): void {
  let x = ox;
  let y = oy;
  let z = oz;
  for (let i = 0; i < size; i++) {
    if (
      x >= 0 &&
      z >= 0 &&
      y > 1 &&
      x < CHUNK_SIZE &&
      z < CHUNK_SIZE &&
      y < CHUNK_HEIGHT - 1
    ) {
      const i0 = idx(x, y, z);
      if (blocks[i0] === Block.STONE) blocks[i0] = ore;
    }
    const h = hash3(ox + i, oy, oz, seed);
    x += (h < 0.33 ? -1 : h < 0.66 ? 1 : 0);
    y += hash3(ox, oy + i, oz, seed + 3) < 0.45 ? -1 : hash3(ox, oy + i, oz, seed + 4) > 0.78 ? 1 : 0;
    z += hash3(ox, oy, oz + i, seed + 7) < 0.33 ? -1 : hash3(ox, oy, oz + i, seed + 8) > 0.66 ? 1 : 0;
    y = Math.max(2, Math.min(CHUNK_HEIGHT - 2, y));
  }
}

/**
 * Scatter coal / iron veins through stone after caves are carved.
 * Extra chance on cave walls so exploring pays.
 */
export function placeOresInChunk(
  blocks: Uint8Array,
  cx: number,
  cz: number,
  seed: number,
): void {
  const salt = (seed ^ (cx * 73856093) ^ (cz * 19349663)) | 0;

  // Coal — common, mid/high stone
  for (let n = 0; n < 11; n++) {
    const lx = (hash3(cx, n, cz, salt + 11) * CHUNK_SIZE) | 0;
    const lz = (hash3(cx, n, cz, salt + 17) * CHUNK_SIZE) | 0;
    const ly = 6 + ((hash3(cx, n, cz, salt + 23) * 78) | 0);
    const size = 7 + ((hash3(cx, n, cz, salt + 29) * 9) | 0);
    splatVein(blocks, lx, ly, lz, Block.COAL_ORE, size, salt + n * 13);
  }

  // Iron — deeper, smaller veins
  for (let n = 0; n < 8; n++) {
    const lx = (hash3(cx, n, cz, salt + 41) * CHUNK_SIZE) | 0;
    const lz = (hash3(cx, n, cz, salt + 47) * CHUNK_SIZE) | 0;
    const ly = 4 + ((hash3(cx, n, cz, salt + 53) * 46) | 0);
    const size = 4 + ((hash3(cx, n, cz, salt + 59) * 6) | 0);
    splatVein(blocks, lx, ly, lz, Block.IRON_ORE, size, salt + 200 + n * 17);
  }

  // Cave-wall bonus: stone next to air is more likely to be ore
  const dirs: [number, number, number][] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];
  for (let y = 3; y < CHUNK_HEIGHT - 8; y++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const i = idx(x, y, z);
        if (blocks[i] !== Block.STONE) continue;
        let exposed = false;
        for (const [dx, dy, dz] of dirs) {
          const nx = x + dx;
          const ny = y + dy;
          const nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= CHUNK_SIZE || nz >= CHUNK_SIZE) continue;
          if (ny < 0 || ny >= CHUNK_HEIGHT) continue;
          if (blocks[idx(nx, ny, nz)] === Block.AIR) {
            exposed = true;
            break;
          }
        }
        if (!exposed) continue;
        const h = hash3(cx * 16 + x, y, cz * 16 + z, salt + 77);
        if (y < 48 && h < 0.055) blocks[i] = Block.IRON_ORE;
        else if (h < 0.13) blocks[i] = Block.COAL_ORE;
      }
    }
  }
}
