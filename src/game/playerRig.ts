import * as THREE from "three";
import { Item, armorInfo, type ItemId } from "./items";
import type { HotbarSlot } from "./survival";

const SKIN = 0xd4a574;
const HAIR = 0x3a2414;
const SHIRT = 0x3d6b5a;
const PANTS = 0x2c3340;
const SHOE = 0x4a3424;

function box(
  w: number,
  h: number,
  d: number,
  color: number,
  y: number,
  x = 0,
  z = 0,
  extra?: THREE.Material,
): THREE.Mesh {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mat =
    extra ??
    new THREE.MeshLambertMaterial({
      color,
      transparent: true,
      opacity: 1,
    });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = false;
  m.receiveShadow = false;
  return m;
}

function faceTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 8;
  c.height = 8;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#d4a574";
  ctx.fillRect(0, 0, 8, 8);
  ctx.fillStyle = "#c48e5c";
  ctx.fillRect(0, 0, 8, 2);
  ctx.fillStyle = "#f4f0e8";
  ctx.fillRect(1, 3, 2, 2);
  ctx.fillRect(5, 3, 2, 2);
  ctx.fillStyle = "#2a2018";
  ctx.fillRect(2, 3, 1, 2);
  ctx.fillRect(5, 3, 1, 2);
  ctx.fillStyle = "#b07850";
  ctx.fillRect(3, 6, 2, 1);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

function armorTint(id: ItemId | undefined): number | null {
  if (!id) return null;
  if (
    id === Item.IRON_HELM ||
    id === Item.IRON_CHEST ||
    id === Item.IRON_LEGS ||
    id === Item.IRON_BOOTS
  ) {
    return 0xc8ccd4;
  }
  if (
    id === Item.LEATHER_HELM ||
    id === Item.LEATHER_CHEST ||
    id === Item.LEATHER_LEGS ||
    id === Item.LEATHER_BOOTS
  ) {
    return 0x8a5a32;
  }
  return armorInfo(id) ? 0x8a5a32 : null;
}

/** Blocky third-person stand-in for the inventory doll. */
export class PlayerRig {
  readonly group = new THREE.Group();
  yaw = 0.35;
  private t = 0;
  private readonly hair: THREE.Mesh;
  private readonly helm: THREE.Group;
  private readonly chest: THREE.Mesh;
  private readonly pants: THREE.Mesh;
  private readonly bootL: THREE.Mesh;
  private readonly bootR: THREE.Mesh;
  private readonly armL: THREE.Mesh;
  private readonly armR: THREE.Mesh;
  private readonly faceTex: THREE.CanvasTexture;
  private lastKey = "";

  constructor() {
    this.faceTex = faceTexture();
    const skinMat = new THREE.MeshLambertMaterial({ color: SKIN });
    const faceMat = new THREE.MeshLambertMaterial({ map: this.faceTex });
    const headMats = [
      skinMat,
      skinMat,
      new THREE.MeshLambertMaterial({ color: HAIR }),
      skinMat,
      faceMat,
      skinMat,
    ];
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), headMats);
    head.position.set(0, 1.55, 0);
    this.group.add(head);

    this.hair = box(0.54, 0.16, 0.54, HAIR, 1.78);
    this.group.add(this.hair);

    this.group.add(box(0.5, 0.72, 0.28, SHIRT, 0.94));
    this.armL = box(0.22, 0.72, 0.22, SKIN, 0.94, -0.37);
    this.armR = box(0.22, 0.72, 0.22, SKIN, 0.94, 0.37);
    this.group.add(this.armL, this.armR);

    this.group.add(box(0.24, 0.72, 0.24, PANTS, 0.38, -0.13));
    this.group.add(box(0.24, 0.72, 0.24, PANTS, 0.38, 0.13));
    this.group.add(box(0.26, 0.14, 0.28, SHOE, 0.07, -0.13));
    this.group.add(box(0.26, 0.14, 0.28, SHOE, 0.07, 0.13));

    this.helm = this.makeOpenHelm();
    this.chest = box(0.56, 0.76, 0.36, 0xc8ccd4, 0.94);
    this.pants = box(0.54, 0.5, 0.32, 0xc8ccd4, 0.48);
    this.bootL = box(0.28, 0.2, 0.32, 0xc8ccd4, 0.1, -0.13);
    this.bootR = box(0.28, 0.2, 0.32, 0xc8ccd4, 0.1, 0.13);
    this.helm.visible = false;
    this.group.add(this.helm);
    for (const p of [this.chest, this.pants, this.bootL, this.bootR]) {
      p.visible = false;
      this.group.add(p);
    }

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 20),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
      }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.01;
    this.group.add(shadow);
  }

  update(dt: number, autoSpin: boolean): void {
    this.t += dt;
    if (autoSpin) this.yaw += dt * 0.55;
    this.group.rotation.y = this.yaw;
    const breathe = Math.sin(this.t * 2.1) * 0.018;
    this.armL.rotation.x = breathe * 1.4 + 0.04;
    this.armR.rotation.x = -breathe * 1.4 + 0.04;
    this.armL.rotation.z = 0.06;
    this.armR.rotation.z = -0.06;
  }

  setArmor(slots: HotbarSlot[]): void {
    const ids = [0, 1, 2, 3].map((i) => slots[i]?.id ?? 0);
    const key = ids.join(",");
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.applyPiece(this.helm, slots[0]?.id, true);
    this.applyPiece(this.chest, slots[1]?.id, false);
    this.applyPiece(this.pants, slots[2]?.id, false);
    const boot = armorTint(slots[3]?.id);
    this.bootL.visible = boot != null;
    this.bootR.visible = boot != null;
    if (boot != null) {
      (this.bootL.material as THREE.MeshLambertMaterial).color.setHex(boot);
      (this.bootR.material as THREE.MeshLambertMaterial).color.setHex(boot);
    }
    this.hair.visible = !this.helm.visible;
  }

  /** Crown + sides + brow — face stays open so the eyes read. */
  private makeOpenHelm(): THREE.Group {
    const g = new THREE.Group();
    const c = 0xc8ccd4;
    g.add(box(0.56, 0.14, 0.56, c, 1.79));
    g.add(box(0.56, 0.3, 0.08, c, 1.58, 0, -0.25));
    g.add(box(0.08, 0.3, 0.46, c, 1.58, -0.25, -0.03));
    g.add(box(0.08, 0.3, 0.46, c, 1.58, 0.25, -0.03));
    g.add(box(0.54, 0.07, 0.1, c, 1.705, 0, 0.24));
    return g;
  }

  private applyPiece(
    mesh: THREE.Object3D,
    id: ItemId | undefined,
    isHelm: boolean,
  ): void {
    const tint = armorTint(id);
    mesh.visible = tint != null;
    if (tint == null) return;
    mesh.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const mat = o.material as THREE.MeshLambertMaterial;
      if (!mat?.color) return;
      mat.color.setHex(tint);
      mat.emissive?.setHex(isHelm && tint > 0xb0b0b0 ? 0x1a1c20 : 0x000000);
    });
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m.dispose();
      }
    });
    this.faceTex.dispose();
  }
}
