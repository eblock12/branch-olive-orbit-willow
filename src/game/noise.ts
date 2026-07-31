/** Fast deterministic 2D/3D value noise + fbm for terrain & caves */

function hash2(x: number, z: number, seed: number): number {
  let n = x * 374761393 + z * 668265263 + seed * 1274126177;
  n = (n ^ (n >> 13)) * 1274126177;
  n = n ^ (n >> 16);
  return (n & 0x7fffffff) / 0x7fffffff;
}

function hash3(x: number, y: number, z: number, seed: number): number {
  let n =
    x * 374761393 + y * 668265263 + z * 1274126177 + seed * 1103515245;
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

function valueNoise3(x: number, y: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const xf = smoothstep(x - x0);
  const yf = smoothstep(y - y0);
  const zf = smoothstep(z - z0);

  const n000 = hash3(x0, y0, z0, seed);
  const n100 = hash3(x0 + 1, y0, z0, seed);
  const n010 = hash3(x0, y0 + 1, z0, seed);
  const n110 = hash3(x0 + 1, y0 + 1, z0, seed);
  const n001 = hash3(x0, y0, z0 + 1, seed);
  const n101 = hash3(x0 + 1, y0, z0 + 1, seed);
  const n011 = hash3(x0, y0 + 1, z0 + 1, seed);
  const n111 = hash3(x0 + 1, y0 + 1, z0 + 1, seed);

  const x00 = n000 + (n100 - n000) * xf;
  const x10 = n010 + (n110 - n010) * xf;
  const x01 = n001 + (n101 - n001) * xf;
  const x11 = n011 + (n111 - n011) * xf;
  const y0v = x00 + (x10 - x00) * yf;
  const y1v = x01 + (x11 - x01) * yf;
  return y0v + (y1v - y0v) * zf;
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

export function fbm3(
  x: number,
  y: number,
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
    sum +=
      valueNoise3(x * freq, y * freq, z * freq, seed + i * 1907) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Ridged multifractal 3D — sharp tunnel / canyon shapes */
export function ridged3(
  x: number,
  y: number,
  z: number,
  seed: number,
  octaves = 4,
): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = valueNoise3(x * freq, y * freq, z * freq, seed + i * 2333);
    const r = 1 - Math.abs(n * 2 - 1);
    sum += r * r * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.05;
  }
  return sum / norm;
}

export { hash2, hash3 };

/** Tree / cactus placement — sparse deterministic; keep spawn origin clear */
export function shouldPlaceTree(
  wx: number,
  wz: number,
  seed: number,
  threshold = 0.985,
): boolean {
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
