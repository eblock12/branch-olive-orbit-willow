export const DEBUG_REV = 2;

export type DebugSettings = {
  vertexAo: boolean;
  specular: boolean;
  specStrength: number;
  volumetrics: boolean;
  volStrength: number;
  shadows: boolean;
  shadowStrength: number;
  clouds: boolean;
  cloudShadows: boolean;
  particles: boolean;
  lightning: boolean;
  leafSway: boolean;
  fog: boolean;
  birds: boolean;
  ambiance: boolean;
  viewRadius: number;
  lodFull: number;
  lodMid: number;
  master: number;
  sfx: number;
  amb: number;
  rain: number;
  wind: number;
  thunder: number;
  reverb: number;
  mute: boolean;
};

export function defaultDebugSettings(): DebugSettings {
  return {
    vertexAo: true,
    specular: true,
    specStrength: 1,
    volumetrics: true,
    volStrength: 1,
    shadows: true,
    shadowStrength: 1,
    clouds: true,
    cloudShadows: true,
    particles: true,
    lightning: true,
    leafSway: true,
    fog: true,
    birds: true,
    ambiance: true,
    viewRadius: 16,
    lodFull: 7,
    lodMid: 13,
    master: 1,
    sfx: 1,
    amb: 1,
    rain: 1,
    wind: 1,
    thunder: 1,
    reverb: 1,
    mute: false,
  };
}

export function clampDebug(s: DebugSettings): DebugSettings {
  const n = (v: number, lo = 0, hi = 2) => Math.max(lo, Math.min(hi, v));
  return {
    ...s,
    specStrength: n(s.specStrength),
    volStrength: n(s.volStrength),
    shadowStrength: n(s.shadowStrength, 0, 1.5),
    master: n(s.master),
    sfx: n(s.sfx),
    amb: n(s.amb),
    rain: n(s.rain),
    wind: n(s.wind),
    thunder: n(s.thunder),
    reverb: n(s.reverb),
    viewRadius: Math.max(6, Math.min(24, Math.round(s.viewRadius))),
    lodFull: Math.max(2, Math.min(22, Math.round(s.lodFull))),
    lodMid: Math.max(3, Math.min(24, Math.round(s.lodMid))),
  };
}
