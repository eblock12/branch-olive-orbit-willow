import * as THREE from "three";
import { BLOCKS, isPlant, type BlockId } from "./blocks";
import { tileUVs } from "./textures";
import type { World } from "./world";
import type { Player } from "./player";

const DROP_SIZE = 0.28;
const PLANT_DROP = 0.36;
const GRAVITY = 18;
const BOUNCE = 0.42;
const FRICTION = 0.82;
const PICKUP_DELAY = 0.45;
const PICKUP_RADIUS = 1.35;
const MAGNET_RADIUS = 2.2;
const MAX_DROPS = 96;
const MAX_LIFE = 120; // seconds before despawn

type Drop = {
  id: BlockId;
  mesh: THREE.Mesh;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  spin: number;
  bob: number;
};

function buildDropGeometry(blockId: BlockId): THREE.BufferGeometry {
  const def = BLOCKS[blockId];
  const tiles = def?.tiles ?? [0, 0, 0];

  // Plants: flat cross so the flower sprite is readable as a pickup
  if (isPlant(blockId)) {
    const { u0, v0, u1, v1 } = tileUVs(tiles[2]!);
    const s = PLANT_DROP * 0.5;
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    let base = 0;
    const addPlane = (
      a: [number, number, number],
      b: [number, number, number],
      c: [number, number, number],
      d: [number, number, number],
      n: [number, number, number],
    ) => {
      for (const p of [a, b, c, d]) {
        positions.push(p[0], p[1], p[2]);
        normals.push(n[0], n[1], n[2]);
      }
      uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      base += 4;
      // backface
      for (const p of [a, d, c, b]) {
        positions.push(p[0], p[1], p[2]);
        normals.push(-n[0], -n[1], -n[2]);
      }
      uvs.push(u0, v0, u0, v1, u1, v1, u1, v0);

      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      base += 4;
    };
    addPlane([-s, -s, 0], [s, -s, 0], [s, s, 0], [-s, s, 0], [0, 0, 1]);
    addPlane([0, -s, -s], [0, -s, s], [0, s, s], [0, s, -s], [1, 0, 0]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    return geo;
  }

  const faceTiles = [
    tiles[2],
    tiles[2],
    tiles[0],
    tiles[1],
    tiles[2],
    tiles[2],
  ];

  const geo = new THREE.BoxGeometry(DROP_SIZE, DROP_SIZE, DROP_SIZE);
  const uvAttr = geo.getAttribute("uv") as THREE.BufferAttribute;
  for (let f = 0; f < 6; f++) {
    const { u0, v0, u1, v1 } = tileUVs(faceTiles[f]!);
    const base = f * 4;
    const pairs: [number, number][] = [
      [u0, v0],
      [u1, v0],
      [u1, v1],
      [u0, v1],
    ];
    for (let i = 0; i < 4; i++) {
      uvAttr.setXY(base + i, pairs[i]![0], pairs[i]![1]);
    }
  }
  uvAttr.needsUpdate = true;
  return geo;
}

export class ItemDropSystem {
  readonly group = new THREE.Group();
  private drops: Drop[] = [];
  private material: THREE.MeshLambertMaterial;
  private geoCache = new Map<number, THREE.BufferGeometry>();

  constructor(atlas: THREE.Texture) {
    this.material = new THREE.MeshLambertMaterial({
      map: atlas,
      transparent: true,
      alphaTest: 0.15,
      side: THREE.FrontSide,
    });
  }

  private geoFor(id: BlockId): THREE.BufferGeometry {
    let g = this.geoCache.get(id);
    if (!g) {
      g = buildDropGeometry(id);
      this.geoCache.set(id, g);
    }
    return g;
  }

  spawn(id: BlockId, x: number, y: number, z: number): void {
    if (!BLOCKS[id] || id === 0) return;
    // Cap: remove oldest
    while (this.drops.length >= MAX_DROPS) {
      this.removeAt(0);
    }
    const mesh = new THREE.Mesh(this.geoFor(id), this.material);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    // Slight random pop
    const ang = Math.random() * Math.PI * 2;
    const speed = 1.2 + Math.random() * 1.6;
    const drop: Drop = {
      id,
      mesh,
      x: x + 0.5 + (Math.random() - 0.5) * 0.15,
      y: y + 0.55,
      z: z + 0.5 + (Math.random() - 0.5) * 0.15,
      vx: Math.cos(ang) * speed * 0.55,
      vy: 3.2 + Math.random() * 1.8,
      vz: Math.sin(ang) * speed * 0.55,
      age: 0,
      spin: (Math.random() - 0.5) * 4,
      bob: Math.random() * Math.PI * 2,
    };
    mesh.position.set(drop.x, drop.y, drop.z);
    mesh.rotation.set(
      Math.random() * Math.PI,
      Math.random() * Math.PI,
      Math.random() * Math.PI,
    );
    this.group.add(mesh);
    this.drops.push(drop);
  }

  private removeAt(i: number): void {
    const d = this.drops[i];
    if (!d) return;
    this.group.remove(d.mesh);
    // geometry shared via cache — don't dispose mesh geometry
    this.drops.splice(i, 1);
  }

  /**
   * Physics + pickup. Returns list of picked block ids (for HUD/feedback).
   */
  update(
    dt: number,
    world: World,
    player: Player,
    tryPickup: (id: BlockId) => boolean,
  ): BlockId[] {
    const picked: BlockId[] = [];
    const px = player.x;
    const py = player.y + 0.9;
    const pz = player.z;

    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i]!;
      d.age += dt;
      if (d.age > MAX_LIFE) {
        this.removeAt(i);
        continue;
      }

      // Magnet toward player after pickup delay
      if (d.age >= PICKUP_DELAY) {
        const dx = px - d.x;
        const dy = py - d.y;
        const dz = pz - d.z;
        const dist = Math.hypot(dx, dy, dz);
        if (dist < PICKUP_RADIUS && dist > 1e-4) {
          if (tryPickup(d.id)) {
            picked.push(d.id);
            this.removeAt(i);
            continue;
          }
        } else if (dist < MAGNET_RADIUS && dist > 1e-4) {
          const pull = 10 * dt;
          d.vx += (dx / dist) * pull;
          d.vy += (dy / dist) * pull * 0.6;
          d.vz += (dz / dist) * pull;
        }
      }

      // Integrate velocity
      d.vy -= GRAVITY * dt;
      let nx = d.x + d.vx * dt;
      let ny = d.y + d.vy * dt;
      let nz = d.z + d.vz * dt;

      // Simple AABB vs solid blocks (point-ish with half size)
      const half = DROP_SIZE * 0.5;

      // Vertical
      if (this.solidAt(world, nx, ny - half, nz) && d.vy < 0) {
        ny = Math.floor(ny - half) + 1 + half + 1e-3;
        d.vy = -d.vy * BOUNCE;
        if (Math.abs(d.vy) < 0.6) d.vy = 0;
        d.vx *= FRICTION;
        d.vz *= FRICTION;
      } else if (this.solidAt(world, nx, ny + half, nz) && d.vy > 0) {
        ny = Math.floor(ny + half) - half - 1e-3;
        d.vy = 0;
      }

      // X
      if (this.solidAt(world, nx + Math.sign(d.vx) * half, ny, nz)) {
        nx = d.x;
        d.vx = -d.vx * BOUNCE * 0.5;
      }
      // Z
      if (this.solidAt(world, nx, ny, nz + Math.sign(d.vz) * half)) {
        nz = d.z;
        d.vz = -d.vz * BOUNCE * 0.5;
      }

      d.x = nx;
      d.y = ny;
      d.z = nz;

      // Ground settle
      if (d.y < 0.2) {
        d.y = 0.2;
        d.vy = Math.abs(d.vy) * BOUNCE;
      }

      // Spin + idle bob when nearly still
      d.mesh.rotation.y += d.spin * dt;
      d.mesh.rotation.x += d.spin * 0.35 * dt;
      d.bob += dt * 3.2;
      const rest = Math.hypot(d.vx, d.vz) < 0.15 && Math.abs(d.vy) < 0.15;
      const bobY = rest ? Math.sin(d.bob) * 0.04 : 0;
      d.mesh.position.set(d.x, d.y + bobY, d.z);
    }

    return picked;
  }

  private solidAt(world: World, x: number, y: number, z: number): boolean {
    return world.isSolidAt(x, y, z);
  }

  get count(): number {
    return this.drops.length;
  }

  dispose(): void {
    for (const d of this.drops) this.group.remove(d.mesh);
    this.drops = [];
    for (const g of this.geoCache.values()) g.dispose();
    this.geoCache.clear();
    this.material.dispose();
  }
}
