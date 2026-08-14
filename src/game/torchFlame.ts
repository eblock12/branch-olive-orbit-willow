import * as THREE from "three";
import { ATLAS_TILES, TILE_SIZE } from "./blocks";

/** Atlas tile painted as the torch cross (see textures.ts). */
const TORCH_TILE = 37;

const FW = 16;
/** Extra hidden ember rows below the visible tongue. */
const FH = 14;
/** Tile rows 0..VISIBLE-1 receive fire (top of the 16px tile). */
const VISIBLE = 10;
const STEP_HZ = 26;

/**
 * Classic Mode 13h fire: hot cells at the bottom are 4-tap averaged
 * one row up each step, with cooling. One shared buffer drives every
 * torch in the world (and the held item) via the atlas tile.
 */
export class TorchFlame {
  readonly emissiveMap: THREE.CanvasTexture;
  private tex: THREE.CanvasTexture;
  private ctx: CanvasRenderingContext2D;
  private emiCtx: CanvasRenderingContext2D;
  private ox: number;
  private oy: number;
  private tile: ImageData;
  private emiTile: ImageData;
  private base: Uint8ClampedArray;
  private heat = new Uint8Array(FW * FH);
  private next = new Uint8Array(FW * FH);
  private acc = 0;
  private seed = (Math.random() * 0xffffffff) >>> 0;
  /** 0..1 mean heat — used to sync point-light flicker. */
  intensity = 0.85;

  constructor(atlas: THREE.CanvasTexture) {
    this.tex = atlas;
    const canvas = atlas.image as HTMLCanvasElement;
    this.ctx = canvas.getContext("2d")!;
    const col = TORCH_TILE % ATLAS_TILES;
    const row = Math.floor(TORCH_TILE / ATLAS_TILES);
    this.ox = col * TILE_SIZE;
    this.oy = row * TILE_SIZE;
    this.tile = this.ctx.getImageData(this.ox, this.oy, TILE_SIZE, TILE_SIZE);
    this.base = new Uint8ClampedArray(this.tile.data);
    this.stripStaticFlame(this.base);

    const emi = document.createElement("canvas");
    emi.width = canvas.width;
    emi.height = canvas.height;
    this.emiCtx = emi.getContext("2d")!;
    this.emiTile = this.emiCtx.createImageData(TILE_SIZE, TILE_SIZE);
    this.emissiveMap = new THREE.CanvasTexture(emi);
    this.emissiveMap.magFilter = THREE.NearestFilter;
    this.emissiveMap.minFilter = THREE.NearestFilter;
    this.emissiveMap.generateMipmaps = false;
    this.emissiveMap.colorSpace = THREE.SRGBColorSpace;

    for (let i = 0; i < 36; i++) this.step(0);
    this.blit();
  }

  applyTo(mat: THREE.MeshLambertMaterial): void {
    mat.emissive.set(0xffffff);
    mat.emissiveMap = this.emissiveMap;
    mat.emissiveIntensity = 1.35;
  }

  dispose(): void {
    this.emissiveMap.dispose();
  }

