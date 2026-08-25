import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VisibleRun } from "../game";
import { RunHud } from "./RunHud";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Handcrafted VisibleRun so the HUD test does not depend on the sim. */
const visibleRun = (patch: Partial<VisibleRun> = {}): VisibleRun => ({
  seed: 42,
  depth: 2,
  maxDepthReached: 3,
  turn: 17,
  control: "auto",
  status: "active",
  hp: 10,
  maxHp: 14,
  heat: 2,
  throttled: false,
  revives: 0,
  attack: 2,
  powerDraw: 3,
  powerBudget: 5,
  overBudget: false,
  credits: "12" as VisibleRun["credits"],
  creditsLabel: "12",
  dataMined: 3,
  kills: 1,
  enemiesRemaining: 4,
  items: [],
  itemSlots: 6,
  msPerTurn: 1000,
  turnProgress: 0,
  pathPending: false,
  onStairs: false,
  elapsedMs: 20_000,
  tier: "cache",
  stairsLocked: true,
  boss: null,
  creditsPerSecond: 0.6,
  quota: { done: 2, required: 4, met: false, label: "FLUSH 2/4" },
  tasks: [],
  carrying: null,
  channeling: null,
  overclockTurns: 0,
  interactLabel: null,
  deathCause: null,
  ...patch,
});

describe("RunHud", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const button = (label: RegExp) =>
    Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((b) => label.test(b.textContent ?? ""));

  it("shows the quota chip and latched flush button", () => {
    const dispatch = vi.fn();
    act(() => root.render(<RunHud run={visibleRun()} dispatch={dispatch} />));
    expect(container.textContent).toContain("FLUSH 2/4");
    expect(container.textContent).toContain("cache");
    const flush = button(/Flush/)!;
    expect(flush.disabled).toBe(true);
    expect(flush.textContent).toContain("quota");
  });

  it("enables flush on the gate once the quota is met", () => {
    const dispatch = vi.fn();
    act(() =>
      root.render(
        <RunHud
          run={visibleRun({ quota: { done: 4, required: 4, met: true, label: "FLUSH 4/4" }, stairsLocked: false, onStairs: true })}
          dispatch={dispatch}
        />,
      ),
    );
    const flush = button(/Flush/)!;
    expect(flush.disabled).toBe(false);
    act(() => flush.click());
    expect(dispatch).toHaveBeenCalledWith({ type: "takeControl" });
    expect(dispatch).toHaveBeenCalledWith({ type: "descend" });
  });

  it("dispatches overclock and counts down while active", () => {
    const dispatch = vi.fn();
    act(() => root.render(<RunHud run={visibleRun()} dispatch={dispatch} />));
    const oc = button(/Overclock/)!;
    expect(oc.disabled).toBe(false);
    act(() => oc.click());
    expect(dispatch).toHaveBeenCalledWith({ type: "overclock" });

    act(() => root.render(<RunHud run={visibleRun({ overclockTurns: 7 })} dispatch={dispatch} />));
    const active = button(/OC 7t/)!;
    expect(active.disabled).toBe(true);
  });

  it("surfaces carry and channel indicators", () => {
    const dispatch = vi.fn();
    act(() =>
      root.render(
        <RunHud
          run={visibleRun({
            carrying: { payloadId: 1, portId: 5, label: "payload → port 2" },
            channeling: { siteId: 3, name: "sector 1", remainingTurns: 2, totalTurns: 4 },
          })}
          dispatch={dispatch}
        />,
      ),
    );
    expect(container.textContent).toContain("payload → port 2");
    expect(container.textContent).toContain("sector 1 · 2t");
  });
});
