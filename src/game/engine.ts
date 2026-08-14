import * as THREE from "three";
import { Block, isBed, isChest, isFurnace, isPlant, isSolid, isTorch, isWater, canSupportTorch, plantHitbox, torchIdFromHitFace, torchAttachDir, type BlockId } from "./blocks";

import { Player, MOUSE_SENS } from "./player";
import { World } from "./world";
import { createBlockAtlas, createDestroyCrackTextures, CRACK_STAGE_COUNT } from "./textures";



import { raycastVoxel, type VoxelHit } from "./raycast";
import { CHUNK_HEIGHT } from "./chunk";
import { CaterpillarSystem } from "./caterpillars";
import { PassiveMobSystem } from "./passiveMobs";
import { HostileSystem } from "./hostiles";
import { SlenderGiantSystem } from "./slenderGiant";
import { BirdSystem } from "./birds";
import { AmbianceFX } from "./ambiance";
import { GameAudio, surfaceFromBlock } from "./audio";
import { WeatherSystem, type WeatherKind } from "./weather";
import { DayNightCycle } from "./dayNight";
import {
  SurvivalState,
  blockDrop,
  HOTBAR_SIZE,
  INV_SIZE,
  MAX_HEALTH,
  MAX_HUNGER,
  CRAFTABLE_RECIPES,
  canHarvest,
  getTool,
  placeableBlock,
  clickStacks,
  type HotbarSlot,
  type ItemId,
  type ItemStack,
} from "./survival";
import { itemName, isTool, isFood, Item, itemMaxStack } from "./items";
import { ItemDropSystem } from "./itemDrops";
import { WaterFX } from "./water";
import { ViewHand } from "./viewHand";
import { FurnaceSystem, COOK_TIME, isFuel, isSmeltable, type FurnaceSlot, type FurnaceState } from "./furnace";
import { ChestSystem } from "./chest";
import { ChestVisuals } from "./chestVisuals";
import { mobLoot } from "./loot";
import { TorchFlame } from "./torchFlame";

