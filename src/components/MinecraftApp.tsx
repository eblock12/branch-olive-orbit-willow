import { useCallback, useEffect, useRef, useState } from "react";
import { ClientOnly } from "@tanstack/react-router";
import { BLOCKS, isPlant } from "../game/blocks";
import type { GameEngine, HudSnapshot } from "../game/engine";
import { defaultDebugSettings, type DebugSettings } from "../game/debugSettings";
import type { HotbarSlot } from "../game/survival";
import {
  isBlockItem,
  itemColor,
  itemIconDataUrl,
  itemName,
  ITEM_DEFS,
  type ItemId,
} from "../game/items";

const DEFAULT_HUD: HudSnapshot = {
  playing: false,
  fps: 0,
  selected: 1,
  selectedName: "Dirt",
  placeable: [],
  pos: { x: 0, y: 0, z: 0 },
  chunkGen: {
    queued: 0,
    generating: 0,
    ready: 0,
    mesh: 0,
    loaded: 0,
    workers: 0,
    idleWorkers: 0,
    shared: false,
  },
  load: { progress: 0, have: 0, need: 1 },
  target: null,
  isTouch: false,
  caterpillars: 0,
  banished: 0,
  animals: 0,
  hostiles: 0,
  hostilesKilled: 0,
  slenderNearby: false,
  weather: "clear",
  rain: 0,
  snow: false,
  dayPhase: 0.2,
  isDay: true,
  biome: "Plains",
  seed: 0,
  health: 20,
  maxHealth: 20,
  hunger: 20,
  maxHunger: 20,
  armor: 0,
  armorSlots: [null, null, null, null],
  air: 5,
  maxAir: 5,
  submerged: false,
  eatJuice: 0,
  swingJuice: 0,
  inventory: Array.from({ length: 9 }, () => null),
  selectedSlot: 0,
  mineProgress: 0,
  dead: false,
  atlasUrl: "",
  blockIcons: {},
  craftingOpen: false,
  furnaceOpen: false,
  furnace: null,
  chestOpen: false,
  chest: null,
  recipes: [],
  freeCraft: false,
  debugOpen: false,
  debug: defaultDebugSettings(),
  cursor: null,
  tip: "Press E for inventory",
  notice: "",
};

function ItemIcon({
  id,
  atlasUrl,
  blockIcons,
  className = "h-7 w-7",
}: {
  id: ItemId;
  atlasUrl: string;
  blockIcons: Record<number, string>;
  className?: string;
}) {
  const name = itemName(id);
  const box = `${className} block shrink-0`;
  if (isBlockItem(id)) {
    const def = BLOCKS[id];
    if (!def) {
      return <span className={`${box} rounded-sm bg-bg/40`} />;
    }
    const iso = blockIcons[id];
    if (iso) {
      return (
        <span
          className={`${box} rounded-sm`}
          style={{
            backgroundImage: `url(${iso})`,
            backgroundSize: "contain",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
            imageRendering: "pixelated",
          }}
          title={name}
          role="img"
          aria-label={name}
        />
      );
    }
    return (
      <span
        className={`${box} rounded-sm shadow-inner`}
        style={{ background: def.color }}
        title={name}
      />
    );
  }
  const url = itemIconDataUrl(id);
  if (url) {
    return (
      <span
        className={`${box} rounded-sm bg-bg/40`}
        style={{
          backgroundImage: `url(${url})`,
          backgroundSize: "contain",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          imageRendering: "pixelated",
        }}
        title={name}
        role="img"
        aria-label={name}
      />
    );
  }
  return (
    <span
      className={`${box} rounded-sm shadow-inner`}
      style={{ background: itemColor(id) }}
      title={name}
    />
  );
}

function FurnaceSlot({
  label,
  slot,
  atlasUrl,
  blockIcons,
  onClick,
}: {
  label: string;
  slot: HotbarSlot;
  atlasUrl: string;
  blockIcons: Record<number, string>;
  onClick: (shift: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        onClick(e.shiftKey);
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
      }}
      className="flex flex-col items-center gap-1"
      style={{ touchAction: "manipulation" }}
    >
      <span className="text-[10px] uppercase tracking-wide text-subtle">
        {label}
      </span>
      <span className="relative flex h-12 w-12 items-center justify-center rounded-lg border border-border bg-bg/70">
        {slot ? (
          <>
            <ItemIcon
              id={slot.id}
              atlasUrl={atlasUrl}
              blockIcons={blockIcons}
              className="h-8 w-8"
            />
            {slot.count > 1 ? (
              <span className="absolute bottom-0.5 right-1 font-mono text-[10px] font-semibold text-fg">
                {slot.count}
              </span>
            ) : null}
          </>
        ) : null}
      </span>
    </button>
  );
}

function SlotCell({
  slot,
  atlasUrl,
  blockIcons,
  active,
  indexLabel,
  onClick,
  fluid,
}: {
  slot: HotbarSlot;
  atlasUrl: string;
  blockIcons: Record<number, string>;
  active?: boolean;
  indexLabel?: string;
  onClick: (shift: boolean) => void;
  fluid?: boolean;
}) {
  const id = slot?.id;
  const name = id != null ? itemName(id) : "Empty";
  const dur = slot?.durability;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        onClick(e.shiftKey);
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
      }}
      className={`relative flex aspect-square items-center justify-center overflow-hidden rounded-lg border p-0.5 transition-colors ${
        fluid ? "h-auto w-full min-w-0" : "h-11 w-11 shrink-0"
      } ${
        active
          ? "border-accent bg-elevated ring-1 ring-accent/40"
          : "border-border bg-bg/60 hover:bg-elevated"
      }`}
      style={{ touchAction: "manipulation" }}
      title={name}
      aria-label={name}
    >
      {id != null ? (
        <ItemIcon
          id={id}
          atlasUrl={atlasUrl}
          blockIcons={blockIcons}
          className="h-full w-full"
        />
      ) : null}
      {indexLabel ? (
        <span className="absolute bottom-0 left-0.5 font-mono text-[8px] text-subtle">
          {indexLabel}
        </span>
      ) : null}
      {slot && slot.count > 1 ? (
        <span className="absolute bottom-0 right-0.5 font-mono text-[10px] font-semibold text-fg">
          {slot.count}
        </span>
      ) : null}
      {dur != null && slot ? (
        <span className="absolute left-1 right-1 top-0.5 h-0.5 overflow-hidden rounded-full bg-bg/80">
          <span
            className="block h-full bg-emerald-400"
            style={{
              width: `${Math.max(0, Math.min(1, dur / (ITEM_DEFS[slot.id]?.maxDurability ?? 140))) * 100}%`,
            }}
          />
        </span>
      ) : null}
    </button>
  );
}

