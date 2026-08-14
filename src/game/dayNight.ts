import * as THREE from "three";

/** Full cycle: 15 min day + 15 min night */
export const DAY_LENGTH_SEC = 900;
export const NIGHT_LENGTH_SEC = 900;
export const CYCLE_LENGTH_SEC = DAY_LENGTH_SEC + NIGHT_LENGTH_SEC;

/**
 * Baseline aerosol turbidity (Preetham-style scale).
 * 1 ≈ very clear alpine, 2–3 typical clear day, 5+ hazy / humid.
 */
export const AEROSOL_BASE_TURBIDITY = 2.15;

export type DayNightSample = {
  /** 0..1 through full cycle (0 = dawn) */
  phase: number;
  /** Seconds into cycle */
  timeOfDay: number;
  /** Sun elevation -1..1 (sin of orbital angle) */
  sunElevation: number;
  /** 1 fully day, 0 fully night */
  dayFactor: number;
  /** 1 fully night, 0 fully day */
  nightFactor: number;
  sunDir: THREE.Vector3;
  moonDir: THREE.Vector3;
  /** Rayleigh + Mie composite sky (pre-weather) */
  sky: THREE.Color;
  fog: THREE.Color;
  sunColor: THREE.Color;
  moonColor: THREE.Color;
  sunIntensity: number;
  moonIntensity: number;
  ambientIntensity: number;
  hemiIntensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  /**
   * Aerosol optical load used for this sample (turbidity-like).
   * Weather may raise this further when mixing storms / humidity.
   */
  aerosol: number;
  /** 0..1 milky Mie haze amount in the sky composite */
  mieHaze: number;
  weatherDim: number;
  weatherFlash: number;
};

export type AtmosphereSample = {
  sky: THREE.Color;
  fog: THREE.Color;
  sunColor: THREE.Color;
  aerosol: number;
  mieHaze: number;
  weatherDim: number;
  weatherFlash: number;
};

/**
 * Molecular (Rayleigh) scattering — strongly wavelength-dependent.
 * Shorter wavelengths (blue) scatter more → clear zenith blue.
 */
function rayleighContribution(
  airMass: number,
  elev: number,
  out: { r: number; g: number; b: number },
): void {
  // βR ratios roughly ~ λ^-4 : blue >> green > red
  const r = 0.18 + Math.exp(-0.2 * airMass) * 0.38;
  const g = 0.38 + Math.exp(-0.42 * airMass) * 0.4;
  const b = 0.7 + Math.exp(-0.9 * airMass) * 0.28;

  // Zenith saturation toward pure azure
  const zen = THREE.MathUtils.smoothstep(elev, 0.1, 0.75);
  out.r = THREE.MathUtils.lerp(r, 0.28, zen * 0.55);
  out.g = THREE.MathUtils.lerp(g, 0.6, zen * 0.65);
  out.b = THREE.MathUtils.lerp(b, 0.98, zen * 0.85);
}

/**
 * Aerosol (Mie) scattering — weakly wavelength-dependent, forward-peaked.
 * Looks milky / warm white; dominates near the sun and along long paths
 * (horizon), and grows with turbidity (dust, humidity, pollution, smoke).
 *
 * Simplified Henyey–Greenstein / Preetham turbidity ideas for a flat sky color:
 * we don't have a view-dependent dome, so we bake a zenith-vs-horizon blend
 * into a single background color + fog tint.
 */
function mieAerosolContribution(
  airMass: number,
  elev: number,
  turbidity: number,
  out: { r: number; g: number; b: number; haze: number },
): void {
  // Turbidity T: optical thickness of aerosols (Preetham uses ~2–10)
  const T = THREE.MathUtils.clamp(turbidity, 1.2, 9);

  // Mie extinction grows with path length and T
  // βM ~ T (nearly grey / slightly warm)
  const path = Math.min(6, airMass * (0.55 + T * 0.18));
  const optical = 1 - Math.exp(-path * 0.35);

  // Slightly warm aerosol albedo (dust / organic haze), not pure white
  // Higher T → browner / more desert-dust; low T → soft white haze
  const dust = THREE.MathUtils.smoothstep(T, 2.2, 6.5);
  const ar = THREE.MathUtils.lerp(0.92, 0.78, dust);
  const ag = THREE.MathUtils.lerp(0.94, 0.72, dust);
  const ab = THREE.MathUtils.lerp(0.98, 0.62, dust);

  // Horizon bias: Mie is much more visible on long paths (low elev)
  const horizon = 1 - THREE.MathUtils.smoothstep(elev, 0.05, 0.55);
  // Forward scatter glow when sun is up (halo washes the sky slightly)
  const sunGlow =
    elev > 0
      ? THREE.MathUtils.smoothstep(elev, 0, 0.35) *
        (0.25 + 0.35 * THREE.MathUtils.clamp(1.2 - elev, 0, 1))
      : 0;

  const haze = THREE.MathUtils.clamp(
    optical * (0.35 + horizon * 0.55 + sunGlow * 0.35) * ((T - 1) / 5),
    0,
    0.85,
  );

  out.r = ar;
  out.g = ag;
  out.b = ab;
  out.haze = haze;
}

