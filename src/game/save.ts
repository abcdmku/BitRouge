import { amount, amountClampMin, amountToSafeNumber, type Amount } from "./amount";
import {
  ARCH_PERK_IDS,
  COMPONENT_KINDS,
  DAMAGE_SOURCES,
  DIRS,
  FIRMWARE_IDS,
  RESEARCH_IDS,
  TASK_KINDS,
  type ArchPerkId,
  type ComponentKind,
  type DamageSource,
  type Dir,
  type FirmwareId,
  type FxEvent,
  type GameState,
  type MetaState,
  type PacketState,
  type RunState,
  type ResearchId,
  type SocketState,
  type TaskKind,
  type TaskState,
} from "./types";
import { researchDefinitions } from "./research";
import { EVENT_RING_SIZE, getGenFromArchitecture, getMaxIntegrity } from "./economy";
import {
  BASE_BOARD_HEIGHT,
  BOARD_WIDTH,
  createEmptyDamageLog,
  createFreshRun,
  createInitialGameState,
  createInitialMetaState,
  TALL_BOARD_HEIGHT,
} from "./initialState";
import { normalizeRngState } from "./rng";

export const SAVE_VERSION = 4 as const;

export interface SaveEnvelope {
  version: typeof SAVE_VERSION;
  savedAt: string;
  savedAtMs: number;
  departedAtMs: number | null;
  state: GameState;
}

export interface LoadedSave {
  state: GameState;
  savedAtMs: number | null;
  departedAtMs: number | null;
}

// ---- primitives -------------------------------------------------------------

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const toFiniteNumber = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const toInt = (value: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  Math.min(max, Math.max(min, Math.trunc(toFiniteNumber(value, fallback))));

const toClamped = (value: unknown, fallback: number, min: number, max: number) =>
  Math.min(max, Math.max(min, toFiniteNumber(value, fallback)));

const toNullableNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const toAmount = (value: unknown, fallback: Amount): Amount => {
  if (typeof value !== "string" && typeof value !== "number") return fallback;
  try {
    return amountClampMin(amount(value), 0);
  } catch {
    return fallback;
  }
};

const isOneOf = <T extends string>(value: unknown, options: readonly T[]): value is T =>
  typeof value === "string" && (options as readonly string[]).includes(value);

// ---- envelope ---------------------------------------------------------------

export const createSaveEnvelope = (state: GameState, savedAtMs: number): SaveEnvelope => {
  const normalizedSavedAtMs = Math.max(0, Math.trunc(Number.isFinite(savedAtMs) ? savedAtMs : 0));
  return {
    version: SAVE_VERSION,
    savedAt: new Date(normalizedSavedAtMs).toISOString(),
    savedAtMs: normalizedSavedAtMs,
    departedAtMs: state.departedAtMs,
    state,
  };
};

/** JSON envelope `{ version, savedAt, savedAtMs, departedAtMs, state }`. */
export const serializeSave = (state: GameState, savedAtMs: number) =>
  JSON.stringify(createSaveEnvelope(state, savedAtMs));

// ---- v3 normalization -------------------------------------------------------

const normalizeMeta = (value: unknown): MetaState => {
  const initial = createInitialMetaState();
  if (!isRecord(value)) return initial;
  const architecture: ArchPerkId[] = [];
  if (Array.isArray(value.architecture)) {
    for (const perk of value.architecture) {
      if (!isOneOf(perk, ARCH_PERK_IDS)) continue;
      // Non-repeatable perks collapse to one copy.
      if (perk !== "baseValue20" && architecture.includes(perk)) continue;
      architecture.push(perk);
    }
  }
  const researchSource = isRecord(value.research) ? value.research : {};
  const completed: ResearchId[] = [];
  if (Array.isArray(researchSource.completed)) {
    for (const id of researchSource.completed) {
      if (isOneOf(id, RESEARCH_IDS) && !completed.includes(id)) completed.push(id);
    }
  }
  const activeSource = isRecord(researchSource.active) ? researchSource.active : null;
  const activeId = activeSource && isOneOf(activeSource.id, RESEARCH_IDS)
    ? activeSource.id
    : null;
  return {
    silicon: toInt(value.silicon, 0),
    gen: getGenFromArchitecture(architecture),
    architecture,
    bestUptimeMs: Math.max(0, toFiniteNumber(value.bestUptimeMs, 0)),
    totalTasks: toInt(value.totalTasks, 0),
    reflows: toInt(value.reflows, 0),
    research: {
      completed,
      active:
        activeId && !completed.includes(activeId)
          ? {
              id: activeId,
              workDone: toInt(
                activeSource?.workDone,
                0,
                0,
                researchDefinitions[activeId].workRequired - 1,
              ),
            }
          : null,
    },
  };
};

const normalizeSocket = (value: unknown): SocketState => {
  const fallback: SocketState = { unlocked: false, dir: "S", heat: 0, component: null };
  if (!isRecord(value)) return fallback;
  const componentSource = isRecord(value.component) ? value.component : null;
  const kind: ComponentKind | null =
    componentSource && isOneOf(componentSource.kind, COMPONENT_KINDS)
      ? componentSource.kind
      : null;
  return {
    unlocked: value.unlocked === true,
    dir: isOneOf(value.dir, DIRS) ? (value.dir as Dir) : "S",
    heat: toClamped(value.heat, 0, 0, 100),
    component:
      componentSource && kind
        ? {
            kind,
            level: toInt(componentSource.level, 1, 1, 999),
            powered: componentSource.powered !== false,
            faulted: componentSource.faulted === true,
            faultAgeMs: Math.max(0, toFiniteNumber(componentSource.faultAgeMs, 0)),
          }
        : null,
  };
};

const normalizeTask = (value: unknown): TaskState | null => {
  if (!isRecord(value)) return null;
  const kind: TaskKind = isOneOf(value.kind, TASK_KINDS) ? value.kind : "bulk";
  return {
    id: toInt(value.id, 0),
    kind,
    value: toAmount(value.value, amount(1)),
    deadlineMs: toNullableNumber(value.deadlineMs),
  };
};

const normalizeEvents = (value: unknown): FxEvent[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (event): event is FxEvent =>
        isRecord(event) &&
        typeof event.kind === "string" &&
        typeof event.seq === "number" &&
        Number.isFinite(event.seq) &&
        typeof event.t === "number",
    )
    .slice(-EVENT_RING_SIZE);
};

