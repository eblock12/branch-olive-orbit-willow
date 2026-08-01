import * as THREE from "three";

/**
 * Lightweight Verlet cloth — damped, fixed-step, capsule colliders.
 * Top edge pins follow an anchor Object3D's world matrix each frame.
 */

type Particle = {
  x: number;
  y: number;
  z: number;
  px: number;
  py: number;
  pz: number;
  pinned: boolean;
  lx: number;
  ly: number;
  lz: number;
  alive: boolean;
};

type Constraint = {
  a: number;
  b: number;
  rest: number;
  /** 0..1 compliance-ish weight (lower = softer) */
  k: number;
};

/** World-space capsule for soft collision (segment a→b + radius). */
export type ClothCollider = {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  radius: number;
};

export type ClothOptions = {
  cols?: number;
  rows?: number;
  width?: number;
  height?: number;
  color?: number;
  raggedness?: number;
  gravity?: number;
  /** Velocity retention per fixed step (lower = more damped). ~0.88–0.94 */
  damping?: number;
  stiffness?: number;
  iterations?: number;
};

const FIXED_DT = 1 / 60;
const MAX_SUBSTEPS = 3;
/** Max particle travel per fixed step (world units) — kills spasms */
const MAX_STEP_SPEED = 0.7;

export class RaggedCloth {
  readonly mesh: THREE.Mesh;
  private cols: number;
  private rows: number;
  private particles: Particle[] = [];
  private constraints: Constraint[] = [];
  private positions: Float32Array;
  private normals: Float32Array;
  private indices: Uint16Array;
  private indexCount: number;
  private geo: THREE.BufferGeometry;
  private mat: THREE.MeshLambertMaterial;
  private gravity: number;
  private damping: number;
  private stiffness: number;
  private iterations: number;
  private windT = Math.random() * 20;
  private accum = 0;
  private tmp = new THREE.Vector3();
  private pinPrev: { x: number; y: number; z: number }[] = [];
  private hasPinPrev = false;

