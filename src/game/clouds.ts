import * as THREE from "three";

/** Minimal weather-cell shape — avoids circular import with weather.ts */
export type CloudWeatherCell = {
  id: number;
  x: number;
  z: number;
  radius: number;
  kind: "clear" | "overcast" | "rain" | "storm";
  intensity: number;
  vx: number;
  vz: number;
  generation?: number;
};

type WeatherKind = CloudWeatherCell["kind"];

/**
 * Blocky-but-natural cloud layer with shader-based blending.
 *
 * Per-instance opacity (presence × distance fade) + soft cube falloff so
 * overlapping puffs merge instead of hard pop / hard edges.
 * Layout ~2 Hz; presence lerps every frame.
 */

const FAIR_BASE_Y = 152;
/** Highest cloud tops the sun shadow camera must sit above */
export const CLOUD_SHADOW_TOP = 182;
/** Full visibility radius (blocks) */
const VIEW_RADIUS = 460;
/** Start soft edge fade here (blocks from player) */
const FADE_START = 390;
/** Cull completely past this */
const CULL_RADIUS = 560;
/** Keep existing islands a bit past spawn radius (anti thrash) */
const KEEP_RADIUS = 500;
const MAX_FAIR = 1100;
const MAX_WEATHER = 2800;
const LAYOUT_HZ = 1.5;
/**
 * Presence rates (units/sec toward 0 or 1).
 * Slow develop so clusters never hard-pop.
 */
const FADE_IN_FAIR = 0.16;
const FADE_IN_STORM = 0.11;
const FADE_IN_RAIN = 0.14;
const FADE_OUT_SPEED = 0.28;
/** If a weather cell teleports farther than this, treat as new bank */
const BANK_JUMP_DIST = 48;

function hash2(x: number, z: number, s: number): number {
  const n = Math.sin(x * 127.1 + z * 311.7 + s * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

function valueNoise(x: number, z: number, s: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = x - x0;
  const fz = z - z0;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(x0, z0, s);
  const b = hash2(x0 + 1, z0, s);
  const c = hash2(x0, z0 + 1, s);
  const d = hash2(x0 + 1, z0 + 1, s);
  return (
    a * (1 - ux) * (1 - uz) +
    b * ux * (1 - uz) +
    c * (1 - ux) * uz +
    d * ux * uz
  );
}

function fbm(x: number, z: number, s: number): number {
  let v = 0;
  let a = 0.55;
  let f = 1;
  let n = 0;
  for (let i = 0; i < 3; i++) {
    v += valueNoise(x * f, z * f, s + i * 19) * a;
    n += a;
    a *= 0.48;
    f *= 2.05;
  }
  return v / n;
}

function smooth01(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/** Soft edge falloff: 1 near, 0 at cull */
function edgeFade(dist: number): number {
  if (dist <= FADE_START) return 1;
  if (dist >= CULL_RADIUS) return 0;
  return 1 - smooth01((dist - FADE_START) / (CULL_RADIUS - FADE_START));
}

function createCloudDepthMaterial(): THREE.MeshDepthMaterial {
  const mat = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
  });
  mat.customProgramCacheKey = () => "cloud-shadow-depth-v1";
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      `#include <common>
attribute float instanceOpacity;
varying float vInstanceOpacity;`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
vInstanceOpacity = instanceOpacity;`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>
varying float vInstanceOpacity;`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <clipping_planes_fragment>",
      `#include <clipping_planes_fragment>
if (vInstanceOpacity < 0.32) discard;`,
    );
  };
  return mat;
}

/**
 * Lambert material with:
 * - instanceOpacity attribute (per-puff alpha for soft pop / horizon fade)
 * - mild edge soften only (faces stay solid — prior falloff zeroed face centers)
 * - depthWrite on so clouds read as solid masses against sky
 */
