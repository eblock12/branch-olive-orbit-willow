import { World } from "./world";
import { isSolid } from "./blocks";

export const PLAYER_HEIGHT = 1.7;
export const PLAYER_WIDTH = 0.55;
export const EYE_HEIGHT = 1.55;

/** Wish speed (units/s) — base strafe target on ground */
export const WALK_SPEED = 6.2;
export const SPRINT_SPEED = 8.0;
export const JUMP_VELOCITY = 8.6;
export const GRAVITY = 24;
export const MOUSE_SENS = 0.0022;

// ——— QuakeWorld-style movement ———
/** Ground friction coefficient */
const FRICTION = 6.5;
/** Speed below which friction uses stop-speed (keeps stopping snappy) */
const STOP_SPEED = 1.5;
/** Ground acceleration (QW ~10) */
const GROUND_ACCELERATE = 14;
/** Air acceleration — high so circle-strafe / bhop gains speed */
const AIR_ACCELERATE = 85;
/**
 * Air wish-speed cap (classic QW air control).
 * Keeps pure forward air slow, allows sideways accel for bhop gain.
 */
const AIR_WISH_SPEED_CAP = 30;
/** Soft hard-cap so velocity can't explode forever */
const MAX_HORIZONTAL_SPEED = 55;
/** Ground speed soft max for grounded walking (can exceed mid-bhop) */
const GROUND_MAX_SPEED = 12;

export class Player {
  x = 0;
  y = 40;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  yaw = 0; // radians; 0 faces -Z
  pitch = 0;
  onGround = false;
  /** Horizontal speed for HUD / juice */
  speed = 0;

  private halfW = PLAYER_WIDTH / 2;
  private height = PLAYER_HEIGHT;
  /** Jump was held last frame — used for edge-triggered feel if needed */
  private jumpWasHeld = false;

  get eyeY(): number {
    return this.y + EYE_HEIGHT;
  }

  /** Forward on XZ from yaw (three.js FPS: yaw 0 → -Z) */
  forwardXZ(): [number, number] {
    return [-Math.sin(this.yaw), -Math.cos(this.yaw)];
  }

  rightXZ(): [number, number] {
    // right = cross(forward, up) with up=+Y
    // forward = (-sin, 0, -cos) → right = (cos, 0, -sin)
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

  /**
   * QuakeWorld-style move:
   * - ground friction + accelerate
   * - air accelerate (strafe to gain speed)
   * - auto-bunnyhop: hold jump to chain hops and keep momentum
   */
  update(
    dt: number,
    world: World,
    moveF: number,
    moveR: number,
    jump: boolean,
    sprint: boolean,
  ): void {
    if (dt <= 0 || !Number.isFinite(dt)) return;

    // Unstick if embedded in geometry
    if (this.collides(world, this.x, this.y, this.z)) {
      this.unstick(world);
    }

    const wishSpeedBase = sprint ? SPRINT_SPEED : WALK_SPEED;
    const [fx, fz] = this.forwardXZ();
    const [rx, rz] = this.rightXZ();

    // Wish direction from input (normalized), wish speed separate
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
    let wishSpeed = wishLen > 1e-6 ? wishSpeedBase : 0;

    // Auto-bhop: if jump held on landing, hop immediately BEFORE friction
    // so horizontal speed is preserved (classic QW feel).
    if (this.onGround && jump) {
      this.vy = JUMP_VELOCITY;
      this.onGround = false;
    }

    if (this.onGround) {
      this.applyFriction(dt);
      this.accelerate(wishX, wishZ, wishSpeed, GROUND_ACCELERATE, dt);
      // Soft clamp grounded walk (bhop leaves ground so this won't kill chains)
      const sp = Math.hypot(this.vx, this.vz);
      if (sp > GROUND_MAX_SPEED) {
        const s = GROUND_MAX_SPEED / sp;
        this.vx *= s;
        this.vz *= s;
      }
    } else {
      // Air: cap wishspeed for air-control (enables side-strafe speed gain)
      const airWish = Math.min(wishSpeed, AIR_WISH_SPEED_CAP);
      this.airAccelerate(wishX, wishZ, airWish, AIR_ACCELERATE, dt);
    }

    this.vy -= GRAVITY * dt;

    // Soft horizontal speed cap
    {
      const sp = Math.hypot(this.vx, this.vz);
      if (sp > MAX_HORIZONTAL_SPEED) {
        const s = MAX_HORIZONTAL_SPEED / sp;
        this.vx *= s;
        this.vz *= s;
      }
    }

    const steps = Math.max(
      1,
      Math.ceil((Math.hypot(this.vx, this.vy, this.vz) * dt) / 0.2),
    );
    const sdt = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.moveAxis(world, this.vx * sdt, 0, 0);
      this.moveAxis(world, 0, this.vy * sdt, 0);
      this.moveAxis(world, 0, 0, this.vz * sdt);
    }

    // Ground check — slight skin so bhop jump-on-landing is reliable
    const grounded =
      this.collides(world, this.x, this.y - 0.06, this.z) && this.vy <= 0.05;
    this.onGround = grounded;

    // If we landed this frame with jump still held, hop again next frame
    // (onGround true → next update fires jump before friction)

    this.speed = Math.hypot(this.vx, this.vz);
    this.jumpWasHeld = jump;
  }

