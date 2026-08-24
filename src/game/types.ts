import type { Amount } from "./amount";
import type { Xoshiro128State } from "./rng";
import type {
  Biome,
  Dir,
  EnemyKind,
  Facing,
  HazardKind,
  ItemKind,
  RenderCommand,
  RunEvent,
  TileKindValue,
} from "./renderSnapshot";

export type { Biome, Dir, EnemyKind, Facing, HazardKind, ItemKind, RunEvent, TileKindValue };

export const HARDWARE_KINDS = [
  "clock",
  "cores",
  "cache",
  "ram",
  "psu",
  "cooling",
  "scheduler",
] as const;
export type HardwareKind = (typeof HARDWARE_KINDS)[number];

export const RESEARCH_IDS = [
  "watchdogTimer",
  "cacheMapping",
  "prefetchDaemon",
  "thermalSensors",
  "redundantRail",
  "garbageCollector",
  "priorityScheduler",
  "multiCore",
  "bugBounty",
  "coreDumpAnalysis",
  "checkpointing",
  "processReaper",
  "cronRuntime",
  "deepScan",
  "systemScheduler",
] as const;
export type ResearchId = (typeof RESEARCH_IDS)[number];

export const WATCHDOG_LEVEL_IDS = [
  "none",
  "watchdogTimer",
  "cronRuntime",
  "systemScheduler",
  "clusterController",
  "globalScheduler",
] as const;
export type WatchdogLevelId = (typeof WATCHDOG_LEVEL_IDS)[number];

export interface Point {
  x: number;
  y: number;
}

export interface HeroBuff {
  kind: "attack";
  value: number;
  turnsLeft: number;
}

export interface HeroState {
  x: number;
  y: number;
  facing: Facing;
  hp: number;
  maxHp: number;
  heat: number;
  throttled: boolean;
  /** consecutive turns spent adjacent to a deadlock */
  lockedTurns: number;
  items: ItemKind[];
  buffs: HeroBuff[];
  /** revives remaining (checkpointing research + checkpoint items) */
  checkpoint: number;
  /** accumulated PSU overdraw; a trip fires whenever it reaches the budget */
  powerDebt: number;
  /** the next hero action is skipped (PSU trip, brownout, overload plate) */
  skipNextTurn: boolean;
  /** consecutive auto-explore retreat turns (bounded so kiting cannot stall) */
  retreatTurns: number;
}

export interface FloorHazard {
  index: number;
  kind: HazardKind;
}

export interface FloorState {
  width: number;
  height: number;
  tiles: TileKindValue[];
  explored: boolean[];
  visible: boolean[];
  stairs: Point;
  hazards: FloorHazard[];
  /** boss floors: stairs refuse `descend` until the kernelPanic dies */
  stairsLocked: boolean;
}

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  facing: Facing;
  alerted: boolean;
  /** zombieProcess: turns until revival (0 = active) */
  dormantTurns: number;
  /** zombieProcess: has already used its revive */
  revived: boolean;
  /** slow enemies act only when this is 0 */
  cooldown: number;
  /** kernelPanic: has already spawned its 50%-HP bitFlips */
  splitTriggered: boolean;
}

export interface FloorItem {
  id: number;
  kind: ItemKind;
  x: number;
  y: number;
}

export type RunStatus = "active" | "dead";

export interface RunState {
  seed: number;
  rng: Xoshiro128State;
  depth: number;
  maxDepthReached: number;
  turn: number;
  status: RunStatus;
  deathCause: string | null;
  control: "auto" | "manual";
  turnAccumulatorMs: number;
  /** simulated time this run has consumed (hardware-derived, not wall clock) */
  elapsedMs: number;
  credits: Amount;
  salvageData: number;
  kills: number;
  hero: HeroState;
  floor: FloorState;
  enemies: Enemy[];
  items: FloorItem[];
  /** ring buffer of the most recent events (<= 64), ascending seq */
  events: RunEvent[];
  nextEventSeq: number;
  nextEntityId: number;
  /** manual mode: queued path from heroPathTo, consumed one step per auto-turn cadence */
  pendingPath: Point[] | null;
  /** auto mode: cached auto-explore path (perf only; recomputed when invalid) */
  autoPath: Point[] | null;
  /** deadlocks escaped or killed this run (campaign progress) */
  deadlocksSurvived: number;
  /** kernelPanic bosses defeated this run (campaign progress) */
  bossKills: number;
}

