import * as THREE from "three";
import { BLOCKS, Block, isPlant, isWater, waterLevel, type BlockId } from "./blocks";
import { isBlockItem, itemColor, type ItemId, type ItemStack } from "./items";
import { tileUVs } from "./textures";
import type { World } from "./world";
import type { Player } from "./player";

const DROP_SIZE = 0.28;
const PLANT_DROP = 0.36;
const GRAVITY = 18;
const WATER_SINK = 3.2;
const WATER_SINK_MAX = 1.05;
const WATER_DRAG = 8;
const WATER_ENTER_MAX = 3.6;
const FLOW_PUSH = 2.4;
const BOUNCE = 0.42;
const FRICTION = 0.82;
const PICKUP_DELAY = 0.45;
const PICKUP_RADIUS = 1.35;
const MAGNET_RADIUS = 2.2;
const MAX_DROPS = 96;
const MAX_LIFE = 120; // seconds before despawn
const DEATH_LIFE = 600; // 10 min — enough to walk back from spawn

type Drop = {
  id: ItemId;
  count: number;
  durability?: number;
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
  maxAge: number;
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
  private itemMatCache = new Map<number, THREE.MeshLambertMaterial>();
  private nuggetGeo = new THREE.BoxGeometry(0.2, 0.14, 0.2);

  constructor(atlas: THREE.Texture, emissiveMap?: THREE.Texture) {
    this.material = new THREE.MeshLambertMaterial({
      map: atlas,
      emissive: emissiveMap ? 0xffffff : 0x000000,
      emissiveMap: emissiveMap ?? null,
      emissiveIntensity: emissiveMap ? 1.35 : 0,
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

  spawn(id: ItemId, x: number, y: number, z: number): void {
    if (!id) return;
    if (isBlockItem(id) && !BLOCKS[id]) return;
    // Cap: remove oldest
    while (this.drops.length >= MAX_DROPS) {
      this.removeAt(0);
    }
    let mesh: THREE.Mesh;
    if (isBlockItem(id)) {
      mesh = new THREE.Mesh(this.geoFor(id as BlockId), this.material);
    } else {
      let mat = this.itemMatCache.get(id);
      if (!mat) {
        mat = new THREE.MeshLambertMaterial({
          color: new THREE.Color(itemColor(id)),
        });
        this.itemMatCache.set(id, mat);
      }
      mesh = new THREE.Mesh(this.nuggetGeo, mat);
    }
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    // Slight random pop
    const ang = Math.random() * Math.PI * 2;
    const speed = 1.2 + Math.random() * 1.6;
    const drop: Drop = {
      id,
      count: 1,
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
      maxAge: MAX_LIFE,
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

  /** Toss from the player — world-space origin + velocity, longer pickup delay. */
  throwFrom(
    id: ItemId,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
  ): void {
    if (!id) return;
    if (isBlockItem(id) && !BLOCKS[id]) return;
    while (this.drops.length >= MAX_DROPS) this.removeAt(0);
    let mesh: THREE.Mesh;
    if (isBlockItem(id)) {
      mesh = new THREE.Mesh(this.geoFor(id as BlockId), this.material);
    } else {
      let mat = this.itemMatCache.get(id);
      if (!mat) {
        mat = new THREE.MeshLambertMaterial({
          color: new THREE.Color(itemColor(id)),
        });
        this.itemMatCache.set(id, mat);
      }
      mesh = new THREE.Mesh(this.nuggetGeo, mat);
    }
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    const drop: Drop = {
      id,
      count: 1,
      mesh,
      x,
      y,
      z,
      vx,
      vy,
      vz,
      age: -0.45,
      spin: (Math.random() - 0.5) * 5,
      bob: Math.random() * Math.PI * 2,
      maxAge: MAX_LIFE,
    };
    mesh.position.set(x, y, z);
    mesh.rotation.set(
      Math.random() * Math.PI,
      Math.random() * Math.PI,
      Math.random() * Math.PI,
    );
    this.group.add(mesh);
    this.drops.push(drop);
  }

  /** Scatter a full stack (death loot). Longer life, delayed magnet. */
  spawnStack(
    stack: ItemStack,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
  ): void {
    if (!stack.id || stack.count <= 0) return;
    if (isBlockItem(stack.id) && !BLOCKS[stack.id]) return;
    while (this.drops.length >= MAX_DROPS) this.removeAt(0);
    let mesh: THREE.Mesh;
    if (isBlockItem(stack.id)) {
      mesh = new THREE.Mesh(this.geoFor(stack.id as BlockId), this.material);
    } else {
      let mat = this.itemMatCache.get(stack.id);
      if (!mat) {
        mat = new THREE.MeshLambertMaterial({
          color: new THREE.Color(itemColor(stack.id)),
        });
        this.itemMatCache.set(stack.id, mat);
      }
      mesh = new THREE.Mesh(this.nuggetGeo, mat);
    }
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    const drop: Drop = {
      id: stack.id,
      count: stack.count,
      durability: stack.durability,
      mesh,
      x,
      y,
      z,
      vx,
      vy,
      vz,
      age: -1.4,
      spin: (Math.random() - 0.5) * 6,
      bob: Math.random() * Math.PI * 2,
      maxAge: DEATH_LIFE,
    };
    mesh.position.set(x, y, z);
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
    tryPickup: (id: ItemId, count: number, durability?: number) => number,
  ): ItemId[] {
    const picked: ItemId[] = [];
    const px = player.x;
    const py = player.y + 0.9;
    const pz = player.z;

    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i]!;
      d.age += dt;
      if (d.age > d.maxAge) {
        this.removeAt(i);
        continue;
      }

      const inWater = this.waterAt(world, d.x, d.y, d.z);

      // Magnet toward player after pickup delay
      if (d.age >= PICKUP_DELAY) {
        const dx = px - d.x;
        const dy = py - d.y;
        const dz = pz - d.z;
        const dist = Math.hypot(dx, dy, dz);
        if (dist < PICKUP_RADIUS && dist > 1e-4) {
          const took = tryPickup(d.id, d.count, d.durability);
          if (took > 0) {
            d.count -= took;
            if (d.count <= 0) {
              picked.push(d.id);
              this.removeAt(i);
              continue;
            }
          }
        } else if (dist < MAGNET_RADIUS && dist > 1e-4) {
          const pull = (inWater ? 4.5 : 10) * dt;
          d.vx += (dx / dist) * pull;
          d.vy += (dy / dist) * pull * (inWater ? 0.35 : 0.6);
          d.vz += (dz / dist) * pull;
        }
      }

      // Water: heavy drag, slow sink, follow currents — do not float
      if (inWater) {
        if (d.vy < -WATER_ENTER_MAX) d.vy = -WATER_ENTER_MAX;
        const drag = Math.exp(-WATER_DRAG * dt);
        d.vx *= drag;
        d.vy *= drag;
        d.vz *= drag;
        d.vy -= WATER_SINK * dt;
        if (d.vy < -WATER_SINK_MAX) d.vy = -WATER_SINK_MAX;
        const [fx, fz, fall] = this.flowAt(world, d.x, d.y, d.z);
        d.vx += fx * FLOW_PUSH * dt;
        d.vz += fz * FLOW_PUSH * dt;
        if (fall) d.vy = Math.min(d.vy, -WATER_SINK_MAX * 0.85);
      } else {
        d.vy -= GRAVITY * dt;
      }

      let nx = d.x + d.vx * dt;
      let ny = d.y + d.vy * dt;
      let nz = d.z + d.vz * dt;

      // Simple AABB vs solid blocks (point-ish with half size)
      const half = DROP_SIZE * 0.5;

      // Vertical
      if (this.solidAt(world, nx, ny - half, nz) && d.vy < 0) {
        ny = Math.floor(ny - half) + 1 + half + 1e-3;
        d.vy = inWater ? 0 : -d.vy * BOUNCE;
        if (Math.abs(d.vy) < 0.6) d.vy = 0;
        d.vx *= inWater ? 0.55 : FRICTION;
        d.vz *= inWater ? 0.55 : FRICTION;
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

  private waterAt(world: World, x: number, y: number, z: number): boolean {
    return isWater(world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)));
  }

  /** Flow toward lower water / a drop-off. */
  private flowAt(
    world: World,
    x: number,
    y: number,
    z: number,
  ): [number, number, boolean] {
    const bx = Math.floor(x);
    const by = Math.floor(y);
    const bz = Math.floor(z);
    const here = world.getBlock(bx, by, bz);
    const lvl = waterLevel(here);
    if (lvl <= 0) return [0, 0, false];
    const below = world.getBlock(bx, by - 1, bz);
    const fall = isWater(below) || below === Block.AIR;
    let fx = 0;
    let fz = 0;
    const dirs: [number, number][] = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [dx, dz] of dirs) {
      const n = world.getBlock(bx + dx, by, bz + dz);
      const nl = waterLevel(n);
      const nBelow = world.getBlock(bx + dx, by - 1, bz + dz);
      if (nl > 0 && nl < lvl) {
        fx += dx;
        fz += dz;
      } else if (n === Block.AIR && (isWater(nBelow) || nBelow === Block.AIR)) {
        fx += dx * 1.4;
        fz += dz * 1.4;
      }
    }
    const len = Math.hypot(fx, fz);
    if (len > 1e-4) {
      fx /= len;
      fz /= len;
    }
    return [fx, fz, fall && lvl < 8];
  }

  get count(): number {
    return this.drops.length;
  }

  dispose(): void {
    for (const d of this.drops) this.group.remove(d.mesh);
    this.drops = [];
    for (const g of this.geoCache.values()) g.dispose();
    this.geoCache.clear();
    this.nuggetGeo.dispose();
    for (const m of this.itemMatCache.values()) m.dispose();
    this.itemMatCache.clear();
    this.material.dispose();
  }
}
