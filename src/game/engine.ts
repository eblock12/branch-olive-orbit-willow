import * as THREE from "three";
import { Block, type BlockId } from "./blocks";

import { Player, MOUSE_SENS } from "./player";
import { World } from "./world";
import { createBlockAtlas, createDestroyCrackTextures } from "./textures";

import { raycastVoxel, type VoxelHit } from "./raycast";
import { CHUNK_HEIGHT } from "./chunk";
import { CaterpillarSystem } from "./caterpillars";
import { WeatherSystem, type WeatherKind } from "./weather";
import { DayNightCycle } from "./dayNight";
import {
  SurvivalState,
  blockDrop,
  HOTBAR_SIZE,
  MAX_HEALTH,
  MAX_HUNGER,
  type HotbarSlot,
} from "./survival";

export type HudSnapshot = {
  playing: boolean;
  fps: number;
  selected: BlockId;
  placeable: BlockId[];
  pos: { x: number; y: number; z: number };
  target: VoxelHit | null;
  isTouch: boolean;
  caterpillars: number;
  banished: number;
  weather: WeatherKind;
  rain: number;
  dayPhase: number;
  isDay: boolean;
  biome: string;
  health: number;
  maxHealth: number;
  hunger: number;
  maxHunger: number;
  inventory: HotbarSlot[];
  selectedSlot: number;
  mineProgress: number;
  dead: boolean;
};

export type EngineOptions = {
  canvas: HTMLCanvasElement;
  onHud?: (hud: HudSnapshot) => void;
};

export class GameEngine {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private world: World;
  private player: Player;
  private caterpillars: CaterpillarSystem;
  private weather: WeatherSystem;
  private dayNight: DayNightCycle;
  private material: THREE.MeshLambertMaterial;
  private atlas: THREE.CanvasTexture;
  private highlight: THREE.LineSegments;
  private crackMesh: THREE.Mesh;
  private crackStages: THREE.CanvasTexture[];
  private crackMat: THREE.MeshBasicMaterial;
  private crackStage = -1;

  private sun: THREE.SpotLight;
  private ambient: THREE.AmbientLight;
  private hemi: THREE.HemisphereLight;

  private lastTime = 0;
  private raf = 0;
  private running = false;
  private playing = false;
  private hadPointerLock = false;
  private lookReadyAt = 0;
  private disposed = false;

  private keys = new Set<string>();
  private mouseDown = { left: false, right: false };
  private lastBreak = 0;
  private lastPlace = 0;
  private selectedIndex = 0;
  private survival = new SurvivalState();
  private target: VoxelHit | null = null;
  private onHud?: (hud: HudSnapshot) => void;
  private hudAccum = 0;
  private frames = 0;
  private fps = 0;
  private isTouch = false;

  private touchMove = { x: 0, y: 0 };
  private touchLookId: number | null = null;
  private touchMoveId: number | null = null;
  private lastTouchLook = { x: 0, y: 0 };

  private particleGeo: THREE.BoxGeometry;
  private particleMat: THREE.MeshLambertMaterial;
  private leafParticleMat: THREE.MeshLambertMaterial;
  private particles: {
    mesh: THREE.Mesh;
    life: number;
    vx: number;
    vy: number;
    vz: number;
  }[] = [];

  private _air = 5;
  private _caterHurt = 0;

