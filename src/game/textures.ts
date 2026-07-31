import * as THREE from "three";
import { ATLAS_TILES, TILE_SIZE } from "./blocks";

/** Procedural pixel-art block atlas — nearest-filtered for Minecraft look */

function setPixel(
  data: Uint8ClampedArray,
  x: number,
  y: number,
  w: number,
  r: number,
  g: number,
  b: number,
  a = 255,
) {
  if (x < 0 || y < 0 || x >= w || y >= w) return;
  const i = (y * w + x) * 4;
  data[i] = r;
  data[i + 1] = g;
  data[i + 2] = b;
  data[i + 3] = a;
}

function drawTile(
  data: Uint8ClampedArray,
  tile: number,
  atlasW: number,
  paint: (
    px: number,
    py: number,
    set: (r: number, g: number, b: number, a?: number) => void,
  ) => void,
) {
  const col = tile % ATLAS_TILES;
  const row = Math.floor(tile / ATLAS_TILES);
  const ox = col * TILE_SIZE;
  const oy = row * TILE_SIZE;
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      paint(x, y, (r, g, b, a = 255) =>
        setPixel(data, ox + x, oy + y, atlasW, r, g, b, a),
      );
    }
  }
}

/** Solid fill a tile by index (correct atlas placement) */
function fillTile(
  data: Uint8ClampedArray,
  tile: number,
  atlasW: number,
  r: number,
  g: number,
  b: number,
  a = 255,
) {
  drawTile(data, tile, atlasW, (_x, _y, set) => set(r, g, b, a));
}

