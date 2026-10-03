import * as THREE from "three";

const STAR_COUNT = 1100;
const RADIUS = 360;

type Meteor = {
  line: THREE.Line;
  pos: THREE.BufferAttribute;
  life: number;
  maxLife: number;
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
};

/** Named stick-figure constellations on the unit sphere (already roughly unit). */
const CONSTELLATIONS: { name: string; stars: [number, number, number][]; links: [number, number][] }[] = [
  {
    name: "Big Dipper",
    stars: [
      [0.22, 0.74, 0.64],
      [0.34, 0.76, 0.56],
      [0.46, 0.72, 0.52],
      [0.52, 0.66, 0.54],
      [0.6, 0.6, 0.52],
      [0.74, 0.54, 0.4],
      [0.84, 0.48, 0.24],
    ],
    links: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [3, 4],
      [4, 5],
      [5, 6],
    ],
  },
  {
    name: "Orion",
    stars: [
      [-0.18, 0.42, 0.89],
      [0.22, 0.46, 0.86],
      [-0.04, 0.28, 0.96],
      [0.04, 0.26, 0.96],
      [0.12, 0.24, 0.96],
      [-0.16, 0.08, 0.98],
      [0.2, 0.1, 0.97],
      [0.05, 0.16, 0.98],
    ],
    links: [
      [0, 2],
      [1, 4],
      [2, 3],
      [3, 4],
      [2, 5],
      [4, 6],
      [3, 7],
    ],
  },
  {
    name: "Cassiopeia",
    stars: [
      [-0.72, 0.62, 0.3],
      [-0.58, 0.7, 0.42],
      [-0.42, 0.64, 0.64],
      [-0.28, 0.72, 0.64],
      [-0.12, 0.66, 0.74],
    ],
    links: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
    ],
  },
  {
    name: "Southern Cross",
    stars: [
      [0.12, -0.22, -0.97],
      [0.08, -0.48, -0.87],
      [-0.16, -0.34, -0.93],
      [0.32, -0.36, -0.88],
    ],
    links: [
      [0, 1],
      [2, 3],
    ],
  },
  {
    name: "Summer Triangle",
    stars: [
      [-0.55, 0.55, -0.63],
      [-0.82, 0.28, -0.5],
      [-0.42, 0.22, -0.88],
    ],
    links: [
      [0, 1],
      [1, 2],
      [2, 0],
    ],
  },
];

