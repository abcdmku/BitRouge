import type { Amount } from "./amount";
import type { Xoshiro128State } from "./rng";

// ============================================================================
// BitRouge v3 "SOLDER" — state contract (docs/redesign-v3.md §3) + action
// contract (§6). WS2 (src/render) and WS3 (src/ui) code against this file.
// ============================================================================

/** Chip kinds placeable on sockets. The PORT is a fixed board cell, not a component. */
export type ComponentKind = "core" | "cache" | "cooler" | "miner" | "gpu";
export const COMPONENT_KINDS: readonly ComponentKind[] = [
  "core",
  "cache",
  "cooler",
  "miner",
  "gpu",
];

export type TaskKind = "bulk" | "crunch" | "hot" | "priority";
export const TASK_KINDS: readonly TaskKind[] = ["bulk", "crunch", "hot", "priority"];

export type Dir = "N" | "E" | "S" | "W";
export const DIRS: readonly Dir[] = ["N", "E", "S", "W"];

/** In-run firmware, bought with Data. */
export type FirmwareId = "heatPipes" | "watchdog" | "qos" | "hotSwap";
export const FIRMWARE_IDS: readonly FirmwareId[] = ["heatPipes", "watchdog", "qos", "hotSwap"];

/** Permanent architecture perks, bought with Silicon. `baseValue20` is repeatable. */
export type ArchPerkId =
  | "startKit"
  | "integrity25"
  | "baseValue20"
  | "reserve150"
  | "board5x8"
  | "gen2"
  | "eastPort"
  | "gen3"
  | "dualRail"
  | "gen4";
export const ARCH_PERK_IDS: readonly ArchPerkId[] = [
  "startKit",
  "integrity25",
  "baseValue20",
  "reserve150",
  "board5x8",
  "gen2",
  "eastPort",
  "gen3",
  "dualRail",
  "gen4",
];

/** Buckets of the run damage log; the crash report ranks these. */
export type DamageSource =
  | "backlogOverflow"
  | "rawCrunch"
  | "priorityExpired"
  | "faultSpread"
  | "overheat";
export const DAMAGE_SOURCES: readonly DamageSource[] = [
  "backlogOverflow",
  "rawCrunch",
  "priorityExpired",
  "faultSpread",
  "overheat",
];

// ---- run state --------------------------------------------------------------

export interface TaskState {
  id: number;
  kind: TaskKind;
  value: Amount;
  /** Absolute run-clock deadline (`run.uptimeMs` domain) for PRIORITY tasks, else null. */
  deadlineMs: number | null;
}

export interface SocketComponent {
  kind: ComponentKind;
  level: number;
  powered: boolean;
  faulted: boolean;
  faultAgeMs: number;
}

export interface SocketState {
  unlocked: boolean;
  dir: Dir;
  heat: number;
  component: SocketComponent | null;
}

export interface PacketState {
  id: number;
  taskKind: TaskKind;
  socketIndex: number;
  value: Amount;
  /**
   * Bitset (base-2 digits by socket index, stored as an exact double up to
   * 2^52) of sockets whose CACHE/GPU multiplier this packet has already taken.
   */
  visitedMask: number;
  hops: number;
}

export interface BoardState {
  width: number;
  height: number;
  /** Row-major, length = width * height. Every cell has a socket record. */
  sockets: SocketState[];
  packets: PacketState[];
  /** Shared id counter for tasks and packets. */
  nextId: number;
}

export interface SystemState {
  railLevel: number;
  capacitorLevel: number;
  clockLevel: number;
  reserveJ: number;
  firmware: FirmwareId[];
}

/** Fx event ring entries; see renderSnapshot.ts for the union. */
export interface FxEventBase {
  /** Monotonic sequence number (per run). */
  seq: number;
  /** Run clock (`uptimeMs`) at emission. */
  t: number;
}

export type FxEvent = FxEventBase &
  (
    | { kind: "packetMoved"; id: number; from: number | null; to: number; manual: boolean }
    | { kind: "packetDelivered"; id: number; socketIndex: number; valueLabel: string; manual: boolean }
    | { kind: "packetDropped"; id: number; socketIndex: number; reason: "hopLimit" }
    | { kind: "taskArrived"; id: number; taskKind: TaskKind }
    | { kind: "taskDropped"; id: number; taskKind: TaskKind; reason: "backlogFull" | "rawCrunch" | "expired" }
    | { kind: "faultSpawned"; index: number }
    | { kind: "faultPatched"; index: number; manual: boolean }
    | { kind: "faultSpread"; from: number; to: number }
    | { kind: "chipPlaced"; index: number; component: ComponentKind }
    | { kind: "brownout"; on: boolean }
    | { kind: "throttle"; index: number; on: boolean }
    | { kind: "workTap"; index: number }
    | { kind: "crash" }
  );

export interface RunState {
  uptimeMs: number;
  /** 0..maxIntegrity (100 + 25 per `integrity25` perk). 0 = crashed. */
  integrity: number;
  credits: Amount;
  data: Amount;
  /** Inbound task queue, length <= backlog cap. */
  backlog: TaskState[];
  board: BoardState;
  system: SystemState;
  arrivalAccumMs: number;
  tickAccumMs: number;
  /** Applied integrity damage by source; feeds the crash report. */
  damageLog: Record<DamageSource, number>;
  /** Tasks completed (PORT or MINER deliveries) this run; the W in the Silicon payout. */
  tasksDone: number;
  /** Fx event ring for the renderer (bounded, monotonic `seq`). */
  events: FxEvent[];
  nextEventSeq: number;
}

export interface MetaState {
  silicon: number;
  /** 1..4; derived from gen2/gen3/gen4 arch purchases. */
  gen: number;
  /** Owned perks; repeatable perks appear once per purchase. */
  architecture: ArchPerkId[];
  bestUptimeMs: number;
  totalTasks: number;
  reflows: number;
}

export interface GameState {
  rng: Xoshiro128State;
  run: RunState;
  meta: MetaState;
  savedAtMs: number | null;
  departedAtMs: number | null;
}

// ---- actions (§6) -----------------------------------------------------------

export type GameAction =
  | { type: "workSocket"; index: number }
  | { type: "rotateSocket"; index: number }
  | { type: "unlockSocket"; index: number }
  | { type: "placeComponent"; index: number; kind: ComponentKind }
  | { type: "upgradeComponent"; index: number }
  | { type: "sellComponent"; index: number }
  | { type: "togglePower"; index: number }
  | { type: "buySystem"; item: "rail" | "capacitor" | "clock" }
  | { type: "buyFirmware"; id: FirmwareId }
  | { type: "buyArch"; id: ArchPerkId }
  | { type: "reflow" }
  | { type: "recordSave"; timestampMs: number }
  | { type: "recordDeparture"; timestampMs: number }
  | { type: "reset" };

// ---- advance ---------------------------------------------------------------

export type AdvanceMode = "foreground" | "offline";

export interface AdvanceReport {
  mode: AdvanceMode;
  /** Requested elapsed time (before the 12 h offline cap). */
  awayMs: number;
  /** Time actually simulated. */
  simulatedMs: number;
  tasksDone: number;
  /** Time-weighted average board duty over the window, 0..1. */
  dutyAvg: number;
  creditsEarned: Amount;
  dataEarned: Amount;
  backlogNow: number;
  integrityNow: number;
  hadActivity: boolean;
}

export interface AdvanceResult {
  state: GameState;
  report: AdvanceReport;
}
