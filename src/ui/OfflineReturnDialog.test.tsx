import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OfflineReturnDialog,
  offlineReportIsInteresting,
  type VisibleOfflineReport,
} from "./OfflineReturnDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const report = (overrides: Partial<VisibleOfflineReport> = {}): VisibleOfflineReport => ({
  awayLabel: "6h 12m",
  tasksDone: 2_140,
  dutyLabel: "71%",
  creditsLabel: "5,320",
  dataLabel: "148",
  backlogLabel: "11/12",
  integrityLabel: "44",
  hadActivity: true,
  needsAttention: true,
  ...overrides,
});

describe("offlineReportIsInteresting", () => {
  it("gates on hadActivity", () => {
    expect(offlineReportIsInteresting(report())).toBe(true);
    expect(offlineReportIsInteresting(report({ hadActivity: false }))).toBe(false);
    expect(offlineReportIsInteresting(null)).toBe(false);
    expect(offlineReportIsInteresting(undefined)).toBe(false);
  });
});

describe("OfflineReturnDialog", () => {
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

  it("reads like the §2 copy: away time, tasks at duty, and 'It needs you'", () => {
    act(() => root.render(<OfflineReturnDialog report={report()} onDismiss={() => {}} />));
    expect(container.textContent).toContain("6h 12m");
    expect(container.textContent).toContain("2,140");
    expect(container.textContent).toContain("71%");
    expect(container.textContent).toContain("11/12");
    expect(container.textContent).toContain("44");
    expect(container.textContent).toContain("It needs you.");
  });

  it("omits 'It needs you' when the board is healthy", () => {
    act(() =>
      root.render(
        <OfflineReturnDialog
          report={report({ needsAttention: false, integrityLabel: "96", backlogLabel: "2/12" })}
          onDismiss={() => {}}
        />,
      ),
    );
    expect(container.textContent).not.toContain("It needs you.");
  });

  it("dismisses via the Continue button", () => {
    const onDismiss = vi.fn();
    act(() => root.render(<OfflineReturnDialog report={report()} onDismiss={onDismiss} />));
    const button = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Continue");
    act(() => button!.click());
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