  constructor(opts: EngineOptions) {
    this.canvas = opts.canvas;
    this.onHud = opts.onHud;
    this.isTouch =
      typeof window !== "undefined" &&
      matchMedia("(pointer: coarse)").matches;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      powerPreference: "high-performance",
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setClearColor(0x5ba3d9, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap;
    this.renderer.shadowMap.autoUpdate = true;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x5ba3d9);
    this.scene.fog = new THREE.Fog(0x8ec4e8, 50, 220);

    this.camera = new THREE.PerspectiveCamera(75, 1, 0.08, 320);
    this.camera.rotation.order = "YXZ";

    this.sun = new THREE.SpotLight(0xfff0d8, 0);
    this.sun.castShadow = false;
    this.sun.visible = false;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.ambient = new THREE.AmbientLight(0x8aa8c8, 0.55);
    this.scene.add(this.ambient);
    this.hemi = new THREE.HemisphereLight(0xb8d8ff, 0x4a6a3a, 0.35);
    this.scene.add(this.hemi);

    this.atlas = createBlockAtlas();
    this.material = new THREE.MeshLambertMaterial({
      map: this.atlas,
      vertexColors: true,
      alphaTest: 0.5,
      transparent: false,
      side: THREE.FrontSide,
    });

    this.particleGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
    this.particleMat = new THREE.MeshLambertMaterial({ color: 0x8b5a2b });
    this.leafParticleMat = new THREE.MeshLambertMaterial({ color: 0x6ecf4a });

    const seed = 1337;
    this.world = new World(seed, this.material, 4, 3);
    this.player = new Player();
    this.caterpillars = new CaterpillarSystem();

    this.world.ensureChunksAround(0, 0);
    this.world.flushMeshes();
    this.spawnPlayer();
    this.caterpillars.seedAround(this.world, this.player.x, this.player.z, 8);

    this.scene.add(this.world.group);
    this.scene.add(this.caterpillars.group);

    this.dayNight = new DayNightCycle(this.scene, this.sun);
    this.sun = this.dayNight.light;

    this.weather = new WeatherSystem(
      this.scene,
      this.sun,
      this.ambient,
      this.hemi,
      this.scene.fog as THREE.Fog,
      this.material,
      seed,
    );
    {
      const depth = this.material.userData.windDepthMaterial as
        | THREE.Material
        | undefined;
      if (depth) this.world.applyWindDepthMaterial(depth);
    }

    this.dayNight.update(
      0,
      this.player.x,
      this.player.y,
      this.player.z,
      this.camera,
    );
    this.weather.setDayNight(this.dayNight.state);
    this.dayNight.finalizeKeyLight();
    this.material.needsUpdate = true;

    const boxGeo = new THREE.BoxGeometry(1.002, 1.002, 1.002);
    const edges = new THREE.EdgesGeometry(boxGeo);
    this.highlight = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({
        color: 0x111111,
        transparent: true,
        opacity: 0.55,
      }),
    );
    this.highlight.visible = false;
    this.scene.add(this.highlight);