export function createBlockAtlas(): THREE.CanvasTexture {
  const atlasPx = ATLAS_TILES * TILE_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = atlasPx;
  canvas.height = atlasPx;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(atlasPx, atlasPx);
  const d = img.data;

  // Unused slots: opaque black (never magenta — wrong linear offsets used to
  // scribble into neighboring tiles like leaves)
  for (let t = 0; t < ATLAS_TILES * ATLAS_TILES; t++) {
    fillTile(d, t, atlasPx, 0, 0, 0, 255);
  }

  // 0 — grass top
  drawTile(d, 0, atlasPx, (x, y, set) => {
    const n = ((x * 7 + y * 13) % 5) - 2;
    set(74 + n * 4, 148 + n * 3, 62 + n * 2);
    if ((x + y) % 7 === 0) set(58, 120, 48);
  });

  // 1 — grass side
  drawTile(d, 1, atlasPx, (x, y, set) => {
    if (y < 4) {
      const n = ((x * 3 + y) % 3) - 1;
      set(74 + n * 5, 140 + n * 4, 55 + n * 2);
    } else {
      const n = ((x * 5 + y * 9) % 5) - 2;
      set(130 + n * 4, 90 + n * 3, 50 + n * 2);
    }
  });

  // 2 — dirt
  drawTile(d, 2, atlasPx, (x, y, set) => {
    const n = ((x * 5 + y * 9) % 5) - 2;
    set(130 + n * 5, 90 + n * 4, 50 + n * 3);
    if ((x * y) % 11 === 0) set(100, 70, 40);
  });

  // 3 — stone
  drawTile(d, 3, atlasPx, (x, y, set) => {
    const n = ((x * 11 + y * 17) % 7) - 3;
    set(120 + n * 4, 120 + n * 4, 124 + n * 3);
    if ((x + y * 3) % 9 === 0) set(90, 90, 94);
  });

  // 4 — sand
  drawTile(d, 4, atlasPx, (x, y, set) => {
    const n = ((x * 3 + y * 5) % 4) - 1;
    set(210 + n * 5, 190 + n * 4, 130 + n * 3);
  });

  // 5 — wood top (rings)
  drawTile(d, 5, atlasPx, (x, y, set) => {
    const cx = x - 7.5;
    const cy = y - 7.5;
    const r = Math.sqrt(cx * cx + cy * cy);
    const ring = Math.floor(r) % 2 === 0;
    if (ring) set(160, 120, 70);
    else set(120, 85, 45);
  });

  // 6 — wood side (bark)
  drawTile(d, 6, atlasPx, (x, y, set) => {
    const n = ((x * 2 + y) % 4) - 1;
    if (x % 4 === 0) set(70, 48, 28);
    else set(100 + n * 4, 70 + n * 3, 40 + n * 2);
  });

  // 7 — leaves (holes keep leaf-green RGB so edge samples never pick garbage)
  drawTile(d, 7, atlasPx, (x, y, set) => {
    const hole = (x * 3 + y * 7) % 11 === 0 || (x + y * 5) % 13 === 0;
    const n = ((x + y) % 3) - 1;
    const r = 45 + n * 8;
    const g = 110 + n * 6;
    const b = 48 + n * 4;
    if (hole) {
      set(r, g, b, 0);
    } else {
      set(r, g, b, 255);
    }
  });

  // 8 — cobble
  drawTile(d, 8, atlasPx, (x, y, set) => {
    const cell = Math.floor(x / 4) + Math.floor(y / 4) * 4;
    const n = (cell * 37) % 20 - 10;
    set(100 + n, 100 + n, 104 + n);
    if (x % 4 === 0 || y % 4 === 0) set(70, 70, 74);
  });

  // 9 — planks
  drawTile(d, 9, atlasPx, (x, y, set) => {
    const n = ((x + y * 2) % 3) - 1;
    set(180 + n * 4, 140 + n * 3, 80 + n * 2);
    if (y % 4 === 0) set(140, 105, 55);
    if (x === 7 || x === 8) set(150, 110, 60);
  });

  // 10 — bedrock
  drawTile(d, 10, atlasPx, (x, y, set) => {
    const n = ((x * 13 + y * 19) % 9) - 4;
    set(40 + n * 3, 40 + n * 3, 44 + n * 2);
  });

  // 11 — snow
  drawTile(d, 11, atlasPx, (x, y, set) => {
    const n = ((x * 5 + y * 3) % 4) - 1;
    set(230 + n * 3, 236 + n * 2, 242 + n * 2);
    if ((x + y * 2) % 11 === 0) set(210, 220, 230);
  });

  // 12 — ice
  drawTile(d, 12, atlasPx, (x, y, set) => {
    const n = ((x * 7 + y * 11) % 5) - 2;
    const a = 200;
    set(140 + n * 6, 190 + n * 5, 220 + n * 4, a);
    if ((x + y) % 8 === 0) set(180, 220, 240, 220);
  });

  // 13 — water
  drawTile(d, 13, atlasPx, (x, y, set) => {
    const n = ((x * 3 + y * 5) % 5) - 2;
    set(40 + n * 4, 100 + n * 6, 180 + n * 5, 180);
    if ((x + y * 3) % 9 === 0) set(60, 130, 200, 190);
  });

  // 14 — cactus
  drawTile(d, 14, atlasPx, (x, y, set) => {
    const n = ((x + y * 2) % 3) - 1;
    if (x <= 1 || x >= 14) set(30, 70, 35);
    else set(50 + n * 6, 130 + n * 5, 55 + n * 3);
    if (y % 5 === 0) set(40, 100, 45);
  });

  // 15 — snowy grass side (snow cap + dirt)
  drawTile(d, 15, atlasPx, (x, y, set) => {
    if (y < 5) {
      const n = ((x * 3 + y) % 3) - 1;
      set(225 + n * 4, 232 + n * 3, 240 + n * 2);
    } else {
      const n = ((x * 5 + y * 9) % 5) - 2;
      set(130 + n * 4, 90 + n * 3, 50 + n * 2);
    }
  });

  ctx.putImageData(img, 0, 0);


  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function tileUVs(tile: number): { u0: number; v0: number; u1: number; v1: number } {
  const col = tile % ATLAS_TILES;
  const row = Math.floor(tile / ATLAS_TILES);
  // three.js UV origin is bottom-left; canvas putImageData is top-left
  const u0 = col / ATLAS_TILES;
  const u1 = (col + 1) / ATLAS_TILES;
  const v1 = 1 - row / ATLAS_TILES;
  const v0 = 1 - (row + 1) / ATLAS_TILES;
  // Half-texel inset so nearest samples stay inside the tile
  const pad = 0.5 / (ATLAS_TILES * TILE_SIZE);
  return {
    u0: u0 + pad,
    v0: v0 + pad,
    u1: u1 - pad,
    v1: v1 - pad,
  };
}

/**
 * Minecraft-style progressive block-break crack stages (0..9).
 * Transparent background with dark crack lines that densify per stage.
 */
export function createDestroyCrackTextures(): THREE.CanvasTexture[] {
  const size = 16;
  const stages: THREE.CanvasTexture[] = [];

  for (let stage = 0; stage < 10; stage++) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const img = ctx.createImageData(size, size);
    const d = img.data;
    // fully transparent
    for (let i = 0; i < d.length; i += 4) {
      d[i] = 0;
      d[i + 1] = 0;
      d[i + 2] = 0;
      d[i + 3] = 0;
    }

    const set = (x: number, y: number, a: number) => {
      if (x < 0 || y < 0 || x >= size || y >= size) return;
      const i = (y * size + x) * 4;
      d[i] = 20;
      d[i + 1] = 20;
      d[i + 2] = 22;
      d[i + 3] = Math.max(d[i + 3]!, a);
    };

    // Seed crack lines that grow with stage (classic radial spiderweb feel)
    const seeds = [
      { x0: 1, y0: 2, x1: 14, y1: 7 },
      { x0: 2, y0: 14, x1: 12, y1: 1 },
      { x0: 8, y0: 0, x1: 6, y1: 15 },
      { x0: 0, y0: 9, x1: 15, y1: 11 },
      { x0: 3, y0: 3, x1: 13, y1: 13 },
      { x0: 13, y0: 2, x1: 4, y1: 14 },
      { x0: 1, y0: 11, x1: 10, y1: 4 },
      { x0: 7, y0: 1, x1: 15, y1: 9 },
      { x0: 0, y0: 5, x1: 9, y1: 15 },
      { x0: 11, y0: 0, x1: 2, y1: 8 },
    ];

    const active = Math.min(seeds.length, 2 + stage);
    const thickness = stage < 3 ? 1 : stage < 7 ? 1.2 : 1.5;

    for (let s = 0; s < active; s++) {
      const line = seeds[s]!;
      // How much of the line is drawn — early stages partial
      const tMax = Math.min(1, 0.35 + stage * 0.08 + s * 0.04);
      const steps = 20 + stage * 2;
      for (let i = 0; i <= steps * tMax; i++) {
        const t = i / steps;
        const x = line.x0 + (line.x1 - line.x0) * t;
        const y = line.y0 + (line.y1 - line.y0) * t;
        // slight wiggle
        const w = Math.sin(t * 12 + s) * (0.3 + stage * 0.05);
        const px = Math.round(x + w);
        const py = Math.round(y + Math.cos(t * 9 + s) * 0.25);
        const alpha = 160 + stage * 8;
        set(px, py, alpha);
        if (thickness > 1) {
          set(px + 1, py, alpha * 0.85);
          set(px, py + 1, alpha * 0.75);
        }
        // branch cracks mid-late stages
        if (stage >= 3 && i % 5 === 0) {
          const bx = px + ((s + stage) % 3) - 1;
          const by = py + ((s * 3 + stage) % 3) - 1;
          set(bx, by, alpha * 0.7);
        }
      }
    }

    // Late stages: chip/pock marks
    if (stage >= 5) {
      for (let n = 0; n < stage * 3; n++) {
        const px = (n * 7 + stage * 3) % size;
        const py = (n * 11 + stage * 5) % size;
        set(px, py, 140 + stage * 6);
        if (stage >= 7) set(px + 1, py, 100);
      }
    }

    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    stages.push(tex);
  }
  return stages;
}

