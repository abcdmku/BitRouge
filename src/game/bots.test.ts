import { describe, expect, it } from "vitest";
import { amountCompare } from "./amount";
import { applyAction } from "./actions";
import { advanceGame, isCrashed } from "./advance";
import { stepIndex, toIndex } from "./board";
import { getSiliconPayout } from "./economy";
import { createInitialGameState } from "./initialState";
import type { Dir, GameState } from "./types";

// ============================================================================
// Two scripted zero-watt policies on one seed. Sprint hand-carries the short
// boot column; snake unlocks a detour through a CACHE for ×2 value at a lower
// task rate. Both are hands-only (no rails), so routing geometry and tap
// budget decide uptime — the §7 divergence criterion.
// ============================================================================

const at = (x: number, y: number) => toIndex(x, y, 5);
const SEED = 0xb17;
const STEP_MS = 1_000;
const MAX_SIM_MS = 45 * 60_000;

const portIndex = at(2, 6);

/** Can the packet resting on `index` hop right now? Mirrors the engine's checks. */
const canHop = (state: GameState, index: number) => {
  const board = state.run.board;
  const target = stepIndex(index, board.sockets[index].dir, board.width, board.height);
  if (target < 0) return false;
  if (target === portIndex) return true;
  const socket = board.sockets[target];
  if (!socket.unlocked) return false;
  if (socket.component?.faulted) return false;
  if (socket.component?.kind === "miner") return true;
  return !board.packets.some((packet) => packet.socketIndex === target);
};

/** One WORK tap: deliver > advance oldest movable packet > hand-pull the core. */
const bestTap = (state: GameState, coreIndex: number): number | null => {
  const board = state.run.board;
  for (const packet of board.packets) {
    const target = stepIndex(
      packet.socketIndex,
      board.sockets[packet.socketIndex].dir,
      board.width,
      board.height,
    );
    if (target === portIndex) return packet.socketIndex;
  }
  for (const packet of board.packets) {
    if (canHop(state, packet.socketIndex)) return packet.socketIndex;
  }
  const coreFree = !board.packets.some((packet) => packet.socketIndex === coreIndex);
  if (coreFree && state.run.backlog.length > 0) return coreIndex;
  return null;
};

interface BotResult {
  uptimeMinutes: number;
  tasksDone: number;
  silicon: number;
  credits: string;
}

interface BotPolicy {
  tapsPerSecond: number;
  /** Runs once per policy step; may issue purchase/routing actions. */
  build?: (state: GameState) => GameState;
}

const runBot = (policy: BotPolicy): BotResult => {
  let state = createInitialGameState(SEED);
  const coreIndex = at(2, 3);
  // Power the boot CORE on with 0 W generation: duty 0 keeps the board fully
  // manual (the zero-watt regime these policies are tuned for) — packets only
  // move when hand-carried.
  state = applyAction(state, { type: "togglePower", index: coreIndex });
  let tapBudget = 0;
  let simMs = 0;
  while (!isCrashed(state) && simMs < MAX_SIM_MS) {
    if (policy.build) state = policy.build(state);
    tapBudget += policy.tapsPerSecond * (STEP_MS / 1000);
    while (tapBudget >= 1) {
      tapBudget -= 1;
      const tap = bestTap(state, coreIndex);
      if (tap === null) break;
      state = applyAction(state, { type: "workSocket", index: tap });
    }
    state = advanceGame(state, STEP_MS, "foreground").state;
    simMs += STEP_MS;
  }
  return {
    uptimeMinutes: state.run.uptimeMs / 60_000,
    tasksDone: state.run.tasksDone,
    silicon: getSiliconPayout(state.run.uptimeMs, state.run.tasksDone),
    credits: state.run.credits,
  };
};

/** Snake build: detour the flow through a CACHE at (1,4) once it is affordable. */
const snakeBuild = (input: GameState): GameState => {
  let state = input;
  const board = state.run.board;
  if (!board.sockets[at(1, 4)].unlocked && amountCompare(state.run.credits, 5) >= 0) {
    state = applyAction(state, { type: "unlockSocket", index: at(1, 4) });
  }
  if (
    state.run.board.sockets[at(1, 4)].unlocked &&
    !state.run.board.sockets[at(1, 5)].unlocked &&
    amountCompare(state.run.credits, 6) >= 0
  ) {
    state = applyAction(state, { type: "unlockSocket", index: at(1, 5) });
  }
  const ready =
    state.run.board.sockets[at(1, 4)].unlocked && state.run.board.sockets[at(1, 5)].unlocked;
  if (
    ready &&
    state.run.board.sockets[at(1, 4)].component === null &&
    amountCompare(state.run.credits, 40) >= 0
  ) {
    state = applyAction(state, { type: "placeComponent", index: at(1, 4), kind: "cache" });
    // Re-draw the arrows: core → S, (2,4) → W into the cache, cache → S,
    // (1,5) → E, (2,5) → S into the port.
    const dirs: [number, Dir][] = [
      [at(2, 4), "W"],
      [at(1, 4), "S"],
      [at(1, 5), "E"],
      [at(2, 5), "S"],
    ];
    for (const [index, dir] of dirs) {
      for (let guard = 0; guard < 4; guard += 1) {
        if (state.run.board.sockets[index].dir === dir) break;
        state = applyAction(state, { type: "rotateSocket", index });
      }
    }
  }
  return state;
};

describe("scripted bots (one seed, gen 1)", () => {
  const sprint = runBot({ tapsPerSecond: 0.85 });
  const snake = runBot({ tapsPerSecond: 0.85, build: snakeBuild });

  it("both crash inside 12–25 minutes of sim-time", () => {
    expect(sprint.uptimeMinutes).toBeGreaterThanOrEqual(12);
    expect(sprint.uptimeMinutes).toBeLessThanOrEqual(25);
    expect(snake.uptimeMinutes).toBeGreaterThanOrEqual(12);
    expect(snake.uptimeMinutes).toBeLessThanOrEqual(25);
  });

  it("uptime diverges by at least 30% between policies", () => {
    const longer = Math.max(sprint.uptimeMinutes, snake.uptimeMinutes);
    const shorter = Math.min(sprint.uptimeMinutes, snake.uptimeMinutes);
    expect((longer - shorter) / longer).toBeGreaterThanOrEqual(0.3);
  });

  it("both completed work and earned silicon", () => {
    expect(sprint.tasksDone).toBeGreaterThan(50);
    expect(snake.tasksDone).toBeGreaterThan(50);
    expect(sprint.silicon).toBeGreaterThanOrEqual(2);
    expect(snake.silicon).toBeGreaterThanOrEqual(2);
    // eslint-disable-next-line no-console
    console.log(
      `[bots] sprint: crash ${sprint.uptimeMinutes.toFixed(1)} min, ${sprint.tasksDone} tasks, +${sprint.silicon} Si | ` +
        `snake: crash ${snake.uptimeMinutes.toFixed(1)} min, ${snake.tasksDone} tasks, +${snake.silicon} Si`,
    );
  });
});
