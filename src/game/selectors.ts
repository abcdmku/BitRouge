import { amountCompare, type Amount } from "./amount";
import {
  countComponents,
  countUnlockedSockets,
  getPortIndicesFor,
} from "./board";
import {
  archPerkDefinitions,
  componentDefinitions,
  firmwareDefinitions,
  getArchCost,
  getBacklogCap,
  getCapacitorCost,
  getClockCost,
  getComponentCost,
  getDuty,
  getEffectiveTickMs,
  getGenerationW,
  getMaxIntegrity,
  getNetWatts,
  getPowerDrawW,
  getRailCost,
  getReserveMaxJ,
  getSellRefund,
  getSiliconPayout,
  getUpgradeCost,
  getArrivalIntervalMs,
  VOLUNTARY_REFLOW_MIN_UPTIME_MS,
} from "./economy";
import { formatAmount, formatDurationMs } from "./format";
import {
  canAdvanceClock,
  getAutomationBufferMs,
  getClockGateLabel,
  getClockRateLabel,
  getCpuTier,
  researchDefinitions,
  researchRequirementsMet,
} from "./research";
import type {
  AdvanceReport,
  ArchPerkId,
  ComponentKind,
  DamageSource,
  FirmwareId,
  GameState,
  ResearchId,
  TaskKind,
} from "./types";

// ============================================================================
// VisibleState (WS3): formatted HUD numbers plus BUILD / SYSTEM / ARCH rows
// with cost, affordability and afford-glow flags, per-socket popover data,
// backlog rows, the crash report, and the offline-return report shape.
// ============================================================================

export interface VisibleHud {
  uptimeLabel: string;
  uptimeMs: number;
  integrity: number;
  integrityMax: number;
  integrityLabel: string;
  creditsLabel: string;
  dataLabel: string;
  siliconLabel: string;
  reserveJ: number;
  reserveMax: number;
  reserveLabel: string;
  netWatts: number;
  netWattsLabel: string;
  generationW: number;
  drawW: number;
  duty: number;
  dutyLabel: string;
  gen: number;
  crashed: boolean;
  /**
   * Hottest socket on the board, rounded (the HUD "T 74C" figure). Optional
   * only so pre-existing HUD literals stay valid; deriveVisibleState always
   * sets it.
   */
  maxHeat?: number;
}

export interface VisibleBacklogRow {
  id: number;
  kind: TaskKind;
  kindLabel: string;
  valueLabel: string;
  deadlineLabel: string | null;
}

export interface VisibleBuildRow {
  kind: ComponentKind;
  label: string;
  flavor: string;
  cost: Amount;
  costLabel: string;
  affordable: boolean;
  /** Afford-glow: purchasable right now. */
  glow: boolean;
  owned: number;
  /** Why the row is unavailable (gen gate), or null when buyable. */
  lockedReason: string | null;
}

export interface VisibleSystemRow {
  id: "rail" | "capacitor" | "clock" | FirmwareId;
  isFirmware: boolean;
  label: string;
  flavor: string;
  level: number;
  costLabel: string;
  /** Firmware costs Data; rails/capacitors/clock cost Credits. */
  currency: "credits" | "data";
  affordable: boolean;
  glow: boolean;
  owned: boolean;
  lockedReason: string | null;
}

export interface VisibleResearchRow {
  id: ResearchId;
  name: string;
  description: string;
  branch: "compute" | "automation" | "system" | "tier";
  costLabel: string;
  workLabel: string;
  progress: number;
  status: "available" | "active" | "completed" | "locked";
  affordable: boolean;
  blockedReason: string | null;
}

export interface VisibleNodeStatus {
  condition: "stable" | "loaded" | "critical" | "offline";
  conditionLabel: string;
  conditionDetail: string;
  pressureLevel: number;
  arrivalLabel: string;
  nextJobLabel: string;
  bufferLabel: string;
  faultCount: number;
  canPulse: boolean;
  canVent: boolean;
  canShed: boolean;
  ventCooldownLabel: string | null;
  clockLabel: string;
  clockTier: string;
}

export interface VisibleArchRow {
  id: ArchPerkId;
  label: string;
  flavor: string;
  costSilicon: number;
  costLabel: string;
  affordable: boolean;
  glow: boolean;
  owned: boolean;
  repeatable: boolean;
  timesOwned: number;
  lockedReason: string | null;
}

