import { stepRunTurn } from "../advance";
import { applyAction } from "../actions";
import { deriveHeroStats } from "../hero";
import { createInitialGameState } from "../initialState";
import type { RunState } from "../types";

const SEEDS = 200;
const TURNS = 5000;
const PROGRESS_WINDOW = 300;

/**
 * Progress = descending, killing, damaging, picking up, or revealing new tiles.
 * `explored` is replaced (new array identity) only when tiles are revealed.
 */
const progressKey = (run: RunState) => {
  const enemyHp = run.enemies.reduce((sum, enemy) => sum + enemy.hp, 0);
  return `${run.depth}:${run.kills}:${run.items.length}:${enemyHp}`;
};

describe("auto-explore never stalls", () => {
  it(`makes progress every ${PROGRESS_WINDOW} turns and reaches depth 3 (immortal hero, ${SEEDS} seeds)`, () => {
    let worstGap = 0;
    let minDepth = Number.POSITIVE_INFINITY;
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const state = applyAction(createInitialGameState(seed), { type: "deploy" });
      const stats = deriveHeroStats(state.hub);
      const IMMORTAL_HP = 1_000_000;
      let run: RunState = { ...state.run!, hero: { ...state.run!.hero, hp: IMMORTAL_HP, maxHp: IMMORTAL_HP } };
      let lastKey = progressKey(run);
      let lastExplored = run.floor.explored;
      let lastProgressTurn = 0;
      for (let turn = 0; turn < TURNS; turn += 1) {
        run = stepRunTurn(run, stats);
        // immortal: refill so death never ends the loop (descending resets maxHp from hardware)
        if (run.hero.hp < IMMORTAL_HP || run.hero.maxHp < IMMORTAL_HP) {
          run = { ...run, hero: { ...run.hero, hp: IMMORTAL_HP, maxHp: IMMORTAL_HP } };
        }
        if (run.status !== "active") throw new Error(`seed ${seed}: immortal hero died`);
        const key = progressKey(run);
        if (key !== lastKey || run.floor.explored !== lastExplored) {
          lastKey = key;
          lastExplored = run.floor.explored;
          lastProgressTurn = run.turn;
        }
        const gap = run.turn - lastProgressTurn;
        worstGap = Math.max(worstGap, gap);
        if (gap > PROGRESS_WINDOW) throw new Error(`seed ${seed}: no progress for ${gap} turns at depth ${run.depth}`);
      }
      minDepth = Math.min(minDepth, run.depth);
      expect(run.depth).toBeGreaterThanOrEqual(3);
    }
    expect(worstGap).toBeLessThanOrEqual(PROGRESS_WINDOW);
    expect(minDepth).toBeGreaterThanOrEqual(3);
  }, 60_000);
});
