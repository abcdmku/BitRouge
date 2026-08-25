import { amountAdd, amountCompare, amountSubtract, type Amount } from "./amount";
import { applyManualWork, cloneGameState, isCrashed, pushEvent } from "./advance";
import {
  countComponents,
  countUnlockedSockets,
  getPortIndicesFor,
  hasArchPerk,
  rotateDir,
} from "./board";
import {
  archPerkDefinitions,
  componentDefinitions,
  firmwareDefinitions,
  getArchCost,
  getCapacitorCost,
  getClockCost,
  getComponentCost,
  getGenFromArchitecture,
  getRailCost,
  getSellRefund,
  getSiliconPayout,
  getSocketUnlockCost,
  getUpgradeCost,
  VOLUNTARY_REFLOW_MIN_UPTIME_MS,
} from "./economy";
import { createFreshRun, createInitialGameState } from "./initialState";
import type { ArchPerkId, ComponentKind, GameAction, GameState } from "./types";

const canAfford = (balance: Amount, cost: Amount) => amountCompare(balance, cost) >= 0;

const validSocket = (state: GameState, index: number) =>
  Number.isInteger(index) && index >= 0 && index < state.run.board.sockets.length;

/** CACHE tier II (level >= 2) is a gen 2 reward; GPU upgrades ride the same gate. */
const upgradeGenGate = (kind: ComponentKind, level: number, gen: number) =>
  !((kind === "cache" || kind === "gpu") && level >= 1 && gen < 2);

const placementGenGate = (kind: ComponentKind, gen: number) =>
  componentDefinitions[kind].minGen <= gen;

/**
 * Apply a player action. Returns the input state unchanged when the action is
 * invalid or unaffordable. Board-editing actions are ignored while crashed —
 * only `buyArch`, `reflow`, `recordSave`/`recordDeparture` and `reset` work on
 * a dead board.
 */
