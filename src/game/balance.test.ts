import { advanceGame } from "./advance";
import { applyAction } from "./actions";
import { amountToNumber } from "./amount";
import { createInitialGameState } from "./initialState";

const SEEDS = 20;

/**
 * First-run sanity with the initial hardware (clock 1, everything else 0).
 * Ranges are deliberately loose: they guard against "dies in 5 turns" and
 * "never dies" regressions, not a specific tuning.
 */
describe("balance: first run from the initial state", () => {
  it(`lasts a few hundred turns and banks roughly 10-40 credits (${SEEDS} seeds)`, () => {
    const turns: number[] = [];
    const credits: number[] = [];
    const depths: number[] = [];
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      let state = applyAction(createInitialGameState(seed), { type: "deploy" });
      let guard = 0;
      while (state.run && guard++ < 400) state = advanceGame(state, 60_000, "foreground").state;
      expect(state.run).toBeNull(); // the first run always ends
      const summary = state.hub.lastRunSummary!;
      turns.push(summary.turns);
      credits.push(amountToNumber(summary.creditsBanked));
      depths.push(summary.maxDepthReached);
      expect(summary.turns).toBeGreaterThanOrEqual(20);
      expect(summary.turns).toBeLessThanOrEqual(1500);
      expect(amountToNumber(summary.creditsBanked)).toBeGreaterThanOrEqual(4);
      expect(amountToNumber(summary.creditsBanked)).toBeLessThanOrEqual(80);
      expect(summary.maxDepthReached).toBeGreaterThanOrEqual(1);
      expect(summary.maxDepthReached).toBeLessThanOrEqual(5);
      expect(amountToNumber(summary.dataBanked)).toBeGreaterThanOrEqual(5); // new max depth 1 alone gives 5
    }
    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(mean(turns)).toBeGreaterThanOrEqual(60);
    expect(mean(turns)).toBeLessThanOrEqual(600);
    expect(mean(credits)).toBeGreaterThanOrEqual(8);
    expect(mean(credits)).toBeLessThanOrEqual(45);
    expect(Math.max(...depths)).toBeGreaterThanOrEqual(2); // some runs reach depth 2+
  }, 30_000);

  it("each hardware level is meaningful: cache, ram and clock each help the first run", () => {
    const outcome = (kind: "cache" | "ram" | "clock", level: number) => {
      let totalCredits = 0;
      let totalElapsed = 0;
      for (let seed = 1; seed <= SEEDS; seed += 1) {
        let state = createInitialGameState(seed);
        state = { ...state, hub: { ...state.hub, hardware: { ...state.hub.hardware, [kind]: level } } };
        state = applyAction(state, { type: "deploy" });
        let guard = 0;
        while (state.run && guard++ < 400) state = advanceGame(state, 60_000, "foreground").state;
        totalCredits += amountToNumber(state.hub.lastRunSummary!.creditsBanked);
        totalElapsed += state.hub.lastRunSummary!.elapsedMs;
      }
      return { credits: totalCredits / SEEDS, elapsedMs: totalElapsed / SEEDS };
    };
    const base = outcome("cache", 0);
    expect(outcome("cache", 2).credits).toBeGreaterThan(base.credits * 1.2);
    expect(outcome("ram", 2).credits).toBeGreaterThan(base.credits * 1.2);
    // a faster clock runs the same turns in less time (credits/s goes up)
    const clock = outcome("clock", 4);
    expect(clock.credits / clock.elapsedMs).toBeGreaterThan((base.credits / base.elapsedMs) * 1.3);
  }, 60_000);
});