const normalizeRun = (value: unknown, meta: MetaState): RunState => {
  const fresh = createFreshRun(meta);
  if (!isRecord(value)) return fresh;
  const boardSource = isRecord(value.board) ? value.board : null;
  if (!boardSource) return fresh;

  const width = toInt(boardSource.width, BOARD_WIDTH, 1, 32);
  const height = toInt(boardSource.height, BASE_BOARD_HEIGHT, 1, Math.max(TALL_BOARD_HEIGHT, 32));
  const size = width * height;
  const socketsSource = Array.isArray(boardSource.sockets) ? boardSource.sockets : [];
  if (socketsSource.length !== size) return fresh;
  const sockets = socketsSource.map(normalizeSocket);

  const packets: PacketState[] = [];
  const seenPacketSockets = new Set<number>();
  if (Array.isArray(boardSource.packets)) {
    for (const entry of boardSource.packets) {
      if (!isRecord(entry)) continue;
      const socketIndex = toInt(entry.socketIndex, -1, -1);
      if (socketIndex < 0 || socketIndex >= size) continue;
      if (seenPacketSockets.has(socketIndex)) continue; // one packet per socket
      seenPacketSockets.add(socketIndex);
      packets.push({
        id: toInt(entry.id, 0),
        taskKind: isOneOf(entry.taskKind, TASK_KINDS) ? entry.taskKind : "bulk",
        socketIndex,
        value: toAmount(entry.value, amount(1)),
        visitedMask: Math.max(0, toFiniteNumber(entry.visitedMask, 0)),
        hops: toInt(entry.hops, 0, 0, 999),
      });
    }
  }

  const backlog: TaskState[] = [];
  if (Array.isArray(value.backlog)) {
    for (const entry of value.backlog) {
      const task = normalizeTask(entry);
      if (task) backlog.push(task);
    }
  }

  const systemSource = isRecord(value.system) ? value.system : {};
  const firmware: FirmwareId[] = [];
  if (Array.isArray(systemSource.firmware)) {
    for (const id of systemSource.firmware) {
      if (isOneOf(id, FIRMWARE_IDS) && !firmware.includes(id)) firmware.push(id);
    }
  }

  const damageSource = isRecord(value.damageLog) ? value.damageLog : {};
  const damageLog = createEmptyDamageLog();
  for (const source of DAMAGE_SOURCES) {
    damageLog[source as DamageSource] = Math.max(0, toFiniteNumber(damageSource[source], 0));
  }

  const events = normalizeEvents(value.events);
  const maxSeq = events.reduce((max, event) => Math.max(max, event.seq), 0);
  const maxEntityId = Math.max(
    0,
    ...packets.map((packet) => packet.id),
    ...backlog.map((task) => task.id),
  );

  return {
    uptimeMs: Math.max(0, toFiniteNumber(value.uptimeMs, 0)),
    pressureMs: Math.max(
      0,
      toFiniteNumber(value.pressureMs, toFiniteNumber(value.uptimeMs, 0)),
    ),
    integrity: toClamped(value.integrity, 0, 0, getMaxIntegrity(meta.architecture)),
    credits: toAmount(value.credits, amount(0)),
    data: toAmount(value.data, amount(0)),
    backlog,
    board: {
      width,
      height,
      sockets,
      packets,
      nextId: Math.max(maxEntityId + 1, toInt(boardSource.nextId, 1, 1)),
    },
    system: {
      railLevel: toInt(systemSource.railLevel, 0, 0, 999),
      capacitorLevel: toInt(systemSource.capacitorLevel, 0, 0, 999),
      clockLevel: toInt(systemSource.clockLevel, 0, 0, 999),
      reserveJ: Math.max(0, toFiniteNumber(systemSource.reserveJ, 0)),
      firmware,
    },
    arrivalAccumMs: Math.max(0, toFiniteNumber(value.arrivalAccumMs, 0)),
    tickAccumMs: Math.max(0, toFiniteNumber(value.tickAccumMs, 0)),
    damageLog,
    tasksDone: toInt(value.tasksDone, 0),
    ventCooldownMs: Math.max(0, toFiniteNumber(value.ventCooldownMs, 0)),
    events,
    nextEventSeq: Math.max(maxSeq + 1, toInt(value.nextEventSeq, 1, 1)),
  };
};

