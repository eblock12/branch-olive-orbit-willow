import * as THREE from "three";
import type { World } from "./world";
import { CHUNK_HEIGHT } from "./chunk";
import type { DayNightSample } from "./dayNight";

export type WeatherKind = "clear" | "overcast" | "rain" | "storm";

export type WeatherCell = {
  id: number;
  x: number;
  z: number;
  radius: number;
  core: number;
  kind: WeatherKind;
  intensity: number;
  vx: number;
  vz: number;
  age: number;
  life: number;
  nextStrike: number;
};

export type WeatherSample = {
  kind: WeatherKind;
  intensity: number;
  rain: number;
  storm: number;
  cloud: number;
  windX: number;
  windZ: number;
  windSpeed: number;
  gloom: number;
  stormProximity: number;
};

type RainDrop = {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; maxLife: number;
  bouncing: boolean; active: boolean;
};

type Splash = {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; active: boolean;
};

type LightningBolt = { mesh: THREE.Line; life: number };

type FlashPulse = {
  /** Seconds until pulse starts */
  delay: number;
  /** Active lit duration (seconds) */
  duration: number;
  /** Elapsed since created */
  age: number;
  peak: number;
  sx: number;
  sy: number;
  sz: number;
};

const SKY_CLEAR = new THREE.Color(0x5ba3d9);
const SKY_OVERCAST = new THREE.Color(0x7a8fa3);
const SKY_STORM = new THREE.Color(0x2c3348);
const SKY_FLASH = new THREE.Color(0xd4e4ff);
const FOG_CLEAR = new THREE.Color(0x8ec4e8);
const FOG_STORM = new THREE.Color(0x3a4158);
const FOG_FLASH = new THREE.Color(0xc8d8f0);

const WIND_PEAK_STORM = 2.6;
const WIND_PEAK_RAIN = 1.6;
const WIND_PEAK_OVERCAST = 0.9;
const WIND_BASE_MAX = 0.35;

let nextCellId = 1;