export const applyAction = (state: GameState, action: GameAction): GameState => {
  switch (action.type) {
    case "recordSave":
      return {
        ...state,
        savedAtMs: Math.max(0, Math.trunc(action.timestampMs)),
        departedAtMs: null,
      };
    case "recordDeparture":
      return { ...state, departedAtMs: Math.max(0, Math.trunc(action.timestampMs)) };
    case "reset":
      return createInitialGameState();
    case "buyArch":
      return buyArch(state, action.id);
    case "reflow":
      return reflow(state);
    default:
      break;
  }

  if (isCrashed(state)) return state;

  switch (action.type) {
    case "workSocket": {
      if (!validSocket(state, action.index)) return state;
      const draft = cloneGameState(state);
      return applyManualWork(draft, action.index) ? draft : state;
    }
    case "rotateSocket": {
      if (!validSocket(state, action.index)) return state;
      const socket = state.run.board.sockets[action.index];
      if (!socket.unlocked) return state;
      if (getPortIndicesFor(state).includes(action.index)) return state;
      const draft = cloneGameState(state);
      const target = draft.run.board.sockets[action.index];
      target.dir = rotateDir(target.dir);
      return draft;
    }
    case "unlockSocket": {
      if (!validSocket(state, action.index)) return state;
      const socket = state.run.board.sockets[action.index];
      if (socket.unlocked) return state;
      const ports = getPortIndicesFor(state);
      const cost = getSocketUnlockCost(countUnlockedSockets(state.run.board, ports));
      if (!canAfford(state.run.credits, cost)) return state;
      const draft = cloneGameState(state);
      draft.run.credits = amountSubtract(draft.run.credits, cost);
      draft.run.board.sockets[action.index].unlocked = true;
      return draft;
    }
    case "placeComponent": {
      if (!validSocket(state, action.index)) return state;
      if (!(action.kind in componentDefinitions)) return state;
      const socket = state.run.board.sockets[action.index];
      if (!socket.unlocked || socket.component !== null) return state;
      if (getPortIndicesFor(state).includes(action.index)) return state;
      if (!placementGenGate(action.kind, state.meta.gen)) return state;
      const owned = countComponents(state.run.board, action.kind);
      const cost = getComponentCost(action.kind, owned);
      if (!canAfford(state.run.credits, cost)) return state;
      const draft = cloneGameState(state);
      draft.run.credits = amountSubtract(draft.run.credits, cost);
      draft.run.board.sockets[action.index].component = {
        kind: action.kind,
        level: 1,
        powered: true,
        faulted: false,
        faultAgeMs: 0,
      };
      pushEvent(draft.run, { kind: "chipPlaced", index: action.index, component: action.kind });
      return draft;
    }
    case "upgradeComponent": {
      if (!validSocket(state, action.index)) return state;
      const component = state.run.board.sockets[action.index].component;
      if (!component || component.faulted) return state;
      if (!upgradeGenGate(component.kind, component.level, state.meta.gen)) return state;
      const cost = getUpgradeCost(component.kind, component.level);
      if (!canAfford(state.run.credits, cost)) return state;
      const draft = cloneGameState(state);
      draft.run.credits = amountSubtract(draft.run.credits, cost);
      const target = draft.run.board.sockets[action.index].component;
      if (target) target.level += 1;
      return draft;
    }
    case "sellComponent": {
      if (!validSocket(state, action.index)) return state;
      const component = state.run.board.sockets[action.index].component;
      if (!component) return state;
      const owned = countComponents(state.run.board, component.kind);
      const refund = getSellRefund(
        component.kind,
        owned,
        component.level,
        state.run.system.firmware.includes("hotSwap"),
      );
      const draft = cloneGameState(state);
      draft.run.credits = amountAdd(draft.run.credits, refund);
      draft.run.board.sockets[action.index].component = null;
      return draft;
    }
    case "togglePower": {
      if (!validSocket(state, action.index)) return state;
      const component = state.run.board.sockets[action.index].component;
      if (!component) return state;
      const draft = cloneGameState(state);
      const target = draft.run.board.sockets[action.index].component;
      if (target) target.powered = !target.powered;
      return draft;
    }
    case "buySystem": {
      const system = state.run.system;
      const cost =
        action.item === "rail"
          ? getRailCost(system.railLevel + 1)
          : action.item === "capacitor"
            ? getCapacitorCost(system.capacitorLevel + 1)
            : getClockCost(system.clockLevel + 1);
      if (!canAfford(state.run.credits, cost)) return state;
      const draft = cloneGameState(state);
      draft.run.credits = amountSubtract(draft.run.credits, cost);
      if (action.item === "rail") draft.run.system.railLevel += 1;
      else if (action.item === "capacitor") draft.run.system.capacitorLevel += 1;
      else draft.run.system.clockLevel += 1;
      return draft;
    }
    case "buyFirmware": {
      if (!(action.id in firmwareDefinitions)) return state;
      if (state.run.system.firmware.includes(action.id)) return state;
      const cost = firmwareDefinitions[action.id].costData;
      if (amountCompare(state.run.data, cost) < 0) return state;
      const draft = cloneGameState(state);
      draft.run.data = amountSubtract(draft.run.data, cost);
      draft.run.system.firmware.push(action.id);
      return draft;
    }
    default:
      return state;
  }
};

const buyArch = (state: GameState, id: ArchPerkId): GameState => {
  const definition = archPerkDefinitions[id as ArchPerkId];
  if (!definition) return state;
  const timesOwned = state.meta.architecture.filter((perk) => perk === id).length;
  if (!definition.repeatable && timesOwned > 0) return state;
  if (definition.requires && !hasArchPerk(state.meta.architecture, definition.requires)) {
    return state;
  }
  const cost = getArchCost(id, timesOwned);
  if (state.meta.silicon < cost) return state;
  const draft = cloneGameState(state);
  draft.meta.silicon -= cost;
  draft.meta.architecture.push(id);
  draft.meta.gen = getGenFromArchitecture(draft.meta.architecture);
  return draft;
};

/**
 * REFLOW: crash-driven (integrity 0) or voluntary after 10 min uptime. Pays
 * Silicon = floor(U^1.8 / 40) + floor(W / 200), then resets the board, credits,
 * data, chips, rails and firmware. Silicon, architecture and stats persist.
 */
const reflow = (state: GameState): GameState => {
  const run = state.run;
  const crashed = run.integrity <= 0;
  if (!crashed && run.uptimeMs < VOLUNTARY_REFLOW_MIN_UPTIME_MS) return state;
  const silicon = getSiliconPayout(run.uptimeMs, run.tasksDone);
  const meta = {
    ...state.meta,
    architecture: [...state.meta.architecture],
    silicon: state.meta.silicon + silicon,
    bestUptimeMs: Math.max(state.meta.bestUptimeMs, run.uptimeMs),
    reflows: state.meta.reflows + 1,
  };
  return {
    ...state,
    meta,
    run: createFreshRun(meta),
  };
};
