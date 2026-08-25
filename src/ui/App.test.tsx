import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardViewProps } from "./BoardView";

// WS2's BoardView owns a Phaser game — mocked out, with the captured props
// letting tests drive board taps (onCommand / onPopover) directly.
const boardProps = vi.hoisted(() => ({ current: null as BoardViewProps | null }));

vi.mock("./BoardView", () => ({
  BoardView: (props: BoardViewProps) => {
    boardProps.current = props;
    return <div data-testid="board" data-place-mode={props.placeMode ?? ""} />;
  },
}));

// The sim is real except deriveRenderSnapshot (the hook is mocked, so `state`
// is a minimal fixture the real snapshot deriver would reject).
vi.mock("../game", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../game")>();
  return { ...actual, deriveRenderSnapshot: () => ({ mock: true }) };
});

import {
  amount,
  type AdvanceReport,
  type ArchPerkId,
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

import { App } from "./App";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fakeState = () =>
  ({
    run: { board: { sockets: [{ heat: 20 }, { heat: 74 }, { heat: 0 }] } },
  }) as unknown as GameState;

const baseVisible = (): VisibleState => ({
  hud: {
    uptimeLabel: "12:41",
    uptimeMs: 761_000,
    integrity: 82,
    integrityMax: 100,
    integrityLabel: "82",
    creditsLabel: "1,204",
    dataLabel: "18",
    siliconLabel: "7",
    reserveJ: 62,
    reserveMax: 100,
    reserveLabel: "62 J",
    netWatts: -3,
    netWattsLabel: "-3 W",
    generationW: 6,
    drawW: 9,
    duty: 0.71,
    dutyLabel: "71%",
    gen: 1,
    crashed: false,
  },
  backlog: [
    { id: 1, kind: "bulk", kindLabel: "BULK", valueLabel: "2", deadlineLabel: null },
    { id: 2, kind: "priority", kindLabel: "PRIORITY", valueLabel: "9", deadlineLabel: "32s" },
  ],
  backlogCap: 12,
  build: [
    {
      kind: "core",
      label: "CORE",
      flavor: "pulls a task, emits a packet",
      cost: amount("15"),
      costLabel: "15",
      affordable: true,
      glow: true,
      owned: 1,
      lockedReason: null,
    },
  ],
  system: [
    {
      id: "rail",
      isFirmware: false,
      label: "RAIL",
      flavor: "+6 W generation",
      level: 0,
      costLabel: "12",
      currency: "credits",
      affordable: true,
      glow: true,
      owned: false,
    },
    {
      id: "heatPipes",
      isFirmware: true,
      label: "HEAT PIPES",
      flavor: "ambient cooling ×3",
      level: 0,
      costLabel: "10",
      currency: "data",
      affordable: false,
      glow: false,
      owned: false,
    },
  ],
  arch: [
    {
      id: "startKit" as ArchPerkId,
      label: "START KIT",
      flavor: "begin with RAIL I + 6 sockets",
      costSilicon: 3,
      costLabel: "3 Si",
      affordable: true,
      glow: true,
      owned: false,
      repeatable: false,
      timesOwned: 0,
      lockedReason: null,
    },
  ],
  popovers: [
    null,
    null,
    null,
    {
      index: 3,
      kind: "cache",
      label: "CACHE",
      level: 2,
      powered: true,
      faulted: false,
      drawW: 3,
      upgradeCostLabel: "48",
      upgradeAffordable: true,
      upgradeLockedReason: null,
      sellRefundLabel: "20",
    },
  ],
  crash: null,
  reflow: { available: false, siliconPayout: 0 },
  tickMsLabel: "500 ms",
});

const findButton = (container: HTMLElement, text: string) =>
  Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === text);

