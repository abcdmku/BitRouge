import { amount, amountClampMin, type Amount } from "./amount";
import { EVENT_RING_SIZE } from "./dungeon/draft";
import { HARDWARE_MAX_LEVEL } from "./hardware";
import { createInitialGameState, createInitialHubState } from "./initialState";
import { TileKind, type EnemyKind, type HazardKind, type ItemKind, type RunEvent } from "./renderSnapshot";
import { isResearchId } from "./research";
import { normalizeRngState } from "./rng";
import {
  HARDWARE_KINDS,
  type Enemy,
  type FloorItem,
  type FloorState,
  type GameState,
  type HardwareKind,
  type HeroState,
  type HubState,
  type Point,
  type ResearchId,
  type RunState,
  type RunSummary,
} from "./types";
import { normalizeWatchdogState } from "./watchdog";

export const SAVE_VERSION = 1 as const;

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

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const toFiniteNumber = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const toInt = (value: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  Math.min(max, Math.max(min, Math.trunc(toFiniteNumber(value, fallback))));

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

const toBooleanArray = (value: unknown, size: number): boolean[] | null => {
  if (!Array.isArray(value) || value.length !== size) return null;
  return value.map((entry) => entry === true);
};

export const createSaveEnvelope = (state: GameState, savedAtMs: number): SaveEnvelope => {
  const normalizedSavedAtMs = Math.max(0, Math.trunc(Number.isFinite(savedAtMs) ? savedAtMs : 0));
  return {
    version: SAVE_VERSION,
    savedAt: new Date(normalizedSavedAtMs).toISOString(),
    savedAtMs: normalizedSavedAtMs,
    departedAtMs: state.time.departedAtMs,
    state,
  };
};

/** JSON envelope `{ version, savedAt, savedAtMs, departedAtMs, state }`. */
export const serializeSave = (state: GameState, savedAtMs: number) =>
  JSON.stringify(createSaveEnvelope(state, savedAtMs));

const ENEMY_KINDS: readonly EnemyKind[] = ["bitFlip", "nullPointer", "memoryLeak", "deadlock", "forkBomb", "daemon", "zombieProcess"];
const ITEM_KINDS: readonly ItemKind[] = ["patch", "hotfix", "cacheLine", "heatsink", "checkpoint", "coreDump"];
const HAZARD_KINDS: readonly HazardKind[] = ["hotTile", "overloadPlate", "corruptedSector", "brownout"];
const TILE_VALUES = new Set<number>(Object.values(TileKind));

const isEnemyKind = (value: unknown): value is EnemyKind => ENEMY_KINDS.includes(value as EnemyKind);
const isItemKind = (value: unknown): value is ItemKind => ITEM_KINDS.includes(value as ItemKind);
const isHazardKind = (value: unknown): value is HazardKind => HAZARD_KINDS.includes(value as HazardKind);

const normalizeSummary = (value: unknown): RunSummary | null => {
  if (!isRecord(value)) return null;
  return {
    seed: toInt(value.seed, 0),
    depth: toInt(value.depth, 1),
    maxDepthReached: toInt(value.maxDepthReached, 1),
    turns: toInt(value.turns, 0),
    kills: toInt(value.kills, 0),
    creditsBanked: toAmount(value.creditsBanked, amount(0)),
    dataBanked: toAmount(value.dataBanked, amount(0)),
    cause: typeof value.cause === "string" ? value.cause.slice(0, 80) : "Unknown fault",
    elapsedMs: Math.max(0, toFiniteNumber(value.elapsedMs, 0)),
    newMaxDepth: value.newMaxDepth === true,
    aborted: value.aborted === true,
  };
};

const normalizeHub = (value: unknown): HubState => {
  const initial = createInitialHubState();
  if (!isRecord(value)) return initial;
  const hardwareSource = isRecord(value.hardware) ? value.hardware : {};
  const hardware = {} as Record<HardwareKind, number>;
  for (const kind of HARDWARE_KINDS) {
    hardware[kind] = toInt(hardwareSource[kind], initial.hardware[kind], 0, HARDWARE_MAX_LEVEL);
  }
  const researchSource = isRecord(value.research) ? value.research.completed : null;
  const completed: ResearchId[] = [];
  if (Array.isArray(researchSource)) {
    for (const id of researchSource) if (isResearchId(id) && !completed.includes(id)) completed.push(id);
  }
  const statsSource = isRecord(value.stats) ? value.stats : {};
  const reboot = toNullableNumber(value.rebootRemainingBits);
  return {
    credits: toAmount(value.credits, initial.credits),
    data: toAmount(value.data, initial.data),
    hardware,
    research: { completed },
    stats: {
      runs: toInt(statsSource.runs, 0),
      maxDepth: toInt(statsSource.maxDepth, 0),
      totalKills: toInt(statsSource.totalKills, 0),
      lifetimeCredits: toAmount(statsSource.lifetimeCredits, amount(0)),
    },
    rebootRemainingBits: reboot === null ? null : Math.max(0, reboot),
    lastRunSummary: normalizeSummary(value.lastRunSummary),
  };
};

const normalizePoint = (value: unknown, width: number, height: number): Point | null => {
  if (!isRecord(value)) return null;
  const x = toInt(value.x, -1, -1);
  const y = toInt(value.y, -1, -1);
  if (x < 0 || y < 0 || x >= width || y >= height) return null;
  return { x, y };
};

const normalizeFloor = (value: unknown): FloorState | null => {
  if (!isRecord(value)) return null;
  const width = toInt(value.width, 0, 1, 256);
  const height = toInt(value.height, 0, 1, 256);
  const size = width * height;
  if (!Array.isArray(value.tiles) || value.tiles.length !== size) return null;
  const tiles = value.tiles.map((tile) => (TILE_VALUES.has(tile as number) ? (tile as FloorState["tiles"][number]) : TileKind.wall));
  const explored = toBooleanArray(value.explored, size) ?? new Array<boolean>(size).fill(false);
  const visible = toBooleanArray(value.visible, size) ?? new Array<boolean>(size).fill(false);
  const stairs = normalizePoint(value.stairs, width, height);
  if (!stairs) return null;
  const hazards: FloorState["hazards"] = [];
  if (Array.isArray(value.hazards)) {
    for (const hazard of value.hazards) {
      if (!isRecord(hazard) || !isHazardKind(hazard.kind)) continue;
      const index = toInt(hazard.index, -1, -1);
      if (index >= 0 && index < size) hazards.push({ index, kind: hazard.kind });
    }
  }
  return { width, height, tiles, explored, visible, stairs, hazards };
};

const normalizeHero = (value: unknown, floor: FloorState): HeroState | null => {
  if (!isRecord(value)) return null;
  const position = normalizePoint(value, floor.width, floor.height);
  if (!position) return null;
  const maxHp = toInt(value.maxHp, 1, 1, 1_000_000);
  const items: ItemKind[] = Array.isArray(value.items) ? value.items.filter(isItemKind).slice(0, 12) : [];
  const buffs: HeroState["buffs"] = [];
  if (Array.isArray(value.buffs)) {
    for (const buff of value.buffs) {
      if (!isRecord(buff) || buff.kind !== "attack") continue;
      const turnsLeft = toInt(buff.turnsLeft, 0);
      if (turnsLeft > 0) buffs.push({ kind: "attack", value: toInt(buff.value, 0), turnsLeft });
    }
  }
  return {
    x: position.x,
    y: position.y,
    facing: value.facing === "l" ? "l" : "r",
    hp: toInt(value.hp, maxHp, 0, maxHp),
    maxHp,
    heat: Math.max(0, toFiniteNumber(value.heat, 0)),
    throttled: value.throttled === true,
    lockedTurns: toInt(value.lockedTurns, 0),
    items,
    buffs,
    checkpoint: toInt(value.checkpoint, 0, 0, 99),
    powerDebt: Math.max(0, toFiniteNumber(value.powerDebt, 0)),
    skipNextTurn: value.skipNextTurn === true,
    retreatTurns: toInt(value.retreatTurns, 0),
  };
};

const normalizeEnemies = (value: unknown, floor: FloorState): Enemy[] => {
  if (!Array.isArray(value)) return [];
  const enemies: Enemy[] = [];
  const seen = new Set<number>();
  for (const entry of value) {
    if (!isRecord(entry) || !isEnemyKind(entry.kind)) continue;
    const position = normalizePoint(entry, floor.width, floor.height);
    const id = toInt(entry.id, -1, -1);
    if (!position || id < 0 || seen.has(id)) continue;
    seen.add(id);
    const maxHp = toInt(entry.maxHp, 1, 1, 1_000_000);
    enemies.push({
      id,
      kind: entry.kind,
      x: position.x,
      y: position.y,
      hp: toInt(entry.hp, maxHp, 0, maxHp),
      maxHp,
      facing: entry.facing === "r" ? "r" : "l",
      alerted: entry.alerted === true,
      dormantTurns: toInt(entry.dormantTurns, 0, 0, 99),
      revived: entry.revived === true,
      cooldown: toInt(entry.cooldown, 0, 0, 99),
    });
  }
  return enemies;
};

const normalizeItems = (value: unknown, floor: FloorState): FloorItem[] => {
  if (!Array.isArray(value)) return [];
  const items: FloorItem[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || !isItemKind(entry.kind)) continue;
    const position = normalizePoint(entry, floor.width, floor.height);
    const id = toInt(entry.id, -1, -1);
    if (!position || id < 0) continue;
    items.push({ id, kind: entry.kind, x: position.x, y: position.y });
  }
  return items;
};

