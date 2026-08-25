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
import {
  canAdvanceClock,
  researchDefinitions,
  researchRequirementsMet,
} from "./research";
import { toIndex } from "./board";
import type { ArchPerkId, ComponentKind, GameAction, GameState, ResearchId } from "./types";

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
    case "pulseSystem":
      return pulseSystem(state);
    case "ventSystem": {
      if (state.run.ventCooldownMs > 0) return state;
      const draft = cloneGameState(state);
      for (const socket of draft.run.board.sockets) {
        socket.heat = Math.max(0, socket.heat - 25);
      }
      draft.run.ventCooldownMs = 8_000;
      return draft;
    }
    case "shedLoad": {
      if (state.run.backlog.length === 0) return state;
      const draft = cloneGameState(state);
      draft.run.backlog.splice(0, Math.min(3, draft.run.backlog.length));
      return draft;
    }
    case "installComponent":
      return installComponent(state, action.kind);
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
      if (action.item === "clock" && !canAdvanceClock(state)) return state;
      if (!canAfford(state.run.credits, cost)) return state;
      const draft = cloneGameState(state);
      draft.run.credits = amountSubtract(draft.run.credits, cost);
      if (action.item === "rail") {
        const wasUnpowered = draft.run.system.railLevel === 0;
        draft.run.system.railLevel += 1;
        if (wasUnpowered) {
          for (const socket of draft.run.board.sockets) {
            if (socket.component) socket.component.powered = true;
          }
        }
      }
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
    case "startResearch":
      return startResearch(state, action.id);
    default:
      return state;
  }
};

const pulseSystem = (state: GameState): GameState => {
  const board = state.run.board;
  const faultIndex = board.sockets.findIndex((socket) => socket.component?.faulted === true);
  if (faultIndex >= 0) {
    const repaired = cloneGameState(state);
    return applyManualWork(repaired, faultIndex) ? repaired : state;
  }

  const draft = cloneGameState(state);
  let packetId: number | null = draft.run.board.packets[0]?.id ?? null;
  const coreIndex = board.sockets.findIndex(
    (socket) => socket.component?.kind === "core" && !socket.component.faulted,
  );
  let changed = false;
  if (packetId === null && coreIndex >= 0) {
    changed = applyManualWork(draft, coreIndex);
    packetId = draft.run.board.packets.at(-1)?.id ?? null;
  }

  // A PROCESS NOW press carries one job through the current route. This keeps
  // the active input meaningful without turning the opening into tap spam.
  for (let step = 0; packetId !== null && step < draft.run.board.sockets.length; step += 1) {
    const packet = draft.run.board.packets.find((candidate) => candidate.id === packetId);
    if (!packet) break;
    const moved = applyManualWork(draft, packet.socketIndex);
    if (!moved) break;
    changed = true;
  }
  return changed ? draft : state;
};

const researchUnlocksComponent = (state: GameState, kind: ComponentKind) => {
  const completed = state.meta.research.completed;
  if (kind === "cache") return completed.includes("cacheMapping");
  if (kind === "miner") return completed.includes("ramControl");
  if (kind === "gpu") return completed.includes("specializedCompute") && state.meta.gen >= 3;
  if (kind === "core") {
    return countComponents(state.run.board, "core") < 1 || completed.includes("multiCore");
  }
  return true;
};

const componentBlueprintIndices = (state: GameState, kind: ComponentKind) => {
  const { width, height } = state.run.board;
  const center = Math.floor(width / 2);
  const cells: Record<ComponentKind, Array<[number, number]>> = {
    core: [[center - 1, height - 3], [center + 1, height - 3], [center - 1, height - 2]],
    cache: [[center, height - 3]],
    miner: [[center, height - 2]],
    cooler: [[center - 1, height - 2], [center - 2, height - 3]],
    gpu: [[center + 1, height - 3]],
  };
  return cells[kind]
    .filter(([x, y]) => x >= 0 && y >= 0 && x < width && y < height)
    .map(([x, y]) => toIndex(x, y, width));
};

const installComponent = (state: GameState, kind: ComponentKind): GameState => {
  if (!researchUnlocksComponent(state, kind)) return state;
  if (!placementGenGate(kind, state.meta.gen)) return state;
  const index = componentBlueprintIndices(state, kind).find(
    (candidate) => state.run.board.sockets[candidate].component === null,
  );
  if (index === undefined) return state;
  const owned = countComponents(state.run.board, kind);
  const cost = getComponentCost(kind, owned);
  if (!canAfford(state.run.credits, cost)) return state;

  const draft = cloneGameState(state);
  draft.run.credits = amountSubtract(draft.run.credits, cost);
  const board = draft.run.board;
  const socket = board.sockets[index];
  socket.unlocked = true;
  socket.component = { kind, level: 1, powered: true, faulted: false, faultAgeMs: 0 };

  const { x } = { x: index % board.width };
  const center = Math.floor(board.width / 2);
  socket.dir = x < center ? "E" : x > center ? "W" : "S";

  if (kind === "gpu") {
    const y = Math.floor(index / board.width);
    const below = toIndex(x, y + 1, board.width);
    if (below < board.sockets.length) {
      board.sockets[toIndex(center, y, board.width)].dir = "E";
      board.sockets[index].dir = "S";
      board.sockets[below].unlocked = true;
      board.sockets[below].dir = "W";
    }
  }

  pushEvent(draft.run, { kind: "chipPlaced", index, component: kind });
  return draft;
};

const startResearch = (state: GameState, id: ResearchId): GameState => {
  if (!(id in researchDefinitions)) return state;
  if (state.meta.research.active !== null) return state;
  if (state.meta.research.completed.includes(id)) return state;
  if (!researchRequirementsMet(state, id)) return state;
  const definition = researchDefinitions[id];
  if (!canAfford(state.run.credits, definition.creditCost)) return state;
  if (!canAfford(state.run.data, definition.dataCost)) return state;
  const draft = cloneGameState(state);
  draft.run.credits = amountSubtract(draft.run.credits, definition.creditCost);
  draft.run.data = amountSubtract(draft.run.data, definition.dataCost);
  draft.meta.research.active = { id, workDone: 0 };
  return draft;
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
 * REFLOW ends the current load test and pays Silicon. Installed hardware,
 * Credits, Data, firmware, and research persist. Heat, faults, queue pressure,
 * and integrity reset for the next run.
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
  const fresh = createFreshRun(meta);
  fresh.credits = run.credits;
  fresh.data = run.data;
  fresh.system = {
    ...run.system,
    railLevel: Math.max(run.system.railLevel, fresh.system.railLevel),
    capacitorLevel: Math.max(run.system.capacitorLevel, fresh.system.capacitorLevel),
    reserveJ: 0,
    firmware: [...run.system.firmware],
  };
  if (fresh.board.width === run.board.width) {
    const rowShift = fresh.board.height - run.board.height;
    for (let index = 0; index < run.board.sockets.length; index += 1) {
      const source = run.board.sockets[index];
      const x = index % run.board.width;
      const y = Math.floor(index / run.board.width) + rowShift;
      if (y < 0 || y >= fresh.board.height) continue;
      const target = fresh.board.sockets[toIndex(x, y, fresh.board.width)];
      if (source.unlocked) {
        target.unlocked = true;
        target.dir = source.dir;
      }
      if (source.component) {
        target.component = {
          ...source.component,
          faulted: false,
          faultAgeMs: 0,
        };
      }
      target.heat = 0;
    }
  }
  return {
    ...state,
    meta,
    run: fresh,
  };
};