function hash(i: number, s: number): number {
  const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Night sky: field stars, a few named constellations, rare meteors.
 * Follows the camera so they sit on the celestial sphere.
 */
export class Starfield {
  readonly group = new THREE.Group();
  private readonly points: THREE.Points;
  private readonly pointMat: THREE.ShaderMaterial;
  private readonly meteors: Meteor[] = [];
  private nextMeteor = 6;
  private opacity = 0;

  constructor() {
    this.group.name = "stars";
    this.group.frustumCulled = false;

    const pos = new Float32Array(STAR_COUNT * 3);
    const size = new Float32Array(STAR_COUNT);
    const bright = new Float32Array(STAR_COUNT);
    const phase = new Float32Array(STAR_COUNT);

    // Field
    let n = 0;
    for (let i = 0; i < STAR_COUNT - 40; i++) {
      const u = hash(i, 1);
      const v = hash(i, 2);
      const theta = Math.acos(2 * u - 1);
      const phi = v * Math.PI * 2;
      const st = Math.sin(theta);
      pos[n * 3] = st * Math.cos(phi) * RADIUS;
      pos[n * 3 + 1] = Math.cos(theta) * RADIUS;
      pos[n * 3 + 2] = st * Math.sin(phi) * RADIUS;
      const mag = Math.pow(hash(i, 3), 2.1);
      size[n] = 2.1 + mag * 4.6;
      bright[n] = 0.22 + mag * 0.48;
      phase[n] = hash(i, 4) * Math.PI * 2;
      n++;
    }

    // Constellation stars (slightly brighter, no connecting lines)
    for (const c of CONSTELLATIONS) {
      for (const s of c.stars) {
        const len = Math.hypot(s[0], s[1], s[2]) || 1;
        pos[n * 3] = (s[0] / len) * RADIUS;
        pos[n * 3 + 1] = (s[1] / len) * RADIUS;
        pos[n * 3 + 2] = (s[2] / len) * RADIUS;
        size[n] = 5.6;
        bright[n] = 0.72;
        phase[n] = n * 0.7;
        n++;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    geo.setAttribute("aBright", new THREE.BufferAttribute(bright, 1));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    geo.setDrawRange(0, n);

    this.pointMat = new THREE.ShaderMaterial({
      uniforms: {
        uOpacity: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aBright;
        attribute float aPhase;
        uniform float uTime;
        varying float vBright;
        void main() {
          float tw = 0.86 + 0.14 * step(0.35, sin(uTime * 1.4 + aPhase) * 0.5 + 0.5);
          vBright = aBright * tw;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (340.0 / max(50.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying float vBright;
        uniform float uOpacity;
        void main() {
          vec3 col = mix(vec3(0.78, 0.84, 1.0), vec3(1.0, 0.97, 0.9), vBright);
          gl_FragColor = vec4(col, vBright * uOpacity * 0.72);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      fog: false,
      toneMapped: false,
    });
    this.points = new THREE.Points(geo, this.pointMat);
    this.points.frustumCulled = false;
    this.points.renderOrder = -6;
    this.group.add(this.points);

    for (let i = 0; i < 3; i++) this.meteors.push(this.makeMeteor());
  }

  update(
    dt: number,
    px: number,
    py: number,
    pz: number,
    nightFactor: number,
    clearSky: number,
    phase: number,
  ): void {
    this.group.position.set(px, py, pz);
    // Sidereal drift through the night
    this.group.rotation.y = phase * Math.PI * 2 * 0.35;
    this.group.rotation.z = 0.18;

    const target = THREE.MathUtils.smoothstep(nightFactor, 0.18, 0.62) * clearSky;
    this.opacity += (target - this.opacity) * Math.min(1, dt * 2.4);
    this.pointMat.uniforms.uOpacity!.value = this.opacity;
    this.pointMat.uniforms.uTime!.value =
      (this.pointMat.uniforms.uTime!.value as number) + dt;
    this.points.visible = this.opacity > 0.02;

    this.nextMeteor -= dt;
    if (this.opacity > 0.45 && this.nextMeteor <= 0) {
      this.nextMeteor = 7 + Math.random() * 18;
      this.spawnMeteor();
    }

    for (const m of this.meteors) {
      if (m.life <= 0) {
        m.line.visible = false;
        continue;
      }
      m.life -= dt;
      const t = 1 - m.life / m.maxLife;
      const head = Math.min(1, t * 1.35);
      const tail = Math.max(0, head - 0.22);
      const arr = m.pos.array as Float32Array;
      arr[0] = m.ax + (m.bx - m.ax) * tail;
      arr[1] = m.ay + (m.by - m.ay) * tail;
      arr[2] = m.az + (m.bz - m.az) * tail;
      arr[3] = m.ax + (m.bx - m.ax) * head;
      arr[4] = m.ay + (m.by - m.ay) * head;
      arr[5] = m.az + (m.bz - m.az) * head;
      m.pos.needsUpdate = true;
      const fade = Math.sin(Math.min(1, m.life / m.maxLife) * Math.PI);
      (m.line.material as THREE.LineBasicMaterial).opacity =
        fade * this.opacity * 0.95;
      m.line.visible = fade > 0.02;
    }
  }

  private makeMeteor(): Meteor {
    const geo = new THREE.BufferGeometry();
    const pos = new THREE.BufferAttribute(new Float32Array(6), 3);
    geo.setAttribute("position", pos);
    const mat = new THREE.LineBasicMaterial({
      color: 0xe8f0ff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      toneMapped: false,
    });
    const line = new THREE.Line(geo, mat);
    line.visible = false;
    line.frustumCulled = false;
    line.renderOrder = -5;
    this.group.add(line);
    return {
      line,
      pos,
      life: 0,
      maxLife: 1,
      ax: 0,
      ay: 0,
      az: 0,
      bx: 0,
      by: 0,
      bz: 0,
    };
  }

  private spawnMeteor(): void {
    const m = this.meteors.find((x) => x.life <= 0);
    if (!m) return;
    const u = Math.random();
    const v = Math.random();
    const theta = Math.acos(2 * u - 1);
    const phi = v * Math.PI * 2;
    const st = Math.sin(theta);
    const ax = st * Math.cos(phi);
    const ay = Math.cos(theta);
    const az = st * Math.sin(phi);
    // Short chord across the sphere
    const dx = (Math.random() - 0.5) * 0.55;
    const dy = -0.15 - Math.random() * 0.25;
    const dz = (Math.random() - 0.5) * 0.55;
    let bx = ax + dx;
    let by = ay + dy;
    let bz = az + dz;
    const len = Math.hypot(bx, by, bz) || 1;
    m.ax = ax * RADIUS;
    m.ay = ay * RADIUS;
    m.az = az * RADIUS;
    m.bx = (bx / len) * RADIUS;
    m.by = (by / len) * RADIUS;
    m.bz = (bz / len) * RADIUS;
    m.maxLife = 0.55 + Math.random() * 0.55;
    m.life = m.maxLife;
    m.line.visible = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.pointMat.dispose();
    for (const m of this.meteors) {
      m.line.geometry.dispose();
      (m.line.material as THREE.Material).dispose();
    }
  }
}