function InvGrid({
  slots,
  atlasUrl,
  blockIcons,
  selected,
  showHotbarNums,
  onSlot,
}: {
  slots: HotbarSlot[];
  atlasUrl: string;
  blockIcons: Record<number, string>;
  selected?: number;
  showHotbarNums?: boolean;
  onSlot: (i: number, shift: boolean) => void;
}) {
  return (
    <div className="grid w-full grid-cols-9 gap-1">
      {slots.map((slot, i) => (
        <SlotCell
          key={i}
          slot={slot}
          atlasUrl={atlasUrl}
          blockIcons={blockIcons}
          active={selected === i}
          indexLabel={showHotbarNums && i < 9 ? String(i + 1) : undefined}
          onClick={(shift) => onSlot(i, shift)}
          fluid
        />
      ))}
    </div>
  );
}

const ARMOR_LABELS = ["Head", "Chest", "Legs", "Feet"] as const;

function ArmorDoll({
  slots,
  atlasUrl,
  blockIcons,
  points,
  onSlot,
  engineRef,
  active,
}: {
  slots: HotbarSlot[];
  atlasUrl: string;
  blockIcons: Record<number, string>;
  points: number;
  onSlot: (i: number) => void;
  engineRef: React.RefObject<GameEngine | null>;
  active: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const eng = engineRef.current;
    if (!active || !eng) {
      eng?.setPreviewCanvas(null);
      return;
    }
    eng.setPreviewCanvas(canvasRef.current);
    return () => eng.setPreviewCanvas(null);
  }, [active, engineRef]);

  return (
    <div className="flex shrink-0 gap-2 rounded-xl border border-border bg-bg/40 px-2 py-2">
      <div className="flex flex-col items-center gap-1">
        <p className="text-[9px] font-medium uppercase tracking-wide text-subtle">
          Armor {points > 0 ? points : ""}
        </p>
        {ARMOR_LABELS.map((label, i) => (
          <div key={label} className="flex flex-col items-center">
            <SlotCell
              slot={slots[i] ?? null}
              atlasUrl={atlasUrl}
              blockIcons={blockIcons}
              onClick={() => onSlot(i)}
            />
            <span className="mt-0.5 text-[8px] uppercase tracking-wide text-subtle">
              {label}
            </span>
          </div>
        ))}
      </div>
      <canvas
        ref={canvasRef}
        className="h-[208px] w-[128px] shrink-0 cursor-grab touch-none rounded-lg bg-transparent active:cursor-grabbing"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          engineRef.current?.previewPointerDown(e.clientX);
        }}
        onPointerMove={(e) => engineRef.current?.previewPointerMove(e.clientX)}
        onPointerUp={() => engineRef.current?.previewPointerUp()}
        onPointerCancel={() => engineRef.current?.previewPointerUp()}
      />
    </div>
  );
}

const WEATHER_LABEL: Record<string, string> = {
  clear: "Clear",
  overcast: "Overcast",
  rain: "Rain",
  storm: "Storm",
  snow: "Snow",
  blizzard: "Blizzard",
};