function createCloudMaterial(
  baseOpacity: number,
  cacheKey: string,
  emissiveHex: number,
): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    emissive: new THREE.Color(emissiveHex),
    emissiveIntensity: 0.35,
    transparent: true,
    opacity: baseOpacity,
    depthWrite: true,
    depthTest: true,
    fog: true,
    side: THREE.FrontSide,
    // No alphaTest — hard cut made soft fades look like pops
  });
  mat.customProgramCacheKey = () => cacheKey;
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      `#include <common>
attribute float instanceOpacity;
varying float vInstanceOpacity;
varying vec3 vCloudLocal;`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
vInstanceOpacity = instanceOpacity;
vCloudLocal = position;`,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>
varying float vInstanceOpacity;
varying vec3 vCloudLocal;`,
    );

    // Multiply alpha *after* lighting uses diffuse — inject just before output.
    // Important: unit-cube faces sit at |coord|=0.5; never use max-norm falloff
    // from center→0.5 or the whole face goes transparent.
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      /* glsl */ `
{
  float ax = abs(vCloudLocal.x);
  float ay = abs(vCloudLocal.y);
  float az = abs(vCloudLocal.z);
  // Second-largest axis: high near face edges/corners, low at face centers
  float m1 = max(ax, max(ay, az));
  float m3 = min(ax, min(ay, az));
  float m2 = ax + ay + az - m1 - m3;
  // Only ~15% alpha drop at edges — keeps mass readable
  float edgeSoft = 1.0 - smoothstep(0.32, 0.5, m2) * 0.12;
  float aMul = clamp(vInstanceOpacity, 0.0, 1.0) * edgeSoft;
  // Keep solid presence; only horizon/spawn fade drops alpha hard
  diffuseColor.a *= aMul;
  diffuseColor.a = clamp(diffuseColor.a, 0.0, 1.0);
}
#include <opaque_fragment>
`,
    );
  };
  mat.needsUpdate = true;
  return mat;
}

type Puff = {
  lx: number;
  ly: number;
  lz: number;
  sx: number;
  sy: number;
  sz: number;
  shade: number;
  /** 0 = first to appear, 1 = last (staggered develop) */
  birth: number;
};

type FairIsland = {
  gx: number;
  gz: number;
  y: number;
  puffs: Puff[];
  /** 0..1 visual presence (lerped) */
  presence: number;
  /** Desired this layout tick */
  wanted: boolean;
  /** Seconds before presence starts rising (stagger sky-wide spawns) */
  hold: number;
};

type WeatherBank = {
  cellId: number;
  generation: number;
  kind: WeatherKind;
  x: number;
  z: number;
  baseY: number;
  puffs: Puff[];
  presence: number;
  wanted: boolean;
  hold: number;
};

export class CloudLayer {
  readonly group = new THREE.Group();

  private seed: number;
  private fairMesh: THREE.InstancedMesh;
  private weatherMesh: THREE.InstancedMesh;
  private fairMat: THREE.MeshLambertMaterial;
  private weatherMat: THREE.MeshLambertMaterial;
  private fairOpacity: THREE.InstancedBufferAttribute;
  private weatherOpacity: THREE.InstancedBufferAttribute;
  private dummy = new THREE.Object3D();
  private color = new THREE.Color();

  private islands: FairIsland[] = [];
  private banks: WeatherBank[] = [];
  private layoutTimer = 0;
  private scrollX = 0;
  private scrollZ = 0;
  private flash = 0;
  private dayFactor = 1;

  private readonly fairStep = 30;
  private fairGeo: THREE.BoxGeometry;
  private weatherGeo: THREE.BoxGeometry;

  constructor(seed: number) {
    this.seed = seed;
    // Separate geos so each InstancedMesh can own instanceOpacity attribute
    this.fairGeo = new THREE.BoxGeometry(1, 1, 1);
    this.weatherGeo = new THREE.BoxGeometry(1, 1, 1);

    this.fairMat = createCloudMaterial(1.0, "cloud-fair-blend-v3", 0xe8f0ff);
    this.weatherMat = createCloudMaterial(0.98, "cloud-weather-blend-v3", 0x3a4050);

    this.fairMesh = new THREE.InstancedMesh(this.fairGeo, this.fairMat, MAX_FAIR);
    this.fairMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.fairMesh.frustumCulled = false;
    this.fairMesh.count = 0;
    this.fairMesh.renderOrder = -2;
    this.fairMesh.castShadow = true;
    this.fairMesh.receiveShadow = false;
    this.fairMesh.customDepthMaterial = createCloudDepthMaterial();
    this.fairMesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(MAX_FAIR * 3),
      3,
    );
    this.fairOpacity = new THREE.InstancedBufferAttribute(
      new Float32Array(MAX_FAIR).fill(1),
      1,
    );
    this.fairOpacity.setUsage(THREE.DynamicDrawUsage);
    this.fairGeo.setAttribute("instanceOpacity", this.fairOpacity);

