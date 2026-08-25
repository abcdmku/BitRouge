import {
  amount,
  amountAdd,
  amountFloor,
  amountDivide,
  amountMultiply,
  type Amount,
} from "./amount";
import {
  getPortIndices,
  hasArchPerk,
  maskAdd,
  maskHas,
  stepIndex,
} from "./board";
import {
  AMBIENT_COOLING_PER_S,
  COOLER_AURA_PER_S,
  creditAmount,
  DIFFUSION_COEFFICIENT,
  DROPPED_TASK_DAMAGE,
  EVENT_RING_SIZE,
  EXPIRED_PRIORITY_DAMAGE,
  FAULT_ROLL_HEAT,
  FAULT_SPREAD_DAMAGE,
  FAULT_SPREAD_INTERVAL_MS,
  getArrivalIntervalMs,
  getBacklogCap,
  getCacheMultiplier,
  getCoreMultiplier,
  getDuty,
  getEffectiveTickMs,
  getGenerationW,
  getGpuMultiplier,
  getMaxIntegrity,
  getPowerDrawW,
  getReserveMaxJ,
  getTaskValue,
  hasFirmware,
  HEAT_PIPES_AMBIENT_MULTIPLIER,
  HOP_LIMIT_HEAT,
  LIVE_PACKET_CAP,
  MANUAL_DELIVERY_MULTIPLIER,
  OFFLINE_CAP_MS,
  OFFLINE_INTEGRITY_FLOOR,
  OVERHEAT_DAMAGE_PER_S,
  OVERHEAT_HEAT,
  PACKET_HOP_LIMIT,
  PATCH_HEAT,
  PRIORITY_DEADLINE_MS,
  REGEN_BACKLOG_LIMIT,
  REGEN_PER_S,
  rollTaskKind,
  componentDefinitions,
  THROTTLE_HEAT,
  WATCHDOG_PATCH_MS,
} from "./economy";
import { nextRngFloat, nextRngInt } from "./rng";
import {
  MAX_ADVANCE_STEP_MS,
  nonNegativeElapsed,
  normalizeAdvanceTimeMs,
  selectPositiveAdvanceStepMs,
} from "./timeGrid";
import type {
  AdvanceMode,
  AdvanceReport,
  AdvanceResult,
  DamageSource,
  FxEvent,
  GameState,
  PacketState,
  RunState,
  TaskState,
} from "./types";

export { MAX_ADVANCE_STEP_MS, normalizeAdvanceTimeMs, selectPositiveAdvanceStepMs } from "./timeGrid";
export { getEffectiveTickMs, OFFLINE_CAP_MS } from "./economy";

// ============================================================================
// Event-stepped, delta-invariant board simulation on the time grid. The only
// discrete event class is the tick boundary; per tick the fixed §3 order runs:
// arrivals → packet moves (oldest first) → core pulls (ascending) → heat →
// fault rolls → payouts/integrity. All rng draws happen inside ticks, in a
// fixed phase/index order, so advance(200) ≡ advance(100)∘advance(100).
// ============================================================================

export const isCrashed = (state: GameState) => state.run.integrity <= 0;

/** Time until the next tick boundary; Infinity when the run is crashed. */
export const getNextEventMs = (state: GameState): number => {
  if (isCrashed(state)) return Number.POSITIVE_INFINITY;
  const tickMs = getEffectiveTickMs(state.run.system.clockLevel);
  return normalizeAdvanceTimeMs(Math.max(0, tickMs - state.run.tickAccumMs));
};

// ---- draft cloning ----------------------------------------------------------

/** Deep-enough clone: every mutable object is copied so the input state is never touched. */
export const cloneGameState = (state: GameState): GameState => ({
  ...state,
  rng: { ...state.rng, state: [...state.rng.state] },
  meta: { ...state.meta, architecture: [...state.meta.architecture] },
  run: {
    ...state.run,
    backlog: state.run.backlog.map((task) => ({ ...task })),
    board: {
      ...state.run.board,
      sockets: state.run.board.sockets.map((socket) => ({
        ...socket,
        component: socket.component ? { ...socket.component } : null,
      })),
      packets: state.run.board.packets.map((packet) => ({ ...packet })),
    },
    system: { ...state.run.system, firmware: [...state.run.system.firmware] },
    damageLog: { ...state.run.damageLog },
    events: [...state.run.events],
  },
});

