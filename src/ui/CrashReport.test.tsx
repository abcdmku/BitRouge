import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CrashReport, type CrashDamageEntry } from "./CrashReport";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const damage: CrashDamageEntry[] = [
  { source: "backlogOverflow", label: "BACKLOG OVERFLOW", amount: 42, pct: 61 },
  { source: "faultSpread", label: "FAULT SPREAD", amount: 18, pct: 26 },
  { source: "heatRunaway", label: "HEAT RUNAWAY", amount: 9, pct: 13 },
];

describe("CrashReport", () => {
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

  it("names the killer in one autopsy sentence from the top damage source", () => {
    act(() =>
      root.render(
        <CrashReport uptimeLabel="18:22" tasksCompleted={214} siliconPayout={7} damage={damage} onReflow={() => {}} />,
      ),
    );
    expect(container.textContent).toContain("Killed by BACKLOG OVERFLOW (61% of damage).");
    expect(container.textContent).toContain("18:22");
    expect(container.textContent).toContain("+7");
  });

  it("renders the damage log ranked, with bar widths matching pct", () => {
    act(() =>
      root.render(
        <CrashReport uptimeLabel="18:22" tasksCompleted={214} siliconPayout={7} damage={damage} onReflow={() => {}} />,
      ),
    );
    const labels = Array.from(container.querySelectorAll(".crash-bar__label")).map((el) => el.textContent);
    expect(labels).toEqual(["BACKLOG OVERFLOW", "FAULT SPREAD", "HEAT RUNAWAY"]);
    const fills = Array.from(container.querySelectorAll<HTMLElement>(".crash-bar__fill")).map(
      (el) => el.style.width,
    );
    expect(fills).toEqual(["61%", "26%", "13%"]);
  });

  it("falls back gracefully with no damage entries", () => {
    act(() =>
      root.render(
        <CrashReport uptimeLabel="00:04" tasksCompleted={0} siliconPayout={0} damage={[]} onReflow={() => {}} />,
      ),
    );
    expect(container.textContent).toContain("Cause unknown");
    expect(container.textContent).toContain("no damage recorded");
  });

  it("fires onReflow from the REFLOW button", () => {
    const onReflow = vi.fn();
    act(() =>
      root.render(
        <CrashReport uptimeLabel="18:22" tasksCompleted={214} siliconPayout={7} damage={damage} onReflow={onReflow} />,
      ),
    );
    const button = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "REFLOW");
    act(() => button!.click());
    expect(onReflow).toHaveBeenCalledTimes(1);
  });
});
