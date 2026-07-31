/** Fast deterministic 2D value noise + fbm for terrain heightmaps */

function hash2(x: number, z: number, seed: number): number {
  let n = x * 374761393 + z * 668265263 + seed * 1274126177;
  n = (n ^ (n >> 13)) * 1274126177;
  n = n ^ (n >> 16);
  return (n & 0x7fffffff) / 0x7fffffff;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise2(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const xf = smoothstep(x - x0);
  const zf = smoothstep(z - z0);
  const v00 = hash2(x0, z0, seed);
  const v10 = hash2(x0 + 1, z0, seed);
  const v01 = hash2(x0, z0 + 1, seed);
  const v11 = hash2(x0 + 1, z0 + 1, seed);
  const x1 = v00 + (v10 - v00) * xf;
  const x2 = v01 + (v11 - v01) * xf;
  return x1 + (x2 - x1) * zf;
}

export function fbm2(
  x: number,
  z: number,
  seed: number,
  octaves = 4,
  lacunarity = 2,
  gain = 0.5,
): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise2(x * freq, z * freq, seed + i * 1013) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Tree / cactus placement — sparse deterministic; keep spawn origin clear */
export function shouldPlaceTree(
  wx: number,
  wz: number,
  seed: number,
  threshold = 0.985,
): boolean {
  // Clear a 12-block radius around world origin so the player never spawns in a trunk
  if (wx * wx + wz * wz < 144) return false;
  const h = hash2(wx, wz, seed + 999);
  return h > threshold;
}

export function shouldPlaceCactus(
  wx: number,
  wz: number,
  seed: number,
): boolean {
  if (wx * wx + wz * wz < 100) return false;
  const h = hash2(wx, wz, seed + 777);
  return h > 0.988;
}

