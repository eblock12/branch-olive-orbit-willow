import { useCallback, useEffect, useRef, useState } from "react";
import { ClientOnly } from "@tanstack/react-router";
import { BLOCKS, isPlant } from "../game/blocks";
import type { GameEngine, HudSnapshot } from "../game/engine";
import {
  isBlockItem,
  itemColor,
  itemIconDataUrl,
  itemName,
  type ItemId,
} from "../game/items";

const DEFAULT_HUD: HudSnapshot = {
  playing: false,
  fps: 0,
  selected: 1,
  selectedName: "Dirt",
  placeable: [],
  pos: { x: 0, y: 0, z: 0 },
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
  dayPhase: 0.2,
  isDay: true,
  biome: "Plains",
  health: 20,
  maxHealth: 20,
  hunger: 20,
  maxHunger: 20,
  inventory: Array.from({ length: 9 }, () => null),
  selectedSlot: 0,
  mineProgress: 0,
  dead: false,
  atlasUrl: "",
  blockIcons: {},
  craftingOpen: false,
  recipes: [],
  tip: "Press E to craft",
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
  if (isBlockItem(id)) {
    const def = BLOCKS[id];
    if (!def) {
      return <span className={`${className} rounded-sm bg-bg/40`} />;
    }
    const iso = blockIcons[id];
    if (iso) {
      return (
        <span
          className={`${className} rounded-sm`}
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
    // Fallback color chip
    return (
      <span
        className={`${className} rounded-sm shadow-inner`}
        style={{ background: def.color }}
        title={name}
      />
    );
  }
  const url = itemIconDataUrl(id);
  if (url) {
    return (
      <span
        className={`${className} rounded-sm bg-bg/40`}
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
      className={`${className} rounded-sm shadow-inner`}
      style={{ background: itemColor(id) }}
      title={name}
    />
  );
}


const WEATHER_LABEL: Record<string, string> = {
  clear: "Clear",
  overcast: "Overcast",
  rain: "Rain",
  storm: "Storm",
};

/** phase 0 = 06:00, 0.25 = 12:00, 0.5 = 18:00, 0.75 = 00:00 */
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
  /** Short landscape + touch only — phones held sideways; not tablets/desktop. */
  const [phoneLandscape, setPhoneLandscape] = useState(false);
  const stickRef = useRef<HTMLDivElement>(null);
  const stickActive = useRef(false);

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
  }, []);

  const onPlay = useCallback(() => {
    engineRef.current?.requestPlay();
  }, []);

  const onSelect = useCallback((i: number) => {
    engineRef.current?.selectHotbar(i);
  }, []);

  const onCraft = useCallback((recipeId: string) => {
    engineRef.current?.craftRecipe(recipeId);
  }, []);

  const onCloseCraft = useCallback(() => {
    engineRef.current?.setCraftingOpen(false);
  }, []);

  const onToggleDayNight = useCallback(() => {
    engineRef.current?.toggleDayNightDebug();
  }, []);


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
              {Math.floor(hud.pos.z)}
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
              className={`rounded-xl border border-border bg-surface/85 text-right backdrop-blur-sm ${
                lsTouch ? "px-2 py-1" : "px-3 py-2"
              }`}
            >
              {!lsTouch && <p className="text-xs text-muted">Weather</p>}
              <p
                className={`font-medium text-fg ${
                  lsTouch ? "text-xs" : "text-sm"
                }`}
              >
                {WEATHER_LABEL[hud.weather] ?? hud.weather}
                {hud.rain > 0.15 ? (
                  <span className="font-mono text-[10px] text-subtle">
                    {" "}
                    · {Math.round(hud.rain * 100)}%
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
                  className="pointer-events-auto mt-2 w-full rounded-lg border border-border bg-bg/70 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted transition-colors hover:bg-bg hover:text-fg"
                  title="Or press F3 while playing (keeps mouse look)"
                >
                  Debug: {hud.isDay ? "→ Night" : "→ Day"} · F3
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {ready && (
        <div
          className={`absolute bottom-0 left-0 right-0 z-20 flex flex-col items-center ${
            lsTouch
              ? "gap-1 px-2 py-1 pb-[max(0.35rem,env(safe-area-inset-bottom))] pl-[max(6.75rem,env(safe-area-inset-left))] pr-[max(6.75rem,env(safe-area-inset-right))]"
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
            className={`flex flex-wrap items-center justify-center backdrop-blur-sm ${
              lsTouch
                ? "gap-1 rounded-xl border border-border bg-surface/90 p-1"
                : "gap-1.5 rounded-2xl border border-border bg-surface/90 p-2"
            }`}
          >
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
                  onClick={() => onSelect(i)}
                  className={`relative flex items-center justify-center rounded-lg border transition-colors duration-150 ${
                    lsTouch ? "h-9 w-9" : "h-11 w-11"
                  } ${
                    active
                      ? "border-accent bg-elevated ring-1 ring-accent/40"
                      : "border-border bg-bg/60 hover:bg-elevated"
                  }`}
                  aria-label={name ?? `Empty ${i + 1}`}
                  title={name ? `${i + 1}: ${name}` : `${i + 1}: empty`}
                >
                  {id != null ? (
                    <ItemIcon
                      id={id}
                      atlasUrl={hud.atlasUrl}
                      blockIcons={hud.blockIcons}
                      className={lsTouch ? "h-6 w-6" : "h-7 w-7"}
                    />
                  ) : (
                    <span
                      className={`rounded-sm bg-bg/40 ${
                        lsTouch ? "h-6 w-6" : "h-7 w-7"
                      }`}
                    />
                  )}
                  {!lsTouch && (
                    <span className="absolute bottom-0.5 left-1 font-mono text-[9px] text-subtle">
                      {i + 1}
                    </span>
                  )}
                  {slot && slot.count > 1 ? (
                    <span
                      className={`absolute font-mono font-semibold text-fg ${
                        lsTouch
                          ? "bottom-0 right-0.5 text-[9px]"
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
                          width: `${Math.max(0, Math.min(1, dur / 140)) * 100}%`,
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
              <span className="text-muted">E craft</span>
            </p>
          )}
        </div>
      )}

      {/* Crafting panel */}
      {ready && hud.craftingOpen && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-bg/70 p-4 backdrop-blur-sm">
          <div className="max-h-[min(90vh,640px)] w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-surface shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-fg">Crafting</h2>
                <p className="text-xs text-muted">
                  Wood → planks → sticks → tools → mine stone
                </p>
              </div>
              <button
                type="button"
                onClick={onCloseCraft}
                className="rounded-lg border border-border bg-elevated px-3 py-1.5 text-xs font-medium text-fg hover:bg-bg"
              >
                Close (E)
              </button>
            </div>
            <div className="max-h-[min(70vh,520px)] space-y-2 overflow-y-auto p-3">
              {hud.recipes.map((r) => (
                <div
                  key={r.id}
                  className={`flex items-center gap-3 rounded-xl border p-3 ${
                    r.canCraft
                      ? "border-accent/40 bg-elevated/80"
                      : "border-border bg-bg/40 opacity-80"
                  }`}
                >
                  <ItemIcon
                    id={r.output.id}
                    atlasUrl={hud.atlasUrl}
                    blockIcons={hud.blockIcons}
                    className="h-10 w-10 shrink-0"
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
      )}

      {ready && hud.isTouch && hud.playing && (
        <>
          <div
            ref={stickRef}
            className={
              lsTouch
                ? "absolute bottom-[max(0.4rem,env(safe-area-inset-bottom))] left-[max(0.4rem,env(safe-area-inset-left))] z-30 h-[5.5rem] w-[5.5rem] rounded-full border border-border bg-surface/45 backdrop-blur-sm"
                : "absolute bottom-28 left-6 z-30 h-28 w-28 rounded-full border border-border bg-surface/50 backdrop-blur-sm"
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
                ? "absolute bottom-[max(0.4rem,env(safe-area-inset-bottom))] right-[max(0.4rem,env(safe-area-inset-right))] z-30 flex flex-row items-end gap-1.5"
                : "absolute bottom-28 right-4 z-30 flex flex-col gap-2"
            }
          >
            {lsTouch && (
              <button
                type="button"
                className="h-11 w-11 rounded-full border border-border bg-surface/80 text-[10px] font-medium text-fg backdrop-blur-sm active:scale-95"
                onPointerDown={(e) => {
                  e.preventDefault();
                  engineRef.current?.setCraftingOpen(true);
                }}
              >
                Craft
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

      
      {ready && hud.dead && (
        <div className="absolute inset-0 z-45 flex items-center justify-center bg-bg/70 p-6 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-3xl border border-border bg-surface p-8 text-center shadow-2xl">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-rose-400">
              You died
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-fg">Game over</h2>
            <p className="mt-3 text-sm text-muted">
              You keep your items. Hunger resets to half.
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

      {ready && !hud.playing && !hud.craftingOpen && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-bg/55 p-6 backdrop-blur-[2px]">
          <div className="w-full max-w-md rounded-3xl border border-border bg-surface p-8 shadow-2xl shadow-black/40">
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
                <span>Night hostiles, fall damage, drowning · hide till dawn</span>
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
          </div>
        </div>
      )}

      {!ready && (
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