const normalizeV3State = (value: Record<string, unknown>): GameState => {
  const meta = normalizeMeta(value.meta);
  return {
    rng: normalizeRngState(value.rng as Partial<GameState["rng"]>),
    run: normalizeRun(value.run, meta),
    meta,
    savedAtMs: toNullableNumber(value.savedAtMs),
    departedAtMs: toNullableNumber(value.departedAtMs),
  };
};

// ---- v1/v2 migration --------------------------------------------------------

/** v1/v2 saves convert banked credits to Silicon = floor(sqrt(credits) / 10), fresh run. */
const migrateLegacyState = (value: Record<string, unknown>): GameState => {
  const hub = isRecord(value.hub) ? value.hub : {};
  const hubCredits = toAmount(hub.credits, amount(0));
  const legacyRun = isRecord(value.run) ? value.run : null;
  const runCredits = legacyRun ? toAmount(legacyRun.credits, amount(0)) : amount(0);
  const totalCredits =
    amountToSafeNumber(hubCredits) + amountToSafeNumber(runCredits);
  const silicon = Math.max(0, Math.floor(Math.sqrt(Math.max(0, totalCredits)) / 10));
  const fresh = createInitialGameState();
  return {
    ...fresh,
    meta: { ...fresh.meta, silicon },
    run: createFreshRun(fresh.meta),
  };
};

/**
 * Normalize any candidate state: v3 states are clamped field by field, v1/v2
 * states migrate (credits -> Silicon, fresh run), garbage collapses to the
 * initial state.
 */
export const normalizeGameState = (value: unknown): GameState => {
  if (!isRecord(value)) return createInitialGameState();
  if (isRecord(value.hub)) return migrateLegacyState(value); // v1/v2 shape
  if (isRecord(value.run) && isRecord((value.run as Record<string, unknown>).board)) {
    return normalizeV3State(value);
  }
  if (isRecord(value.meta)) return normalizeV3State(value);
  return createInitialGameState();
};

export const deserializeSave = (raw: string | null | undefined): LoadedSave => {
  const fallback: LoadedSave = {
    state: createInitialGameState(),
    savedAtMs: null,
    departedAtMs: null,
  };
  if (typeof raw !== "string" || raw.length === 0) return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (!isRecord(parsed)) return fallback;
  // Accept both the envelope and a bare state object.
  const envelope = isRecord(parsed.state) ? parsed : { state: parsed };
  const state = normalizeGameState(envelope.state);
  return {
    state,
    savedAtMs:
      toNullableNumber((envelope as Record<string, unknown>).savedAtMs) ?? state.savedAtMs,
    departedAtMs:
      toNullableNumber((envelope as Record<string, unknown>).departedAtMs) ??
      state.departedAtMs,
  };
};