/** phase 0 = 06:00, 0.25 = 12:00, 0.5 = 18:00, 0.75 = 00:00 */
function ToggleRow({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex w-full items-center justify-between gap-3 py-1.5 text-left"
    >
      <span className="text-xs text-fg">{label}</span>
      <span
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${
          on ? "bg-fg" : "bg-elevated ring-1 ring-inset ring-border"
        }`}
      >
        <span
          className={`block size-4 rounded-full shadow-sm transition-transform ${
            on ? "translate-x-4 bg-bg" : "translate-x-0 bg-muted"
          }`}
        />
      </span>
    </button>
  );
}

function SliderRow({
  label,
  value,
  min = 0,
  max = 2,
  step = 0.05,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block py-1">
      <span className="flex items-center justify-between text-xs text-fg">
        <span>{label}</span>
        <span className="font-mono text-[10px] text-subtle">
          {step >= 1 ? String(Math.round(value)) : value.toFixed(2)}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-border accent-accent"
      />
    </label>
  );
}

function DebugPanel({
  settings,
  onPatch,
  onClose,
}: {
  settings: DebugSettings;
  onPatch: (p: Partial<DebugSettings>) => void;
  onClose: () => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-[70] flex items-start justify-end p-3 pt-16 sm:p-4 sm:pt-20">
      <div className="pointer-events-auto max-h-[min(78vh,40rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-surface/95 p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-subtle">
              Tuner
            </p>
            <h2 className="text-sm font-semibold text-fg">Graphics & audio</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border bg-bg px-2.5 py-1 text-xs text-muted hover:text-fg"
          >
            Close
          </button>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <section>
            <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-subtle">
              World
            </p>
            <SliderRow
              label="View chunks"
              value={settings.viewRadius}
              min={6}
              max={24}
              step={1}
              onChange={(viewRadius) =>
                onPatch({
                  viewRadius,
                  lodFull: Math.min(settings.lodFull, viewRadius - 1),
                  lodMid: Math.min(settings.lodMid, viewRadius),
                })
              }
            />
            <SliderRow
              label="LOD 0 (full)"
              value={settings.lodFull}
              min={2}
              max={Math.max(2, settings.viewRadius - 1)}
              step={1}
              onChange={(lodFull) =>
                onPatch({
                  lodFull,
                  lodMid: Math.max(settings.lodMid, lodFull + 1),
                })
              }
            />
            <SliderRow
              label="LOD 1 (foliage)"
              value={settings.lodMid}
              min={Math.min(settings.viewRadius, settings.lodFull + 1)}
              max={settings.viewRadius}
              step={1}
              onChange={(lodMid) => onPatch({ lodMid })}
            />
            <p className="mb-2 mt-3 text-[10px] font-medium uppercase tracking-wider text-subtle">
              Graphics
            </p>
            <ToggleRow
              label="Vertex AO"
              on={settings.vertexAo}
              onChange={(vertexAo) => onPatch({ vertexAo })}
            />
            <ToggleRow
              label="Specular"
              on={settings.specular}
              onChange={(specular) => onPatch({ specular })}
            />
            <SliderRow
              label="Spec strength"
              value={settings.specStrength}
              onChange={(specStrength) => onPatch({ specStrength })}
            />
            <ToggleRow
              label="Light shafts"
              on={settings.volumetrics}
              onChange={(volumetrics) => onPatch({ volumetrics })}
            />
            <SliderRow
              label="Shaft strength"
              value={settings.volStrength}
              onChange={(volStrength) => onPatch({ volStrength })}
            />
            <ToggleRow
              label="Shadows"
              on={settings.shadows}
              onChange={(shadows) => onPatch({ shadows })}
            />
            <SliderRow
              label="Shadow dark"
              value={settings.shadowStrength}
              max={1.5}
              onChange={(shadowStrength) => onPatch({ shadowStrength })}
            />
            <ToggleRow
              label="Clouds"
              on={settings.clouds}
              onChange={(clouds) => onPatch({ clouds })}
            />
            <ToggleRow
              label="Cloud shadows"
              on={settings.cloudShadows}
              onChange={(cloudShadows) => onPatch({ cloudShadows })}
            />
            <ToggleRow
              label="Rain / snow"
              on={settings.particles}
              onChange={(particles) => onPatch({ particles })}
            />
            <ToggleRow
              label="Lightning"
              on={settings.lightning}
              onChange={(lightning) => onPatch({ lightning })}
            />
            <ToggleRow
              label="Leaf sway"
              on={settings.leafSway}
              onChange={(leafSway) => onPatch({ leafSway })}
            />
            <ToggleRow
              label="Fog"
              on={settings.fog}
              onChange={(fog) => onPatch({ fog })}
            />
            <ToggleRow
              label="Birds"
              on={settings.birds}
              onChange={(birds) => onPatch({ birds })}
            />
            <ToggleRow
              label="Ambiance FX"
              on={settings.ambiance}
              onChange={(ambiance) => onPatch({ ambiance })}
            />
          </section>
          <section>
            <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-subtle">
              Audio
            </p>
            <ToggleRow
              label="Mute"
              on={settings.mute}
              onChange={(mute) => onPatch({ mute })}
            />
            <SliderRow
              label="Master"
              value={settings.master}
              onChange={(master) => onPatch({ master })}
            />
            <SliderRow
              label="SFX"
              value={settings.sfx}
              onChange={(sfx) => onPatch({ sfx })}
            />
            <SliderRow
              label="Ambience"
              value={settings.amb}
              onChange={(amb) => onPatch({ amb })}
            />
            <SliderRow
              label="Rain"
              value={settings.rain}
              onChange={(rain) => onPatch({ rain })}
            />
            <SliderRow
              label="Wind"
              value={settings.wind}
              onChange={(wind) => onPatch({ wind })}
            />
            <SliderRow
              label="Thunder"
              value={settings.thunder}
              onChange={(thunder) => onPatch({ thunder })}
            />
            <SliderRow
              label="Reverb"
              value={settings.reverb}
              onChange={(reverb) => onPatch({ reverb })}
            />
            <p className="mt-3 text-[10px] leading-relaxed text-subtle">
              Reverb still ducks outdoors. Vertex AO remeshes nearby chunks.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

function formatClock(phase: number): string {
  const hours24 = ((phase * 24 + 6) % 24 + 24) % 24;
  const h = Math.floor(hours24);
  const m = Math.floor((hours24 - h) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}


function GameShell() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [hud, setHud] = useState<HudSnapshot>(DEFAULT_HUD);
  const [ready, setReady] = useState(false);
  const [worldKey, setWorldKey] = useState(0);
  const [bootGone, setBootGone] = useState(false);
  const [bootFade, setBootFade] = useState(false);
  const bootAt = useRef(
    typeof performance !== "undefined" ? performance.now() : 0,
  );
  const [confirmNew, setConfirmNew] = useState(false);
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  /** Short landscape + touch only — phones held sideways; not tablets/desktop. */
  const [phoneLandscape, setPhoneLandscape] = useState(false);
  const stickRef = useRef<HTMLDivElement>(null);
  const stickActive = useRef(false);
  const [selectFlash, setSelectFlash] = useState<{
    name: string;
    token: number;
  } | null>(null);
  const selectFlashToken = useRef(0);
  const selectFlashKey = useRef("");

  useEffect(() => {
    const mq = window.matchMedia(
      "(orientation: landscape) and (max-height: 520px)",
    );
    const sync = () => setPhoneLandscape(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!hud.furnaceOpen && !hud.craftingOpen && !hud.chestOpen && !hud.cursor) return;
    const move = (e: PointerEvent) => setPointer({ x: e.clientX, y: e.clientY });
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerdown", move);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", move);
    };
  }, [hud.furnaceOpen, hud.craftingOpen, hud.chestOpen, hud.cursor]);

  const selectedItemId = hud.inventory[hud.selectedSlot]?.id ?? 0;
  useEffect(() => {
    if (!hud.playing) return;
    const key = `${hud.selectedSlot}:${selectedItemId}`;
    if (selectFlashKey.current === key) return;
    selectFlashKey.current = key;
    if (!selectedItemId) {
      setSelectFlash(null);
      return;
    }
    selectFlashToken.current += 1;
    setSelectFlash({
      name: itemName(selectedItemId),
      token: selectFlashToken.current,
    });
  }, [hud.playing, hud.selectedSlot, selectedItemId]);

  useEffect(() => {
    let cancelled = false;
    let engine: GameEngine | null = null;

    (async () => {
      const { GameEngine: Engine } = await import("../game/engine");
      if (cancelled || !canvasRef.current) return;
      engine = new Engine({
        canvas: canvasRef.current,
        onHud: (h) => {
          if (!cancelled) setHud(h);
        },
      });
      engineRef.current = engine;
      engine.start();
      setReady(true);
    })();

    return () => {
      cancelled = true;
      engine?.dispose();
      engineRef.current = null;
    };
  }, [worldKey]);

  useEffect(() => {
    setBootGone(false);
    setBootFade(false);
    bootAt.current = performance.now();
  }, [worldKey]);

  useEffect(() => {
    if (bootGone || bootFade) return;
    if (!ready) return;
    const enough = hud.load.progress >= 0.86;
    const waited = performance.now() - bootAt.current > 900;
    if (!enough || !waited) return;
    setBootFade(true);
    const t = window.setTimeout(() => setBootGone(true), 520);
    return () => window.clearTimeout(t);
  }, [ready, hud.load.progress, bootGone, bootFade]);

  const onPlay = useCallback(() => {
    setConfirmNew(false);
    engineRef.current?.requestPlay();
  }, []);

  const onSelect = useCallback((i: number, shift = false) => {
    engineRef.current?.inventoryClickHotbar(i, shift);
  }, []);

  const onArmor = useCallback((i: number) => {
    engineRef.current?.inventoryClickArmor(i);
  }, []);

  const onCraft = useCallback((recipeId: string) => {
    engineRef.current?.craftRecipe(recipeId);
  }, []);

  const onCloseCraft = useCallback(() => {
    engineRef.current?.setCraftingOpen(false);
  }, []);

  const onCloseFurnace = useCallback(() => {
    engineRef.current?.closeFurnace();
  }, []);

  const onCloseChest = useCallback(() => {
    engineRef.current?.closeChest();
  }, []);

  const onChestSlot = useCallback((i: number, shift = false) => {
    engineRef.current?.chestClickSlot(i, shift);
  }, []);

  const onFurnaceSlot = useCallback((slot: "input" | "fuel" | "output", shift = false) => {
    engineRef.current?.furnaceClickSlot(slot, shift);
  }, []);

  const onToggleDayNight = useCallback(() => {
    engineRef.current?.toggleDayNightDebug();
  }, []);

  const onToggleFreeCraft = useCallback(() => {
    engineRef.current?.toggleFreeCraft();
  }, []);

  const onToggleDebug = useCallback(() => {
    engineRef.current?.toggleDebug();
  }, []);

  const onPatchDebug = useCallback((partial: Partial<DebugSettings>) => {
    engineRef.current?.patchDebug(partial);
  }, []);

  const onNewWorld = useCallback(() => {
    if (!confirmNew) {
      setConfirmNew(true);
      return;
    }
    engineRef.current?.abandonSave();
    setConfirmNew(false);
    setReady(false);
    setHud(DEFAULT_HUD);
    setWorldKey((k) => k + 1);
  }, [confirmNew]);


  const onStickDown = (e: React.PointerEvent) => {
    e.preventDefault();
    stickActive.current = true;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    updateStick(e);
  };
  const onStickMove = (e: React.PointerEvent) => {
    if (!stickActive.current) return;
    updateStick(e);
  };
  const onStickUp = () => {
    stickActive.current = false;
    engineRef.current?.setTouchMove(0, 0);
    const knob = stickRef.current?.querySelector("[data-knob]") as HTMLElement | null;
    if (knob) {
      knob.style.transform = "translate(-50%, -50%)";
    }
  };
  const updateStick = (e: React.PointerEvent) => {
    const el = stickRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = (e.clientX - cx) / (rect.width / 2);
    let dy = (e.clientY - cy) / (rect.height / 2);
    const mag = Math.hypot(dx, dy);
    if (mag > 1) {
      dx /= mag;
      dy /= mag;
    }
    engineRef.current?.setTouchMove(dx, dy);
    const knob = el.querySelector("[data-knob]") as HTMLElement | null;
    // Scale knob travel to stick size (smaller in phone landscape)
    const travel = Math.min(rect.width, rect.height) * 0.28;
    if (knob) {
      knob.style.transform = `translate(calc(-50% + ${dx * travel}px), calc(-50% + ${dy * travel}px))`;
    }
  };

  // Landscape phone + touch only — never alters portrait / desktop chrome
  const lsTouch = phoneLandscape && hud.isTouch;

  return (

    <div className="relative h-dvh w-full overflow-hidden bg-bg text-fg select-none touch-none">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full block"
        style={{ touchAction: "none" }}
      />

      {ready && hud.playing && hud.eatJuice > 0.02 && (
        <div
          className="pointer-events-none absolute inset-0 z-[8]"
          style={{
            background: `radial-gradient(circle at 50% 62%, rgba(255,196,120,${0.22 * hud.eatJuice}) 0%, transparent 55%)`,
          }}
        />
      )}
      {ready && hud.playing && hud.swingJuice > 0.04 && (
        <div
          className="pointer-events-none absolute inset-0 z-[8]"
          style={{
            background: `linear-gradient(${118 + hud.swingJuice * 20}deg, transparent 42%, rgba(255,255,255,${0.14 * hud.swingJuice}) 50%, transparent 58%)`,
          }}
        />
      )}

      {hud.playing && (
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2"
          aria-hidden
        >
          <div className="relative h-5 w-5">
            <div className="absolute left-1/2 top-0 h-full w-0.5 -translate-x-1/2 bg-fg/80" />
            <div className="absolute top-1/2 left-0 h-0.5 w-full -translate-y-1/2 bg-fg/80" />
          </div>
        </div>
      )}

      {ready && hud.playing && hud.notice && (
        <div className="pointer-events-none absolute left-1/2 top-[4.75rem] z-30 w-[min(92vw,28rem)] -translate-x-1/2 px-3">
          <p className="rounded-xl border border-border bg-surface/92 px-4 py-2 text-center text-sm font-medium text-fg shadow-lg">
            {hud.notice}
          </p>
        </div>
      )}

      {ready && (
        <div
          className={`pointer-events-none absolute left-0 right-0 top-0 z-20 flex items-start justify-between gap-2 ${
            lsTouch
              ? "p-2 pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))] pt-[max(0.35rem,env(safe-area-inset-top))]"
              : "gap-3 p-4 pt-[max(1rem,env(safe-area-inset-top))]"
          }`}
        >
          <div
            className={`rounded-xl border border-border bg-surface/85 backdrop-blur-sm ${
              lsTouch ? "px-2 py-1" : "px-3 py-2"
            }`}
          >
            <p
              className={`font-medium tracking-wide text-muted ${
                lsTouch ? "text-[10px]" : "text-xs"
              }`}
            >
              Blockworld
            </p>
            <p
              className={`mt-0.5 font-mono tabular-nums text-subtle ${
                lsTouch ? "text-[10px]" : "text-xs"
              }`}
            >
              {hud.fps > 0 ? `${hud.fps} fps` : "—"} ·{" "}
              {Math.floor(hud.pos.x)}, {Math.floor(hud.pos.y)},{" "}
              {Math.floor(hud.pos.z)} · seed {hud.seed}
            </p>
            <p
              className={`mt-0.5 font-mono tabular-nums text-subtle ${
                lsTouch ? "text-[9px]" : "text-[10px]"
              }`}
            >
              gen {hud.chunkGen.queued}q {hud.chunkGen.generating}run{" "}
              {hud.chunkGen.ready}rdy · mesh {hud.chunkGen.mesh} ·{" "}
              {hud.chunkGen.loaded} loaded
              {hud.chunkGen.workers > 0
                ? ` · ${hud.chunkGen.workers - hud.chunkGen.idleWorkers}/${hud.chunkGen.workers} wrk`
                : " · sync"}
              {hud.chunkGen.shared ? " · sab" : ""}
            </p>
          </div>
          <div
            className={`flex items-end gap-1.5 ${
              lsTouch ? "flex-row flex-wrap justify-end" : "flex-col gap-2"
            }`}
          >
            {hud.playing && (
              <div
                className={`rounded-xl border border-border bg-surface/85 text-right backdrop-blur-sm ${
                  lsTouch ? "px-2 py-1" : "px-3 py-2"
                }`}
              >
                {!lsTouch && (
                  <p className="text-xs text-muted">Selected</p>
                )}
                <p
                  className={`font-medium text-fg ${
                    lsTouch ? "text-xs" : "text-sm"
                  }`}
                >
                  {hud.selectedName || "—"}
                </p>
              </div>
            )}
            <div
              className={`rounded-xl border border-border bg-surface/85 text-right backdrop-blur-sm ${
                lsTouch ? "px-2 py-1" : "px-3 py-2"
              }`}
            >
              {!lsTouch && <p className="text-xs text-muted">Biome</p>}
              <p
                className={`font-medium text-fg ${
                  lsTouch ? "text-xs" : "text-sm"
                }`}
              >
                {lsTouch ? "" : null}
                {hud.biome}
              </p>
            </div>

            <div
              className={`w-[7.5rem] rounded-xl border border-border bg-surface/85 text-right backdrop-blur-sm ${
                lsTouch ? "px-2 py-1" : "px-2.5 py-1.5"
              }`}
            >
              {!lsTouch && <p className="text-[10px] text-muted">Weather</p>}
              <p
                className={`font-medium text-fg ${
                  lsTouch ? "text-xs" : "text-xs"
                }`}
              >
                {hud.snow
                  ? hud.rain > 0.55
                    ? "Blizzard"
                    : "Snow"
                  : (WEATHER_LABEL[hud.weather] ?? hud.weather)}
                {hud.rain > 0.15 ? (
                  <span className="font-mono text-[10px] text-subtle">
                    {" "}
                    {Math.round(hud.rain * 100)}%
                  </span>
                ) : null}
              </p>
              <p className="mt-0.5 font-mono text-[10px] tabular-nums text-subtle">
                {hud.isDay ? "Day" : "Night"}
                {" · "}
                {formatClock(hud.dayPhase)}
              </p>
              {!lsTouch && (
                <button
                  type="button"
                  onClick={onToggleDayNight}
                  className="pointer-events-auto mt-1.5 w-full rounded-md border border-border bg-bg/70 px-1.5 py-0.5 text-[9px] font-medium text-muted transition-colors hover:bg-bg hover:text-fg"
                  title="Or press F3 while playing (keeps mouse look)"
                >
                  {hud.isDay ? "Night" : "Day"} F3
                </button>
              )}
              {!lsTouch && (
                <button
                  type="button"
                  onClick={onToggleFreeCraft}
                  className={`pointer-events-auto mt-1 w-full rounded-md border px-1.5 py-0.5 text-[9px] font-medium transition-colors ${
                    hud.freeCraft
                      ? "border-accent bg-accent/20 text-fg"
                      : "border-border bg-bg/70 text-muted hover:bg-bg hover:text-fg"
                  }`}
                  title="Craft without ingredients (F4)"
                >
                  Craft {hud.freeCraft ? "ON" : "OFF"} F4
                </button>
              )}
              {!lsTouch && (
                <button
                  type="button"
                  onClick={onToggleDebug}
                  className={`pointer-events-auto mt-1 w-full rounded-md border px-1.5 py-0.5 text-[9px] font-medium transition-colors ${
                    hud.debugOpen
                      ? "border-accent bg-accent/20 text-fg"
                      : "border-border bg-bg/70 text-muted hover:bg-bg hover:text-fg"
                  }`}
                  title="Graphics and audio tuner (F7 or `)"
                >
                  Tune F7
                </button>
              )}
              {!lsTouch && (
                <button
                  type="button"
                  onClick={onNewWorld}
                  className={`pointer-events-auto mt-1 w-full rounded-md border px-1.5 py-0.5 text-[9px] font-medium transition-colors ${
                    confirmNew
                      ? "border-red-400/70 bg-red-500/20 text-fg"
                      : "border-border bg-bg/70 text-muted hover:bg-bg hover:text-fg"
                  }`}
                  title="Erase the save and generate a new seed"
                >
                  {confirmNew ? "Erase world?" : "New World"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {ready &&
        (hud.playing || hud.craftingOpen || hud.furnaceOpen || hud.chestOpen || hud.debugOpen) &&
        !(
          hud.isTouch &&
          (hud.craftingOpen || hud.furnaceOpen || hud.chestOpen)
        ) && (
        <div
          className={`pointer-events-none absolute bottom-0 left-0 right-0 z-40 flex flex-col items-center ${
            lsTouch
              ? "gap-1 px-2 py-1 pb-[max(0.35rem,env(safe-area-inset-bottom))]"
              : hud.isTouch
                ? "gap-1 px-2 pt-1 pb-[max(0.4rem,env(safe-area-inset-bottom))]"
                : "gap-3 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
          }`}
        >
          {/* Health + hunger */}
          <div
            className={`flex w-full max-w-md px-1 ${
              lsTouch
                ? "max-w-sm flex-row items-center gap-3"
                : "flex-col gap-1.5"
            }`}
          >
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <span
                className={`shrink-0 font-medium uppercase tracking-wide text-subtle ${
                  lsTouch ? "w-8 text-[9px]" : "w-12 text-[10px]"
                }`}
              >
                {lsTouch ? "HP" : "Health"}
              </span>
              <div className="flex flex-1 gap-0.5">
                {Array.from({ length: 10 }, (_, i) => {
                  const hp = hud.health / 2;
                  const fill = Math.max(0, Math.min(1, hp - i));
                  return (
                    <div
                      key={`h${i}`}
                      className={`flex-1 overflow-hidden rounded-sm bg-bg/80 ring-1 ring-border ${
                        lsTouch ? "h-2" : "h-2.5"
                      }`}
                    >
                      <div
                        className="h-full bg-rose-500 transition-[width] duration-150"
                        style={{ width: `${fill * 100}%` }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
            {hud.armor > 0 && (
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <span
                  className={`shrink-0 font-medium uppercase tracking-wide text-subtle ${
                    lsTouch ? "w-8 text-[9px]" : "w-12 text-[10px]"
                  }`}
                >
                  {lsTouch ? "Ar" : "Armor"}
                </span>
                <div className="flex flex-1 gap-0.5">
                  {Array.from({ length: 10 }, (_, i) => {
                    const fill = Math.max(0, Math.min(1, hud.armor - i));
                    return (
                      <div
                        key={`a${i}`}
                        className={`flex-1 overflow-hidden rounded-sm bg-bg/80 ring-1 ring-border ${
                          lsTouch ? "h-2" : "h-2.5"
                        }`}
                      >
                        <div
                          className="h-full bg-stone-400 transition-[width] duration-150"
                          style={{ width: `${fill * 100}%` }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <span
                className={`shrink-0 font-medium uppercase tracking-wide text-subtle ${
                  lsTouch ? "w-8 text-[9px]" : "w-12 text-[10px]"
                }`}
              >
                {lsTouch ? "Fd" : "Hunger"}
              </span>
              <div className="flex flex-1 gap-0.5">
                {Array.from({ length: 10 }, (_, i) => {
                  const hn = hud.hunger / 2;
                  const fill = Math.max(0, Math.min(1, hn - i));
                  return (
                    <div
                      key={`f${i}`}
                      className={`flex-1 overflow-hidden rounded-sm bg-bg/80 ring-1 ring-border ${
                        lsTouch ? "h-2" : "h-2.5"
                      }`}
                    >
                      <div
                        className="h-full bg-amber-500 transition-[width] duration-150"
                        style={{ width: `${fill * 100}%` }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
            {(hud.submerged || hud.air < hud.maxAir - 0.04) && (
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <span
                  className={`shrink-0 font-medium uppercase tracking-wide text-subtle ${
                    lsTouch ? "w-8 text-[9px]" : "w-12 text-[10px]"
                  }`}
                >
                  {lsTouch ? "O2" : "Air"}
                </span>
                <div className="flex flex-1 items-center gap-0.5">
                  {Array.from({ length: 10 }, (_, i) => {
                    const fill = Math.max(0, Math.min(1, hud.air * 2 - i));
                    const low = hud.air < 2;
                    return (
                      <div
                        key={`o${i}`}
                        className={`flex-1 aspect-square max-h-3 overflow-hidden rounded-full bg-bg/70 ring-1 ring-sky-300/30 ${
                          lsTouch ? "h-2" : "h-2.5"
                        } ${low && fill > 0 ? "animate-pulse" : ""}`}
                      >
                        <div
                          className="h-full rounded-full bg-sky-300"
                          style={{
                            width: `${fill * 100}%`,
                            opacity: 0.35 + fill * 0.65,
                            boxShadow:
                              fill > 0
                                ? "inset -2px -2px 0 rgba(255,255,255,0.45)"
                                : undefined,
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {hud.mineProgress > 0 && !lsTouch && (
              <div className="h-1 overflow-hidden rounded-full bg-bg/80 ring-1 ring-border">
                <div
                  className="h-full bg-accent transition-[width] duration-75"
                  style={{ width: `${Math.min(1, hud.mineProgress) * 100}%` }}
                />
              </div>
            )}
          </div>
          {hud.mineProgress > 0 && lsTouch && (
            <div className="h-1 w-full max-w-sm overflow-hidden rounded-full bg-bg/80 ring-1 ring-border">
              <div
                className="h-full bg-accent transition-[width] duration-75"
                style={{ width: `${Math.min(1, hud.mineProgress) * 100}%` }}
              />
            </div>
          )}

          <div
            className={`relative flex w-full max-w-[22.5rem] flex-nowrap items-center justify-center backdrop-blur-sm ${
              hud.isTouch
                ? "gap-0.5 rounded-xl border border-border bg-surface/90 p-1"
                : "max-w-md gap-1.5 rounded-2xl border border-border bg-surface/90 p-2"
            }`}
          >
            {selectFlash && (
              <div
                key={selectFlash.token}
                className="item-select-name pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap text-center"
              >
                <span
                  className={`font-semibold tracking-wide text-fg ${
                    lsTouch ? "text-[11px]" : "text-sm"
                  }`}
                  style={{
                    textShadow:
                      "0 1px 0 #000, 0 -1px 0 #000, 1px 0 0 #000, -1px 0 0 #000, 0 2px 6px rgba(0,0,0,0.55)",
                  }}
                >
                  {selectFlash.name}
                </span>
              </div>
            )}
            {Array.from({ length: 9 }, (_, i) => {
              const slot = hud.inventory[i];
              const id = slot?.id;
              const name = id != null ? itemName(id) : null;
              const active = hud.selectedSlot === i;
              const dur = slot?.durability;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    setPointer({ x: e.clientX, y: e.clientY });
                    onSelect(i, e.shiftKey);
                  }}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.stopPropagation();
                    setPointer({ x: e.clientX, y: e.clientY });
                  }}
                  className={`pointer-events-auto relative flex aspect-square min-w-0 items-center justify-center overflow-hidden rounded-lg border p-0.5 transition-colors duration-150 ${
                    hud.isTouch ? "h-8 flex-1 max-w-9" : "h-11 w-11"
                  } ${
                    active
                      ? "border-accent bg-elevated ring-1 ring-accent/40"
                      : "border-border bg-bg/60 hover:bg-elevated"
                  }`}
                  style={{ touchAction: "manipulation" }}
                  aria-label={name ?? `Empty ${i + 1}`}
                  title={name ? `${i + 1}: ${name}` : `${i + 1}: empty`}
                >
                  {id != null ? (
                    <ItemIcon
                      id={id}
                      atlasUrl={hud.atlasUrl}
                      blockIcons={hud.blockIcons}
                      className="h-full w-full"
                    />
                  ) : (
                    <span className="block h-full w-full rounded-sm bg-bg/40" />
                  )}
                  {!hud.isTouch && (
                    <span className="absolute bottom-0.5 left-1 font-mono text-[9px] text-subtle">
                      {i + 1}
                    </span>
                  )}
                  {slot && slot.count > 1 ? (
                    <span
                      className={`absolute font-mono font-semibold text-fg ${
                        hud.isTouch
                          ? "bottom-0 right-0.5 text-[8px]"
                          : "bottom-0.5 right-0.5 text-[10px]"
                      }`}
                    >
                      {slot.count}
                    </span>
                  ) : null}
                  {dur != null && slot ? (
                    <span
                      className="absolute left-1 right-1 top-0.5 h-0.5 overflow-hidden rounded-full bg-bg/80"
                      title={`Durability ${dur}`}
                    >
                      <span
                        className="block h-full bg-emerald-400"
                        style={{
                          width: `${Math.max(0, Math.min(1, dur / (ITEM_DEFS[slot.id]?.maxDurability ?? 140))) * 100}%`,
                        }}
                      />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          {!lsTouch && (
            <p className="pointer-events-none text-center text-[11px] text-subtle">
              {hud.tip}
              {" · "}
              <span className="text-muted">E inventory</span>
            </p>
          )}
        </div>
      )}

      {/* Inventory + crafting */}
      {ready && hud.craftingOpen && (
        <div className={`pointer-events-none absolute inset-0 z-[70] flex items-center justify-center p-3 sm:p-4 ${
          hud.isTouch ? "pb-[max(1rem,env(safe-area-inset-bottom))]" : "pb-36"
        }`}>
          <div className="pointer-events-auto flex max-h-[min(82vh,720px)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-surface/80 shadow-xl backdrop-blur-sm">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-fg">Inventory</h2>
                <p className="text-xs text-muted">
                  {hud.isTouch
                    ? "Tap a slot to pick up or place"
                    : hud.freeCraft
                    ? "Free craft ON — recipes ignore ingredients"
                    : "Click to move · Shift-click armor to wear"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onToggleFreeCraft}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                    hud.freeCraft
                      ? "border-accent bg-accent/20 text-fg"
                      : "border-border bg-elevated text-muted hover:bg-bg hover:text-fg"
                  }`}
                >
                  Free craft {hud.freeCraft ? "ON" : "OFF"}
                </button>
                <button
                  type="button"
                  onClick={onCloseCraft}
                  className="rounded-lg border border-border bg-elevated px-3 py-1.5 text-xs font-medium text-fg hover:bg-bg"
                >
                  Close (E)
                </button>
              </div>
            </div>
            <div className="space-y-3 overflow-y-auto p-3">
              <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-start">
                <ArmorDoll
                  slots={hud.armorSlots ?? [null, null, null, null]}
                  atlasUrl={hud.atlasUrl}
                  blockIcons={hud.blockIcons}
                  points={hud.armor}
                  onSlot={onArmor}
                  engineRef={engineRef}
                  active={hud.craftingOpen}
                />
                <div className="min-w-0 flex-1">
                  <InvGrid
                    slots={hud.inventory}
                    atlasUrl={hud.atlasUrl}
                    blockIcons={hud.blockIcons}
                    selected={hud.selectedSlot}
                    showHotbarNums
                    onSlot={onSelect}
                  />
                </div>
              </div>
              <div className="border-t border-border pt-2">
                <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-subtle">
                  Crafting
                </p>
                <div className="max-h-[min(32vh,280px)] space-y-2 overflow-y-auto">
                  {hud.recipes.map((r) => (
                    <div
                      key={r.id}
                      className={`flex items-center gap-3 rounded-xl border p-2.5 ${
                        r.canCraft
                          ? "border-accent/40 bg-elevated/80"
                          : "border-border bg-bg/40 opacity-80"
                      }`}
                    >
                      <ItemIcon
                        id={r.output.id}
                        atlasUrl={hud.atlasUrl}
                        blockIcons={hud.blockIcons}
                        className="h-9 w-9 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-fg">
                          {r.name}
                          {r.output.count > 1 ? (
                            <span className="text-subtle"> ×{r.output.count}</span>
                          ) : null}
                        </p>
                        <p className="truncate text-xs text-muted">
                          {r.inputs
                            .map((i) => `${i.count}× ${i.name}`)
                            .join(" + ")}
                          {r.hint ? ` · ${r.hint}` : ""}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={!r.canCraft}
                        onClick={() => onCraft(r.id)}
                        className="shrink-0 rounded-lg border border-border bg-accent/90 px-3 py-1.5 text-xs font-semibold text-bg disabled:cursor-not-allowed disabled:bg-bg disabled:text-subtle"
                      >
                        Craft
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {ready && hud.furnaceOpen && hud.furnace && (
        <div className={`pointer-events-none absolute inset-0 z-[70] flex items-center justify-center p-3 sm:p-4 ${
          hud.isTouch ? "pb-[max(1rem,env(safe-area-inset-bottom))]" : "pb-36"
        }`}>
          <div className="pointer-events-auto w-full max-w-md overflow-hidden rounded-2xl border border-border bg-surface shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-fg">Furnace</h2>
                <p className="text-xs text-muted">
                  Click to pick up · click a slot to place · Shift-click sends
                  ore/fuel to the furnace
                </p>
              </div>
              <button
                type="button"
                onClick={onCloseFurnace}
                className="rounded-lg border border-border bg-elevated px-3 py-1.5 text-xs font-medium text-fg hover:bg-bg"
              >
                Close (E)
              </button>
            </div>
            <div className="flex flex-col items-center gap-4 p-5">
              <div className="flex items-center gap-3">
                <FurnaceSlot
                  label="Ore"
                  slot={hud.furnace.input}
                  atlasUrl={hud.atlasUrl}
                  blockIcons={hud.blockIcons}
                  onClick={(shift) => onFurnaceSlot("input", shift)}
                />
                <div className="flex w-16 flex-col items-center gap-1">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg ring-1 ring-border">
                    <div
                      className="h-full bg-accent transition-[width] duration-150"
                      style={{
                        width: `${Math.max(0, Math.min(1, hud.furnace.cook)) * 100}%`,
                      }}
                    />
                  </div>
                  <span className="text-[10px] uppercase tracking-wide text-subtle">
                    smelt
                  </span>
                </div>
                <FurnaceSlot
                  label="Result"
                  slot={hud.furnace.output}
                  atlasUrl={hud.atlasUrl}
                  blockIcons={hud.blockIcons}
                  onClick={(shift) => onFurnaceSlot("output", shift)}
                />
              </div>
              <div className="flex items-center gap-3">
                <FurnaceSlot
                  label="Fuel"
                  slot={hud.furnace.fuel}
                  atlasUrl={hud.atlasUrl}
                  blockIcons={hud.blockIcons}
                  onClick={(shift) => onFurnaceSlot("fuel", shift)}
                />
                <div className="flex w-16 flex-col items-center gap-1">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg ring-1 ring-border">
                    <div
                      className="h-full bg-amber-500 transition-[width] duration-150"
                      style={{
                        width: `${Math.max(0, Math.min(1, hud.furnace.burn)) * 100}%`,
                      }}
                    />
                  </div>
                  <span className="text-[10px] uppercase tracking-wide text-subtle">
                    burn
                  </span>
                </div>
                <div className="w-11" />
              </div>
              <p className="text-center text-xs text-muted">
                Coal smelts 10 items. Shift-click result to take it.
              </p>
            </div>
          </div>
        </div>
      )}

      {ready && hud.chestOpen && hud.chest && (
        <div className={`pointer-events-none absolute inset-0 z-[70] flex items-center justify-center p-3 sm:p-4 ${
          hud.isTouch ? "pb-[max(1rem,env(safe-area-inset-bottom))]" : "pb-36"
        }`}>
          <div className="pointer-events-auto w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-surface/80 shadow-xl backdrop-blur-sm">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-fg">Chest</h2>
                <p className="text-xs text-muted">
                  Shift-click to dump into your pack
                </p>
              </div>
              <button
                type="button"
                onClick={onCloseChest}
                className="rounded-lg border border-border bg-elevated px-3 py-1.5 text-xs font-medium text-fg hover:bg-bg"
              >
                Close (E)
              </button>
            </div>
            <div className="space-y-3 p-3">
              <InvGrid
                slots={hud.chest}
                atlasUrl={hud.atlasUrl}
                blockIcons={hud.blockIcons}
                onSlot={onChestSlot}
              />
              <div className="border-t border-border pt-2">
                <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-subtle">
                  Your items
                </p>
                <InvGrid
                  slots={hud.inventory}
                  atlasUrl={hud.atlasUrl}
                  blockIcons={hud.blockIcons}
                  selected={hud.selectedSlot}
                  showHotbarNums
                  onSlot={onSelect}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {ready && hud.cursor && (
        <div
          className="pointer-events-none fixed z-[90]"
          style={{ left: pointer.x + 12, top: pointer.y + 12 }}
        >
          <div className="relative flex h-10 w-10 items-center justify-center rounded-md border border-border bg-surface/95 shadow-lg">
            <ItemIcon
              id={hud.cursor.id}
              atlasUrl={hud.atlasUrl}
              blockIcons={hud.blockIcons}
              className="h-8 w-8"
            />
            {hud.cursor.count > 1 ? (
              <span className="absolute -bottom-1 -right-1 font-mono text-[11px] font-semibold text-fg drop-shadow">
                {hud.cursor.count}
              </span>
            ) : null}
          </div>
        </div>
      )}

      {ready && hud.isTouch && hud.playing && !hud.craftingOpen && !hud.furnaceOpen && !hud.chestOpen && !hud.debugOpen && (
        <>
          <div
            ref={stickRef}
            className={
              lsTouch
                ? "absolute bottom-[max(0.45rem,env(safe-area-inset-bottom))] left-[max(0.4rem,env(safe-area-inset-left))] z-[55] h-[5.5rem] w-[5.5rem] rounded-full border border-border bg-surface/45 backdrop-blur-sm"
                : "absolute bottom-[10rem] left-3 z-[55] h-24 w-24 rounded-full border border-border bg-surface/50 backdrop-blur-sm"
            }
            onPointerDown={onStickDown}
            onPointerMove={onStickMove}
            onPointerUp={onStickUp}
            onPointerCancel={onStickUp}
          >
            <div
              data-knob
              className={
                lsTouch
                  ? "absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-border bg-elevated/90"
                  : "absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full border border-border bg-elevated/90"
              }
            />
          </div>
          <div
            className={
              lsTouch
                ? "absolute bottom-[max(0.45rem,env(safe-area-inset-bottom))] right-[max(0.4rem,env(safe-area-inset-right))] z-[55] flex flex-row items-end gap-1.5"
                : "absolute bottom-[10rem] right-3 z-[55] flex flex-col gap-2"
            }
          >
            {hud.isTouch && (
              <button
                type="button"
                className={
                  lsTouch
                    ? "h-11 w-11 rounded-full border border-border bg-surface/80 text-[10px] font-medium text-fg backdrop-blur-sm active:scale-95"
                    : "h-14 w-14 rounded-full border border-border bg-surface/80 text-xs font-medium text-fg backdrop-blur-sm active:scale-95"
                }
                style={{ touchAction: "manipulation" }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  engineRef.current?.setCraftingOpen(true);
                }}
              >
                Inv
              </button>
            )}
            <button
              type="button"
              className={
                lsTouch
                  ? "h-11 w-11 rounded-full border border-border bg-surface/80 text-[10px] font-medium text-fg backdrop-blur-sm active:scale-95"
                  : "h-14 w-14 rounded-full border border-border bg-surface/80 text-xs font-medium text-fg backdrop-blur-sm active:scale-95"
              }
              onPointerDown={(e) => {
                e.preventDefault();
                engineRef.current?.touchJump();
              }}
            >
              Jump
            </button>
            <button
              type="button"
              className={
                lsTouch
                  ? "h-12 w-12 rounded-full border border-accent/50 bg-accent/25 text-[10px] font-semibold text-fg backdrop-blur-sm active:scale-95"
                  : "h-14 w-14 rounded-full border border-border bg-surface/80 text-xs font-medium text-fg backdrop-blur-sm active:scale-95"
              }
              onPointerDown={(e) => {
                e.preventDefault();
                engineRef.current?.touchBreak();
              }}
            >
              Break
            </button>
            <button
              type="button"
              className={
                lsTouch
                  ? "h-11 w-11 rounded-full border border-border bg-surface/80 text-[10px] font-medium text-fg backdrop-blur-sm active:scale-95"
                  : "h-14 w-14 rounded-full border border-border bg-surface/80 text-xs font-medium text-fg backdrop-blur-sm active:scale-95"
              }
              onPointerDown={(e) => {
                e.preventDefault();
                engineRef.current?.touchPlace();
              }}
            >
              Place
            </button>
          </div>
        </>
      )}

      
      {ready && hud.debugOpen && (
        <DebugPanel
          settings={hud.debug}
          onPatch={onPatchDebug}
          onClose={onToggleDebug}
        />
      )}

      {ready && hud.dead && (
        <div className="absolute inset-0 z-[80] flex items-center justify-center bg-bg/70 p-6 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-3xl border border-border bg-surface p-8 text-center shadow-2xl">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-rose-400">
              You died
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-fg">Game over</h2>
            <p className="mt-3 text-sm text-muted">
              Your items are at your corpse. Hunger resets to half.
            </p>
            <button
              type="button"
              onClick={() => engineRef.current?.respawn()}
              className="mt-6 w-full rounded-xl bg-accent px-4 py-3.5 text-sm font-semibold text-accent-fg transition-transform hover:brightness-105 active:scale-[0.98]"
            >
              Respawn
            </button>
          </div>
        </div>
      )}

      {ready && !hud.playing && !hud.craftingOpen && !hud.furnaceOpen && !hud.chestOpen && !hud.debugOpen && !hud.dead && (
        <div className="absolute inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-bg/55 p-4 backdrop-blur-[2px] sm:p-6">
          <div className="my-auto w-full max-w-md rounded-3xl border border-border bg-surface p-6 shadow-2xl shadow-black/40 sm:p-8">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-subtle">
              Survival mode
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-fg">Blockworld</h1>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              Gather resources, craft tools, and survive the night. Hostiles
              hunt after dark — rare slender stalkers included — while storms
              and biomes keep the world alive.
            </p>
            <ul className="mt-5 space-y-2 text-sm text-muted">
              <li className="flex gap-2">
                <span className="w-28 shrink-0 font-mono text-xs text-subtle">WASD</span>
                <span>Move · Shift sprint · Space jump</span>
              </li>
              <li className="flex gap-2">
                <span className="w-28 shrink-0 font-mono text-xs text-subtle">Mine / Build</span>
                <span>Hold LMB mine/attack · RMB place · E craft</span>
              </li>
              <li className="flex gap-2">
                <span className="w-28 shrink-0 font-mono text-xs text-subtle">Survive</span>
                <span>Night hostiles · sleep in a bed · loot ruin chests</span>
              </li>
              <li className="flex gap-2">
                <span className="w-28 shrink-0 font-mono text-xs text-subtle">1–9</span>
                <span>Hotbar slots · stacks from gathered blocks</span>
              </li>
            </ul>
            <button
              type="button"
              onClick={onPlay}
              className="mt-7 w-full rounded-xl bg-accent px-4 py-3.5 text-sm font-semibold text-accent-fg transition-transform duration-150 hover:brightness-105 active:scale-[0.98]"
            >
              {hud.isTouch ? "Tap to play" : "Click to play"}
            </button>
            <button
              type="button"
              onClick={onNewWorld}
              className={`mt-2 w-full rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors ${
                confirmNew
                  ? "border-red-400/60 bg-red-500/15 text-fg hover:bg-red-500/25"
                  : "border-border bg-bg/40 text-muted hover:bg-bg/70 hover:text-fg"
              }`}
            >
              {confirmNew ? "Really erase this world?" : "New World"}
            </button>
          </div>
        </div>
      )}

      {!bootGone && (
        <div
          className={`absolute inset-0 z-[90] flex items-center justify-center bg-bg/92 transition-opacity duration-500 ${
            bootFade ? "opacity-0 pointer-events-none" : "opacity-100"
          }`}
        >
          <div className="relative flex w-[min(92vw,22rem)] flex-col items-center px-6 text-center">
            <div className="relative mb-8 h-28 w-28">
              <div className="boot-pulse-ring absolute inset-0 rounded-full border border-fg/25" />
              <div className="boot-pulse-ring absolute inset-3 rounded-full border border-fg/20 [animation-delay:-0.8s]" />
              <div className="boot-pulse-core absolute inset-[2.15rem] rounded-full bg-fg/80" />
            </div>
            <p className="boot-title text-[11px] font-medium uppercase text-subtle">
              Blockworld
            </p>
            <p className="mt-3 font-mono text-xs tabular-nums text-muted">
              {hud.seed ? `seed ${hud.seed}` : "seeding…"}
            </p>
            <p className="mt-2 min-h-[1.5rem] text-lg font-medium tracking-wide text-fg">
              {hud.biome && ready ? hud.biome : "Reading the land…"}
            </p>
            <div className="mt-6 h-[2px] w-full overflow-hidden rounded-full bg-border">
              <div
                className="h-full bg-fg/80 transition-[width] duration-300 ease-out"
                style={{
                  width: `${Math.round(Math.min(1, ready ? Math.max(0.08, hud.load.progress) : 0.04) * 100)}%`,
                }}
              />
            </div>
            <p className="mt-2 font-mono text-[10px] tabular-nums text-subtle">
              {ready
                ? `${hud.load.have} / ${hud.load.need} chunks`
                : "waking workers"}
            </p>
          </div>
        </div>
      )}

      {!ready && bootGone && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-bg">
          <p className="text-sm text-muted">Generating world…</p>
        </div>
      )}
    </div>
  );
}

export function MinecraftApp() {
  return (
    <ClientOnly
      fallback={
        <div className="flex h-dvh items-center justify-center bg-bg text-muted">Loading…</div>
      }
    >
      <GameShell />
    </ClientOnly>
  );
}