/**
 * Composite clear-atmosphere sky: Rayleigh molecules + Mie aerosols.
 * @param turbidity  Preetham-like aerosol load (base ~2.2 clear day)
 */
export function atmosphereSkyColor(
  sunElevation: number,
  turbidity: number,
  outSky: THREE.Color,
  outFog: THREE.Color,
  outSun: THREE.Color,
): { aerosol: number; mieHaze: number } {
  const h = THREE.MathUtils.clamp(sunElevation, -0.35, 1);
  // Relative optical air mass (Rozenberg / Young approx-ish)
  const airMass = 1 / Math.max(0.07, h + 0.15 * Math.exp(-h * 2.5) + 0.12);

  const T = THREE.MathUtils.clamp(turbidity, 1.2, 9);
  const ray = { r: 0, g: 0, b: 0 };
  const mie = { r: 0, g: 0, b: 0, haze: 0 };
  rayleighContribution(airMass, Math.max(0, h), ray);
  mieAerosolContribution(airMass, Math.max(0, h), T, mie);

  // Mix: haze pulls sky toward aerosol color without killing zenith blue
  // Cap clear-day haze so midday stays blue (T~2 → mild horizon only)
  const haze = mie.haze;
  let r = THREE.MathUtils.lerp(ray.r, mie.r, haze * 0.75);
  let g = THREE.MathUtils.lerp(ray.g, mie.g, haze * 0.7);
  let b = THREE.MathUtils.lerp(ray.b, mie.b, haze * 0.65);

  // Golden hour: Rayleigh path + warm aerosols reinforce each other
  if (h > -0.08 && h < 0.3) {
    const s = 1 - Math.abs(h - 0.05) / 0.3;
    const w = s * s * (0.55 + haze * 0.45);
    r = Math.min(1.3, r + w * 0.5);
    g = Math.min(1.05, g + w * 0.16);
    b = Math.max(0.15, b - w * 0.2);
  }

  // Night — residual aerosol glow dies with sun
  if (h < 0.06) {
    // GLSL-style smoothstep(0.06, -0.28, h) → Three: 1 - smoothstep(h, -0.28, 0.06)
    const n = 1 - THREE.MathUtils.smoothstep(h, -0.28, 0.06);
    r = THREE.MathUtils.lerp(r, 0.012, n);
    g = THREE.MathUtils.lerp(g, 0.025, n);
    b = THREE.MathUtils.lerp(b, 0.07, n);
  }

  outSky.setRGB(
    THREE.MathUtils.clamp(r, 0, 1.3),
    THREE.MathUtils.clamp(g, 0, 1.15),
    THREE.MathUtils.clamp(b, 0, 1.2),
  );

  // Fog: more aerosol → milkier, shorter range horizon
  // Fog color = blend of sky and warm Mie (aerial perspective)
  outFog.copy(outSky);
  outFog.r = THREE.MathUtils.lerp(outFog.r, mie.r, 0.25 + haze * 0.35);
  outFog.g = THREE.MathUtils.lerp(outFog.g, mie.g, 0.22 + haze * 0.3);
  outFog.b = THREE.MathUtils.lerp(outFog.b, mie.b, 0.18 + haze * 0.25);
  // Day fill so fog isn't pure sky blue (classic aerial perspective white-blue)
  if (h > 0.1) {
    outFog.lerp(new THREE.Color(0xc8dce8), 0.12 + haze * 0.2);
  }
  if (h < 0) {
    outFog.lerp(new THREE.Color(0x0a1020), Math.min(1, -h * 1.5));
  }

  // Sun disc color through aerosol path (reddens with air mass + T)
  const sunRedden = Math.min(1, (airMass - 1) * 0.12 + (T - 2) * 0.04);
  outSun.setRGB(
    1,
    THREE.MathUtils.clamp(0.96 - sunRedden * 0.35, 0.45, 1),
    THREE.MathUtils.clamp(0.88 - sunRedden * 0.55, 0.25, 1),
  );

  return { aerosol: T, mieHaze: haze };
}

