import * as THREE from "three";

type Bird = {
  mesh: THREE.Group;
  /** Orbit center offsets from player (world) */
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
  /** Base altitude above player */
  alt: number;
  yaw: number;
};

const MAX_BIRDS = 14;
const sharedWing = new THREE.BoxGeometry(0.55, 0.04, 0.18);
const sharedBody = new THREE.BoxGeometry(0.14, 0.1, 0.35);
const sharedBeak = new THREE.BoxGeometry(0.06, 0.05, 0.1);

/**
 * Occasional sky birds — day only, cheap meshes orbiting near the player.
 */
export class BirdSystem {
  readonly group = new THREE.Group();
  private birds: Bird[] = [];
  private bodyMat: THREE.MeshLambertMaterial;
  private wingMat: THREE.MeshLambertMaterial;
  private beakMat: THREE.MeshLambertMaterial;
  private spawnT = 2;
  private dayFactor = 1;

  constructor() {
    this.bodyMat = new THREE.MeshLambertMaterial({
      color: 0x2a2a32,
      flatShading: true,
      fog: true,
    });
    this.wingMat = new THREE.MeshLambertMaterial({
      color: 0x3a3a44,
      flatShading: true,
      fog: true,
    });
    this.beakMat = new THREE.MeshLambertMaterial({
      color: 0xc48a3a,
      flatShading: true,
      fog: true,
    });
  }

  setDayFactor(f: number): void {
    this.dayFactor = f;
  }

