import * as THREE from "three";
import { ATLAS_TILES, TILE_SIZE } from "./blocks";
import type { World } from "./world";

type Actor = {
  key: string;
  x: number;
  y: number;
  z: number;
  group: THREE.Group;
  lidPivot: THREE.Group;
  amt: number;
};

const OPEN_ANGLE = 1.92;
const EASE = 11;

export class ChestVisuals {
  readonly group = new THREE.Group();
  private actors = new Map<string, Actor>();
  private mats: THREE.MeshLambertMaterial[] = [];
  private openKey: string | null = null;
  private geos: THREE.BufferGeometry[] = [];

  constructor(atlas: THREE.Texture) {
    const img = atlas.image as HTMLCanvasElement | undefined;
    const top = this.tileMat(img, 44);
    const front = this.tileMat(img, 45);
    const side = this.tileMat(img, 46);
    const dark = new THREE.MeshLambertMaterial({ color: 0x3a2414 });
    this.mats.push(top, front, side, dark);

    const bodyGeo = new THREE.BoxGeometry(14 / 16, 10 / 16, 14 / 16);
    const lidGeo = new THREE.BoxGeometry(14 / 16, 5 / 16, 14 / 16);
    const latchGeo = new THREE.BoxGeometry(2 / 16, 4 / 16, 1 / 16);
    this.geos.push(bodyGeo, lidGeo, latchGeo);
    this.bodyGeo = bodyGeo;
    this.lidGeo = lidGeo;
    this.latchGeo = latchGeo;
    this.top = top;
    this.front = front;
    this.side = side;
    this.dark = dark;
  }

  private bodyGeo!: THREE.BoxGeometry;
  private lidGeo!: THREE.BoxGeometry;
  private latchGeo!: THREE.BoxGeometry;
  private top!: THREE.MeshLambertMaterial;
  private front!: THREE.MeshLambertMaterial;
  private side!: THREE.MeshLambertMaterial;
  private dark!: THREE.MeshLambertMaterial;

  private tileMat(
    img: HTMLCanvasElement | undefined,
    tile: number,
  ): THREE.MeshLambertMaterial {
    if (!img) {
      return new THREE.MeshLambertMaterial({ color: 0xb07a32 });
    }
    const c = document.createElement("canvas");
    c.width = TILE_SIZE;
    c.height = TILE_SIZE;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    const col = tile % ATLAS_TILES;
    const row = Math.floor(tile / ATLAS_TILES);
    ctx.drawImage(
      img,
      col * TILE_SIZE,
      row * TILE_SIZE,
      TILE_SIZE,
      TILE_SIZE,
      0,
      0,
      TILE_SIZE,
      TILE_SIZE,
    );
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshLambertMaterial({ map: tex });
  }

  setOpen(x: number, y: number, z: number, open: boolean): void {
    this.openKey = open ? `${x},${y},${z}` : null;
  }

  update(dt: number, world: World, px: number, py: number, pz: number): void {
    const keep = new Set<string>();
    const near = world.chestsNear(px, py, pz, 40);
    for (const p of near) {
      const key = `${p.x},${p.y},${p.z}`;
      keep.add(key);
      let a = this.actors.get(key);
      if (!a) {
        a = this.spawn(p.x, p.y, p.z);
        this.actors.set(key, a);
      }
      const want = this.openKey === key ? 1 : 0;
      a.amt += (want - a.amt) * (1 - Math.exp(-EASE * dt));
      if (Math.abs(a.amt - want) < 0.001) a.amt = want;
      a.lidPivot.rotation.x = a.amt * OPEN_ANGLE;
    }
    for (const [key, a] of this.actors) {
      if (keep.has(key)) continue;
      this.group.remove(a.group);
      this.actors.delete(key);
    }
  }

  private spawn(x: number, y: number, z: number): Actor {
    const group = new THREE.Group();
    group.position.set(x, y, z);

    const bodyMats = [
      this.side, this.side, this.dark, this.side, this.front, this.side,
    ];
    const body = new THREE.Mesh(this.bodyGeo, bodyMats);
    body.position.set(0.5, 5 / 16, 0.5);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const lidPivot = new THREE.Group();
    lidPivot.position.set(0.5, 10 / 16, 15 / 16);
    const lidMats = [
      this.side, this.side, this.top, this.dark, this.front, this.side,
    ];
    const lid = new THREE.Mesh(this.lidGeo, lidMats);
    lid.position.set(0, 2.5 / 16, -7 / 16);
    lid.castShadow = true;
    lidPivot.add(lid);

    const latch = new THREE.Mesh(this.latchGeo, this.front);
    latch.position.set(0, 0.5 / 16, -14 / 16);
    lidPivot.add(latch);
    group.add(lidPivot);

    this.group.add(group);
    return { key: `${x},${y},${z}`, x, y, z, group, lidPivot, amt: 0 };
  }

  dispose(): void {
    for (const a of this.actors.values()) this.group.remove(a.group);
    this.actors.clear();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) {
      m.map?.dispose();
      m.dispose();
    }
    this.mats = [];
  }
}
