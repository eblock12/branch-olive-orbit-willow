import { useCallback, useEffect, useRef, useState } from "react";
import { ClientOnly } from "@tanstack/react-router";
import { BLOCKS, type BlockId } from "../game/blocks";
import type { GameEngine, HudSnapshot } from "../game/engine";

const DEFAULT_HUD: HudSnapshot = {
  playing: false,
  fps: 0,
  selected: 1 as BlockId,
  placeable: [],
  pos: { x: 0, y: 0, z: 0 },
  target: null,
  isTouch: false,
  caterpillars: 0,
  banished: 0,
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
};


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
  const stickRef = useRef<HTMLDivElement>(null);
  const stickActive = useRef(false);

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
    if (knob) {
      knob.style.transform = `translate(calc(-50% + ${dx * 28}px), calc(-50% + ${dy * 28}px))`;
    }
  };

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
        <div className="pointer-events-none absolute left-0 right-0 top-0 z-20 flex items-start justify-between gap-3 p-4 pt-[max(1rem,env(safe-area-inset-top))]">
          <div className="rounded-xl border border-border bg-surface/85 px-3 py-2 backdrop-blur-sm">
            <p className="text-xs font-medium tracking-wide text-muted">Blockworld</p>
            <p className="mt-0.5 font-mono text-xs tabular-nums text-subtle">
              {hud.fps > 0 ? `${hud.fps} fps` : "—"} ·{" "}
              {Math.floor(hud.pos.x)}, {Math.floor(hud.pos.y)}, {Math.floor(hud.pos.z)}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            {hud.playing && (
              <div className="rounded-xl border border-border bg-surface/85 px-3 py-2 text-right backdrop-blur-sm">
                <p className="text-xs text-muted">Selected</p>
                <p className="text-sm font-medium text-fg">
                  {BLOCKS[hud.selected]?.name ?? "—"}
                </p>
              </div>
            )}
            <div className="rounded-xl border border-border bg-surface/85 px-3 py-2 text-right backdrop-blur-sm">
              <p className="text-xs text-muted">Biome</p>
              <p className="text-sm font-medium text-fg">{hud.biome}</p>
            </div>

            <div className="rounded-xl border border-border bg-surface/85 px-3 py-2 text-right backdrop-blur-sm">
              <p className="text-xs text-muted">Weather</p>
              <p className="text-sm font-medium text-fg">
                {WEATHER_LABEL[hud.weather] ?? hud.weather}
                {hud.rain > 0.15 ? (
                  <span className="font-mono text-xs text-subtle">
                    {" "}
                    · {Math.round(hud.rain * 100)}% rain
                  </span>
                ) : null}
              </p>
              <p className="mt-1 font-mono text-xs tabular-nums text-subtle">
                {hud.isDay ? "Day" : "Night"}
                {" · "}
                {formatClock(hud.dayPhase)}
              </p>
            </div>

            <div className="rounded-xl border border-border bg-surface/85 px-3 py-2 text-right backdrop-blur-sm">
              <p className="text-xs text-muted">Naughty caterpillars</p>
              <p className="font-mono text-sm tabular-nums text-fg">
                {hud.caterpillars} about
                {hud.banished > 0 ? (
                  <span className="text-subtle"> · {hud.banished} banished</span>
                ) : null}
              </p>
            </div>
          </div>
        </div>
      )}

      {ready && (
        <div className="absolute bottom-0 left-0 right-0 z-20 flex flex-col items-center gap-3 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {/* Health + hunger */}
          <div className="flex w-full max-w-md flex-col gap-1.5 px-1">
            <div className="flex items-center gap-1.5">
              <span className="w-12 shrink-0 text-[10px] font-medium uppercase tracking-wide text-subtle">
                Health
              </span>
              <div className="flex flex-1 gap-0.5">
                {Array.from({ length: 10 }, (_, i) => {
                  const hp = hud.health / 2;
                  const fill = Math.max(0, Math.min(1, hp - i));
                  return (
                    <div
                      key={`h${i}`}
                      className="h-2.5 flex-1 overflow-hidden rounded-sm bg-bg/80 ring-1 ring-border"
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
            <div className="flex items-center gap-1.5">
              <span className="w-12 shrink-0 text-[10px] font-medium uppercase tracking-wide text-subtle">
                Hunger
              </span>
              <div className="flex flex-1 gap-0.5">
                {Array.from({ length: 10 }, (_, i) => {
                  const hn = hud.hunger / 2;
                  const fill = Math.max(0, Math.min(1, hn - i));
                  return (
                    <div
                      key={`f${i}`}
                      className="h-2.5 flex-1 overflow-hidden rounded-sm bg-bg/80 ring-1 ring-border"
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
            {hud.mineProgress > 0 && (
              <div className="h-1 overflow-hidden rounded-full bg-bg/80 ring-1 ring-border">
                <div
                  className="h-full bg-accent transition-[width] duration-75"
                  style={{ width: `${Math.min(1, hud.mineProgress) * 100}%` }}
                />
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-1.5 rounded-2xl border border-border bg-surface/90 p-2 backdrop-blur-sm">
            {Array.from({ length: 9 }, (_, i) => {
              const slot = hud.inventory[i];
              const id = slot?.id;
              const def = id != null ? BLOCKS[id] : null;
              const active = hud.selectedSlot === i;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => onSelect(i)}
                  className={`relative flex h-11 w-11 items-center justify-center rounded-lg border transition-colors duration-150 ${
                    active
                      ? "border-accent bg-elevated ring-1 ring-accent/40"
                      : "border-border bg-bg/60 hover:bg-elevated"
                  }`}
                  aria-label={def?.name ?? `Empty ${i + 1}`}
                  title={def ? `${i + 1}: ${def.name}` : `${i + 1}: empty`}
                >
                  {def ? (
                    <span
                      className="h-6 w-6 rounded-sm shadow-inner"
                      style={{ background: def.color }}
                    />
                  ) : (
                    <span className="h-6 w-6 rounded-sm bg-bg/40" />
                  )}
                  <span className="absolute bottom-0.5 left-1 font-mono text-[9px] text-subtle">
                    {i + 1}
                  </span>
                  {slot && slot.count > 0 ? (
                    <span className="absolute bottom-0.5 right-0.5 font-mono text-[10px] font-semibold text-fg">
                      {slot.count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {ready && hud.isTouch && hud.playing && (
        <>
          <div
            ref={stickRef}
            className="absolute bottom-28 left-6 z-30 h-28 w-28 rounded-full border border-border bg-surface/50 backdrop-blur-sm"
            onPointerDown={onStickDown}
            onPointerMove={onStickMove}
            onPointerUp={onStickUp}
            onPointerCancel={onStickUp}
          >
            <div
              data-knob
              className="absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full border border-border bg-elevated/90"
            />
          </div>
          <div className="absolute bottom-28 right-4 z-30 flex flex-col gap-2">
            <button
              type="button"
              className="h-14 w-14 rounded-full border border-border bg-surface/80 text-xs font-medium text-fg backdrop-blur-sm active:scale-95"
              onPointerDown={(e) => {
                e.preventDefault();
                engineRef.current?.touchJump();
              }}
            >
              Jump
            </button>
            <button
              type="button"
              className="h-14 w-14 rounded-full border border-border bg-surface/80 text-xs font-medium text-fg backdrop-blur-sm active:scale-95"
              onPointerDown={(e) => {
                e.preventDefault();
                engineRef.current?.touchBreak();
              }}
            >
              Break
            </button>
            <button
              type="button"
              className="h-14 w-14 rounded-full border border-border bg-surface/80 text-xs font-medium text-fg backdrop-blur-sm active:scale-95"
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

      {ready && !hud.playing && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-bg/55 p-6 backdrop-blur-[2px]">
          <div className="w-full max-w-md rounded-3xl border border-border bg-surface p-8 shadow-2xl shadow-black/40">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-subtle">
              Survival mode
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-fg">Blockworld</h1>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              Gather resources, manage health and hunger, and survive storms,
              falls, and naughty caterpillars across living biomes.
            </p>
            <ul className="mt-5 space-y-2 text-sm text-muted">
              <li className="flex gap-2">
                <span className="w-28 shrink-0 font-mono text-xs text-subtle">WASD</span>
                <span>Move · Shift sprint · Space jump</span>
              </li>
              <li className="flex gap-2">
                <span className="w-28 shrink-0 font-mono text-xs text-subtle">Mine / Build</span>
                <span>Hold LMB to mine · RMB place from hotbar</span>
              </li>
              <li className="flex gap-2">
                <span className="w-28 shrink-0 font-mono text-xs text-subtle">Survive</span>
                <span>Fall damage, drowning, hunger, cactus & caterpillars</span>
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