/** @deprecated use atmosphereSkyColor — kept as thin wrapper for clarity */
export function rayleighSkyColor(sunElevation: number, out: THREE.Color): void {
  const fog = new THREE.Color();
  const sun = new THREE.Color();
  atmosphereSkyColor(sunElevation, AEROSOL_BASE_TURBIDITY, out, fog, sun);
}

export class DayNightCycle {
  // High noon is phase 0.25; start ~10° of sky-arc past that (afternoon slant)
  private time = CYCLE_LENGTH_SEC * (0.25 + 10 / 360);

  /**
   * Key DirectionalLight used for BOTH day and night.
   * Parallel rays → shadow *angle* is fixed in world space (only the
   * coverage window follows the player). SpotLight previously followed
   * the player as a point source, so walking changed every shadow angle.
   */
  private readonly keyLight: THREE.DirectionalLight;
  /**
   * Unshadowed global fill (Directional) — keeps terrain outside the
   * shadow map from going pitch-dark. Color/dir match the key light.
   */
  private readonly fillLight: THREE.DirectionalLight;
  private readonly sunBillboard: THREE.Mesh;
  private readonly moonBillboard: THREE.Mesh;
  private readonly group = new THREE.Group();
  private readonly tmpSun = new THREE.Vector3();
  private readonly tmpMoon = new THREE.Vector3();
  private readonly tmpShadowDir = new THREE.Vector3();
  private readonly tmpLook = new THREE.Vector3();
  private readonly tmpRight = new THREE.Vector3();
  private readonly tmpUp = new THREE.Vector3();
  private readonly tmpCenter = new THREE.Vector3();
  private readonly tmpFog = new THREE.Color();

  private readonly tmpSunCol = new THREE.Color();
  private readonly sample: DayNightSample;
  /** Slowly varying background aerosol (dust days vs clean) */
  private baseTurbidity = AEROSOL_BASE_TURBIDITY;
  private turbidityDrift = 0;
  private _aimX = 0;
  private _aimY = 20;
  private _aimZ = 0;

