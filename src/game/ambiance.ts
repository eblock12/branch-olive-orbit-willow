import * as THREE from "three";
import { Block } from "./blocks";
import type { World } from "./world";
import type { Player } from "./player";

const MAX = 280;

type Kind = "dust" | "firefly" | "leaf" | "bubble" | "star" | "ember";

type P = {
  active: boolean;
  kind: Kind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  phase: number;
  r: number;
  g: number;
  b: number;
  a: number;
};

/**
 * Lightweight ambiance VFX: day pollen, night fireflies/stars,
 * falling leaves, underwater bubbles. Particles advect with weather wind.
 */
export class AmbianceFX {
  readonly group = new THREE.Group();
  private pts: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private list: P[] = [];
  private free: number[] = [];
  private spawnAcc = 0;
  private leafAcc = 0;
  private starPhase = 0;
  private windX = 0;
  private windZ = 0;
  private windSpd = 0;

  constructor() {
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    geo.setDrawRange(0, 0);

    const mat = new THREE.PointsMaterial({
      size: 0.14,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      sizeAttenuation: true,
      fog: true,
      blending: THREE.AdditiveBlending,
      opacity: 0.9,
    });
    this.pts = new THREE.Points(geo, mat);
    this.pts.frustumCulled = false;
    this.pts.renderOrder = 3;
    this.group.add(this.pts);

    for (let i = 0; i < MAX; i++) {
      this.list.push({
        active: false,
        kind: "dust",
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 1,
        size: 1,
        phase: 0,
        r: 1,
        g: 1,
        b: 1,
        a: 0,
      });
      this.free.push(i);
    }
  }