  update(dt: number, px: number, py: number, pz: number): void {
    // Spawn more in full day, none at night
    const day = this.dayFactor;
    this.spawnT -= dt;
    if (day > 0.35 && this.birds.length < MAX_BIRDS && this.spawnT <= 0) {
      // Occasional: longer gap when already a few birds
      const base = this.birds.length < 3 ? 4 + Math.random() * 6 : 10 + Math.random() * 18;
      this.spawnT = base / Math.max(0.4, day);
      // 1–3 birds as a small flock
      const n = Math.random() < 0.55 ? 1 : Math.random() < 0.75 ? 2 : 3;
      for (let i = 0; i < n && this.birds.length < MAX_BIRDS; i++) {
        this.spawnNear(px, py, pz, i * 0.4);
      }
    } else if (day <= 0.2) {
      // Dusk/night: stop spawning, fade out remaining faster
      this.spawnT = 3;
    }

    for (let i = this.birds.length - 1; i >= 0; i--) {
      const b = this.birds[i]!;
      b.life += dt;
      b.phase += dt * b.speed;
      b.wing += dt * b.wingSpeed;

      // Leave at night or end of life
      if (day < 0.15) b.life += dt * 2;
      if (b.life > b.maxLife) {
        this.removeAt(i);
        continue;
      }

      // Wide lazy ellipse relative to player
      const ang = b.phase;
      const rx = Math.cos(ang) * b.radius;
      const rz = Math.sin(ang) * b.radius * 0.72;
      // Gentle altitude wave
      const bob = Math.sin(ang * 1.7 + b.oy) * 2.2;
      const x = px + b.ox + rx;
      const y = Math.max(py + 14, 62) + b.alt + bob + b.oy;
      const z = pz + b.oz + rz;

      // Tangent heading
      const tx = -Math.sin(ang) * b.radius;
      const tz = Math.cos(ang) * b.radius * 0.72;
      b.yaw = Math.atan2(tx, tz);

      b.mesh.position.set(x, y, z);
      b.mesh.rotation.y = b.yaw;
      // Slight bank into turn
      b.mesh.rotation.z = -Math.sin(ang) * 0.25;
      b.mesh.rotation.x = Math.sin(ang * 1.7) * 0.08;

      // Wing flap
      const flap = Math.sin(b.wing) * 0.55;
      const left = b.mesh.getObjectByName("wingL");
      const right = b.mesh.getObjectByName("wingR");
      if (left) left.rotation.z = 0.25 + flap;
      if (right) right.rotation.z = -0.25 - flap;

      // Fade in/out
      const fadeIn = Math.min(1, b.life * 1.2);
      const fadeOut = Math.min(1, (b.maxLife - b.life) * 0.8);
      const dayFade = THREE.MathUtils.smoothstep(0.12, 0.45, day);
      const op = fadeIn * fadeOut * dayFade;
      b.mesh.visible = op > 0.02;
      b.mesh.traverse((o) => {
        if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshLambertMaterial) {
          o.material.transparent = op < 0.98;
          o.material.opacity = op;
          o.material.depthWrite = op > 0.9;
        }
      });
    }
  }

  private spawnNear(px: number, py: number, pz: number, phaseOff: number): void {
    const mesh = this.buildBird();
    const ang0 = Math.random() * Math.PI * 2;
    const bird: Bird = {
      mesh,
      ox: (Math.random() - 0.5) * 20,
      oy: (Math.random() - 0.5) * 6,
      oz: (Math.random() - 0.5) * 20,
      phase: ang0 + phaseOff,
      speed: 0.22 + Math.random() * 0.2,
      radius: 28 + Math.random() * 40,
      wing: Math.random() * Math.PI * 2,
      wingSpeed: 8 + Math.random() * 6,
      life: 0,
      maxLife: 28 + Math.random() * 40,
      alt: 8 + Math.random() * 18,
      yaw: 0,
    };
    // Tint variety: crow / gull / sparrow
    const roll = Math.random();
    if (roll < 0.35) {
      // seagull
      this.tint(mesh, 0xe8e8ec, 0xd0d0d8, 0xf0a040);
    } else if (roll < 0.55) {
      // brown sparrow
      this.tint(mesh, 0x6b4a2e, 0x5a3c24, 0xc48a3a);
    } else if (roll < 0.7) {
      // blue-ish
      this.tint(mesh, 0x3a4a6a, 0x2a3a55, 0xc48a3a);
    }
    // else default dark crow

    this.group.add(mesh);
    this.birds.push(bird);
    // place immediately
    bird.mesh.position.set(px + bird.ox, py + 20, pz + bird.oz);
  }

  private tint(
    mesh: THREE.Group,
    body: number,
    wing: number,
    beak: number,
  ): void {
    mesh.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      if (o.name === "wingL" || o.name === "wingR") {
        o.material = this.wingMat.clone();
        (o.material as THREE.MeshLambertMaterial).color.setHex(wing);
      } else if (o.name === "beak") {
        o.material = this.beakMat.clone();
        (o.material as THREE.MeshLambertMaterial).color.setHex(beak);
      } else {
        o.material = this.bodyMat.clone();
        (o.material as THREE.MeshLambertMaterial).color.setHex(body);
      }
    });
  }

  private buildBird(): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(sharedBody, this.bodyMat);
    body.position.z = 0;
    g.add(body);

    const beak = new THREE.Mesh(sharedBeak, this.beakMat);
    beak.name = "beak";
    beak.position.set(0, 0, 0.22);
    g.add(beak);

    const wingL = new THREE.Mesh(sharedWing, this.wingMat);
    wingL.name = "wingL";
    wingL.position.set(-0.28, 0.02, 0);
    g.add(wingL);

    const wingR = new THREE.Mesh(sharedWing, this.wingMat);
    wingR.name = "wingR";
    wingR.position.set(0.28, 0.02, 0);
    g.add(wingR);

    g.scale.setScalar(0.85 + Math.random() * 0.4);
    return g;
  }

  private removeAt(i: number): void {
    const b = this.birds[i];
    if (!b) return;
    this.group.remove(b.mesh);
    b.mesh.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const m = o.material;
        // dispose only cloned mats (not shared defaults if still shared)
        if (m instanceof THREE.Material && m !== this.bodyMat && m !== this.wingMat && m !== this.beakMat) {
          m.dispose();
        }
      }
    });
    this.birds.splice(i, 1);
  }

  dispose(): void {
    while (this.birds.length) this.removeAt(0);
    this.bodyMat.dispose();
    this.wingMat.dispose();
    this.beakMat.dispose();
  }
}
