import * as THREE from "three";
import { BLOCKS, isPlant, type BlockId } from "./blocks";
import { isTool, itemIconDataUrl, type ItemId } from "./items";
import { tileUVs } from "./textures";

export type HeldKind = "empty" | "block" | "tool";

/**
 * First-person right hand + held item, parented to the camera.
 * Ready for tools later via setHeldTool().
 */
export class ViewHand {
  readonly root = new THREE.Group();
  private armPivot = new THREE.Group();
  private arm: THREE.Mesh;
  private hand: THREE.Mesh;
  private itemRoot = new THREE.Group();
  private itemMesh: THREE.Mesh | null = null;
  private material: THREE.MeshLambertMaterial;
  private skinMat: THREE.MeshLambertMaterial;
  private sleeveMat: THREE.MeshLambertMaterial;

  private heldId: number = 0;
  private heldKind: HeldKind = "empty";
  private swing = 0; // 0..1 punch progress
  private swingDir = 0;
  private swingAmp = 1;
  private eatT = 0;
  private idleT = 0;
  private walkPhase = 0;
  private equipT = 1; // 0 just switched, 1 settled
  private visible = true;
  private moveAmount = 0; // 0..1 smoothed locomotion

  constructor(atlas: THREE.Texture, emissiveMap?: THREE.Texture) {
    this.material = new THREE.MeshLambertMaterial({
      map: atlas,
      emissive: emissiveMap ? 0xffffff : 0x000000,
      emissiveMap: emissiveMap ?? null,
      emissiveIntensity: emissiveMap ? 1.35 : 0,
      transparent: true,
      alphaTest: 0.12,
      side: THREE.DoubleSide,
      fog: false,
      depthTest: true,
      depthWrite: true,
    });
    this.skinMat = new THREE.MeshLambertMaterial({
      color: 0xc49a6c,
      flatShading: true,
      fog: false,
    });
    this.sleeveMat = new THREE.MeshLambertMaterial({
      color: 0x3d6eb5,
      flatShading: true,
      fog: false,
    });

    // Camera-local: lower-right, reaching into the world (-Z)
    this.root.position.set(0.32, -0.38, -0.5);
    this.root.add(this.armPivot);

    // Forearm / sleeve
    const armGeo = new THREE.BoxGeometry(0.12, 0.36, 0.12);
    this.arm = new THREE.Mesh(armGeo, this.sleeveMat);
    this.arm.position.set(0, -0.1, -0.04);
    this.arm.rotation.x = -0.55;
    this.armPivot.add(this.arm);

    // Hand / fist — further along the reach
    const handGeo = new THREE.BoxGeometry(0.14, 0.14, 0.16);
    this.hand = new THREE.Mesh(handGeo, this.skinMat);
    this.hand.position.set(0, -0.26, -0.08);
    this.armPivot.add(this.hand);

    // Held item sits in front of the fist
    this.itemRoot.position.set(0.04, -0.22, -0.18);
    this.armPivot.add(this.itemRoot);

    this.root.renderOrder = 10;
    this.root.frustumCulled = false;
  }

  attachTo(camera: THREE.Camera): void {
    camera.add(this.root);
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.root.visible = v;
  }

  /** Currently held inventory item (0 = empty) */
  setHeldItem(id: ItemId | number | null | undefined): void {
    const next = id && id !== 0 ? (id as number) : 0;
    if (next === this.heldId) return;
    this.heldId = next;
    this.heldKind = next
      ? isTool(next)
        ? "tool"
        : "block"
      : "empty";
    this.equipT = 0;
    this.rebuildItem();
  }

  /** @deprecated use setHeldItem */
  setHeldBlock(id: BlockId | number | null | undefined): void {
    this.setHeldItem(id);
  }

  /** Future tools — placeholder API */
  setHeldTool(_toolId: string | null): void {
    // Use setHeldItem with Item.* ids instead
  }

  /** Trigger punch / swing (mine break or place) */
  punch(amp = 1): void {
    this.swing = 0.001;
    this.swingDir = 1;
    this.swingAmp = amp;
  }

  /** Raise food to the mouth — separate from the attack arc. */
  eat(): void {
    this.eatT = 0.001;
  }

  /** Continuous dig bob while holding mine */
  setMining(mining: boolean): void {
    if (mining && this.swing <= 0) {
      this.swing = 0.001;
      this.swingDir = 1;
    }
  }

  /**
   * Locomotion for view-bob / sway.
   * @param speed horizontal speed (blocks/s)
   * @param onGround whether player is supported
   * @param moving intentional move input this frame
   */
  setMotion(speed: number, onGround: boolean, moving: boolean): void {
    const target =
      onGround && moving ? Math.min(1, speed / 5.5) : onGround ? Math.min(0.25, speed / 8) : 0;
    // smooth toward target
    this.moveAmount += (target - this.moveAmount) * 0.18;
    if (this.moveAmount < 0.001) this.moveAmount = 0;
  }