  update(
    dt: number,
    world: World,
    player: Player,
    dayFactor: number,
    windX = 0,
    windZ = 0,
    rain = 0,
  ): void {
    const night = 1 - dayFactor;
    this.starPhase += dt;
    this.spawnAcc += dt;
    this.leafAcc += dt;

    // Clear weather wind is modest — boost so pollen still drifts
    const wLen = Math.hypot(windX, windZ);
    const boost = wLen < 0.15 ? 1.8 : 1.0;
    this.windX = windX * boost;
    this.windZ = windZ * boost;
    this.windSpd = Math.hypot(this.windX, this.windZ);
    const wnx = this.windSpd > 1e-4 ? this.windX / this.windSpd : 0;
    const wnz = this.windSpd > 1e-4 ? this.windZ / this.windSpd : 0;

    if (this.spawnAcc > 0.08) {
      this.spawnAcc = 0;
      const px = player.x;
      const py = player.eyeY;
      const pz = player.z;

      if (player.submerged) {
        if (Math.random() < 0.55) {
          this.spawn("bubble", {
            x: px + (Math.random() - 0.5) * 4,
            y: py - 0.5 - Math.random() * 2,
            z: pz + (Math.random() - 0.5) * 4,
            vx: (Math.random() - 0.5) * 0.15 + this.windX * 0.05,
            vy: 0.4 + Math.random() * 0.6,
            vz: (Math.random() - 0.5) * 0.15 + this.windZ * 0.05,
            life: 1.5 + Math.random() * 2,
            r: 0.7,
            g: 0.85,
            b: 1,
            a: 0.45,
          });
        }
      } else {
        // Day pollen — spawn upwind so they stream through the view
        if (
          dayFactor > 0.35 &&
          Math.random() < 0.5 * dayFactor + this.windSpd * 0.08
        ) {
          const n = 1 + (Math.random() < 0.3 + this.windSpd * 0.1 ? 1 : 0);
          for (let i = 0; i < n; i++) {
            const spread = 16 + this.windSpd * 4;
            const upwind = 4 + this.windSpd * 3;
            this.spawn("dust", {
              x: px + (Math.random() - 0.5) * spread - wnx * upwind,
              y: py - 1 + Math.random() * 5,
              z: pz + (Math.random() - 0.5) * spread - wnz * upwind,
              vx: this.windX * 0.85 + (Math.random() - 0.5) * 0.35,
              vy: 0.05 + Math.random() * 0.2 + this.windSpd * 0.04,
              vz: this.windZ * 0.85 + (Math.random() - 0.5) * 0.35,
              life: 4 + Math.random() * 6,
              r: 0.95,
              g: 0.92,
              b: 0.75,
              a: 0.35 + Math.random() * 0.25,
            });
          }
        }

        if (night > 0.45 && Math.random() < 0.4 * night && rain < 0.35) {
          const n = 1 + (Math.random() < 0.4 ? 1 : 0);
          for (let i = 0; i < n; i++) {
            this.spawn("firefly", {
              x: px + (Math.random() - 0.5) * 18 - wnx * this.windSpd * 1.5,
              y:
                world.getSurfaceY(
                  Math.floor(px + (Math.random() - 0.5) * 14),
                  Math.floor(pz + (Math.random() - 0.5) * 14),
                ) +
                0.4 +
                Math.random() * 1.8,
              z: pz + (Math.random() - 0.5) * 18 - wnz * this.windSpd * 1.5,
              vx: (Math.random() - 0.5) * 0.35 + this.windX * 0.25,
              vy: (Math.random() - 0.5) * 0.2,
              vz: (Math.random() - 0.5) * 0.35 + this.windZ * 0.25,
              life: 5 + Math.random() * 8,
              r: 0.75 + Math.random() * 0.25,
              g: 0.95,
              b: 0.35 + Math.random() * 0.2,
              a: 0.0,
            });
          }
        }

        if (night > 0.6 && rain > 0.5 && Math.random() < 0.2) {
          this.spawn("ember", {
            x: px + (Math.random() - 0.5) * 10 - wnx * 3,
            y: py + 2 + Math.random() * 4,
            z: pz + (Math.random() - 0.5) * 10 - wnz * 3,
            vx: this.windX * 1.1 + (Math.random() - 0.5) * 0.25,
            vy: -0.3 - Math.random() * 0.4,
            vz: this.windZ * 1.1 + (Math.random() - 0.5) * 0.25,
            life: 2 + Math.random() * 2,
            r: 0.55,
            g: 0.6,
            b: 0.7,
            a: 0.3,
          });
        }
      }

      if (night > 0.5 && Math.random() < 0.35 * night) {
        const ang = Math.random() * Math.PI * 2;
        const elev = 0.35 + Math.random() * 0.55;
        const dist = 80 + Math.random() * 40;
        this.spawn("star", {
          x: px + Math.cos(ang) * dist * Math.cos(elev),
          y: py + 20 + Math.sin(elev) * dist,
          z: pz + Math.sin(ang) * dist * Math.cos(elev),
          vx: 0,
          vy: 0,
          vz: 0,
          life: 3 + Math.random() * 5,
          r: 0.85,
          g: 0.9,
          b: 1,
          a: 0.5,
        });
      }
    }

    const leafInterval = Math.max(0.12, 0.35 - this.windSpd * 0.08);
    if (!player.submerged && this.leafAcc > leafInterval && dayFactor > 0.15) {
      this.leafAcc = 0;
      if (Math.random() < 0.4 + Math.min(0.5, this.windSpd * 0.25)) {
        this.trySpawnLeaf(world, player);
      }
    }

    let live = 0;
    for (let i = 0; i < MAX; i++) {
      const p = this.list[i]!;
      if (!p.active) continue;
      p.life -= dt;
      p.phase += dt;
      if (p.life <= 0) {
        p.active = false;
        this.free.push(i);
        continue;
      }

      if (p.kind === "firefly") {
        p.vx += Math.sin(p.phase * 2.1 + i) * dt * 0.4;
        p.vz += Math.cos(p.phase * 1.7 + i * 0.3) * dt * 0.4;
        p.vy += Math.sin(p.phase * 3.2) * dt * 0.25;
        this.advect(p, 0.55, 0.08, 0.35, dt);
        p.vx *= 1 - 1.1 * dt;
        p.vy *= 1 - 1.0 * dt;
        p.vz *= 1 - 1.1 * dt;
        const pulse = 0.35 + 0.65 * Math.max(0, Math.sin(p.phase * 4.5));
        const fade = Math.min(1, p.life * 0.5, (p.maxLife - p.life) * 0.8);
        p.a = pulse * fade * night;
      } else if (p.kind === "dust") {
        this.advect(p, 2.4, 0.18, 0.9, dt);
        p.vy += Math.sin(p.phase * 1.5 + p.x * 0.2) * dt * 0.08;
        p.vx *= 1 - 0.15 * dt;
        p.vz *= 1 - 0.15 * dt;
        p.vy *= 1 - 0.4 * dt;
        const fade = Math.min(1, p.life * 0.4, p.maxLife - p.life);
        p.a = (0.2 + 0.25 * dayFactor) * fade;
      } else if (p.kind === "leaf") {
        this.advect(p, 1.8, 0.35, 1.6, dt);
        p.vx += Math.sin(p.phase * 3.2) * dt * (0.6 + this.windSpd * 0.3);
        p.vz += Math.cos(p.phase * 2.4) * dt * (0.6 + this.windSpd * 0.3);
        const fall = Math.max(0.15, 0.55 - this.windSpd * 0.12);
        p.vy -= fall * dt;
        p.vy = Math.max(p.vy, -1.4 - this.windSpd * 0.1);
        const fade = Math.min(1, p.life * 0.5);
        p.a = 0.7 * fade * Math.max(dayFactor, 0.35);
        const sy = world.getSurfaceY(Math.floor(p.x), Math.floor(p.z));
        if (p.y < sy + 0.05) {
          p.y = sy + 0.05;
          p.life = Math.min(p.life, 0.4);
          p.vx *= 0.25;
          p.vz *= 0.25;
          p.vy = 0;
        }
      } else if (p.kind === "bubble") {
        p.vx += Math.sin(p.phase * 5) * dt * 0.1 + this.windX * dt * 0.05;
        p.vz += Math.cos(p.phase * 4) * dt * 0.1 + this.windZ * dt * 0.05;
        p.a = 0.4 * Math.min(1, p.life * 0.8);
      } else if (p.kind === "star") {
        const tw =
          0.35 +
          0.65 *
            Math.max(
              0,
              Math.sin(p.phase * 3 + i) * 0.5 +
                Math.sin(this.starPhase * 1.2 + i * 0.7) * 0.5,
            );
        p.a = tw * night * Math.min(1, p.life * 0.5);
      } else if (p.kind === "ember") {
        this.advect(p, 2.0, 0.1, 0.7, dt);
        p.vy -= 0.2 * dt;
        p.a = 0.25 * Math.min(1, p.life) * night;
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;

      if (
        Math.hypot(p.x - player.x, p.z - player.z) > 90 ||
        p.y < player.y - 30
      ) {
        p.active = false;
        this.free.push(i);
        continue;
      }

      const o = live * 3;
      this.pos[o] = p.x;
      this.pos[o + 1] = p.y;
      this.pos[o + 2] = p.z;
      const a = Math.max(0, Math.min(1, p.a));
      this.col[o] = p.r * a;
      this.col[o + 1] = p.g * a;
      this.col[o + 2] = p.b * a;
      live++;
    }

    this.pts.geometry.setDrawRange(0, live);
    (
      this.pts.geometry.getAttribute("position") as THREE.BufferAttribute
    ).needsUpdate = true;
    (
      this.pts.geometry.getAttribute("color") as THREE.BufferAttribute
    ).needsUpdate = true;

    const mat = this.pts.material as THREE.PointsMaterial;
    mat.size = 0.1 + night * 0.06;
  }

  /** Pull velocity toward wind with loft + turbulence */
  private advect(
    p: P,
    carry: number,
    lift: number,
    turb: number,
    dt: number,
  ): void {
    const wx = this.windX;
    const wz = this.windZ;
    const spd = this.windSpd;
    const k = Math.min(1, (1.8 + carry * 0.4) * dt);
    p.vx += (wx * carry - p.vx) * k;
    p.vz += (wz * carry - p.vz) * k;
    p.vy += spd * lift * dt * 0.35;
    if (spd > 0.05) {
      const t = p.phase * (2.2 + spd);
      p.vx += Math.sin(t * 1.7 + p.y) * turb * spd * dt * 0.55;
      p.vz += Math.cos(t * 1.3 + p.x) * turb * spd * dt * 0.55;
      p.vy += Math.sin(t * 2.1) * turb * spd * dt * 0.2;
    }
  }

  burstDust(x: number, y: number, z: number, strength = 1): void {
    const n = Math.min(8, Math.floor(3 + strength * 4));
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = 0.5 + Math.random() * 1.2 * strength;
      this.spawn("dust", {
        x: x + (Math.random() - 0.5) * 0.3,
        y: y + 0.05,
        z: z + (Math.random() - 0.5) * 0.3,
        vx: Math.cos(ang) * sp + this.windX * 0.9,
        vy: 0.4 + Math.random() * 0.8,
        vz: Math.sin(ang) * sp + this.windZ * 0.9,
        life: 0.5 + Math.random() * 0.6,
        r: 0.7,
        g: 0.62,
        b: 0.48,
        a: 0.5,
      });
    }
  }

