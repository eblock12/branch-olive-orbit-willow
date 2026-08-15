/**
 * Procedural game audio (Web Audio API).
 * Layered convolution reverb, scale UI pitches, granular rain, punchy LPF thunder.
 */

import { Block, isDoor, isLadder } from "./blocks";

export type AudioSurface =
  | "grass"
  | "dirt"
  | "stone"
  | "sand"
  | "wood"
  | "water"
  | "default";

const PENTATONIC_SEMITONES = [0, 2, 4, 7, 9] as const;
const MAJOR_SEMITONES = [0, 2, 4, 5, 7, 9, 11] as const;

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function scaleNoteHz(
  rootMidi: number,
  scale: readonly number[],
  octaves = 1,
): number {
  const deg = scale[Math.floor(Math.random() * scale.length)]!;
  const oct = Math.floor(Math.random() * (octaves + 1));
  return midiToHz(rootMidi + deg + oct * 12);
}

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly masterLevel = 1.45;
  private sfx: GainNode | null = null;
  private amb: GainNode | null = null;
  /** Post-ambience bus — thunder ducks this so rain/wind/bed clear for the boom */
  private ambDuck: GainNode | null = null;
  private ambDuckUntil = 0;

  private sfxDry: GainNode | null = null;
  /** Close / UI bus — no convolution (picks, clicks, menu) */
  private sfxClose: GainNode | null = null;
  private verbEarly: ConvolverNode | null = null;
  private verbHall: ConvolverNode | null = null;
  private verbCanyon: ConvolverNode | null = null;
  private verbEarlyGain: GainNode | null = null;
  private verbHallGain: GainNode | null = null;
  private verbCanyonGain: GainNode | null = null;
  private verbSend: GainNode | null = null;
  private ambVerbSend: GainNode | null = null;
  private thunderVerbSend: GainNode | null = null;

  private windGain: GainNode | null = null;
  private rainGain: GainNode | null = null;
  private rainWashGain: GainNode | null = null;
  private rainDropsGain: GainNode | null = null;
  private rainRumbleGain: GainNode | null = null;
  private rainNoiseBuf: AudioBuffer | null = null;
  private grainSrcBuf: AudioBuffer | null = null;
  private rainGrainBus: GainNode | null = null;
  private grainRain = 0;
  private grainNextT = 0;

  private dayGain: GainNode | null = null;
  private nightGain: GainNode | null = null;
  private waterAmbGain: GainNode | null = null;

  private noiseBuf: AudioBuffer | null = null;
  private thunderNoiseBuf: AudioBuffer | null = null;
  private started = false;
  private muted = false;

  private footT = 0;
  private lastLand = 0;
  private lastMine = 0;
  private lastUi = 0;
  private birdT = 3;
  private swimT = 0;
  private thunderTimers: number[] = [];

  /** Listener pose for spatialization */
  private listenX = 0;
  private listenY = 0;
  private listenZ = 0;
  private listenYaw = 0;

  async resume(): Promise<void> {
    if (this.muted) return;
    const ctx = this.ensure();
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        /* */
      }
    }
    if (!this.started && ctx.state === "running") {
      this.started = true;
      this.buildAmbience();
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this.masterLevel;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  dispose(): void {
    for (const id of this.thunderTimers) window.clearTimeout(id);
    this.thunderTimers = [];
    try {
      void this.ctx?.close();
    } catch {
      /* */
    }
    this.ctx = null;
    this.started = false;
  }

  update(
    dt: number,
    opts: {
      playing: boolean;
      moving: boolean;
      onGround: boolean;
      speed: number;
      sprinting: boolean;
      inWater: boolean;
      submerged: boolean;
      dayFactor: number;
      rain: number;
      windSpeed: number;
      surface: AudioSurface;
      /** 0 = buried, 1 = open sky */
      skyOpen?: number;
      /** 0 = tight walls, 1 = long sightlines */
      spaceOpen?: number;
      /** Player / camera for spatial audio */
      listenerX?: number;
      listenerY?: number;
      listenerZ?: number;
      listenerYaw?: number;
    },
  ): void {
    if (!this.started || !this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const day = opts.dayFactor;
    const night = 1 - day;

    if (opts.listenerX !== undefined) this.listenX = opts.listenerX;
    if (opts.listenerY !== undefined) this.listenY = opts.listenerY;
    if (opts.listenerZ !== undefined) this.listenZ = opts.listenerZ;
    if (opts.listenerYaw !== undefined) this.listenYaw = opts.listenerYaw;
    this.syncListener();

    this.ramp(
      this.dayGain,
      opts.playing ? 0.045 * day * (1 - opts.rain * 0.5) : 0,
      now,
    );
    this.ramp(
      this.nightGain,
      opts.playing ? 0.04 * night * (1 - opts.rain * 0.4) : 0,
      now,
    );
    this.ramp(
      this.windGain,
      opts.playing ? 0.02 + opts.windSpeed * 0.06 + opts.rain * 0.02 : 0,
      now,
    );
    const rainVol = opts.playing && !opts.submerged ? opts.rain : 0;
    this.ramp(this.rainGain, rainVol * 0.5, now);
    this.grainRain = rainVol;
    if (opts.playing && !opts.submerged && this.rainWashGain && this.rainRumbleGain) {
      const r = opts.rain;
      this.rainWashGain.gain.setTargetAtTime(0.3 + r * 0.35, now, 0.4);
      this.rainRumbleGain.gain.setTargetAtTime(r * 0.4, now, 0.5);
      if (this.rainGrainBus) {
        this.rainGrainBus.gain.setTargetAtTime(0.15 + r * 0.55, now, 0.35);
      }
    } else if (this.rainGrainBus) {
      this.rainGrainBus.gain.setTargetAtTime(0, now, 0.3);
    }
    this.scheduleRainGrains(now);

    this.ramp(
      this.waterAmbGain,
      opts.playing && (opts.inWater || opts.submerged)
        ? opts.submerged
          ? 0.08
          : 0.04
        : 0,
      now,
    );

    if (opts.playing && this.verbCanyonGain && this.sfxDry) {
      const sky = Math.max(0, Math.min(1, opts.skyOpen ?? 1));
      const open = Math.max(0, Math.min(1, opts.spaceOpen ?? 0.5));
      const enclosed = 1 - sky;
      const cave =
        enclosed *
        enclosed *
        Math.max(0, Math.min(1, (open - 0.38) / 0.42));
      const room = enclosed * (1 - open) * (1 - cave);
      const outdoor = sky > 0.65;
      const send = outdoor ? 0 : 1;
      this.verbSend?.gain.setTargetAtTime(send, now, outdoor ? 0.04 : 0.12);
      this.ambVerbSend?.gain.setTargetAtTime(outdoor ? 0 : 0.03, now, 0.1);

      this.verbEarlyGain?.gain.setTargetAtTime(
        outdoor ? 0 : 0.01 + room * 0.045 + cave * 0.03,
        now,
        outdoor ? 0.04 : 0.16,
      );
      this.verbHallGain?.gain.setTargetAtTime(
        outdoor ? 0 : room * 0.028 + cave * 0.07,
        now,
        outdoor ? 0.04 : 0.16,
      );
      this.verbCanyonGain.gain.setTargetAtTime(
        outdoor ? 0 : cave * cave * 0.12 + (cave > 0.55 ? 0.025 : 0),
        now,
        outdoor ? 0.05 : 0.18,
      );
      this.sfxDry.gain.setTargetAtTime(outdoor ? 1 : 0.97 - cave * 0.08 - room * 0.04, now, 0.1);
    }

    if (!opts.playing) return;

    if (opts.onGround && opts.moving && opts.speed > 1.2 && !opts.inWater) {
      const stride = opts.sprinting ? 0.28 : 0.38;
      this.footT += dt * (opts.speed / 4.3);
      if (this.footT >= stride) {
        this.footT = 0;
        this.footstep(opts.surface, opts.sprinting ? 1.1 : 0.85);
      }
    } else {
      this.footT = Math.max(0, this.footT - dt);
    }

    if (opts.inWater && opts.moving) {
      this.swimT += dt;
      if (this.swimT > 0.45) {
        this.swimT = 0;
        this.splash(0.25);
      }
    }

    this.birdT -= dt;
    if (day > 0.55 && opts.rain < 0.3 && this.birdT <= 0) {
      this.birdT = 6 + Math.random() * 14;
      if (Math.random() < 0.65) this.chirp();
    }
  }

  land(hard = false): void {
    const t = performance.now();
    if (t - this.lastLand < 200) return;
    this.lastLand = t;
    this.thud(hard ? 0.55 : 0.3);
  }

  jump(): void {
    this.whoosh(0.2);
  }

  mineHit(surface: AudioSurface, wx?: number, wy?: number, wz?: number): void {
    const t = performance.now();
    if (t - this.lastMine < 90) return;
    this.lastMine = t;
    this.tap(surface, 0.35, wx, wy, wz);
  }

  breakBlock(surface: AudioSurface, wx?: number, wy?: number, wz?: number): void {
    this.breakSfx(surface, wx, wy, wz);
  }

  placeBlock(surface: AudioSurface, wx?: number, wy?: number, wz?: number): void {
    this.placeSfx(surface, wx, wy, wz);
  }

  swing(): void {
    this.whoosh(0.38);
    this.noiseBurst(0.07, "lowpass", 220, 0.1, 0.6);
    this.tone(90 + Math.random() * 20, 0.05, 0.05, "sine");
  }

  hurt(): void {
    this.hurtSfx();
  }

  craft(): void {
    this.craftSfx();
  }

  ui(): void {
    const t = performance.now();
    if (t - this.lastUi < 50) return;
    this.lastUi = t;
    this.click();
  }

  door(opening: boolean, wx?: number, wy?: number, wz?: number): void {
    const base = opening ? 140 : 110;
    this.tone(base + Math.random() * 18, 0.09, opening ? 0.11 : 0.14, "triangle");
    this.noiseBurst(0.08, "lowpass", opening ? 420 : 280, 0.12, 0.55);
    this.tone(base * 0.55, 0.12, 0.06, "sine", 0, undefined, 0.04);
    void wx;
    void wy;
    void wz;
  }

  pickup(): void {
    this.pop(0.25);
  }

  eat(): void {
    this.noiseBurst(0.07, "bandpass", 780, 0.16, 0.85);
    this.tone(210 + Math.random() * 30, 0.055, 0.06, "triangle");
    this.noiseBurst(0.06, "bandpass", 620, 0.13, 0.9, undefined, 0.09);
    this.tone(170, 0.05, 0.045, "triangle", 0, undefined, 0.09);
    this.tone(130, 0.08, 0.04, "sine", 0, undefined, 0.18);
    this.noiseBurst(0.05, "lowpass", 240, 0.07, 0.5, undefined, 0.18);
  }

  bubblePop(): void {
    this.noiseBurst(0.04, "bandpass", 1400, 0.07, 1.2);
    this.tone(880 + Math.random() * 220, 0.04, 0.035, "sine");
  }

  sleep(): void {
    this.tone(196, 0.18, 0.05, "sine");
    this.tone(247, 0.22, 0.04, "triangle");
    this.noiseBurst(0.35, "lowpass", 280, 0.06, 0.6);
  }

  chestOpen(wx: number, wy: number, wz: number): void {
    const w = { x: wx, y: wy, z: wz };
    this.tone(620 + Math.random() * 80, 0.04, 0.07, "square", 0, w);
    this.tone(180 + Math.random() * 30, 0.08, 0.05, "triangle", 0, w);
    this.noiseBurst(0.22, "bandpass", 520, 0.12, 1.4, w);
    this.noiseBurst(0.28, "lowpass", 280, 0.08, 0.7, w);
  }

  chestClose(wx: number, wy: number, wz: number): void {
    const w = { x: wx, y: wy, z: wz };
    this.noiseBurst(0.12, "bandpass", 380, 0.1, 1.1, w);
    this.tone(140, 0.07, 0.08, "triangle", 0, w);
    this.tone(90, 0.1, 0.06, "sine", 0, w);
    this.noiseBurst(0.08, "lowpass", 160, 0.1, 0.8, w);
  }

  splash(intensity = 0.5): void {
    this.waterSplash(intensity);
  }

  /**
   * Thunder after lightning. Optional world position for stereo pan + distance.
   */
  thunder(
    dist: number,
    strength = 1,
    wx?: number,
    wy?: number,
    wz?: number,
  ): void {
    if (!this.started || this.muted) return;
    const d = Math.max(0, dist);
    // Slightly slower-than-light delay so distant strikes feel delayed
    const delayMs = Math.min(10000, (d / 300) * 1000 * (0.9 + Math.random() * 0.25));
    const near = Math.max(0, 1 - d / 120);
    const vol = Math.min(1.35, strength * 1.25) * (0.35 + near * 0.85);
    if (vol < 0.04) return;
    const id = window.setTimeout(() => {
      this.thunderTimers = this.thunderTimers.filter((t) => t !== id);
      this.playThunder(vol, d, wx, wy, wz);
    }, delayMs);
    this.thunderTimers.push(id);
  }

  private ensure(): AudioContext {
    if (!this.ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.masterLevel;
      this.master.connect(this.ctx.destination);

      this.sfx = this.ctx.createGain();
      this.sfx.gain.value = 0.72;
      this.sfxDry = this.ctx.createGain();
      this.sfxDry.gain.value = 0.94;
      this.sfx.connect(this.sfxDry);
      this.sfxDry.connect(this.master);

      this.sfxClose = this.ctx.createGain();
      this.sfxClose.gain.value = 0.8;
      this.sfxClose.connect(this.master);

      this.buildLayeredReverb(this.ctx, this.sfx, this.master);

      // Ambience bed (rain / wind / day-night) → duck bus → master
      this.amb = this.ctx.createGain();
      this.amb.gain.value = 0.85;
      this.ambDuck = this.ctx.createGain();
      this.ambDuck.gain.value = 1;
      this.amb.connect(this.ambDuck);
      this.ambDuck.connect(this.master);
      if (this.verbHall) {
        const ambSend = this.ctx.createGain();
        ambSend.gain.value = 0;
        this.ambDuck.connect(ambSend);
        ambSend.connect(this.verbHall);
        this.ambVerbSend = ambSend;
      }

      this.noiseBuf = this.makeNoise(1.5);
      this.thunderNoiseBuf = this.makeThunderNoise(6);
      this.rainNoiseBuf = this.makeRainNoise(3);
      this.grainSrcBuf = this.makeGrainSource(2.0);
    }
    return this.ctx;
  }

  private buildLayeredReverb(
    ctx: AudioContext,
    sfxIn: GainNode,
    out: GainNode,
  ): void {
    const early = ctx.createConvolver();
    early.buffer = this.makeImpulseResponse(ctx, {
      seconds: 0.16,
      decay: 4.4,
      stereoSpread: 0.008,
      lowpass: 7000,
      density: 1,
    });
    const hall = ctx.createConvolver();
    hall.buffer = this.makeImpulseResponse(ctx, {
      seconds: 0.72,
      decay: 3.1,
      stereoSpread: 0.02,
      lowpass: 3800,
      density: 0.8,
    });
    const canyon = ctx.createConvolver();
    canyon.buffer = this.makeImpulseResponse(ctx, {
      seconds: 2.1,
      decay: 2.1,
      stereoSpread: 0.035,
      lowpass: 1600,
      density: 0.5,
      lateBoost: 1.2,
    });

    const gEarly = ctx.createGain();
    gEarly.gain.value = 0;
    const gHall = ctx.createGain();
    gHall.gain.value = 0;
    const gCanyon = ctx.createGain();
    gCanyon.gain.value = 0;

    const send = ctx.createGain();
    send.gain.value = 0;
    sfxIn.connect(send);
    send.connect(early);
    early.connect(gEarly);
    gEarly.connect(out);

    send.connect(hall);
    hall.connect(gHall);
    gHall.connect(out);

    send.connect(canyon);
    canyon.connect(gCanyon);
    gCanyon.connect(out);

    const thSend = ctx.createGain();
    thSend.gain.value = 0.45;
    thSend.connect(canyon);
    const thHall = ctx.createGain();
    thHall.gain.value = 0.2;
    thSend.connect(thHall);
    thHall.connect(hall);

    this.verbEarly = early;
    this.verbHall = hall;
    this.verbCanyon = canyon;
    this.verbEarlyGain = gEarly;
    this.verbHallGain = gHall;
    this.verbCanyonGain = gCanyon;
    this.verbSend = send;
    this.thunderVerbSend = thSend;
  }

  private makeImpulseResponse(
    ctx: AudioContext,
    opts: {
      seconds: number;
      decay: number;
      stereoSpread: number;
      lowpass: number;
      density: number;
      lateBoost?: number;
    },
  ): AudioBuffer {
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * opts.seconds);
    const buf = ctx.createBuffer(2, len, rate);
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);
    const lateBoost = opts.lateBoost ?? 1;
    const taps = [0.007, 0.013, 0.021, 0.034, 0.048, 0.067, 0.089];

    for (let i = 0; i < len; i++) {
      const t = i / rate;
      const env = Math.pow(1 - i / len, opts.decay);
      const late = 1 + (lateBoost - 1) * Math.min(1, t / (opts.seconds * 0.35));
      let n = 0;
      if (Math.random() < opts.density) {
        n = (Math.random() * 2 - 1) * env * late;
      }
      for (const tap of taps) {
        const ti = Math.floor(tap * rate);
        if (i === ti) n += (Math.random() * 2 - 1) * 0.55 * env;
        if (i === ti + 1) n += (Math.random() * 2 - 1) * 0.25 * env;
      }
      L[i] = n;
      const j = Math.min(
        len - 1,
        i + Math.floor((Math.random() - 0.5) * opts.stereoSpread * rate),
      );
      R[i] = (L[j] ?? n) * (0.92 + Math.random() * 0.16);
    }

    const lp = Math.exp((-2 * Math.PI * opts.lowpass) / rate);
    let l0 = 0;
    let r0 = 0;
    for (let i = 0; i < len; i++) {
      l0 = (1 - lp) * (L[i] ?? 0) + lp * l0;
      r0 = (1 - lp) * (R[i] ?? 0) + lp * r0;
      L[i] = l0;
      R[i] = r0;
    }

    let peak = 0;
    for (let i = 0; i < len; i++) {
      peak = Math.max(peak, Math.abs(L[i]!), Math.abs(R[i]!));
    }
    const inv = peak > 0 ? 0.9 / peak : 1;
    for (let i = 0; i < len; i++) {
      L[i]! *= inv;
      R[i]! *= inv;
    }
    return buf;
  }

  private outSfx(node: AudioNode, thunder = false): void {
    if (!this.sfx) return;
    node.connect(this.sfx);
    if (thunder && this.thunderVerbSend) node.connect(this.thunderVerbSend);
  }

  /**
   * Route through a 3D panner at world position, then into SFX or ambience bus.
   */
  private outSpatial(
    node: AudioNode,
    x: number,
    y: number,
    z: number,
    opts?: {
      thunder?: boolean;
      refDistance?: number;
      maxDistance?: number;
      /** Bird / bed sounds that should duck under thunder */
      ambience?: boolean;
    },
  ): PannerNode | null {
    if (!this.ctx || !this.sfx) {
      this.outSfx(node, opts?.thunder);
      return null;
    }
    const p = this.ctx.createPanner();
    p.panningModel = "HRTF";
    p.distanceModel = "inverse";
    p.refDistance = opts?.refDistance ?? 6;
    p.maxDistance = opts?.maxDistance ?? 140;
    p.rolloffFactor = 1.05;
    p.coneInnerAngle = 360;
    p.coneOuterAngle = 360;
    p.coneOuterGain = 1;
    this.setPannerPos(p, x, y, z);
    node.connect(p);
    if (opts?.ambience && this.ambDuck) {
      p.connect(this.ambDuck);
    } else {
      p.connect(this.sfx);
    }
    if (opts?.thunder && this.thunderVerbSend) {
      const send = this.ctx.createGain();
      send.gain.value = 0.4;
      node.connect(send);
      send.connect(this.thunderVerbSend);
    }
    return p;
  }

  /**
   * Duck rain/wind/day-night bed under a loud event (thunder).
   * amount: 0..1 reduction (0.7 ≈ −10 dB-ish). Hold then slow release.
   */
  private duckAmbience(
    amount: number,
    attack = 0.05,
    hold = 0.8,
    release = 2.2,
  ): void {
    if (!this.ctx || !this.ambDuck) return;
    const g = this.ambDuck.gain;
    const t0 = this.ctx.currentTime;
    const floor = Math.max(0.12, 1 - Math.min(0.92, amount));
    const end = t0 + attack + hold + release;
    // Don't let a weak far duck cancel a stronger close duck mid-way
    if (end < this.ambDuckUntil && floor > g.value + 0.05) return;
    this.ambDuckUntil = end;
    g.cancelScheduledValues(t0);
    g.setValueAtTime(Math.max(floor, g.value), t0);
    g.linearRampToValueAtTime(floor, t0 + Math.max(0.02, attack));
    g.setValueAtTime(floor, t0 + attack + hold);
    g.linearRampToValueAtTime(1, end);
  }

  private setPannerPos(p: PannerNode, x: number, y: number, z: number): void {
    if (p.positionX) {
      p.positionX.value = x;
      p.positionY.value = y;
      p.positionZ.value = z;
    } else {
      // Safari legacy
      (p as unknown as { setPosition: (a: number, b: number, c: number) => void }).setPosition(
        x,
        y,
        z,
      );
    }
  }

  private syncListener(): void {
    if (!this.ctx) return;
    const L = this.ctx.listener;
    const x = this.listenX;
    const y = this.listenY;
    const z = this.listenZ;
    // Match player.lookDir: forward = (-sin yaw, 0, -cos yaw), up = (0,1,0)
    const fx = -Math.sin(this.listenYaw);
    const fy = 0;
    const fz = -Math.cos(this.listenYaw);
    const ux = 0;
    const uy = 1;
    const uz = 0;

    if (L.positionX) {
      L.positionX.value = x;
      L.positionY.value = y;
      L.positionZ.value = z;
      L.forwardX.value = fx;
      L.forwardY.value = fy;
      L.forwardZ.value = fz;
      L.upX.value = ux;
      L.upY.value = uy;
      L.upZ.value = uz;
    } else {
      const legacy = L as unknown as {
        setPosition: (a: number, b: number, c: number) => void;
        setOrientation: (
          a: number,
          b: number,
          c: number,
          d: number,
          e: number,
          f: number,
        ) => void;
      };
      legacy.setPosition(x, y, z);
      legacy.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }

  private ramp(g: GainNode | null, v: number, now: number): void {
    if (!g) return;
    g.gain.cancelScheduledValues(now);
    g.gain.setTargetAtTime(Math.max(0, v), now, 0.25);
  }

  private buildAmbience(): void {
    const ctx = this.ctx!;
    const amb = this.amb!;
    const noise = this.noiseBuf!;

    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windGain.connect(amb);
    {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = 400;
      f.Q.value = 0.7;
      src.connect(f);
      f.connect(this.windGain);
      src.start();
    }

    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    this.rainGain.connect(amb);
    this.buildRainLayers(ctx, this.rainGain, noise);

    this.dayGain = ctx.createGain();
    this.dayGain.gain.value = 0;
    this.dayGain.connect(amb);
    {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 600;
      src.connect(f);
      f.connect(this.dayGain);
      src.start();
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = 196;
      const og = ctx.createGain();
      og.gain.value = 0.04;
      o.connect(og);
      og.connect(this.dayGain);
      o.start();
    }

    this.nightGain = ctx.createGain();
    this.nightGain.gain.value = 0;
    this.nightGain.connect(amb);
    {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 280;
      src.connect(f);
      f.connect(this.nightGain);
      src.start();
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = 98;
      const o2 = ctx.createOscillator();
      o2.type = "sine";
      o2.frequency.value = 147;
      const og = ctx.createGain();
      og.gain.value = 0.035;
      o.connect(og);
      o2.connect(og);
      og.connect(this.nightGain);
      o.start();
      o2.start();
    }

    this.waterAmbGain = ctx.createGain();
    this.waterAmbGain.gain.value = 0;
    this.waterAmbGain.connect(amb);
    {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 200;
      src.connect(f);
      f.connect(this.waterAmbGain);
      src.start();
    }
  }

  private buildRainLayers(
    ctx: AudioContext,
    out: GainNode,
    white: AudioBuffer,
  ): void {
    const rainBuf = this.rainNoiseBuf ?? white;

    this.rainWashGain = ctx.createGain();
    this.rainWashGain.gain.value = 0.4;
    this.rainDropsGain = ctx.createGain();
    this.rainDropsGain.gain.value = 0;
    this.rainRumbleGain = ctx.createGain();
    this.rainRumbleGain.gain.value = 0;
    this.rainGrainBus = ctx.createGain();
    this.rainGrainBus.gain.value = 0;

    this.rainWashGain.connect(out);
    this.rainRumbleGain.connect(out);
    this.rainGrainBus.connect(out);

    {
      const src = ctx.createBufferSource();
      src.buffer = rainBuf;
      src.loop = true;
      src.playbackRate.value = 0.9;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 850;
      bp.Q.value = 0.4;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 2600;
      const g = ctx.createGain();
      g.gain.value = 0.55;
      src.connect(bp);
      bp.connect(lp);
      lp.connect(g);
      g.connect(this.rainWashGain);
      src.start();
    }
    {
      const src = ctx.createBufferSource();
      src.buffer = rainBuf;
      src.loop = true;
      src.playbackRate.value = 1.06;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1300;
      bp.Q.value = 0.45;
      const g = ctx.createGain();
      g.gain.value = 0.3;
      src.connect(bp);
      bp.connect(g);
      g.connect(this.rainWashGain);
      src.start();
    }
    {
      const src = ctx.createBufferSource();
      src.buffer = white;
      src.loop = true;
      src.playbackRate.value = 0.55;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 260;
      const g = ctx.createGain();
      g.gain.value = 0.38;
      src.connect(lp);
      lp.connect(g);
      g.connect(this.rainRumbleGain);
      src.start();
    }
    this.grainNextT = 0;
  }

  private scheduleRainGrains(now: number): void {
    if (!this.ctx || !this.rainGrainBus || !this.grainSrcBuf) return;
    if (this.grainRain < 0.03) {
      this.grainNextT = now + 0.05;
      return;
    }
    const density = 50 + this.grainRain * 240;
    const horizon = now + 0.1;
    if (this.grainNextT < now) this.grainNextT = now;
    let n = 0;
    while (this.grainNextT < horizon && n < 40) {
      this.spawnRainGrain(this.grainNextT, this.grainRain);
      const mean = 1 / density;
      this.grainNextT += mean * (0.55 + Math.random() * 0.9);
      n++;
    }
  }

  private spawnRainGrain(when: number, intensity: number): void {
    if (!this.ctx || !this.rainGrainBus || !this.grainSrcBuf) return;
    const ctx = this.ctx;
    const srcBuf = this.grainSrcBuf;
    const dur = 0.012 + Math.random() * 0.035 + intensity * 0.01;
    const rate = 0.75 + Math.random() * 0.7;
    const offset =
      Math.random() * Math.max(0.001, srcBuf.duration - dur * rate - 0.01);

    const src = ctx.createBufferSource();
    src.buffer = srcBuf;
    src.playbackRate.value = rate;

    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 900 + Math.random() * 2800 + intensity * 400;
    bp.Q.value = 0.35 + Math.random() * 0.45;

    const g = ctx.createGain();
    const peak = (0.012 + Math.random() * 0.018) * (0.5 + intensity * 0.7);
    const attack = dur * 0.25;
    const release = dur * 0.55;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(peak, when + attack);
    g.gain.linearRampToValueAtTime(peak * 0.7, when + dur - release);
    g.gain.linearRampToValueAtTime(0.0001, when + dur);

    const pan = ctx.createStereoPanner();
    pan.pan.value = (Math.random() * 2 - 1) * (0.35 + intensity * 0.25);

    src.connect(bp);
    bp.connect(g);
    g.connect(pan);
    pan.connect(this.rainGrainBus);

    try {
      src.start(when, offset, dur + 0.02);
      src.stop(when + dur + 0.03);
    } catch {
      /* */
    }
  }

  private makeGrainSource(sec: number): AudioBuffer {
    const ctx = this.ctx!;
    const n = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let s1 = 0;
    let s2 = 0;
    let b0 = 0;
    let b1 = 0;
    for (let i = 0; i < n; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + white * 0.04;
      b1 = 0.985 * b1 + white * 0.08;
      s1 = s1 * 0.7 + (b0 + b1 + white * 0.15) * 0.3;
      s2 = s2 * 0.9 + s1 * 0.1;
      d[i] = s2 * 0.9;
    }
    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]!));
    const inv = peak > 0 ? 0.95 / peak : 1;
    for (let i = 0; i < n; i++) d[i]! *= inv;
    return buf;
  }

  private makeRainNoise(sec: number): AudioBuffer {
    const ctx = this.ctx!;
    const n = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < n; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      let pink = b0 + b1 + b2 + white * 0.1;
      const am =
        0.75 +
        0.25 * Math.sin(i * 0.00009) +
        0.12 * Math.sin(i * 0.00031 + 1.7);
      pink *= am;
      d[i] = pink * 0.22;
    }
    return buf;
  }

  private makeNoise(sec: number): AudioBuffer {
    const ctx = this.ctx!;
    const n = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  private makeThunderNoise(sec: number): AudioBuffer {
    const ctx = this.ctx!;
    const n = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < n; i++) {
      const white = Math.random() * 2 - 1;
      brown = (brown + white * 0.02) * 0.998;
      d[i] = brown * 3.5 + white * 0.12;
    }
    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]!));
    const inv = peak > 0 ? 0.95 / peak : 1;
    for (let i = 0; i < n; i++) d[i]! *= inv;
    return buf;
  }

  private env(
    g: GainNode,
    t0: number,
    peak: number,
    attack: number,
    release: number,
  ): void {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + release);
  }

  private noiseBurst(
    duration: number,
    filterType: BiquadFilterType,
    freq: number,
    peak: number,
    q = 0.8,
    world?: { x: number; y: number; z: number },
    delay = 0,
  ): void {
    if (!this.ctx || !this.sfx || !this.noiseBuf) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    this.env(g, t0, peak, 0.008, duration);
    src.connect(f);
    f.connect(g);
    if (world) this.outSpatial(g, world.x, world.y, world.z);
    else g.connect(this.sfx);
    src.start(t0);
    src.stop(t0 + duration + 0.05);
  }

  private tone(
    freq: number,
    duration: number,
    peak: number,
    type: OscillatorType = "square",
    detune = 0,
    world?: { x: number; y: number; z: number },
    delay = 0,
    dry = false,
  ): void {
    if (!this.ctx || !this.sfx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    const g = ctx.createGain();
    this.env(g, t0, peak, 0.01, duration);
    o.connect(g);
    if (dry && this.sfxClose) g.connect(this.sfxClose);
    else if (world) this.outSpatial(g, world.x, world.y, world.z);
    else g.connect(this.sfx);
    o.start(t0);
    o.stop(t0 + duration + 0.05);
  }

  private scaleTone(
    rootMidi: number,
    duration: number,
    peak: number,
    type: OscillatorType = "sine",
    scale: readonly number[] = PENTATONIC_SEMITONES,
    octaves = 1,
    world?: { x: number; y: number; z: number },
    dry = false,
  ): void {
    this.tone(
      scaleNoteHz(rootMidi, scale, octaves),
      duration,
      peak,
      type,
      0,
      world,
      0,
      dry,
    );
  }

  /**
   * Thunder: punchy when close, slow deep rolls when far, with strike-to-strike variation.
   */
  private playThunder(
    vol: number,
    dist: number,
    wx?: number,
    wy?: number,
    wz?: number,
  ): void {
    if (!this.ctx || !this.sfx || !this.noiseBuf) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    // close: 0 at ≥90m, 1 at 0m — extended so mid-range still has some crack
    const close = Math.max(0, 1 - dist / 90);
    const far = 1 - close;
    const mid = close * far * 4; // peaks around medium distance
    const rumbleBuf = this.thunderNoiseBuf ?? this.noiseBuf;
    const V = vol * 1.2;

    // Strike character roll
    const roll = Math.random();
    type Profile = "crack" | "roll" | "double" | "canyon" | "clatter";
    let profile: Profile;
    if (close > 0.55 && roll < 0.45) profile = "crack";
    else if (far > 0.55 && roll < 0.5) profile = "canyon";
    else if (roll < 0.22) profile = "double";
    else if (roll < 0.45) profile = "clatter";
    else profile = "roll";

    // Duration: distant = long slow rumble; close = shorter punch
    let bodyDur =
      2.2 +
      far * 7.5 + // up to ~10s far
      Math.random() * (1.2 + far * 2.5);
    if (profile === "canyon") bodyDur *= 1.25 + Math.random() * 0.3;
    if (profile === "crack") bodyDur *= 0.65 + Math.random() * 0.2;
    if (profile === "double") bodyDur *= 0.9;

    // World pos
    let sx = wx;
    let sy = wy;
    let sz = wz;
    if (sx === undefined || sy === undefined || sz === undefined) {
      const ang = this.listenYaw + (Math.random() - 0.5) * Math.PI;
      const d = Math.max(8, dist);
      sx = this.listenX + Math.sin(ang) * d;
      sy = this.listenY + 12 + far * 20;
      sz = this.listenZ + Math.cos(ang) * d;
    }

    const bus = ctx.createGain();
    bus.gain.value = 1;
    const masterLp = ctx.createBiquadFilter();
    masterLp.type = "lowpass";
    // Distant: stays dark; close: brief bright open then boom
    const openHz =
      profile === "crack"
        ? 1400 + close * 900
        : 500 + close * 1200 + Math.random() * 200;
    const bodyHz = 90 + far * 40 + close * 160 + (profile === "canyon" ? -25 : 0);
    const tailHz = 45 + far * 25 + Math.random() * 15;
    masterLp.frequency.setValueAtTime(openHz, t0);
    masterLp.frequency.exponentialRampToValueAtTime(
      Math.max(80, openHz * (0.4 + far * 0.25)),
      t0 + 0.05 + far * 0.25 + (profile === "canyon" ? 0.2 : 0),
    );
    masterLp.frequency.exponentialRampToValueAtTime(
      Math.max(60, bodyHz),
      t0 + 0.4 + far * 1.1,
    );
    masterLp.frequency.exponentialRampToValueAtTime(
      Math.max(40, tailHz),
      t0 + bodyDur * 0.75,
    );
    masterLp.Q.value = 0.55 + Math.random() * 0.35;
    bus.connect(masterLp);
    this.outSpatial(masterLp, sx, sy, sz, {
      thunder: true,
      refDistance: 18 + far * 12,
      maxDistance: 180,
    });

    // Clear rain/wind bed under the boom (stronger when close)
    this.duckAmbience(
      0.5 + close * 0.35 + (profile === "crack" ? 0.08 : 0),
      0.04 + far * 0.08,
      0.35 + close * 0.55 + bodyDur * 0.12,
      1.4 + far * 2.2 + bodyDur * 0.2,
    );

    // Reverb duck: more canyon wet for distant
    if (this.sfxDry && this.verbCanyonGain) {
      const dry = this.sfxDry.gain;
      const wet = this.verbCanyonGain.gain;
      dry.cancelScheduledValues(t0);
      wet.cancelScheduledValues(t0);
      dry.setValueAtTime(dry.value, t0);
      wet.setValueAtTime(wet.value, t0);
      dry.linearRampToValueAtTime(0.68 + close * 0.1, t0 + 0.04);
      wet.linearRampToValueAtTime(0.12 + far * 0.18, t0 + 0.12);
      dry.linearRampToValueAtTime(0.95, t0 + bodyDur + 2.5);
      wet.linearRampToValueAtTime(0.0, t0 + bodyDur + 3);
    }
    if (this.verbHallGain) {
      const h = this.verbHallGain.gain;
      h.cancelScheduledValues(t0);
      h.setValueAtTime(h.value, t0);
      h.linearRampToValueAtTime(0.06 + far * 0.06, t0 + 0.1);
      h.linearRampToValueAtTime(0.01, t0 + bodyDur + 2.5);
    }

    // —— Close crack / slap (skipped for pure distant canyon) ——
    if (close > 0.1 && profile !== "canyon") {
      const crackN = profile === "crack" ? 2 : profile === "clatter" ? 3 : 1;
      for (let c = 0; c < crackN; c++) {
        const tc = t0 + c * (0.04 + Math.random() * 0.06);
        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuf;
        src.playbackRate.value = 0.9 + Math.random() * 0.35;
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 180 + close * 500 + Math.random() * 200;
        bp.Q.value = 0.6 + Math.random() * 0.6;
        const g = ctx.createGain();
        const peak = 0.55 * V * close * (profile === "crack" ? 1.15 : 0.85);
        g.gain.setValueAtTime(0.0001, tc);
        g.gain.exponentialRampToValueAtTime(peak, tc + 0.003 + Math.random() * 0.004);
        g.gain.exponentialRampToValueAtTime(peak * 0.3, tc + 0.04);
        g.gain.exponentialRampToValueAtTime(0.0001, tc + 0.14 + Math.random() * 0.08);
        src.connect(bp);
        bp.connect(g);
        g.connect(bus);
        src.start(tc);
        src.stop(tc + 0.25);
      }
      // Sub kick on near hits
      if (close > 0.2) {
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.setValueAtTime(70 + Math.random() * 50 + close * 40, t0);
        o.frequency.exponentialRampToValueAtTime(28, t0 + 0.2);
        o.frequency.exponentialRampToValueAtTime(18, t0 + 0.65);
        const g = ctx.createGain();
        const peak = 0.5 * V * (0.35 + close * 0.75);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(peak, t0 + 0.005);
        g.gain.exponentialRampToValueAtTime(peak * 0.4, t0 + 0.14);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.8);
        o.connect(g);
        g.connect(bus);
        o.start(t0);
        o.stop(t0 + 0.85);
      }
    }

    // Double strike: delayed secondary crack
    if (profile === "double" && close > 0.15) {
      const t1 = t0 + 0.12 + Math.random() * 0.18;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 350 + Math.random() * 200;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t1);
      g.gain.exponentialRampToValueAtTime(0.4 * V * close, t1 + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t1 + 0.2);
      src.connect(lp);
      lp.connect(g);
      g.connect(bus);
      src.start(t1);
      src.stop(t1 + 0.25);
    }

    // —— Layered rumble body (slower & lower when far) ——
    const layers = 3 + (far > 0.45 ? 1 : 0) + (profile === "canyon" ? 1 : 0);
    for (let L = 0; L < layers; L++) {
      const src = ctx.createBufferSource();
      src.buffer = rumbleBuf;
      src.loop = true;
      // Distant: very slow playback = deep, lazy rumble
      const rateBase =
        profile === "canyon"
          ? 0.28 + L * 0.06
          : 0.38 + L * 0.08 + close * 0.35;
      src.playbackRate.value =
        rateBase + Math.random() * 0.06 - far * 0.08;

      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      const startF = 40 + L * 28 + close * 70 + mid * 15;
      const endF = 22 + L * 10 + far * 8;
      lp.frequency.setValueAtTime(startF, t0);
      lp.frequency.exponentialRampToValueAtTime(
        Math.max(18, endF),
        t0 + bodyDur * (0.8 + Math.random() * 0.15),
      );
      lp.Q.value = 0.5 + L * 0.08 + Math.random() * 0.15;

      // Slow modulation — much slower at distance
      const lfo = ctx.createOscillator();
      lfo.type = Math.random() < 0.3 ? "triangle" : "sine";
      lfo.frequency.value =
        (0.06 + L * 0.05) * (0.35 + close * 0.9) + Math.random() * 0.04;
      const lfoG = ctx.createGain();
      lfoG.gain.value = 12 + L * 8 + far * 10;
      lfo.connect(lfoG);
      lfoG.connect(lp.frequency);
      lfo.start(t0);
      lfo.stop(t0 + bodyDur + 0.4);

      // Optional second slow LFO for irregular distant rolls
      if (far > 0.35 && L === 0) {
        const lfo2 = ctx.createOscillator();
        lfo2.type = "sine";
        lfo2.frequency.value = 0.04 + Math.random() * 0.05;
        const lfo2G = ctx.createGain();
        lfo2G.gain.value = 8 + far * 12;
        lfo2.connect(lfo2G);
        lfo2G.connect(lp.frequency);
        lfo2.start(t0);
        lfo2.stop(t0 + bodyDur + 0.4);
      }

      const g = ctx.createGain();
      const peak =
        (0.4 - L * 0.05) *
        V *
        (0.75 + far * 0.45) *
        (profile === "canyon" ? 1.1 : 1);
      // Distant attack is slow (swell); close is snappy
      const attack =
        profile === "canyon"
          ? 0.35 + far * 0.9 + L * 0.15
          : close > 0.35
            ? 0.025 + L * 0.03
            : 0.15 + far * 0.55 + L * 0.1 + Math.random() * 0.12;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
      // Irregular swell shape for variation
      const midA = 0.22 + Math.random() * 0.2;
      const midB = 0.48 + Math.random() * 0.2;
      g.gain.exponentialRampToValueAtTime(
        peak * (0.4 + Math.random() * 0.25),
        t0 + bodyDur * midA,
      );
      g.gain.exponentialRampToValueAtTime(
        peak * (0.55 + Math.random() * 0.3 + far * 0.1),
        t0 + bodyDur * midB,
      );
      // Distant: extra late swell
      if (far > 0.4) {
        g.gain.exponentialRampToValueAtTime(
          peak * (0.35 + Math.random() * 0.25),
          t0 + bodyDur * (0.72 + Math.random() * 0.1),
        );
      }
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + bodyDur);

      src.connect(lp);
      lp.connect(g);
      g.connect(bus);
      src.start(t0);
      src.stop(t0 + bodyDur + 0.1);
    }

    // Deep sub foundation — slower glide when far
    {
      const o = ctx.createOscillator();
      o.type = "sine";
      const base = 28 + Math.random() * 14 + (profile === "canyon" ? -4 : 0);
      o.frequency.setValueAtTime(base * (1 + close * 0.45), t0);
      o.frequency.exponentialRampToValueAtTime(
        16 + Math.random() * 4,
        t0 + bodyDur * (0.7 + far * 0.15),
      );
      const g = ctx.createGain();
      const subPeak = 0.36 * V * (0.5 + far * 0.65 + close * 0.2);
      const subAtk = 0.03 + far * 0.35 + (profile === "canyon" ? 0.25 : 0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(subPeak, t0 + subAtk);
      g.gain.exponentialRampToValueAtTime(subPeak * 0.55, t0 + bodyDur * 0.45);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + bodyDur * 0.98);
      o.connect(g);
      g.connect(bus);
      o.start(t0);
      o.stop(t0 + bodyDur + 0.05);
    }

    // Echo / multipath rolls — wider spacing & slower when distant
    const echoes =
      1 +
      (far > 0.25 ? 1 : 0) +
      (far > 0.5 ? 1 : 0) +
      (profile === "canyon" ? 1 : 0) +
      (Math.random() < 0.4 ? 1 : 0);
    for (let e = 0; e < echoes; e++) {
      const delay =
        0.45 +
        e * (0.7 + far * 0.85 + Math.random() * 0.55) +
        far * 0.5 +
        Math.random() * 0.3;
      const eVol = V * (0.48 - e * 0.08) * (0.55 + far * 0.6);
      if (eVol < 0.025) continue;

      const src = ctx.createBufferSource();
      src.buffer = rumbleBuf;
      src.playbackRate.value = 0.32 + far * 0.08 + Math.random() * 0.12;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 35 + Math.random() * 30 + close * 20;
      const g = ctx.createGain();
      const te = t0 + delay;
      const edur = 1.8 + far * 3.5 + Math.random() * 1.4;
      const eAtk = 0.12 + far * 0.35 + Math.random() * 0.15;
      g.gain.setValueAtTime(0.0001, te);
      g.gain.exponentialRampToValueAtTime(0.3 * eVol, te + eAtk);
      g.gain.exponentialRampToValueAtTime(0.18 * eVol, te + edur * 0.45);
      g.gain.exponentialRampToValueAtTime(0.0001, te + edur);
      src.connect(lp);
      lp.connect(g);
      g.connect(bus);
      src.start(te);
      src.stop(te + edur + 0.08);

      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(38 - e * 3 + Math.random() * 6, te);
      o.frequency.exponentialRampToValueAtTime(18, te + edur * 0.65);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, te);
      og.gain.exponentialRampToValueAtTime(0.16 * eVol, te + eAtk);
      og.gain.exponentialRampToValueAtTime(0.0001, te + edur * 0.75);
      o.connect(og);
      og.connect(bus);
      o.start(te);
      o.stop(te + edur);
    }
  }

  private footstep(surface: AudioSurface, vol: number): void {
    const map: Record<AudioSurface, () => void> = {
      grass: () => {
        this.noiseBurst(0.06, "bandpass", 900, 0.12 * vol, 1.2);
        this.tone(120, 0.04, 0.03 * vol, "triangle");
      },
      dirt: () => this.noiseBurst(0.07, "lowpass", 500, 0.14 * vol, 0.7),
      sand: () => this.noiseBurst(0.09, "bandpass", 1400, 0.1 * vol, 0.5),
      stone: () => {
        this.noiseBurst(0.05, "highpass", 800, 0.1 * vol, 0.8);
        this.tone(180, 0.03, 0.04 * vol, "square");
      },
      wood: () => {
        this.tone(220, 0.05, 0.06 * vol, "triangle");
        this.noiseBurst(0.04, "bandpass", 700, 0.08 * vol);
      },
      water: () => this.waterSplash(0.2 * vol),
      default: () => this.noiseBurst(0.06, "lowpass", 600, 0.1 * vol),
    };
    map[surface]();
  }

  private tap(
    surface: AudioSurface,
    vol: number,
    wx?: number,
    wy?: number,
    wz?: number,
  ): void {
    const w =
      wx !== undefined && wy !== undefined && wz !== undefined
        ? { x: wx, y: wy, z: wz }
        : undefined;
    if (surface === "stone" || surface === "default") {
      this.noiseBurst(0.05, "bandpass", 1200, 0.15 * vol, 1.5, w);
      this.tone(300 + Math.random() * 40, 0.04, 0.05 * vol, "square", 0, w);
    } else if (surface === "wood") {
      this.tone(180 + Math.random() * 30, 0.06, 0.1 * vol, "triangle", 0, w);
      this.noiseBurst(0.04, "bandpass", 600, 0.08 * vol, 0.8, w);
    } else if (surface === "sand") {
      this.noiseBurst(0.07, "highpass", 2000, 0.1 * vol, 0.8, w);
    } else {
      this.noiseBurst(0.06, "bandpass", 700, 0.12 * vol, 0.8, w);
    }
  }

  private breakSfx(
    surface: AudioSurface,
    wx?: number,
    wy?: number,
    wz?: number,
  ): void {
    const w =
      wx !== undefined && wy !== undefined && wz !== undefined
        ? { x: wx, y: wy, z: wz }
        : undefined;
    this.noiseBurst(
      0.15,
      "bandpass",
      surface === "stone" ? 900 : 600,
      0.28,
      0.9,
      w,
    );
    this.tone(90, 0.1, 0.08, "square", 0, w);
    this.noiseBurst(0.12, "highpass", 2000, 0.12, 0.8, w);
  }

  private placeSfx(
    surface: AudioSurface,
    wx?: number,
    wy?: number,
    wz?: number,
  ): void {
    const w =
      wx !== undefined && wy !== undefined && wz !== undefined
        ? { x: wx, y: wy, z: wz }
        : undefined;
    const root = surface === "wood" ? 67 : surface === "stone" ? 62 : 64;
    this.scaleTone(root, 0.07, 0.1, "triangle", PENTATONIC_SEMITONES, 1, w);
    this.noiseBurst(0.05, "lowpass", 800, 0.1, 0.8, w);
  }

  private thud(vol: number): void {
    this.noiseBurst(0.12, "lowpass", 180, 0.25 * vol, 0.5);
    this.tone(70, 0.1, 0.12 * vol, "sine");
  }

  private whoosh(vol: number): void {
    this.noiseBurst(
      0.1,
      "bandpass",
      600 + Math.random() * 400,
      0.12 * vol,
      0.6,
    );
  }

  private hurtSfx(): void {
    this.tone(180, 0.12, 0.15, "sawtooth");
    this.tone(120, 0.15, 0.1, "square", -20);
    this.noiseBurst(0.1, "bandpass", 400, 0.12);
  }

  private craftSfx(): void {
    if (!this.ctx || !this.sfx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const startDeg = Math.floor(Math.random() * 5);
    const triad = [0, 2, 4];
    for (let i = 0; i < 3; i++) {
      const deg =
        MAJOR_SEMITONES[(startDeg + triad[i]!) % MAJOR_SEMITONES.length]!;
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = midiToHz(64 + deg);
      const g = ctx.createGain();
      const t = t0 + i * 0.07;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.08 - i * 0.012, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o.connect(g);
      g.connect(this.sfx);
      o.start(t);
      o.stop(t + 0.14);
    }
  }

  private click(): void {
    this.scaleTone(72, 0.035, 0.055, "square", PENTATONIC_SEMITONES, 1, undefined, true);
  }

  private pop(vol: number): void {
    this.scaleTone(74, 0.07, 0.11 * vol, "sine", PENTATONIC_SEMITONES, 1, undefined, true);
    this.tone(
      scaleNoteHz(74, PENTATONIC_SEMITONES, 0) * 1.5,
      0.05,
      0.04 * vol,
      "sine",
      0,
      undefined,
      0,
      true,
    );
  }

  private waterSplash(vol: number): void {
    this.noiseBurst(0.15, "bandpass", 900, 0.18 * vol, 0.6);
    this.noiseBurst(0.2, "lowpass", 400, 0.1 * vol);
  }

  private chirp(): void {
    if (!this.ctx || !this.sfx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    // Birds off to the side / above
    const ang = this.listenYaw + (Math.random() - 0.5) * Math.PI * 1.4;
    const dist = 14 + Math.random() * 28;
    const bx = this.listenX + Math.sin(ang) * dist;
    const by = this.listenY + 8 + Math.random() * 14;
    const bz = this.listenZ + Math.cos(ang) * dist;

    for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) {
      const o = ctx.createOscillator();
      o.type = "sine";
      const g = ctx.createGain();
      const t = t0 + i * 0.09;
      const note = scaleNoteHz(84, PENTATONIC_SEMITONES, 1);
      o.frequency.setValueAtTime(note, t);
      o.frequency.exponentialRampToValueAtTime(
        note *
          Math.pow(
            2,
            PENTATONIC_SEMITONES[Math.floor(Math.random() * 3)]! / 12,
          ),
        t + 0.07,
      );
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.04, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      o.connect(g);
      this.outSpatial(g, bx, by, bz, {
        refDistance: 10,
        maxDistance: 80,
        ambience: true,
      });
      o.start(t);
      o.stop(t + 0.1);
    }
  }
}

