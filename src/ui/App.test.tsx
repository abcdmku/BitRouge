import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  amount,
  createInitialGameState,
  deriveVisibleState,
  type AdvanceReport,
  type GameState,
  type VisibleState,
} from "../game";

const persistence = vi.hoisted(() => ({
  state: null as unknown,
  visible: null as unknown,
  dispatch: vi.fn(),
  lastReport: null as unknown,
  offlineReport: null as unknown,
  dismissOfflineReport: vi.fn(),
  saveDriver: "memory" as string,
  hydrated: true,
}));

vi.mock("./hooks/useGamePersistence", () => ({
  useGamePersistence: () => persistence,
}));

vi.mock("../dev/RenderDevPage", () => ({
  RenderDevPage: () => <div>RENDER DEV PAGE</div>,
}));

import { App } from "./App";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const setState = (state: GameState) => {
  persistence.state = state;
  persistence.visible = deriveVisibleState(state);
};

const currentVisible = () => persistence.visible as VisibleState;

const findButton = (container: HTMLElement, text: string) =>
  Array.from(container.querySelectorAll("button")).find((button) =>
    button.textContent?.includes(text),
  );

describe("App", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    setState(createInitialGameState(7));
    persistence.dispatch.mockReset();
    persistence.dismissOfflineReport.mockReset();
    persistence.offlineReport = null;
    persistence.saveDriver = "memory";
    persistence.hydrated = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.location.hash = "";
  });

  it("renders the playable node, resources, and workshop on the first screen", () => {
    act(() => root.render(<App />));
    expect(container.textContent).toContain("BITROUGE");
    expect(container.textContent).toContain("Starting Node");
    expect(container.textContent).toContain("0/12 jobs waiting");
    expect(container.textContent).toContain("AUTO PROCESSINGRUNNING");
    expect(container.textContent).toContain("QUEUE EMPTY");
    expect(container.textContent).toContain("Hardware");
    expect(container.textContent).toContain("LOCAL SAVE UNAVAILABLE");
  });

  it("dispatches all three manual interventions", () => {
    const state = createInitialGameState(8);
    state.run.backlog.push({ id: 1, kind: "bulk", value: amount(1), deadlineMs: null });
    state.run.board.sockets[17].heat = 50;
    setState(state);
    act(() => root.render(<App />));

    act(() => findButton(container, "RUN TASK NOW")!.click());
    act(() => findButton(container, "VENT HEAT")!.click());
    act(() => findButton(container, "SHED LOAD")!.click());

    expect(persistence.dispatch).toHaveBeenCalledWith({ type: "pulseSystem" });
    expect(persistence.dispatch).toHaveBeenCalledWith({ type: "ventSystem" });
    expect(persistence.dispatch).toHaveBeenCalledWith({ type: "shedLoad" });
  });

  it("buys base hardware and upgrades an installed CPU", () => {
    const state = createInitialGameState(9);
    state.run.credits = amount(1_000);
    setState(state);
    act(() => root.render(<App />));

    act(() => findButton(container, "PSU Capacity")!.click());
    expect(persistence.dispatch).toHaveBeenCalledWith({ type: "buySystem", item: "rail" });

    const cpuCard = Array.from(container.querySelectorAll("article")).find((card) =>
      card.textContent?.includes("CPU Core"),
    );
    const upgrade = findButton(cpuCard!, "UPGRADE TO L2");
    act(() => upgrade!.click());
    expect(persistence.dispatch).toHaveBeenCalledWith({ type: "upgradeComponent", index: 17 });
  });

  it("starts research from the dedicated R&D view", () => {
    const state = createInitialGameState(10);
    state.run.credits = amount(10);
    setState(state);
    act(() => root.render(<App />));

    act(() => findButton(container, "Research")!.click());
    expect(container.textContent).toContain("Decode Logic");
    act(() => findButton(container, "START RESEARCH")!.click());
    expect(persistence.dispatch).toHaveBeenCalledWith({ type: "startResearch", id: "decodeLogic" });
  });

  it("inspects the installed CPU and dispatches its popover upgrade", () => {
    const state = createInitialGameState(11);
    state.run.credits = amount(100);
    setState(state);
    act(() => root.render(<App />));

    act(() => findButton(container, "CPU ARRAY")!.click());
    expect(container.textContent).toContain("CPU Core L1");
    act(() => findButton(container, "Upgrade")!.click());
    expect(persistence.dispatch).toHaveBeenCalledWith({ type: "upgradeComponent", index: 17 });
  });

  it("shows the crash autopsy and moves to Evolution after reflow", () => {
    const state = createInitialGameState(12);
    state.run.integrity = 0;
    state.run.uptimeMs = 1_102_000;
    state.run.tasksDone = 214;
    state.run.damageLog.backlogOverflow = 61;
    setState(state);
    act(() => root.render(<App />));

    expect(container.textContent).toContain("Killed by BACKLOG OVERFLOW");
    act(() => findButton(container, "REFLOW")!.click());
    expect(persistence.dispatch).toHaveBeenCalledWith({ type: "reflow" });
    expect(container.querySelector("#tab-evolution")?.getAttribute("aria-selected")).toBe("true");
  });

  it("ignores empty and short offline reports", () => {
    persistence.offlineReport = {
      mode: "offline",
      awayMs: 27_000,
      simulatedMs: 0,
      tasksDone: 0,
      dutyAvg: 0,
      creditsEarned: amount(0),
      dataEarned: amount(0),
      backlogNow: 0,
      integrityNow: 100,
      hadActivity: false,
    } satisfies AdvanceReport;
    act(() => root.render(<App />));
    expect(container.textContent).not.toContain("While you were away");
  });

  it("shows a meaningful offline report and dismisses it", () => {
    persistence.offlineReport = {
      mode: "offline",
      awayMs: 22_320_000,
      simulatedMs: 22_320_000,
      tasksDone: 2_140,
      dutyAvg: 0.71,
      creditsEarned: amount(5_320),
      dataEarned: amount(148),
      backlogNow: 11,
      integrityNow: 44,
      hadActivity: true,
    } satisfies AdvanceReport;
    act(() => root.render(<App />));
    expect(container.textContent).toContain("While you were away");
    expect(container.textContent).toContain("2,140");
    expect(container.textContent).toContain("It needs you.");
    act(() => findButton(container, "Continue")!.click());
    expect(persistence.dismissOfflineReport).toHaveBeenCalled();
  });

  it("shows the boot screen until persistence is hydrated", () => {
    persistence.hydrated = false;
    act(() => root.render(<App />));
    expect(container.textContent).toBe("BOOTING NODE...");
    expect(currentVisible()).toBeDefined();
  });
});