    // Progressive destroy-stage crack overlay (Minecraft-style)
    this.crackStages = createDestroyCrackTextures();
    this.crackMat = new THREE.MeshBasicMaterial({
      map: this.crackStages[0],
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      alphaTest: 0.05,
    });
    this.crackMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.01, 1.01, 1.01),
      this.crackMat,
    );
    this.crackMesh.visible = false;
    this.crackMesh.renderOrder = 2;
    this.crackMesh.matrixAutoUpdate = true;
    this.scene.add(this.crackMesh);

    this.bindEvents();

    this.onResize();
    this.installControlsTest();
    this.emitHud();
  }

  private spawnPlayer(): void {
    for (const [sx, sz] of [
      [0.5, 0.5],
      [2.5, 2.5],
      [-2.5, 2.5],
      [2.5, -2.5],
      [4.5, 0.5],
      [0.5, 4.5],
      [8.5, 8.5],
      [-8.5, 4.5],
    ] as const) {
      const sy = this.world.getSurfaceY(Math.floor(sx), Math.floor(sz));
      this.player.x = sx;
      this.player.y = sy + 0.05;
      this.player.z = sz;
      this.player.vx = 0;
      this.player.vy = 0;
      this.player.vz = 0;
      if (
        !this.player.collides(
          this.world,
          this.player.x,
          this.player.y,
          this.player.z,
        )
      ) {
        this.player.yaw = 0;
        return;
      }
    }
    const sy = this.world.getSurfaceY(0, 0);
    this.player.x = 0.5;
    this.player.y = sy + 2;
    this.player.z = 0.5;
  }

  private installControlsTest(): void {
    window.__controlsTest = {
      getYaw: () => this.player.yaw,
      getPitch: () => this.player.pitch,
      getSpeed: () => Math.hypot(this.player.vx, this.player.vz),
      getPosition: () => ({
        x: this.player.x,
        y: this.player.y,
        z: this.player.z,
      }),
    };
  }

  start(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    this.lastTime = performance.now();
    const loop = (t: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      this.frame(t);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.unbindEvents();
    document.exitPointerLock?.();
    for (const p of this.particles) this.scene.remove(p.mesh);
    this.particles = [];
    this.particleGeo.dispose();
    this.particleMat.dispose();
    this.leafParticleMat.dispose();
    this.weather.dispose();
    this.dayNight.dispose(this.scene);
    this.world.dispose?.();
    this.atlas.dispose();
    this.material.dispose();
    this.highlight.geometry.dispose();
    (this.highlight.material as THREE.Material).dispose();
    this.crackMesh.geometry.dispose();
    this.crackMat.dispose();
    for (const t of this.crackStages) t.dispose();
    this.renderer.dispose();

  }

  requestPlay(): void {
    if (this.isTouch) {
      this.playing = true;
      this.emitHud();
      return;
    }
    this.canvas.requestPointerLock();
  }

  private setSelectedIndex(i: number): void {
    this.selectedIndex = ((i % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE;
    this.survival.select(this.selectedIndex);
  }

  get selected(): BlockId {
    return this.survival.selectedSlot?.id ?? Block.DIRT;
  }

  setTouchMove(x: number, y: number): void {
    this.touchMove = { x, y };
  }

  touchJump(): void {
    this.keys.add("Space");
    setTimeout(() => this.keys.delete("Space"), 120);
  }

  touchBreak(): void {
    this.tryBreak(true);
  }

  touchPlace(): void {
    this.tryPlace(true);
  }

  selectHotbar(i: number): void {
    this.setSelectedIndex(i);
    this.emitHud();
  }

  respawn(): void {
    if (!this.survival.dead) return;
    this.survival.respawn();
    this.spawnPlayer();
    this.emitHud();
  }

  private bindEvents(): void {
    window.addEventListener("resize", this.onResize);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    document.addEventListener("pointerlockchange", this.onPointerLock);
    this.canvas.addEventListener("mousemove", this.onMouseMove);
    this.canvas.addEventListener("mousedown", this.onMouseDown);
    this.canvas.addEventListener("mouseup", this.onMouseUp);
    this.canvas.addEventListener("contextmenu", this.onContext);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: true });
    this.canvas.addEventListener("touchstart", this.onTouchStart, {
      passive: false,
    });
    this.canvas.addEventListener("touchmove", this.onTouchMove, {
      passive: false,
    });
    this.canvas.addEventListener("touchend", this.onTouchEnd);
    this.canvas.addEventListener("touchcancel", this.onTouchEnd);
  }

  private unbindEvents(): void {
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    document.removeEventListener("pointerlockchange", this.onPointerLock);
    this.canvas.removeEventListener("mousemove", this.onMouseMove);
    this.canvas.removeEventListener("mousedown", this.onMouseDown);
    this.canvas.removeEventListener("mouseup", this.onMouseUp);
    this.canvas.removeEventListener("contextmenu", this.onContext);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("touchstart", this.onTouchStart);
    this.canvas.removeEventListener("touchmove", this.onTouchMove);
    this.canvas.removeEventListener("touchend", this.onTouchEnd);
    this.canvas.removeEventListener("touchcancel", this.onTouchEnd);
  }

  private onResize = () => {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  };

  private onPointerLock = () => {
    const locked = document.pointerLockElement === this.canvas;
    if (locked) {
      this.playing = true;
      this.hadPointerLock = true;
      this.lookReadyAt = performance.now() + 80;
    } else if (this.hadPointerLock) {
      this.playing = false;
      this.mouseDown.left = false;
      this.mouseDown.right = false;
    }
    this.emitHud();
  };

  private onKeyDown = (e: KeyboardEvent) => {
    this.keys.add(e.code);
    if (e.code.startsWith("Digit")) {
      const n = parseInt(e.code.replace("Digit", ""), 10);
      if (n >= 1 && n <= HOTBAR_SIZE) {
        this.setSelectedIndex(n - 1);
        this.emitHud();
      }
    }
    if (e.code === "KeyR" && this.survival.dead) this.respawn();
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.playing || this.survival.dead) return;
    if (document.pointerLockElement !== this.canvas && !this.isTouch) return;
    if (performance.now() < this.lookReadyAt) return;
    this.player.applyLook(e.movementX, e.movementY);
  };

  private onMouseDown = (e: MouseEvent) => {
    if (!this.playing || this.survival.dead) return;
    if (e.button === 0) {
      this.mouseDown.left = true;
      this.tryBreak(true);
    }
    if (e.button === 2) {
      this.mouseDown.right = true;
      this.tryPlace(true);
    }
  };

  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.mouseDown.left = false;
    if (e.button === 2) this.mouseDown.right = false;
  };

  private onContext = (e: Event) => {
    e.preventDefault();
  };

  private onWheel = (e: WheelEvent) => {
    if (e.deltaY > 0) this.setSelectedIndex(this.selectedIndex + 1);
    else if (e.deltaY < 0) this.setSelectedIndex(this.selectedIndex - 1);
    this.emitHud();
  };

  private onTouchStart = (e: TouchEvent) => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.clientX < window.innerWidth * 0.45 && this.touchMoveId === null) {
        this.touchMoveId = t.identifier;
      } else if (this.touchLookId === null) {
        this.touchLookId = t.identifier;
        this.lastTouchLook = { x: t.clientX, y: t.clientY };
      }
    }
  };

  private onTouchMove = (e: TouchEvent) => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.touchLookId) {
        const dx = t.clientX - this.lastTouchLook.x;
        const dy = t.clientY - this.lastTouchLook.y;
        this.lastTouchLook = { x: t.clientX, y: t.clientY };
        if (!this.survival.dead) {
          this.player.applyLook(dx, dy, MOUSE_SENS * 1.6);
        }
      }
    }
  };

  private onTouchEnd = (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.touchMoveId) {
        this.touchMoveId = null;
        this.touchMove = { x: 0, y: 0 };
      }
      if (t.identifier === this.touchLookId) this.touchLookId = null;
    }
  };

  private tryBreak(force = false): void {
    const now = performance.now();
    if (!force && now - this.lastBreak < 200) return;

    const [lx, ly, lz] = this.player.lookDir();
    const punch = this.caterpillars.tryPunch(
      this.player.x,
      this.player.eyeY,
      this.player.z,
      lx,
      ly,
      lz,
      5,
    );
    if (punch) {
      this.lastBreak = now;
      this.spawnLeafParticles(
        this.player.x + lx * 2,
        this.player.eyeY + ly * 2,
        this.player.z + lz * 2,
      );
      this.survival.addExhaustion(0.4);
      this.emitHud();
      return;
    }

    // Touch tap advances mining
    if (force && this.isTouch && this.target && this.target.y > 0) {
      const id = this.world.getBlock(
        this.target.x,
        this.target.y,
        this.target.z,
      );
      if (
        this.survival.tickMine(
          0.4,
          this.target.x,
          this.target.y,
          this.target.z,
          id,
          true,
        )
      ) {
        this.finishMine(this.target.x, this.target.y, this.target.z, id);
      }
      this.lastBreak = now;
    }
  }

  private finishMine(x: number, y: number, z: number, id: number): void {
    if (y <= 0) return;
    const ok = this.world.setBlock(x, y, z, Block.AIR);
    if (!ok) return;
    const drop = blockDrop(id);
    if (drop !== null) this.survival.addItem(drop, 1);
    this.spawnBreakParticles(x + 0.5, y + 0.5, z + 0.5);
    this.survival.addExhaustion(0.5);
    this.emitHud();
  }

  private tryPlace(force = false): void {
    const now = performance.now();
    if (!force && now - this.lastPlace < 200) return;
    if (this.survival.dead) return;
    if (!this.target) return;
    if (!this.survival.hasSelected()) return;
    const px = this.target.x + this.target.nx;
    const py = this.target.y + this.target.ny;
    const pz = this.target.z + this.target.nz;
    if (py < 0 || py >= CHUNK_HEIGHT) return;
    if (this.player.overlapsBlock(px, py, pz)) return;
    if (this.world.getBlock(px, py, pz) !== Block.AIR) return;
    const blockId = this.survival.selectedSlot!.id;
    const ok = this.world.setBlock(px, py, pz, blockId);
    if (ok) {
      this.survival.consumeSelected();
      this.lastPlace = now;
      this.survival.addExhaustion(0.15);
      this.emitHud();
    }
  }

  private spawnBreakParticles(x: number, y: number, z: number): void {
    for (let i = 0; i < 8; i++) {
      const mesh = new THREE.Mesh(this.particleGeo, this.particleMat);
      mesh.position.set(x, y, z);
      this.scene.add(mesh);
      this.particles.push({
        mesh,
        life: 0.45 + Math.random() * 0.25,
        vx: (Math.random() - 0.5) * 3,
        vy: Math.random() * 3 + 1,
        vz: (Math.random() - 0.5) * 3,
      });
    }
  }

  private spawnLeafParticles(x: number, y: number, z: number): void {
    for (let i = 0; i < 10; i++) {
      const mesh = new THREE.Mesh(this.particleGeo, this.leafParticleMat);
      mesh.position.set(x, y, z);
      this.scene.add(mesh);
      this.particles.push({
        mesh,
        life: 0.5 + Math.random() * 0.3,
        vx: (Math.random() - 0.5) * 4,
        vy: Math.random() * 4 + 1,
        vz: (Math.random() - 0.5) * 4,
      });
    }
  }

  private updateParticles(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.life -= dt;
      p.vy -= 12 * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      p.mesh.scale.multiplyScalar(0.96);
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        this.particles.splice(i, 1);
      }
    }
  }

  private frame(timestamp: number): void {
    let dt = (timestamp - this.lastTime) / 1000;
    this.lastTime = timestamp;
    if (dt > 0.1) dt = 0.1;
    if (dt <= 0 || !Number.isFinite(dt)) dt = 1 / 60;

    this.frames++;
    this.hudAccum += dt;

    if ((this.playing || this.keys.size > 0) && !this.survival.dead) {
      this.updatePlayer(dt);
    }

    if (this.playing && !this.survival.dead) {
      this.updateSurvival(dt);
    }

    if (this.playing || this.caterpillars.count > 0) {
      this.caterpillars.update(dt, this.world, this.player);
    }

    this.world.ensureChunksAround(this.player.x, this.player.z);


    const dn = this.dayNight.update(
      dt,
      this.player.x,
      this.player.y,
      this.player.z,
      this.camera,
    );
    this.weather.setDayNight(dn);
    this.weather.update(
      dt,
      this.world,
      this.player.x,
      this.player.y,
      this.player.z,
    );
    this.dayNight.finalizeKeyLight();

    if (this.hudAccum >= 0.25) {
      this.fps = Math.round(this.frames / this.hudAccum);
      this.frames = 0;
      this.hudAccum = 0;
      this.emitHud();
    }

    if (this.scene.background instanceof THREE.Color) {
      this.renderer.setClearColor(this.scene.background, 1);
    }

    const [lx, ly, lz] = this.player.lookDir();
    this.target = raycastVoxel(
      this.player.x,
      this.player.eyeY,
      this.player.z,
      lx,
      ly,
      lz,
      6,
      (x, y, z) => this.world.getBlock(x, y, z),
    );


    if (this.target) {
      this.highlight.visible = true;
      this.highlight.position.set(
        this.target.x + 0.5,
        this.target.y + 0.5,
        this.target.z + 0.5,
      );
    } else {
      this.highlight.visible = false;
    }

    this.updateCrackOverlay();


    if (this.playing && !this.survival.dead) {
      // continuous place while RMB held
      if (this.mouseDown.right) this.tryPlace(false);
    }

    this.updateParticles(dt);

    this.camera.position.set(this.player.x, this.player.eyeY, this.player.z);
    this.camera.rotation.y = this.player.yaw;
    this.camera.rotation.x = this.player.pitch;

    this.renderer.render(this.scene, this.camera);
  }

  private updatePlayer(dt: number): void {
    let moveF = 0;
    let moveR = 0;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) moveF += 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) moveF -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) moveR += 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) moveR -= 1;
    if (this.isTouch) {
      moveF += -this.touchMove.y;
      moveR += this.touchMove.x;
    }
    const jump = this.keys.has("Space");
    const sprint =
      this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
    this.player.update(dt, this.world, moveF, moveR, jump, sprint);

    if (this.player.y < -8) {
      this.survival.damage(20);
    }
  }

  private updateSurvival(dt: number): void {
    const sprinting =
      (this.keys.has("ShiftLeft") || this.keys.has("ShiftRight")) &&
      this.player.onGround;
    const moving =
      this.keys.has("KeyW") ||
      this.keys.has("KeyA") ||
      this.keys.has("KeyS") ||
      this.keys.has("KeyD") ||
      Math.hypot(this.touchMove.x, this.touchMove.y) > 0.1;

    this.survival.update(
      dt,
      this.player.onGround,
      this.player.y,
      sprinting,
      moving,
    );

    // Drowning
    const head = this.world.getBlock(
      Math.floor(this.player.x),
      Math.floor(this.player.eyeY),
      Math.floor(this.player.z),
    );
    if (head === Block.WATER) {
      this._air -= dt;
      if (this._air <= 0) {
        this._air = 0.5;
        this.survival.damage(1);
      }
    } else {
      this._air = Math.min(5, this._air + dt * 2);
    }

    // Cactus
    const bx = Math.floor(this.player.x);
    const bz = Math.floor(this.player.z);
    if (
      this.world.getBlock(bx, Math.floor(this.player.y), bz) ===
        Block.CACTUS ||
      this.world.getBlock(bx, Math.floor(this.player.y + 1), bz) ===
        Block.CACTUS
    ) {
      this.survival.damage(1);
    }

    this.hurtFromCaterpillars(dt);

    // Hold LMB mine
    const mining = this.mouseDown.left;
    if (mining && this.target && this.target.y > 0) {
      const id = this.world.getBlock(
        this.target.x,
        this.target.y,
        this.target.z,
      );
      if (
        this.survival.tickMine(
          dt,
          this.target.x,
          this.target.y,
          this.target.z,
          id,
          true,
        )
      ) {
        this.finishMine(this.target.x, this.target.y, this.target.z, id);
      }
    } else if (!mining) {
      this.survival.resetMine();
    }

    if (this.survival.dead) {
      this.mouseDown.left = false;
      this.mouseDown.right = false;
    }
  }

  private updateCrackOverlay(): void {
    const mt = this.survival.miningTarget;
    const p = this.survival.mineProgress;
    if (!mt || p <= 0.001) {
      this.crackMesh.visible = false;
      this.crackStage = -1;
      return;
    }
    // 10 stages (0..9) mapped from progress; stage 0 shows as soon as mining starts
    const stage = Math.min(9, Math.floor(p * 10));
    this.crackMesh.position.set(mt.x + 0.5, mt.y + 0.5, mt.z + 0.5);
    if (stage !== this.crackStage) {
      this.crackStage = stage;
      this.crackMat.map = this.crackStages[stage]!;
      this.crackMat.needsUpdate = true;
    }
    this.crackMesh.visible = true;
  }

  private hurtFromCaterpillars(dt: number): void {

    this._caterHurt = Math.max(0, this._caterHurt - dt);
    if (this._caterHurt > 0) return;
    const d = this.caterpillars.distanceToNearest(
      this.player.x,
      this.player.y,
      this.player.z,
    );
    if (d < 1.15) {
      this.survival.damage(2);
      this._caterHurt = 0.85;
      const ang = Math.random() * Math.PI * 2;
      this.player.vx += Math.cos(ang) * 4;
      this.player.vz += Math.sin(ang) * 4;
      this.player.vy = Math.max(this.player.vy, 4);
    }
  }

  private emitHud(): void {
    const stats = this.caterpillars.stats;
    const w = this.weather.sample;
    this.onHud?.({
      playing: this.playing,
      fps: this.fps,
      selected: this.selected,
      placeable: this.survival.slots.map(
        (s) => s?.id ?? Block.AIR,
      ) as BlockId[],
      pos: {
        x: this.player.x,
        y: this.player.y,
        z: this.player.z,
      },
      target: this.target,
      isTouch: this.isTouch,
      caterpillars: stats.alive,
      banished: stats.banished,
      weather: w.kind,
      rain: w.rain,
      dayPhase: this.dayNight.state.phase,
      isDay: this.dayNight.state.sunElevation >= 0,
      biome: this.world.getBiomeLabel(this.player.x, this.player.z),
      health: this.survival.health,
      maxHealth: MAX_HEALTH,
      hunger: this.survival.hunger,
      maxHunger: MAX_HUNGER,
      inventory: this.survival.slots.map((s) =>
        s ? { id: s.id, count: s.count } : null,
      ),
      selectedSlot: this.survival.selected,
      mineProgress: this.survival.mineProgress,
      dead: this.survival.dead,
    });
  }
}

declare global {
  interface Window {
    __controlsTest?: {
      getYaw: () => number;
      getPitch: () => number;
      getSpeed: () => number;
      getPosition: () => { x: number; y: number; z: number };
    };
  }
}