export interface RunSummary {
  seed: number;
  depth: number;
  maxDepthReached: number;
  turns: number;
  kills: number;
  creditsBanked: Amount;
  dataBanked: Amount;
  cause: string;
  elapsedMs: number;
  newMaxDepth: boolean;
  aborted: boolean;
}

export interface HubStats {
  runs: number;
  maxDepth: number;
  totalKills: number;
  lifetimeCredits: Amount;
  /** deadlocks escaped or killed across all runs */
  deadlocksSurvived: number;
  /** kernelPanic bosses defeated across all runs */
  bossKills: number;
  /** runs completed (simulated + extrapolated) by offline advances */
  offlineRuns: number;
}

export interface HubState {
  credits: Amount;
  data: Amount;
  hardware: Record<HardwareKind, number>;
  research: { completed: ResearchId[] };
  stats: HubStats;
  /** watchdog reboot countdown in bits (drains at clockHz); null = idle */
  rebootRemainingBits: number | null;
  lastRunSummary: RunSummary | null;
}

export interface WatchdogState {
  ownedLevelId: WatchdogLevelId;
  departureLevelId: WatchdogLevelId;
  offlineProcessedMs: number;
}

export interface TimeState {
  lastSavedAtMs: number | null;
  departedAtMs: number | null;
}

export type AdvanceMode = "foreground" | "offline";

export interface AdvanceReport {
  mode: AdvanceMode;
  elapsedMs: number;
  simulatedMs: number;
  overflowMs: number;
  runsCompleted: number;
  extrapolatedRuns: number;
  creditsBanked: Amount;
  dataBanked: Amount;
  bufferLevelId: WatchdogLevelId;
  bufferCapacityMs: number;
  /** extra diagnostics (additive to the spec shape) */
  turnsSimulated: number;
  extrapolatedMs: number;
  /**
   * additive: true only when the advance actually did something (turns, runs
   * or extrapolation). Lets the UI skip the offline-return dialog when a
   * Starting Node save reloads with zero capacity (everything in overflowMs).
   */
  hadActivity: boolean;
}

/** A campaign transmission delivered to the console log. */
export interface CampaignLogEntry {
  /** monotonic per-save; the UI keeps `lastSeq` like it does for run events */
  seq: number;
  objectiveId: string;
  label: string;
  /** the transmission line, IdleBit operator voice */
  text: string;
}

export interface CampaignState {
  /** chronological completion order */
  completedObjectiveIds: string[];
  /** ring of the most recent transmissions (<= 32), ascending seq */
  log: CampaignLogEntry[];
  nextLogSeq: number;
}

export interface GameState {
  version: 1;
  hub: HubState;
  run: RunState | null;
  rng: Xoshiro128State;
  watchdog: WatchdogState;
  time: TimeState;
  lastAdvanceReport: AdvanceReport | null;
  campaign: CampaignState;
}

export interface AdvanceResult {
  state: GameState;
  report: AdvanceReport;
}

export type GameAction =
  | { type: "buyHardware"; kind: HardwareKind }
  | { type: "buyResearch"; id: ResearchId }
  | { type: "purchaseWatchdog" }
  | { type: "deploy" }
  | { type: "abortRun" }
  | RenderCommand
  | { type: "recordSave"; timestampMs: number }
  | { type: "recordDeparture"; timestampMs: number }
  | { type: "reset"; seed?: number };

/** Hero-level intent resolved by `resolveTurn`. Bumping into an enemy attacks. */
export type HeroAction =
  | { type: "move"; dir: Dir }
  | { type: "wait" }
  | { type: "useItem"; slot: number }
  | { type: "descend" }
  | { type: "forceDescend" };

/** Hub-derived numbers the turn resolver needs. Pure function of HubState. */
export interface HeroStats {
  attack: number;
  maxHp: number;
  clockHz: number;
  powerBudget: number;
  heatDissipation: number;
  schedulerLevel: number;
  daemonSlots: number;
  activeDaemons: ResearchId[];
  fovRadius: number;
  /** exact multiplier applied to kill credits, e.g. "1.25" */
  killCreditMultiplier: Amount;
  startingRevives: number;
  /** watts drawn by active daemons (items add 1 W each at runtime) */
  daemonDraw: number;
  zombiesRevive: boolean;
  coreDumpMultiplier: number;
}
