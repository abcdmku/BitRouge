import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyAction, createInitialGameState, deriveVisibleState, type GameAction, type GameState } from "../game";

vi.mock("./DungeonView", () => ({
  DungeonView: () => <div data-testid="dungeon" />,
}));

const persistence = vi.hoisted(() => ({
  state: null as unknown as GameState,
  dispatch: vi.fn<(action: GameAction) => void>(),
  lastReport: null as unknown,
  saveDriver: "memory" as string,
  hydrated: true,
}));

vi.mock("./hooks/useGamePersistence", () => ({
  useGamePersistence: () => ({
    state: persistence.state,
    visible: deriveVisibleState(persistence.state),
    dispatch: persistence.dispatch,
    lastReport: persistence.lastReport,
    saveDriver: persistence.saveDriver,
    hydrated: persistence.hydrated,
  }),
}));

import { App } from "./App";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("App", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    persistence.state = createInitialGameState();
    persistence.dispatch.mockReset();
    persistence.lastReport = null;
    persistence.saveDriver = "memory";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.location.hash = "";
  });

  it("renders the hub and dispatches deploy", () => {
    act(() => root.render(<App />));
    expect(container.textContent).toContain("BitRouge");
    expect(container.textContent).toContain("saved to memory only");
    const deploy = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Deploy");
    expect(deploy).toBeDefined();
    expect(deploy!.disabled).toBe(false);
    act(() => deploy!.click());
    expect(persistence.dispatch).toHaveBeenCalledWith({ type: "deploy" });
  });

  it("renders the run HUD once a run is active", () => {
    persistence.state = applyAction(createInitialGameState(), { type: "deploy" });
    act(() => root.render(<App />));
    expect(container.querySelector('[data-testid="dungeon"]')).not.toBeNull();
    const auto = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Auto");
    expect(auto).toBeDefined();
    act(() => auto!.click());
    expect(persistence.dispatch).toHaveBeenCalledWith({ type: "takeControl" });
  });

  it("shows the offline dialog when something happened while away", () => {
    persistence.lastReport = {
      mode: "offline",
      elapsedMs: 60_000,
      simulatedMs: 60_000,
      overflowMs: 0,
      runsCompleted: 2,
      extrapolatedRuns: 0,
      creditsBanked: "40",
      dataBanked: "4",
      bufferLevelId: "watchdogTimer",
      bufferCapacityMs: 7_200_000,
      turnsSimulated: 100,
      extrapolatedMs: 0,
      hadActivity: true,
    };
    act(() => root.render(<App />));
    expect(container.textContent).toContain("Offline report");
    const cont = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Continue");
    act(() => cont!.click());
    expect(container.textContent).not.toContain("Offline report");
  });
});