export interface VisiblePopover {
  index: number;
  kind: ComponentKind;
  label: string;
  level: number;
  powered: boolean;
  faulted: boolean;
  drawW: number;
  upgradeCostLabel: string;
  upgradeAffordable: boolean;
  /** Null when the upgrade is gen-gated (CACHE tier II is a gen 2 reward). */
  upgradeLockedReason: string | null;
  sellRefundLabel: string;
}

export interface VisibleCrashRow {
  source: DamageSource;
  label: string;
  amount: number;
  /** Share of total applied damage, 0..100. */
  percent: number;
}

export interface VisibleCrash {
  uptimeLabel: string;
  uptimeMs: number;
  siliconPayout: number;
  tasksDone: number;
  rows: VisibleCrashRow[];
  /** "killed by X" headline source, null when no damage was logged. */
  killedBy: string | null;
}

export interface VisibleState {
  hud: VisibleHud;
  backlog: VisibleBacklogRow[];
  backlogCap: number;
  build: VisibleBuildRow[];
  system: VisibleSystemRow[];
  research: VisibleResearchRow[];
  node: VisibleNodeStatus;
  arch: VisibleArchRow[];
  /** Per-socket popover data; null for empty/locked sockets. */
  popovers: (VisiblePopover | null)[];
  crash: VisibleCrash | null;
  /** Voluntary reflow availability + payout preview. */
  reflow: { available: boolean; siliconPayout: number };
  tickMsLabel: string;
}

export const DAMAGE_SOURCE_LABELS: Record<DamageSource, string> = {
  backlogOverflow: "BACKLOG OVERFLOW",
  rawCrunch: "RAW CRUNCH DELIVERY",
  priorityExpired: "PRIORITY EXPIRED",
  faultSpread: "FAULT SPREAD",
  overheat: "OVERHEAT",
};

export const TASK_KIND_LABELS: Record<TaskKind, string> = {
  bulk: "BULK",
  crunch: "CRUNCH",
  hot: "HOT",
  priority: "PRIORITY",
};

const formatUptime = (uptimeMs: number) => {
  const totalSeconds = Math.floor(uptimeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const hours = Math.floor(minutes / 60);
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes % 60)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
};

