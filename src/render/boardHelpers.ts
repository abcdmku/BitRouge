import type { ComponentKind } from "../game/types";

/**
 * Pure, Phaser-free render helpers. Kept decoupled from the exact snapshot
 * shape (structural types only, plus the stable `ComponentKind` literal
 * union) so they are cheap to unit test and do not churn with the sim.
 */

/** Minimal socket facts BoardScene needs to resolve a tap (spec §2, five tap types). */
export interface TapSocket {
  index: number;
  unlocked: boolean;
  /** true when a plain tap resolves to WORK: holds a packet, is a ready core, or is faulted. */
  lit: boolean;
  /** true when the socket already has a placed component. */
  hasComponent: boolean;
}

export type TapResult =
  | { type: "placeComponent"; index: number; kind: ComponentKind }
  | { type: "unlockSocket"; index: number }
  | { type: "workSocket"; index: number }
  | { type: "rotateSocket"; index: number }
  | null;

/**
 * Resolves one tap on a socket cell to the sim command it should emit, per
 * spec §2: place-mode intercepts every tap; else locked -> unlock; lit -> work;
 * empty unlocked -> rotate; an idle occupied socket has no plain-tap action
 * (only long-press opens its popover).
 */
export function resolveTap(socket: TapSocket, placeMode: ComponentKind | null): TapResult {
  if (placeMode) return { type: "placeComponent", index: socket.index, kind: placeMode };
  if (!socket.unlocked) return { type: "unlockSocket", index: socket.index };
  if (socket.lit) return { type: "workSocket", index: socket.index };
  if (!socket.hasComponent) return { type: "rotateSocket", index: socket.index };
  return null;
}

/** A socket is "lit" (spec §2) when it holds a packet, is a core ready to pull a backlog task, or is faulted. */
export function isLit(opts: { hasPacket: boolean; readyCore: boolean; faulted: boolean }): boolean {
  return opts.hasPacket || opts.readyCore || opts.faulted;
}

const HEAT_OVERLAY_FLOOR = 30;
const HEAT_OVERLAY_MAX_ALPHA = 0.65;

/**
 * Soft red per-socket heat overlay alpha (spec §2). Zero below the floor so
 * a cold board reads clean; ramps linearly to `HEAT_OVERLAY_MAX_ALPHA` at 100.
 */
export function heatOverlayAlpha(heat: number): number {
  const clamped = Math.max(0, Math.min(100, heat));
  if (clamped <= HEAT_OVERLAY_FLOOR) return 0;
  return ((clamped - HEAT_OVERLAY_FLOOR) / (100 - HEAT_OVERLAY_FLOOR)) * HEAT_OVERLAY_MAX_ALPHA;
}

/** >= 70 heat throttles a socket to half rate with a shimmer overlay (spec §3). */
export function isThrottled(heat: number): boolean {
  return heat >= 70;
}

/** Board-wide brownout flicker alpha: a slow triangle wave while duty < 1, silent at full duty. */
export function brownoutAlpha(duty: number, timeMs: number): number {
  if (duty >= 1) return 0;
  const period = 900;
  const phase = ((timeMs % period) / period) * 2;
  const triangle = phase <= 1 ? phase : 2 - phase;
  return 0.08 + 0.1 * triangle * (1 - duty);
}

/**
 * True when any socket is actually drawing power (a powered, unfaulted
 * component). Brownout visuals must be gated on this too, defensively: a
 * fresh board can read `duty < 1` transiently even at zero draw, and the
 * renderer should never flicker over an idle board regardless of what the
 * sim reports.
 */
export function hasPowerDraw(sockets: readonly { component: { powered: boolean; faulted: boolean } | null }[]): boolean {
  return sockets.some((s) => s.component !== null && s.component.powered && !s.component.faulted);
}

/** Brownout visuals (wash, flicker, badge) should show only under real load. */
export function isBrownoutActive(
  duty: number,
  sockets: readonly { component: { powered: boolean; faulted: boolean } | null }[],
): boolean {
  return duty < 1 && hasPowerDraw(sockets);
}