describe("App", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    persistence.state = fakeState();
    persistence.visible = baseVisible();
    persistence.dispatch.mockReset();
    persistence.dismissOfflineReport.mockReset();
    persistence.offlineReport = null;
    persistence.saveDriver = "memory";
    persistence.hydrated = true;
    boardProps.current = null;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.location.hash = "";
  });

  it("renders the HUD strip and backlog from the hook's visible state", () => {
    act(() => root.render(<App />));
    expect(container.textContent).toContain("12:41");
    expect(container.textContent).toContain("1,204");
    expect(container.textContent).toContain("62 J");
    expect(container.textContent).toContain("82"); // integrity readout
    expect(container.textContent).toContain("74C"); // hottest socket from state
    expect(container.textContent).toContain("2/12"); // backlog n/cap
    expect(container.textContent).toContain("saved to memory only");
    expect(container.querySelector('[data-testid="board"]')).not.toBeNull();
  });

  it("runs the BUILD row → place-mode → placeComponent flow", () => {
    act(() => root.render(<App />));

    // Tap the CORE shop row: place-mode banner appears, board gets the kind.
    const place = findButton(container, "PLACE");
    expect(place).toBeDefined();
    act(() => place!.click());
    expect(container.textContent).toContain("TAP A SOCKET TO PLACE CORE");
    expect(boardProps.current?.placeMode).toBe("core");

    // Board reports the placement tap: dispatched, place-mode cleared.
    act(() => boardProps.current!.onCommand({ type: "placeComponent", index: 5, kind: "core" }));
    expect(persistence.dispatch).toHaveBeenCalledWith({ type: "placeComponent", index: 5, kind: "core" });
    expect(container.textContent).not.toContain("TAP A SOCKET TO PLACE");
    expect(boardProps.current?.placeMode).toBeNull();
  });

  it("cancels place-mode from the banner", () => {
    act(() => root.render(<App />));
    act(() => findButton(container, "PLACE")!.click());
    const banner = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("tap here to cancel"),
    );
    act(() => banner!.click());
    expect(container.textContent).not.toContain("TAP A SOCKET TO PLACE");
    expect(persistence.dispatch).not.toHaveBeenCalled();
  });

  it("dispatches buySystem for power rows and buyFirmware for firmware rows", () => {
    act(() => root.render(<App />));
    act(() => findButton(container, "System")!.click());
    act(() => findButton(container, "BUY")!.click());
    expect(persistence.dispatch).toHaveBeenCalledWith({ type: "buySystem", item: "rail" });
  });

  it("opens the long-press popover and dispatches upgrade for that socket", () => {
    act(() => root.render(<App />));
    act(() => boardProps.current!.onPopover(3));
    expect(container.textContent).toContain("CACHE L2");
    const upgrade = Array.from(container.querySelectorAll<HTMLButtonElement>(".popover__action")).find((b) =>
      b.textContent?.includes("Upgrade"),
    );
    act(() => upgrade!.click());
    expect(persistence.dispatch).toHaveBeenCalledWith({ type: "upgradeComponent", index: 3 });
    expect(container.textContent).not.toContain("CACHE L2");
  });

  it("shows the crash report and REFLOW dispatches reflow + opens ARCH", () => {
    const visible = baseVisible();
    visible.crash = {
      uptimeLabel: "18:22",
      uptimeMs: 1_102_000,
      siliconPayout: 7,
      tasksDone: 214,
      rows: [
        { source: "backlogOverflow", label: "BACKLOG OVERFLOW", amount: 61, percent: 61 },
        { source: "overheat", label: "OVERHEAT", amount: 39, percent: 39 },
      ],
      killedBy: "BACKLOG OVERFLOW",
    };
    persistence.visible = visible;

    act(() => root.render(<App />));
    expect(container.textContent).toContain("Killed by BACKLOG OVERFLOW (61% of damage).");
    expect(container.textContent).toContain("+7");

    act(() => findButton(container, "REFLOW")!.click());
    expect(persistence.dispatch).toHaveBeenCalledWith({ type: "reflow" });
    const archTab = container.querySelector("#tab-arch");
    expect(archTab?.getAttribute("aria-selected")).toBe("true");
  });

  it("gates the offline dialog on hadActivity", () => {
    persistence.offlineReport = {
      mode: "offline",
      awayMs: 22_320_000,
      simulatedMs: 22_320_000,
      tasksDone: 0,
      dutyAvg: 0,
      creditsEarned: amount("0"),
      dataEarned: amount("0"),
      backlogNow: 0,
      integrityNow: 100,
      hadActivity: false,
    } satisfies AdvanceReport;
    act(() => root.render(<App />));
    expect(container.textContent).not.toContain("While you were away");
  });

  it("suppresses the offline dialog for short absences (tab-switch round-trips)", () => {
    persistence.offlineReport = {
      mode: "offline",
      awayMs: 27_000,
      simulatedMs: 27_000,
      tasksDone: 3,
      dutyAvg: 0.5,
      creditsEarned: amount("2"),
      dataEarned: amount("0"),
      backlogNow: 4,
      integrityNow: 98,
      hadActivity: true,
    } satisfies AdvanceReport;
    act(() => root.render(<App />));
    expect(container.textContent).not.toContain("While you were away");
  });

  it("shows the offline dialog with the §2 copy and dismisses through the hook", () => {
    persistence.offlineReport = {
      mode: "offline",
      awayMs: 22_320_000,
      simulatedMs: 22_320_000,
      tasksDone: 2_140,
      dutyAvg: 0.71,
      creditsEarned: amount("5320"),
      dataEarned: amount("148"),
      backlogNow: 11,
      integrityNow: 44,
      hadActivity: true,
    } satisfies AdvanceReport;
    act(() => root.render(<App />));
    expect(container.textContent).toContain("While you were away");
    expect(container.textContent).toContain("2,140");
    expect(container.textContent).toContain("71%");
    expect(container.textContent).toContain("11/12");
    expect(container.textContent).toContain("It needs you.");
    act(() => findButton(container, "Continue")!.click());
    expect(persistence.dismissOfflineReport).toHaveBeenCalled();
  });
});
