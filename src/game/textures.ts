import * as THREE from "three";
import { ATLAS_TILES, TILE_SIZE, BLOCKS, Block, isDoor, isLadder } from "./blocks";

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

function clamp(v: number, lo = 0, hi = 255): number {
  return Math.max(lo, Math.min(hi, v | 0));
}

/** Tiny integer hash → 0..1 (stable pixel noise) */
function h01(x: number, y: number, s = 0): number {
  let n = (x * 374761393 + y * 668265263 + s * 1274126177) | 0;
  n = (n ^ (n >>> 13)) * 1274126177;
  n = n ^ (n >>> 16);
  return (n >>> 0) / 4294967295;
}

function hSigned(x: number, y: number, s = 0): number {
  return h01(x, y, s) * 2 - 1;
}

function mixRGB(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
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

export type BlockIconMap = Record<number, string>;

export function createBlockAtlas(): {
  texture: THREE.CanvasTexture;
  dataUrl: string;
  icons: BlockIconMap;
} {
  const atlasPx = ATLAS_TILES * TILE_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = atlasPx;
  canvas.height = atlasPx;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(atlasPx, atlasPx);
  const d = img.data;

  // Magenta-free base: solid tiles opaque black, plant slots transparent
  for (let t = 0; t < 16; t++) fillTile(d, t, atlasPx, 0, 0, 0, 255);
  for (let t = 16; t < ATLAS_TILES * ATLAS_TILES; t++)
    fillTile(d, t, atlasPx, 0, 0, 0, 0);

  // ───────────────────────────────────────────────────────────
  // 0 — grass top: soft clumps, subtle blade noise (greens only)
  // ───────────────────────────────────────────────────────────
  drawTile(d, 0, atlasPx, (x, y, set) => {
    const n = hSigned(x, y, 1) * 0.5 + hSigned(x >> 1, y >> 1, 2) * 0.5;
    const clump = h01(x >> 2, y >> 2, 3);
    const base = mixRGB([52, 118, 48], [78, 148, 68], 0.45 + clump * 0.4);
    let r = base[0] + n * 10;
    let g = base[1] + n * 12;
    let b = base[2] + n * 6;
    // sparse darker “soil peeks”
    if (h01(x, y, 4) > 0.92) {
      r -= 14;
      g -= 18;
      b -= 10;
    }
    // sparse bright blade tips
    if (h01(x, y, 5) > 0.94) {
      r += 12;
      g += 16;
      b += 6;
    }
    set(clamp(r), clamp(g), clamp(b));
  });

  // ───────────────────────────────────────────────────────────
  // 1 — grass side: top grass fringe + dirt body
  // ───────────────────────────────────────────────────────────
  drawTile(d, 1, atlasPx, (x, y, set) => {
    const fringe = 3 + ((h01(x, 0, 6) * 2) | 0); // 3–4 px
    if (y < fringe) {
      const n = hSigned(x, y, 7);
      const deep = y === fringe - 1 && h01(x, y, 8) > 0.55;
      if (deep) set(46, 96, 40);
      else
        set(
          clamp(56 + n * 10),
          clamp(128 + n * 12),
          clamp(50 + n * 6),
        );
      // blade tips on top row
      if (y === 0 && h01(x, y, 9) > 0.55)
        set(clamp(72 + n * 8), clamp(150 + n * 8), clamp(60 + n * 4));
    } else {
      // dirt body with soft mottling
      const n =
        hSigned(x, y, 10) * 0.6 + hSigned(x >> 1, y >> 1, 11) * 0.4;
      let r = 122 + n * 14;
      let g = 84 + n * 10;
      let b = 50 + n * 6;
      if (h01(x, y, 12) > 0.9) {
        r -= 18;
        g -= 14;
        b -= 8;
      }
      if (h01(x, y, 13) > 0.93) {
        r += 16;
        g += 10;
        b += 6;
      }
      // tiny pebble
      if (h01(x, y, 14) > 0.97) set(98, 92, 82);
      else set(clamp(r), clamp(g), clamp(b));
    }
  });

  // ───────────────────────────────────────────────────────────
  // 2 — dirt: rich soil, pebbles, soft clumps
  // ───────────────────────────────────────────────────────────
  drawTile(d, 2, atlasPx, (x, y, set) => {
    const n =
      hSigned(x, y, 20) * 0.55 + hSigned(x >> 1, y >> 1, 21) * 0.45;
    const clump = h01(x >> 2, y >> 2, 22);
    const base = mixRGB([108, 72, 42], [138, 96, 56], 0.35 + clump * 0.5);
    let r = base[0] + n * 12;
    let g = base[1] + n * 9;
    let b = base[2] + n * 5;
    // darker pockets
    if (h01(x, y, 23) > 0.88) {
      r -= 16;
      g -= 12;
      b -= 8;
    }
    // light dry spots
    if (h01(x, y, 24) > 0.92) {
      r += 14;
      g += 10;
      b += 6;
    }
    // pebbles
    if (h01(x, y, 25) > 0.965) {
      const p = h01(x, y, 26);
      set(
        clamp(90 + p * 40),
        clamp(86 + p * 30),
        clamp(78 + p * 20),
      );
      return;
    }
    set(clamp(r), clamp(g), clamp(b));
  });

  // ───────────────────────────────────────────────────────────
  // 3 — stone: layered grey with subtle cracks
  // ───────────────────────────────────────────────────────────
  drawTile(d, 3, atlasPx, (x, y, set) => {
    const n =
      hSigned(x, y, 30) * 0.5 + hSigned(x >> 1, y >> 1, 31) * 0.5;
    const band = h01(x, y >> 2, 32);
    let v = 118 + n * 14 + band * 8;
    // micro flecks
    if (h01(x, y, 33) > 0.93) v -= 18;
    if (h01(x, y, 34) > 0.95) v += 14;
    // crack lines
    const crack =
      (Math.abs((x * 3 + y * 5 + 2) % 17) === 0 && h01(x, y, 35) > 0.4) ||
      (Math.abs((x * 5 - y * 2) % 19) === 0 && h01(x, y, 36) > 0.55);
    if (crack) v -= 28;
    set(clamp(v), clamp(v), clamp(v + 3));
  });

  // ───────────────────────────────────────────────────────────
  // 4 — sand: warm fine grain + soft dunes
  // ───────────────────────────────────────────────────────────
  drawTile(d, 4, atlasPx, (x, y, set) => {
    const n =
      hSigned(x, y, 40) * 0.45 + hSigned(x >> 1, y >> 1, 41) * 0.35;
    const dune = Math.sin((x + y * 0.6) * 0.55) * 0.5 + 0.5;
    let r = 214 + n * 10 + dune * 8;
    let g = 194 + n * 8 + dune * 6;
    let b = 132 + n * 6 + dune * 4;
    if (h01(x, y, 42) > 0.94) {
      r -= 12;
      g -= 10;
      b -= 8;
    }
    if (h01(x, y, 43) > 0.96) {
      r += 10;
      g += 8;
    }
    set(clamp(r), clamp(g), clamp(b));
  });

  // ───────────────────────────────────────────────────────────
  // 5 — wood top: growth rings + soft center
  // ───────────────────────────────────────────────────────────
  drawTile(d, 5, atlasPx, (x, y, set) => {
    const cx = x - 7.5;
    const cy = y - 7.5;
    const r0 = Math.sqrt(cx * cx + cy * cy);
    const ring = Math.sin(r0 * 1.65 + hSigned(x, y, 50) * 0.35);
    const heart = r0 < 1.6;
    if (heart) {
      set(96, 68, 36);
      return;
    }
    const light = ring > 0;
    const n = hSigned(x, y, 51) * 4;
    if (light) set(clamp(168 + n), clamp(128 + n * 0.7), clamp(72 + n * 0.4));
    else set(clamp(124 + n), clamp(88 + n * 0.7), clamp(48 + n * 0.4));
  });

  // ───────────────────────────────────────────────────────────
  // 6 — wood side / bark: vertical grain + dark seams
  // ───────────────────────────────────────────────────────────
  drawTile(d, 6, atlasPx, (x, y, set) => {
    const grain = hSigned(x, y, 60) * 0.4 + hSigned(x, y >> 1, 61) * 0.6;
    const strip = h01(x, 0, 62);
    // bark ridges every few columns
    const ridge = x % 4 === 0 || (x % 4 === 1 && strip > 0.6);
    if (ridge) {
      set(
        clamp(62 + grain * 8),
        clamp(44 + grain * 6),
        clamp(26 + grain * 4),
      );
      return;
    }
    let r = 108 + grain * 14;
    let g = 76 + grain * 10;
    let b = 42 + grain * 6;
    // knot
    if (h01(x >> 1, y >> 1, 63) > 0.93 && Math.hypot(x - 8, y - 9) < 2.4) {
      r -= 30;
      g -= 22;
      b -= 12;
    }
    set(clamp(r), clamp(g), clamp(b));
  });

  // ───────────────────────────────────────────────────────────
  // 7 — leaves: leafy clusters, clean alpha (no edge fringing)
  // ───────────────────────────────────────────────────────────
  drawTile(d, 7, atlasPx, (x, y, set) => {
    // Cluster field — avoid top-row-only holes that cause magenta artifacts
    const c1 = h01(x >> 1, y >> 1, 70);
    const c2 = h01(x, y, 71);
    const edge =
      x === 0 || y === 0 || x === TILE_SIZE - 1 || y === TILE_SIZE - 1;
    // Keep most of tile filled; sparse holes interior only
    const hole = !edge && c1 > 0.82 && c2 > 0.55;
    if (hole) {
      set(0, 0, 0, 0);
      return;
    }
    const n = hSigned(x, y, 72);
    const tone = h01(x >> 2, y >> 2, 73);
    const base = mixRGB([40, 102, 42], [62, 138, 58], tone);
    // slight yellow-green highlights
    const hi = h01(x, y, 74) > 0.9;
    let r = base[0] + n * 8;
    let g = base[1] + n * 10;
    let b = base[2] + n * 5;
    if (hi) {
      r += 10;
      g += 14;
      b += 4;
    }
    set(clamp(r), clamp(g), clamp(b), 255);
  });

  // ───────────────────────────────────────────────────────────
  // 8 — cobble: irregular stones with mortar
  // ───────────────────────────────────────────────────────────
  drawTile(d, 8, atlasPx, (x, y, set) => {
    // Voronoi-ish cells via nearest of a few feature points
    let best = 1e9;
    let bestI = 0;
    for (let i = 0; i < 8; i++) {
      const fx = (h01(i, 0, 80) * 14 + 1) | 0;
      const fy = (h01(i, 1, 81) * 14 + 1) | 0;
      const dx = x - fx;
      const dy = y - fy;
      const dist = dx * dx + dy * dy;
      if (dist < best) {
        best = dist;
        bestI = i;
      }
    }
    // second nearest for edge detect
    let best2 = 1e9;
    for (let i = 0; i < 8; i++) {
      if (i === bestI) continue;
      const fx = (h01(i, 0, 80) * 14 + 1) | 0;
      const fy = (h01(i, 1, 81) * 14 + 1) | 0;
      const dx = x - fx;
      const dy = y - fy;
      const dist = dx * dx + dy * dy;
      if (dist < best2) best2 = dist;
    }
    const edge = best2 - best < 6;
    const shade = hSigned(bestI, 0, 82);
    if (edge) {
      set(68, 68, 72);
      return;
    }
    const v = 108 + shade * 16 + hSigned(x, y, 83) * 6;
    set(clamp(v), clamp(v), clamp(v + 4));
  });

  // ───────────────────────────────────────────────────────────
  // 9 — planks: warm boards + grain + nail dots
  // ───────────────────────────────────────────────────────────
  drawTile(d, 9, atlasPx, (x, y, set) => {
    const board = Math.floor(y / 4);
    const localY = y % 4;
    const n =
      hSigned(x, y, 90 + board) * 0.55 + hSigned(x >> 1, board, 91) * 0.45;
    // board base tone varies per board
    const boardT = h01(board, 0, 92);
    let r = 178 + boardT * 16 + n * 10;
    let g = 136 + boardT * 10 + n * 7;
    let b = 78 + boardT * 6 + n * 4;
    // seam between boards
    if (localY === 0) {
      r -= 36;
      g -= 28;
      b -= 18;
    }
    // vertical grain lines
    if (h01(x, board, 93) > 0.78 && localY > 0) {
      r -= 12;
      g -= 10;
      b -= 6;
    }
    // tiny nail heads near ends
    if (
      localY === 2 &&
      (x === 1 || x === 14) &&
      h01(board, x, 94) > 0.3
    ) {
      set(92, 88, 80);
      return;
    }
    set(clamp(r), clamp(g), clamp(b));
  });

  // ───────────────────────────────────────────────────────────
  // 10 — bedrock: chaotic dark rock
  // ───────────────────────────────────────────────────────────
  drawTile(d, 10, atlasPx, (x, y, set) => {
    const n =
      hSigned(x, y, 100) * 0.5 +
      hSigned(x >> 1, y >> 1, 101) * 0.3 +
      hSigned(x >> 2, y >> 2, 102) * 0.2;
    let v = 42 + n * 18;
    if (h01(x, y, 103) > 0.9) v += 16;
    if (h01(x, y, 104) > 0.92) v -= 12;
    // pock marks
    if (h01(x, y, 105) > 0.97) v = 22;
    set(clamp(v), clamp(v), clamp(v + 4));
  });

  // ───────────────────────────────────────────────────────────
  // 11 — snow: soft sparkle, cool whites
  // ───────────────────────────────────────────────────────────
  drawTile(d, 11, atlasPx, (x, y, set) => {
    const n = hSigned(x, y, 110) * 0.5 + hSigned(x >> 1, y >> 1, 111) * 0.5;
    let r = 232 + n * 6;
    let g = 238 + n * 5;
    let b = 244 + n * 4;
    if (h01(x, y, 112) > 0.94) {
      r -= 10;
      g -= 8;
      b -= 4;
    }
    if (h01(x, y, 113) > 0.97) {
      r = 255;
      g = 255;
      b = 255;
    }
    set(clamp(r), clamp(g), clamp(b));
  });

  // ───────────────────────────────────────────────────────────
  // 12 — ice: translucent blue with cracks
  // ───────────────────────────────────────────────────────────
  drawTile(d, 12, atlasPx, (x, y, set) => {
    const n = hSigned(x, y, 120) * 0.5 + hSigned(x >> 1, y >> 1, 121) * 0.5;
    let r = 150 + n * 10;
    let g = 198 + n * 8;
    let b = 228 + n * 6;
    // fracture
    if (
      Math.abs((x * 3 + y * 7) % 13) === 0 ||
      Math.abs((x * 5 - y * 2) % 17) === 0
    ) {
      r -= 20;
      g -= 10;
      b += 8;
    }
    // highlight flecks
    if (h01(x, y, 122) > 0.96) {
      r = 220;
      g = 240;
      b = 255;
    }
    set(clamp(r), clamp(g), clamp(b), 210);
  });

  // ───────────────────────────────────────────────────────────
  // 13 — water (atlas fallback / icon): deep teal-blue waves
  // ───────────────────────────────────────────────────────────
  drawTile(d, 13, atlasPx, (x, y, set) => {
    const wave = Math.sin(x * 0.7 + y * 0.35) * 0.5 + 0.5;
    const n = hSigned(x, y, 130);
    let r = 36 + wave * 18 + n * 6;
    let g = 110 + wave * 30 + n * 8;
    let b = 190 + wave * 20 + n * 6;
    if (h01(x, y, 131) > 0.93) {
      r += 20;
      g += 25;
      b += 15;
    }
    set(clamp(r), clamp(g), clamp(b), 190);
  });

  // ───────────────────────────────────────────────────────────
  // 14 — cactus: vertical ribs + dark edge
  // ───────────────────────────────────────────────────────────
  drawTile(d, 14, atlasPx, (x, y, set) => {
    if (x <= 1 || x >= 14) {
      set(28, 68, 32);
      return;
    }
    const rib = x % 3 === 0;
    const n = hSigned(x, y, 140);
    let r = 48 + n * 6;
    let g = 128 + n * 10;
    let b = 52 + n * 4;
    if (rib) {
      r -= 8;
      g -= 14;
      b -= 6;
    }
    // sparse spines
    if (!rib && h01(x, y, 141) > 0.94) set(220, 220, 200);
    else set(clamp(r), clamp(g), clamp(b));
  });

  // ───────────────────────────────────────────────────────────
  // 15 — snowy grass side
  // ───────────────────────────────────────────────────────────
  drawTile(d, 15, atlasPx, (x, y, set) => {
    const snowH = 4 + ((h01(x, 0, 150) * 2) | 0);
    if (y < snowH) {
      const n = hSigned(x, y, 151);
      set(clamp(228 + n * 6), clamp(234 + n * 5), clamp(242 + n * 4));
      if (y === snowH - 1 && h01(x, y, 152) > 0.5) set(200, 210, 220);
    } else {
      const n =
        hSigned(x, y, 153) * 0.6 + hSigned(x >> 1, y >> 1, 154) * 0.4;
      set(
        clamp(126 + n * 12),
        clamp(86 + n * 9),
        clamp(50 + n * 5),
      );
    }
  });

  // —— Plant tiles 16+ (transparent bg, improved pixel art) ——
  paintPlant(d, atlasPx, 16, "grass");
  paintPlant(d, atlasPx, 17, "fern");
  paintPlant(d, atlasPx, 18, "dead");
  paintPlant(d, atlasPx, 19, "flower", 220, 48, 52);
  paintPlant(d, atlasPx, 20, "flower", 242, 208, 48);
  paintPlant(d, atlasPx, 21, "flower", 72, 118, 228);
  paintPlant(d, atlasPx, 22, "flower", 196, 96, 214);
  paintPlant(d, atlasPx, 23, "flower", 232, 236, 242);
  paintPlant(d, atlasPx, 24, "daisy");
  paintPlant(d, atlasPx, 25, "tulip", 224, 46, 58);
  paintPlant(d, atlasPx, 26, "tulip", 234, 142, 48);
  paintPlant(d, atlasPx, 27, "tulip", 236, 142, 178);
  paintPlant(d, atlasPx, 28, "tulip", 244, 240, 232);
  paintPlant(d, atlasPx, 29, "flower", 88, 124, 236);
  paintPlant(d, atlasPx, 30, "lavender");
  paintPlant(d, atlasPx, 31, "sunflower");
  paintPlant(d, atlasPx, 32, "rose");
  paintPlant(d, atlasPx, 33, "mushR");
  paintPlant(d, atlasPx, 34, "mushB");
  paintPlant(d, atlasPx, 35, "cattail");
  paintPlant(d, atlasPx, 36, "fireweed");
  paintPlant(d, atlasPx, 37, "torch");

  // 38 — coal ore: stone + charcoal flecks
  drawTile(d, 38, atlasPx, (x, y, set) => {
    const n = hSigned(x, y, 380) * 0.5 + hSigned(x >> 1, y >> 1, 381) * 0.5;
    let v = 118 + n * 14;
    if (h01(x, y, 382) > 0.93) v -= 16;
    const blob =
      h01(x >> 1, y >> 1, 383) > 0.62 && h01(x, y, 384) > 0.35;
    if (blob) {
      const c = 28 + h01(x, y, 385) * 18;
      set(clamp(c), clamp(c), clamp(c + 4));
      return;
    }
    set(clamp(v), clamp(v), clamp(v + 3));
  });

  // 39 — iron ore: stone + rusty-peach specks
  drawTile(d, 39, atlasPx, (x, y, set) => {
    const n = hSigned(x, y, 390) * 0.5 + hSigned(x >> 1, y >> 1, 391) * 0.5;
    let v = 118 + n * 14;
    const blob =
      h01(x >> 1, y >> 1, 392) > 0.58 && h01(x, y, 393) > 0.32;
    if (blob) {
      const t = h01(x, y, 394);
      set(
        clamp(176 + t * 40),
        clamp(132 + t * 24),
        clamp(88 + t * 16),
      );
      return;
    }
    set(clamp(v), clamp(v), clamp(v + 3));
  });

  // 40 — furnace top / bottom: ring of cobble around a dark well
  drawTile(d, 40, atlasPx, (x, y, set) => {
    const n = hSigned(x, y, 400) * 0.4;
    const edge = x < 2 || y < 2 || x > 13 || y > 13;
    const hole = x >= 5 && x <= 10 && y >= 5 && y <= 10;
    if (hole) {
      set(clamp(36 + n * 8), clamp(32 + n * 6), clamp(30 + n * 6));
      return;
    }
    const v = (edge ? 88 : 108) + n * 16;
    set(clamp(v), clamp(v - 4), clamp(v - 8));
  });

  // 42 — furnace front (cold)
  drawTile(d, 42, atlasPx, (x, y, set) => {
    paintFurnaceFront(x, y, set, false);
  });

  // 43 — furnace front (lit)
  drawTile(d, 43, atlasPx, (x, y, set) => {
    paintFurnaceFront(x, y, set, true);
  });

  // 44 — chest top / lid
  drawTile(d, 44, atlasPx, (x, y, set) => {
    paintChestFace(x, y, set, "top");
  });

  // 45 — chest front (lock)
  drawTile(d, 45, atlasPx, (x, y, set) => {
    paintChestFace(x, y, set, "front");
  });

  // 46 — chest side / bottom
  drawTile(d, 46, atlasPx, (x, y, set) => {
    paintChestFace(x, y, set, "side");
  });

  // 47 — bed top: pillow + quilt
  drawTile(d, 47, atlasPx, (x, y, set) => {
    paintBedFace(x, y, set, true);
  });
  // 48 — bed side
  drawTile(d, 48, atlasPx, (x, y, set) => {
    paintBedFace(x, y, set, false);
  });

  // 49 — door lower (planks + handle)
  drawTile(d, 49, atlasPx, (x, y, set) => {
    paintDoorFace(x, y, set, false);
  });
  // 51 — door upper (window)
  drawTile(d, 51, atlasPx, (x, y, set) => {
    paintDoorFace(x, y, set, true);
  });
  // 50 — ladder
  drawTile(d, 50, atlasPx, (x, y, set) => {
    paintLadderFace(x, y, set);
  });

  ctx.putImageData(img, 0, 0);
  const icons = buildIsometricBlockIcons(canvas);

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return { texture: tex, dataUrl: canvas.toDataURL("image/png"), icons };
}

function paintFurnaceFront(
  x: number,
  y: number,
  set: (r: number, g: number, b: number, a?: number) => void,
  lit: boolean,
): void {
  const n = hSigned(x, y, 420) * 0.35;
  // Stone brick frame
  const frame = x < 2 || x > 13 || y < 1 || y > 14;
  if (frame) {
    const v = 104 + n * 14;
    set(clamp(v), clamp(v - 4), clamp(v - 8));
    return;
  }
  // Mouth
  const mouth = x >= 4 && x <= 11 && y >= 3 && y <= 8;
  if (mouth) {
    if (lit) {
      const glow = 1 - Math.abs(x - 7.5) / 5 - (8 - y) * 0.06;
      const t = Math.max(0, glow) + h01(x, y, 421) * 0.15;
      set(
        clamp(80 + t * 180),
        clamp(28 + t * 90),
        clamp(10 + t * 20),
      );
    } else {
      set(clamp(22 + n * 6), clamp(20 + n * 5), clamp(18 + n * 4));
    }
    return;
  }
  // Ash tray
  if (x >= 5 && x <= 10 && y >= 11 && y <= 13) {
    if (lit) {
      set(clamp(90 + n * 20), clamp(40 + n * 10), clamp(18));
    } else {
      set(clamp(40 + n * 8), clamp(36 + n * 6), clamp(32 + n * 6));
    }
    return;
  }
  const v = 112 + n * 12;
  set(clamp(v), clamp(v - 6), clamp(v - 10));
}

function paintChestFace(
  x: number,
  y: number,
  set: (r: number, g: number, b: number, a?: number) => void,
  face: "top" | "front" | "side",
): void {
  const n = hSigned(x, y, face === "top" ? 440 : face === "front" ? 450 : 460);
  const grain =
    face === "top"
      ? hSigned(x, y >> 1, 441) * 10
      : hSigned(x >> 1, y, 451) * 10;
  const plank =
    face === "top" ? (x >> 2) & 1 : (y >> 2) & 1;
  let r = 172 + n * 14 + grain + (plank ? -12 : 8);
  let g = 108 + n * 10 + grain * 0.6 + (plank ? -10 : 5);
  let b = 48 + n * 6 + (plank ? -6 : 3);

  const rim =
    x < 1 || y < 1 || x > 14 || y > 14 ||
    (face !== "top" && (y === 4 || y === 5));
  if (rim) {
    r -= 36;
    g -= 28;
    b -= 14;
  }

  const band =
    face === "top"
      ? y === 7 || y === 8
      : y === 9 || y === 10 || (face === "side" && (y === 1 || y === 2));
  if (band) {
    const m = 108 + n * 12;
    set(clamp(m), clamp(m + 2), clamp(m + 8));
    if ((x + y) % 5 === 0) set(clamp(m + 28), clamp(m + 28), clamp(m + 22));
    return;
  }

  if (face === "front") {
    // Gold latch spanning lid seam
    const lock = x >= 6 && x <= 9 && y >= 3 && y <= 8;
    if (lock) {
      const gold = 1 - Math.abs(x - 7.5) * 0.15;
      set(
        clamp(210 + gold * 30 + n * 8),
        clamp(168 + gold * 20 + n * 6),
        clamp(48 + n * 8),
      );
      if (x >= 7 && x <= 8 && y >= 5 && y <= 7) {
        set(48, 32, 16);
      }
      return;
    }
  }

  set(clamp(r), clamp(g), clamp(b));
}

function paintBedFace(
  x: number,
  y: number,
  set: (r: number, g: number, b: number, a?: number) => void,
  top: boolean,
): void {
  const n = hSigned(x, y, top ? 470 : 480);
  if (top) {
    const pillow = y <= 4;
    if (pillow) {
      set(clamp(232 + n * 10), clamp(226 + n * 8), clamp(210 + n * 8));
      if (y === 4) set(200, 190, 176);
      return;
    }
    const check = ((x >> 2) ^ (y >> 2)) & 1;
    const r = (check ? 176 : 148) + n * 12;
    set(clamp(r), clamp(42 + n * 8), clamp(48 + n * 8));
    if (x < 1 || x > 14 || y > 14) set(92, 28, 32);
    return;
  }
  // Side: wood frame + quilt lip
  if (y <= 3) {
    set(clamp(210 + n * 8), clamp(204 + n * 6), clamp(190 + n * 6));
    return;
  }
  if (y <= 8) {
    set(clamp(168 + n * 10), clamp(46 + n * 6), clamp(52 + n * 6));
    return;
  }
  const v = 118 + n * 12;
  set(clamp(v), clamp(78 + n * 8), clamp(42 + n * 6));
}

function paintDoorFace(
  x: number,
  y: number,
  set: (r: number, g: number, b: number, a?: number) => void,
  upper: boolean,
): void {
  const n = hSigned(x, y, upper ? 510 : 500);
  const frame = x < 1 || x > 14 || y < 1 || y > 14;
  if (frame) {
    set(clamp(72 + n * 8), clamp(46 + n * 6), clamp(26 + n * 4));
    return;
  }
  if (upper && x >= 4 && x <= 11 && y >= 3 && y <= 10) {
    const pane = ((x + y) & 1) === 0;
    set(
      clamp((pane ? 148 : 118) + n * 10),
      clamp((pane ? 186 : 154) + n * 8),
      clamp((pane ? 198 : 168) + n * 8),
    );
    if (x === 4 || x === 11 || y === 3 || y === 10) {
      set(clamp(64 + n * 6), clamp(42 + n * 4), clamp(24));
    }
    return;
  }
  const plank = (x / 4) | 0;
  const base = 148 + plank * 6 + n * 14;
  set(clamp(base), clamp(96 + n * 8), clamp(52 + n * 6));
  if (x === 4 || x === 8 || x === 12) {
    set(clamp(108 + n * 6), clamp(70 + n * 4), clamp(38));
  }
  if (!upper && x >= 12 && x <= 13 && y >= 7 && y <= 9) {
    set(clamp(196 + n * 8), clamp(158 + n * 6), clamp(48));
  }
}

function paintLadderFace(
  x: number,
  y: number,
  set: (r: number, g: number, b: number, a?: number) => void,
): void {
  const n = hSigned(x, y, 520);
  const rail = x <= 2 || x >= 13;
  const rung = y === 2 || y === 6 || y === 10 || y === 14;
  if (rail || rung) {
    const v = (rail ? 128 : 142) + n * 16;
    set(clamp(v), clamp(v * 0.68), clamp(v * 0.38));
    return;
  }
  set(0, 0, 0, 0);
}

function paintPlant(
  data: Uint8ClampedArray,
  atlasW: number,
  tile: number,
  kind: string,
  cr = 200,
  cg = 60,
  cb = 60,
) {
  // Build into a temp alpha mask for cleaner edges
  drawTile(data, tile, atlasW, (x, y, set) => {
    set(0, 0, 0, 0);
    const px = (r: number, g: number, b: number, a = 255) => set(r, g, b, a);

    const stem = (sx: number, y0: number, y1 = 14) => {
      if (x === sx && y >= y0 && y <= y1) {
        const n = hSigned(sx, y, 200);
        px(clamp(44 + n * 6), clamp(112 + n * 8), clamp(40 + n * 4));
      }
    };
    const leafDot = (lx: number, ly: number) => {
      if (x === lx && y === ly) px(56, 140, 52);
    };

    if (kind === "grass") {
      // Three blades of varying height with tip highlights
      const blades: [number, number, number][] = [
        [4, 7, 14],
        [5, 6, 14],
        [8, 4, 14],
        [9, 5, 14],
        [11, 8, 14],
        [12, 7, 14],
      ];
      for (const [bx, y0, y1] of blades) {
        if (x === bx && y >= y0 && y <= y1) {
          const t = (y1 - y) / (y1 - y0 + 1);
          px(
            clamp(58 + t * 20),
            clamp(138 + t * 24),
            clamp(48 + t * 10),
          );
        }
      }
    } else if (kind === "fern") {
      // Triangle: wide base (bottom), point top — frond texture
      const half = Math.max(0, (14 - y) * 0.48);
      if (y >= 2 && y <= 14 && Math.abs(x - 8) <= half + (y > 11 ? 0.8 : 0)) {
        const edge = Math.abs(x - 8) > half - 0.8;
        const n = hSigned(x, y, 210);
        if (edge) px(40, 108, 44);
        else px(clamp(52 + n * 8), clamp(136 + n * 10), clamp(54 + n * 4));
        // mid rib
        if (x === 8) px(46, 118, 48);
      }
    } else if (kind === "dead") {
      if ((x === 7 || x === 8) && y >= 6 && y <= 14)
        px(128, 96, 54);
      if (y === 5 && x >= 4 && x <= 11) px(138, 104, 58);
      if (y === 7 && (x === 3 || x === 4 || x === 11 || x === 12))
        px(122, 90, 50);
      if (y === 9 && (x === 5 || x === 10)) px(118, 88, 48);
    } else if (kind === "flower") {
      stem(7, 8);
      stem(8, 8);
      leafDot(5, 10);
      leafDot(10, 11);
      // petals
      const cx = 7.5;
      const cy = 5;
      const dx = x - cx;
      const dy = y - cy;
      const r2 = dx * dx + dy * dy;
      if (r2 < 9 && r2 >= 1.2) px(cr, cg, cb);
      if (r2 < 2.2) px(248, 226, 72);
      // petal tips brighter
      if (r2 >= 5 && r2 < 9 && h01(x, y, 220) > 0.4)
        px(clamp(cr + 20), clamp(cg + 12), clamp(cb + 12));
    } else if (kind === "daisy") {
      stem(7, 8);
      stem(8, 8);
      const petals: [number, number][] = [
        [0, -2],
        [0, 2],
        [-2, 0],
        [2, 0],
        [-2, -1],
        [2, -1],
        [-1, -2],
        [1, -2],
        [-1, 2],
        [1, 2],
        [-2, 1],
        [2, 1],
      ];
      for (const [ox, oy] of petals) {
        if ((x === 7 + ox || x === 8 + ox) && y === 5 + oy)
          px(248, 248, 242);
      }
      if ((x === 7 || x === 8) && (y === 5 || y === 4)) px(244, 204, 48);
    } else if (kind === "tulip") {
      stem(7, 9);
      stem(8, 9);
      leafDot(5, 11);
      leafDot(10, 12);
      if (y >= 3 && y <= 8 && x >= 5 && x <= 10) {
        // cup shape: wider mid, slightly closed top
        const w = y <= 4 ? 1.6 : y >= 7 ? 2.2 : 2.8;
        if (Math.abs(x - 7.5) <= w) {
          const edge = Math.abs(x - 7.5) > w - 0.7;
          if (edge) px(clamp(cr - 30), clamp(cg - 20), clamp(cb - 15));
          else px(cr, cg, cb);
        }
      }
      // highlight
      if ((x === 6 || x === 7) && y === 5) px(clamp(cr + 30), clamp(cg + 20), clamp(cb + 15));
    } else if (kind === "lavender") {
      stem(7, 8);
      stem(8, 8);
      for (let yy = 2; yy <= 9; yy++) {
        if (x >= 6 && x <= 9 && y === yy) {
          const t = (9 - yy) / 7;
          px(
            clamp(148 + t * 30 + (x % 2) * 8),
            clamp(96 + t * 10),
            clamp(188 + t * 20),
          );
        }
      }
      // tiny florets off stem
      if ((x === 5 || x === 10) && y >= 3 && y <= 7 && y % 2 === 0)
        px(160, 100, 200);
    } else if (kind === "sunflower") {
      stem(7, 9);
      stem(8, 9);
      leafDot(5, 11);
      leafDot(10, 12);
      const dx = x - 7.5;
      const dy = y - 5;
      const r2 = dx * dx + dy * dy;
      if (r2 < 16 && r2 >= 5) px(244, 198, 42);
      if (r2 < 5) px(86, 56, 28);
      if (r2 < 2) px(68, 44, 20);
      // petal tips
      if (r2 >= 12 && r2 < 16) px(252, 220, 70);
    } else if (kind === "rose") {
      stem(7, 8);
      stem(8, 8);
      leafDot(5, 10);
      leafDot(10, 11);
      const dx = x - 7.5;
      const dy = y - 5;
      const r2 = dx * dx + dy * dy;
      if (r2 < 10) px(198, 42, 58);
      if (r2 < 5) px(168, 28, 48);
      if (r2 < 1.5) px(140, 22, 40);
      if ((x === 6 || x === 7) && y === 4) px(230, 80, 90);
    } else if (kind === "mushR") {
      // stalk
      if (x >= 6 && x <= 9 && y >= 9 && y <= 14) {
        const n = hSigned(x, y, 230);
        px(clamp(222 + n * 6), clamp(214 + n * 4), clamp(196 + n * 4));
      }
      // cap
      if (x >= 4 && x <= 11 && y >= 4 && y <= 9) {
        const dx = x - 7.5;
        const dy = y - 6.5;
        if (dx * dx + dy * dy * 1.4 < 16) {
          px(204, 48, 48);
          // spots
          if (h01(x, y, 231) > 0.82) px(248, 244, 236);
        }
      }
    } else if (kind === "mushB") {
      if (x >= 6 && x <= 9 && y >= 9 && y <= 14)
        px(220, 210, 192);
      if (x >= 4 && x <= 11 && y >= 4 && y <= 9) {
        const dx = x - 7.5;
        const dy = y - 6.5;
        if (dx * dx + dy * dy * 1.4 < 16) {
          const n = hSigned(x, y, 232);
          px(clamp(128 + n * 8), clamp(98 + n * 6), clamp(68 + n * 4));
        }
      }
    } else if (kind === "cattail") {
      if ((x === 7 || x === 8) && y >= 6 && y <= 14)
        px(64, 122, 52);
      // brown head
      if (x >= 6 && x <= 9 && y >= 2 && y <= 7) {
        const n = hSigned(x, y, 233);
        px(clamp(98 + n * 8), clamp(68 + n * 6), clamp(38 + n * 4));
      }
      // tip fluff
      if ((x === 7 || x === 8) && y === 1) px(180, 160, 120);
    } else if (kind === "fireweed") {
      stem(7, 7);
      stem(8, 7);
      for (let yy = 2; yy <= 11; yy++) {
        if ((x === 7 || x === 8) && y === yy) {
          const t = (11 - yy) / 9;
          px(clamp(216 + t * 20), clamp(72 + t * 20), clamp(138 + t * 20));
        }
        if ((x === 6 || x === 9) && y === yy && yy % 2 === 0)
          px(228, 96, 158);
        if ((x === 5 || x === 10) && y === yy && yy % 3 === 0)
          px(236, 120, 170);
      }
    } else if (kind === "torch") {
      // stick — shorter so the flame has room to rise
      if ((x === 7 || x === 8) && y >= 9 && y <= 15) {
        const n = hSigned(x, y, 240);
        px(clamp(118 + n * 8), clamp(78 + n * 6), clamp(42 + n * 4));
      }
      if (x === 6 && y >= 10 && y <= 14) px(88, 56, 28);
      // wrap / coal head
      if (x >= 6 && x <= 9 && y >= 8 && y <= 10) px(52, 40, 32);
      // flame (static icon; live fire overwrites this tile)
      const fx = x - 7.5;
      const fy = y - 4.4;
      const fr = fx * fx + fy * fy * 0.55;
      if (y >= 0 && y <= 9 && Math.abs(fx) < 2.4 - (9 - y) * 0.12) {
        if (fr < 14) px(255, 210, 70);
        if (fr < 7) px(255, 140, 32);
        if (fr < 2.4) px(255, 248, 210);
      }
      if ((x === 7 || x === 8) && y <= 1) px(255, 230, 120);
    }
  });
}

function buildIsometricBlockIcons(atlas: HTMLCanvasElement): BlockIconMap {
  const icons: BlockIconMap = {};
  const size = 64;
  const face = document.createElement("canvas");
  face.width = TILE_SIZE;
  face.height = TILE_SIZE;
  const fctx = face.getContext("2d")!;

  const sampleTile = (tile: number): HTMLCanvasElement => {
    const col = tile % ATLAS_TILES;
    const row = Math.floor(tile / ATLAS_TILES);
    fctx.clearRect(0, 0, TILE_SIZE, TILE_SIZE);
    fctx.drawImage(
      atlas,
      col * TILE_SIZE,
      row * TILE_SIZE,
      TILE_SIZE,
      TILE_SIZE,
      0,
      0,
      TILE_SIZE,
      TILE_SIZE,
    );
    // copy so concurrent use is safe
    const copy = document.createElement("canvas");
    copy.width = TILE_SIZE;
    copy.height = TILE_SIZE;
    copy.getContext("2d")!.drawImage(face, 0, 0);
    return copy;
  };

  for (const idStr of Object.keys(BLOCKS)) {
    const id = Number(idStr);
    if (id === 0) continue;
    const def = BLOCKS[id];
    if (!def) continue;

    const out = document.createElement("canvas");
    out.width = size;
    out.height = size;
    const octx = out.getContext("2d")!;
    octx.imageSmoothingEnabled = false;
    octx.clearRect(0, 0, size, size);

    if (def.shape === "cross" || isDoor(id) || isLadder(id) || id === Block.DOOR) {
      const tile = def.tiles[2]!;
      const spr = sampleTile(tile);
      octx.fillStyle = "rgba(0,0,0,0.16)";
      octx.beginPath();
      octx.ellipse(size * 0.5, size * 0.86, size * 0.24, size * 0.07, 0, 0, Math.PI * 2);
      octx.fill();
      const pw = size * 0.9;
      octx.drawImage(spr, (size - pw) / 2, (size - pw) / 2, pw, pw);
    } else {
      paintIsoCube(
        octx,
        sampleTile,
        def.tiles[0]!,
        def.tiles[2]!,
        def.tiles[2]!,
        size,
      );
    }
    icons[id] = out.toDataURL("image/png");
  }
  return icons;
}

function paintIsoCube(
  ctx: CanvasRenderingContext2D,
  sampleTile: (tile: number) => HTMLCanvasElement,
  topTile: number,
  leftTile: number,
  rightTile: number,
  size: number,
): void {
  const pad = size * 0.06;
  const usable = size - pad * 2;
  // True isometric: all three axes share the same screen length
  const edge = usable / 2;
  const hw = edge * Math.cos(Math.PI / 6);
  const hh = edge * Math.sin(Math.PI / 6);
  const depth = edge;
  const cx = size * 0.5;
  const topY = (size - (hh * 2 + depth)) / 2 + hh;
  const T = {
    n: { x: cx, y: topY - hh },
    e: { x: cx + hw, y: topY },
    s: { x: cx, y: topY + hh },
    w: { x: cx - hw, y: topY },
  };
  const B = {
    e: { x: T.e.x, y: T.e.y + depth },
    s: { x: T.s.x, y: T.s.y + depth },
    w: { x: T.w.x, y: T.w.y + depth },
  };

  const drawTexturedQuad = (
    tile: number,
    p0: { x: number; y: number },
    p1: { x: number; y: number },
    p2: { x: number; y: number },
    p3: { x: number; y: number },
    shade: number,
  ) => {
    const faceCanvas = sampleTile(tile);
    const tmp = document.createElement("canvas");
    tmp.width = size;
    tmp.height = size;
    const tctx = tmp.getContext("2d")!;
    tctx.imageSmoothingEnabled = false;

    const drawTri = (
      u0: number,
      v0: number,
      u1: number,
      v1: number,
      u2: number,
      v2: number,
      x0: number,
      y0: number,
      x1: number,
      y1: number,
      x2: number,
      y2: number,
    ) => {
      tctx.save();
      tctx.beginPath();
      tctx.moveTo(x0, y0);
      tctx.lineTo(x1, y1);
      tctx.lineTo(x2, y2);
      tctx.closePath();
      tctx.clip();

      const su0 = u0 * TILE_SIZE;
      const sv0 = v0 * TILE_SIZE;
      const su1 = u1 * TILE_SIZE;
      const sv1 = v1 * TILE_SIZE;
      const su2 = u2 * TILE_SIZE;
      const sv2 = v2 * TILE_SIZE;
      const den =
        (su0 - su2) * (sv1 - sv2) - (su1 - su2) * (sv0 - sv2);
      if (Math.abs(den) < 1e-6) {
        tctx.restore();
        return;
      }
      const a =
        ((x0 - x2) * (sv1 - sv2) - (x1 - x2) * (sv0 - sv2)) / den;
      const b =
        ((x1 - x2) * (su0 - su2) - (x0 - x2) * (su1 - su2)) / den;
      const c = x2 - a * su2 - b * sv2;
      const d =
        ((y0 - y2) * (sv1 - sv2) - (y1 - y2) * (sv0 - sv2)) / den;
      const e =
        ((y1 - y2) * (su0 - su2) - (y0 - y2) * (su1 - su2)) / den;
      const f = y2 - d * su2 - e * sv2;
      tctx.setTransform(a, d, b, e, c, f);
      tctx.drawImage(faceCanvas, 0, 0);
      tctx.restore();
    };

    drawTri(0, 0, 1, 0, 1, 1, p0.x, p0.y, p1.x, p1.y, p2.x, p2.y);
    drawTri(0, 0, 1, 1, 0, 1, p0.x, p0.y, p2.x, p2.y, p3.x, p3.y);

    if (shade < 0.999) {
      tctx.save();
      tctx.globalCompositeOperation = "source-atop";
      tctx.fillStyle = `rgba(0,0,0,${(1 - shade) * 0.9})`;
      tctx.fillRect(0, 0, size, size);
      tctx.restore();
    } else if (shade > 1.001) {
      tctx.save();
      tctx.globalCompositeOperation = "source-atop";
      tctx.fillStyle = `rgba(255,255,255,${(shade - 1) * 0.5})`;
      tctx.fillRect(0, 0, size, size);
      tctx.restore();
    }
    ctx.drawImage(tmp, 0, 0);
  };

  drawTexturedQuad(leftTile, T.w, T.s, B.s, B.w, 0.72);
  drawTexturedQuad(rightTile, T.s, T.e, B.e, B.s, 0.88);
  drawTexturedQuad(topTile, T.n, T.e, T.s, T.w, 1.06);

  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(T.n.x, T.n.y);
  ctx.lineTo(T.e.x, T.e.y);
  ctx.lineTo(T.s.x, T.s.y);
  ctx.lineTo(T.w.x, T.w.y);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(T.w.x, T.w.y);
  ctx.lineTo(B.w.x, B.w.y);
  ctx.lineTo(B.s.x, B.s.y);
  ctx.lineTo(T.s.x, T.s.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(T.e.x, T.e.y);
  ctx.lineTo(B.e.x, B.e.y);
  ctx.lineTo(B.s.x, B.s.y);
  ctx.lineTo(T.s.x, T.s.y);
  ctx.stroke();
}

export function atlasTileStyle(
  tile: number,
  atlasUrl: string,
): {
  backgroundImage: string;
  backgroundSize: string;
  backgroundPosition: string;
  backgroundRepeat: string;
  imageRendering: "pixelated";
} {
  const col = tile % ATLAS_TILES;
  const row = Math.floor(tile / ATLAS_TILES);
  const n = ATLAS_TILES;
  return {
    backgroundImage: `url(${atlasUrl})`,
    backgroundSize: `${n * 100}% ${n * 100}%`,
    backgroundPosition: `${(col / (n - 1)) * 100}% ${(row / (n - 1)) * 100}%`,
    backgroundRepeat: "no-repeat",
    imageRendering: "pixelated",
  };
}

export function iconTileForBlock(id: number): number {
  const def = BLOCKS[id];
  if (!def) return 0;
  if (id === 1 || id === 14) return def.tiles[0]!;
  if (def.shape === "cross") return def.tiles[2]!;
  return def.tiles[2]!;
}

export function tileUVs(tile: number): {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
} {
  const col = tile % ATLAS_TILES;
  const row = Math.floor(tile / ATLAS_TILES);
  const u0 = col / ATLAS_TILES;
  const u1 = (col + 1) / ATLAS_TILES;
  const v1 = 1 - row / ATLAS_TILES;
  const v0 = 1 - (row + 1) / ATLAS_TILES;
  const pad = 0.5 / (ATLAS_TILES * TILE_SIZE);
  return {
    u0: u0 + pad,
    v0: v0 + pad,
    u1: u1 - pad,
    v1: v1 - pad,
  };
}

export const CRACK_STAGE_COUNT = 10;

export function createDestroyCrackTextures(): THREE.CanvasTexture[] {
  const size = 16;
  const stages: THREE.CanvasTexture[] = [];
  for (let stage = 0; stage < CRACK_STAGE_COUNT; stage++) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const img = ctx.createImageData(size, size);
    const d = img.data;
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
    for (let s = 0; s < active; s++) {
      const line = seeds[s]!;
      const tMax = Math.min(1, 0.35 + stage * 0.08 + s * 0.04);
      const steps = 20 + stage * 2;
      for (let i = 0; i <= steps * tMax; i++) {
        const t = i / steps;
        const x = line.x0 + (line.x1 - line.x0) * t;
        const y = line.y0 + (line.y1 - line.y0) * t;
        const w = Math.sin(t * 12 + s) * (0.3 + stage * 0.05);
        const px = Math.round(x + w);
        const py = Math.round(y + Math.cos(t * 9 + s) * 0.25);
        const alpha = 160 + stage * 8;
        set(px, py, alpha);
        set(px + 1, py, alpha * 0.85);
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