  private trySpawnLeaf(world: World, player: Player): void {
    const wnx = this.windSpd > 1e-4 ? this.windX / this.windSpd : 0;
    const wnz = this.windSpd > 1e-4 ? this.windZ / this.windSpd : 0;
    for (let t = 0; t < 6; t++) {
      const lx = Math.floor(
        player.x + (Math.random() - 0.5) * 20 - wnx * this.windSpd * 2,
      );
      const lz = Math.floor(
        player.z + (Math.random() - 0.5) * 20 - wnz * this.windSpd * 2,
      );
      const sy = world.getSurfaceY(lx, lz);
      for (let y = sy; y < sy + 10 && y < 160; y++) {
        if (world.getBlock(lx, y, lz) === Block.LEAVES) {
          this.spawn("leaf", {
            x: lx + Math.random(),
            y: y - 0.2,
            z: lz + Math.random(),
            vx: this.windX * 1.1 + (Math.random() - 0.5) * 0.8,
            vy: -0.15 - Math.random() * 0.25 + this.windSpd * 0.05,
            vz: this.windZ * 1.1 + (Math.random() - 0.5) * 0.8,
            life: 5 + Math.random() * 4,
            r: 0.35 + Math.random() * 0.2,
            g: 0.55 + Math.random() * 0.25,
            b: 0.2,
            a: 0.75,
          });
          return;
        }
      }
    }
  }

  private spawn(
    kind: Kind,
    o: {
      x: number;
      y: number;
      z: number;
      vx: number;
      vy: number;
      vz: number;
      life: number;
      r: number;
      g: number;
      b: number;
      a: number;
    },
  ): void {
    const idx = this.free.pop();
    if (idx === undefined) return;
    const p = this.list[idx]!;
    p.active = true;
    p.kind = kind;
    p.x = o.x;
    p.y = o.y;
    p.z = o.z;
    p.vx = o.vx;
    p.vy = o.vy;
    p.vz = o.vz;
    p.life = o.life;
    p.maxLife = o.life;
    p.phase = Math.random() * Math.PI * 2;
    p.r = o.r;
    p.g = o.g;
    p.b = o.b;
    p.a = o.a;
  }

  dispose(): void {
    this.pts.geometry.dispose();
    (this.pts.material as THREE.Material).dispose();
  }
}