const normalizePath = (value: unknown, floor: FloorState): Point[] | null => {
  if (!Array.isArray(value) || value.length === 0) return null;
  const path: Point[] = [];
  for (const entry of value) {
    const point = normalizePoint(entry, floor.width, floor.height);
    if (!point) return null;
    path.push(point);
  }
  return path;
};

const normalizeEvents = (value: unknown): RunEvent[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (event): event is RunEvent =>
        isRecord(event) &&
        typeof event.kind === "string" &&
        typeof event.seq === "number" &&
        Number.isFinite(event.seq) &&
        typeof event.turn === "number",
    )
    .slice(-EVENT_RING_SIZE);
};

const normalizeRun = (value: unknown): RunState | null => {
  if (!isRecord(value)) return null;
  const floor = normalizeFloor(value.floor);
  if (!floor) return null;
  const hero = normalizeHero(value.hero, floor);
  if (!hero) return null;
  const enemies = normalizeEnemies(value.enemies, floor);
  const items = normalizeItems(value.items, floor);
  const events = normalizeEvents(value.events);
  const maxSeq = events.reduce((max, event) => Math.max(max, event.seq), 0);
  const maxEntityId = [...enemies, ...items].reduce((max, entity) => Math.max(max, entity.id), 0);
  const depth = toInt(value.depth, 1, 1, 10_000);
  return {
    seed: toInt(value.seed, 0),
    rng: normalizeRngState(value.rng as Partial<RunState["rng"]>, toInt(value.seed, 0)),
    depth,
    maxDepthReached: Math.max(depth, toInt(value.maxDepthReached, depth)),
    turn: toInt(value.turn, 0),
    status: value.status === "dead" ? "dead" : "active",
    deathCause: typeof value.deathCause === "string" ? value.deathCause : null,
    control: value.control === "manual" ? "manual" : "auto",
    turnAccumulatorMs: Math.max(0, toFiniteNumber(value.turnAccumulatorMs, 0)),
    elapsedMs: Math.max(0, toFiniteNumber(value.elapsedMs, 0)),
    credits: toAmount(value.credits, amount(0)),
    salvageData: toInt(value.salvageData, 0),
    kills: toInt(value.kills, 0),
    hero,
    floor,
    enemies,
    items,
    events,
    nextEventSeq: Math.max(maxSeq + 1, toInt(value.nextEventSeq, 1, 1)),
    nextEntityId: Math.max(maxEntityId + 1, toInt(value.nextEntityId, 1, 1)),
    pendingPath: normalizePath(value.pendingPath, floor),
    autoPath: normalizePath(value.autoPath, floor),
  };
};

/** Normalize and clamp every field of a candidate state; garbage collapses to the initial state. */
export const normalizeGameState = (value: unknown): GameState => {
  if (!isRecord(value) || !isRecord(value.hub)) return createInitialGameState();
  const timeSource = isRecord(value.time) ? value.time : {};
  const run = normalizeRun(value.run);
  return {
    version: 1,
    hub: normalizeHub(value.hub),
    run: run && run.status === "active" ? run : null,
    rng: normalizeRngState(value.rng as Partial<GameState["rng"]>),
    watchdog: normalizeWatchdogState(value.watchdog as Partial<GameState["watchdog"]>),
    time: {
      lastSavedAtMs: toNullableNumber(timeSource.lastSavedAtMs),
      departedAtMs: toNullableNumber(timeSource.departedAtMs),
    },
    lastAdvanceReport: null,
  };
};

export const deserializeSave = (raw: string | null | undefined): LoadedSave => {
  const fallback: LoadedSave = { state: createInitialGameState(), savedAtMs: null, departedAtMs: null };
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
    savedAtMs: toNullableNumber(envelope.savedAtMs) ?? state.time.lastSavedAtMs,
    departedAtMs: toNullableNumber(envelope.departedAtMs) ?? state.time.departedAtMs,
  };
};
