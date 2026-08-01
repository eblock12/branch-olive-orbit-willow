import * as THREE from "three";

type Bird = {
  mesh: THREE.Group;
  ox: number;
  oy: number;
  oz: number;
  phase: number;
  speed: number;
  radius: number;
  wing: number;
  wingSpeed: number;
  life: number;
  maxLife: number;
  /** Offset within the cloud-layer band */
  alt: number;
  yaw: number;
  bodyMat: THREE.MeshLambertMaterial;
  wingMat: THREE.MeshLambertMaterial;
  beakMat: THREE.MeshLambertMaterial;
};

/** Matches weather cloud deck (~118) — birds cruise just under/through it */
const CLOUD_LAYER_Y = 118;
const MAX_BIRDS = 14;

const sharedWing = new THREE.BoxGeometry(0.55, 0.04, 0.18);
const sharedBody = new THREE.BoxGeometry(0.14, 0.1, 0.35);
const sharedBeak = new THREE.BoxGeometry(0.06, 0.05, 0.1);

/**
 * Occasional sky birds — day only, orbiting near the cloud layer.
 */
export class BirdSystem {
  readonly group = new THREE.Group();
  private birds: Bird[] = [];
  private spawnT = 3;
  private dayFactor = 1;

  constructor() {
    this.group.name = "birds";
  }

  setDayFactor(f: number): void {
    this.dayFactor = f;
  }

  getDebug(): {
    count: number;
    day: number;
    samples: { x: number; y: number; z: number; op: number }[];
  } {
    return {
      count: this.birds.length,
      day: this.dayFactor,
      samples: this.birds.slice(0, 5).map((b) => ({
        x: b.mesh.position.x,
        y: b.mesh.position.y,
        z: b.mesh.position.z,
        op: b.bodyMat.opacity,
      })),
    };
  }

  update(dt: number, px: number, py: number, pz: number, _yaw = 0): void {
    const day = this.dayFactor;
    this.spawnT -= dt;

    if (day > 0.35 && this.birds.length < MAX_BIRDS && this.spawnT <= 0) {
      const base =
        this.birds.length < 3 ? 5 + Math.random() * 7 : 12 + Math.random() * 20;
      this.spawnT = base / Math.max(0.4, day);
      const n = Math.random() < 0.55 ? 1 : Math.random() < 0.75 ? 2 : 3;
      for (let i = 0; i < n && this.birds.length < MAX_BIRDS; i++) {
        this.spawnNear(px, py, pz, i * 0.4);
      }
    } else if (day <= 0.2) {
      this.spawnT = 3;
    }

    for (let i = this.birds.length - 1; i >= 0; i--) {
      const b = this.birds[i]!;
      b.life += dt;
      b.phase += dt * b.speed;
      b.wing += dt * b.wingSpeed;

      if (day < 0.15) b.life += dt * 2;
      if (b.life > b.maxLife) {
        this.removeAt(i);
        continue;
      }

      // Lazy ellipse high near the cloud deck
      const ang = b.phase;
      const rx = Math.cos(ang) * b.radius;
      const rz = Math.sin(ang) * b.radius * 0.72;
      const bob = Math.sin(ang * 1.7 + b.oy) * 2.2;
      const x = px + b.ox + rx;
      // Absolute cloud-layer band (not glued to player height)
      const y = CLOUD_LAYER_Y - 6 + b.alt + bob + b.oy;
      const z = pz + b.oz + rz;

      const tx = -Math.sin(ang) * b.radius;
      const tz = Math.cos(ang) * b.radius * 0.72;
      b.yaw = Math.atan2(tx, tz);

      b.mesh.position.set(x, y, z);
      b.mesh.rotation.y = b.yaw;
      b.mesh.rotation.z = -Math.sin(ang) * 0.25;
      b.mesh.rotation.x = Math.sin(ang * 1.7) * 0.08;

      const flap = Math.sin(b.wing) * 0.55;
      const left = b.mesh.getObjectByName("wingL");
      const right = b.mesh.getObjectByName("wingR");
      if (left) left.rotation.z = 0.25 + flap;
      if (right) right.rotation.z = -0.25 - flap;

      const fadeIn = Math.min(1, b.life * 1.2);
      const fadeOut = Math.min(1, (b.maxLife - b.life) * 0.8);
      const dayFade = THREE.MathUtils.smoothstep(day, 0.12, 0.45);
      const op = fadeIn * fadeOut * dayFade;
      b.mesh.visible = op > 0.02;
      b.bodyMat.opacity = op;
      b.wingMat.opacity = op;
      b.beakMat.opacity = op;
      const tr = op < 0.98;
      b.bodyMat.transparent = tr;
      b.wingMat.transparent = tr;
      b.beakMat.transparent = tr;
      b.bodyMat.depthWrite = op > 0.9;
      b.wingMat.depthWrite = op > 0.9;
      b.beakMat.depthWrite = op > 0.9;
    }
  }