  constructor(scene: THREE.Scene, existingSun?: THREE.Light) {
    // Disable engine placeholder sun if provided — we own the real key light
    if (existingSun) {
      existingSun.castShadow = false;
      existingSun.intensity = 0;
      existingSun.visible = false;
    }

    // Directional shadows: parallel sun/moon rays, ortho window around player.
    // Tight frustum so 2048² has usable texels-per-block; fill lights the rest.
    this.keyLight = new THREE.DirectionalLight(0xfff4e0, 2.6);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    this.keyLight.shadow.bias = -0.00035;
    this.keyLight.shadow.normalBias = 0.045;
    this.keyLight.shadow.intensity = 0.68;
    this.keyLight.shadow.radius = 1;
    {
      const cam = this.keyLight.shadow.camera;
      cam.near = 2;
      cam.far = 170;
      const half = 44;
      cam.left = -half;
      cam.right = half;
      cam.top = half;
      cam.bottom = -half;
      cam.updateProjectionMatrix();
    }
    scene.add(this.keyLight);
    scene.add(this.keyLight.target);

    // Global unshadowed fill — prevents dark ring outside the tight shadow map
    this.fillLight = new THREE.DirectionalLight(0xfff4e0, 0.85);
    this.fillLight.castShadow = false;
    this.fillLight.position.set(40, 80, 30);
    scene.add(this.fillLight);
    scene.add(this.fillLight.target);


    this.sample = {
      phase: 0,
      timeOfDay: 0,
      sunElevation: 0.6,
      dayFactor: 1,
      nightFactor: 0,
      sunDir: new THREE.Vector3(0.55, 0.72, 0.4).normalize(),
      moonDir: new THREE.Vector3(-0.55, -0.72, -0.4).normalize(),
      sky: new THREE.Color(0x5ba3d9),
      fog: new THREE.Color(0x8ec4e8),
      sunColor: new THREE.Color(0xfff0d8),
      moonColor: new THREE.Color(0xb0c4ff),
      sunIntensity: 1.9,
      moonIntensity: 0,
      ambientIntensity: 0.38,
      hemiIntensity: 0.32,
      hemiSky: new THREE.Color(0xc8e4ff),
      hemiGround: new THREE.Color(0x5a7a48),
      aerosol: AEROSOL_BASE_TURBIDITY,
      mieHaze: 0.1,
      weatherDim: 1,
      weatherFlash: 0,
    };

    this._aimX = 0;
    this._aimY = 24;
    this._aimZ = 0;
    this.finalizeKeyLight();

    // Flat billboarded squares
    const sunTex = this.makeDiscTexture("#fff6c8", "#ffcc66", true);
    const moonTex = this.makeDiscTexture("#e8eef8", "#9aa8c0", false);
    const plane = new THREE.PlaneGeometry(1, 1);

    this.sunBillboard = new THREE.Mesh(
      plane,
      new THREE.MeshBasicMaterial({
        map: sunTex,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        fog: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    );
    this.sunBillboard.scale.setScalar(14);
    this.sunBillboard.renderOrder = -3;
    this.sunBillboard.frustumCulled = false;

    this.moonBillboard = new THREE.Mesh(
      plane.clone(),
      new THREE.MeshBasicMaterial({
        map: moonTex,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        fog: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    );
    this.moonBillboard.scale.setScalar(10);
    this.moonBillboard.renderOrder = -3;
    this.moonBillboard.frustumCulled = false;

    this.group.add(this.sunBillboard);
    this.group.add(this.moonBillboard);
    scene.add(this.group);
  }


  /** Key directional light (day sun / night moon) — weather binds to this */
  get light(): THREE.DirectionalLight {
    return this.keyLight;
  }

  get state(): DayNightSample {
    return this.sample;
  }

  /** Debug: jump to high noon (mid-day). */
  setToNoon(): void {
    this.time = CYCLE_LENGTH_SEC * 0.25;
  }

  /** Debug: jump to midnight. */
  setToMidnight(): void {
    this.time = CYCLE_LENGTH_SEC * 0.75;
  }

  /** True when currently day-ish (for debug toggle). */
  get isDaytime(): boolean {
    return this.sample.dayFactor > 0.45;
  }

  private makeDiscTexture(
    core: string,
    rim: string,
    glow: boolean,
  ): THREE.CanvasTexture {
    const s = 128;
    const c = document.createElement("canvas");
    c.width = s;
    c.height = s;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, s, s);
    if (glow) {
      const g0 = ctx.createRadialGradient(
        s / 2,
        s / 2,
        8,
        s / 2,
        s / 2,
        s * 0.48,
      );
      g0.addColorStop(0, "rgba(255,240,180,0.55)");
      g0.addColorStop(0.45, "rgba(255,200,80,0.2)");
      g0.addColorStop(1, "rgba(255,180,40,0)");
      ctx.fillStyle = g0;
      ctx.fillRect(0, 0, s, s);
    }
    const pad = 18;
    ctx.fillStyle = rim;
    ctx.fillRect(pad, pad, s - pad * 2, s - pad * 2);
    const g = ctx.createRadialGradient(s / 2, s / 2, 4, s / 2, s / 2, s * 0.38);
    g.addColorStop(0, core);
    g.addColorStop(0.7, rim);
    g.addColorStop(1, glow ? "rgba(255,200,100,0.15)" : "rgba(160,170,200,0.2)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * 0.36, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = glow ? "rgba(255,220,120,0.9)" : "rgba(200,210,230,0.85)";
    ctx.lineWidth = 4;
    ctx.strokeRect(pad + 2, pad + 2, s - pad * 2 - 4, s - pad * 2 - 4);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    return tex;
  }

  update(
    dt: number,
    px: number,
    py: number,
    pz: number,
    camera: THREE.Camera,
  ): DayNightSample {
    this.time = (this.time + dt) % CYCLE_LENGTH_SEC;
    const phase = this.time / CYCLE_LENGTH_SEC;

    // Slow natural turbidity drift (clean ↔ slightly hazy days)
    this.turbidityDrift += dt * 0.015;
    this.baseTurbidity =
      AEROSOL_BASE_TURBIDITY +
      Math.sin(this.turbidityDrift) * 0.35 +
      Math.sin(this.turbidityDrift * 0.37) * 0.2;

    // Phase: 0 dawn → 0.25 noon → 0.5 dusk → 0.75 midnight
    // Visual path: mid-latitude summer feel — nearly overhead at noon (not polar)
    const theta = phase * Math.PI * 2;
    // Peak elevation ~82° from horizon (sin ≈ 0.99) — high sun, not arctic low
    const elevAngle = Math.sin(theta) * (Math.PI / 2.2);
    const cosE = Math.cos(elevAngle);
    const sinE = Math.sin(elevAngle);
    const azim = theta;
    // Mild south bias only — keep the arc readable without pinning the sun low
    const sunDir = this.tmpSun
      .set(
        cosE * Math.sin(azim),
        sinE,
        cosE * Math.cos(azim) * 0.35,
      )
      .normalize();
    const moonDir = this.tmpMoon.copy(sunDir).multiplyScalar(-1);


    const sunElevation = sunDir.y;
    // Three.js smoothstep(x, min, max) — NOT GLSL (edge0, edge1, x)
    const dayFactor = THREE.MathUtils.smoothstep(sunElevation, -0.08, 0.2);
    const nightFactor = 1 - dayFactor;

    const s = this.sample;
    s.phase = phase;
    s.timeOfDay = this.time;
    s.sunElevation = sunElevation;
    s.dayFactor = dayFactor;
    s.nightFactor = nightFactor;
    s.sunDir.copy(sunDir);
    s.moonDir.copy(moonDir);

    // Clear-atmosphere composite (Rayleigh + Mie aerosols)
    const atm = atmosphereSkyColor(
      sunElevation,
      this.baseTurbidity,
      s.sky,
      this.tmpFog,
      this.tmpSunCol,
    );
    s.fog.copy(this.tmpFog);
    s.aerosol = atm.aerosol;
    s.mieHaze = atm.mieHaze;

    // Sun color: atmosphere reddening + slight artistic horizon boost
    s.sunColor.copy(this.tmpSunCol);
    const horizon =
      1 - THREE.MathUtils.smoothstep(Math.abs(sunElevation), 0.0, 0.35);
    s.sunColor.g = Math.min(s.sunColor.g, 0.95 - horizon * 0.12);
    s.sunColor.b = Math.min(s.sunColor.b, 0.88 - horizon * 0.28);
    s.moonColor.setRGB(0.55, 0.68, 0.95);

    // Aerosols slightly soften direct sun (optical depth)
    const hazeExt = 1 - atm.mieHaze * 0.16;
    const elev = THREE.MathUtils.clamp(sunElevation, 0, 1);
    // Day stays bright; night is darker with cooler fill
    s.sunIntensity = dayFactor * (1.95 + 0.85 * elev) * hazeExt;
    s.moonIntensity =
      nightFactor *
      (0.32 + 0.28 * THREE.MathUtils.clamp(-sunElevation, 0, 1));
    // Night ambient floor lowered + cool bias applied via hemi colors
    s.ambientIntensity =
      0.05 +
      dayFactor * 0.51 +
      nightFactor * 0.035 +
      atm.mieHaze * 0.04 * dayFactor;
    s.hemiIntensity =
      0.06 +
      dayFactor * 0.46 +
      nightFactor * 0.04 +
      atm.mieHaze * 0.03 * dayFactor;

    // Hemisphere: day airy sky; night deep cool indigo
    s.hemiSky.copy(s.sky).multiplyScalar(1.05);
    if (nightFactor > 0.01) {
      // Cool cast: deep navy / indigo, not warm grey
      const nightSky = new THREE.Color(0x0a1528);
      s.hemiSky.lerp(nightSky, nightFactor * 0.92);
      s.hemiSky.multiplyScalar(THREE.MathUtils.lerp(1, 0.38, nightFactor));
      // Pull residual warmth out of sky sample
      s.hemiSky.r *= THREE.MathUtils.lerp(1, 0.55, nightFactor);
      s.hemiSky.g *= THREE.MathUtils.lerp(1, 0.72, nightFactor);
      s.hemiSky.b = Math.min(
        1,
        s.hemiSky.b * THREE.MathUtils.lerp(1, 1.15, nightFactor),
      );
    }
    s.hemiGround.set(
      THREE.MathUtils.lerp(0.04, 0.38, dayFactor),
      THREE.MathUtils.lerp(0.06, 0.48, dayFactor),
      THREE.MathUtils.lerp(0.1, 0.24, dayFactor),
    );
    if (nightFactor > 0.01) {
      s.hemiGround.lerp(new THREE.Color(0x060c18), nightFactor * 0.85);
    }

    // Darken sky/fog sample toward cool night for clear weather baseline
    if (nightFactor > 0.01) {
      const nightDeep = new THREE.Color(0x040814);
      const nightFog = new THREE.Color(0x0a1220);
      s.sky.lerp(nightDeep, nightFactor * 0.88);
      s.sky.r *= THREE.MathUtils.lerp(1, 0.45, nightFactor);
      s.sky.g *= THREE.MathUtils.lerp(1, 0.65, nightFactor);
      s.fog.lerp(nightFog, nightFactor * 0.85);
      s.fog.r *= THREE.MathUtils.lerp(1, 0.5, nightFactor);
      s.fog.g *= THREE.MathUtils.lerp(1, 0.7, nightFactor);
      s.fog.b = Math.min(1, s.fog.b * THREE.MathUtils.lerp(1, 1.05, nightFactor));
    }

    this._aimX = px;
    this._aimY = py; // feet — do not follow eye/bob or shadows swim
    this._aimZ = pz;
    this.finalizeKeyLight();

    const skyDist = 180;

    this.sunBillboard.position.set(
      px + sunDir.x * skyDist,
      py + Math.max(0.05, sunDir.y) * skyDist,
      pz + sunDir.z * skyDist,
    );
    this.moonBillboard.position.set(
      px + moonDir.x * skyDist,
      py + Math.max(0.05, moonDir.y) * skyDist,
      pz + moonDir.z * skyDist,
    );
    this.sunBillboard.quaternion.copy(camera.quaternion);
    this.moonBillboard.quaternion.copy(camera.quaternion);

    // Billboard dimmed through haze (optical depth)
    const sunVis = sunElevation > -0.06 ? 1 : 0;
    const moonVis = -sunElevation > -0.06 ? 1 : 0;
    (this.sunBillboard.material as THREE.MeshBasicMaterial).opacity =
      sunVis * (0.55 + dayFactor * 0.45) * (1 - atm.mieHaze * 0.25);
    (this.moonBillboard.material as THREE.MeshBasicMaterial).opacity =
      moonVis * (0.4 + nightFactor * 0.55);
    this.sunBillboard.visible = sunVis > 0 && sunDir.y > -0.05;
    this.moonBillboard.visible = moonVis > 0 && moonDir.y > -0.05;

    // Slight billboard scale boost as “corona” grows with aerosols near horizon
    const corona = 1 + atm.mieHaze * 0.35 * horizon;
    this.sunBillboard.scale.setScalar(14 * corona);

    return s;
  }

  /**
   * Apply key directional light + shadow map.
   * Call after weather so nothing stomps castShadow/intensity.
   * Parallel rays (DirectionalLight) so walking does not change shadow angle.
   */
  finalizeKeyLight(): void {
    const s = this.sample;
    const px = this._aimX;
    const py = this._aimY;
    const pz = this._aimZ;

    const isDay = s.sunElevation >= 0;
    // Actual celestial direction with a minimum slant so the shadow camera
    // never looks straight down (unstable / vanishing shadows).
    const src = isDay ? s.sunDir : s.moonDir;
    const az = Math.atan2(src.x, src.z);
    const trueElev = Math.asin(THREE.MathUtils.clamp(src.y, -1, 1));
    const elev = THREE.MathUtils.clamp(trueElev, 0.32, 1.12);
    this.tmpShadowDir
      .set(
        Math.sin(az) * Math.cos(elev),
        Math.sin(elev),
        Math.cos(az) * Math.cos(elev),
      )
      .normalize();

    const weatherDim = s.weatherDim > 0 ? s.weatherDim : 1;
    const flash = s.weatherFlash ?? 0;
    const baseI = isDay
      ? Math.max(1.75, s.sunIntensity * 1.35)
      : Math.max(0.7, s.moonIntensity * 1.55);
    const totalI = baseI * weatherDim + flash * 0.4;
    // Stronger key / slightly weaker fill → darker, readable shadows
    const keyI = totalI * 1.05;
    const fillI = totalI * 0.38;
    const color = isDay ? s.sunColor : s.moonColor;

    // --- World-locked shadow window ---
    // Following the player 1:1 makes the ortho frustum slide, so shadow
    // texels crawl across the ground when you strafe. Snap the aim point
    // to the light-space texel grid (same basis Three.js lookAt uses) so
    // a tree's umbra stays planted until you've moved a whole texel.
    const dist = 78;
    const half = 48;
    const mapSize = this.keyLight.shadow.mapSize.x;
    const texel = (half * 2) / mapSize;

    // Hold the window on a block so strafing inside a cell doesn't move it
    const gx = Math.floor(px) + 0.5;
    const gy = Math.floor(py / 4) * 4 + 2;
    const gz = Math.floor(pz) + 0.5;

    // Shadow camera sits at aim+dir*dist, looks at aim.
    // lookAt: zAxis = normalize(eye - target) = dir
    const dir = this.tmpShadowDir;
    if (Math.abs(dir.y) > 0.94) this.tmpLook.set(1, 0, 0);
    else this.tmpLook.set(0, 1, 0);
    this.tmpRight.crossVectors(this.tmpLook, dir).normalize();
    this.tmpUp.crossVectors(dir, this.tmpRight).normalize();

    const lsX = gx * this.tmpRight.x + gy * this.tmpRight.y + gz * this.tmpRight.z;
    const lsY = gx * this.tmpUp.x + gy * this.tmpUp.y + gz * this.tmpUp.z;
    const lsZ = gx * dir.x + gy * dir.y + gz * dir.z;
    const sx = Math.floor(lsX / texel) * texel;
    const sy = Math.floor(lsY / texel) * texel;
    const sz = Math.floor(lsZ / texel) * texel;

    this.tmpCenter.set(
      this.tmpRight.x * sx + this.tmpUp.x * sy + dir.x * sz,
      this.tmpRight.y * sx + this.tmpUp.y * sy + dir.y * sz,
      this.tmpRight.z * sx + this.tmpUp.z * sy + dir.z * sz,
    );
    // Raise the look-at a bit so nearby terrain is centered in the frustum
    this.tmpCenter.y += 4;

    this.keyLight.position.set(
      this.tmpCenter.x + dir.x * dist,
      this.tmpCenter.y + dir.y * dist,
      this.tmpCenter.z + dir.z * dist,
    );
    this.keyLight.target.position.copy(this.tmpCenter);
    this.keyLight.target.updateMatrixWorld();
    this.keyLight.color.copy(color);
    this.keyLight.intensity = keyI;
    this.keyLight.visible = true;
    this.keyLight.castShadow = true;
    this.keyLight.shadow.intensity = isDay ? 0.72 : 0.88;
    this.keyLight.shadow.bias = -0.00035;
    this.keyLight.shadow.normalBias = 0.045;
    this.keyLight.shadow.radius = 1;
    {
      const cam = this.keyLight.shadow.camera;
      cam.near = 4;
      cam.far = 160;
      cam.left = -half;
      cam.right = half;
      cam.top = half;
      cam.bottom = -half;
      cam.up.set(0, 1, 0);
      if (Math.abs(dir.y) > 0.94) cam.up.set(1, 0, 0);
      cam.updateProjectionMatrix();
    }
    this.keyLight.updateMatrixWorld(true);
    this.keyLight.shadow.camera.updateMatrixWorld();
    this.keyLight.shadow.needsUpdate = true;

    // Fill: same direction/color, no shadows — far terrain stays lit
    this.fillLight.color.copy(color);
    this.fillLight.intensity = fillI;
    this.fillLight.position.set(
      px + dir.x * 100,
      py + Math.max(50, dir.y * 100 + 30),
      pz + dir.z * 100,
    );    this.fillLight.target.position.set(px, py, pz);
    this.fillLight.target.updateMatrixWorld();
    this.fillLight.visible = true;
    this.fillLight.castShadow = false;
    this.fillLight.updateMatrixWorld(true);
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.group);
    scene.remove(this.keyLight);
    scene.remove(this.keyLight.target);
    scene.remove(this.fillLight);
    scene.remove(this.fillLight.target);
    const sunMat = this.sunBillboard.material as THREE.MeshBasicMaterial;
    const moonMat = this.moonBillboard.material as THREE.MeshBasicMaterial;
    this.sunBillboard.geometry.dispose();
    sunMat.map?.dispose();
    sunMat.dispose();
    this.moonBillboard.geometry.dispose();
    moonMat.map?.dispose();
    moonMat.dispose();
    this.keyLight.dispose();
  }
}