  update(dt: number, windX = 0): void {
    this.acc += dt;
    const step = 1 / STEP_HZ;
    let n = 0;
    while (this.acc >= step && n < 3) {
      this.acc -= step;
      this.step(windX);
      n++;
    }
    if (n > 0) this.blit();
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  private sample(src: Uint8Array, x: number, y: number): number {
    if (x < 0 || x >= FW || y < 0 || y >= FH) return 0;
    return src[y * FW + x]!;
  }

  private step(windX: number): void {
    const lean = windX > 0.55 ? 1 : windX < -0.55 ? -1 : 0;
    const src = this.heat;
    const dst = this.next;

    for (let y = 0; y < FH - 2; y++) {
      const heightCool = y < 2 ? 3 : y < 5 ? 2 : 1;
      for (let x = 0; x < FW; x++) {
        const sx = x + lean;
        const avg =
          (this.sample(src, sx - 1, y + 1) +
            this.sample(src, sx, y + 1) +
            this.sample(src, sx + 1, y + 1) +
            this.sample(src, sx, y + 2)) >>
          2;
        const dist = Math.abs(x - 7.5);
        const edge = dist > 2.6 ? 4 : dist > 1.7 ? 2 : 0;
        const extra = this.rand() < 0.22 ? 1 : 0;
        const v = avg - heightCool - extra - edge;
        dst[y * FW + x] = v > 0 ? (v > 255 ? 255 : v) : 0;
      }
    }

    for (let y = FH - 2; y < FH; y++) {
      for (let x = 0; x < FW; x++) {
        const d = Math.abs(x - 7.5);
        if (d > 2.6) {
          dst[y * FW + x] = (this.rand() * 12) | 0;
          continue;
        }
        const core = d < 1.4;
        if (this.rand() < (core ? 0.88 : 0.5)) {
          dst[y * FW + x] = (200 + this.rand() * 55) | 0;
        } else {
          dst[y * FW + x] = (50 + this.rand() * 80) | 0;
        }
      }
    }

    if (this.rand() < 0.28) {
      const sx = 6 + ((this.rand() * 4) | 0);
      const sy = 8 + ((this.rand() * 3) | 0);
      dst[sy * FW + sx] = 255;
    }

    this.heat = dst;
    this.next = src;

    let sum = 0;
    const n = FW * VISIBLE;
    for (let i = 0; i < n; i++) sum += this.heat[i]!;
    this.intensity = Math.min(1, 0.55 + (sum / (n * 255)) * 1.1);
  }

  private blit(): void {
    const data = this.tile.data;
    data.set(this.base);
    const emi = this.emiTile.data;
    emi.fill(0);
    const src = this.heat;
    for (let y = 0; y < VISIBLE; y++) {
      const t = y / (VISIBLE - 1);
      const maxW = 0.55 + t * 2.35;
      for (let x = 0; x < FW; x++) {
        if (Math.abs(x - 7.5) > maxW + 0.4) continue;
        const h = src[y * FW + x]!;
        if (h < 14) continue;
        const i = (y * FW + x) * 4;
        const c = heatColor(h);
        data[i] = c[0];
        data[i + 1] = c[1];
        data[i + 2] = c[2];
        data[i + 3] = c[3];
        // Full-lit: emissive carries the fire color so caves don't shade it
        const boost = 1.15;
        emi[i] = Math.min(255, (c[0] * boost) | 0);
        emi[i + 1] = Math.min(255, (c[1] * boost) | 0);
        emi[i + 2] = Math.min(255, (c[2] * boost) | 0);
        emi[i + 3] = 255;
      }
    }
    // Dim ember glow on the coal wrap
    for (let y = 8; y <= 10; y++) {
      for (let x = 6; x <= 9; x++) {
        const i = (y * FW + x) * 4;
        if (this.base[i + 3]! < 128) continue;
        if (emi[i]! < 40) {
          emi[i] = 90;
          emi[i + 1] = 32;
          emi[i + 2] = 8;
          emi[i + 3] = 255;
        }
      }
    }
    this.ctx.putImageData(this.tile, this.ox, this.oy);
    this.emiCtx.putImageData(this.emiTile, this.ox, this.oy);
    this.tex.needsUpdate = true;
    this.emissiveMap.needsUpdate = true;
  }

  private stripStaticFlame(base: Uint8ClampedArray): void {
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 16; x++) {
        base[(y * 16 + x) * 4 + 3] = 0;
      }
    }
    for (let y = 8; y <= 9; y++) {
      for (let x = 0; x < 16; x++) {
        if (x < 6 || x > 9) base[(y * 16 + x) * 4 + 3] = 0;
      }
    }
  }
}

/** VGA-style fire ramp: black → red → orange → yellow → white. */
function heatColor(h: number): [number, number, number, number] {
  if (h < 24) {
    const t = h / 24;
    return [(40 * t) | 0, 0, 0, (t * 160) | 0];
  }
  if (h < 56) {
    const t = (h - 24) / 32;
    return [(80 + t * 140) | 0, (t * 20) | 0, 0, 255];
  }
  if (h < 110) {
    const t = (h - 56) / 54;
    return [255, (24 + t * 120) | 0, (t * 12) | 0, 255];
  }
  if (h < 180) {
    const t = (h - 110) / 70;
    return [255, (148 + t * 80) | 0, (16 + t * 70) | 0, 255];
  }
  const t = Math.min(1, (h - 180) / 75);
  return [255, (228 + t * 27) | 0, (90 + t * 150) | 0, 255];
}
