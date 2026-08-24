import { amountCompare, type Amount } from "./amount";
import { getNextEventMs, getRunMsPerTurn } from "./advance";
import { itemDefinitions } from "./dungeon/items";
import { canAfford, getHardwareBlockedReason, getResearchBlockedReason } from "./economy";
import { formatAmount, formatDurationMs } from "./format";
import { getHardwareCost, hardwareDefinitions } from "./hardware";
import { deriveHeroStats, getHeroAttack, getHeroPowerDraw, MAX_ITEM_SLOTS } from "./hero";
import { researchDefinitions } from "./research";
import { getRebootDurationMs, REBOOT_BITS } from "./run";
import {
  HARDWARE_KINDS,
  type AdvanceReport,
  type GameState,
  type HardwareKind,
  type HubStats,
  type ItemKind,
  type ResearchId,
  type RunSummary,
  type WatchdogLevelId,
} from "./types";
import {
  getNextWatchdogDefinition,
  getWatchdogBlockedReason,
  getWatchdogDefinition,
  watchdogLevelDefinitions,
} from "./watchdog";

export interface VisibleResources {
  credits: Amount;
  data: Amount;
  creditsLabel: string;
  dataLabel: string;
}

export interface VisibleHardwareRow {
  kind: HardwareKind;
  name: string;
  level: number;
  costCredits: Amount;
  costData: Amount;
  costLabel: string;
  affordable: boolean;
  blockedReason: string | null;
  effect: string;
  nextEffect: string;
}

export interface VisibleResearchRow {
  id: ResearchId;
  name: string;
  description: string;
  costData: Amount;
  costCredits: Amount;
  costLabel: string;
  completed: boolean;
  affordable: boolean;
  blockedReason: string | null;
  daemon: boolean;
  /** daemon has a core slot and is running */
  active: boolean;
}

export interface VisibleWatchdogRow {
  id: WatchdogLevelId;
  level: number;
  name: string;
  capacityMs: number;
  capacityLabel: string;
  capability: string;
  owned: boolean;
  isNext: boolean;
  costLabel: string;
  affordable: boolean;
  blockedReason: string | null;
}

export interface VisibleWatchdog {
  ownedLevelId: WatchdogLevelId;
  level: number;
  name: string;
  capacityMs: number;
  capacityLabel: string;
  next: VisibleWatchdogRow | null;
  rows: VisibleWatchdogRow[];
}

export interface VisibleItemSlot {
  slot: number;
  kind: ItemKind;
  name: string;
  description: string;
  usable: boolean;
}

export interface VisibleRun {
  seed: number;
  depth: number;
  maxDepthReached: number;
  turn: number;
  control: "auto" | "manual";
  status: "active" | "dead";
  hp: number;
  maxHp: number;
  heat: number;
  throttled: boolean;
  lockedTurns: number;
  revives: number;
  attack: number;
  powerDraw: number;
  powerBudget: number;
  overBudget: boolean;
  credits: Amount;
  creditsLabel: string;
  salvageData: number;
  kills: number;
  enemiesRemaining: number;
  items: VisibleItemSlot[];
  itemSlots: number;
  msPerTurn: number;
  turnProgress: number;
  /** manual mode with a queued tap-to-move path */
  pathPending: boolean;
  onStairs: boolean;
  elapsedMs: number;
}

export interface VisibleReboot {
  remainingBits: number;
  totalBits: number;
  /** 0..1 */
  progress: number;
  remainingMs: number;
  totalMs: number;
}

export interface VisibleState {
  resources: VisibleResources;
  hardware: VisibleHardwareRow[];
  research: VisibleResearchRow[];
  watchdog: VisibleWatchdog;
  run: VisibleRun | null;
  reboot: VisibleReboot | null;
  canDeploy: boolean;
  stats: HubStats;
  lifetimeCreditsLabel: string;
  lastRunSummary: RunSummary | null;
  lastAdvanceReport: AdvanceReport | null;
  /** ms until the next auto-turn / reboot event; null when idle */
  nextEventMs: number | null;
  clockHz: number;
}

const costLabel = (credits: Amount, data: Amount) => {
  const parts: string[] = [];
  if (amountCompare(credits, 0) > 0) parts.push(`${formatAmount(credits)} cr`);
  if (amountCompare(data, 0) > 0) parts.push(`${formatAmount(data)} D`);
  return parts.length > 0 ? parts.join(" + ") : "Free";
};