export type HudSnapshot = {
  playing: boolean;
  fps: number;
  selected: ItemId;
  selectedName: string;
  placeable: ItemId[];
  pos: { x: number; y: number; z: number };
  chunkGen: {
    queued: number;
    generating: number;
    mesh: number;
    loaded: number;
    workers: number;
    idleWorkers: number;
  };
  target: VoxelHit | null;
  isTouch: boolean;
  caterpillars: number;
  banished: number;
  animals: number;
  hostiles: number;
  hostilesKilled: number;
  slenderNearby: boolean;
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
  atlasUrl: string;
  blockIcons: Record<number, string>;
  craftingOpen: boolean;
  furnaceOpen: boolean;
  chestOpen: boolean;
  chest: HotbarSlot[] | null;
  furnace: {
    input: HotbarSlot;
    fuel: HotbarSlot;
    output: HotbarSlot;
    cook: number;
    burn: number;
  } | null;
  recipes: {
    id: string;
    name: string;
    hint?: string;
    canCraft: boolean;
    inputs: { id: ItemId; count: number; name: string }[];
    output: { id: ItemId; count: number; name: string };
  }[];
  freeCraft: boolean;
  cursor: HotbarSlot;
  tip: string;
  notice: string;
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
  private animals: PassiveMobSystem;
  private hostiles: HostileSystem;
  private slenderGiant: SlenderGiantSystem;
  private birds: BirdSystem;
  private ambiance: AmbianceFX;
  private audio = new GameAudio();
  private wasOnGround = true;
  private wasInWater = false;
  private prevHealth = MAX_HEALTH;
  private itemDrops: ItemDropSystem;
  private waterFX: WaterFX;
  private weather: WeatherSystem;
  private viewHand: ViewHand;


  private dayNight: DayNightCycle;
  private material: THREE.MeshLambertMaterial;
  private atlas: THREE.CanvasTexture;
  private atlasUrl = "";
  private blockIcons: Record<number, string> = {};

  private highlight: THREE.LineSegments;
  private crackMesh: THREE.Mesh;
  private crackStages: THREE.CanvasTexture[];
  private crackMat: THREE.MeshBasicMaterial;
  private crackStage = -1;

  private sun: THREE.DirectionalLight;
  private ambient: THREE.AmbientLight;
  private hemi: THREE.HemisphereLight;
  private torchLights: THREE.PointLight[] = [];
  private torchLightT = 0;
  private torchFlame!: TorchFlame;

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
  private craftingOpen = false;
  private furnaces = new FurnaceSystem();
  private openFurnacePos: { x: number; y: number; z: number } | null = null;
  private chests = new ChestSystem();
  private openChestPos: { x: number; y: number; z: number } | null = null;
  private chestVisuals!: ChestVisuals;
  private lastAttack = 0;
  private lastEat = 0;
  private notice = "";
  private noticeT = 0;
  /** Subtle grounded walk bob (phase + smoothed strength) */
  private viewBobPhase = 0;
  private viewBobAmt = 0;

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
    this.scene.fog = new THREE.Fog(0x8ec4e8, 100, 300);


    this.camera = new THREE.PerspectiveCamera(75, 1, 0.08, 360);
    this.camera.rotation.order = "YXZ";
    // Camera must be in the scene so first-person hand (child) renders
    this.scene.add(this.camera);

    this.sun = new THREE.DirectionalLight(0xfff0d8, 0);
    this.sun.castShadow = false;
    this.sun.visible = false;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.ambient = new THREE.AmbientLight(0xa8c4e0, 0.72);
    this.scene.add(this.ambient);
    this.hemi = new THREE.HemisphereLight(0xc8e4ff, 0x5a7a48, 0.48);
    this.scene.add(this.hemi);

    for (let i = 0; i < 5; i++) {
      const pl = new THREE.PointLight(0xffb060, 0, 12, 2);
      pl.castShadow = false;
      this.scene.add(pl);
      this.torchLights.push(pl);
    }

    const atlas = createBlockAtlas();
    this.atlas = atlas.texture;
    this.atlasUrl = atlas.dataUrl;
    this.blockIcons = atlas.icons;
    this.torchFlame = new TorchFlame(this.atlas);
    this.material = new THREE.MeshLambertMaterial({
      map: this.atlas,
      vertexColors: true,
      alphaTest: 0.5,
      transparent: false,
      side: THREE.FrontSide,
    });
    this.torchFlame.applyTo(this.material);

    this.particleGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
    this.particleMat = new THREE.MeshLambertMaterial({ color: 0x8b5a2b });
    this.leafParticleMat = new THREE.MeshLambertMaterial({ color: 0x6ecf4a });

    this.waterFX = new WaterFX();

    const seed = (Math.random() * 0x7fffffff) | 0;
    this.world = new World(seed, this.material, this.waterFX.material, 16, 7);






    this.player = new Player();
    this.caterpillars = new CaterpillarSystem();
    this.animals = new PassiveMobSystem();
    this.hostiles = new HostileSystem();
    this.slenderGiant = new SlenderGiantSystem();
    this.birds = new BirdSystem();
    this.ambiance = new AmbianceFX();
    this.itemDrops = new ItemDropSystem(this.atlas, this.torchFlame.emissiveMap);
    this.chestVisuals = new ChestVisuals(this.atlas);
    this.viewHand = new ViewHand(this.atlas, this.torchFlame.emissiveMap);
    this.viewHand.attachTo(this.camera);
    this.viewHand.setHeldItem(this.survival.selectedSlot?.id ?? null);


    this.world.ensureChunksAround(0, 0);
    this.world.flushMeshes();
    this.spawnPlayer();
    this.caterpillars.seedAround(this.world, this.player.x, this.player.z, 3);
    this.animals.seedAround(this.world, this.player.x, this.player.z, 16);

    this.scene.add(this.world.group);
    this.scene.add(this.caterpillars.group);
    this.scene.add(this.animals.group);
    this.scene.add(this.hostiles.group);
    this.scene.add(this.slenderGiant.group);
    this.scene.add(this.birds.group);
    this.scene.add(this.ambiance.group);
    this.scene.add(this.itemDrops.group);
    this.scene.add(this.chestVisuals.group);

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
    this.weather.onLightning = ({ dist, strength, x, y, z }) => {
      this.audio.thunder(dist, strength, x, y, z);
    };
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
    const bed = this.survival.bedSpawn;
    if (bed && isBed(this.world.getBlock(bed.x, bed.y, bed.z))) {
      this.world.ensureChunkAt(bed.x, bed.z);
      this.player.x = bed.x + 0.5;
      this.player.y = bed.y + 1.02;
      this.player.z = bed.z + 0.5;
      this.player.vx = 0;
      this.player.vy = 0;
      this.player.vz = 0;
      if (!this.player.collides(this.world, this.player.x, this.player.y, this.player.z)) {
        this.player.yaw = 0;
        this.player.pitch = 0;
        this.player.onGround = true;
        return;
      }
    }
    // Spiral search for dry land — never spawn underwater / on ocean floor
    const tryAt = (sx: number, sz: number): boolean => {
      this.world.ensureChunkAt(sx, sz);
      // Neighbor chunks help collision / surface continuity
      this.world.ensureChunkAt(sx + 16, sz);
      this.world.ensureChunkAt(sx - 16, sz);
      this.world.ensureChunkAt(sx, sz + 16);
      this.world.ensureChunkAt(sx, sz - 16);

      const ix = Math.floor(sx);
      const iz = Math.floor(sz);
      const feet = this.world.getDrySpawnY(ix, iz);
      if (feet === null) return false;

      this.player.x = ix + 0.5;
      this.player.y = feet + 0.02;
      this.player.z = iz + 0.5;
      this.player.vx = 0;
      this.player.vy = 0;
      this.player.vz = 0;

      if (
        this.player.collides(
          this.world,
          this.player.x,
          this.player.y,
          this.player.z,
        )
      ) {
        return false;
      }
      // Final water check at feet / eyes
      if (this.player.sampleWater(this.world).any) return false;

      this.player.yaw = 0;
      this.player.pitch = 0;
      this.player.onGround = true;
      this.player.inWater = false;
      this.player.submerged = false;
      return true;
    };

    // Prefer near origin first
    const preferred: [number, number][] = [
      [0, 0],
      [2, 2],
      [-2, 2],
      [2, -2],
      [4, 0],
      [0, 4],
      [8, 8],
      [-8, 4],
      [12, -6],
      [-12, 10],
    ];
    for (const [x, z] of preferred) {
      if (tryAt(x, z)) return;
    }

    // Expanding square spiral (step 4 blocks) out to ~200
    for (let r = 4; r <= 200; r += 4) {
      for (let t = 0; t < r * 8; t++) {
        const edge = Math.floor(t / Math.max(1, r * 2));
        const o = t % Math.max(1, r * 2);
        let x = 0;
        let z = 0;
        if (edge === 0) {
          x = -r + o;
          z = -r;
        } else if (edge === 1) {
          x = r;
          z = -r + o;
        } else if (edge === 2) {
          x = r - o;
          z = r;
        } else {
          x = -r;
          z = r - o;
        }
        if (tryAt(x, z)) return;
      }
    }

    // Absolute last resort: high above origin (should be rare)
    this.world.ensureChunkAt(0, 0);
    const sy = this.world.getSurfaceY(0, 0);
    this.player.x = 0.5;
    this.player.y = Math.max(sy, 60) + 4;
    this.player.z = 0.5;
    this.player.vx = 0;
    this.player.vy = 0;
    this.player.vz = 0;
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
      getBirds: () => this.birds.getDebug(),
      getDayNight: () => ({
        dayFactor: this.dayNight.state.dayFactor,
        sunElevation: this.dayNight.state.sunElevation,
        phase: this.dayNight.state.phase,
        timeOfDay: this.dayNight.state.timeOfDay,
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

  private updateTorchLights(dt: number, dayFactor: number): void {
    this.torchLightT += dt;
    const found = this.world.collectEmitters(
      this.player.x,
      this.player.eyeY,
      this.player.z,
      22,
      this.torchLights.length,
    );
    for (let i = 0; i < this.torchLights.length; i++) {
      const pl = this.torchLights[i]!;
      const e = found[i];
      if (!e) {
        pl.intensity = 0;
        continue;
      }
      const flicker =
        0.72 +
        0.28 * this.torchFlame.intensity +
        0.05 * Math.sin(this.torchLightT * 14.3 + e.z * 2.2);
      // Daytime surface torches are subtle; caves/night they pop
      const nightBoost = 1.15 + (1 - dayFactor) * 0.55;
      pl.position.set(e.x + 0.5, e.y + 0.72, e.z + 0.5);
      const tid = this.world.getBlock(e.x, e.y, e.z);
      if (tid === Block.TORCH_NX) pl.position.set(e.x + 0.28, e.y + 0.78, e.z + 0.5);
      else if (tid === Block.TORCH_PX) pl.position.set(e.x + 0.72, e.y + 0.78, e.z + 0.5);
      else if (tid === Block.TORCH_NZ) pl.position.set(e.x + 0.5, e.y + 0.78, e.z + 0.28);
      else if (tid === Block.TORCH_PZ) pl.position.set(e.x + 0.5, e.y + 0.78, e.z + 0.72);
      pl.intensity = 1.35 * flicker * nightBoost;
      pl.distance = 12;
    }
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
    this.itemDrops.dispose();
    this.chestVisuals.dispose();
    this.viewHand.dispose();
    this.caterpillars.dispose();
    this.animals.dispose();
    this.hostiles.dispose();
    this.slenderGiant.dispose();
    this.birds.dispose();
    this.ambiance.dispose();
    this.audio.dispose();
    this.waterFX.dispose();
    this.world.dispose?.();
    this.torchFlame.dispose();
    for (const pl of this.torchLights) {
      this.scene.remove(pl);
      pl.dispose();
    }
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
    void this.audio.resume();
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
    this.viewHand.setHeldItem(this.survival.selectedSlot?.id ?? null);
    this.audio.ui();
    this.emitHud();
  }

  get selected(): ItemId {
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
    if (this.isTouch) {
      this.playing = true;
      this.emitHud();
    } else {
      this.canvas.requestPointerLock();
    }
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
    this.waterFX.setSize(w, h);
  };


  private onPointerLock = () => {
    const locked = document.pointerLockElement === this.canvas;
    if (locked) {
      this.playing = true;
      this.hadPointerLock = true;
      this.lookReadyAt = performance.now() + 80;
    } else if (this.hadPointerLock) {
      this.mouseDown.left = false;
      this.mouseDown.right = false;
      // Crafting / death unlock the pointer on purpose — keep session
      // "playing" so the start overlay doesn't cover those UIs.
      if (!this.craftingOpen && !this.openFurnacePos && !this.openChestPos && !this.survival.dead) {
        this.playing = false;
      }
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
    if (e.code === "KeyE") {
      e.preventDefault();
      if (this.openFurnacePos) this.closeFurnace();
      else if (this.openChestPos) this.closeChest();
      else this.toggleCrafting();
    }
    // Debug: toggle day/night without releasing pointer lock
    if (e.code === "F3" || (e.code === "KeyN" && e.shiftKey)) {
      e.preventDefault();
      this.toggleDayNightDebug();
    }
    if (e.code === "F4") {
      e.preventDefault();
      this.toggleFreeCraft();
    }
    if (e.code === "Escape" && (this.craftingOpen || this.openFurnacePos || this.openChestPos)) {
      e.preventDefault();
      this.setCraftingOpen(false);
      this.closeFurnace();
      this.closeChest();
    }
    if (e.code === "KeyQ") {
      e.preventDefault();
      this.dropSelectedItem();
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
    if (!this.playing || this.survival.dead || this.craftingOpen || this.openFurnacePos || this.openChestPos) return;
    if (e.button === 0) {
      this.mouseDown.left = true;
      this.tryBreak(true);
      // Also try melee if looking at a caterpillar / no block
      this.tryAttack();
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
    // Slightly snappier look on short landscape phones only
    const phoneLandscape =
      this.isTouch &&
      typeof window !== "undefined" &&
      window.matchMedia(
        "(orientation: landscape) and (max-height: 520px)",
      ).matches;
    const lookMul = phoneLandscape ? 2.05 : 1.6;
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.touchLookId) {
        const dx = t.clientX - this.lastTouchLook.x;
        const dy = t.clientY - this.lastTouchLook.y;
        this.lastTouchLook = { x: t.clientX, y: t.clientY };
        if (!this.survival.dead) {
          this.player.applyLook(dx, dy, MOUSE_SENS * lookMul);
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
    this.viewHand.punch();
    this.audio.breakBlock(surfaceFromBlock(id), x + 0.5, y + 0.5, z + 0.5);
    this.survival.damageHeldTool(1);
    const drop = canHarvest(id, this.survival.heldToolId())
      ? blockDrop(id)
      : null;
    if (drop !== null) {
      this.itemDrops.spawn(drop, x, y, z);
    }
    if (isFurnace(id)) {
      const st = this.furnaces.remove(x, y, z);
      if (st) {
        for (const stack of this.furnaces.contents(st)) {
          const show = Math.min(stack.count, 6);
          for (let n = 0; n < show; n++) {
            this.itemDrops.spawn(stack.id, x, y, z);
          }
          if (stack.count > show) {
            this.survival.addItem(stack.id, stack.count - show);
          }
        }
      }
      if (this.openFurnacePos &&
        this.openFurnacePos.x === x &&
        this.openFurnacePos.y === y &&
        this.openFurnacePos.z === z
      ) {
        this.closeFurnace();
      }
    }
    if (isChest(id)) {
      const st =
        this.chests.get(x, y, z) ??
        this.chests.ensure(x, y, z, { seed: this.world.seed });
      this.chests.remove(x, y, z);
      if (st) {
        for (const stack of this.chests.contents(st)) {
          const show = Math.min(stack.count, 8);
          for (let n = 0; n < show; n++) this.itemDrops.spawn(stack.id, x, y, z);
          if (stack.count > show) {
            this.survival.addItem(stack.id, stack.count - show);
          }
        }
      }
      if (
        this.openChestPos &&
        this.openChestPos.x === x &&
        this.openChestPos.y === y &&
        this.openChestPos.z === z
      ) {
        this.closeChest();
      }
    }
    if (isBed(id) && this.survival.bedSpawn &&
      this.survival.bedSpawn.x === x &&
      this.survival.bedSpawn.y === y &&
      this.survival.bedSpawn.z === z
    ) {
      this.survival.bedSpawn = null;
    }
    this.spawnBreakParticles(x + 0.5, y + 0.5, z + 0.5);
    this.survival.addExhaustion(0.5);
    this.emitHud();
  }

  private tryPlace(force = false): void {
    const now = performance.now();
    if (!force && now - this.lastPlace < 200) return;
    if (this.survival.dead) return;
    if (this.craftingOpen || this.openFurnacePos || this.openChestPos) return;
    const held = this.survival.selectedSlot?.id;
    if (!this.target) {
      if (held && isFood(held)) {
        this.tryEat();
        this.lastPlace = now;
      }
      return;
    }
    const lookId = this.world.getBlock(
      this.target.x,
      this.target.y,
      this.target.z,
    );
    if (isFurnace(lookId)) {
      this.openFurnaceAt(this.target.x, this.target.y, this.target.z);
      this.lastPlace = now;
      return;
    }
    if (isChest(lookId)) {
      this.openChestAt(this.target.x, this.target.y, this.target.z);
      this.lastPlace = now;
      return;
    }
    if (isBed(lookId)) {
      this.trySleep(this.target.x, this.target.y, this.target.z);
      this.lastPlace = now;
      return;
    }
    if (held && isFood(held)) {
      this.tryEat();
      this.lastPlace = now;
      return;
    }
    if (!this.survival.hasSelectedPlaceable()) return;
    const px = this.target.x + this.target.nx;
    const py = this.target.y + this.target.ny;
    const pz = this.target.z + this.target.nz;
    if (py < 0 || py >= CHUNK_HEIGHT) return;
    if (this.player.overlapsBlock(px, py, pz)) return;
    const dest = this.world.getBlock(px, py, pz);
    // Cast through water: replace the water cell, don't require air
    if (dest !== Block.AIR && !isWater(dest)) return;
    const itemId = this.survival.selectedSlot!.id;
    const blockId = placeableBlock(itemId);
    if (blockId === null) return;

    if (isPlant(blockId)) {
      if (isWater(dest)) return;
      if (isTorch(blockId)) {
        const placed = torchIdFromHitFace(
          this.target.nx,
          this.target.ny,
          this.target.nz,
        );
        if (placed === null) return;
        const [ax, ay, az] = torchAttachDir(placed);
        const support = this.world.getBlock(px + ax, py + ay, pz + az);
        if (!canSupportTorch(support)) return;
        const ok = this.world.setBlock(px, py, pz, placed);
        if (ok) {
          this.viewHand.punch();
          this.audio.placeBlock(
            surfaceFromBlock(placed),
            px + 0.5,
            py + 0.5,
            pz + 0.5,
          );
          this.survival.consumeSelected();
          this.viewHand.setHeldItem(this.survival.selectedSlot?.id ?? null);
          this.lastPlace = now;
          this.survival.addExhaustion(0.15);
          this.emitHud();
        }
        return;
      }
      const below = this.world.getBlock(px, py - 1, pz);
      if (!isSolid(below) || isPlant(below) || isWater(below)) return;
    }

    const ok = this.world.setBlock(px, py, pz, blockId);
    if (ok) {
      this.viewHand.punch();
      this.audio.placeBlock(
        surfaceFromBlock(blockId),
        px + 0.5,
        py + 0.5,
        pz + 0.5,
      );
      this.survival.consumeSelected();
      if (blockId === Block.FURNACE) {
        this.furnaces.ensure(px, py, pz);
      }
      if (blockId === Block.CHEST) {
        this.chests.ensure(px, py, pz, { empty: true });
      }
      this.viewHand.setHeldItem(this.survival.selectedSlot?.id ?? null);
      this.lastPlace = now;
      this.survival.addExhaustion(0.15);
      this.emitHud();
    }
  }

  /** LMB attack hostiles first, then caterpillars, then animals */
  private tryAttack(): void {
    const now = performance.now();
    if (now - this.lastAttack < 320) return;
    if (this.survival.dead || this.craftingOpen || this.openFurnacePos || this.openChestPos) return;
    const [lx, ly, lz] = this.player.lookDir();
    const tool = getTool(this.survival.heldToolId());
    const dmg = tool.attack;
    const range = tool.kind === "sword" ? 4.2 : 3.2;
    let result =
      this.hostiles.tryPunch(
        this.player.x,
        this.player.eyeY,
        this.player.z,
        lx,
        ly,
        lz,
        range,
        dmg,
      ) ||
      this.caterpillars.tryPunch(
        this.player.x,
        this.player.eyeY,
        this.player.z,
        lx,
        ly,
        lz,
        range,
        dmg,
      ) ||
      this.animals.tryPunch(
        this.player.x,
        this.player.eyeY,
        this.player.z,
        lx,
        ly,
        lz,
        range,
        dmg,
      );
    if (result) {
      this.lastAttack = now;
      this.viewHand.punch();
      this.audio.swing();
      if (result.outcome === "dead") {
        for (const stack of mobLoot(result.kind)) {
          for (let i = 0; i < stack.count; i++) {
            this.itemDrops.spawn(stack.id, result.x, result.y, result.z);
          }
        }
      }
      if (isTool(this.survival.heldToolId() ?? 0)) {
        this.survival.damageHeldTool(1);
      }
      this.emitHud();
    }
  }

  craftRecipe(recipeId: string): boolean {
    const recipe = CRAFTABLE_RECIPES.find((r) => r.id === recipeId);
    if (!recipe) return false;
    const ok = this.survival.craft(recipe);
    if (ok) {
      this.audio.craft();
      this.viewHand.setHeldItem(this.survival.selectedSlot?.id ?? null);
      this.emitHud();
    }
    return ok;
  }

  /** Q — toss one of the selected hotbar item in front of the player. */
  dropSelectedItem(): void {
    if (this.survival.dead || !this.playing) return;
    const id = this.survival.dropSelected(false);
    if (!id) return;
    const [lx, ly, lz] = this.player.lookDir();
    const speed = 7.2;
    this.itemDrops.throwFrom(
      id,
      this.player.x + lx * 0.55,
      this.player.eyeY - 0.15,
      this.player.z + lz * 0.55,
      lx * speed + this.player.vx * 0.35,
      ly * speed + 2.4,
      lz * speed + this.player.vz * 0.35,
    );
    this.audio.ui();
    this.viewHand.setHeldItem(this.survival.selectedSlot?.id ?? null);
    this.emitHud();
  }

  /** Debug: snap between noon and midnight for testing hostiles / lighting. */
  toggleDayNightDebug(): void {
    if (this.dayNight.isDaytime) {
      this.dayNight.setToMidnight();
    } else {
      this.dayNight.setToNoon();
    }
    const dn = this.dayNight.update(
      0,
      this.player.x,
      this.player.y,
      this.player.z,
      this.camera,
    );
    this.weather.setDayNight(dn);
    this.dayNight.finalizeKeyLight();
    this.emitHud();
  }

  /** Debug: craft without ingredients. */
  toggleFreeCraft(): void {
    this.survival.freeCraft = !this.survival.freeCraft;
    this.audio.ui();
    this.emitHud();
  }

  private toggleCrafting(): void {
    this.setCraftingOpen(!this.craftingOpen);
    this.audio.ui();
  }

  setCraftingOpen(open: boolean): void {
    if (open) {
      this.closeFurnace(false);
      this.closeChest(false);
    } else this.returnCursorOrDrop();
    this.craftingOpen = open;
    this.mouseDown.left = false;
    this.mouseDown.right = false;
    if (open) {
      if (document.pointerLockElement === this.canvas) {
        document.exitPointerLock();
      }
    } else if (!this.isTouch && this.playing && !this.openFurnacePos && !this.openChestPos) {
      this.canvas.requestPointerLock();
    }
    this.emitHud();
  }

  private openFurnaceAt(x: number, y: number, z: number): void {
    this.craftingOpen = false;
    this.closeChest(false);
    this.openFurnacePos = { x, y, z };
    this.furnaces.ensure(x, y, z);
    this.mouseDown.left = false;
    this.mouseDown.right = false;
    if (document.pointerLockElement === this.canvas) {
      document.exitPointerLock();
    }
    this.audio.ui();
    this.emitHud();
  }

  closeFurnace(relock = true): void {
    if (!this.openFurnacePos) return;
    this.returnCursorOrDrop();
    this.openFurnacePos = null;
    this.mouseDown.left = false;
    this.mouseDown.right = false;
    if (relock && !this.isTouch && this.playing && !this.craftingOpen && !this.openChestPos) {
      this.canvas.requestPointerLock();
    }
    this.emitHud();
  }

  private returnCursorOrDrop(): void {
    this.survival.parkCursor();
    const left = this.survival.cursor;
    if (!left) return;
    const [lx, ly, lz] = this.player.lookDir();
    for (let i = 0; i < left.count; i++) {
      this.itemDrops.throwFrom(
        left.id,
        this.player.x + lx * 0.4,
        this.player.eyeY - 0.1,
        this.player.z + lz * 0.4,
        lx * 3 + (Math.random() - 0.5),
        2.5 + Math.random(),
        lz * 3 + (Math.random() - 0.5),
      );
    }
    this.survival.cursor = null;
  }

  /** Click inventory / hotbar. Shift-click routes to furnace, chest, or backpack. */
  inventoryClickHotbar(i: number, shift = false): void {
    if (i < 0 || i >= INV_SIZE) return;
    if (shift && this.openFurnacePos) {
      this.shiftHotbarToFurnace(i);
    } else if (shift && this.openChestPos) {
      const st = this.chests.ensure(
        this.openChestPos.x,
        this.openChestPos.y,
        this.openChestPos.z,
        { seed: this.world.seed },
      );
      this.survival.shiftInto(i, st.slots);
    } else if (shift && this.craftingOpen) {
      this.survival.shiftHotbarBackpack(i);
    } else {
      this.survival.clickSlot(i);
    }
    this.viewHand.setHeldItem(this.survival.selectedSlot?.id ?? null);
    this.audio.ui();
    this.emitHud();
  }

  private openChestAt(x: number, y: number, z: number): void {
    this.craftingOpen = false;
    this.closeFurnace(false);
    this.openChestPos = { x, y, z };
    this.chests.ensure(x, y, z, { seed: this.world.seed });
    this.chestVisuals.setOpen(x, y, z, true);
    this.mouseDown.left = false;
    this.mouseDown.right = false;
    if (document.pointerLockElement === this.canvas) {
      document.exitPointerLock();
    }
    this.audio.chestOpen(x + 0.5, y + 0.5, z + 0.5);
    this.emitHud();
  }

  closeChest(relock = true): void {
    if (!this.openChestPos) return;
    const pos = this.openChestPos;
    this.chestVisuals.setOpen(pos.x, pos.y, pos.z, false);
    this.audio.chestClose(pos.x + 0.5, pos.y + 0.5, pos.z + 0.5);
    this.returnCursorOrDrop();
    this.openChestPos = null;
    this.mouseDown.left = false;
    this.mouseDown.right = false;
    if (relock && !this.isTouch && this.playing && !this.craftingOpen && !this.openFurnacePos) {
      this.canvas.requestPointerLock();
    }
    this.emitHud();
  }

  chestClickSlot(i: number, shift = false): void {
    const pos = this.openChestPos;
    if (!pos) return;
    const st = this.chests.ensure(pos.x, pos.y, pos.z, { seed: this.world.seed });
    if (shift) {
      this.survival.shiftFrom(st.slots, i);
    } else {
      this.survival.cursor = this.chests.clickSlot(st, i, this.survival.cursor);
    }
    this.viewHand.setHeldItem(this.survival.selectedSlot?.id ?? null);
    this.audio.ui();
    this.emitHud();
  }

  private tryEat(): void {
    const now = performance.now();
    if (now - this.lastEat < 450) return;
    if (this.survival.eatSelected()) {
      this.lastEat = now;
      this.audio.eat();
      this.viewHand.punch();
      this.viewHand.setHeldItem(this.survival.selectedSlot?.id ?? null);
      this.emitHud();
    }
  }

  private trySleep(x: number, y: number, z: number): void {
    this.survival.bedSpawn = { x, y, z };
    if (this.dayNight.isDaytime) {
      this.flashNotice("You can only sleep at night");
      this.audio.ui();
      return;
    }
    if (this.hostiles.anyNear(this.player.x, this.player.z, 16) ||
      this.slenderGiant.anyNear(this.player.x, this.player.z, 22)
    ) {
      this.flashNotice("You can't sleep — monsters nearby");
      this.audio.ui();
      return;
    }
    this.dayNight.skipToDawn();
    const dn = this.dayNight.update(
      0,
      this.player.x,
      this.player.y,
      this.player.z,
      this.camera,
    );
    this.weather.setDayNight(dn);
    this.dayNight.finalizeKeyLight();
    this.audio.sleep();
    this.flashNotice("You sleep until dawn");
    this.emitHud();
  }

  private flashNotice(msg: string): void {
    this.notice = msg;
    this.noticeT = 3.2;
    this.emitHud();
  }

  private preferredFurnaceSlot(id: ItemId): FurnaceSlot | null {
    if (isSmeltable(id)) return "input";
    if (isFuel(id)) return "fuel";
    return null;
  }

  private furnaceAccepts(slot: FurnaceSlot, id: ItemId): boolean {
    if (slot === "output") return false;
    if (slot === "input") return isSmeltable(id);
    return isFuel(id);
  }

  private mergeIntoFurnace(
    st: FurnaceState,
    dest: FurnaceSlot,
    from: ItemStack,
  ): ItemStack | null {
    const cur = st[dest];
    if (!cur) {
      st[dest] = { id: from.id, count: from.count, durability: from.durability };
      return null;
    }
    if (cur.id !== from.id) return from;
    const max = itemMaxStack(from.id);
    const n = Math.min(from.count, max - cur.count);
    if (n <= 0) return from;
    cur.count += n;
    const left = from.count - n;
    return left > 0 ? { ...from, count: left } : null;
  }

  private shiftHotbarToFurnace(i: number): void {
    const pos = this.openFurnacePos;
    if (!pos) return;
    const src = this.survival.slots[i];
    this.survival.select(i);
    if (!src) return;
    const dest = this.preferredFurnaceSlot(src.id);
    if (!dest) return;
    const st = this.furnaces.ensure(pos.x, pos.y, pos.z);
    this.survival.slots[i] = this.mergeIntoFurnace(st, dest, src);
  }

  furnaceClickSlot(slot: FurnaceSlot, shift = false): void {
    const pos = this.openFurnacePos;
    if (!pos) return;
    const st = this.furnaces.ensure(pos.x, pos.y, pos.z);
    if (shift) {
      const stack = st[slot];
      if (!stack) return;
      if (stack.id === Item.IRON_INGOT && slot === "output") {
        this.survival.smeltedIron = true;
      }
      st[slot] = this.survival.insertStack(stack);
      this.audio.pickup();
      this.viewHand.setHeldItem(this.survival.selectedSlot?.id ?? null);
      this.emitHud();
      return;
    }

    if (slot === "output") {
      this.takeOutputToCursor(st);
      this.emitHud();
      return;
    }

    const cur = this.survival.cursor;
    if (cur && !this.furnaceAccepts(slot, cur.id)) {
      // Can't place that here — pick up the slot if cursor is empty only.
      return;
    }
    const r = clickStacks(st[slot], this.survival.cursor);
    st[slot] = r.slot;
    this.survival.cursor = r.cursor;
    this.audio.ui();
    this.emitHud();
  }

  private takeOutputToCursor(st: FurnaceState): void {
    const out = st.output;
    if (!out) return;
    if (out.id === Item.IRON_INGOT) this.survival.smeltedIron = true;
    if (!this.survival.cursor) {
      this.survival.cursor = { ...out };
      st.output = null;
      this.audio.pickup();
      return;
    }
    if (this.survival.cursor.id !== out.id) return;
    const max = itemMaxStack(out.id);
    const n = Math.min(out.count, max - this.survival.cursor.count);
    if (n <= 0) return;
    this.survival.cursor.count += n;
    out.count -= n;
    if (out.count <= 0) st.output = null;
    this.audio.pickup();
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
    if (this.playing || this.animals.count > 0) {
      this.animals.update(dt, this.world, this.player);
    }

    // Day/night first so hostiles know sun state
    const dn = this.dayNight.update(
      dt,
      this.player.x,
      this.player.y,
      this.player.z,
      this.camera,
    );

    if (this.playing || this.hostiles.count > 0) {
      const hits = this.hostiles.update(
        dt,
        this.world,
        this.player,
        dn.dayFactor,
      );
      if (hits.length > 0 && !this.survival.dead && this.playing) {
        for (const h of hits) {
          this.applyHostileHit(h.damage, h.kind);
        }
      }
    }

    if (this.playing || this.itemDrops.count > 0) {
      const collected = this.itemDrops.update(
        dt,
        this.world,
        this.player,
        (id) => this.survival.addItem(id, 1) > 0,
      );
      if (collected.length > 0) {
        this.audio.pickup();
        this.emitHud();
      }
    }

    if (this.noticeT > 0) {
      this.noticeT -= dt;
      if (this.noticeT <= 0) this.notice = "";
    }

    this.chestVisuals.update(
      dt,
      this.world,
      this.player.x,
      this.player.eyeY,
      this.player.z,
    );

    this.world.ensureChunksAround(this.player.x, this.player.z);

    this.birds.setDayFactor(dn.dayFactor);
    this.birds.update(
      dt,
      this.player.x,
      this.player.y,
      this.player.z,
      this.player.yaw,
    );
    this.weather.setDayNight(dn);
    this.weather.update(
      dt,
      this.world,
      this.player.x,
      this.player.y,
      this.player.z,
      this.player.submerged,
    );
    {
      const w = this.weather.sample;
      this.torchFlame.update(dt, w.windX);
    }
    this.updateTorchLights(dt, dn.dayFactor);

    // Cloth wind after weather so storm vectors are current (per-giant sample)
    if (this.playing || this.slenderGiant.count > 0) {
      this.slenderGiant.update(
        dt,
        this.world,
        this.player,
        dn.dayFactor,
        (x, z) => {
          const s = this.weather.sampleAt(x, z);
          return { windX: s.windX, windZ: s.windZ };
        },
      );
    }

    // Ambiance after weather so we can use wind/rain sample
    {
      const w = this.weather.sample;
      this.ambiance.update(
        dt,
        this.world,
        this.player,
        dn.dayFactor,
        w.windX,
        w.windZ,
        w.rain,
      );
    }
    // Landing dust + thud
    if (this.player.onGround && !this.wasOnGround && this.player.vy <= 0.01) {
      this.ambiance.burstDust(
        this.player.x,
        this.player.y,
        this.player.z,
        0.8,
      );
      this.audio.land(false);
    }
    // Enter water splash
    if (this.player.inWater && !this.wasInWater) {
      this.audio.splash(0.7);
    }
    this.wasOnGround = this.player.onGround;
    this.wasInWater = this.player.inWater;

    // Audio ambience + footsteps
    {
      const w = this.weather.sample;
      const moving =
        this.keys.has("KeyW") ||
        this.keys.has("KeyA") ||
        this.keys.has("KeyS") ||
        this.keys.has("KeyD") ||
        this.keys.has("ArrowUp") ||
        this.keys.has("ArrowDown") ||
        this.keys.has("ArrowLeft") ||
        this.keys.has("ArrowRight") ||
        Math.hypot(this.touchMove.x, this.touchMove.y) > 0.12;
      const sprinting =
        (this.keys.has("ShiftLeft") || this.keys.has("ShiftRight")) &&
        this.player.onGround;
      this.audio.update(dt, {
        playing: this.playing && !this.survival.dead,
        moving,
        onGround: this.player.onGround,
        speed: this.player.speed,
        sprinting,
        inWater: this.player.inWater,
        submerged: this.player.submerged,
        dayFactor: dn.dayFactor,
        rain: w.rain,
        windSpeed: w.windSpeed,
        surface: this.footSurface(),
        listenerX: this.player.x,
        listenerY: this.player.eyeY,
        listenerZ: this.player.z,
        listenerYaw: this.player.yaw,
      });
    }

    // Hurt SFX
    if (this.survival.health < this.prevHealth) {
      this.audio.hurt();
    }
    this.prevHealth = this.survival.health;

    this.dayNight.finalizeKeyLight();

    // Water FX: reflection / refraction RTs + underwater state
    this.waterFX.update(dt);
    const fog = this.scene.fog as THREE.Fog;
    const sky =
      this.scene.background instanceof THREE.Color
        ? this.scene.background
        : new THREE.Color(0x6eb6e8);
    this.waterFX.updateState(
      this.world,
      this.player.x,
      this.player.eyeY,
      this.player.z,
      sky,
      fog,
      this.dayNight.state.sunDir,
      this.dayNight.state.sunColor,
      this.dayNight.state.sunIntensity,
      this.dayNight.state.dayFactor,
    );
    // If not underwater, restore fog from weather (water only overrides when submerged)
    // weather already set fog this frame before us when above water — re-apply underwater only
    if (!this.waterFX.underwater) {
      // leave fog as weather set it
    } else {
      this.scene.background = new THREE.Color(0x062a3c);
      this.renderer.setClearColor(0x062a3c, 1);
    }

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
      const plant = isPlant(
        this.world.getBlock(this.target.x, this.target.y, this.target.z),
      );
      if (plant) {
        const box = plantHitbox(
          this.world.getBlock(this.target.x, this.target.y, this.target.z),
        );
        const sx = box.maxX - box.minX;
        const sy = box.maxY - box.minY;
        const sz = box.maxZ - box.minZ;
        this.highlight.scale.set(sx, sy, sz);
        this.highlight.position.set(
          this.target.x + (box.minX + box.maxX) * 0.5,
          this.target.y + (box.minY + box.maxY) * 0.5,
          this.target.z + (box.minZ + box.maxZ) * 0.5,
        );
      } else {
        this.highlight.scale.set(1, 1, 1);
        this.highlight.position.set(
          this.target.x + 0.5,
          this.target.y + 0.5,
          this.target.z + 0.5,
        );
      }
    } else {
      this.highlight.visible = false;
    }

    this.updateCrackOverlay();


    if (this.playing && !this.survival.dead) {
      // continuous place while RMB held
      if (this.mouseDown.right) this.tryPlace(false);
    }

    this.updateParticles(dt);

    // Gentle view bob while walking on ground (keep mild — no seasick)
    {
      const moving =
        this.keys.has("KeyW") ||
        this.keys.has("KeyA") ||
        this.keys.has("KeyS") ||
        this.keys.has("KeyD") ||
        this.keys.has("ArrowUp") ||
        this.keys.has("ArrowDown") ||
        this.keys.has("ArrowLeft") ||
        this.keys.has("ArrowRight") ||
        Math.hypot(this.touchMove.x, this.touchMove.y) > 0.12;
      const grounded = this.player.onGround && !this.player.inWater;
      const speed = this.player.speed;
      const want =
        this.playing &&
        !this.survival.dead &&
        grounded &&
        moving &&
        speed > 0.4
          ? Math.min(1, speed / 5.5)
          : 0;
      this.viewBobAmt += (want - this.viewBobAmt) * Math.min(1, 8 * dt);
      if (this.viewBobAmt > 0.02) {
        this.viewBobPhase += dt * (7.2 + this.viewBobAmt * 3.5);
      } else {
        this.viewBobPhase *= 1 - Math.min(1, dt * 4);
        this.viewBobAmt *= 1 - Math.min(1, dt * 6);
      }
      // Use sin² for soft vertical steps (no hard snap)
      const step = Math.sin(this.viewBobPhase);
      const bobY = step * step * 0.038 * this.viewBobAmt;
      // Tiny lateral sway (very small)
      const bobSide = Math.sin(this.viewBobPhase * 0.5) * 0.012 * this.viewBobAmt;
      const [rx, rz] = this.player.rightXZ();
      this.camera.position.set(
        this.player.x + rx * bobSide,
        this.player.eyeY + bobY,
        this.player.z + rz * bobSide,
      );
    }
    this.camera.rotation.y = this.player.yaw;
    this.camera.rotation.x = this.player.pitch;
    this.camera.rotation.z = 0;

    // First-person hand / held block (camera-local)
    this.viewHand.setVisible(this.playing && !this.survival.dead);
    this.viewHand.setHeldItem(this.survival.selectedSlot?.id ?? null);
    {
      const moving =
        this.keys.has("KeyW") ||
        this.keys.has("KeyA") ||
        this.keys.has("KeyS") ||
        this.keys.has("KeyD") ||
        this.keys.has("ArrowUp") ||
        this.keys.has("ArrowDown") ||
        this.keys.has("ArrowLeft") ||
        this.keys.has("ArrowRight") ||
        Math.hypot(this.touchMove.x, this.touchMove.y) > 0.12;
      this.viewHand.setMotion(
        this.player.speed,
        this.player.onGround || this.player.inWater,
        moving,
      );
    }
    this.viewHand.update(dt);

    // Reflection / refraction scene captures (water hidden inside)
    this.waterFX.renderPasses(
      this.renderer,
      this.scene,
      this.camera,
      this.world.waterGroup,
    );

    this.renderer.render(this.scene, this.camera);
    this.waterFX.renderUnderwaterOverlay(this.renderer);
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
    const wasGround = this.player.onGround;
    this.player.update(dt, this.world, moveF, moveR, jump, sprint);
    if (jump && wasGround && !this.player.onGround) {
      this.audio.jump();
    }

    if (this.player.y < -8) {
      this.survival.damage(20);
    }
  }

  private footSurface(): ReturnType<typeof surfaceFromBlock> {
    const x = Math.floor(this.player.x);
    const z = Math.floor(this.player.z);
    const y = Math.floor(this.player.y - 0.1);
    return surfaceFromBlock(this.world.getBlock(x, y, z));
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
      this.player.inWater,
    );

    // Drowning — only when head is submerged
    if (this.player.submerged) {
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
    this.viewHand.setMining(mining && !!this.target);
    if (mining && this.target && this.target.y > 0) {
      const id = this.world.getBlock(
        this.target.x,
        this.target.y,
        this.target.z,
      );
      if (this.survival.mineProgress > 0) {
        this.audio.mineHit(
          surfaceFromBlock(id),
          this.target.x + 0.5,
          this.target.y + 0.5,
          this.target.z + 0.5,
        );
      }
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

    // Chunk ticks: unsupported plants (broke dirt under a flower, etc.)
    const pops = this.world.tick(dt, this.player.x, this.player.z);
    if (pops.length > 0) {
      for (const p of pops) {
        const drop = blockDrop(p.id);
        if (drop !== null) this.itemDrops.spawn(drop, p.x, p.y, p.z);
        this.audio.breakBlock(
          surfaceFromBlock(p.id),
          p.x + 0.5,
          p.y + 0.5,
          p.z + 0.5,
        );
      }
    }

    const furnaceFlips = this.furnaces.update(dt);
    for (const f of furnaceFlips) {
      const cur = this.world.getBlock(f.x, f.y, f.z);
      if (!isFurnace(cur)) continue;
      const next = f.lit ? Block.FURNACE_LIT : Block.FURNACE;
      if (cur !== next) this.world.setBlock(f.x, f.y, f.z, next);
    }

    if (this.survival.dead) {
      this.mouseDown.left = false;
      this.mouseDown.right = false;
      if (document.pointerLockElement === this.canvas) {
        document.exitPointerLock();
      }
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
    // Full 10 stages (0..9) over mine progress 0..1
    const n = CRACK_STAGE_COUNT;
    const stage = Math.min(n - 1, Math.floor(p * n));
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
    // Caterpillars barely nibble now — real danger is night hostiles
    if (d < 0.95) {
      this.survival.damage(1);
      this._caterHurt = 1.4;
      const ang = Math.random() * Math.PI * 2;
      this.player.vx += Math.cos(ang) * 2.2;
      this.player.vz += Math.sin(ang) * 2.2;
      this.player.vy = Math.max(this.player.vy, 2.5);
    }
  }

  private applyHostileHit(
    damage: number,
    kind: "shambler" | "crawler" | "slender",
  ): void {
    if (this.survival.dead) return;
    this.survival.damage(damage);
    this.audio.hurt();
    // Knockback away from nearest threat direction (generic push)
    const ang = this.player.yaw + Math.PI + (Math.random() - 0.5) * 0.8;
    const force = kind === "slender" ? 7.5 : kind === "crawler" ? 5.5 : 6.2;
    this.player.vx += Math.sin(ang) * force;
    this.player.vz += Math.cos(ang) * force;
    this.player.vy = Math.max(this.player.vy, kind === "slender" ? 5.5 : 4.2);
    this.emitHud();
  }

  private snapshotFurnace(): HudSnapshot["furnace"] {
    const pos = this.openFurnacePos;
    if (!pos) return null;
    const st = this.furnaces.get(pos.x, pos.y, pos.z);
    if (!st) return null;
    return {
      input: st.input ? { ...st.input } : null,
      fuel: st.fuel ? { ...st.fuel } : null,
      output: st.output ? { ...st.output } : null,
      cook: st.cook / COOK_TIME,
      burn: st.burnMax > 0 ? st.burnLeft / st.burnMax : 0,
    };
  }

  private snapshotChest(): HotbarSlot[] | null {
    const pos = this.openChestPos;
    if (!pos) return null;
    const st = this.chests.get(pos.x, pos.y, pos.z);
    if (!st) return null;
    return st.slots.map((s) =>
      s ? { id: s.id, count: s.count, durability: s.durability } : null,
    );
  }

  private emitHud(): void {
    const stats = this.caterpillars.stats;
    const hs = this.hostiles.stats;
    const w = this.weather.sample;
    const sel = this.survival.selectedSlot?.id ?? 0;
    const night = this.dayNight.state.dayFactor < 0.4;
    const tip = this.noticeT > 0 && this.notice
      ? this.notice
      : !this.survival.craftedFirst
      ? "Press E for inventory · wood → planks → chest / bed"
      : !this.survival.madePick
        ? "Craft a pickaxe to mine stone efficiently"
        : !this.survival.madeFurnace
          ? "Mine cobble → craft a furnace (8 cobble)"
          : !this.survival.smeltedIron
            ? "Caves hide coal and iron · stone pick for iron · smelt in the furnace"
            : night && hs.alive > 0
              ? hs.slender > 0
                ? "Something tall is watching — craft a sword, find shelter"
                : "Hostiles nearby — fight or hide until dawn"
              : night
                ? "Sleep in a bed to skip the night"
                : "Hunt animals · cook meat · 3 wool + 3 planks = bed";

    this.onHud?.({
      playing: this.playing,
      fps: this.fps,
      selected: sel,
      selectedName: itemName(sel),
      placeable: this.survival.slots.map((s) => s?.id ?? 0),
      pos: {
        x: this.player.x,
        y: this.player.y,
        z: this.player.z,
      },
      chunkGen: this.world.getQueueStats(),
      target: this.target,
      isTouch: this.isTouch,
      caterpillars: stats.alive,
      banished: stats.banished,
      animals: this.animals.count,
      hostiles: hs.alive,
      hostilesKilled: hs.killed,
      slenderNearby: hs.slender > 0,
      weather: w.kind,
      rain: w.rain,
      dayPhase: this.dayNight.state.phase,
      isDay: this.dayNight.state.dayFactor > 0.45,
      biome: this.world.getBiomeLabel(this.player.x, this.player.z),
      health: this.survival.health,
      maxHealth: MAX_HEALTH,
      hunger: this.survival.hunger,
      maxHunger: MAX_HUNGER,
      inventory: this.survival.slots.map((s) =>
        s
          ? { id: s.id, count: s.count, durability: s.durability }
          : null,
      ),
      selectedSlot: this.survival.selected,
      mineProgress: this.survival.mineProgress,
      dead: this.survival.dead,
      atlasUrl: this.atlasUrl,
      blockIcons: this.blockIcons,
      craftingOpen: this.craftingOpen,
      furnaceOpen: !!this.openFurnacePos,
      furnace: this.snapshotFurnace(),
      chestOpen: !!this.openChestPos,
      chest: this.snapshotChest(),
      recipes: CRAFTABLE_RECIPES.map((r) => ({
        id: r.id,
        name: r.name,
        hint: r.hint,
        canCraft: this.survival.canCraft(r),
        inputs: r.inputs.map((i) => ({
          id: i.id,
          count: i.count,
          name: itemName(i.id),
        })),
        output: {
          id: r.output.id,
          count: r.output.count,
          name: itemName(r.output.id),
        },
      })),
      freeCraft: this.survival.freeCraft,
      cursor: this.survival.cursor
        ? { ...this.survival.cursor }
        : null,
      tip,
      notice: this.noticeT > 0 ? this.notice : "",
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
      getBirds: () => {
        count: number;
        day: number;
        samples: { x: number; y: number; z: number; op: number }[];
      };
      getDayNight: () => {
        dayFactor: number;
        sunElevation: number;
        phase: number;
        timeOfDay: number;
      };
    };
  }
}
