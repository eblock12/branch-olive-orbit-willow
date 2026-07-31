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
  t: number; duration: number; peak: number;
  sx: number; sy: number; sz: number;
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
  float sway = sin(phase) * wind * gustMul;
  float sway2 = cos(phase * 1.37 + 1.7) * wind * gustMul;
  vec2 wDir = wLen > 0.001 ? uWind / wLen : vec2(0.2, 0.1);
  transformed.x += wDir.x * sway * amp + sway2 * amp * 0.16;
  transformed.z += wDir.y * sway * amp + sway * amp * 0.12;
  transformed.y += sway2 * amp * (0.035 + wLen * 0.01) * wind;
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
  material.customProgramCacheKey = () => "block-leaf-wind-v6";
  material.onBeforeCompile = (shader) => {
    injectWindIntoShader(shader);
  };

  // Depth material is attached to each Mesh (not Material) in world.remeshChunk
  const depthMat = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    alphaTest: material.alphaTest > 0 ? material.alphaTest : 0.5,
  });
  depthMat.customProgramCacheKey = () => "block-leaf-wind-depth-v6";
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
  private readonly cloudHalf = 26;
  private readonly maxCloudVoxels = 4200;
  private cloudColor = new THREE.Color();
  private cloudOcc = new Set<string>();
  private cloudVoxels: {
    x: number; y: number; z: number;
    qx: number; qy: number; qz: number;
    r: number; g: number; b: number;
  }[] = [];

  private rain: RainDrop[] = [];
  private splashes: Splash[] = [];
  private rainPositions: Float32Array;
  private rainGeom: THREE.BufferGeometry;
  private rainPoints: THREE.Points;
  private splashPositions: Float32Array;
  private splashGeom: THREE.BufferGeometry;
  private splashPoints: THREE.Points;
  private readonly maxRain = 900;
  private readonly maxSplash = 350;

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

    this.rainPositions = new Float32Array(this.maxRain * 3);
    this.rainGeom = new THREE.BufferGeometry();
    this.rainGeom.setAttribute("position", new THREE.BufferAttribute(this.rainPositions, 3));
    this.rainPoints = new THREE.Points(this.rainGeom, new THREE.PointsMaterial({
      color: 0xd0e4f5, size: 0.045, transparent: true, opacity: 0.5,
      depthWrite: false, sizeAttenuation: true, fog: true,
    }));
    this.rainPoints.frustumCulled = false; this.rainPoints.renderOrder = 1;
    this.group.add(this.rainPoints);
    for (let i = 0; i < this.maxRain; i++) {
      this.rain.push({ x:0,y:0,z:0,vx:0,vy:0,vz:0,life:0,maxLife:1,bouncing:false,active:false });
    }

    this.splashPositions = new Float32Array(this.maxSplash * 3);
    this.splashGeom = new THREE.BufferGeometry();
    this.splashGeom.setAttribute("position", new THREE.BufferAttribute(this.splashPositions, 3));
    this.splashPoints = new THREE.Points(this.splashGeom, new THREE.PointsMaterial({
      color: 0xd8e8f4, size: 0.04, transparent: true, opacity: 0.55,
      depthWrite: false, sizeAttenuation: true, fog: true,
    }));
    this.splashPoints.frustumCulled = false;
    this.group.add(this.splashPoints);
    for (let i = 0; i < this.maxSplash; i++) {
      this.splashes.push({ x:0,y:0,z:0,vx:0,vy:0,vz:0,life:0,active:false });
    }

    this.cells.push(this.makeCell(8, 12, "rain", 0.75, 32));
    this.cells.push(this.makeCell(-40, 25, "storm", 0.95, 38));
    this.cells.push(this.makeCell(55, -30, "storm", 0.8, 34));
    this.cells.push(this.makeCell(20, 70, "overcast", 0.55, 42));
    this.cells.push(this.makeCell(-70, -40, "rain", 0.6, 28));
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

  /** Stable altitude plane so overlapping systems don't z-fight in one sheet. */
  private cloudDeckY(cell: WeatherCell): number {
    const kindBias =
      cell.kind === "storm" ? 5.5 :
      cell.kind === "rain" ? 1.5 :
      cell.kind === "overcast" ? -2.5 : 0;
    const lane = ((cell.id * 7 + 3) % 5) - 2; // -2..+2
    return this.cloudY + kindBias + lane * this.cloudDeckGap;
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

  private makeCell(x: number, z: number, kind: WeatherKind, intensity: number, radius: number): WeatherCell {
    const ang = Math.random() * Math.PI * 2;
    const spd = kind === "storm" ? 0.7 + Math.random() * 0.45 : 0.5 + Math.random() * 0.7;
    return {
      id: nextCellId++, x, z, radius,
      core: kind === "storm" ? 0.36 : kind === "rain" ? 0.52 : 0.5,
      kind, intensity,
      vx: Math.cos(ang) * spd, vz: Math.sin(ang) * spd,
      age: 0, life: 90 + Math.random() * 180,
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
      cell.vx += Math.sin(this.time * 0.2 + cell.id) * 0.06 * dt;
      cell.vz += Math.cos(this.time * 0.17 + cell.id * 2) * 0.06 * dt;
      const spd = Math.hypot(cell.vx, cell.vz);
      const maxSpd = cell.kind === "storm" ? 1.4 : 1.1;
      if (spd > maxSpd) { cell.vx = (cell.vx / spd) * maxSpd; cell.vz = (cell.vz / spd) * maxSpd; }
      const dx = cell.x - px, dz = cell.z - pz, dist = Math.hypot(dx, dz);
      if (dist > 160) {
        cell.x = px - (dx / dist) * (90 + Math.random() * 40);
        cell.z = pz - (dz / dist) * (90 + Math.random() * 40);
      }
      if (cell.kind === "storm") {
        cell.nextStrike -= dt;
        if (cell.nextStrike <= 0) {
          this.strike(cell, world, px, py, pz);
          cell.nextStrike = 2.5 + Math.random() * 6 * (1.2 - cell.intensity);
        }
      }
    }

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 18 + Math.random() * 25;
      if (this.cells.length < 6) {
        const ang = Math.random() * Math.PI * 2;
        const dist = 50 + Math.random() * 70;
        const roll = Math.random();
        const kind: WeatherKind = roll < 0.2 ? "storm" : roll < 0.5 ? "rain" : roll < 0.75 ? "overcast" : "clear";
        this.cells.push(this.makeCell(px + Math.cos(ang) * dist, pz + Math.sin(ang) * dist, kind, 0.45 + Math.random() * 0.5, 22 + Math.random() * 28));
      }
      this.cells = this.cells.filter((c) => c.age < c.life || c.kind === "storm");
      if (this.cells.length > 7) this.cells.length = 7;
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
    this.flashPulses.push(
      { t: 0.04, duration: 0.04, peak: 0.7 * s, sx: strikeX, sy: strikeY, sz: strikeZ },
      { t: 0.1, duration: 0.07, peak: 0.08 * s, sx: strikeX, sy: strikeY, sz: strikeZ },
      { t: 0.055, duration: 0.055, peak: 0.45 * s, sx: strikeX, sy: strikeY, sz: strikeZ },
    );
    const pl = new THREE.PointLight(0xd0e0ff, 0, 42, 2);
    pl.position.set(strikeX, strikeY + 6, strikeZ);
    this.scene.add(pl);
    this.flashPoints.push(pl);
    window.setTimeout(() => {
      this.scene.remove(pl); pl.dispose();
      const idx = this.flashPoints.indexOf(pl);
      if (idx >= 0) this.flashPoints.splice(idx, 1);
    }, 280);
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
    let mainI = 0, fillI = 0, ambI = 0, skyFlash = 0, pointI = 0;
    for (let i = this.flashPulses.length - 1; i >= 0; i--) {
      const p = this.flashPulses[i]!;
      p.t -= dt;
      const u = 1 - Math.max(0, p.t) / p.duration;
      const envelope = u < 0.12 ? u / 0.12 : 1 - (u - 0.12) / 0.88;
      const e = Math.max(0, envelope) * p.peak;
      const prox = this.flashProximity(Math.hypot(p.sx - px, p.sz - pz));
      if (prox <= 0.001) { if (p.t <= 0) this.flashPulses.splice(i, 1); continue; }
      mainI = Math.max(mainI, e * 1.35 * prox);
      fillI = Math.max(fillI, e * 0.45 * prox);
      ambI = Math.max(ambI, e * 0.22 * prox);
      skyFlash = Math.max(skyFlash, e * 0.4 * prox);
      pointI = Math.max(pointI, e * 18 * prox);
      if (p.t <= 0) this.flashPulses.splice(i, 1);
      else this.aimFlashLights(p.sx, p.sy, p.sz, px, py, pz);
    }
    this.flashMain.intensity = mainI;
    this.flashFill.intensity = fillI;
    this.flashAmbient.intensity = ambI;
    this.flashAmount = skyFlash;
    for (const pl of this.flashPoints) pl.intensity = pointI;
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
    this.fog.near = Math.max(8, 36 - peak * 12 - aerosolFog * 0.25 + f * 4);
    this.fog.far = Math.max(
      this.fog.near + 35,
      130 - peak * 40 - aerosolFog + f * 18,
    );

    // Key light owned by DayNight — only pass dimming factors
    const weatherDim = Math.max(
      0.55,
      1 - localGrey * 0.35 - Math.max(0, approach - 0.5) * 0.15 - totalMie * 0.1,
    );
    if (dn) {
      dn.weatherDim = weatherDim;
      dn.weatherFlash = f;
    }

    const ambMul = Math.max(
      0.55,
      1 - localGrey * 0.28 - Math.max(0, approach - 0.55) * 0.12,
    );
    this.ambient.intensity = Math.max(
      0.12,
      Math.min(
        0.32,
        (dn?.ambientIntensity ?? this.baseAmbientIntensity) * ambMul +
          totalMie * 0.03,
      ),
    );
    if (dn) {
      this.ambient.color.setRGB(
        0.55 + dn.dayFactor * 0.28 - localGrey * 0.08 + totalMie * 0.05,
        0.62 + dn.dayFactor * 0.22 - localGrey * 0.06 + totalMie * 0.04,
        0.78 + dn.dayFactor * 0.12,
      );
    } else {
      this.ambient.color.setRGB(0.58, 0.68, 0.82);
    }

    const hemiMul = Math.max(0.5, 1 - localGrey * 0.28);
    this.hemi.intensity = Math.max(
      0.08,
      Math.min(
        0.28,
        (dn?.hemiIntensity ?? this.baseHemiIntensity) * hemiMul + totalMie * 0.03,
      ),
    );
    if (dn) {
      this.hemi.color.copy(dn.hemiSky);
      this.hemi.groundColor.copy(dn.hemiGround);
      if (localGrey > 0.35) {
        this.hemi.color.lerp(new THREE.Color(0x6a7a98), localGrey * 0.5);
        this.hemi.groundColor.lerp(new THREE.Color(0x2a3428), localGrey * 0.4);
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
    const want = rainAmt > 0.05 ? Math.floor(this.maxRain * Math.min(1, rainAmt * 1.1)) : 0;
    const windMul = 0.85 + local.windSpeed * 0.35;
    let active = 0;
    for (const d of this.rain) if (d.active) active++;
    const toSpawn = Math.min(40, want - active);
    for (let s = 0; s < toSpawn; s++) {
      const drop = this.rain.find((r) => !r.active);
      if (!drop) break;
      drop.x = px + (Math.random() - 0.5) * 28;
      drop.z = pz + (Math.random() - 0.5) * 28;
      const cloudCeil = this.fairCloudDeckY() - 6;
      const top = Math.min(cloudCeil, py + 14);
      const bot = Math.min(top - 2, py + 6);
      drop.y = bot + Math.random() * Math.max(1, top - bot);
      drop.vx = local.windX * windMul * 0.7 + (Math.random() - 0.5) * 0.25;
      drop.vz = local.windZ * windMul * 0.7 + (Math.random() - 0.5) * 0.25;
      drop.vy = -12 - Math.random() * 5 - local.storm * 3 - local.windSpeed * 0.25;
      drop.life = 1.2 + Math.random() * 0.6;
      drop.maxLife = drop.life; drop.bouncing = false; drop.active = true;
    }

    let ri = 0;
    for (const d of this.rain) {
      if (!d.active) continue;
      d.life -= dt;
      if (d.life <= 0) { d.active = false; continue; }
      if (!d.bouncing) {
        d.vx += local.windX * 1.4 * dt; d.vz += local.windZ * 1.4 * dt;
        d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
        const surface = world.getSurfaceY(Math.floor(d.x), Math.floor(d.z));
        if (d.y <= surface + 0.05) {
          d.y = surface + 0.02;
          this.spawnSplash(d.x, surface + 0.05, d.z, d.vx, d.vz);
          if (Math.random() < 0.55) {
            d.bouncing = true; d.vy = 1.8 + Math.random() * 2.5; d.vx *= 0.4; d.vz *= 0.4;
            d.life = 0.25 + Math.random() * 0.2;
          } else { d.active = false; continue; }
        }
        if (d.y < py - 20 || Math.hypot(d.x - px, d.z - pz) > 22) { d.active = false; continue; }
      } else {
        d.vy -= 18 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
        const surface = world.getSurfaceY(Math.floor(d.x), Math.floor(d.z));
        if (d.y <= surface) {
          this.spawnSplash(d.x, surface + 0.04, d.z, d.vx * 0.5, d.vz * 0.5);
          d.active = false; continue;
        }
      }
      this.rainPositions[ri * 3] = d.x;
      this.rainPositions[ri * 3 + 1] = d.y;
      this.rainPositions[ri * 3 + 2] = d.z;
      ri++;
    }
    for (let i = ri; i < this.maxRain; i++) this.rainPositions[i * 3 + 1] = -999;
    this.rainGeom.setDrawRange(0, ri);
    this.rainGeom.attributes.position!.needsUpdate = true;
    this.rainPoints.visible = ri > 0 && rainAmt > 0.04;
    (this.rainPoints.material as THREE.PointsMaterial).opacity = 0.3 + Math.min(0.4, rainAmt * 0.45);

    let si = 0;
    for (const sp of this.splashes) {
      if (!sp.active) continue;
      sp.life -= dt; sp.vy -= 22 * dt;
      sp.x += sp.vx * dt; sp.y += sp.vy * dt; sp.z += sp.vz * dt;
      if (sp.life <= 0 || sp.y < py - 5) { sp.active = false; continue; }
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

  private spawnSplash(x: number, y: number, z: number, vx: number, vz: number): void {
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const sp = this.splashes.find((s) => !s.active);
      if (!sp) return;
      sp.active = true;
      sp.x = x + (Math.random() - 0.5) * 0.1; sp.y = y; sp.z = z + (Math.random() - 0.5) * 0.1;
      sp.vx = vx * 0.2 + (Math.random() - 0.5) * 1.8;
      sp.vz = vz * 0.2 + (Math.random() - 0.5) * 1.8;
      sp.vy = 2.5 + Math.random() * 3.5;
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
      if (Math.random() < 0.3 && prox > 0.4 && zone.core > 0.25) {
        const delay = 90 + Math.random() * 140;
        const sx2 = sx, sz2 = sz, g = ground, s2 = strength * 0.38;
        window.setTimeout(() => {
          this.triggerLocalFlash(sx2 + (Math.random() - 0.5) * 10, g + 24, sz2 + (Math.random() - 0.5) * 10, s2);
        }, delay);
      }
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
    this.rainGeom.dispose(); (this.rainPoints.material as THREE.Material).dispose();
    this.splashGeom.dispose(); (this.splashPoints.material as THREE.Material).dispose();
    this.scene.remove(this.group);
  }
}
