import { describe, expect, it } from "vitest";
import type { ComponentKind } from "../game/types";
import { brownoutAlpha, hasPowerDraw, heatOverlayAlpha, isBrownoutActive, isLit, isThrottled, resolveTap, type TapSocket } from "./boardHelpers";

const socket = (over: Partial<TapSocket> = {}): TapSocket => ({
  index: 0,
  unlocked: true,
  lit: false,
  hasComponent: false,
  ...over,
});

describe("resolveTap", () => {
  it("place-mode intercepts every tap, locked or not", () => {
    expect(resolveTap(socket({ unlocked: false }), "core")).toEqual({ type: "placeComponent", index: 0, kind: "core" });
    expect(resolveTap(socket({ unlocked: true, hasComponent: true }), "gpu")).toEqual({
      type: "placeComponent",
      index: 0,
      kind: "gpu",
    } as const);
  });

  it("locked socket unlocks", () => {
    expect(resolveTap(socket({ unlocked: false }), null)).toEqual({ type: "unlockSocket", index: 0 });
  });

  it("lit socket (packet / ready core / fault) works", () => {
    expect(resolveTap(socket({ lit: true }), null)).toEqual({ type: "workSocket", index: 0 });
    expect(resolveTap(socket({ lit: true, hasComponent: true }), null)).toEqual({ type: "workSocket", index: 0 });
  });

  it("empty unlocked socket rotates", () => {
    expect(resolveTap(socket(), null)).toEqual({ type: "rotateSocket", index: 0 });
  });

  it("idle occupied socket has no plain-tap action", () => {
    expect(resolveTap(socket({ hasComponent: true }), null)).toBeNull();
  });

  it("full tap resolution table", () => {
    const table: [Partial<TapSocket>, ComponentKind | null, string | null][] = [
      [{ unlocked: false }, null, "unlockSocket"],
      [{ unlocked: true, lit: true, hasComponent: true }, null, "workSocket"],
      [{ unlocked: true, lit: false, hasComponent: false }, null, "rotateSocket"],
      [{ unlocked: true, lit: false, hasComponent: true }, null, null],
      [{ unlocked: true }, "cache", "placeComponent"],
    ];
    for (const [over, placeMode, expected] of table) {
      const result = resolveTap(socket(over), placeMode);
      expect(result?.type ?? null).toBe(expected);
    }
  });
});

describe("isLit", () => {
  it("true when holding a packet, a ready core, or faulted; false when idle", () => {
    expect(isLit({ hasPacket: true, readyCore: false, faulted: false })).toBe(true);
    expect(isLit({ hasPacket: false, readyCore: true, faulted: false })).toBe(true);
    expect(isLit({ hasPacket: false, readyCore: false, faulted: true })).toBe(true);
    expect(isLit({ hasPacket: false, readyCore: false, faulted: false })).toBe(false);
  });
});

describe("heatOverlayAlpha", () => {
  it("is zero at and below the floor", () => {
    expect(heatOverlayAlpha(0)).toBe(0);
    expect(heatOverlayAlpha(30)).toBe(0);
  });

  it("ramps linearly to the max at 100 heat", () => {
    expect(heatOverlayAlpha(100)).toBeCloseTo(0.65, 5);
    expect(heatOverlayAlpha(65)).toBeCloseTo(0.325, 5);
  });

  it("clamps out-of-range input", () => {
    expect(heatOverlayAlpha(-10)).toBe(0);
    expect(heatOverlayAlpha(500)).toBeCloseTo(0.65, 5);
  });

  it("is monotonic non-decreasing", () => {
    let prev = -1;
    for (let h = 0; h <= 100; h += 5) {
      const a = heatOverlayAlpha(h);
      expect(a).toBeGreaterThanOrEqual(prev);
      prev = a;
    }
  });
});

describe("isThrottled", () => {
  it("throttles at and above 70 heat", () => {
    expect(isThrottled(69)).toBe(false);
    expect(isThrottled(70)).toBe(true);
    expect(isThrottled(100)).toBe(true);
  });
});

describe("brownoutAlpha", () => {
  it("is silent at full duty", () => {
    expect(brownoutAlpha(1, 0)).toBe(0);
    expect(brownoutAlpha(1.5, 400)).toBe(0);
  });

  it("flickers within a bounded range while duty < 1", () => {
    for (let t = 0; t < 2000; t += 37) {
      const a = brownoutAlpha(0.4, t);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(0.3);
    }
  });
});

describe("hasPowerDraw / isBrownoutActive", () => {
  const idle = { component: null };
  const poweredUnfaulted = { component: { powered: true, faulted: false } };
  const poweredFaulted = { component: { powered: true, faulted: true } };
  const unpowered = { component: { powered: false, faulted: false } };

  it("is false on an empty or all-unpowered/faulted board (e.g. fresh boot)", () => {
    expect(hasPowerDraw([idle, idle])).toBe(false);
    expect(hasPowerDraw([unpowered, poweredFaulted])).toBe(false);
  });

  it("is true once any socket actually draws", () => {
    expect(hasPowerDraw([idle, poweredUnfaulted])).toBe(true);
  });

  it("brownout visuals require both duty < 1 and real draw, regardless of what duty reports", () => {
    expect(isBrownoutActive(1, [poweredUnfaulted])).toBe(false); // full duty: never
    expect(isBrownoutActive(0.5, [idle])).toBe(false); // no draw: renderer stays quiet even if duty < 1
    expect(isBrownoutActive(0.5, [poweredUnfaulted])).toBe(true);
  });
});