// ---- events -----------------------------------------------------------------

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type FxEventInput = DistributiveOmit<FxEvent, "seq" | "t">;

export const pushEvent = (run: RunState, event: FxEventInput) => {
  run.events.push({ ...event, seq: run.nextEventSeq, t: run.uptimeMs } as FxEvent);
  run.nextEventSeq += 1;
  if (run.events.length > EVENT_RING_SIZE) {
    run.events.splice(0, run.events.length - EVENT_RING_SIZE);
  }
};

// ---- damage -----------------------------------------------------------------

/** Applies integrity damage; offline damage floors at 25 (never below the current value). */
const applyDamage = (
  state: GameState,
  mode: AdvanceMode,
  source: DamageSource,
  rawAmount: number,
) => {
  const run = state.run;
  const floor =
    mode === "offline" ? Math.min(OFFLINE_INTEGRITY_FLOOR, run.integrity) : 0;
  const next = Math.max(run.integrity - rawAmount, floor);
  const applied = run.integrity - next;
  if (applied <= 0) return;
  run.integrity = next;
  run.damageLog[source] += applied;
};

// ---- shared packet mechanics ------------------------------------------------

interface DeliveryTally {
  tasksDone: number;
  credits: Amount;
  data: Amount;
}

export const createDeliveryTally = (): DeliveryTally => ({
  tasksDone: 0,
  credits: amount(0),
  data: amount(0),
});

const addSocketHeat = (run: RunState, index: number, heat: number) => {
  const socket = run.board.sockets[index];
  socket.heat = Math.min(OVERHEAT_HEAT, Math.max(0, socket.heat + heat));
};

const packetPassedProcessing = (run: RunState, packet: PacketState) => {
  const sockets = run.board.sockets;
  for (let i = 0; i < sockets.length; i += 1) {
    const kind = sockets[i].component?.kind;
    if ((kind === "cache" || kind === "gpu") && maskHas(packet.visitedMask, i)) return true;
  }
  return false;
};

/** Heat multiplier: HOT tasks double heat per pass; manual work halves it. */
const heatScale = (packet: PacketState, manual: boolean) =>
  (packet.taskKind === "hot" ? 2 : 1) * (manual ? 0.5 : 1);

interface MoveOutcome {
  moved: boolean;
  /** Packet left the board (delivered, mined, or raw-crunch dropped). */
  removed: boolean;
}

/**
 * Attempt one hop for `packet` along its socket's arrow. `occupied` maps
 * socket index → packet id for every resting packet (ports never appear).
 */
