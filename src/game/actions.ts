import { updateCampaignProgress } from "./campaign";
import { pushEvent, findEnemyAt } from "./dungeon/draft";
import { isWalkableTile, toIndex } from "./dungeon/grid";
import { findPath } from "./dungeon/path";
import { resolveTurn } from "./dungeon/turn";
import { buyHardware, buyResearch, canAfford, spend } from "./economy";
import { deriveHeroStats } from "./hero";
import { createInitialGameState } from "./initialState";
import { endRun, startRun } from "./run";
import type { GameAction, GameState, HeroAction, RunState } from "./types";
import {
  getNextWatchdogDefinition,
  getWatchdogBlockedReason,
  recordDeparture,
  recordSave,
} from "./watchdog";

const withControl = (run: RunState, control: "auto" | "manual"): RunState => {
  if (run.control === control) return run;
  const next: RunState = { ...run, control, events: [...run.events], pendingPath: null, autoPath: null };
  pushEvent(next, { kind: "controlChanged", control });
  return next;
};

const manualTurn = (state: GameState, action: HeroAction): GameState => {
  const run = state.run;
  if (!run || run.status !== "active" || run.control !== "manual") return state;
  const stats = deriveHeroStats(state.hub);
  const next = resolveTurn({ ...run, pendingPath: null }, action, stats);
  if (next.status === "dead") return endRun({ ...state, run: next }, next.deathCause ?? "Unknown fault");
  return { ...state, run: next };
};

const pathTo = (state: GameState, x: number, y: number): GameState => {
  const run = state.run;
  if (!run || run.status !== "active") return state;
  const manual = withControl(run, "manual");
  const floor = manual.floor;
  const goal = toIndex(Math.trunc(x), Math.trunc(y), floor.width);
  if (!floor.explored[goal] || !isWalkableTile(floor.tiles[goal] ?? null)) {
    return { ...state, run: { ...manual, pendingPath: null } };
  }
  const passable = (index: number) => {
    if (!floor.explored[index] || !isWalkableTile(floor.tiles[index] ?? null)) return false;
    const px = index % floor.width;
    const py = (index - px) / floor.width;
    return !findEnemyAt(manual, px, py);
  };
  const path = findPath(floor, manual.hero, { x: Math.trunc(x), y: Math.trunc(y) }, passable);
  return { ...state, run: { ...manual, pendingPath: path && path.length > 0 ? path : null } };
};

const purchaseWatchdog = (state: GameState): GameState => {
  const next = getNextWatchdogDefinition(state);
  if (!next || getWatchdogBlockedReason(state, next)) return state;
  const price = { credits: next.costCredits, data: next.costData };
  if (!canAfford(state.hub, price)) return state;
  return {
    ...state,
    hub: spend(state.hub, price),
    watchdog: { ...state.watchdog, ownedLevelId: next.id },
  };
};

const applyActionInner = (state: GameState, action: GameAction): GameState => {
  switch (action.type) {
    case "buyHardware":
      return { ...state, hub: buyHardware(state.hub, action.kind) };
    case "buyResearch":
      return { ...state, hub: buyResearch(state.hub, action.id) };
    case "purchaseWatchdog":
      return purchaseWatchdog(state);
    case "deploy":
      return startRun(state);
    case "abortRun":
      return state.run ? endRun(state, "Aborted", true) : state;
    case "takeControl":
      return state.run ? { ...state, run: withControl(state.run, "manual") } : state;
    case "releaseControl":
      return state.run ? { ...state, run: withControl(state.run, "auto") } : state;
    case "heroMove":
      return manualTurn(state, { type: "move", dir: action.dir });
    case "heroWait":
      return manualTurn(state, { type: "wait" });
    case "useItem":
      return manualTurn(state, { type: "useItem", slot: action.slot });
    case "descend":
      return manualTurn(state, { type: "descend" });
    case "interact":
      return manualTurn(state, { type: "interact" });
    case "overclock":
      return manualTurn(state, { type: "overclock" });
    case "heroPathTo":
      return pathTo(state, action.x, action.y);
    case "recordSave":
      return recordSave(state, action.timestampMs);
    case "recordDeparture":
      return recordDeparture(state, action.timestampMs);
    case "reset":
      return createInitialGameState(action.seed);
    default:
      return state;
  }
};

/** Every action is followed by a campaign sweep; no-ops keep the same reference. */
export const applyAction = (state: GameState, action: GameAction): GameState =>
  updateCampaignProgress(applyActionInner(state, action));