function hash2(x: number, z: number, s: number): number {
  const n = Math.sin(x * 127.1 + z * 311.7 + s * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function stormWindFalloff(dist: number, radius: number): number {
  if (dist >= radius) return 0;
  const t = 1 - dist / radius;
  return t * t * 0.35 + t * t * t * t * 0.65;
}

/** Shared uniforms for color + depth wind shaders */
const windUniforms = {
  uTime: { value: 0 },
  uWind: { value: new THREE.Vector2(0, 0) },
};

const WIND_VERT_DECL = /* glsl */ `
attribute float wind;
uniform float uTime;
uniform vec2 uWind;
`;

const WIND_VERT_DISPLACE = /* glsl */ `
if (wind > 0.001) {
  float wLen = length(uWind);
  float amp = min(0.42, 0.022 + wLen * 0.085 + wLen * wLen * 0.004);
  float freq = 0.9 + wLen * 0.25;
  float phase = uTime * freq + position.x * 0.55 + position.z * 0.48 + position.y * 0.2;
  float gust = sin(uTime * (1.3 + wLen * 0.2) + position.x * 0.9) * 0.5 + 0.5;
  float gustMul = 0.88 + gust * 0.2 * smoothstep(1.0, 2.8, wLen);
  // wind attribute: leaves ≈ uniform 1 (rigid sway); plants = 0 at stem → 1 at tip (shear)
  float w = wind;
  float sway = sin(phase) * w * gustMul;
  float sway2 = cos(phase * 1.37 + 1.7) * w * gustMul;
  vec2 wDir = wLen > 0.001 ? uWind / wLen : vec2(0.2, 0.1);
  transformed.x += wDir.x * sway * amp + sway2 * amp * 0.16;
  transformed.z += wDir.y * sway * amp + sway * amp * 0.12;
  // Keep vertical bob tiny so planted stems don't hop
  transformed.y += sway2 * amp * (0.02 + wLen * 0.008) * w;
}
`;

function injectWindIntoShader(shader: {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
}): void {
  shader.uniforms.uTime = windUniforms.uTime;
  shader.uniforms.uWind = windUniforms.uWind;
  if (!shader.vertexShader.includes("attribute float wind")) {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      `#include <common>
${WIND_VERT_DECL}`,
    );
  }
  if (!shader.vertexShader.includes("sway2 * amp")) {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
${WIND_VERT_DISPLACE}`,
    );
  }
}

/**
 * Leaf sway via vertex attribute `wind` (1 on leaves, 0 elsewhere).
 * Color pass + mesh.customDepthMaterial share the same uniforms so
 * shadow maps track swaying leaves without breaking USE_SHADOWMAP.
 */
export function installWindOnMaterial(material: THREE.MeshLambertMaterial): {
  update: (time: number, windX: number, windZ: number) => void;
} {
  material.customProgramCacheKey = () => "block-leaf-wind-v7-plant-shear";
  material.onBeforeCompile = (shader) => {
    injectWindIntoShader(shader);
  };

  // Depth material is attached to each Mesh (not Material) in world.remeshChunk
  const depthMat = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    alphaTest: material.alphaTest > 0 ? material.alphaTest : 0.5,
  });
  depthMat.customProgramCacheKey = () => "block-leaf-wind-depth-v7-plant-shear";
  depthMat.onBeforeCompile = (shader) => {
    injectWindIntoShader(shader);
  };
  material.userData.windDepthMaterial = depthMat;

  material.needsUpdate = true;

  return {
    update(time: number, windX: number, windZ: number) {
      windUniforms.uTime.value = time;
      windUniforms.uWind.value.set(windX, windZ);
    },
  };
}

export class WeatherSystem {
  readonly group = new THREE.Group();
  private cells: WeatherCell[] = [];
  private time = 0;
  private spawnTimer = 3;
  private seed: number;
  private baseWindX = 0.25;
  private baseWindZ = 0.12;

  private cloudMesh: THREE.Mesh;
  private cloudMat: THREE.MeshLambertMaterial;
  private cloudGeom: THREE.BufferGeometry;
  private cloudScrollX = 0;
  private cloudScrollZ = 0;
  private readonly cloudY = 118;

  private readonly cloudDeckGap = 3.4;
  private readonly cloudLayerStep = 1.15;
  private readonly cloudCell = 4;
  /** Half-extent in cloud cells — 10+ chunks (chunk=16 → need ≥40 cells at cell size 4) */
  private readonly cloudHalf = 42;
  private readonly maxCloudVoxels = 10000;

  private cloudColor = new THREE.Color();
  private cloudOcc = new Set<string>();
  private cloudVoxels: {
    x: number; y: number; z: number;
    qx: number; qy: number; qz: number;
    r: number; g: number; b: number;
  }[] = [];

  private rain: RainDrop[] = [];
  private splashes: Splash[] = [];
  /** Line segment positions: 2 verts × 3 floats per drop */
  private rainPositions: Float32Array;
  private rainGeom: THREE.BufferGeometry;
  private rainLines: THREE.LineSegments;
  private splashPositions: Float32Array;
  private splashGeom: THREE.BufferGeometry;
  private splashPoints: THREE.Points;
  private readonly maxRain = 2000;
  private readonly maxSplash = 650;

  private bolts: LightningBolt[] = [];
  private flashMain: THREE.DirectionalLight;
  private flashFill: THREE.DirectionalLight;
  private flashAmbient: THREE.AmbientLight;
  private flashPoints: THREE.PointLight[] = [];
  private flashPulses: FlashPulse[] = [];
  private flashAmount = 0;
  private tmpSky = new THREE.Color();
  private tmpFog = new THREE.Color();
  private baseSunIntensity = 1.15;
  private baseAmbientIntensity = 0.55;
  private baseHemiIntensity = 0.35;
  private readonly flashMaxDist = 58;
  private readonly flashNearDist = 22;

  private scene: THREE.Scene;
  private sun: THREE.SpotLight | THREE.DirectionalLight;
  private ambient: THREE.AmbientLight;
  private hemi: THREE.HemisphereLight;
  private fog: THREE.Fog;

  private lastSample: WeatherSample = {
    kind: "clear", intensity: 0, rain: 0, storm: 0, cloud: 0.2,
    windX: 0.25, windZ: 0.12, windSpeed: 0.28, gloom: 0, stormProximity: 0,
  };
  private windHook: { update: (t: number, x: number, z: number) => void };
  /** Fired when lightning hits (distance in blocks from player) */
  onLightning: ((info: {
    dist: number;
    strength: number;
    x: number;
    y: number;
    z: number;
  }) => void) | null = null;
  private lastDayNight: DayNightSample | null = null;

  constructor(
    scene: THREE.Scene,
    sun: THREE.SpotLight | THREE.DirectionalLight,
    ambient: THREE.AmbientLight,
    hemi: THREE.HemisphereLight,
    fog: THREE.Fog,
    blockMaterial: THREE.MeshLambertMaterial,
    seed = 1337,
  ) {
    this.scene = scene; this.sun = sun; this.ambient = ambient;
    this.hemi = hemi; this.fog = fog; this.seed = seed;
    this.windHook = installWindOnMaterial(blockMaterial);

    this.flashMain = new THREE.DirectionalLight(0xdde8ff, 0);
    this.flashMain.position.set(20, 80, -30);
    this.scene.add(this.flashMain); this.scene.add(this.flashMain.target);
    this.flashFill = new THREE.DirectionalLight(0xb0c4ff, 0);
    this.flashFill.position.set(-40, 50, 40);
    this.scene.add(this.flashFill); this.scene.add(this.flashFill.target);
    this.flashAmbient = new THREE.AmbientLight(0xc8d8ff, 0);
    this.scene.add(this.flashAmbient);
    this.scene.background = SKY_CLEAR.clone();
    this.fog.color.copy(FOG_CLEAR);

    this.cloudMat = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      fog: true,
      transparent: true,
      opacity: 0.72,
      depthWrite: true,
      side: THREE.FrontSide,
      vertexColors: true,
    });
    this.cloudGeom = new THREE.BufferGeometry();
    this.cloudMesh = new THREE.Mesh(this.cloudGeom, this.cloudMat);
    this.cloudMesh.frustumCulled = false;
    this.cloudMesh.renderOrder = -1;
    this.group.add(this.cloudMesh);

    // Rain as line streaks (head → tail along velocity)
    this.rainPositions = new Float32Array(this.maxRain * 6);
    this.rainGeom = new THREE.BufferGeometry();
    this.rainGeom.setAttribute(
      "position",
      new THREE.BufferAttribute(this.rainPositions, 3),
    );
    this.rainLines = new THREE.LineSegments(
      this.rainGeom,
      new THREE.LineBasicMaterial({
        color: 0xb8d4ee,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.rainLines.frustumCulled = false;
    this.rainLines.renderOrder = 1;
    this.group.add(this.rainLines);
    for (let i = 0; i < this.maxRain; i++) {
      this.rain.push({
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 1,
        bouncing: false,
        active: false,
      });
    }

    this.splashPositions = new Float32Array(this.maxSplash * 3);
    this.splashGeom = new THREE.BufferGeometry();
    this.splashGeom.setAttribute(
      "position",
      new THREE.BufferAttribute(this.splashPositions, 3),
    );
    this.splashPoints = new THREE.Points(
      this.splashGeom,
      new THREE.PointsMaterial({
        color: 0xd8e8f4,
        size: 0.05,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
        sizeAttenuation: true,
        fog: true,
      }),
    );
    this.splashPoints.frustumCulled = false;
    this.group.add(this.splashPoints);
    for (let i = 0; i < this.maxSplash; i++) {
      this.splashes.push({
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        active: false,
      });
    }

    // Poisson-disk seed: evenly spaced systems, no stacked banks
    this.seedWeatherFromPoisson(0, 0);
    this.scene.add(this.group);
  }

  get sample(): WeatherSample { return this.lastSample; }

  setDayNight(dn: DayNightSample): void {
    this.lastDayNight = dn;
    this.baseSunIntensity = Math.max(0.05, dn.sunIntensity);
    this.baseAmbientIntensity = dn.ambientIntensity;
    this.baseHemiIntensity = dn.hemiIntensity;
  }

  private fairCloudNoise(gx: number, gz: number): number {
    return hash2(gx * 0.31, gz * 0.31, this.seed) * 0.65 +
      hash2(gx * 0.09 + 40, gz * 0.09, this.seed + 9) * 0.35;
  }

  /** Stable altitude plane — unique lane per active system to avoid z-fight. */
  private cloudDeckY(cell: WeatherCell): number {
    const kindBias =
      cell.kind === "storm"
        ? 6
        : cell.kind === "rain"
          ? 1.2
          : cell.kind === "overcast"
            ? -2.8
            : 0;
    // Deterministic lane from id; also offset by rank among living cells
    const peers = this.cells
      .filter((c) => c.kind !== "clear")
      .sort((a, b) => a.id - b.id);
    const rank = Math.max(
      0,
      peers.findIndex((c) => c.id === cell.id),
    );
    const lane = rank - (peers.length - 1) * 0.5;
    // Extra hash-ish spread so same-rank never shares a plane
    const idLane = ((cell.id * 7 + 3) % 5) - 2;
    return (
      this.cloudY +
      kindBias +
      lane * this.cloudDeckGap * 1.35 +
      idLane * 0.55
    );
  }

  private fairCloudDeckY(): number {
    return this.cloudY - 3.5;
  }

  private evaluateCell(cell: WeatherCell, wx: number, wz: number) {
    const dx = wx - cell.x;
    const dz = wz - cell.z;
    const d = Math.hypot(dx, dz);
    const outerR = cell.radius;
    const coreFrac = cell.kind === "storm" ? Math.min(0.4, cell.core) : cell.core;
    const coreR = Math.max(4, outerR * coreFrac);
    const approachR =
      cell.kind === "storm" ? outerR * 3.1 :
      cell.kind === "rain" ? outerR * 2.0 :
      cell.kind === "overcast" ? outerR * 1.45 : outerR * 0.9;

    let approach = 0;
    if (approachR > 0 && d < approachR) {
      const t = 1 - d / approachR;
      approach = t * t * (0.3 + 0.7 * t * t) * cell.intensity;
      if (cell.kind === "rain") approach *= 0.55;
      else if (cell.kind === "overcast") approach *= 0.32;
      else if (cell.kind === "clear") approach *= 0.1;
    }

    let inCell = 0, core = 0, rainBand = 0, front = 0, trailing = 0;
    if (d < outerR && cell.kind !== "clear") {
      const tOuter = 1 - d / outerR;
      inCell = tOuter * tOuter * (3 - 2 * tOuter) * cell.intensity;
      if (d <= coreR) {
        const u = 1 - d / coreR;
        core = u * u * (0.4 + 0.6 * u) * cell.intensity;
        rainBand = cell.intensity;
      } else {
        const u = 1 - (d - coreR) / Math.max(0.01, outerR - coreR);
        rainBand = Math.max(0, u * u) * cell.intensity;
      }
      const spd = Math.hypot(cell.vx, cell.vz) || 1;
      const lead = d > 0.4 ? (dx * cell.vx + dz * cell.vz) / (spd * d) : 0;
      const ring = smoothstep(coreR * 0.35, coreR * 0.95, d) *
        (1 - smoothstep(outerR * 0.55, outerR * 0.98, d));
      const frontScale = cell.kind === "storm" ? 1.15 : cell.kind === "rain" ? 0.55 : 0.25;
      front = Math.max(0, lead) * ring * cell.intensity * frontScale;
      trailing = Math.max(0, -lead) * inCell * 0.35;
    }
    return { d, dx, dz, approach, inCell, core, rainBand, front, trailing };
  }

  private weatherCloudAt(wx: number, wz: number) {
    let cover = 0, dark = 0, layers = 1, front = 0;
    for (const cell of this.cells) {
      if (cell.kind === "clear") continue;
      const z = this.evaluateCell(cell, wx, wz);
      const bankR = cell.radius * (cell.kind === "storm" ? 1.5 : cell.kind === "rain" ? 1.22 : 1.12);
      if (z.d > bankR) continue;
      const t = 1 - z.d / bankR;
      const fall = t * t * (3 - 2 * t);
      const coreCover = z.core * (cell.kind === "storm" ? 1.05 : cell.kind === "rain" ? 0.75 : 0.4);
      const bandCover = z.rainBand * 0.55 * (cell.kind === "storm" ? 0.9 : 0.7);
      const localCover = Math.min(1.25, coreCover + bandCover + z.front * 1.1 + fall * cell.intensity * 0.25 * (1 - z.trailing));
      cover = Math.max(cover, localCover);
      front = Math.max(front, z.front);
      const localDark = cell.kind === "storm"
        ? 0.35 + z.core * 0.5 + z.front * 0.25 + z.rainBand * 0.15
        : cell.kind === "rain" ? 0.2 + z.rainBand * 0.3 + z.front * 0.1 : 0.1 + z.inCell * 0.15;
      dark = Math.max(dark, Math.min(1, localDark));
      let localLayers = 1;
      if (cell.kind === "storm") localLayers = 1 + Math.floor(z.core * 2 + z.front * 2);
      else if (cell.kind === "rain" && z.rainBand > 0.55) localLayers = 2;
      layers = Math.max(layers, localLayers);
    }
    return { cover: Math.min(1, cover), dark: Math.min(1, dark), layers: Math.min(3, layers), front: Math.min(1, front) };
  }

  /**
   * Minimum center distance so cloud banks / rain sheets don't interpenetrate.
   * Storms get extra padding — they're the worst z-fighters.
   */
  private minCenterDist(a: WeatherCell, b: WeatherCell): number {
    let pad = 28;
    if (a.kind === "storm" || b.kind === "storm") pad = 48;
    if (a.kind === "storm" && b.kind === "storm") pad = 72;
    return a.radius * 0.9 + b.radius * 0.9 + pad;
  }

  private occupiesSpace(c: WeatherCell): boolean {
    return c.kind !== "clear";
  }

  /** Typical exclusion radius used for Poisson min-distance (kind-aware). */
  private poissonMinDistFor(kind: WeatherKind, radius: number): number {
    if (kind === "storm") return radius * 1.85 + 70;
    if (kind === "rain") return radius * 1.7 + 40;
    if (kind === "overcast") return radius * 1.55 + 32;
    return radius + 20;
  }

  /**
   * Bridson Poisson-disk samples in an annulus around (cx, cz).
   * Points are ≥ minDist apart and lie in [rInner, rOuter] from center.
   * Also rejected if too close to existing weather cells (occupancy).
   */
  private poissonDiskAnnulus(
    cx: number,
    cz: number,
    rInner: number,
    rOuter: number,
    minDist: number,
    maxPoints: number,
    ignoreId = -1,
  ): { x: number; z: number }[] {
    if (minDist <= 1 || maxPoints <= 0 || rOuter <= rInner) return [];

    const cellSize = minDist / Math.SQRT2;
    const originX = cx - rOuter;
    const originZ = cz - rOuter;
    const gridW = Math.ceil((rOuter * 2) / cellSize) + 2;
    const gridH = gridW;
    const grid = new Int32Array(gridW * gridH).fill(-1);
    const points: { x: number; z: number }[] = [];
    const active: number[] = [];

    const inAnnulus = (x: number, z: number) => {
      const d = Math.hypot(x - cx, z - cz);
      return d >= rInner && d <= rOuter;
    };

    const gridIndex = (x: number, z: number) => {
      const gx = Math.floor((x - originX) / cellSize);
      const gz = Math.floor((z - originZ) / cellSize);
      if (gx < 0 || gz < 0 || gx >= gridW || gz >= gridH) return -1;
      return gz * gridW + gx;
    };

    const farFromSamples = (x: number, z: number) => {
      const gx = Math.floor((x - originX) / cellSize);
      const gz = Math.floor((z - originZ) / cellSize);
      for (let iz = gz - 2; iz <= gz + 2; iz++) {
        for (let ix = gx - 2; ix <= gx + 2; ix++) {
          if (ix < 0 || iz < 0 || ix >= gridW || iz >= gridH) continue;
          const pi = grid[iz * gridW + ix]!;
          if (pi < 0) continue;
          const p = points[pi]!;
          if (Math.hypot(p.x - x, p.z - z) < minDist) return false;
        }
      }
      return true;
    };

    const farFromCells = (x: number, z: number) => {
      // Treat candidate as ~storm-scale so banks stay clear
      const probeR = minDist * 0.42;
      for (const c of this.cells) {
        if (c.id === ignoreId || !this.occupiesSpace(c)) continue;
        const need = c.radius * 0.9 + probeR + (c.kind === "storm" ? 48 : 28);
        if (Math.hypot(c.x - x, c.z - z) < need) return false;
      }
      return true;
    };

    const tryAdd = (x: number, z: number): boolean => {
      if (!inAnnulus(x, z)) return false;
      if (!farFromSamples(x, z)) return false;
      if (!farFromCells(x, z)) return false;
      const idx = points.length;
      points.push({ x, z });
      active.push(idx);
      const gi = gridIndex(x, z);
      if (gi >= 0) grid[gi] = idx;
      return true;
    };

    // Seed first point (uniform in annulus)
    for (let s = 0; s < 48 && points.length === 0; s++) {
      const ang = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(
        rInner * rInner +
          Math.random() * (rOuter * rOuter - rInner * rInner),
      );
      tryAdd(cx + Math.cos(ang) * rr, cz + Math.sin(ang) * rr);
    }
    if (points.length === 0) return [];

    // Bridson: spawn up to k candidates in ring [minDist, 2*minDist]
    const k = 30;
    while (active.length > 0 && points.length < maxPoints) {
      const ai = Math.floor(Math.random() * active.length);
      const p = points[active[ai]!]!;
      let found = false;
      for (let n = 0; n < k; n++) {
        const ang = Math.random() * Math.PI * 2;
        const rad = minDist * (1 + Math.random());
        if (tryAdd(p.x + Math.cos(ang) * rad, p.z + Math.sin(ang) * rad)) {
          found = true;
          break;
        }
      }
      if (!found) active.splice(ai, 1);
    }
    return points;
  }

  private pickKindForSlot(slot: number, stormCount: number): {
    kind: WeatherKind;
    radius: number;
    intensity: number;
  } {
    // Prefer a couple of storms first, then mix rain / overcast
    if (slot < 2 && stormCount < 2) {
      return {
        kind: "storm",
        radius: 95 + Math.random() * 55,
        intensity: 0.75 + Math.random() * 0.25,
      };
    }
    const roll = Math.random();
    if (roll < 0.35) {
      return {
        kind: "rain",
        radius: 55 + Math.random() * 40,
        intensity: 0.55 + Math.random() * 0.4,
      };
    }
    if (roll < 0.7) {
      return {
        kind: "overcast",
        radius: 70 + Math.random() * 45,
        intensity: 0.45 + Math.random() * 0.35,
      };
    }
    if (stormCount < 2 && roll < 0.85) {
      return {
        kind: "storm",
        radius: 95 + Math.random() * 50,
        intensity: 0.7 + Math.random() * 0.28,
      };
    }
    return {
      kind: "rain",
      radius: 50 + Math.random() * 35,
      intensity: 0.5 + Math.random() * 0.4,
    };
  }

  /** Initial Poisson layout around a world center. */
  private seedWeatherFromPoisson(cx: number, cz: number): void {
    this.cells = [];
    // minDist ~200 keeps large storm cores from overlapping at seed
    const pts = this.poissonDiskAnnulus(cx, cz, 50, 340, 210, 6);
    let storms = 0;
    let i = 0;
    for (const p of pts) {
      const spec = this.pickKindForSlot(i, storms);
      if (spec.kind === "storm") storms++;
      // Validate with real radius/kind (Poisson used conservative minDist)
      if (!this.canPlaceSystem(p.x, p.z, spec.radius, spec.kind)) {
        // Try a smaller rain system in the same slot
        const fallbackR = 50 + Math.random() * 30;
        if (this.canPlaceSystem(p.x, p.z, fallbackR, "rain")) {
          this.cells.push(
            this.makeCell(p.x, p.z, "rain", 0.6 + Math.random() * 0.3, fallbackR),
          );
        }
        i++;
        continue;
      }
      this.cells.push(
        this.makeCell(p.x, p.z, spec.kind, spec.intensity, spec.radius),
      );
      i++;
    }
    // Guarantee at least one storm if Poisson was sparse
    if (!this.cells.some((c) => c.kind === "storm")) {
      const extra = this.poissonDiskAnnulus(cx, cz, 80, 280, 240, 3);
      const p = extra[0];
      if (p) {
        this.cells.push(
          this.makeCell(p.x, p.z, "storm", 0.9, 110 + Math.random() * 30),
        );
      }
    }
    this.separateCellsHard();
  }

  /** True if a candidate placement is clear of other systems. */
  private canPlaceSystem(
    x: number,
    z: number,
    radius: number,
    kind: WeatherKind,
    ignoreId = -1,
  ): boolean {
    if (kind === "clear") return true;
    if (kind === "storm") {
      const storms = this.cells.filter(
        (c) => c.kind === "storm" && c.id !== ignoreId,
      ).length;
      if (storms >= 2) return false;
    }
    const probe: WeatherCell = {
      id: -1,
      x,
      z,
      radius,
      core: 0.3,
      kind,
      intensity: 1,
      vx: 0,
      vz: 0,
      age: 0,
      life: 1,
      nextStrike: 999,
    };
    for (const c of this.cells) {
      if (c.id === ignoreId || !this.occupiesSpace(c)) continue;
      const d = Math.hypot(c.x - x, c.z - z);
      if (d < this.minCenterDist(probe, c)) return false;
    }
    return true;
  }

  /** One-shot push so residual overlaps get cleaned up. */
  private separateCellsHard(): void {
    const active = this.cells.filter((c) => this.occupiesSpace(c));
    for (let iter = 0; iter < 8; iter++) {
      let moved = false;
      for (let i = 0; i < active.length; i++) {
        for (let j = i + 1; j < active.length; j++) {
          const a = active[i]!;
          const b = active[j]!;
          const dx = b.x - a.x;
          const dz = b.z - a.z;
          let d = Math.hypot(dx, dz);
          const need = this.minCenterDist(a, b);
          if (d >= need) continue;
          if (d < 0.01) {
            const ang = Math.random() * Math.PI * 2;
            a.x -= Math.cos(ang) * need * 0.5;
            a.z -= Math.sin(ang) * need * 0.5;
            b.x += Math.cos(ang) * need * 0.5;
            b.z += Math.sin(ang) * need * 0.5;
            moved = true;
            continue;
          }
          const push = (need - d) * 0.55;
          const nx = dx / d;
          const nz = dz / d;
          a.x -= nx * push;
          a.z -= nz * push;
          b.x += nx * push;
          b.z += nz * push;
          moved = true;
        }
      }
      if (!moved) break;
    }
  }

  /** Soft repulsion if drift starts to close gaps (safety net under Poisson). */
  private separateCellsSoft(dt: number): void {
    const active = this.cells.filter((c) => this.occupiesSpace(c));
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i]!;
        const b = active[j]!;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz) || 0.01;
        const need = this.minCenterDist(a, b);
        if (d >= need) continue;
        const overlap = (need - d) / need;
        const nx = dx / d;
        const nz = dz / d;
        const posPush = overlap * overlap * 18 * dt;
        a.x -= nx * posPush;
        a.z -= nz * posPush;
        b.x += nx * posPush;
        b.z += nz * posPush;
        const vPush =
          (0.35 + (a.kind === "storm" || b.kind === "storm" ? 0.25 : 0)) *
          overlap *
          dt *
          2.5;
        a.vx -= nx * vPush;
        a.vz -= nz * vPush;
        b.vx += nx * vPush;
        b.vz += nz * vPush;
      }
    }
  }

  /**
   * Place a new system (or relocate one) using Poisson candidates around player.
   * Returns true if a position was found.
   */
  private placeFromPoisson(
    px: number,
    pz: number,
    kind: WeatherKind,
    radius: number,
    ignoreId = -1,
  ): { x: number; z: number } | null {
    const minDist = this.poissonMinDistFor(kind, radius);
    const rInner = Math.max(70, radius * 0.7);
    const rOuter = Math.max(rInner + 80, 120 + radius * 1.2);
    const cands = this.poissonDiskAnnulus(
      px,
      pz,
      rInner,
      rOuter,
      minDist,
      10,
      ignoreId,
    );
    // Shuffle lightly so we don't always pick the first Bridson seed
    for (let i = cands.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = cands[i]!;
      cands[i] = cands[j]!;
      cands[j] = t;
    }
    for (const c of cands) {
      if (this.canPlaceSystem(c.x, c.z, radius, kind, ignoreId)) {
        return c;
      }
    }
    // Fallback: denser sample with smaller minDist
    const loose = this.poissonDiskAnnulus(
      px,
      pz,
      rInner * 0.85,
      rOuter * 1.15,
      minDist * 0.75,
      12,
      ignoreId,
    );
    for (const c of loose) {
      if (this.canPlaceSystem(c.x, c.z, radius, kind, ignoreId)) {
        return c;
      }
    }
    return null;
  }

  private makeCell(
    x: number,
    z: number,
    kind: WeatherKind,
    intensity: number,
    radius: number,
  ): WeatherCell {
    const ang = Math.random() * Math.PI * 2;
    // Storms drift slowly so a large system can sit over the player for minutes
    const spd =
      kind === "storm"
        ? 0.22 + Math.random() * 0.2
        : kind === "rain"
          ? 0.35 + Math.random() * 0.25
          : 0.4 + Math.random() * 0.35;
    const life =
      kind === "storm"
        ? 420 + Math.random() * 420 // 7–14 minutes
        : kind === "rain"
          ? 240 + Math.random() * 240
          : 120 + Math.random() * 180;
    return {
      id: nextCellId++,
      x,
      z,
      radius,
      core: kind === "storm" ? 0.28 : kind === "rain" ? 0.48 : 0.5,
      kind,
      intensity,
      vx: Math.cos(ang) * spd,
      vz: Math.sin(ang) * spd,
      age: 0,
      life,
      nextStrike: kind === "storm" ? 1 + Math.random() * 3 : 9999,
    };
  }

  private windRadiusFor(cell: WeatherCell): number {
    if (cell.kind === "storm") return cell.radius * 2.5;
    if (cell.kind === "rain") return cell.radius * 1.65;
    if (cell.kind === "overcast") return cell.radius * 1.2;
    return cell.radius * 0.8;
  }

  private peakWindFor(cell: WeatherCell): number {
    if (cell.kind === "storm") return WIND_PEAK_STORM * cell.intensity;
    if (cell.kind === "rain") return WIND_PEAK_RAIN * cell.intensity;
    if (cell.kind === "overcast") return WIND_PEAK_OVERCAST * cell.intensity;
    return WIND_BASE_MAX * cell.intensity;
  }

  sampleAt(wx: number, wz: number): WeatherSample {
    let rain = 0, storm = 0, cloud = 0.15, gloom = 0, intensity = 0;
    let kind: WeatherKind = "clear";
    let stormProximity = 0;
    let windX = this.baseWindX, windZ = this.baseWindZ;
    let windSpeed = Math.hypot(this.baseWindX, this.baseWindZ);

    for (const cell of this.cells) {
      const z = this.evaluateCell(cell, wx, wz);
      stormProximity = Math.max(stormProximity, z.approach);
      const gloomHere =
        cell.kind === "storm"
          ? z.core * 1.0 + z.front * 0.5 + z.rainBand * 0.3
          : cell.kind === "rain"
            ? z.rainBand * 0.75 + z.front * 0.2
            : cell.kind === "overcast"
              ? z.inCell * 0.5
              : 0;
      gloom = Math.max(gloom, Math.min(1, gloomHere));
      const cloudHere = cell.kind === "clear" ? z.approach * 0.2
        : Math.min(1, z.core * 0.9 + z.rainBand * 0.55 + z.front * 0.7 + z.approach * 0.35);
      cloud = Math.max(cloud, cloudHere);

      if (cell.kind === "storm") {
        rain = Math.max(rain, Math.min(1.15, z.core * 1.15 + z.rainBand * 0.55 + z.front * 0.5));
        storm = Math.max(storm, Math.min(1, z.core * 1.05 + z.front * 0.55));
      } else if (cell.kind === "rain") {
        rain = Math.max(rain, Math.min(1, z.rainBand * 0.95 + z.front * 0.15));
      }

      const w = cell.kind === "storm" ? z.core * 1.1 + z.front * 0.5 + z.rainBand * 0.35 : z.inCell;
      if (w > intensity) { intensity = Math.min(1, w); if (w > 0.08) kind = cell.kind; }

      const wR = this.windRadiusFor(cell);
      if (z.d >= wR) continue;
      const peak = this.peakWindFor(cell);
      const radial = stormWindFalloff(z.d, wR);
      const struct = cell.kind === "storm"
        ? 0.35 * radial + 0.4 * z.front + 0.35 * z.core + 0.15 * z.rainBand
        : 0.55 * radial + 0.25 * z.front + 0.2 * z.rainBand;
      const speedHere = peak * Math.min(1.15, struct) * (1 - z.trailing * 0.35);

      let dirX = 0, dirZ = 0;
      if (z.d > 0.35) {
        const nx = z.dx / z.d, nz = z.dz / z.d;
        if (cell.kind === "storm") {
          const swirl = 0.55 + z.front * 0.55 + z.core * 0.25;
          dirX = nx * (0.4 + z.core * 0.25) + -nz * swirl;
          dirZ = nz * (0.4 + z.core * 0.25) + nx * swirl;
          const cspd = Math.hypot(cell.vx, cell.vz) || 1;
          dirX += (cell.vx / cspd) * z.front * 0.5;
          dirZ += (cell.vz / cspd) * z.front * 0.5;
        } else {
          dirX = nx * 0.35 + cell.vx * 0.15;
          dirZ = nz * 0.35 + cell.vz * 0.15;
        }
      } else {
        dirX = cell.vx + Math.sin(this.time * 3 + cell.id) * 0.9;
        dirZ = cell.vz + Math.cos(this.time * 2.6 + cell.id) * 0.9;
      }
      const dLen = Math.hypot(dirX, dirZ) || 1;
      dirX /= dLen; dirZ /= dLen;
      const gust = 0.72 + 0.5 * Math.sin(this.time * (1.8 + cell.id * 0.2) + cell.x * 0.05 + wx * 0.03) *
        (0.4 + z.core * 0.4 + z.front * 0.5);
      const contrib = speedHere * gust;
      if (contrib > windSpeed * 0.85) {
        const blend = smoothstep(windSpeed * 0.5, contrib, contrib);
        const curSpd = Math.max(windSpeed, 0.001);
        const outDirX = (windX / curSpd) * (1 - blend) + dirX * blend;
        const outDirZ = (windZ / curSpd) * (1 - blend) + dirZ * blend;
        const outLen = Math.hypot(outDirX, outDirZ) || 1;
        windSpeed = Math.max(windSpeed, contrib);
        windX = (outDirX / outLen) * windSpeed;
        windZ = (outDirZ / outLen) * windSpeed;
      } else {
        windX += dirX * contrib * 0.25;
        windZ += dirZ * contrib * 0.25;
        windSpeed = Math.hypot(windX, windZ);
      }
    }

    const maxWind = WIND_PEAK_STORM * 1.05;
    if (windSpeed > maxWind) {
      windX = (windX / windSpeed) * maxWind;
      windZ = (windZ / windSpeed) * maxWind;
      windSpeed = maxWind;
    }
    return {
      kind, intensity, rain, storm, cloud, windX, windZ, windSpeed, gloom,
      stormProximity: Math.min(1, stormProximity),
    };
  }

  update(dt: number, world: World, px: number, py: number, pz: number): void {
    this.time += dt;
    this.baseWindX = 0.22 + Math.sin(this.time * 0.05) * 0.12;
    this.baseWindZ = 0.1 + Math.cos(this.time * 0.04) * 0.14;

    for (const cell of this.cells) {
      cell.age += dt;
      cell.x += cell.vx * dt;
      cell.z += cell.vz * dt;
      // Gentle steering — keep storms slow
      const steer =
        cell.kind === "storm" ? 0.018 : cell.kind === "rain" ? 0.035 : 0.05;
      cell.vx += Math.sin(this.time * 0.12 + cell.id) * steer * dt;
      cell.vz += Math.cos(this.time * 0.1 + cell.id * 2) * steer * dt;
      const spd = Math.hypot(cell.vx, cell.vz);
      const maxSpd =
        cell.kind === "storm" ? 0.48 : cell.kind === "rain" ? 0.75 : 1.0;
      if (spd > maxSpd) {
        cell.vx = (cell.vx / spd) * maxSpd;
        cell.vz = (cell.vz / spd) * maxSpd;
      }
      const dx = cell.x - px,
        dz = cell.z - pz,
        dist = Math.hypot(dx, dz);
      // Recycle far systems via Poisson so they re-enter on a clean slot
      const recycleAt = Math.max(220, cell.radius * 2.8);
      if (dist > recycleAt) {
        const pos = this.placeFromPoisson(
          px,
          pz,
          cell.kind,
          cell.radius,
          cell.id,
        );
        if (pos) {
          cell.x = pos.x;
          cell.z = pos.z;
        } else {
          const place = Math.max(cell.radius * 1.1, 100 + Math.random() * 50);
          cell.x = px - (dx / (dist || 1)) * place;
          cell.z = pz - (dz / (dist || 1)) * place;
        }
      }
      if (cell.kind === "storm") {
        cell.nextStrike -= dt;
        if (cell.nextStrike <= 0) {
          this.strike(cell, world, px, py, pz);
          cell.nextStrike = 2.5 + Math.random() * 6 * (1.2 - cell.intensity);
        }
      }
    }

    // Safety net if drift closes gaps
    this.separateCellsSoft(dt);

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 22 + Math.random() * 30;
      // Expire old non-storm systems first
      this.cells = this.cells.filter(
        (c) => c.age < c.life || c.kind === "storm",
      );

      if (this.cells.length < 6) {
        const storms = this.cells.filter((c) => c.kind === "storm").length;
        const spec = this.pickKindForSlot(this.cells.length, storms);
        const pos = this.placeFromPoisson(px, pz, spec.kind, spec.radius);
        if (pos) {
          this.cells.push(
            this.makeCell(
              pos.x,
              pos.z,
              spec.kind,
              spec.intensity,
              spec.radius,
            ),
          );
        }
      }
      if (this.cells.length > 7) this.cells.length = 7;
      this.separateCellsHard();
    }

    const local = this.sampleAt(px, pz);
    this.lastSample = local;
    this.updateFlashLights(dt, px, py, pz);
    this.windHook.update(this.time, local.windX, local.windZ);
    this.applyAtmosphere(local);
    this.updateClouds(px, pz);
    this.updateRain(dt, world, px, py, pz, local);
    this.updateBolts(dt);
  }

  private triggerLocalFlash(strikeX: number, strikeY: number, strikeZ: number, strength: number): void {
    if (strength < 0.08) return;
    const s = Math.max(0, Math.min(1, strength));
    // Multi-pulse sequence lasting several frames each (readable at 30–60 fps)
    // Timeline ~0.55s: hard open → hold → flicker → secondary → afterglow
    this.flashPulses.push(
      {
        delay: 0,
        duration: 0.14,
        age: 0,
        peak: 1.1 * s,
        sx: strikeX,
        sy: strikeY,
        sz: strikeZ,
      },
      {
        delay: 0.1,
        duration: 0.08,
        age: 0,
        peak: 0.18 * s,
        sx: strikeX,
        sy: strikeY,
        sz: strikeZ,
      },
      {
        delay: 0.16,
        duration: 0.18,
        age: 0,
        peak: 0.85 * s,
        sx: strikeX,
        sy: strikeY,
        sz: strikeZ,
      },
      {
        delay: 0.32,
        duration: 0.22,
        age: 0,
        peak: 0.4 * s,
        sx: strikeX,
        sy: strikeY,
        sz: strikeZ,
      },
      {
        delay: 0.48,
        duration: 0.2,
        age: 0,
        peak: 0.16 * s,
        sx: strikeX,
        sy: strikeY,
        sz: strikeZ,
      },
    );
    const pl = new THREE.PointLight(0xe8f0ff, 0, 56, 1.7);
    pl.position.set(strikeX, strikeY + 6, strikeZ);
    this.scene.add(pl);
    this.flashPoints.push(pl);
    // Match point-light lifetime to the pulse train (~0.7s)
    pl.intensity = 16 * s;
    window.setTimeout(() => {
      pl.intensity = 5 * s;
    }, 80);
    window.setTimeout(() => {
      pl.intensity = 12 * s;
    }, 160);
    window.setTimeout(() => {
      pl.intensity = 4 * s;
    }, 320);
    window.setTimeout(() => {
      pl.intensity = 7 * s;
    }, 420);
    window.setTimeout(() => {
      this.scene.remove(pl);
      pl.dispose();
      const idx = this.flashPoints.indexOf(pl);
      if (idx >= 0) this.flashPoints.splice(idx, 1);
    }, 720);
  }

  private aimFlashLights(sx: number, sy: number, sz: number, _px: number, _py: number, _pz: number): void {
    this.flashMain.position.set(sx, sy + 55, sz);
    this.flashMain.target.position.set(sx, sy - 20, sz);
    this.flashMain.target.updateMatrixWorld();
    this.flashFill.position.set(sx - 18, sy + 30, sz + 12);
    this.flashFill.target.position.set(sx, sy - 8, sz);
    this.flashFill.target.updateMatrixWorld();
  }

  private flashProximity(dist: number): number {
    if (dist >= this.flashMaxDist) return 0;
    if (dist <= this.flashNearDist) return 1;
    const t = (this.flashMaxDist - dist) / (this.flashMaxDist - this.flashNearDist);
    return t * t;
  }

  private updateFlashLights(dt: number, px: number, py: number, pz: number): void {
    let mainI = 0,
      fillI = 0,
      ambI = 0,
      skyFlash = 0,
      pointI = 0;
    for (let i = this.flashPulses.length - 1; i >= 0; i--) {
      const p = this.flashPulses[i]!;
      p.age += dt;
      const end = p.delay + p.duration;
      if (p.age >= end) {
        this.flashPulses.splice(i, 1);
        continue;
      }
      if (p.age < p.delay) continue;

      // Flat-top envelope: quick rise, hold most of the pulse, soft fall
      // so flashes stay bright across several frames
      const localT = (p.age - p.delay) / p.duration; // 0..1
      let envelope: number;
      if (localT < 0.1) envelope = localT / 0.1;
      else if (localT < 0.72) envelope = 1;
      else envelope = Math.max(0, 1 - (localT - 0.72) / 0.28);

      const e = envelope * p.peak;
      const prox = this.flashProximity(Math.hypot(p.sx - px, p.sz - pz));
      if (prox <= 0.001) continue;

      mainI = Math.max(mainI, e * 1.75 * prox);
      fillI = Math.max(fillI, e * 0.65 * prox);
      ambI = Math.max(ambI, e * 0.32 * prox);
      skyFlash = Math.max(skyFlash, e * 0.42 * prox);
      pointI = Math.max(pointI, e * 18 * prox);
      this.aimFlashLights(p.sx, p.sy, p.sz, px, py, pz);
    }
    this.flashMain.intensity = mainI;
    this.flashFill.intensity = fillI;
    this.flashAmbient.intensity = ambI;
    this.flashAmount = skyFlash;
    for (const pl of this.flashPoints) pl.intensity = Math.max(pl.intensity * 0.85, pointI);
    if (mainI > 0.01) {
      this.flashMain.color.setRGB(0.88, 0.92, 1.0);
      this.flashFill.color.setRGB(0.7, 0.78, 1.0);
      this.flashAmbient.color.setRGB(0.75, 0.82, 1.0);
    }
  }

  private applyAtmosphere(s: WeatherSample): void {
    const approach = s.stormProximity;
    const f = Math.min(1, this.flashAmount);
    const dn = this.lastDayNight;

    const localGrey = Math.min(
      1,
      s.gloom * 0.95 + s.storm * 0.55 + s.rain * 0.4,
    );
    const distantHaze =
      approach > 0.55 ? (approach - 0.55) * 0.35 * (1 - localGrey) : 0;
    const skyWeather = Math.min(1, localGrey + distantHaze);
    const peak = Math.min(
      1,
      localGrey * 0.7 + s.storm * 0.4 + s.rain * 0.25 + distantHaze,
    );

    const baseMie = dn?.mieHaze ?? 0.08;
    const humidAerosol = Math.min(0.55, s.rain * 0.35 + s.gloom * 0.15);
    const dustAerosol = Math.min(
      0.4,
      s.storm * 0.3 + Math.max(0, approach - 0.4) * 0.15,
    );
    const weatherMie = Math.max(humidAerosol, dustAerosol);
    const totalMie = Math.min(0.8, baseMie * 0.85 + weatherMie);

    if (dn) this.tmpSky.copy(dn.sky);
    else this.tmpSky.copy(SKY_CLEAR);

    if (totalMie > 0.04 && skyWeather < 0.55) {
      const mr = 0.9 - dustAerosol * 0.12;
      const mg = 0.92 - dustAerosol * 0.15;
      const mb = 0.95 - dustAerosol * 0.2;
      const k = totalMie * 0.35 * (1 - skyWeather * 0.7);
      this.tmpSky.r = this.tmpSky.r * (1 - k) + mr * k;
      this.tmpSky.g = this.tmpSky.g * (1 - k) + mg * k;
      this.tmpSky.b = this.tmpSky.b * (1 - k) + mb * k;
    }

    if (skyWeather > 0.04) {
      this.tmpSky.lerp(SKY_OVERCAST, skyWeather * 0.65);
      this.tmpSky.lerp(
        SKY_STORM,
        Math.min(1, s.storm * 0.7 + s.gloom * 0.45) * 0.85,
      );
    }
    if (f > 0) this.tmpSky.lerp(SKY_FLASH, Math.min(0.45, f * 0.55));
    this.scene.background = this.tmpSky;

    if (dn) this.tmpFog.copy(dn.fog);
    else this.tmpFog.copy(FOG_CLEAR);
    if (totalMie > 0.05) {
      this.tmpFog.lerp(new THREE.Color(0xd0dce8), totalMie * 0.45);
    }
    this.tmpFog.lerp(FOG_STORM, Math.min(1, peak * 0.75 + distantHaze * 0.3));
    if (f > 0) this.tmpFog.lerp(FOG_FLASH, Math.min(0.35, f * 0.4));
    this.fog.color.copy(this.tmpFog);
    const aerosolFog = totalMie * 22 + humidAerosol * 18;
    this.fog.near = Math.max(18, 72 - peak * 22 - aerosolFog * 0.28 + f * 7);
    // Match ~16-chunk view (256 blocks): soft fade just before the horizon
    this.fog.far = Math.max(
      this.fog.near + 60,
      290 - peak * 70 - aerosolFog * 1.2 + f * 28,
    );




    // Key light owned by DayNight — only pass dimming factors
    const weatherDim = Math.max(
      0.68,
      1 - localGrey * 0.28 - Math.max(0, approach - 0.5) * 0.12 - totalMie * 0.08,
    );
    if (dn) {
      dn.weatherDim = weatherDim;
      dn.weatherFlash = f;
    }

    const ambMul = Math.max(
      0.65,
      1 - localGrey * 0.22 - Math.max(0, approach - 0.55) * 0.1,
    );
    const dayF = dn?.dayFactor ?? 1;
    const nightF = 1 - dayF;
    // Day stays playable-bright; night floor drops hard for a dark cool night
    const ambFloor = 0.035 + dayF * 0.26;
    const ambCeil = 0.18 + dayF * 0.56;
    this.ambient.intensity = Math.max(
      ambFloor,
      Math.min(
        ambCeil,
        (dn?.ambientIntensity ?? this.baseAmbientIntensity) * ambMul +
          totalMie * 0.035 * dayF,
      ),
    );
    if (dn) {
      // Day: soft warm-neutral · Night: deep cool blue, not washed grey
      const r =
        THREE.MathUtils.lerp(0.14, 0.82, dayF) -
        localGrey * 0.06 +
        totalMie * 0.04 * dayF;
      const g =
        THREE.MathUtils.lerp(0.22, 0.86, dayF) -
        localGrey * 0.05 +
        totalMie * 0.03 * dayF;
      const b =
        THREE.MathUtils.lerp(0.42, 0.94, dayF) - localGrey * 0.03;
      this.ambient.color.setRGB(
        Math.max(0.08, r),
        Math.max(0.12, g),
        Math.max(0.2, b),
      );
      if (nightF > 0.15) {
        this.ambient.color.lerp(new THREE.Color(0x0c1830), nightF * 0.65);
      }
    } else {
      this.ambient.color.setRGB(0.68, 0.76, 0.88);
    }

    const hemiMul = Math.max(0.6, 1 - localGrey * 0.22);
    const hemiFloor = 0.03 + dayF * 0.19;
    const hemiCeil = 0.16 + dayF * 0.52;
    this.hemi.intensity = Math.max(
      hemiFloor,
      Math.min(
        hemiCeil,
        (dn?.hemiIntensity ?? this.baseHemiIntensity) * hemiMul +
          totalMie * 0.025 * dayF,
      ),
    );
    if (dn) {
      this.hemi.color.copy(dn.hemiSky);
      this.hemi.groundColor.copy(dn.hemiGround);
      if (localGrey > 0.35) {
        this.hemi.color.lerp(new THREE.Color(0x7a8aa8), localGrey * 0.4 * dayF);
        this.hemi.groundColor.lerp(
          new THREE.Color(0x3a4438),
          localGrey * 0.35 * dayF,
        );
      }
      if (nightF > 0.2) {
        this.hemi.color.lerp(new THREE.Color(0x081428), nightF * 0.55);
        this.hemi.groundColor.lerp(new THREE.Color(0x040a14), nightF * 0.65);
      }
    } else {
      this.hemi.color.set(localGrey > 0.4 ? 0x6a7a98 : 0xb8d8ff);
      this.hemi.groundColor.set(localGrey > 0.4 ? 0x2a3428 : 0x4a6a3a);
    }
  }

  private cloudKey(qx: number, qy: number, qz: number): string {
    return `${qx},${qy},${qz}`;
  }

  private queueCloudVoxel(
    wx: number, y: number, wz: number,
    qx: number, qy: number, qz: number,
    color: THREE.Color,
  ): void {
    if (this.cloudVoxels.length >= this.maxCloudVoxels) return;
    const key = this.cloudKey(qx, qy, qz);
    if (this.cloudOcc.has(key)) return;
    this.cloudOcc.add(key);
    this.cloudVoxels.push({ x: wx, y, z: wz, qx, qy, qz, r: color.r, g: color.g, b: color.b });
  }

  private rebuildCloudMesh(): void {
    const hs = this.cloudCell * 0.5;
    const vs = this.cloudLayerStep * 0.5;
    const positions: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    let base = 0;
    const faces: { dq: [number, number, number]; n: [number, number, number]; corners: [number, number, number][] }[] = [
      { dq: [1,0,0], n: [1,0,0], corners: [[hs,-vs,hs],[hs,-vs,-hs],[hs,vs,-hs],[hs,vs,hs]] },
      { dq: [-1,0,0], n: [-1,0,0], corners: [[-hs,-vs,-hs],[-hs,-vs,hs],[-hs,vs,hs],[-hs,vs,-hs]] },
      { dq: [0,1,0], n: [0,1,0], corners: [[-hs,vs,hs],[hs,vs,hs],[hs,vs,-hs],[-hs,vs,-hs]] },
      { dq: [0,-1,0], n: [0,-1,0], corners: [[-hs,-vs,-hs],[hs,-vs,-hs],[hs,-vs,hs],[-hs,-vs,hs]] },
      { dq: [0,0,1], n: [0,0,1], corners: [[-hs,-vs,hs],[hs,-vs,hs],[hs,vs,hs],[-hs,vs,hs]] },
      { dq: [0,0,-1], n: [0,0,-1], corners: [[hs,-vs,-hs],[-hs,-vs,-hs],[-hs,vs,-hs],[hs,vs,-hs]] },
    ];
    for (const v of this.cloudVoxels) {
      for (const face of faces) {
        if (this.cloudOcc.has(this.cloudKey(v.qx + face.dq[0], v.qy + face.dq[1], v.qz + face.dq[2]))) continue;
        for (const c of face.corners) {
          positions.push(v.x + c[0], v.y + c[1], v.z + c[2]);
          normals.push(face.n[0], face.n[1], face.n[2]);
          colors.push(v.r, v.g, v.b);
        }
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        base += 4;
      }
    }
    this.cloudGeom.dispose();
    this.cloudGeom = new THREE.BufferGeometry();
    if (positions.length > 0) {
      this.cloudGeom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      this.cloudGeom.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
      this.cloudGeom.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      this.cloudGeom.setIndex(indices);
    }
    this.cloudMesh.geometry = this.cloudGeom;
    this.cloudMesh.visible = positions.length > 0;
    this.cloudMat.color.setRGB(1, 1, 1);
  }

  private updateClouds(px: number, pz: number): void {
    const cell = this.cloudCell;
    const half = this.cloudHalf;
    const fairY = this.fairCloudDeckY();
    const flash = this.flashAmount;
    const driftX = this.time * (0.35 + this.lastSample.windX * 0.12) + this.lastSample.windX * 0.15;
    const driftZ = this.time * (0.22 + this.lastSample.windZ * 0.1) + this.lastSample.windZ * 0.12;
    this.cloudScrollX = driftX; this.cloudScrollZ = driftZ;
    const fracX = ((driftX % cell) + cell) % cell;
    const fracZ = ((driftZ % cell) + cell) % cell;
    const floorDriftX = Math.floor(driftX / cell);
    const floorDriftZ = Math.floor(driftZ / cell);
    const baseIx = Math.floor(px / cell);
    const baseIz = Math.floor(pz / cell);
    const viewR = half * cell + cell * 2;
    this.cloudOcc.clear();
    this.cloudVoxels.length = 0;

    for (let iz = -half; iz <= half; iz++) {
      for (let ix = -half; ix <= half; ix++) {
        if (this.cloudVoxels.length >= this.maxCloudVoxels - 8) break;
        const gx = baseIx + ix, gz = baseIz + iz;
        const wx = gx * cell + cell * 0.5 - fracX;
        const wz = gz * cell + cell * 0.5 - fracZ;
        if (this.weatherCloudAt(wx, wz).cover > 0.2) continue;
        const nx = gx + floorDriftX, nz = gz + floorDriftZ;
        if (this.fairCloudNoise(nx, nz) <= 0.72) continue;
        if (hash2(nx, nz, this.seed + 2) <= 0.28) continue;
        this.cloudColor.setRGB(
          Math.min(1.15, (0.55 + 0.96 * 0.42) * (1 + flash * 0.35)),
          Math.min(1.15, (0.58 + 0.96 * 0.4) * (1 + flash * 0.35)),
          Math.min(1.2, (0.62 + 0.96 * 0.38) * (1 + flash * 0.4)),
        );
        this.queueCloudVoxel(wx, fairY, wz, nx, 0, nz, this.cloudColor);
      }
    }

    for (const wcell of this.cells) {
      if (wcell.kind === "clear") continue;
      if (Math.hypot(wcell.x - px, wcell.z - pz) > viewR + wcell.radius * 1.6) continue;
      const deckY = this.cloudDeckY(wcell);
      const bankR = wcell.radius * (wcell.kind === "storm" ? 1.5 : wcell.kind === "rain" ? 1.22 : 1.12);
      const iMax = Math.ceil(bankR / cell) + 1;
      for (let jz = -iMax; jz <= iMax; jz++) {
        for (let jx = -iMax; jx <= iMax; jx++) {
          if (this.cloudVoxels.length >= this.maxCloudVoxels - 3) break;
          const lx = jx * cell, lz = jz * cell;
          if (Math.hypot(lx, lz) > bankR) continue;
          const wx = wcell.x + lx, wz = wcell.z + lz;
          if (Math.hypot(wx - px, wz - pz) > viewR) continue;
          const zone = this.evaluateCell(wcell, wx, wz);
          const cover = Math.min(1.25,
            zone.core * (wcell.kind === "storm" ? 1.05 : wcell.kind === "rain" ? 0.75 : 0.4)
            + zone.rainBand * 0.55 * (wcell.kind === "storm" ? 0.9 : 0.7)
            + zone.front * 1.1
            + zone.inCell * 0.3 * (1 - zone.trailing) * 0.45);
          if (cover < 0.16) continue;
          const thresh = 0.55 - cover * 0.4 - zone.front * 0.2 - zone.core * 0.15;
          const n2 = hash2(jx + wcell.id * 17, jz - wcell.id * 3, this.seed + 11);
          let place = n2 > thresh;
          if (zone.front > 0.3 && cover > 0.35) place = n2 > 0.1;
          if (zone.core > 0.45) place = n2 > 0.14;
          if (zone.trailing > 0.2 && zone.front < 0.1) place = n2 > 0.45;
          if (!place) continue;
          const dark = wcell.kind === "storm"
            ? 0.35 + zone.core * 0.5 + zone.front * 0.25 + zone.rainBand * 0.15
            : wcell.kind === "rain" ? 0.2 + zone.rainBand * 0.3 + zone.front * 0.1
            : 0.1 + zone.inCell * 0.15;
          let layers = 1;
          if (wcell.kind === "storm") layers = 1 + Math.floor(zone.core * 2 + zone.front * 2);
          else if (wcell.kind === "rain" && zone.rainBand > 0.55) layers = 2;
          if (zone.core > 0.5) layers = Math.max(layers, 2);
          if (zone.front > 0.35) layers = Math.max(layers, 2);
          layers = Math.min(3, layers);
          const whiteness = 1 - Math.min(1, dark) * 0.85;
          this.cloudColor.setRGB(
            Math.min(1.15, (0.55 + whiteness * 0.42) * (1 + flash * 0.35)),
            Math.min(1.15, (0.58 + whiteness * 0.4) * (1 + flash * 0.35)),
            Math.min(1.2, (0.62 + whiteness * 0.38) * (1 + flash * 0.4)),
          );
          const idOff = wcell.id * 4096;
          for (let layer = 0; layer < layers; layer++) {
            this.queueCloudVoxel(wx, deckY + layer * this.cloudLayerStep, wz,
              idOff + jx, 100 + wcell.id * 8 + layer, idOff + jz, this.cloudColor);
          }
        }
      }
    }
    this.rebuildCloudMesh();
  }

  private updateRain(dt: number, world: World, px: number, py: number, pz: number, local: WeatherSample): void {
    const rainAmt = local.rain;
    const storm = local.storm;
    // Core of a storm: near-max particles; light rain stays sparse
    const density = Math.min(
      1,
      rainAmt * 0.55 + storm * 0.95 + rainAmt * storm * 0.5,
    );
    const want =
      density > 0.04 ? Math.floor(this.maxRain * Math.min(1, density * 1.05)) : 0;
    const windMul = 0.85 + local.windSpeed * 0.4 + storm * 0.35;
    const spread = 22 + storm * 18 + rainAmt * 8;
    const streakBase = 0.28 + rainAmt * 0.35 + storm * 1.15; // much longer in core

    let active = 0;
    for (const d of this.rain) if (d.active) active++;
    // Burst-spawn hard in storms so the sheet fills quickly
    const spawnBudget = Math.min(
      want - active,
      18 + Math.floor(rainAmt * 35 + storm * 90),
    );
    for (let s = 0; s < spawnBudget; s++) {
      const drop = this.rain.find((r) => !r.active);
      if (!drop) break;
      drop.x = px + (Math.random() - 0.5) * spread;
      drop.z = pz + (Math.random() - 0.5) * spread;
      const cloudCeil = this.fairCloudDeckY() - 6;
      const top = Math.min(cloudCeil, py + 16 + storm * 6);
      const bot = Math.min(top - 2, py + 5);
      drop.y = bot + Math.random() * Math.max(1, top - bot);
      drop.vx =
        local.windX * windMul * (0.75 + storm * 0.35) +
        (Math.random() - 0.5) * (0.3 + storm * 0.4);
      drop.vz =
        local.windZ * windMul * (0.75 + storm * 0.35) +
        (Math.random() - 0.5) * (0.3 + storm * 0.4);
      // Faster fall in storm core → longer visual streaks
      drop.vy =
        -14 -
        Math.random() * 6 -
        storm * 10 -
        rainAmt * 3 -
        local.windSpeed * 0.35;
      drop.life = 1.0 + Math.random() * 0.7 + storm * 0.25;
      drop.maxLife = drop.life;
      drop.bouncing = false;
      drop.active = true;
    }

    let ri = 0;
    for (const d of this.rain) {
      if (!d.active) continue;
      d.life -= dt;
      if (d.life <= 0) {
        d.active = false;
        continue;
      }
      if (!d.bouncing) {
        d.vx += local.windX * (1.4 + storm * 0.8) * dt;
        d.vz += local.windZ * (1.4 + storm * 0.8) * dt;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.z += d.vz * dt;
        const surface = world.getSurfaceY(Math.floor(d.x), Math.floor(d.z));
        if (d.y <= surface + 0.05) {
          d.y = surface + 0.02;
          this.spawnSplash(d.x, surface + 0.05, d.z, d.vx, d.vz, storm);
          if (Math.random() < 0.45 + storm * 0.15) {
            d.bouncing = true;
            d.vy = 1.6 + Math.random() * 2.2;
            d.vx *= 0.35;
            d.vz *= 0.35;
            d.life = 0.2 + Math.random() * 0.18;
          } else {
            d.active = false;
            continue;
          }
        }
        if (
          d.y < py - 22 ||
          Math.hypot(d.x - px, d.z - pz) > spread * 0.95
        ) {
          d.active = false;
          continue;
        }
      } else {
        d.vy -= 18 * dt;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.z += d.vz * dt;
        const surface = world.getSurfaceY(Math.floor(d.x), Math.floor(d.z));
        if (d.y <= surface) {
          this.spawnSplash(d.x, surface + 0.04, d.z, d.vx * 0.5, d.vz * 0.5, storm);
          d.active = false;
          continue;
        }
      }

      // Streak: head at drop, tail opposite velocity
      const spd = Math.hypot(d.vx, d.vy, d.vz) || 1;
      const len =
        streakBase *
        (0.55 + Math.min(1.4, spd / 22)) *
        (d.bouncing ? 0.25 : 1);
      const tx = (d.vx / spd) * len;
      const ty = (d.vy / spd) * len;
      const tz = (d.vz / spd) * len;
      const i = ri * 6;
      this.rainPositions[i] = d.x;
      this.rainPositions[i + 1] = d.y;
      this.rainPositions[i + 2] = d.z;
      this.rainPositions[i + 3] = d.x - tx;
      this.rainPositions[i + 4] = d.y - ty;
      this.rainPositions[i + 5] = d.z - tz;
      ri++;
    }
    // Hide unused segments
    for (let i = ri; i < this.maxRain; i++) {
      const j = i * 6;
      this.rainPositions[j + 1] = -999;
      this.rainPositions[j + 4] = -999;
    }
    this.rainGeom.setDrawRange(0, ri * 2);
    this.rainGeom.attributes.position!.needsUpdate = true;
    this.rainLines.visible = ri > 0 && rainAmt > 0.03;
    const mat = this.rainLines.material as THREE.LineBasicMaterial;
    mat.opacity = 0.28 + Math.min(0.55, rainAmt * 0.35 + storm * 0.4);

    let si = 0;
    for (const sp of this.splashes) {
      if (!sp.active) continue;
      sp.life -= dt;
      sp.vy -= 22 * dt;
      sp.x += sp.vx * dt;
      sp.y += sp.vy * dt;
      sp.z += sp.vz * dt;
      if (sp.life <= 0 || sp.y < py - 5) {
        sp.active = false;
        continue;
      }
      this.splashPositions[si * 3] = sp.x;
      this.splashPositions[si * 3 + 1] = sp.y;
      this.splashPositions[si * 3 + 2] = sp.z;
      si++;
    }
    for (let i = si; i < this.maxSplash; i++) this.splashPositions[i * 3 + 1] = -999;
    this.splashGeom.setDrawRange(0, si);
    this.splashGeom.attributes.position!.needsUpdate = true;
    this.splashPoints.visible = si > 0;
  }

  private spawnSplash(
    x: number,
    y: number,
    z: number,
    vx: number,
    vz: number,
    storm = 0,
  ): void {
    const n = 2 + Math.floor(Math.random() * 3) + (storm > 0.5 ? 2 : 0);
    for (let i = 0; i < n; i++) {
      const sp = this.splashes.find((s) => !s.active);
      if (!sp) return;
      sp.active = true;
      sp.x = x + (Math.random() - 0.5) * 0.12;
      sp.y = y;
      sp.z = z + (Math.random() - 0.5) * 0.12;
      sp.vx = vx * 0.2 + (Math.random() - 0.5) * (1.8 + storm * 1.2);
      sp.vz = vz * 0.2 + (Math.random() - 0.5) * (1.8 + storm * 1.2);
      sp.vy = 2.5 + Math.random() * 3.5 + storm * 1.5;
      sp.life = 0.2 + Math.random() * 0.25;
    }
  }

  private strike(cell: WeatherCell, world: World, px: number, py: number, pz: number): void {
    const coreR = Math.max(4, cell.radius * Math.min(0.4, cell.core));
    const spd = Math.hypot(cell.vx, cell.vz) || 1;
    let sx: number, sz: number;
    if (Math.random() < 0.58) {
      const ang = Math.random() * Math.PI * 2;
      const r = Math.random() * coreR * 0.82;
      sx = cell.x + Math.cos(ang) * r; sz = cell.z + Math.sin(ang) * r;
    } else {
      const base = Math.atan2(cell.vx / spd, cell.vz / spd);
      const ang = base + (Math.random() - 0.5) * 1.1;
      const r = coreR * 0.75 + Math.random() * (cell.radius - coreR) * 0.55;
      sx = cell.x + Math.sin(ang) * r; sz = cell.z + Math.cos(ang) * r;
    }
    const ground = world.getSurfaceY(Math.floor(sx), Math.floor(sz));
    const top = Math.min(CHUNK_HEIGHT - 2, ground + 28 + Math.random() * 18);
    const zone = this.evaluateCell(cell, sx, sz);
    if (zone.core < 0.12 && zone.front < 0.18) { void py; return; }

    const dist = Math.hypot(sx - px, sz - pz);
    const prox = this.flashProximity(dist);
    const structure = Math.min(1, zone.core * 1.1 + zone.front * 0.75);
    const strength = prox * structure * (0.5 + 0.5 * cell.intensity);

    if (dist < 110) {
      const pts: THREE.Vector3[] = [];
      const segs = 10 + Math.floor(Math.random() * 6);
      let x = sx + (Math.random() - 0.5) * 2, z = sz + (Math.random() - 0.5) * 2;
      for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        const y = top + (ground - top) * t;
        if (i > 0 && i < segs) { x += (Math.random() - 0.5) * 2.2; z += (Math.random() - 0.5) * 2.2; }
        else if (i === segs) { x = sx; z = sz; }
        pts.push(new THREE.Vector3(x, y, z));
        if (i > 2 && i < segs - 2 && Math.random() < 0.25) {
          pts.push(new THREE.Vector3(x + (Math.random() - 0.5) * 4, y - 2 - Math.random() * 4, z + (Math.random() - 0.5) * 4));
          pts.push(new THREE.Vector3(x, y, z));
        }
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineBasicMaterial({
        color: 0xf0f6ff, transparent: true, opacity: 0.35 + 0.65 * Math.min(1, prox + 0.25),
        depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Line(geo, mat);
      mesh.renderOrder = 5; this.group.add(mesh);
      this.bolts.push({ mesh, life: 0.14 + Math.random() * 0.08 });
    }

    if (strength > 0.08) {
      this.triggerLocalFlash(sx, ground + 20, sz, strength);
      this.onLightning?.({ dist, strength, x: sx, y: ground + 20, z: sz });
      if (Math.random() < 0.3 && prox > 0.4 && zone.core > 0.25) {
        const delay = 90 + Math.random() * 140;
        const sx2 = sx, sz2 = sz, g = ground, s2 = strength * 0.38;
        window.setTimeout(() => {
          this.triggerLocalFlash(sx2 + (Math.random() - 0.5) * 10, g + 24, sz2 + (Math.random() - 0.5) * 10, s2);
        }, delay);
      }
    }
    // Distant thunder even when visual flash is weak
    else if (dist < 140 && zone.core + zone.front > 0.15) {
      this.onLightning?.({
        dist,
        strength: Math.max(0.15, structure * 0.35 * cell.intensity),
        x: sx,
        y: ground + 24,
        z: sz,
      });
    }
    void py;
  }

  private updateBolts(dt: number): void {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i]!;
      b.life -= dt;
      const mat = b.mesh.material as THREE.LineBasicMaterial;
      mat.opacity = Math.max(0, b.life * 7);
      if (b.life <= 0) {
        this.group.remove(b.mesh); b.mesh.geometry.dispose(); mat.dispose();
        this.bolts.splice(i, 1);
      }
    }
  }

  dispose(): void {
    for (const b of this.bolts) {
      this.group.remove(b.mesh); b.mesh.geometry.dispose(); (b.mesh.material as THREE.Material).dispose();
    }
    this.bolts = [];
    this.scene.remove(this.flashMain); this.scene.remove(this.flashMain.target);
    this.scene.remove(this.flashFill); this.scene.remove(this.flashFill.target);
    this.scene.remove(this.flashAmbient);
    this.flashMain.dispose(); this.flashFill.dispose(); this.flashAmbient.dispose();
    for (const pl of this.flashPoints) { this.scene.remove(pl); pl.dispose(); }
    this.flashPoints = [];
    this.group.remove(this.cloudMesh);
    this.cloudGeom.dispose();
    this.cloudMat.dispose();
    this.rainGeom.dispose(); (this.rainLines.material as THREE.Material).dispose();
    this.splashGeom.dispose(); (this.splashPoints.material as THREE.Material).dispose();
    this.scene.remove(this.group);
  }
}