  update(dt: number): void {
    if (!this.visible) return;
    this.idleT += dt;

    // Equip slide-in
    if (this.equipT < 1) {
      this.equipT = Math.min(1, this.equipT + dt * 4.5);
    }

    // Walk cycle advances with move amount
    if (this.moveAmount > 0.02) {
      this.walkPhase += dt * (6.5 + this.moveAmount * 5.5);
    } else {
      // ease phase toward rest
      this.walkPhase *= 1 - Math.min(1, dt * 3);
    }

    // Swing cycle 0→1
    if (this.swing > 0) {
      this.swing += dt * 7.2 * this.swingDir;
      if (this.swing >= 1) {
        this.swing = 1;
        this.swingDir = -1;
      } else if (this.swingDir < 0 && this.swing <= 0) {
        this.swing = 0;
        this.swingDir = 0;
      }
    }
    if (this.eatT > 0) {
      this.eatT += dt * 3.4;
      if (this.eatT >= 1) this.eatT = 0;
    }

    const m = this.moveAmount;
    // Idle micro-bob (always)
    const idleBob =
      Math.sin(this.idleT * 2.1) * 0.01 + Math.sin(this.idleT * 1.3) * 0.005;
    // Walk sway — vertical + horizontal figure-8 style
    const walkY = Math.sin(this.walkPhase * 2) * 0.045 * m;
    const walkX = Math.sin(this.walkPhase) * 0.038 * m;
    const walkZ = Math.cos(this.walkPhase) * 0.02 * m;
    const walkRoll = Math.sin(this.walkPhase) * 0.12 * m;
    const walkPitch = Math.cos(this.walkPhase * 2) * 0.06 * m;

    const equipDrop = (1 - easeOutCubic(this.equipT)) * 0.35;

    // Base pose
    let rotX = -0.08 + idleBob * 0.35 + walkPitch;
    let rotY = -0.18 + walkX * 0.35;
    let rotZ = 0.06 + walkRoll;
    let posY = idleBob + walkY - equipDrop;
    let posX = walkX * 0.85;
    let posZ = walkZ;

    // Punch arc — Minecraft-ish diagonal swing
    if (this.swing > 0) {
      const s = this.swing;
      const e = Math.sin(s * Math.PI) * this.swingAmp;
      rotX += -1.15 * e;
      rotY += -0.72 * e;
      rotZ += 0.48 * e;
      posY += 0.1 * e;
      posX += 0.1 * e;
      posZ += -0.18 * e;
    }

    // Eat — lift toward the camera / mouth
    if (this.eatT > 0) {
      const e = Math.sin(this.eatT * Math.PI);
      const snap = this.eatT > 0.45 && this.eatT < 0.7 ? 0.06 : 0;
      rotX += -1.35 * e;
      rotY += 0.35 * e;
      rotZ += -0.2 * e;
      posY += 0.28 * e;
      posX += -0.2 * e;
      posZ += 0.12 * e + snap;
    }

    this.armPivot.position.set(posX, posY, posZ);
    this.armPivot.rotation.set(rotX, rotY, rotZ);
  }

  dispose(): void {
    this.clearItem();
    this.arm.geometry.dispose();
    this.hand.geometry.dispose();
    this.skinMat.dispose();
    this.sleeveMat.dispose();
    this.material.dispose();
  }

  private rebuildItem(): void {
    this.clearItem();
    if (!this.heldId || this.heldKind === "empty") {
      this.hand.scale.set(1, 1, 1);
      return;
    }
    this.hand.scale.set(0.95, 0.95, 0.9);

    if (isTool(this.heldId) || this.heldId >= 100) {
      // Flat textured plane using procedural tool icon
      const url = itemIconDataUrl(this.heldId);
      if (url) {
        const loader = new THREE.TextureLoader();
        const tex = loader.load(url);
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        tex.colorSpace = THREE.SRGBColorSpace;
        const mat = new THREE.MeshBasicMaterial({
          map: tex,
          transparent: true,
          alphaTest: 0.1,
          side: THREE.DoubleSide,
          fog: false,
          depthTest: true,
        });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.45), mat);
        mesh.position.set(0.06, 0.08, -0.12);
        mesh.rotation.set(-0.4, 0.7, 0.5);
        this.itemMesh = mesh;
        this.itemRoot.add(mesh);
        return;
      }
    }

    const geo = buildHeldGeometry(this.heldId as BlockId);
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    if (isPlant(this.heldId)) {
      mesh.scale.set(0.55, 0.55, 0.55);
      mesh.position.set(0.02, 0.06, -0.04);
      mesh.rotation.set(-0.2, 0.4, 0.15);
    } else {
      mesh.scale.set(0.32, 0.32, 0.32);
      mesh.position.set(0.04, 0.04, -0.08);
      mesh.rotation.set(0.25, 0.55, 0.1);
    }
    this.itemMesh = mesh;
    this.itemRoot.add(mesh);
  }

  private clearItem(): void {
    if (this.itemMesh) {
      this.itemRoot.remove(this.itemMesh);
      this.itemMesh.geometry.dispose();
      this.itemMesh = null;
    }
  }
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function buildHeldGeometry(blockId: BlockId): THREE.BufferGeometry {
  const def = BLOCKS[blockId];
  const tiles = def?.tiles ?? [0, 0, 0];

  if (isPlant(blockId)) {
    const { u0, v0, u1, v1 } = tileUVs(tiles[2]!);
    const s = 0.5;
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
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const uvAttr = geo.getAttribute("uv") as THREE.BufferAttribute;
  for (let f = 0; f < 6; f++) {
    const { u0, v0, u1, v1 } = tileUVs(faceTiles[f]!);
    const base = f * 4;
    // BoxGeometry verts per face: TL, TR, BL, BR (uv y-down in the builder)
    const pairs: [number, number][] = [
      [u0, v1],
      [u1, v1],
      [u0, v0],
      [u1, v0],
    ];
    for (let i = 0; i < 4; i++) {
      uvAttr.setXY(base + i, pairs[i]![0], pairs[i]![1]);
    }
  }
  uvAttr.needsUpdate = true;
  return geo;
}