  /** Classic QW friction on XZ */
  private applyFriction(dt: number): void {
    const speed = Math.hypot(this.vx, this.vz);
    if (speed < 1e-4) {
      this.vx = 0;
      this.vz = 0;
      return;
    }
    const control = speed < STOP_SPEED ? STOP_SPEED : speed;
    const drop = control * FRICTION * dt;
    let newSpeed = speed - drop;
    if (newSpeed < 0) newSpeed = 0;
    newSpeed /= speed;
    this.vx *= newSpeed;
    this.vz *= newSpeed;
  }

  /** Ground accelerate toward wishdir * wishspeed */
  private accelerate(
    wishX: number,
    wishZ: number,
    wishSpeed: number,
    accel: number,
    dt: number,
  ): void {
    if (wishSpeed <= 0) return;
    const currentSpeed = this.vx * wishX + this.vz * wishZ;
    const addSpeed = wishSpeed - currentSpeed;
    if (addSpeed <= 0) return;
    let accelSpeed = accel * wishSpeed * dt;
    if (accelSpeed > addSpeed) accelSpeed = addSpeed;
    this.vx += accelSpeed * wishX;
    this.vz += accelSpeed * wishZ;
  }

  /**
   * QW air accelerate — gains speed when strafing (wishdir not aligned with vel).
   * Same math as ground accelerate but with high accel + capped wishspeed.
   */
  private airAccelerate(
    wishX: number,
    wishZ: number,
    wishSpeed: number,
    accel: number,
    dt: number,
  ): void {
    if (wishSpeed <= 0) return;
    const currentSpeed = this.vx * wishX + this.vz * wishZ;
    const addSpeed = wishSpeed - currentSpeed;
    if (addSpeed <= 0) return;
    // QW: accelspeed = accel * wishspeed * frametime
    let accelSpeed = accel * wishSpeed * dt;
    if (accelSpeed > addSpeed) accelSpeed = addSpeed;
    this.vx += accelSpeed * wishX;
    this.vz += accelSpeed * wishZ;
  }

  private unstick(world: World): void {
    // Search upward first (most common embed), then spiral on XZ
    for (let dy = 0; dy < 8; dy++) {
      if (!this.collides(world, this.x, this.y + dy, this.z)) {
        this.y += dy;
        this.vy = 0;
        return;
      }
    }
    for (let r = 1; r <= 3; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (!this.collides(world, this.x + dx, this.y, this.z + dz)) {
            this.x += dx;
            this.z += dz;
            this.vx = 0;
            this.vz = 0;
            return;
          }
        }
      }
    }
  }

  private moveAxis(world: World, dx: number, dy: number, dz: number): void {
    if (dx === 0 && dy === 0 && dz === 0) return;
    this.x += dx;
    this.y += dy;
    this.z += dz;

    if (!this.collides(world, this.x, this.y, this.z)) return;

    if (dx !== 0) {
      if (dx > 0) {
        this.x = Math.floor(this.x + this.halfW) - this.halfW - 1e-3;
      } else {
        this.x = Math.floor(this.x - this.halfW) + 1 + this.halfW + 1e-3;
      }
      this.vx = 0;
    }
    if (dz !== 0) {
      if (dz > 0) {
        this.z = Math.floor(this.z + this.halfW) - this.halfW - 1e-3;
      } else {
        this.z = Math.floor(this.z - this.halfW) + 1 + this.halfW + 1e-3;
      }
      this.vz = 0;
    }
    if (dy !== 0) {
      if (dy > 0) {
        this.y = Math.floor(this.y + this.height) - this.height - 1e-3;
        this.vy = 0;
      } else {
        this.y = Math.floor(this.y) + 1 + 1e-3;
        this.vy = 0;
        this.onGround = true;
      }
    }
  }

  collides(world: World, px: number, py: number, pz: number): boolean {
    const minX = Math.floor(px - this.halfW);
    const maxX = Math.floor(px + this.halfW - 1e-6);
    const minY = Math.floor(py);
    const maxY = Math.floor(py + this.height - 1e-6);
    const minZ = Math.floor(pz - this.halfW);
    const maxZ = Math.floor(pz + this.halfW - 1e-6);

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
    const minX = this.x - this.halfW;
    const maxX = this.x + this.halfW;
    const minY = this.y;
    const maxY = this.y + this.height;
    const minZ = this.z - this.halfW;
    const maxZ = this.z + this.halfW;
    return (
      maxX > bx &&
      minX < bx + 1 &&
      maxY > by &&
      minY < by + 1 &&
      maxZ > bz &&
      minZ < bz + 1
    );
  }
}