export const deriveVisibleState = (state: GameState): VisibleState => {
  const hub = state.hub;
  const stats = deriveHeroStats(hub);

  const hardware: VisibleHardwareRow[] = HARDWARE_KINDS.map((kind) => {
    const definition = hardwareDefinitions[kind];
    const level = hub.hardware[kind];
    const cost = getHardwareCost(kind, level);
    return {
      kind,
      name: definition.name,
      level,
      costCredits: cost.credits,
      costData: cost.data,
      costLabel: costLabel(cost.credits, cost.data),
      affordable: canAfford(hub, cost),
      blockedReason: getHardwareBlockedReason(hub, kind),
      effect: definition.describe(level),
      nextEffect: definition.describe(level + 1),
    };
  });

  const research: VisibleResearchRow[] = researchDefinitions.map((definition) => {
    const completed = hub.research.completed.includes(definition.id);
    const price = { credits: definition.costCredits, data: definition.costData };
    return {
      id: definition.id,
      name: definition.name,
      description: definition.description,
      costData: `${definition.costData}` as Amount,
      costCredits: `${definition.costCredits}` as Amount,
      costLabel: costLabel(`${definition.costCredits}` as Amount, `${definition.costData}` as Amount),
      completed,
      affordable: !completed && canAfford(hub, price),
      blockedReason: getResearchBlockedReason(hub, definition.id),
      daemon: definition.daemon,
      active: stats.activeDaemons.includes(definition.id),
    };
  });

  const owned = getWatchdogDefinition(state.watchdog.ownedLevelId);
  const nextDefinition = getNextWatchdogDefinition(state);
  const watchdogRows: VisibleWatchdogRow[] = watchdogLevelDefinitions.map((definition) => {
    const isNext = nextDefinition?.id === definition.id;
    const blocked = isNext ? getWatchdogBlockedReason(state, definition) : null;
    const price = { credits: definition.costCredits, data: definition.costData };
    return {
      id: definition.id,
      level: definition.level,
      name: definition.name,
      capacityMs: definition.maxOfflineMs,
      capacityLabel: definition.maxOfflineMs > 0 ? formatDurationMs(definition.maxOfflineMs) : "none",
      capability: definition.capability,
      owned: definition.level <= owned.level,
      isNext,
      costLabel: costLabel(definition.costCredits, definition.costData),
      affordable: isNext && !blocked && canAfford(hub, price),
      blockedReason: isNext ? (blocked ?? (canAfford(hub, price) ? null : "Insufficient resources.")) : null,
    };
  });
  const watchdog: VisibleWatchdog = {
    ownedLevelId: owned.id,
    level: owned.level,
    name: owned.name,
    capacityMs: owned.maxOfflineMs,
    capacityLabel: owned.maxOfflineMs > 0 ? formatDurationMs(owned.maxOfflineMs) : "none",
    next: watchdogRows.find((row) => row.isNext) ?? null,
    rows: watchdogRows,
  };

  const run = state.run;
  let visibleRun: VisibleRun | null = null;
  if (run) {
    const msPerTurn = getRunMsPerTurn(state, run);
    const draw = getHeroPowerDraw(run.hero, stats);
    visibleRun = {
      seed: run.seed,
      depth: run.depth,
      maxDepthReached: run.maxDepthReached,
      turn: run.turn,
      control: run.control,
      status: run.status,
      hp: run.hero.hp,
      maxHp: run.hero.maxHp,
      heat: run.hero.heat,
      throttled: run.hero.throttled,
      lockedTurns: run.hero.lockedTurns,
      revives: run.hero.checkpoint,
      attack: getHeroAttack(run.hero, stats),
      powerDraw: draw,
      powerBudget: stats.powerBudget,
      overBudget: draw > stats.powerBudget,
      credits: run.credits,
      creditsLabel: formatAmount(run.credits),
      salvageData: run.salvageData,
      kills: run.kills,
      enemiesRemaining: run.enemies.filter((enemy) => enemy.dormantTurns === 0).length,
      items: run.hero.items.map((kind, slot) => ({
        slot,
        kind,
        name: itemDefinitions[kind].name,
        description: itemDefinitions[kind].description,
        usable: itemDefinitions[kind].usable,
      })),
      itemSlots: MAX_ITEM_SLOTS,
      msPerTurn,
      turnProgress: msPerTurn > 0 ? Math.min(1, Math.max(0, run.turnAccumulatorMs / msPerTurn)) : 0,
      pathPending: run.pendingPath !== null && run.pendingPath.length > 0,
      onStairs: run.hero.x === run.floor.stairs.x && run.hero.y === run.floor.stairs.y,
      elapsedMs: run.elapsedMs,
    };
  }

  let reboot: VisibleReboot | null = null;
  if (!run && hub.rebootRemainingBits !== null) {
    const totalMs = getRebootDurationMs(stats.clockHz);
    const remainingMs = (hub.rebootRemainingBits / stats.clockHz) * 1000;
    reboot = {
      remainingBits: hub.rebootRemainingBits,
      totalBits: REBOOT_BITS,
      progress: Math.min(1, Math.max(0, 1 - hub.rebootRemainingBits / REBOOT_BITS)),
      remainingMs,
      totalMs,
    };
  }

  const nextEventMs = getNextEventMs(state);
  return {
    resources: {
      credits: hub.credits,
      data: hub.data,
      creditsLabel: formatAmount(hub.credits),
      dataLabel: formatAmount(hub.data),
    },
    hardware,
    research,
    watchdog,
    run: visibleRun,
    reboot,
    canDeploy: run === null,
    stats: hub.stats,
    lifetimeCreditsLabel: formatAmount(hub.stats.lifetimeCredits),
    lastRunSummary: hub.lastRunSummary,
    lastAdvanceReport: state.lastAdvanceReport,
    nextEventMs: Number.isFinite(nextEventMs) ? nextEventMs : null,
    clockHz: stats.clockHz,
  };
};