export function surfaceFromBlock(id: number): AudioSurface {
  switch (id) {
    case Block.GRASS:
    case Block.SNOW_GRASS:
    case Block.SHORT_GRASS:
    case Block.LEAVES:
    case Block.BIRCH_LEAVES:
    case Block.SPRUCE_LEAVES:
    case Block.JACARANDA_LEAVES:
    case Block.VINE:
    case Block.LILY_PAD:
      return "grass";
    case Block.DIRT:
    case Block.CLAY:
      return "dirt";
    case Block.STONE:
    case Block.COBBLE:
    case Block.GRAVEL:
    case Block.BEDROCK:
    case Block.COAL_ORE:
    case Block.IRON_ORE:
    case Block.FURNACE:
    case Block.FURNACE_LIT:
    case Block.ARCANE:
      return "stone";
    case Block.SAND:
    case Block.SNOW:
      return "sand";
    case Block.WOOD:
    case Block.BIRCH_WOOD:
    case Block.SPRUCE_WOOD:
    case Block.PLANKS:
    case Block.PUMPKIN:
    case Block.DOOR:
    case Block.LADDER:
      return "wood";
    case Block.WATER:
    case Block.ICE:
      return "water";
    default:
      if (isDoor(id) || isLadder(id)) return "wood";
      return "default";
  }
}
