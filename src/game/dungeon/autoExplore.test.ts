import { applyAction } from "../actions";
import { stepRunTurn } from "../advance";
import { deriveHeroStats } from "../hero";
import { createInitialGameState } from "../initialState";
import type { RunState } from "../types";

const SEEDS = 200;
const MAX_TURNS = 4000;
const PROGRESS_WINDOW = 400;
/** depth 6 crosses the cache -> ram tier boundary and the depth-3 controller */
const TARGET_DEPTH = 6;
const IMMORTAL_HP = 1_000_000;

/**
 * Progress = descending, quota/site/haul/GC advancement, mining, killing,
 * picking up, or revealing tiles. Working turns that only tick
 * `remainingUnits` are deliberately excluded so a channel that keeps getting
 * reset (a treadmill) counts as a stall; long jobs finish well inside the
 * window. `explored` is replaced (new identity) only when tiles are revealed.
 */
const progressKey = (run: RunState) =>
  [
    run.depth,
    run.quota.done,
    run.sitesCompleted,
    run.payloadsDelivered,
    run.leaksCollected,
    run.dataMined,
    run.kills,
    run.items.length,
    run.sites.filter((site) => site.resolved).length,
  ].join(":");

describe("auto-explore clears quota floors unattended", () => {
  it(`progress every ${PROGRESS_WINDOW} turns, depth >= ${TARGET_DEPTH}, quota-met flushes (immortal hero, ${SEEDS} seeds)`, () => {
    let worstGap = 0;
    let quotaMetDescents = 0;
    let forcedDescents = 0;
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const state = applyAction(createInitialGameState(seed), { type: "deploy" });
      const stats = deriveHeroStats(state.hub);
      let run: RunState = {
        ...state.run!,
        hero: { ...state.run!.hero, hp: IMMORTAL_HP, maxHp: IMMORTAL_HP },
      };
      let lastKey = progressKey(run);
      let lastExplored = run.floor.explored;
      let lastProgressTurn = 0;
      for (let turn = 0; turn < MAX_TURNS && run.depth < TARGET_DEPTH; turn += 1) {
        const beforeDepth = run.depth;
        const beforeQuota = run.quota;
        run = stepRunTurn(run, stats);
        // immortal: refill so death never ends the loop (descending resets maxHp)
        if (run.hero.hp < IMMORTAL_HP || run.hero.maxHp < IMMORTAL_HP) {
          run = { ...run, hero: { ...run.hero, hp: IMMORTAL_HP, maxHp: IMMORTAL_HP } };
        }
        if (run.status !== "active") throw new Error(`seed ${seed}: immortal hero died`);
        if (run.depth > beforeDepth) {
          if (beforeQuota.done >= beforeQuota.required) quotaMetDescents += 1;
          else forcedDescents += 1;
        }
        const key = progressKey(run);
        if (key !== lastKey || run.floor.explored !== lastExplored) {
          lastKey = key;
          lastExplored = run.floor.explored;
          lastProgressTurn = run.turn;
        }
        const gap = run.turn - lastProgressTurn;
        worstGap = Math.max(worstGap, gap);
        if (gap > PROGRESS_WINDOW) {
          throw new Error(`seed ${seed}: no progress for ${gap} turns at depth ${run.depth}`);
        }
      }
      expect(run.depth).toBeGreaterThanOrEqual(TARGET_DEPTH);
    }
    expect(worstGap).toBeLessThanOrEqual(PROGRESS_WINDOW);
    // flushes are earned: the anti-stall forceFlush stays the rare exception
    const descents = quotaMetDescents + forcedDescents;
    expect(descents).toBeGreaterThanOrEqual(SEEDS * (TARGET_DEPTH - 1));
    expect(quotaMetDescents / descents).toBeGreaterThanOrEqual(0.7);
  }, 120_000);
});