  private spawnNear(px: number, py: number, pz: number, phaseOff: number): void {
    void py;
    const roll = Math.random();
    let bodyC = 0x2a2a32;
    let wingC = 0x3a3a44;
    let beakC = 0xc48a3a;
    if (roll < 0.35) {
      bodyC = 0xe8e8ec;
      wingC = 0xd0d0d8;
      beakC = 0xf0a040;
    } else if (roll < 0.55) {
      bodyC = 0x6b4a2e;
      wingC = 0x5a3c24;
    } else if (roll < 0.7) {
      bodyC = 0x3a4a6a;
      wingC = 0x2a3a55;
    }

    // Per-bird materials (opacity won't clobber other birds)
    const bodyMat = new THREE.MeshLambertMaterial({
      color: bodyC,
      flatShading: true,
      fog: false,
      transparent: true,
      opacity: 0,
    });
    const wingMat = new THREE.MeshLambertMaterial({
      color: wingC,
      flatShading: true,
      fog: false,
      transparent: true,
      opacity: 0,
    });
    const beakMat = new THREE.MeshLambertMaterial({
      color: beakC,
      flatShading: true,
      fog: false,
      transparent: true,
      opacity: 0,
    });

    const mesh = this.buildBird(bodyMat, wingMat, beakMat);
    mesh.scale.setScalar(0.9 + Math.random() * 0.45);

    const bird: Bird = {
      mesh,
      ox: (Math.random() - 0.5) * 24,
      oy: (Math.random() - 0.5) * 5,
      oz: (Math.random() - 0.5) * 24,
      phase: Math.random() * Math.PI * 2 + phaseOff,
      speed: 0.22 + Math.random() * 0.2,
      radius: 32 + Math.random() * 36,
      wing: Math.random() * Math.PI * 2,
      wingSpeed: 8 + Math.random() * 6,
      life: 0,
      maxLife: 28 + Math.random() * 40,
      alt: (Math.random() - 0.3) * 14,
      yaw: 0,
      bodyMat,
      wingMat,
      beakMat,
    };

    this.group.add(mesh);
    this.birds.push(bird);
    mesh.position.set(
      px + bird.ox,
      CLOUD_LAYER_Y - 6 + bird.alt,
      pz + bird.oz,
    );
  }

  private buildBird(
    bodyMat: THREE.MeshLambertMaterial,
    wingMat: THREE.MeshLambertMaterial,
    beakMat: THREE.MeshLambertMaterial,
  ): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(sharedBody, bodyMat);
    g.add(body);

    const beak = new THREE.Mesh(sharedBeak, beakMat);
    beak.name = "beak";
    beak.position.set(0, 0, 0.22);
    g.add(beak);

    const wingL = new THREE.Mesh(sharedWing, wingMat);
    wingL.name = "wingL";
    wingL.position.set(-0.28, 0.02, 0);
    g.add(wingL);

    const wingR = new THREE.Mesh(sharedWing, wingMat);
    wingR.name = "wingR";
    wingR.position.set(0.28, 0.02, 0);
    g.add(wingR);

    return g;
  }

  private removeAt(i: number): void {
    const b = this.birds[i];
    if (!b) return;
    this.group.remove(b.mesh);
    b.bodyMat.dispose();
    b.wingMat.dispose();
    b.beakMat.dispose();
    this.birds.splice(i, 1);
  }

  dispose(): void {
    while (this.birds.length) this.removeAt(0);
  }
}
