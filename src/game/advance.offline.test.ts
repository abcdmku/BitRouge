import { describe, expect, it } from "vitest";
import { amountToNumber } from "./amount";
import { advanceGame } from "./advance";
import { OFFLINE_CAP_MS } from "./economy";
import { buildState } from "./testHelpers";

const withOfflineBuffer = <T extends ReturnType<typeof buildState>>(state: T) => {
  state.meta.research.completed = ["systemScheduler"];
  return state;
};

const poweredBoard = (seed: number, uptimeMs = 5 * 60_000) =>
  withOfflineBuffer(buildState({
    seed,
    railLevel: 2,
    reserveJ: 50,
    uptimeMs,
    dirs: [{ x: 1, y: 5, dir: "E" }],
  }));

describe("advanceGame offline mode", () => {
  it("is deterministic and piecewise-consistent (offline 2h ≡ 2×offline 1h)", () => {
    const start = poweredBoard(11);
    const whole = advanceGame(start, 2 * 3_600_000, "offline").state;
    const first = advanceGame(start, 3_600_000, "offline").state;
    const second = advanceGame(first, 3_600_000, "offline").state;
    expect(second).toEqual(whole);
  });

  it("counts uptime away while freezing foreground load escalation", () => {
    const start = poweredBoard(13, 10 * 60_000);
    const away = 2 * 3_600_000;
    const offline = advanceGame(start, away, "offline");
    expect(offline.state.run.uptimeMs).toBe(start.run.uptimeMs + away);
    expect(offline.state.run.pressureMs).toBe(start.run.pressureMs);
    const foreground = advanceGame(start, away, "foreground");
    // Foreground pressure keeps rising and floods the board with more work.
    expect(foreground.state.run.pressureMs).toBeGreaterThan(start.run.pressureMs);
    expect(offline.report.tasksDone).toBeGreaterThan(0);
    expect(offline.state.run.integrity).toBeGreaterThan(foreground.state.run.integrity);
  });

  it("floors offline integrity damage at 25 — the system never dies alone", () => {
    // Zero-generation board: every arrival overflows the backlog.
    const start = withOfflineBuffer(buildState({ seed: 17, uptimeMs: 30 * 60_000, integrity: 60 }));
    start.meta.totalTasks = 1;
    const offline = advanceGame(start, 6 * 3_600_000, "offline");
    expect(offline.state.run.integrity).toBeGreaterThanOrEqual(25);
    expect(offline.state.run.integrity).toBeLessThan(30); // it did bleed to the floor
    const foreground = advanceGame(start, 6 * 3_600_000, "foreground");
    expect(foreground.state.run.integrity).toBe(0); // same board dies in foreground
  });

  it("does not damage below the current value when returning already critical", () => {
    const start = withOfflineBuffer(buildState({ seed: 19, uptimeMs: 30 * 60_000, integrity: 10 }));
    start.meta.totalTasks = 1;
    const offline = advanceGame(start, 3_600_000, "offline");
    expect(offline.state.run.integrity).toBeGreaterThanOrEqual(10);
  });

  it("caps simulation at 12 hours", () => {
    const start = poweredBoard(23);
    const result = advanceGame(start, 24 * 3_600_000, "offline");
    expect(result.report.awayMs).toBe(24 * 3_600_000);
    expect(result.report.simulatedMs).toBe(OFFLINE_CAP_MS);
  });

  it("reports the return-dialog shape", () => {
    const start = poweredBoard(29);
    const { report, state } = advanceGame(start, 3_600_000, "offline");
    expect(report.mode).toBe("offline");
    expect(report.awayMs).toBe(3_600_000);
    expect(report.tasksDone).toBeGreaterThan(0);
    expect(report.dutyAvg).toBeGreaterThan(0);
    expect(report.dutyAvg).toBeLessThanOrEqual(1);
    expect(amountToNumber(report.creditsEarned)).toBeGreaterThan(0);
    expect(report.backlogNow).toBe(state.run.backlog.length);
    expect(report.integrityNow).toBe(state.run.integrity);
    expect(report.hadActivity).toBe(true);
  });

  it("earns only through powered automation (duty 0 boards do nothing)", () => {
    const start = buildState({ seed: 31 }); // boot board: 0 W generation
    const { report } = advanceGame(start, 3_600_000, "offline");
    expect(report.tasksDone).toBe(0);
    expect(amountToNumber(report.creditsEarned)).toBe(0);
    expect(report.dutyAvg).toBe(0);
  });

  it("completes a 6 h offline advance quickly (< 2 s in-process)", () => {
    const start = poweredBoard(37);
    const begin = performance.now();
    advanceGame(start, 6 * 3_600_000, "offline");
    expect(performance.now() - begin).toBeLessThan(2000);
  });
});