const tryHopPacket = (
  state: GameState,
  mode: AdvanceMode,
  packet: PacketState,
  occupied: Map<number, number>,
  ports: readonly number[],
  tally: DeliveryTally,
  manual: boolean,
): MoveOutcome => {
  const run = state.run;
  const board = run.board;
  const from = packet.socketIndex;
  const target = stepIndex(from, board.sockets[from].dir, board.width, board.height);
  if (target < 0) return { moved: false, removed: false };

  // Terminal: PORT delivery.
  if (ports.includes(target)) {
    occupied.delete(from);
    removeFromBoard(board, packet);
    if (packet.taskKind === "crunch" && !packetPassedProcessing(run, packet)) {
      applyDamage(state, mode, "rawCrunch", DROPPED_TASK_DAMAGE);
      pushEvent(run, { kind: "taskDropped", id: packet.id, taskKind: packet.taskKind, reason: "rawCrunch" });
      return { moved: true, removed: true };
    }
    const paid = manual
      ? amountMultiply(packet.value, MANUAL_DELIVERY_MULTIPLIER)
      : packet.value;
    run.credits = amountAdd(run.credits, paid);
    tally.credits = amountAdd(tally.credits, paid);
    completeTask(state, tally);
    pushEvent(run, {
      kind: "packetDelivered",
      id: packet.id,
      socketIndex: target,
      valueLabel: paid as string,
      manual,
    });
    return { moved: true, removed: true };
  }

  const targetSocket = board.sockets[target];
  if (!targetSocket.unlocked) return { moved: false, removed: false };
  if (targetSocket.component?.faulted) return { moved: false, removed: false };

  const component = targetSocket.component;
  const active = component !== null && component.powered && !component.faulted;

  // Terminal: MINER consumes the packet on entry.
  if (component && component.kind === "miner" && active) {
    occupied.delete(from);
    removeFromBoard(board, packet);
    addSocketHeat(run, target, componentDefinitions.miner.heatPerAction * heatScale(packet, manual));
    if (packet.taskKind === "crunch" && !packetPassedProcessing(run, packet)) {
      applyDamage(state, mode, "rawCrunch", DROPPED_TASK_DAMAGE);
      pushEvent(run, { kind: "taskDropped", id: packet.id, taskKind: packet.taskKind, reason: "rawCrunch" });
      return { moved: true, removed: true };
    }
    const value = manual
      ? amountMultiply(packet.value, MANUAL_DELIVERY_MULTIPLIER)
      : packet.value;
    const mined = amountFloor(amountDivide(value, 4));
    run.data = amountAdd(run.data, mined);
    tally.data = amountAdd(tally.data, mined);
    completeTask(state, tally);
    pushEvent(run, {
      kind: "packetDelivered",
      id: packet.id,
      socketIndex: target,
      valueLabel: mined as string,
      manual,
    });
    return { moved: true, removed: true };
  }

  if (occupied.has(target)) return { moved: false, removed: false };

  // Regular hop.
  occupied.delete(from);
  packet.socketIndex = target;
  occupied.set(target, packet.id);
  if (!manual) packet.hops += 1; // manual carries are hop-cap-free

  if (component && active && (component.kind === "cache" || component.kind === "gpu")) {
    addSocketHeat(
      run,
      target,
      componentDefinitions[component.kind].heatPerAction * heatScale(packet, manual),
    );
    if (!maskHas(packet.visitedMask, target)) {
      const multiplier =
        component.kind === "cache"
          ? getCacheMultiplier(component.level)
          : getGpuMultiplier(component.level);
      packet.value = creditAmount(Number(amountMultiply(packet.value, multiplier)));
      packet.visitedMask = maskAdd(packet.visitedMask, target);
    }
  }

  pushEvent(run, { kind: "packetMoved", id: packet.id, from, to: target, manual });

  // Loop punishment: automated packets drop after 32 hops (+10 heat).
  if (!manual && packet.hops >= PACKET_HOP_LIMIT) {
    occupied.delete(packet.socketIndex);
    removeFromBoard(board, packet);
    addSocketHeat(run, packet.socketIndex, HOP_LIMIT_HEAT);
    pushEvent(run, { kind: "packetDropped", id: packet.id, socketIndex: packet.socketIndex, reason: "hopLimit" });
    return { moved: true, removed: true };
  }
  return { moved: true, removed: false };
};

const removeFromBoard = (board: RunState["board"], packet: PacketState) => {
  const index = board.packets.indexOf(packet);
  if (index >= 0) board.packets.splice(index, 1);
};

const completeTask = (state: GameState, tally: DeliveryTally) => {
  state.run.tasksDone += 1;
  state.meta.totalTasks += 1;
  tally.tasksDone += 1;
};

/** Pick the backlog slot a core pulls: FIFO, or PRIORITY-first with QoS firmware. */
const pickBacklogIndex = (run: RunState) => {
  if (run.backlog.length === 0) return -1;
  if (hasFirmware(run, "qos")) {
    for (let i = 0; i < run.backlog.length; i += 1) {
      if (run.backlog[i].kind === "priority") return i;
    }
  }
  return 0;
};

/** Pull a task into an emitted packet on the core's socket. Shared by tick and manual WORK. */
const emitFromCore = (
  state: GameState,
  coreIndex: number,
  backlogIndex: number,
  manual: boolean,
): PacketState => {
  const run = state.run;
  const board = run.board;
  const component = board.sockets[coreIndex].component;
  const level = component ? component.level : 1;
  const task = run.backlog.splice(backlogIndex, 1)[0];
  const packet: PacketState = {
    id: board.nextId,
    taskKind: task.kind,
    socketIndex: coreIndex,
    value: creditAmount(Number(amountMultiply(task.value, getCoreMultiplier(level)))),
    visitedMask: 0,
    hops: 0,
  };
  board.nextId += 1;
  board.packets.push(packet);
  const hotScale = task.kind === "hot" ? 2 : 1;
  addSocketHeat(
    run,
    coreIndex,
    componentDefinitions.core.heatPerAction * hotScale * (manual ? 0.5 : 1),
  );
  pushEvent(run, { kind: "packetMoved", id: packet.id, from: null, to: coreIndex, manual });
  return packet;
};

