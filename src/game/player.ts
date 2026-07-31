import { World } from "./world";
import { Block, isSolid } from "./blocks";

export const PLAYER_HEIGHT = 1.8;
export const PLAYER_WIDTH = 0.6;
export const EYE_HEIGHT = 1.62;

// ——— Minecraft-like locomotion ———
export const WALK_SPEED = 4.317;
export const SPRINT_SPEED = 5.612;
export const JUMP_VELOCITY = 8.4;
export const GRAVITY = 28;
export const MOUSE_SENS = 0.0022;

/** Horizontal acceleration on ground (toward wish speed) */
const GROUND_ACCEL = 50;
/** Friction when grounded with little/no input */
const GROUND_FRICTION = 40;
/** Limited mid-air acceleration */
const AIR_ACCEL = 12;
/** Max speed air control can accelerate *up to* from slow speeds */
const AIR_MAX = 3.5;
/** Soft horizontal drag in air (very light — keeps walk-off momentum) */
const AIR_DRAG = 0.4;
/** Max step height (Minecraft ≈ 0.6) */
const STEP_HEIGHT = 0.6;
/** Ground probe distance under feet */
const GROUND_PROBE = 0.08;

// ——— Swimming ———
const SWIM_SPEED = 3.6;
const SWIM_SPRINT = 4.8;
const WATER_GRAVITY = 6;
const WATER_BUOYANCY = 8;
const WATER_DRAG = 5;
const WATER_ENTER_MAX_SINK = 7;

export class Player {
  x = 0;
  y = 40;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  yaw = 0;
  pitch = 0;
  onGround = false;
  inWater = false;
  submerged = false;
  speed = 0;

  private readonly halfW = PLAYER_WIDTH / 2;
  private readonly height = PLAYER_HEIGHT;
  private wasInWater = false;

  get eyeY(): number {
    return this.y + EYE_HEIGHT;
  }

  forwardXZ(): [number, number] {
    return [-Math.sin(this.yaw), -Math.cos(this.yaw)];
  }

  rightXZ(): [number, number] {
    return [Math.cos(this.yaw), -Math.sin(this.yaw)];
  }

  lookDir(): [number, number, number] {
    const cosP = Math.cos(this.pitch);
    return [
      -Math.sin(this.yaw) * cosP,
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * cosP,
    ];
  }

  applyLook(dx: number, dy: number, sens = MOUSE_SENS): void {
    this.yaw -= dx * sens;
    this.pitch -= dy * sens;
    const lim = Math.PI / 2 - 0.01;
    if (this.pitch > lim) this.pitch = lim;
    if (this.pitch < -lim) this.pitch = -lim;
  }

  // ─── Water sampling ───────────────────────────────────────────