const formatWatts = (watts: number) => {
  const rounded = Math.round(watts * 10) / 10;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded} W`;
};

export const deriveVisibleState = (state: GameState): VisibleState => {
  const run = state.run;
  const meta = state.meta;
  const crashed = run.integrity <= 0;
  const generationW = getGenerationW(run.system.railLevel, meta.architecture);
  const drawW = getPowerDrawW(run);
  const duty = crashed || generationW <= 0 ? 0 : getDuty(run, meta);
  const affordCredits = (cost: Amount) => amountCompare(run.credits, cost) >= 0;

  const hud: VisibleHud = {
    uptimeLabel: formatUptime(run.uptimeMs),
    uptimeMs: run.uptimeMs,
    integrity: Math.round(run.integrity),
    integrityMax: getMaxIntegrity(meta.architecture),
    integrityLabel: String(Math.round(run.integrity)),
    creditsLabel: formatAmount(run.credits),
    dataLabel: formatAmount(run.data),
    siliconLabel: String(meta.silicon),
    reserveJ: run.system.reserveJ,
    reserveMax: getReserveMaxJ(run.system.capacitorLevel, meta.architecture),
    reserveLabel: `${Math.round(run.system.reserveJ)} J`,
    netWatts: getNetWatts(run, meta),
    netWattsLabel: formatWatts(getNetWatts(run, meta)),
    generationW,
    drawW,
    duty,
    dutyLabel: `${Math.round(duty * 100)}%`,
    gen: meta.gen,
    crashed,
    maxHeat: Math.round(
      run.board.sockets.reduce((max, socket) => Math.max(max, socket.heat), 0),
    ),
  };

  const backlog: VisibleBacklogRow[] = run.backlog.map((task) => ({
    id: task.id,
    kind: task.kind,
    kindLabel: TASK_KIND_LABELS[task.kind],
    valueLabel: formatAmount(task.value),
    deadlineLabel:
      task.deadlineMs === null
        ? null
        : `${Math.max(0, Math.ceil((task.deadlineMs - run.uptimeMs) / 1000))}s`,
  }));

  const build: VisibleBuildRow[] = (
    ["core", "cache", "cooler", "miner", "gpu"] as const
  ).map((kind) => {
    const definition = componentDefinitions[kind];
    const owned = countComponents(run.board, kind);
    const cost = getComponentCost(kind, owned);
    const genLocked = definition.minGen > meta.gen;
    const researchLocked =
      kind === "cache" && !meta.research.completed.includes("cacheMapping")
        ? "RESEARCH CACHE MAPPING"
        : kind === "miner" && !meta.research.completed.includes("ramControl")
          ? "RESEARCH RAM CONTROL"
          : kind === "gpu" && !meta.research.completed.includes("specializedCompute")
            ? "RESEARCH SPECIALIZED COMPUTE"
            : kind === "core" && owned > 0 && !meta.research.completed.includes("multiCore")
              ? "RESEARCH MULTI-CORE CONTROL"
              : null;
    const lockedReason = researchLocked ?? (genLocked ? `GEN ${definition.minGen}` : null);
    const affordable = affordCredits(cost);
    return {
      kind,
      label: definition.label,
      flavor: definition.flavor,
      cost,
      costLabel: formatAmount(cost),
      affordable,
      glow: affordable && lockedReason === null && !crashed,
      owned,
      lockedReason,
    };
  });

  const system: VisibleSystemRow[] = [];
  const pushSystem = (
    id: VisibleSystemRow["id"],
    label: string,
    flavor: string,
    level: number,
    cost: Amount | number,
    currency: "credits" | "data",
    owned: boolean,
    lockedReason: string | null = null,
  ) => {
    const affordable = owned
      ? false
      : currency === "credits"
        ? affordCredits(cost as Amount)
        : amountCompare(run.data, cost) >= 0;
    system.push({
      id,
      isFirmware: currency === "data",
      label,
      flavor,
      level,
      costLabel: owned ? "OWNED" : formatAmount(String(cost)),
      currency,
      affordable,
      glow: affordable && lockedReason === null && !crashed,
      owned,
      lockedReason,
    });
  };
  pushSystem(
    "rail",
    "PSU Capacity",
    `+6 W generation; ${generationW} W installed`,
    run.system.railLevel,
    getRailCost(run.system.railLevel + 1),
    "credits",
    false,
  );
  pushSystem(
    "capacitor",
    "Power Reserve",
    "stores 1.6x more energy",
    run.system.capacitorLevel,
    getCapacitorCost(run.system.capacitorLevel + 1),
    "credits",
    false,
  );
  pushSystem(
    "clock",
    "CPU Clock",
    `${getClockRateLabel(run.system.clockLevel)}; ${Math.round(getEffectiveTickMs(run.system.clockLevel))} ms cycle`,
    getCpuTier(run.system.clockLevel).level,
    getClockCost(run.system.clockLevel + 1),
    "credits",
    false,
    canAdvanceClock(state) ? null : getClockGateLabel(run.system.clockLevel),
  );
  for (const id of ["heatPipes", "watchdog", "qos", "hotSwap"] as const) {
    const definition = firmwareDefinitions[id];
    pushSystem(
      id,
      definition.label,
      definition.flavor,
      0,
      definition.costData,
      "data",
      run.system.firmware.includes(id),
      id === "watchdog" && !meta.research.completed.includes("localScheduler")
        ? "RESEARCH LOCAL SCHEDULER"
        : id === "qos" && !meta.research.completed.includes("systemScheduler")
          ? "RESEARCH SYSTEM SCHEDULER"
          : id === "heatPipes" && !meta.research.completed.includes("thermalControl")
            ? "RESEARCH THERMAL CONTROL"
            : id === "hotSwap" && !meta.research.completed.includes("specializedCompute")
              ? "RESEARCH SPECIALIZED COMPUTE"
              : null,
    );
  }

  const arch: VisibleArchRow[] = (Object.keys(archPerkDefinitions) as ArchPerkId[]).map(
    (id) => {
      const definition = archPerkDefinitions[id];
      const timesOwned = meta.architecture.filter((perk) => perk === id).length;
      const owned = !definition.repeatable && timesOwned > 0;
      const requiresMissing =
        definition.requires !== null &&
        !meta.architecture.includes(definition.requires);
      const cost = getArchCost(id, timesOwned);
      const affordable = !owned && !requiresMissing && meta.silicon >= cost;
      return {
        id,
        label: definition.label,
        flavor: definition.flavor,
        costSilicon: cost,
        costLabel: owned ? "OWNED" : `${cost} Si`,
        affordable,
        glow: affordable,
        owned,
        repeatable: definition.repeatable,
        timesOwned,
        lockedReason: requiresMissing
          ? archPerkDefinitions[definition.requires as ArchPerkId].label
          : null,
      };
    },
  );

  const popovers: (VisiblePopover | null)[] = run.board.sockets.map((socket, index) => {
    const component = socket.component;
    if (!component) return null;
    const definition = componentDefinitions[component.kind];
    const upgradeCost = getUpgradeCost(component.kind, component.level);
    const genGated =
      (component.kind === "cache" || component.kind === "gpu") && meta.gen < 2;
    return {
      index,
      kind: component.kind,
      label: definition.label,
      level: component.level,
      powered: component.powered,
      faulted: component.faulted,
      drawW: definition.drawW,
      upgradeCostLabel: formatAmount(upgradeCost),
      upgradeAffordable: !genGated && affordCredits(upgradeCost),
      upgradeLockedReason: genGated ? "GEN 2" : null,
      sellRefundLabel: formatAmount(
        getSellRefund(
          component.kind,
          countComponents(run.board, component.kind),
          component.level,
          run.system.firmware.includes("hotSwap"),
        ),
      ),
    };
  });

  const totalDamage = (Object.values(run.damageLog) as number[]).reduce(
    (sum, value) => sum + value,
    0,
  );
  const crashRows: VisibleCrashRow[] = (
    Object.entries(run.damageLog) as [DamageSource, number][]
  )
    .filter(([, amount]) => amount > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([source, amount]) => ({
      source,
      label: DAMAGE_SOURCE_LABELS[source],
      amount: Math.round(amount * 10) / 10,
      percent: totalDamage > 0 ? Math.round((amount / totalDamage) * 100) : 0,
    }));

  const siliconPayout = getSiliconPayout(run.uptimeMs, run.tasksDone);
  const activeResearch = meta.research.active;
  const research: VisibleResearchRow[] = (Object.keys(researchDefinitions) as ResearchId[]).map(
    (id) => {
      const definition = researchDefinitions[id];
      const completed = meta.research.completed.includes(id);
      const active = activeResearch?.id === id;
      const requirementsMet = researchRequirementsMet(state, id);
      const missing = definition.requires.find(
        (required) => !meta.research.completed.includes(required),
      );
      const costs = [
        amountCompare(definition.creditCost, 0) > 0
          ? `${formatAmount(definition.creditCost)} CR`
          : null,
        amountCompare(definition.dataCost, 0) > 0
          ? `${formatAmount(definition.dataCost)} DATA`
          : null,
      ].filter((part): part is string => part !== null);
      const affordable =
        activeResearch === null &&
        requirementsMet &&
        affordCredits(definition.creditCost) &&
        amountCompare(run.data, definition.dataCost) >= 0;
      return {
        id,
        name: definition.name,
        description: definition.description,
        branch: definition.branch,
        costLabel: costs.join(" + ") || "NO COST",
        workLabel: `${definition.workRequired} jobs`,
        progress: completed
          ? 1
          : active
            ? Math.min(1, (activeResearch?.workDone ?? 0) / definition.workRequired)
            : 0,
        status: completed
          ? "completed"
          : active
            ? "active"
            : requirementsMet
              ? "available"
              : "locked",
        affordable,
        blockedReason: completed
          ? null
          : active
            ? `${activeResearch?.workDone ?? 0}/${definition.workRequired} jobs`
            : activeResearch !== null
              ? `R&D BUSY: ${researchDefinitions[activeResearch.id].name}`
              : missing
                ? `REQUIRES ${researchDefinitions[missing].name.toUpperCase()}`
                : null,
      };
    },
  );

  const backlogCap = getBacklogCap(meta.architecture);
  const faultCount = run.board.sockets.filter((socket) => socket.component?.faulted).length;
  const maxHeat = hud.maxHeat ?? 0;
  const critical =
    crashed || run.integrity <= 35 || run.backlog.length >= backlogCap - 2 || faultCount > 0;
  const loaded = run.integrity < 70 || run.backlog.length >= backlogCap / 2 || maxHeat >= 70;
  const offline = generationW <= 0 || duty <= 0;
  const condition: VisibleNodeStatus["condition"] = critical
    ? "critical"
    : offline
      ? "offline"
      : loaded
        ? "loaded"
        : "stable";
  const intervalMs = getArrivalIntervalMs(run.pressureMs, meta.gen);
  const bufferMs = getAutomationBufferMs(state);
  const node: VisibleNodeStatus = {
    condition,
    conditionLabel: condition.toUpperCase(),
    conditionDetail:
      faultCount > 0
        ? `${faultCount} fault${faultCount === 1 ? "" : "s"} blocking work`
        : run.backlog.length >= backlogCap - 2
          ? "queue is near capacity"
          : maxHeat >= 70
            ? "hardware is throttling"
            : offline
              ? "manual processing only; install PSU capacity"
              : "output is keeping pace with incoming work",
    pressureLevel: Math.floor(run.pressureMs / (5 * 60_000)) + 1,
    arrivalLabel: `${(60_000 / intervalMs).toFixed(1)} jobs/min`,
    nextJobLabel: `${Math.max(0, Math.ceil((intervalMs - run.arrivalAccumMs) / 1000))}s`,
    bufferLabel:
      bufferMs <= 0
        ? "Starting Node · foreground only"
        : `${formatDurationMs(bufferMs)} Automation Buffer`,
    faultCount,
    canPulse:
      !crashed &&
      (faultCount > 0 ||
        run.board.packets.length > 0 ||
        (run.backlog.length > 0 &&
          run.board.sockets.some((socket) => socket.component?.kind === "core"))),
    canVent: !crashed && run.ventCooldownMs <= 0 && maxHeat > 0,
    canShed: !crashed && run.backlog.length > 0,
    ventCooldownLabel:
      run.ventCooldownMs > 0 ? `${Math.ceil(run.ventCooldownMs / 1000)}s` : null,
    clockLabel: getClockRateLabel(run.system.clockLevel),
    clockTier: getCpuTier(run.system.clockLevel).tier,
  };

  return {
    hud,
    backlog,
    backlogCap,
    build,
    system,
    research,
    node,
    arch,
    popovers,
    crash: crashed
      ? {
          uptimeLabel: formatUptime(run.uptimeMs),
          uptimeMs: run.uptimeMs,
          siliconPayout,
          tasksDone: run.tasksDone,
          rows: crashRows,
          killedBy: crashRows.length > 0 ? crashRows[0].label : null,
        }
      : null,
    reflow: {
      available: crashed || run.uptimeMs >= VOLUNTARY_REFLOW_MIN_UPTIME_MS,
      siliconPayout,
    },
    tickMsLabel: `${Math.round(getEffectiveTickMs(run.system.clockLevel))} ms`,
  };
};

// ---- offline return dialog --------------------------------------------------

export interface VisibleOfflineReport {
  awayLabel: string;
  tasksDone: number;
  dutyLabel: string;
  creditsLabel: string;
  dataLabel: string;
  backlogLabel: string;
  integrityLabel: string;
  hadActivity: boolean;
  /** "It needs you." — integrity or backlog is critical. */
  needsAttention: boolean;
}

export const describeOfflineReport = (
  report: AdvanceReport,
  backlogCap: number,
): VisibleOfflineReport => ({
  awayLabel: formatDurationMs(report.awayMs),
  tasksDone: report.tasksDone,
  dutyLabel: `${Math.round(report.dutyAvg * 100)}%`,
  creditsLabel: formatAmount(report.creditsEarned),
  dataLabel: formatAmount(report.dataEarned),
  backlogLabel: `${report.backlogNow}/${backlogCap}`,
  integrityLabel: String(Math.round(report.integrityNow)),
  hadActivity: report.hadActivity,
  needsAttention:
    report.integrityNow <= 50 || report.backlogNow >= Math.max(1, backlogCap - 2),
});

// Kept for callers that need a port-aware socket count (e.g. unlock pricing UI).
export const getVisibleUnlockedCount = (state: GameState) =>
  countUnlockedSockets(state.run.board, getPortIndicesFor(state));
