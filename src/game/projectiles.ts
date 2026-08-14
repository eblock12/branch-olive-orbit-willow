import * as THREE from "three";
import { isSolid } from "./blocks";
import type { World } from "./world";
import type { HostileSystem } from "./hostiles";
import type { CaterpillarSystem } from "./caterpillars";
import type { PassiveMobSystem } from "./passiveMobs";
import type { MobPunch } from "./loot";

const SPEED = 38;
const GRAVITY = 16;
const LIFE = 5.5;

type Arrow = {
  mesh: THREE.Mesh;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  damage: number;
};

/**
 * Simple hitscan-step arrows. One shared geometry; cheap enough for a handful
 * of shots at a time.
 */
export class ProjectileSystem {
  readonly group = new THREE.Group();
  private geo = new THREE.BoxGeometry(0.06, 0.06, 0.46);
  private mat = new THREE.MeshLambertMaterial({ color: 0xc8b898 });
  private list: Arrow[] = [];

  shoot(
    x: number,
    y: number,
    z: number,
    dx: number,
    dy: number,
    dz: number,
    damage = 5,
  ): void {
    const len = Math.hypot(dx, dy, dz) || 1;
    const nx = dx / len;
    const ny = dy / len;
    const nz = dz / len;
    const mesh = new THREE.Mesh(this.geo, this.mat);
    mesh.castShadow = true;
    const a: Arrow = {
      mesh,
      x: x + nx * 0.4,
      y: y + ny * 0.4,
      z: z + nz * 0.4,
      vx: nx * SPEED,
      vy: ny * SPEED,
      vz: nz * SPEED,
      age: 0,
      damage,
    };
    this.orient(a);
    mesh.position.set(a.x, a.y, a.z);
    this.group.add(mesh);
    this.list.push(a);
  }

  update(
    dt: number,
    world: World,
    hostiles: HostileSystem,
    caterpillars: CaterpillarSystem,
    animals: PassiveMobSystem,
  ): MobPunch[] {
    const hits: MobPunch[] = [];
    for (let i = this.list.length - 1; i >= 0; i--) {
      const a = this.list[i]!;
      a.age += dt;
      if (a.age > LIFE) {
        this.removeAt(i);
        continue;
      }
      a.vy -= GRAVITY * dt;
      const spd = Math.hypot(a.vx, a.vy, a.vz) || 1;
      const step = spd * dt;
      const ux = a.vx / spd;
      const uy = a.vy / spd;
      const uz = a.vz / spd;

      const punch =
        hostiles.tryPunch(a.x, a.y, a.z, ux, uy, uz, step + 0.25, a.damage) ||
        caterpillars.tryPunch(a.x, a.y, a.z, ux, uy, uz, step + 0.25, a.damage) ||
        animals.tryPunch(a.x, a.y, a.z, ux, uy, uz, step + 0.25, a.damage);
      if (punch) {
        hits.push(punch);
        this.removeAt(i);
        continue;
      }

      const nx = a.x + a.vx * dt;
      const ny = a.y + a.vy * dt;
      const nz = a.z + a.vz * dt;
      const bx = Math.floor(nx);
      const by = Math.floor(ny);
      const bz = Math.floor(nz);
      if (isSolid(world.getBlock(bx, by, bz))) {
        this.removeAt(i);
        continue;
      }
      a.x = nx;
      a.y = ny;
      a.z = nz;
      this.orient(a);
      a.mesh.position.set(a.x, a.y, a.z);
    }
    return hits;
  }

  private orient(a: Arrow): void {
    a.mesh.lookAt(a.x + a.vx, a.y + a.vy, a.z + a.vz);
  }

  private removeAt(i: number): void {
    const a = this.list[i];
    if (!a) return;
    this.group.remove(a.mesh);
    this.list.splice(i, 1);
  }

  dispose(): void {
    for (const a of this.list) this.group.remove(a.mesh);
    this.list = [];
    this.geo.dispose();
    this.mat.dispose();
  }
}
