import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { amount, createInitialGameState, deriveVisibleState, type GameState } from "../game";
import { HardwarePanel } from "./HardwarePanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("HardwarePanel", () => {
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

  const buttons = () => Array.from(container.querySelectorAll<HTMLButtonElement>("button"));

  it("disables Buy when unaffordable and shows the reason", () => {
    const base = createInitialGameState();
    const broke: GameState = { ...base, hub: { ...base.hub, credits: amount(0), data: amount(0) } };
    const dispatch = vi.fn();
    act(() => root.render(<HardwarePanel visible={deriveVisibleState(broke)} dispatch={dispatch} />));
    expect(buttons()).toHaveLength(7);
    expect(buttons().every((b) => b.disabled)).toBe(true);
    expect(container.textContent).toContain("Insufficient resources.");
    act(() => buttons()[0]!.click());
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("dispatches buyHardware for an affordable row", () => {
    const base = createInitialGameState();
    const rich: GameState = { ...base, hub: { ...base.hub, credits: amount(1_000_000), data: amount(1_000) } };
    const visible = deriveVisibleState(rich);
    const dispatch = vi.fn();
    act(() => root.render(<HardwarePanel visible={visible} dispatch={dispatch} />));
    const affordable = visible.hardware.findIndex((r) => r.affordable);
    expect(affordable).toBeGreaterThanOrEqual(0);
    expect(buttons()[affordable]!.disabled).toBe(false);
    act(() => buttons()[affordable]!.click());
    expect(dispatch).toHaveBeenCalledWith({ type: "buyHardware", kind: visible.hardware[affordable]!.kind });
    expect(container.textContent).toMatch(/Hz = .*s\/turn/);
  });
});