  constructor(opts: ClothOptions = {}) {
    this.cols = opts.cols ?? 8;
    this.rows = opts.rows ?? 7;
    const width = opts.width ?? 1.15;
    const height = opts.height ?? 1.85;
    this.gravity = opts.gravity ?? 7.5;
    this.damping = opts.damping ?? 0.91;
    this.stiffness = opts.stiffness ?? 0.14;
    this.iterations = opts.iterations ?? 5;
    const ragged = opts.raggedness ?? 0.3;

    const cols = this.cols;
    const rows = this.rows;
    const n = cols * rows;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const u = c / (cols - 1);
        const v = r / (rows - 1);
        const flare = 1 + v * 0.18;
        const x = (u - 0.5) * width * flare;
        const y = -v * height;
        // Wrap slightly around torso (cylinder-ish rest)
        const ang = (u - 0.5) * Math.PI * 0.95;
        const rad = 0.28 + v * 0.06;
        const z = Math.cos(ang) * rad * 0.35 + 0.18;
        const pinned =
          r === 0 || (r === 1 && (c <= 1 || c >= cols - 2));
        let alive = true;
        if (r === rows - 1 && Math.random() < ragged * 0.55) alive = false;
        if (r === rows - 2 && Math.random() < ragged * 0.2) alive = false;

        this.particles.push({
          x,
          y,
          z,
          px: x,
          py: y,
          pz: z,
          pinned,
          lx: x,
          ly: y,
          lz: z,
          alive,
        });
        this.pinPrev.push({ x: 0, y: 0, z: 0 });
      }
    }

    const idx = (c: number, r: number) => r * cols + c;
    const tryLink = (i: number, j: number, kMul: number) => {
      const a = this.particles[i]!;
      const b = this.particles[j]!;
      if (!a.alive || !b.alive) return;
      const rest = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      this.constraints.push({
        a: i,
        b: j,
        rest,
        k: this.stiffness * kMul,
      });
    };

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = idx(c, r);
        if (!this.particles[i]!.alive) continue;
        // Structural
        if (c + 1 < cols) tryLink(i, idx(c + 1, r), 1);
        if (r + 1 < rows) tryLink(i, idx(c, r + 1), 0.85);
        // Shear — soft so folds form
        if (c + 1 < cols && r + 1 < rows) tryLink(i, idx(c + 1, r + 1), 0.28);
        if (c > 0 && r + 1 < rows) tryLink(i, idx(c - 1, r + 1), 0.28);
        // Bend (skip-one) — very soft, anti-crumple without cardboard feel
        if (c + 2 < cols) tryLink(i, idx(c + 2, r), 0.08);
        if (r + 2 < rows) tryLink(i, idx(c, r + 2), 0.06);
      }
    }

    this.positions = new Float32Array(n * 3);
    this.normals = new Float32Array(n * 3);
    const indexList: number[] = [];
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = idx(c, r);
        const b = idx(c + 1, r);
        const d = idx(c, r + 1);
        const e = idx(c + 1, r + 1);
        const pa = this.particles[a]!;
        const pb = this.particles[b]!;
        const pd = this.particles[d]!;
        const pe = this.particles[e]!;
        if (!pa.alive || !pb.alive || !pd.alive || !pe.alive) continue;
        if (r >= rows - 2 && Math.random() < ragged * 0.4) continue;
        indexList.push(a, d, b);
        indexList.push(b, d, e);
      }
    }
    this.indices = new Uint16Array(indexList);
    this.indexCount = indexList.length;

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute(
      "position",
      new THREE.BufferAttribute(this.positions, 3),
    );
    this.geo.setAttribute("normal", new THREE.BufferAttribute(this.normals, 3));
    this.geo.setIndex(new THREE.BufferAttribute(this.indices, 1));
    this.geo.computeBoundingSphere();

    this.mat = new THREE.MeshLambertMaterial({
      color: opts.color ?? 0x2c2830,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.94,
      depthWrite: true,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = 2;

    this.writePositions();
    this.recomputeNormals();
  }

  /**
   * @param windX/windZ world wind vector (game weather units, typically ~0–3+)
   * @param colliders torso / arm / leg capsules in world space
   */
  update(
    dt: number,
    anchor: THREE.Object3D,
    windX = 0,
    windZ = 0,
    colliders: ClothCollider[] = [],
  ): void {
    // Clamp huge frames (tab switch) so cloth doesn't explode
    const safeDt = Math.min(0.05, Math.max(0, dt));
    this.accum += safeDt;
    this.windT += safeDt;

    anchor.updateMatrixWorld(true);
    const mw = anchor.matrixWorld;

    // Map weather wind → cloth force. Stronger storms billow the shirt.
    // windSpeed in game is often ~0.3 clear … ~2–4 in storms.
    const wSpd = Math.hypot(windX, windZ);
    const dirX = wSpd > 1e-5 ? windX / wSpd : 0;
    const dirZ = wSpd > 1e-5 ? windZ / wSpd : 0;
    // Response curve: gentle at low wind, dramatic at storm peaks
    const response = Math.pow(THREE.MathUtils.clamp(wSpd * 0.55, 0, 3.2), 1.15);
    // Soft ambient flutter only when almost still
    const idle =
      Math.sin(this.windT * 0.55) * 0.06 + Math.sin(this.windT * 0.19) * 0.04;
    const wx = dirX * response + (wSpd < 0.2 ? idle : idle * 0.25);
    const wz =
      dirZ * response +
      (wSpd < 0.2 ? Math.cos(this.windT * 0.37) * 0.05 : 0);
    // Slight lift in strong wind (shirt billows outward/up)
    const lift = THREE.MathUtils.clamp(response * 0.22, 0, 0.85);

    let steps = 0;
    while (this.accum >= FIXED_DT && steps < MAX_SUBSTEPS) {
      this.substep(FIXED_DT, mw, wx, wz, lift, colliders);
      this.accum -= FIXED_DT;
      steps++;
    }
    if (this.accum > FIXED_DT) this.accum = 0;

    this.writePositions();
    this.recomputeNormals();
    this.geo.attributes.position!.needsUpdate = true;
    this.geo.attributes.normal!.needsUpdate = true;
    this.geo.computeBoundingSphere();
  }

  private substep(
    h: number,
    mw: THREE.Matrix4,
    wx: number,
    wz: number,
    lift: number,
    colliders: ClothCollider[],
  ): void {
    // Update pins + measure anchor motion so free particles inherit a damped carry
    let carryX = 0;
    let carryY = 0;
    let carryZ = 0;
    let pinCount = 0;

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i]!;
      if (!p.alive || !p.pinned) continue;
      this.tmp.set(p.lx, p.ly, p.lz).applyMatrix4(mw);
      const nx = this.tmp.x;
      const ny = this.tmp.y;
      const nz = this.tmp.z;
      const prev = this.pinPrev[i]!;
      if (this.hasPinPrev) {
        carryX += nx - prev.x;
        carryY += ny - prev.y;
        carryZ += nz - prev.z;
        pinCount++;
      }
      prev.x = nx;
      prev.y = ny;
      prev.z = nz;
      p.x = nx;
      p.y = ny;
      p.z = nz;
      p.px = nx;
      p.py = ny;
      p.pz = nz;
    }
    this.hasPinPrev = true;

    if (pinCount > 0) {
      carryX /= pinCount;
      carryY /= pinCount;
      carryZ /= pinCount;
      // Soft carry — full body teleport would still yank, so damp hard
      const carryDamp = 0.55;
      carryX *= carryDamp;
      carryY *= carryDamp;
      carryZ *= carryDamp;
      // Clamp carry so giant steps don't whip the cloth
      const cLen = Math.hypot(carryX, carryY, carryZ);
      const maxCarry = 0.12;
      if (cLen > maxCarry) {
        const s = maxCarry / cLen;
        carryX *= s;
        carryY *= s;
        carryZ *= s;
      }
    }

    const h2 = h * h;
    const g = this.gravity;

    // Integrate free particles
    for (const p of this.particles) {
      if (!p.alive || p.pinned) continue;

      // Inherit a bit of body motion (avoids laggy stretch whip)
      p.x += carryX;
      p.y += carryY;
      p.z += carryZ;
      p.px += carryX;
      p.py += carryY;
      p.pz += carryZ;

      let vx = (p.x - p.px) * this.damping;
      let vy = (p.y - p.py) * this.damping;
      let vz = (p.z - p.pz) * this.damping;

      // Extra linear drag on velocity (smooths spasms)
      const drag = 0.94;
      vx *= drag;
      vy *= drag;
      vz *= drag;

      // Forces as x += a * h^2 (classic Verlet)
      // Wind drives horizontal; lift scales with storm strength
      vx += wx * h2 * 28;
      vy += -g * h2 * 22 + lift * h2 * 14;
      vz += wz * h2 * 28;

      // Cap velocity
      const spd = Math.hypot(vx, vy, vz);
      if (spd > MAX_STEP_SPEED) {
        const s = MAX_STEP_SPEED / spd;
        vx *= s;
        vy *= s;
        vz *= s;
      }

      p.px = p.x;
      p.py = p.y;
      p.pz = p.z;
      p.x += vx;
      p.y += vy;
      p.z += vz;
    }

    // Constraints — soft, many iterations
    for (let it = 0; it < this.iterations; it++) {
      for (const c of this.constraints) {
        const a = this.particles[c.a]!;
        const b = this.particles[c.b]!;
        if (!a.alive || !b.alive) continue;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dz = b.z - a.z;
        const dist = Math.hypot(dx, dy, dz);
        if (dist < 1e-8) continue;
        // Soft correction
        const diff = ((dist - c.rest) / dist) * c.k;
        dx *= diff;
        dy *= diff;
        dz *= diff;
        const aFree = !a.pinned;
        const bFree = !b.pinned;
        if (aFree && bFree) {
          a.x += dx * 0.5;
          a.y += dy * 0.5;
          a.z += dz * 0.5;
          b.x -= dx * 0.5;
          b.y -= dy * 0.5;
          b.z -= dz * 0.5;
        } else if (aFree) {
          a.x += dx;
          a.y += dy;
          a.z += dz;
        } else if (bFree) {
          b.x -= dx;
          b.y -= dy;
          b.z -= dz;
        }
      }

      // Colliders every other constraint pass (cheaper, still stable)
      if (it % 2 === 0 || it === this.iterations - 1) {
        this.resolveColliders(colliders);
      }
    }

    // Re-pin after constraints
    for (const p of this.particles) {
      if (!p.alive || !p.pinned) continue;
      this.tmp.set(p.lx, p.ly, p.lz).applyMatrix4(mw);
      p.x = this.tmp.x;
      p.y = this.tmp.y;
      p.z = this.tmp.z;
      p.px = p.x;
      p.py = p.y;
      p.pz = p.z;
    }
  }

  private resolveColliders(colliders: ClothCollider[]): void {
    if (colliders.length === 0) return;
    for (const p of this.particles) {
      if (!p.alive || p.pinned) continue;
      for (const col of colliders) {
        // Closest point on segment a→b
        const abx = col.bx - col.ax;
        const aby = col.by - col.ay;
        const abz = col.bz - col.az;
        const apx = p.x - col.ax;
        const apy = p.y - col.ay;
        const apz = p.z - col.az;
        const abLen2 = abx * abx + aby * aby + abz * abz;
        let t = abLen2 > 1e-8 ? (apx * abx + apy * aby + apz * abz) / abLen2 : 0;
        t = Math.max(0, Math.min(1, t));
        const cx = col.ax + abx * t;
        const cy = col.ay + aby * t;
        const cz = col.az + abz * t;
        let dx = p.x - cx;
        let dy = p.y - cy;
        let dz = p.z - cz;
        let dist = Math.hypot(dx, dy, dz);
        const rad = col.radius;
        if (dist < rad && dist > 1e-6) {
          // Soft push-out (not full correction — less bounce)
          const push = ((rad - dist) / dist) * 0.85;
          p.x += dx * push;
          p.y += dy * push;
          p.z += dz * push;
          // Kill normal velocity into collider (via prev position)
          const nx = dx / dist;
          const ny = dy / dist;
          const nz = dz / dist;
          const rvx = p.x - p.px;
          const rvy = p.y - p.py;
          const rvz = p.z - p.pz;
          const vn = rvx * nx + rvy * ny + rvz * nz;
          if (vn < 0) {
            p.px += nx * vn;
            p.py += ny * vn;
            p.pz += nz * vn;
          }
        } else if (dist <= 1e-6) {
          // Degenerate — nudge out along body up
          p.x += rad * 0.5;
        }
      }
    }
  }

  resetToAnchor(anchor: THREE.Object3D): void {
    anchor.updateMatrixWorld(true);
    const mw = anchor.matrixWorld;
    this.hasPinPrev = false;
    this.accum = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i]!;
      if (!p.alive) continue;
      this.tmp.set(p.lx, p.ly, p.lz).applyMatrix4(mw);
      p.x = this.tmp.x;
      p.y = this.tmp.y;
      p.z = this.tmp.z;
      p.px = p.x;
      p.py = p.y;
      p.pz = p.z;
      this.pinPrev[i]!.x = p.x;
      this.pinPrev[i]!.y = p.y;
      this.pinPrev[i]!.z = p.z;
    }
    this.hasPinPrev = true;
    this.writePositions();
    this.recomputeNormals();
    this.geo.attributes.position!.needsUpdate = true;
    this.geo.attributes.normal!.needsUpdate = true;
  }

  private writePositions(): void {
    const pos = this.positions;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i]!;
      const o = i * 3;
      pos[o] = p.x;
      pos[o + 1] = p.y;
      pos[o + 2] = p.z;
    }
  }

  private recomputeNormals(): void {
    this.normals.fill(0);
    const pos = this.positions;
    const nrm = this.normals;
    const idx = this.indices;
    for (let i = 0; i < this.indexCount; i += 3) {
      const ia = idx[i]! * 3;
      const ib = idx[i + 1]! * 3;
      const ic = idx[i + 2]! * 3;
      const ax = pos[ia]!,
        ay = pos[ia + 1]!,
        az = pos[ia + 2]!;
      const bx = pos[ib]!,
        by = pos[ib + 1]!,
        bz = pos[ib + 2]!;
      const cx = pos[ic]!,
        cy = pos[ic + 1]!,
        cz = pos[ic + 2]!;
      const e1x = bx - ax,
        e1y = by - ay,
        e1z = bz - az;
      const e2x = cx - ax,
        e2y = cy - ay,
        e2z = cz - az;
      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;
      nrm[ia] += nx;
      nrm[ia + 1] += ny;
      nrm[ia + 2] += nz;
      nrm[ib] += nx;
      nrm[ib + 1] += ny;
      nrm[ib + 2] += nz;
      nrm[ic] += nx;
      nrm[ic + 1] += ny;
      nrm[ic + 2] += nz;
    }
    for (let i = 0; i < nrm.length; i += 3) {
      const nx = nrm[i]!;
      const ny = nrm[i + 1]!;
      const nz = nrm[i + 2]!;
      const len = Math.hypot(nx, ny, nz) || 1;
      nrm[i] = nx / len;
      nrm[i + 1] = ny / len;
      nrm[i + 2] = nz / len;
    }
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