    this.weatherMesh = new THREE.InstancedMesh(
      this.weatherGeo,
      this.weatherMat,
      MAX_WEATHER,
    );
    this.weatherMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.weatherMesh.frustumCulled = false;
    this.weatherMesh.count = 0;
    this.weatherMesh.renderOrder = -1;
    this.weatherMesh.castShadow = true;
    this.weatherMesh.receiveShadow = false;
    this.weatherMesh.customDepthMaterial = createCloudDepthMaterial();
    this.weatherMesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(MAX_WEATHER * 3),
      3,
    );
    this.weatherOpacity = new THREE.InstancedBufferAttribute(
      new Float32Array(MAX_WEATHER).fill(1),
      1,
    );
    this.weatherOpacity.setUsage(THREE.DynamicDrawUsage);
    this.weatherGeo.setAttribute("instanceOpacity", this.weatherOpacity);

    this.group.add(this.fairMesh);
    this.group.add(this.weatherMesh);
    this.group.frustumCulled = false;
  }

  setCastShadow(on: boolean): void {
    this.fairMesh.castShadow = on;
    this.weatherMesh.castShadow = on;
  }

  get ceilingY(): number {
    // Rain originates a bit under the fair deck
    return FAIR_BASE_Y - 10;
  }

  update(
    dt: number,
    px: number,
    pz: number,
    windX: number,
    windZ: number,
    cells: CloudWeatherCell[],
    flash: number,
    dayFactor: number,
  ): void {
    this.flash = flash;
    this.dayFactor = dayFactor;

    const wSpd = Math.hypot(windX, windZ);
    const drift = 0.55 + wSpd * 0.35;
    const nx = wSpd > 1e-4 ? windX / wSpd : 0.7;
    const nz = wSpd > 1e-4 ? windZ / wSpd : 0.35;
    this.scrollX += nx * drift * dt;
    this.scrollZ += nz * drift * dt;

    this.layoutTimer -= dt;
    if (this.layoutTimer <= 0) {
      this.layoutTimer = 1 / LAYOUT_HZ;
      this.rebuildFairIslands(px, pz, cells);
      this.rebuildWeatherBanks(px, pz, cells);
    } else {
      this.trackBanks(cells);
    }

    this.tickPresence(dt);
    this.writeFairInstances(px, pz);
    this.writeWeatherInstances(px, pz, flash);
  }

  private tickPresence(dt: number): void {
    for (const island of this.islands) {
      if (island.wanted && island.hold > 0) {
        island.hold = Math.max(0, island.hold - dt);
      }
      const canGrow = island.wanted && island.hold <= 0;
      const target = canGrow ? 1 : island.wanted ? island.presence : 0;
      const speed = target > island.presence ? FADE_IN_FAIR : FADE_OUT_SPEED;
      if (!island.wanted) {
        // Always allow fade-out even if hold remaining
        island.presence = Math.max(0, island.presence - FADE_OUT_SPEED * dt);
      } else if (canGrow && island.presence < 1) {
        island.presence = Math.min(1, island.presence + speed * dt);
      }
    }
    this.islands = this.islands.filter(
      (i) => i.wanted || i.presence > 0.008,
    );

    for (const bank of this.banks) {
      if (bank.wanted && bank.hold > 0) {
        bank.hold = Math.max(0, bank.hold - dt);
      }
      const canGrow = bank.wanted && bank.hold <= 0;
      const fadeIn =
        bank.kind === "storm"
          ? FADE_IN_STORM
          : bank.kind === "rain"
            ? FADE_IN_RAIN
            : FADE_IN_FAIR;
      if (!bank.wanted) {
        bank.presence = Math.max(0, bank.presence - FADE_OUT_SPEED * dt);
      } else if (canGrow && bank.presence < 1) {
        bank.presence = Math.min(1, bank.presence + fadeIn * dt);
      }
    }
    this.banks = this.banks.filter((b) => b.wanted || b.presence > 0.008);
  }

  /** Per-puff develop factor from island/bank presence + birth stagger */
  private puffDevelop(presence: number, birth: number): number {
    // Birth spreads develop over the presence ramp: cores first, fringes last
    const t = (presence - birth * 0.72) / 0.35;
    return smooth01(t);
  }

  // ─── Fair weather islands ───────────────────────────────────────────

  private rebuildFairIslands(
    px: number,
    pz: number,
    cells: CloudWeatherCell[],
  ): void {
    const step = this.fairStep;
    const half = Math.ceil(KEEP_RADIUS / step) + 1;
    const baseGx = Math.floor((px + this.scrollX) / step);
    const baseGz = Math.floor((pz + this.scrollZ) / step);

    const byKey = new Map<string, FairIsland>();
    for (const isl of this.islands) {
      // Hysteresis: keep wanted if still near player; only drop when far
      const ix = isl.gx * step - this.scrollX + step * 0.5;
      const iz = isl.gz * step - this.scrollZ + step * 0.5;
      const d = Math.hypot(ix - px, iz - pz);
      isl.wanted = d <= KEEP_RADIUS;
      byKey.set(`${isl.gx},${isl.gz}`, isl);
    }

    let puffBudget = MAX_FAIR;
    for (const isl of this.islands) {
      if (isl.presence > 0.05) puffBudget -= isl.puffs.length;
    }

    for (let iz = -half; iz <= half; iz++) {
      for (let ix = -half; ix <= half; ix++) {
        const gx = baseGx + ix;
        const gz = baseGz + iz;
        const cx = gx * step - this.scrollX + step * 0.5;
        const cz = gz * step - this.scrollZ + step * 0.5;
        const dist = Math.hypot(cx - px, cz - pz);

        const key = `${gx},${gz}`;
        const existing = byKey.get(key);

        // Existing: only force-unwant when deep under weather or past cull
        if (existing) {
          if (dist > CULL_RADIUS) {
            existing.wanted = false;
            continue;
          }
          if (this.underWeather(cx, cz, cells, 0.5)) {
            // Fade under storms; do not thrash at the boundary
            existing.wanted = false;
            continue;
          }
          if (dist <= KEEP_RADIUS) existing.wanted = true;
          continue;
        }

        // New islands only inside spawn radius (tighter than keep)
        if (dist > VIEW_RADIUS) continue;
        if (this.underWeather(cx, cz, cells, 0.35)) continue;

        const wx = gx * 0.11 + fbm(gx * 0.04, gz * 0.04, this.seed + 3) * 1.8;
        const wz = gz * 0.11 + fbm(gx * 0.04 + 20, gz * 0.04, this.seed + 7) * 1.8;
        const n = fbm(wx, wz, this.seed);
        if (n < 0.58) continue;
        if (n < 0.68 && hash2(gx, gz, this.seed + 2) < 0.45) continue;

        if (puffBudget < 6) continue;
        const density = smooth01((n - 0.58) / 0.32);
        const island = this.buildFairIsland(gx, gz, density);
        if (island.puffs.length === 0) continue;
        island.presence = 0;
        island.wanted = true;
        // Longer staggered hold so sky doesn't fill in a flash
        island.hold = 0.6 + hash2(gx, gz, this.seed + 90) * 3.5;
        puffBudget -= island.puffs.length;
        this.islands.push(island);
        byKey.set(key, island);
      }
    }
  }

  private buildFairIsland(
    gx: number,
    gz: number,
    density: number,
  ): FairIsland {
    const h = hash2(gx, gz, this.seed + 11);
    const h2v = hash2(gx, gz, this.seed + 17);
    const angle = h * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const stretch = 1.1 + h2v * 1.4;
    const baseY = FAIR_BASE_Y + (hash2(gx, gz, this.seed + 5) - 0.5) * 10;
    const count = Math.floor(5 + density * 14 + h * 4);

    const puffs: Puff[] = [];
    for (let i = 0; i < count; i++) {
      const u = hash2(gx + i * 3, gz - i, this.seed + 20);
      const v = hash2(gx - i, gz + i * 5, this.seed + 21);
      const w = hash2(gx + i * 7, gz + i * 2, this.seed + 22);
      const r = Math.sqrt(u) * (6 + density * 8);
      const th = v * Math.PI * 2;
      const ex = Math.cos(th) * r * stretch;
      const ez = Math.sin(th) * r;
      const lx = ex * cos - ez * sin;
      const lz = ex * sin + ez * cos;
      const distN = Math.min(
        1,
        Math.hypot(ex / stretch, ez) / (7 + density * 6),
      );
      const mound = (1 - distN * distN) * (2.2 + density * 3.5);
      const ly = w * mound * 0.85;
      const sx = 3.2 + hash2(gx, i, this.seed + 30) * 4.5;
      const sy =
        2.0 + hash2(i, gz, this.seed + 31) * 2.8 * (0.5 + (1 - distN));
      const sz = 3.2 + hash2(i * 2, gz, this.seed + 32) * 4.5;
      // Core (center) first, outer fringes later
      const birth = distN * 0.75 + hash2(i, gx + gz, this.seed + 33) * 0.25;
      puffs.push({
        lx,
        ly,
        lz,
        sx,
        sy,
        sz,
        shade: 0.02 + distN * 0.06,
        birth,
      });
    }

    const under = Math.floor(2 + density * 3);
    for (let i = 0; i < under; i++) {
      const u = hash2(gx + 50 + i, gz, this.seed + 40);
      const v = hash2(gx, gz + 50 + i, this.seed + 41);
      const r = u * 5;
      const th = v * Math.PI * 2;
      puffs.push({
        lx: Math.cos(th) * r,
        ly: -0.8 - u * 1.2,
        lz: Math.sin(th) * r,
        sx: 2.5 + u * 2,
        sy: 1.4 + v,
        sz: 2.5 + v * 2,
        shade: 0.08,
        birth: 0.55 + u * 0.4, // underslung later
      });
    }

    // Stagger islands so a whole bank of sky doesn't appear in lockstep
    const hold = hash2(gx, gz, this.seed + 90) * 2.4;

    return {
      gx,
      gz,
      y: baseY,
      puffs,
      presence: 0,
      wanted: true,
      hold,
    };
  }

  private writeFairInstances(px: number, pz: number): void {
    let idx = 0;
    const dayLift = 0.92 + this.dayFactor * 0.08;
    const flashLift = 1 + this.flash * 0.12;
    const step = this.fairStep;
    const opac = this.fairOpacity.array as Float32Array;

    for (const island of this.islands) {
      if (island.presence < 0.005 && island.hold > 0) continue;
      if (island.presence < 0.005) continue;
      const ix = island.gx * step - this.scrollX + step * 0.5;
      const iz = island.gz * step - this.scrollZ + step * 0.5;
      const dist = Math.hypot(ix - px, iz - pz);
      if (dist > CULL_RADIUS) continue;

      const edge = edgeFade(dist);
      if (edge < 0.02) continue;

      for (const p of island.puffs) {
        if (idx >= MAX_FAIR) break;
        const dev = this.puffDevelop(island.presence, p.birth) * edge;
        if (dev < 0.02) continue;

        // Grow gently — avoid squash-pop (was 0.25→1)
        const sc = 0.72 + 0.28 * dev;
        this.dummy.position.set(ix + p.lx, island.y + p.ly, iz + p.lz);
        this.dummy.scale.set(p.sx * sc, p.sy * sc, p.sz * sc);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.updateMatrix();
        this.fairMesh.setMatrixAt(idx, this.dummy.matrix);

        const dim = 1 - p.shade * 0.03;
        const w = Math.min(1.25, 1.1 * dayLift * flashLift * dim);
        this.color.setRGB(w, w * 0.99, Math.min(1.28, w * 1.01));
        this.fairMesh.setColorAt(idx, this.color);
        // Pure fade — no solid floor (that caused hard pop)
        opac[idx] = dev * dev * (3 - 2 * dev);
        idx++;
      }
      if (idx >= MAX_FAIR) break;
    }
    this.fairMesh.count = idx;
    this.fairMesh.instanceMatrix.needsUpdate = true;
    if (this.fairMesh.instanceColor)
      this.fairMesh.instanceColor.needsUpdate = true;
    this.fairOpacity.needsUpdate = true;
    this.fairMesh.visible = idx > 0;
  }

  // ─── Weather banks ──────────────────────────────────────────────────

  private rebuildWeatherBanks(
    px: number,
    pz: number,
    cells: CloudWeatherCell[],
  ): void {
    // Key by cellId+generation so recycle doesn't teleport a live bank
    const byKey = new Map<string, WeatherBank>();
    for (const b of this.banks) {
      b.wanted = false;
      byKey.set(`${b.cellId}:${b.generation}`, b);
    }

    let budget = MAX_WEATHER;
    for (const b of this.banks) {
      if (b.presence > 0.05) budget -= b.puffs.length;
    }

    const active = cells
      .filter((c) => c.kind !== "clear")
      .sort((a, b) => a.id - b.id);

    for (let rank = 0; rank < active.length; rank++) {
      const cell = active[rank]!;
      const gen = cell.generation ?? 0;
      const key = `${cell.id}:${gen}`;
      const dist = Math.hypot(cell.x - px, cell.z - pz);

      // Keep hysteresis for weather banks too
      const existing = byKey.get(key);
      if (existing) {
        const jump = Math.hypot(cell.x - existing.x, cell.z - existing.z);
        if (jump > BANK_JUMP_DIST) {
          // Unexpected jump without generation bump — detach & fade
          existing.wanted = false;
          existing.cellId = -Math.abs(existing.cellId) - 100000;
        } else if (dist > VIEW_RADIUS + cell.radius * 2.4) {
          existing.wanted = false;
        } else {
          existing.wanted = true;
          existing.x = cell.x;
          existing.z = cell.z;
          existing.kind = cell.kind;
          continue;
        }
      }

      if (dist > VIEW_RADIUS + cell.radius * 1.6) continue;
      if (budget < 20) continue;
      // Don't spawn a second bank for same key while old is still fading
      if (byKey.has(key) && (byKey.get(key)?.presence ?? 0) > 0.05) {
        // Old is fading after jump detach — allow new with same gen only if detached
        const old = byKey.get(key)!;
        if (old.cellId === cell.id) continue;
      }

      const lane = rank - (active.length - 1) * 0.5;
      const kindBias =
        cell.kind === "storm"
          ? 8
          : cell.kind === "rain"
            ? 2
            : cell.kind === "overcast"
              ? -4
              : 0;
      const baseY =
        FAIR_BASE_Y + 6 + kindBias + lane * 5.5 + ((cell.id * 7) % 5) * 0.4;

      const bank = this.buildWeatherBank(cell, baseY, gen);
      bank.presence = 0;
      bank.wanted = true;
      bank.hold =
        cell.kind === "storm"
          ? 0.8 + hash2(cell.id + gen, 1, this.seed) * 1.2
          : 0.35 + hash2(cell.id + gen, 2, this.seed) * 0.8;
      budget -= bank.puffs.length;
      this.banks.push(bank);
      byKey.set(key, bank);
    }
  }

  private trackBanks(cells: CloudWeatherCell[]): void {
    const byKey = new Map(
      cells.map((c) => [`${c.id}:${c.generation ?? 0}`, c] as const),
    );
    for (const bank of this.banks) {
      const c = byKey.get(`${bank.cellId}:${bank.generation}`);
      if (!c) {
        bank.wanted = false;
        continue;
      }
      const jump = Math.hypot(c.x - bank.x, c.z - bank.z);
      if (jump > BANK_JUMP_DIST) {
        bank.wanted = false;
        continue;
      }
      bank.x = c.x;
      bank.z = c.z;
    }
  }

  private buildWeatherBank(cell: CloudWeatherCell, baseY: number, generation = 0): WeatherBank {
    const puffs: Puff[] = [];
    const spd = Math.hypot(cell.vx, cell.vz) || 1;
    const fdx = cell.vx / spd;
    const fdz = cell.vz / spd;
    const rdx = -fdz;
    const rdz = fdx;

    const R = cell.radius;
    const step =
      cell.kind === "storm"
        ? Math.max(8, cell.radius / 16)
        : cell.kind === "rain"
          ? Math.max(9, cell.radius / 14)
          : 11;
    // Sample bounds: storm ellipse is longer on wind axis
    const boundR =
      R *
      (cell.kind === "storm" ? 1.55 : cell.kind === "rain" ? 1.15 : 1.05);
    const iMax = Math.ceil(boundR / step) + 1;

    const s0 = cell.id * 17.13 + this.seed * 0.01;
    const stretchAlong =
      cell.kind === "storm" ? 1.28 + hash2(cell.id, 1, this.seed) * 0.35 : 1;
    const stretchSide =
      cell.kind === "storm" ? 0.68 + hash2(cell.id, 2, this.seed) * 0.22 : 1;
    const skew =
      cell.kind === "storm" ? (hash2(cell.id, 3, this.seed) - 0.5) * 0.28 : 0;

    for (let jz = -iMax; jz <= iMax; jz++) {
      for (let jx = -iMax; jx <= iMax; jx++) {
        const lx0 = jx * step;
        const lz0 = jz * step;
        const dist = Math.hypot(lx0, lz0);
        if (dist > boundR) continue;

        const along = lx0 * fdx + lz0 * fdz;
        const side = lx0 * rdx + lz0 * rdz;
        const lead = along / Math.max(1, R);
        const edge = 1 - dist / Math.max(1, boundR);
        const fall = edge * edge * (3 - 2 * edge);

        let cover: number;
        let rNorm = 1;
        let bodyNoise = 0.5;

        if (cell.kind === "storm") {
          // Wind-aligned ellipse + angular lobes + domain warp
          const skewSide = side + along * skew;
          let u = along / (R * stretchAlong);
          let v = skewSide / (R * stretchSide);

          const wx = u * 1.7 + s0;
          const wz = v * 1.7 + s0 * 1.3;
          const warpA = (fbm(wx, wz, this.seed + 11) - 0.5) * 0.28;
          const warpB = (fbm(wx + 9, wz - 4, this.seed + 19) - 0.5) * 0.28;
          u += warpA;
          v += warpB;

          const ang = Math.atan2(v, u);
          const lobes =
            0.16 * Math.sin(ang * 2.0 + s0) +
            0.12 * Math.sin(ang * 3.0 + s0 * 1.7) +
            0.09 * Math.sin(ang * 5.0 - s0 * 0.6) +
            0.07 * Math.sin(ang * 7.0 + cell.id);
          const frontLobe = Math.max(0, Math.cos(ang)) * 0.12;
          const backBite = Math.max(0, -Math.cos(ang)) * 0.1;
          const radiusMul = 1 + lobes + frontLobe - backBite;

          rNorm = Math.hypot(u, v) / Math.max(0.35, radiusMul);
          if (rNorm > 1.08) continue;

          bodyNoise = fbm(
            u * 2.4 + cell.id * 0.1,
            v * 2.4,
            this.seed + 40 + cell.id,
          );
          const ridge = fbm(u * 4.1, v * 4.1, this.seed + 55);
          const rim = smooth01((1.08 - rNorm) / 0.28);
          const core = smooth01(1 - rNorm / 0.45);
          cover =
            rim *
            cell.intensity *
            (0.72 + core * 0.28 + bodyNoise * 0.2 + ridge * 0.12);
          // Soft notches only near edge — keep interior filled
          if (rNorm > 0.72 && bodyNoise < 0.28) {
            cover *= 0.35 + bodyNoise;
          }
        } else {
          const bankR = R * (cell.kind === "rain" ? 1.15 : 1.05);
          if (dist > bankR) continue;
          const frontBias = cell.kind === "rain" ? 0.2 : 0.08;
          cover =
            fall * cell.intensity * (0.55 + Math.max(0, lead) * frontBias);
          const coreR = R * 0.45;
          if (dist < coreR) {
            const u2 = 1 - dist / coreR;
            cover += u2 * u2 * cell.intensity * 0.3;
          }
          if (lead < -0.15) cover *= 0.55 + 0.45 * fall;
        }

        if (cover < (cell.kind === "storm" ? 0.1 : 0.18)) continue;

        if (cell.kind === "storm") {
          if (rNorm > 0.9) {
            const h = hash2(cell.id * 13 + jx, jz * 3 - cell.id, this.seed + 50);
            if (h > cover * 1.2) continue;
          }
        } else {
          const h = hash2(cell.id * 13 + jx, jz * 3 - cell.id, this.seed + 50);
          const thresh = 0.5 - cover * 0.42;
          if (h < thresh) continue;
        }

        const jitter = cell.kind === "storm" ? step * 0.32 : step * 0.45;
        const meander =
          cell.kind === "storm" ? (bodyNoise - 0.5) * step * 0.55 : 0;
        const ox =
          lx0 + (hash2(jx, jz, this.seed + 51) - 0.5) * jitter + rdx * meander;
        const oz =
          lz0 + (hash2(jz, jx, this.seed + 52) - 0.5) * jitter + rdz * meander;

        let layers = 1;
        if (cell.kind === "storm") {
          const hVar = bodyNoise * 0.55 + (1 - rNorm) * 0.45;
          layers = hVar > 0.62 ? 3 : hVar > 0.38 ? 2 : 1;
          if (rNorm < 0.35) layers = Math.max(layers, 3);
          if (rNorm > 0.85) layers = 1;
        } else if (cell.kind === "rain" && cover > 0.5) {
          layers = 2;
        }
        layers = Math.min(4, layers);

        const shadeBase =
          cell.kind === "storm"
            ? 0.68 + cover * 0.2 + (1 - bodyNoise) * 0.12
            : cell.kind === "rain"
              ? 0.42 + cover * 0.28
              : 0.22 + cover * 0.18;

        const yWave =
          cell.kind === "storm"
            ? (bodyNoise - 0.5) * 4.5 +
              Math.sin((along / R) * 2.2 + s0) * 2.2 +
              Math.cos((side / R) * 3.1 - s0) * 1.6
            : 0;

        for (let L = 0; L < layers; L++) {
          const ly =
            yWave +
            L * (cell.kind === "storm" ? 3.6 : 3.2) +
            hash2(jx + L, jz, this.seed + 60) * 0.9;
          let ax = ox;
          let az = oz;
          if (cell.kind === "storm" && L >= 2) {
            ax += fdx * (L * 1.8) + side * 0.08 * L * (bodyNoise - 0.3);
            az += fdz * (L * 1.8);
          }
          const sx =
            cell.kind === "storm"
              ? step * (1.25 + bodyNoise * 0.35) +
                cover * 2.2 +
                hash2(jx, L, this.seed + 61) * 1.8
              : 6 + cover * 4 + hash2(jx, L, this.seed + 61) * 3;
          const sy =
            cell.kind === "storm"
              ? 3.2 + (layers - L) * 0.55 + cover * 1.1 + bodyNoise * 1.4
              : 2.6 + (layers - L) * 0.4 + cover * 1.5;
          const sz =
            cell.kind === "storm"
              ? sx * (0.78 + hash2(L, jz, this.seed + 62) * 0.35)
              : sx * (0.85 + hash2(L, jz, this.seed + 62) * 0.3);

          const birth = Math.min(
            1,
            rNorm * 0.65 +
              L * 0.12 +
              hash2(jx + L, jz, this.seed + 63) * 0.15,
          );

          puffs.push({
            lx: ax,
            ly,
            lz: az,
            sx,
            sy,
            sz,
            shade: Math.min(0.95, shadeBase + L * 0.04),
            birth,
          });
        }
      }
    }

    return {
      cellId: cell.id,
      generation,
      kind: cell.kind,
      x: cell.x,
      z: cell.z,
      baseY,
      puffs,
      presence: 0,
      wanted: true,
      hold:
        cell.kind === "storm"
          ? 0.4 + hash2(cell.id, 1, this.seed) * 0.8
          : 0.15 + hash2(cell.id, 2, this.seed) * 0.5,
    };
  }

  private writeWeatherInstances(
    px: number,
    pz: number,
    flash: number,
  ): void {
    let idx = 0;
    const day = 0.7 + this.dayFactor * 0.3;
    const opac = this.weatherOpacity.array as Float32Array;

    for (const bank of this.banks) {
      if (bank.presence < 0.005) continue;
      const dist = Math.hypot(bank.x - px, bank.z - pz);
      if (dist > CULL_RADIUS + 80) continue;

      const edge = edgeFade(dist);
      if (edge < 0.02) continue;

      for (const p of bank.puffs) {
        if (idx >= MAX_WEATHER) break;
        const dev = this.puffDevelop(bank.presence, p.birth) * edge;
        if (dev < 0.02) continue;

        const sc = 0.7 + 0.3 * dev;
        this.dummy.position.set(
          bank.x + p.lx,
          bank.baseY + p.ly,
          bank.z + p.lz,
        );
        this.dummy.scale.set(p.sx * sc, p.sy * sc, p.sz * sc);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.updateMatrix();
        this.weatherMesh.setMatrixAt(idx, this.dummy.matrix);

        let r: number, g: number, b: number;
        if (bank.kind === "storm") {
          const t = Math.min(1, p.shade);
          const base = 0.14 + (1 - t) * 0.12;
          const lift = flash * 0.35;
          r = Math.min(0.55, (base + 0.02) * day + lift);
          g = Math.min(0.55, (base + 0.03) * day + lift);
          b = Math.min(0.6, (base + 0.06) * day + lift * 1.1);
        } else if (bank.kind === "rain") {
          const t = Math.min(1, p.shade);
          const base = 0.38 + (1 - t) * 0.18;
          r = base * day;
          g = (base + 0.02) * day;
          b = (base + 0.05) * day;
        } else {
          const t = Math.min(1, p.shade);
          const base = 0.62 + (1 - t) * 0.18;
          r = base * day;
          g = (base + 0.01) * day;
          b = (base + 0.03) * day;
        }
        this.color.setRGB(r, g, b);
        this.weatherMesh.setColorAt(idx, this.color);
        opac[idx] = dev * dev * (3 - 2 * dev);
        idx++;
      }
      if (idx >= MAX_WEATHER) break;
    }
    this.weatherMesh.count = idx;
    this.weatherMesh.instanceMatrix.needsUpdate = true;
    if (this.weatherMesh.instanceColor)
      this.weatherMesh.instanceColor.needsUpdate = true;
    this.weatherOpacity.needsUpdate = true;
    this.weatherMesh.visible = idx > 0;
  }

  private underWeather(
    wx: number,
    wz: number,
    cells: CloudWeatherCell[],
    thresh: number,
  ): boolean {
    for (const c of cells) {
      if (c.kind === "clear") continue;
      const d = Math.hypot(wx - c.x, wz - c.z);
      const r = c.radius * (c.kind === "storm" ? 1.4 : 1.15);
      if (d < r * thresh + r * 0.5 * c.intensity) return true;
    }
    return false;
  }

  dispose(): void {
    this.group.remove(this.fairMesh);
    this.group.remove(this.weatherMesh);
    this.fairMesh.dispose();
    this.weatherMesh.dispose();
    this.fairGeo.dispose();
    this.weatherGeo.dispose();
    this.fairMat.dispose();
    this.weatherMat.dispose();
    this.fairMesh.customDepthMaterial?.dispose();
    this.weatherMesh.customDepthMaterial?.dispose();
  }
}