// ---- manual WORK (zero power, always available) -----------------------------

/**
 * Resolve a WORK tap on `index`: patch a fault, else hop the packet resting
 * there, else hand-pull a task into a ready core. Mutates the draft; returns
 * whether anything happened.
 */
export const applyManualWork = (state: GameState, index: number): boolean => {
  const run = state.run;
  const board = run.board;
  if (index < 0 || index >= board.sockets.length) return false;
  const socket = board.sockets[index];
  if (!socket.unlocked) return false;

  // 1) Patch a fault: heat -> 50.
  if (socket.component?.faulted) {
    socket.component.faulted = false;
    socket.component.faultAgeMs = 0;
    socket.heat = PATCH_HEAT;
    pushEvent(run, { kind: "faultPatched", index, manual: true });
    pushEvent(run, { kind: "workTap", index });
    return true;
  }

  const ports = getPortIndices(board.width, board.height, hasArchPerk(state.meta.architecture, "eastPort"));
  const occupied = new Map<number, number>();
  for (const packet of board.packets) occupied.set(packet.socketIndex, packet.id);

  // 2) Advance the packet resting here one hop, instantly.
  const resting = board.packets.find((packet) => packet.socketIndex === index) ?? null;
  if (resting) {
    const tally = createDeliveryTally();
    const outcome = tryHopPacket(state, "foreground", resting, occupied, ports, tally, true);
    if (outcome.moved) pushEvent(run, { kind: "workTap", index });
    return outcome.moved;
  }

  // 3) Hand-pull: a ready core with a backlog task (live-packet cap-free).
  const component = socket.component;
  if (component && component.kind === "core" && !component.faulted) {
    const backlogIndex = pickBacklogIndex(run);
    if (backlogIndex < 0) return false;
    emitFromCore(state, index, backlogIndex, true);
    pushEvent(run, { kind: "workTap", index });
    return true;
  }
  return false;
};

// ---- the tick ---------------------------------------------------------------

interface AdvanceTally extends DeliveryTally {
  dutyMs: number;
  tickMs: number;
  ticks: number;
}

const drawFloat = (state: GameState) => {
  const next = nextRngFloat(state.rng);
  state.rng = next.state;
  return next.value;
};

const drawInt = (state: GameState, min: number, maxExclusive: number) => {
  const next = nextRngInt(state.rng, min, maxExclusive);
  state.rng = next.state;
  return next.value;
};

const MAX_ARRIVALS_PER_TICK = 64;