  private isWaterAt(world: World, x: number, y: number, z: number): boolean {
    return world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)) === Block.WATER;
  }

  sampleWater(world: World): { any: boolean; head: boolean; feet: boolean } {
    const feetY = this.y + 0.1;
    const midY = this.y + this.height * 0.5;
    const headY = this.y + EYE_HEIGHT;
    const feet = this.isWaterAt(world, this.x, feetY, this.z);
    const mid = this.isWaterAt(world, this.x, midY, this.z);
    const head = this.isWaterAt(world, this.x, headY, this.z);
    return { any: feet || mid || head, head, feet };
  }

  // ─── Main update ──────────────────────────────────────────────

  update(
    dt: number,
    world: World,
    moveF: number,
    moveR: number,
    jump: boolean,
    sprint: boolean,
  ): void {
    if (dt <= 0 || !Number.isFinite(dt)) return;
    // Clamp huge frame spikes
    if (dt > 0.05) dt = 0.05;

    if (this.collides(world, this.x, this.y, this.z)) {
      this.unstick(world);
    }

    const water = this.sampleWater(world);
    this.inWater = water.any;
    this.submerged = water.head;

    if (this.inWater && !this.wasInWater && this.vy < -WATER_ENTER_MAX_SINK) {
      this.vy = -WATER_ENTER_MAX_SINK;
      this.vx *= 0.6;
      this.vz *= 0.6;
    }
    this.wasInWater = this.inWater;

    if (this.inWater) {
      this.tickSwim(dt, world, moveF, moveR, jump, sprint);
    } else {
      this.tickLand(dt, world, moveF, moveR, jump, sprint);
    }

    this.speed = Math.hypot(this.vx, this.vz);
  }

  // ─── Land movement ────────────────────────────────────────────

  private tickLand(
    dt: number,
    world: World,
    moveF: number,
    moveR: number,
    jump: boolean,
    sprint: boolean,
  ): void {
    const [fx, fz] = this.forwardXZ();
    const [rx, rz] = this.rightXZ();

    let wishX = fx * moveF + rx * moveR;
    let wishZ = fz * moveF + rz * moveR;
    const wishLen = Math.hypot(wishX, wishZ);
    if (wishLen > 1e-6) {
      wishX /= wishLen;
      wishZ /= wishLen;
    } else {
      wishX = 0;
      wishZ = 0;
    }

    const targetSpeed = wishLen > 1e-6 ? (sprint ? SPRINT_SPEED : WALK_SPEED) : 0;

    // Jump
    if (this.onGround && jump) {
      this.vy = JUMP_VELOCITY;
      this.onGround = false;
    }

    if (this.onGround) {
      this.vy = 0;
      this.moveGround(dt, wishX, wishZ, targetSpeed);
    } else {
      this.moveAir(dt, wishX, wishZ, targetSpeed);
      this.vy -= GRAVITY * dt;
    }

    this.integrate(dt, world);

    // Ground check after move
    if (this.vy <= 0 && this.collides(world, this.x, this.y - GROUND_PROBE, this.z)) {
      this.onGround = true;
      this.vy = 0;
    } else {
      this.onGround = false;
    }
  }

  /** Accelerate / friction on ground toward wish speed */
  private moveGround(
    dt: number,
    wishX: number,
    wishZ: number,
    targetSpeed: number,
  ): void {
    if (targetSpeed > 0) {
      // Accelerate toward wish * targetSpeed
      const tx = wishX * targetSpeed;
      const tz = wishZ * targetSpeed;
      this.vx = this.approach(this.vx, tx, GROUND_ACCEL * dt);
      this.vz = this.approach(this.vz, tz, GROUND_ACCEL * dt);
    } else {
      // Friction to stop
      this.vx = this.approach(this.vx, 0, GROUND_FRICTION * dt);
      this.vz = this.approach(this.vz, 0, GROUND_FRICTION * dt);
    }
    // Hard cap
    const sp = Math.hypot(this.vx, this.vz);
    if (sp > SPRINT_SPEED * 1.05) {
      const s = (SPRINT_SPEED * 1.05) / sp;
      this.vx *= s;
      this.vz *= s;
    }
  }

  /**
   * Air: keep momentum (walk-off / jump), limited steer.
   * Does not use Quake air-accel (no wall surfing).
   */
  private moveAir(
    dt: number,
    wishX: number,
    wishZ: number,
    targetSpeed: number,
  ): void {
    const sp = Math.hypot(this.vx, this.vz);

    if (targetSpeed > 1e-6) {
      if (sp < AIR_MAX) {
        // Slow in air: accelerate up to AIR_MAX
        const tx = wishX * Math.min(targetSpeed, AIR_MAX);
        const tz = wishZ * Math.min(targetSpeed, AIR_MAX);
        this.vx = this.approach(this.vx, tx, AIR_ACCEL * dt);
        this.vz = this.approach(this.vz, tz, AIR_ACCEL * dt);
      } else {
        // Have momentum: redirect without killing speed
        const inv = 1 / sp;
        let dx = this.vx * inv;
        let dz = this.vz * inv;
        const turn = Math.min(1, AIR_ACCEL * 0.55 * dt);
        dx += (wishX - dx) * turn;
        dz += (wishZ - dz) * turn;
        const len = Math.hypot(dx, dz) || 1;
        this.vx = (dx / len) * sp;
        this.vz = (dz / len) * sp;
      }
    } else {
      // Idle air drag (light)
      const d = Math.exp(-AIR_DRAG * dt);
      this.vx *= d;
      this.vz *= d;
    }
  }

  private approach(current: number, target: number, maxDelta: number): number {
    const d = target - current;
    if (d > maxDelta) return current + maxDelta;
    if (d < -maxDelta) return current - maxDelta;
    return target;
  }

  // ─── Swimming ─────────────────────────────────────────────────

  private tickSwim(
    dt: number,
    world: World,
    moveF: number,
    moveR: number,
    jump: boolean,
    sprint: boolean,
  ): void {
    const drag = Math.exp(-WATER_DRAG * dt);
    this.vx *= drag;
    this.vy *= drag;
    this.vz *= drag;

    this.vy += WATER_BUOYANCY * dt;
    this.vy -= WATER_GRAVITY * dt;

    const [lx, ly, lz] = this.lookDir();
    const [rx, rz] = this.rightXZ();
    let wx = lx * moveF + rx * moveR;
    let wy = ly * moveF;
    let wz = lz * moveF + rz * moveR;
    if (jump) wy += 1;
    if (sprint) wy -= 0.85;

    const len = Math.hypot(wx, wy, wz);
    if (len > 1e-6) {
      wx /= len;
      wy /= len;
      wz /= len;
      const speed =
        sprint && (Math.abs(moveF) > 0 || Math.abs(moveR) > 0)
          ? SWIM_SPRINT
          : SWIM_SPEED;
      const acc = 20 * dt;
      this.vx += wx * speed * acc;
      this.vy += wy * speed * acc;
      this.vz += wz * speed * acc;
    }

    const sp = Math.hypot(this.vx, this.vy, this.vz);
    const maxSp = SWIM_SPRINT * 1.25;
    if (sp > maxSp) {
      const s = maxSp / sp;
      this.vx *= s;
      this.vy *= s;
      this.vz *= s;
    }

    this.integrate(dt, world);

    const onFloor =
      this.vy <= 0.05 &&
      this.collides(world, this.x, this.y - GROUND_PROBE, this.z);
    this.onGround = onFloor && !this.submerged;
  }

  // ─── Integration + collision ──────────────────────────────────

  private integrate(dt: number, world: World): void {
    const sp = Math.hypot(this.vx, this.vy, this.vz);
    const steps = Math.max(1, Math.min(8, Math.ceil((sp * dt) / 0.35)));
    const sdt = dt / steps;

    for (let i = 0; i < steps; i++) {
      this.moveAxis(world, this.vx * sdt, 0, 0);
      this.moveAxis(world, 0, this.vy * sdt, 0);
      this.moveAxis(world, 0, 0, this.vz * sdt);
    }
  }

  /**
   * Axis-separated AABB move with optional step-up on X/Z.
   * Classic Minecraft clone approach — simple and stable.
   */
  private moveAxis(world: World, dx: number, dy: number, dz: number): void {
    if (dx === 0 && dy === 0 && dz === 0) return;

    // --- Y axis ---
    if (dy !== 0) {
      const ny = this.y + dy;
      if (!this.collides(world, this.x, ny, this.z)) {
        this.y = ny;
      } else {
        // Resolve to contact surface
        if (dy < 0) {
          // Falling — snap feet to top of block below
          const feet = this.y;
          const top = Math.floor(feet + dy + 1e-6) + 1;
          // Only snap if it doesn't embed us
          if (!this.collides(world, this.x, top + 1e-4, this.z)) {
            this.y = top + 1e-4;
          }
          this.onGround = true;
        } else {
          // Ceiling — stop just below
          const head = this.y + this.height + dy;
          const bottom = Math.floor(head) - this.height - 1e-4;
          if (bottom < this.y && !this.collides(world, this.x, bottom, this.z)) {
            this.y = bottom;
          }
        }
        this.vy = 0;
      }
      return;
    }

    // --- X or Z ---
    const nx = this.x + dx;
    const nz = this.z + dz;

    if (!this.collides(world, nx, this.y, nz)) {
      this.x = nx;
      this.z = nz;
      return;
    }

    // Step up if grounded / near ground and path above is free
    if (
      (this.onGround || this.collides(world, this.x, this.y - GROUND_PROBE, this.z)) &&
      this.vy <= 0.01
    ) {
      const stepY = this.y + STEP_HEIGHT;
      if (
        !this.collides(world, this.x, stepY, this.z) &&
        !this.collides(world, nx, stepY, nz)
      ) {
        this.y = stepY;
        this.x = nx;
        this.z = nz;
        // Drop onto the step
        this.fallOnto(world, STEP_HEIGHT + 0.15);
        return;
      }
    }

    // Slide along the axis that is free
    if (dx !== 0) {
      if (!this.collides(world, this.x + dx, this.y, this.z)) this.x += dx;
      else this.vx = 0;
    }
    if (dz !== 0) {
      if (!this.collides(world, this.x, this.y, this.z + dz)) this.z += dz;
      else this.vz = 0;
    }
  }

  /** After step-up, drop until we rest on solid */
  private fallOnto(world: World, maxDrop: number): void {
    let dropped = 0;
    const step = 0.05;
    while (dropped < maxDrop) {
      if (this.collides(world, this.x, this.y - step, this.z)) {
        // binary settle
        let lo = 0;
        let hi = step;
        for (let i = 0; i < 6; i++) {
          const mid = (lo + hi) * 0.5;
          if (this.collides(world, this.x, this.y - mid, this.z)) hi = mid;
          else lo = mid;
        }
        this.y -= lo;
        this.vy = 0;
        this.onGround = true;
        return;
      }
      this.y -= step;
      dropped += step;
    }
  }

  collides(world: World, px: number, py: number, pz: number): boolean {
    // Slight inset reduces corner snags
    const eps = 0.001;
    const minX = Math.floor(px - this.halfW + eps);
    const maxX = Math.floor(px + this.halfW - eps);
    const minY = Math.floor(py + eps);
    const maxY = Math.floor(py + this.height - eps);
    const minZ = Math.floor(pz - this.halfW + eps);
    const maxZ = Math.floor(pz + this.halfW - eps);

    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) {
          if (isSolid(world.getBlock(x, y, z))) return true;
        }
      }
    }
    return false;
  }

  overlapsBlock(bx: number, by: number, bz: number): boolean {
    return (
      this.x + this.halfW > bx &&
      this.x - this.halfW < bx + 1 &&
      this.y + this.height > by &&
      this.y < by + 1 &&
      this.z + this.halfW > bz &&
      this.z - this.halfW < bz + 1
    );
  }

  private unstick(world: World): void {
    for (let i = 0; i < 40; i++) {
      this.y += 0.05;
      if (!this.collides(world, this.x, this.y, this.z)) {
        this.vy = Math.min(this.vy, 0);
        return;
      }
    }
    for (const [dx, dz] of [
      [0.3, 0],
      [-0.3, 0],
      [0, 0.3],
      [0, -0.3],
    ] as const) {
      if (!this.collides(world, this.x + dx, this.y, this.z + dz)) {
        this.x += dx;
        this.z += dz;
        return;
      }
    }
  }
}
