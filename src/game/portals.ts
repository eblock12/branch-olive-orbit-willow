import * as THREE from "three";
import { Block, isPortal } from "./blocks";
import type { Player } from "./player";
import type { World } from "./world";
import {
  STRUCT_CELL,
  cellHasLinkedPortal,
  portalAnchor,
  portalPartnerCell,
  PORTAL_INNER_W,
  PORTAL_INNER_H,
  STARTER_PORTAL_CELL,
} from "./structures";

export type PortalFrame = {
  key: string;
  cellX: number;
  cellZ: number;
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  cx: number;
  cy: number;
  cz: number;
};

const PORTAL_LAYER = 1;
const SCAN_CELLS = 6;
/** Warp this far in front of the glass so the eye never crosses camera.near. */
const WARP_PAD = 0.1;

export class PortalSystem {
  readonly group = new THREE.Group();
  private frames: PortalFrame[] = [];
  private meshes = new Map<string, THREE.Mesh>();
  private framed = new Set<string>();
  private starterBuilt = false;
  private rt: THREE.WebGLRenderTarget;
  private liveMat: THREE.MeshBasicMaterial;
  private veilMat: THREE.MeshBasicMaterial;
  private portalCam = new THREE.PerspectiveCamera(75, 1, 0.12, 180);
  private cooldown = 0;
  private prevX = 0;
  private prevY = 0;
  private prevZ = 0;
  private primed = false;
  private liveKey: string | null = null;
  private stickyFoci: { x: number; z: number; r: number }[] = [];
  private stickyUntil = 0;
  private justExited: string | null = null;
  private tmpSize = new THREE.Vector2();
  private tmpColor = new THREE.Color();
  private pe = new THREE.Vector3();
  private look = new THREE.Vector3();
  private pa = new THREE.Vector3();
  private pb = new THREE.Vector3();
  private pc = new THREE.Vector3();
  private vr = new THREE.Vector3();
  private vu = new THREE.Vector3();
  private vn = new THREE.Vector3();
  private va = new THREE.Vector3();
  private vb = new THREE.Vector3();
  private vc = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.group.name = "portals";
    scene.add(this.group);
    this.rt = new THREE.WebGLRenderTarget(512, 288, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
    });
    this.rt.texture.colorSpace = THREE.SRGBColorSpace;
    this.liveMat = new THREE.MeshBasicMaterial({
      map: this.rt.texture,
      toneMapped: false,
      side: THREE.FrontSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    });
    this.veilMat = new THREE.MeshBasicMaterial({
      color: 0x7a34d4,
      transparent: true,
      opacity: 0.82,
      side: THREE.FrontSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    });
    this.portalCam.rotation.order = "YXZ";
    this.portalCam.layers.enable(0);
    this.portalCam.layers.disable(PORTAL_LAYER);
  }

  dispose(): void {
    this.clearMeshes();
    this.rt.dispose();
    this.liveMat.dispose();
    this.veilMat.dispose();
    this.group.parent?.remove(this.group);
  }

  /** Sync-load far sides of any gate the spawn camera can see. */
  preloadVisibleExits(world: World, px: number, pz: number): void {
    const foci: { x: number; z: number; r: number }[] = [];
    const c0x = Math.floor(px / STRUCT_CELL);
    const c0z = Math.floor(pz / STRUCT_CELL);
    for (let cz = c0z - SCAN_CELLS; cz <= c0z + SCAN_CELLS; cz++) {
      for (let cx = c0x - SCAN_CELLS; cx <= c0x + SCAN_CELLS; cx++) {
        if (!cellHasLinkedPortal(cx, cz, world.seed)) continue;
        const a = portalAnchor(cx, cz, world.seed);
        const d = Math.hypot(px - (a.ox + 2), pz - a.oz);
        if (d > 64) continue;
        const [pcx, pcz] = portalPartnerCell(cx, cz);
        const dest = portalAnchor(pcx, pcz, world.seed);
        foci.push({ x: a.ox + 2, z: a.oz, r: 5 });
        foci.push({ x: dest.ox + 2, z: dest.oz, r: 6 });
        this.stickyFoci = [
          { x: a.ox + 2, z: a.oz, r: 5 },
          { x: dest.ox + 2, z: dest.oz, r: 6 },
        ];
        this.stickyUntil = 10;
        world.setStreamFoci(foci);
        world.prepareAround(dest.ox + 2, dest.oz, 4, false);
      }
    }
    if (foci.length > 0) world.setStreamFoci(foci);
  }

  update(dt: number, world: World, player: Player): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.stickyUntil > 0) this.stickyUntil = Math.max(0, this.stickyUntil - dt);
    this.rescan(world, player.x, player.z);
    this.ensureStarterGate(world);
    this.dressFrames(world);
    this.syncMeshes();
    this.hintExitStreaming(world, player);
    if (!this.primed) {
      this.prevX = player.x;
      this.prevY = player.y;
      this.prevZ = player.z;
      this.primed = true;
    }
  }

  tryTeleport(player: Player, world: World): boolean {
    if (this.cooldown > 0) {
      this.prevX = player.x;
      this.prevY = player.y;
      this.prevZ = player.z;
      return false;
    }
    for (const frame of this.frames) {
      if (this.justExited && frame.key === this.justExited) {
        const away =
          Math.abs(player.z - frame.cz) > 0.95 ||
          player.x < frame.x0 - 0.6 ||
          player.x > frame.x1 + 1.6;
        if (away) this.justExited = null;
        else continue;
      }
      if (!this.crossed(frame, player) && !this.inWarpStrip(frame, player)) {
        continue;
      }
      const dest = this.partnerOf(frame, world);
      if (!dest) continue;
      this.pinPair(frame, dest);
      this.applyWarp(player, frame, dest);
      this.justExited = dest.key;
      world.setStreamFoci(this.stickyFoci);
      world.prepareAround(player.x, player.z, 3);
      this.cooldown = 1.1;
      this.prevX = player.x;
      this.prevY = player.y;
      this.prevZ = player.z;
      return true;
    }
    this.prevX = player.x;
    this.prevY = player.y;
    this.prevZ = player.z;
    return false;
  }

  tryWarpEntity(
    world: World,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    prevX: number,
    prevY: number,
    prevZ: number,
  ): { x: number; y: number; z: number; vx: number; vy: number; vz: number } | null {
    for (const frame of this.frames) {
      if (
        !this.crossedAt(frame, x, y, z, prevX, prevY, prevZ) &&
        !this.inWarpStripAt(frame, x, y, z)
      ) {
        continue;
      }
      const dest = this.partnerOf(frame, world);
      if (!dest) continue;
      this.pinPair(frame, dest);
      world.setStreamFoci(this.stickyFoci);
      const lx = x - frame.cx;
      const ly = y - frame.y0;
      const lz = z - frame.cz;
      let nx = dest.cx - lx;
      let ny = dest.y0 + ly;
      let nz = dest.cz - lz;
      const out = Math.sign(nz - dest.cz) || 1;
      const destFace = dest.cz + out * 0.5;
      nz = destFace + out * (WARP_PAD + 0.18);
      return { x: nx, y: ny, z: nz, vx: -vx, vy, vz: -vz };
    }
    return null;
  }

  /** XZ distance, using a portal hop if that path is shorter. */
  shortPathDist(world: World, x: number, z: number, px: number, pz: number): number {
    let best = Math.hypot(x - px, z - pz);
    for (const frame of this.frames) {
      const dest = this.partnerOf(frame, world);
      if (!dest) continue;
      const viaDest =
        Math.hypot(x - dest.cx, z - dest.cz) +
        Math.hypot(px - frame.cx, pz - frame.cz);
      const viaHere =
        Math.hypot(x - frame.cx, z - frame.cz) +
        Math.hypot(px - dest.cx, pz - dest.cz);
      if (viaDest < best) best = viaDest;
      if (viaHere < best) best = viaHere;
    }
    return best;
  }

  /** Dest pads just outside the paired opening, or empty if this cell isn't a rift. */
  mapWater(world: World, x: number, y: number, z: number): { x: number; y: number; z: number }[] {
    const frame = this.frameForWaterCell(world, x, y, z);
    if (!frame) return [];
    const dest = this.partnerOf(frame, world);
    if (!dest) return [];
    this.pinPair(frame, dest);
    world.setStreamFoci(this.stickyFoci);
    const dx = dest.x1 - (x - frame.x0);
    const dy = dest.y0 + (y - frame.y0);
    return [
      { x: dx, y: dy, z: dest.z0 + 1 },
      { x: dx, y: dy, z: dest.z0 - 1 },
    ];
  }

  private frameForWaterCell(
    world: World,
    x: number,
    y: number,
    z: number,
  ): PortalFrame | null {
    for (const f of this.frames) {
      if (this.openingCell(f, x, y, z)) return f;
    }
    const cx = Math.floor(x / STRUCT_CELL);
    const cz = Math.floor(z / STRUCT_CELL);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!cellHasLinkedPortal(cx + dx, cz + dz, world.seed)) continue;
        const f = this.frameAtCell(world, cx + dx, cz + dz);
        if (f && this.openingCell(f, x, y, z)) return f;
      }
    }
    return null;
  }

  private openingCell(f: PortalFrame, x: number, y: number, z: number): boolean {
    return z === f.z0 && x >= f.x0 && x <= f.x1 && y >= f.y0 && y <= f.y1;
  }

  renderView(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    player: Player,
    world: World,
  ): void {
    for (const mesh of this.meshes.values()) {
      mesh.material = this.veilMat;
    }
    const live = this.pickLive(camera, player);
    this.liveKey = live?.key ?? null;
    if (!live) return;
    if (this.insideOpening(live, player.x, player.y, player.z)) return;
    const dest = this.partnerOf(live, world);
    if (!dest) return;

    renderer.getSize(this.tmpSize);
    const tw = Math.max(256, Math.floor(this.tmpSize.x * 0.75));
    const th = Math.max(144, Math.floor(this.tmpSize.y * 0.75));
    if (this.rt.width !== tw || this.rt.height !== th) {
      this.rt.setSize(tw, th);
    }

    if (!this.setupWindowCamera(camera.position, live, dest)) {
      this.setupFallbackCamera(live, dest);
    }

    const prevTarget = renderer.getRenderTarget();
    const prevShadow = renderer.shadowMap.enabled;
    const prevAuto = renderer.shadowMap.autoUpdate;
    const prevClear = renderer.getClearColor(this.tmpColor);
    const prevAlpha = renderer.getClearAlpha();
    renderer.shadowMap.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    this.group.visible = false;
    renderer.setRenderTarget(this.rt);
    const sky =
      scene.background instanceof THREE.Color
        ? scene.background
        : this.tmpColor.set(0x5ba3d9);
    renderer.setClearColor(sky, 1);
    renderer.clear();
    renderer.render(scene, this.portalCam);
    renderer.setRenderTarget(prevTarget);
    this.group.visible = true;
    renderer.shadowMap.enabled = prevShadow;
    renderer.shadowMap.autoUpdate = prevAuto;
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.setViewport(0, 0, this.tmpSize.x, this.tmpSize.y);

    const mesh = this.meshes.get(live.key);
    if (mesh) mesh.material = this.liveMat;
  }

  private pinPair(src: PortalFrame, dest: PortalFrame): void {
    this.stickyFoci = [
      { x: src.cx, z: src.cz, r: 6 },
      { x: dest.cx, z: dest.cz, r: 6 },
    ];
    this.stickyUntil = 10;
  }

  private hintExitStreaming(world: World, player: Player): void {
    const foci: { x: number; z: number; r: number }[] = [];
    const seen = new Set<string>();
    const add = (x: number, z: number, r: number) => {
      const k = `${Math.floor(x / 16)},${Math.floor(z / 16)}`;
      if (seen.has(k)) return;
      seen.add(k);
      foci.push({ x, z, r });
    };
    for (const f of this.frames) {
      const d = Math.hypot(player.x - f.cx, player.z - f.cz);
      if (d > 64) continue;
      add(f.cx, f.cz, 5);
      const [px, pz] = portalPartnerCell(f.cellX, f.cellZ);
      const a = portalAnchor(px, pz, world.seed);
      add(a.ox + 2, a.oz, d < 20 ? 6 : 5);
    }
    if (this.stickyUntil > 0) {
      for (const s of this.stickyFoci) add(s.x, s.z, s.r);
    }
    world.setStreamFoci(foci);
  }

  private ensureStarterGate(world: World): void {
    if (this.starterBuilt) return;
    const [cx, cz] = STARTER_PORTAL_CELL;
    if (this.frames.some((f) => f.cellX === cx && f.cellZ === cz)) {
      this.starterBuilt = true;
      return;
    }
    const { ox, oz } = portalAnchor(cx, cz, world.seed);
    world.ensureChunkAt(ox, oz);
    for (let y = 1; y < 155; y++) {
      if (isPortal(world.getBlock(ox + 1, y, oz))) {
        this.starterBuilt = true;
        return;
      }
    }
    const gy = world.getSurfaceY(ox + 2, oz);
    const floor = Math.max(4, Math.min(140, gy - 1));
    if (!world.setBlock(ox, floor, oz, Block.ARCANE)) return;
    const w = 4;
    const h = 5;
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 6; dx++) {
        for (let dy = 1; dy <= h + 2; dy++) {
          world.setBlock(ox + dx, floor + dy, oz + dz, Block.AIR);
        }
        const under = world.getBlock(ox + dx, floor, oz + dz);
        if (under === Block.AIR || under === Block.WATER) {
          world.setBlock(ox + dx, floor, oz + dz, Block.ARCANE);
        }
      }
    }
    for (let dy = 0; dy <= h; dy++) {
      world.setBlock(ox, floor + dy, oz, Block.ARCANE);
      world.setBlock(ox + w, floor + dy, oz, Block.ARCANE);
    }
    for (let dx = 0; dx <= w; dx++) {
      world.setBlock(ox + dx, floor, oz, Block.ARCANE);
      world.setBlock(ox + dx, floor + h, oz, Block.ARCANE);
    }
    for (let dy = 1; dy < h; dy++) {
      for (let dx = 1; dx < w; dx++) {
        world.setBlock(ox + dx, floor + dy, oz, Block.PORTAL);
      }
    }
    this.starterBuilt = true;
    this.rescan(world, ox, oz);
  }

  private dressFrames(world: World): void {
    for (const f of this.frames) {
      if (this.framed.has(f.key)) continue;
      this.framed.add(f.key);
      const z = f.z0;
      for (let y = f.y0 - 1; y <= f.y1 + 1; y++) {
        for (let x = f.x0 - 1; x <= f.x1 + 1; x++) {
          const edge = x < f.x0 || x > f.x1 || y < f.y0 || y > f.y1;
          if (!edge) continue;
          const cur = world.getBlock(x, y, z);
          if (cur === Block.ARCANE || cur === Block.BEDROCK) continue;
          world.setBlock(x, y, z, Block.ARCANE);
        }
      }
      for (const dz of [-1, 1]) {
        world.setBlock(f.x0 - 1, f.y0 - 1, z + dz, Block.ARCANE);
        world.setBlock(f.x1 + 1, f.y0 - 1, z + dz, Block.ARCANE);
        world.setBlock(f.x0 - 1, f.y1 + 1, z + dz, Block.ARCANE);
        world.setBlock(f.x1 + 1, f.y1 + 1, z + dz, Block.ARCANE);
      }
    }
  }

  private rescan(world: World, px: number, pz: number): void {
    const next: PortalFrame[] = [];
    const seen = new Set<string>();
    const c0x = Math.floor(px / STRUCT_CELL);
    const c0z = Math.floor(pz / STRUCT_CELL);
    for (let cz = c0z - SCAN_CELLS; cz <= c0z + SCAN_CELLS; cz++) {
      for (let cx = c0x - SCAN_CELLS; cx <= c0x + SCAN_CELLS; cx++) {
        if (!cellHasLinkedPortal(cx, cz, world.seed)) continue;
        const frame = this.frameAtCell(world, cx, cz);
        if (!frame || seen.has(frame.key)) continue;
        seen.add(frame.key);
        next.push(frame);
      }
    }
    this.frames = next;
  }

  private frameAtCell(
    world: World,
    cellX: number,
    cellZ: number,
  ): PortalFrame | null {
    const { ox, oz } = portalAnchor(cellX, cellZ, world.seed);
    const x0 = ox + 1;
    const x1 = ox + PORTAL_INNER_W;
    const z0 = oz;
    let y0 = 999;
    let y1 = -1;
    for (let x = x0; x <= x1; x++) {
      for (let y = 1; y < 155; y++) {
        if (!isPortal(world.getBlock(x, y, z0))) continue;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (y1 < 0) {
      let jambLo = 999;
      let jambHi = -1;
      for (let y = 1; y < 155; y++) {
        if (world.getBlock(ox, y, z0) !== Block.ARCANE) continue;
        if (y < jambLo) jambLo = y;
        if (y > jambHi) jambHi = y;
      }
      if (jambHi < jambLo + 2) {
        const gy = world.getSurfaceY(ox + 2, oz);
        y0 = Math.max(3, gy);
        y1 = y0 + PORTAL_INNER_H - 1;
      } else {
        y0 = jambLo + 1;
        y1 = jambHi - 1;
      }
    }
    return {
      key: `${cellX},${cellZ}`,
      cellX,
      cellZ,
      x0,
      y0,
      z0,
      x1,
      y1,
      z1: z0,
      cx: (x0 + x1 + 1) * 0.5,
      cy: (y0 + y1 + 1) * 0.5,
      cz: z0 + 0.5,
    };
  }

  private partnerOf(frame: PortalFrame, world?: World): PortalFrame | null {
    const [px, pz] = portalPartnerCell(frame.cellX, frame.cellZ);
    const found = this.frames.find((f) => f.cellX === px && f.cellZ === pz);
    if (found) return found;
    if (!world) return null;
    return this.frameAtCell(world, px, pz);
  }

  private facePlane(frame: PortalFrame, z: number): number {
    return z < frame.cz ? frame.cz - 0.5 : frame.cz + 0.5;
  }

  private warpPlane(frame: PortalFrame, z: number): number {
    const face = this.facePlane(frame, z);
    const toward = z < frame.cz ? -1 : 1;
    return face + toward * WARP_PAD;
  }

  private insideOpening(
    frame: PortalFrame,
    x: number,
    y: number,
    z: number,
  ): boolean {
    if (x < frame.x0 - 0.15 || x > frame.x1 + 1.15) return false;
    if (y + 0.4 < frame.y0 || y > frame.y1 + 1) return false;
    return Math.abs(z - frame.cz) < 0.5 + WARP_PAD;
  }

  private inWarpStrip(frame: PortalFrame, player: Player): boolean {
    return this.inWarpStripAt(frame, player.x, player.y, player.z);
  }

  private inWarpStripAt(
    frame: PortalFrame,
    x: number,
    y: number,
    z: number,
  ): boolean {
    if (x < frame.x0 - 0.15 || x > frame.x1 + 1.15) return false;
    if (y + 0.15 < frame.y0 || y > frame.y1 + 1) return false;
    if (z < frame.cz) {
      const face = frame.cz - 0.5;
      return z >= face - WARP_PAD;
    }
    const face = frame.cz + 0.5;
    return z <= face + WARP_PAD;
  }

  private crossed(frame: PortalFrame, player: Player): boolean {
    return this.crossedAt(
      frame,
      player.x,
      player.y,
      player.z,
      this.prevX,
      this.prevY,
      this.prevZ,
    );
  }

  private crossedAt(
    frame: PortalFrame,
    x: number,
    y: number,
    z: number,
    prevX: number,
    prevY: number,
    prevZ: number,
  ): boolean {
    const pad = 0.2;
    const inX = x >= frame.x0 - pad && x <= frame.x1 + 1 + pad;
    const inY = y + 0.15 >= frame.y0 && y <= frame.y1 + 1;
    const pX = prevX >= frame.x0 - pad && prevX <= frame.x1 + 1 + pad;
    const pY = prevY + 0.15 >= frame.y0 && prevY <= frame.y1 + 1;
    if ((!inX || !inY) && (!pX || !pY)) return false;
    const plane = this.warpPlane(frame, prevZ);
    const prevSide = Math.sign(prevZ - plane) || 1;
    const curSide = Math.sign(z - plane) || prevSide;
    if (prevSide === curSide) return false;
    return Math.abs(z - plane) < 1.4 || Math.abs(prevZ - plane) < 1.4;
  }

  private applyWarp(player: Player, src: PortalFrame, dest: PortalFrame): void {
    const lx = player.x - src.cx;
    const ly = player.y - src.y0;
    const lz = player.z - src.cz;
    player.x = dest.cx - lx;
    player.y = dest.y0 + ly;
    player.z = dest.cz - lz;
    player.yaw += Math.PI;
    player.vx = -player.vx;
    player.vz = -player.vz;
    const out = Math.sign(player.z - dest.cz) || 1;
    const destFace = dest.cz + out * 0.5;
    // Past the exit strip so cooldown can't immediately bounce you back.
    player.z = destFace + out * (WARP_PAD + 0.18);
  }

  private pickLive(
    camera: THREE.PerspectiveCamera,
    player: Player,
  ): PortalFrame | null {
    const [fx, , fz] = player.lookDir();
    let best: PortalFrame | null = null;
    let bestD = 42;
    for (const f of this.frames) {
      const dx = f.cx - camera.position.x;
      const dy = f.cy - camera.position.y;
      const dz = f.cz - camera.position.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > bestD) continue;
      if (dx * fx + dz * fz < -0.15 && d > 2.5) continue;
      best = f;
      bestD = d;
    }
    return best;
  }

  private setupWindowCamera(
    eye: THREE.Vector3,
    src: PortalFrame,
    dest: PortalFrame,
  ): boolean {
    const hw = Math.max(0.5, (src.x1 - src.x0 + 1) * 0.5);
    const hh = Math.max(0.5, (src.y1 - src.y0 + 1) * 0.5);
    this.pe.set(
      dest.cx - (eye.x - src.cx),
      dest.cy + (eye.y - src.cy),
      dest.cz - (eye.z - src.cz),
    );
    const fromNeg = eye.z < src.cz;
    const destFaceZ = dest.cz + (fromNeg ? 0.5 : -0.5);
    if (fromNeg) {
      this.pa.set(dest.cx - hw, dest.cy - hh, destFaceZ);
      this.pb.set(dest.cx + hw, dest.cy - hh, destFaceZ);
      this.pc.set(dest.cx - hw, dest.cy + hh, destFaceZ);
    } else {
      this.pa.set(dest.cx + hw, dest.cy - hh, destFaceZ);
      this.pb.set(dest.cx - hw, dest.cy - hh, destFaceZ);
      this.pc.set(dest.cx + hw, dest.cy + hh, destFaceZ);
    }

    this.vr.subVectors(this.pb, this.pa).normalize();
    this.vu.subVectors(this.pc, this.pa).normalize();
    this.vn.crossVectors(this.vr, this.vu).normalize();
    this.va.subVectors(this.pa, this.pe);
    let d = -this.va.dot(this.vn);
    if (d < 0) {
      this.vn.negate();
      d = -d;
    }
    if (d < 0.05) return false;

    this.vb.subVectors(this.pb, this.pe);
    this.vc.subVectors(this.pc, this.pe);
    const n = d;
    const scale = n / d;
    const l = this.vr.dot(this.va) * scale;
    const r = this.vr.dot(this.vb) * scale;
    const btm = this.vu.dot(this.va) * scale;
    const top = this.vu.dot(this.vc) * scale;
    if (!(l < r) || !(btm < top)) return false;

    this.portalCam.position.copy(this.pe);
    this.portalCam.up.copy(this.vu);
    this.look.copy(this.pe).addScaledVector(this.vn, -1);
    this.portalCam.lookAt(this.look);
    this.portalCam.near = n;
    this.portalCam.far = 200;
    this.portalCam.projectionMatrix.makePerspective(l, r, top, btm, n, 200);
    this.portalCam.projectionMatrixInverse
      .copy(this.portalCam.projectionMatrix)
      .invert();
    return true;
  }

  private setupFallbackCamera(src: PortalFrame, dest: PortalFrame): void {
    const side = Math.sign(this.prevZ - src.cz) || 1;
    this.portalCam.position.set(dest.cx, dest.cy, dest.cz + side * 2.2);
    this.portalCam.up.set(0, 1, 0);
    this.portalCam.lookAt(dest.cx, dest.cy, dest.cz - side * 16);
    this.portalCam.fov = 55;
    this.portalCam.aspect =
      Math.max(0.5, dest.x1 - dest.x0 + 1) /
      Math.max(0.5, dest.y1 - dest.y0 + 1);
    this.portalCam.near = 0.2;
    this.portalCam.far = 200;
    this.portalCam.updateProjectionMatrix();
  }

  private syncMeshes(): void {
    const keep = new Set<string>();
    for (const f of this.frames) {
      keep.add(f.key);
      let mesh = this.meshes.get(f.key);
      const bw = f.x1 - f.x0 + 1;
      const bh = f.y1 - f.y0 + 1;
      if (!mesh) {
        const geo = new THREE.PlaneGeometry(bw, bh);
        mesh = new THREE.Mesh(geo, this.veilMat);
        mesh.layers.set(PORTAL_LAYER);
        mesh.frustumCulled = false;
        mesh.userData.bw = bw;
        mesh.userData.bh = bh;
        this.group.add(mesh);
        this.meshes.set(f.key, mesh);
      } else if (mesh.userData.bw !== bw || mesh.userData.bh !== bh) {
        mesh.geometry.dispose();
        mesh.geometry = new THREE.PlaneGeometry(bw, bh);
        mesh.userData.bw = bw;
        mesh.userData.bh = bh;
      }
      const face = this.prevZ < f.cz ? -0.5 : 0.5;
      mesh.position.set(f.cx, f.cy, f.cz + face);
      mesh.rotation.set(0, face < 0 ? Math.PI : 0, 0);
    }
    for (const [key, mesh] of this.meshes) {
      if (keep.has(key)) continue;
      this.group.remove(mesh);
      mesh.geometry.dispose();
      this.meshes.delete(key);
    }
  }

  private clearMeshes(): void {
    for (const mesh of this.meshes.values()) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
    }
    this.meshes.clear();
  }
}

export type PortalMob = {
  x: number;
  y: number;
  z: number;
  yaw?: number;
  portalCd: number;
};

/** Warp a mob if it crossed a gate. Returns true if moved. */
export function warpMobIfNeeded(
  portals: PortalSystem,
  world: World,
  m: PortalMob,
  prevX: number,
  prevY: number,
  prevZ: number,
): boolean {
  if (m.portalCd > 0) return false;
  const w = portals.tryWarpEntity(
    world,
    m.x,
    m.y,
    m.z,
    0,
    0,
    0,
    prevX,
    prevY,
    prevZ,
  );
  if (!w) return false;
  m.x = w.x;
  m.y = w.y;
  m.z = w.z;
  if (typeof m.yaw === "number") m.yaw += Math.PI;
  m.portalCd = 45;
  return true;
}