const runTick = (
  state: GameState,
  tickMs: number,
  mode: AdvanceMode,
  frozenUptimeMs: number | null,
  tally: AdvanceTally,
) => {
  const run = state.run;
  const board = run.board;
  const meta = state.meta;
  const tickSec = tickMs / 1000;
  const escalationUptimeMs = frozenUptimeMs ?? run.uptimeMs;
  const ports = getPortIndices(board.width, board.height, hasArchPerk(meta.architecture, "eastPort"));

  // -- power / duty at tick start --------------------------------------------
  const draw = getPowerDrawW(run);
  const generation = getGenerationW(run.system.railLevel, meta.architecture);
  const brownedBefore = run.system.reserveJ <= 1e-9 && draw > generation;
  const duty = getDuty(run, meta);
  tally.dutyMs += duty * tickMs;
  tally.tickMs += tickMs;
  tally.ticks += 1;
  let automationActive = duty >= 1;
  if (!automationActive && duty > 0) automationActive = drawFloat(state) < duty;

  // -- (1) task arrivals ------------------------------------------------------
  run.arrivalAccumMs += tickMs;
  const backlogCap = getBacklogCap(meta.architecture);
  for (let spawned = 0; spawned < MAX_ARRIVALS_PER_TICK; spawned += 1) {
    const interval = getArrivalIntervalMs(escalationUptimeMs, meta.gen);
    if (run.arrivalAccumMs < interval) break;
    run.arrivalAccumMs -= interval;
    const kind = rollTaskKind(meta.gen, drawFloat(state));
    const task: TaskState = {
      id: board.nextId,
      kind,
      value: getTaskValue(escalationUptimeMs, kind, meta.architecture),
      deadlineMs: kind === "priority" ? run.uptimeMs + PRIORITY_DEADLINE_MS : null,
    };
    board.nextId += 1;
    if (run.backlog.length >= backlogCap) {
      applyDamage(state, mode, "backlogOverflow", DROPPED_TASK_DAMAGE);
      pushEvent(run, { kind: "taskDropped", id: task.id, taskKind: kind, reason: "backlogFull" });
    } else {
      run.backlog.push(task);
      pushEvent(run, { kind: "taskArrived", id: task.id, taskKind: kind });
    }
  }

  // -- (2) packet moves, oldest first ----------------------------------------
  if (automationActive) {
    const occupied = new Map<number, number>();
    for (const packet of board.packets) occupied.set(packet.socketIndex, packet.id);
    const snapshot = [...board.packets];
    for (const packet of snapshot) {
      if (board.sockets[packet.socketIndex].heat >= THROTTLE_HEAT) {
        if (drawFloat(state) >= 0.5) continue; // throttled: half rate
      }
      tryHopPacket(state, mode, packet, occupied, ports, tally, false);
    }
  }

  // -- (3) core pulls, socket index ascending --------------------------------
  if (automationActive) {
    const occupiedNow = new Set<number>();
    for (const packet of board.packets) occupiedNow.add(packet.socketIndex);
    for (let i = 0; i < board.sockets.length; i += 1) {
      const component = board.sockets[i].component;
      if (!component || component.kind !== "core") continue;
      if (!component.powered || component.faulted) continue;
      if (occupiedNow.has(i)) continue;
      if (board.packets.length >= LIVE_PACKET_CAP) break;
      if (run.backlog.length === 0) break;
      if (board.sockets[i].heat >= THROTTLE_HEAT) {
        if (drawFloat(state) >= 0.5) continue; // throttled core: half rate
      }
      const backlogIndex = pickBacklogIndex(run);
      if (backlogIndex < 0) break;
      const packet = emitFromCore(state, i, backlogIndex, false);
      occupiedNow.add(packet.socketIndex);
    }
  }

  // -- (4) heat ---------------------------------------------------------------
  const width = board.width;
  const height = board.height;
  const sockets = board.sockets;
  const ambient =
    AMBIENT_COOLING_PER_S * (hasFirmware(run, "heatPipes") ? HEAT_PIPES_AMBIENT_MULTIPLIER : 1);
  const nextHeat = new Array<number>(sockets.length);
  let overheatedCount = 0;
  for (let i = 0; i < sockets.length; i += 1) {
    const self = sockets[i].heat;
    if (self >= OVERHEAT_HEAT) overheatedCount += 1;
    let diffusion = 0;
    const x = i % width;
    const y = (i - x) / width;
    if (y > 0) diffusion += sockets[i - width].heat - self;
    if (y < height - 1) diffusion += sockets[i + width].heat - self;
    if (x > 0) diffusion += sockets[i - 1].heat - self;
    if (x < width - 1) diffusion += sockets[i + 1].heat - self;
    nextHeat[i] = self + tickSec * (-ambient + DIFFUSION_COEFFICIENT * diffusion);
  }
  for (let i = 0; i < sockets.length; i += 1) {
    const component = sockets[i].component;
    if (!component || component.kind !== "cooler") continue;
    if (!component.powered || component.faulted) continue;
    nextHeat[i] -= COOLER_AURA_PER_S * tickSec;
    const x = i % width;
    const y = (i - x) / width;
    if (y > 0) nextHeat[i - width] -= COOLER_AURA_PER_S * tickSec;
    if (y < height - 1) nextHeat[i + width] -= COOLER_AURA_PER_S * tickSec;
    if (x > 0) nextHeat[i - 1] -= COOLER_AURA_PER_S * tickSec;
    if (x < width - 1) nextHeat[i + 1] -= COOLER_AURA_PER_S * tickSec;
  }
  for (let i = 0; i < sockets.length; i += 1) {
    const before = sockets[i].heat;
    const after = Math.min(OVERHEAT_HEAT, Math.max(0, nextHeat[i]));
    sockets[i].heat = after;
    const wasThrottled = before >= THROTTLE_HEAT;
    const isThrottled = after >= THROTTLE_HEAT;
    if (wasThrottled !== isThrottled) {
      pushEvent(run, { kind: "throttle", index: i, on: isThrottled });
    }
  }

  // -- (5) fault rolls, spread, watchdog -------------------------------------
  for (let i = 0; i < sockets.length; i += 1) {
    const component = sockets[i].component;
    if (!component || component.faulted) continue;
    if (sockets[i].heat < FAULT_ROLL_HEAT) continue;
    const probability = 0.02 * ((sockets[i].heat - FAULT_ROLL_HEAT) / 10) * tickSec;
    if (drawFloat(state) < probability) {
      component.faulted = true;
      component.faultAgeMs = 0;
      pushEvent(run, { kind: "faultSpawned", index: i });
    }
  }
  const faultedAtPhaseStart: number[] = [];
  for (let i = 0; i < sockets.length; i += 1) {
    const component = sockets[i].component;
    if (component?.faulted && component.faultAgeMs > 0) faultedAtPhaseStart.push(i);
    else if (component?.faulted && component.faultAgeMs === 0) {
      // Newly faulted this tick: start aging next tick.
      component.faultAgeMs = Number.MIN_VALUE;
    }
  }
  const watchdogOwned = hasFirmware(run, "watchdog");
  for (const i of faultedAtPhaseStart) {
    const component = sockets[i].component;
    if (!component || !component.faulted) continue;
    const before = component.faultAgeMs;
    component.faultAgeMs = before + tickMs;
    const crossedSpread =
      Math.floor(component.faultAgeMs / FAULT_SPREAD_INTERVAL_MS) >
      Math.floor(before / FAULT_SPREAD_INTERVAL_MS);
    if (crossedSpread) {
      const targets: number[] = [];
      const x = i % width;
      const y = (i - x) / width;
      const candidates = [
        y > 0 ? i - width : -1,
        x < width - 1 ? i + 1 : -1,
        y < height - 1 ? i + width : -1,
        x > 0 ? i - 1 : -1,
      ];
      for (const candidate of candidates) {
        const neighbor = candidate >= 0 ? sockets[candidate].component : null;
        if (neighbor && !neighbor.faulted) targets.push(candidate);
      }
      if (targets.length > 0) {
        const target = targets[targets.length === 1 ? 0 : drawInt(state, 0, targets.length)];
        const victim = sockets[target].component;
        if (victim) {
          victim.faulted = true;
          victim.faultAgeMs = Number.MIN_VALUE;
          applyDamage(state, mode, "faultSpread", FAULT_SPREAD_DAMAGE);
          pushEvent(run, { kind: "faultSpread", from: i, to: target });
        }
      }
    }
    if (watchdogOwned && component.faulted && component.faultAgeMs >= WATCHDOG_PATCH_MS) {
      component.faulted = false;
      component.faultAgeMs = 0;
      sockets[i].heat = PATCH_HEAT;
      pushEvent(run, { kind: "faultPatched", index: i, manual: false });
    }
  }

  // -- (6) payouts and integrity ---------------------------------------------
  if (overheatedCount > 0) {
    applyDamage(state, mode, "overheat", OVERHEAT_DAMAGE_PER_S * overheatedCount * tickSec);
  }
  for (let i = run.backlog.length - 1; i >= 0; i -= 1) {
    const task = run.backlog[i];
    if (task.deadlineMs !== null && task.deadlineMs < run.uptimeMs) {
      run.backlog.splice(i, 1);
      applyDamage(state, mode, "priorityExpired", EXPIRED_PRIORITY_DAMAGE);
      pushEvent(run, { kind: "taskDropped", id: task.id, taskKind: task.kind, reason: "expired" });
    }
  }
  const anyFault = sockets.some((socket) => socket.component?.faulted === true);
  if (run.backlog.length < REGEN_BACKLOG_LIMIT && !anyFault && run.integrity > 0) {
    run.integrity = Math.min(getMaxIntegrity(meta.architecture), run.integrity + REGEN_PER_S * tickSec);
  }
  const reserveMax = getReserveMaxJ(run.system.capacitorLevel, meta.architecture);
  run.system.reserveJ = Math.min(
    reserveMax,
    Math.max(0, run.system.reserveJ + (generation - draw) * tickSec),
  );
  const brownedAfter = run.system.reserveJ <= 1e-9 && draw > generation;
  if (brownedAfter !== brownedBefore) {
    pushEvent(run, { kind: "brownout", on: brownedAfter });
  }
  if (mode !== "offline" && run.integrity <= 0) {
    run.integrity = 0;
    pushEvent(run, { kind: "crash" });
  }
};

// ---- advance ---------------------------------------------------------------

const emptyReport = (mode: AdvanceMode, awayMs: number, state: GameState): AdvanceReport => ({
  mode,
  awayMs,
  simulatedMs: 0,
  tasksDone: 0,
  dutyAvg: 0,
  creditsEarned: amount(0),
  dataEarned: amount(0),
  backlogNow: state.run.backlog.length,
  integrityNow: state.run.integrity,
  hadActivity: false,
});

/**
 * Advance the simulation by `elapsedMs`. Foreground advances the run clock;
 * offline runs powered automation only with the escalation clock frozen at the
 * departure rate, integrity floored at 25, and a 12 h cap.
 */
export const advanceGame = (
  input: GameState,
  elapsedMs: number,
  mode: AdvanceMode,
): AdvanceResult => {
  const requestedMs = normalizeAdvanceTimeMs(nonNegativeElapsed(elapsedMs));
  const budgetMs =
    mode === "offline" ? normalizeAdvanceTimeMs(Math.min(requestedMs, OFFLINE_CAP_MS)) : requestedMs;
  if (budgetMs <= 0 || isCrashed(input)) {
    return { state: input, report: emptyReport(mode, requestedMs, input) };
  }

  const state = cloneGameState(input);
  const run = state.run;
  // Freezing the run clock offline freezes escalation and task value at the
  // departure rate, and keeps piecewise offline advances self-consistent.
  const frozenUptimeMs = mode === "offline" ? run.uptimeMs : null;
  const tally: AdvanceTally = {
    ...createDeliveryTally(),
    dutyMs: 0,
    tickMs: 0,
    ticks: 0,
  };

  let remainingMs = budgetMs;
  let simulatedMs = 0;
  while (remainingMs > 0) {
    if (run.integrity <= 0) break;
    const tickMs = getEffectiveTickMs(run.system.clockLevel);
    const eventMs = normalizeAdvanceTimeMs(Math.max(0, tickMs - run.tickAccumMs));
    const stepMs = selectPositiveAdvanceStepMs(remainingMs, Math.min(eventMs, MAX_ADVANCE_STEP_MS));
    run.tickAccumMs = normalizeAdvanceTimeMs(run.tickAccumMs + stepMs);
    if (mode !== "offline") run.uptimeMs = normalizeAdvanceTimeMs(run.uptimeMs + stepMs);
    remainingMs = normalizeAdvanceTimeMs(remainingMs - stepMs);
    simulatedMs = normalizeAdvanceTimeMs(simulatedMs + stepMs);
    while (run.tickAccumMs >= tickMs) {
      run.tickAccumMs = normalizeAdvanceTimeMs(run.tickAccumMs - tickMs);
      runTick(state, tickMs, mode, frozenUptimeMs, tally);
      if (run.integrity <= 0) break;
    }
  }

  const report: AdvanceReport = {
    mode,
    awayMs: requestedMs,
    simulatedMs,
    tasksDone: tally.tasksDone,
    dutyAvg: tally.tickMs > 0 ? tally.dutyMs / tally.tickMs : 0,
    creditsEarned: tally.credits,
    dataEarned: tally.data,
    backlogNow: run.backlog.length,
    integrityNow: run.integrity,
    hadActivity: simulatedMs > 0 && tally.ticks > 0,
  };
  return { state, report };
};
