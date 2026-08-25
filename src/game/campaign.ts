/**
 * Campaign transmissions — IdleBit's signature progression frame, scaled to
 * BitRouge's opening scope. Objectives are monotone predicates over GameState
 * (persisted counters only), so completion is delta-invariant: checking after
 * every turn, or once after a long advance, yields the same completed set.
 * The chronological transmission log is the only stored campaign state.
 */
import { amountCompare } from "./amount";
import type { CampaignLogEntry, CampaignState, GameState } from "./types";
import { getWatchdogLevel } from "./watchdog";

export const CAMPAIGN_LOG_SIZE = 32;

export type CampaignChapterId = "bootstrapProcess" | "coherentMachine" | "standingOrders";

export interface CampaignChapterDefinition {
  id: CampaignChapterId;
  index: number;
  name: string;
  description: string;
  objectiveIds: readonly string[];
}

export interface CampaignObjectiveDefinition {
  id: string;
  chapterId: CampaignChapterId;
  label: string;
  description: string;
  /** terse operator voice; the console prefixes "Transmission:" */
  transmission: string;
  requirement: (state: GameState) => boolean;
  blockedReason: string;
}

const researched = (state: GameState, id: GameState["hub"]["research"]["completed"][number]) =>
  state.hub.research.completed.includes(id);

/** Depth counts the live run so objectives complete the moment stairs resolve. */
const deepestKnown = (state: GameState) =>
  Math.max(state.hub.stats.maxDepth, state.run?.maxDepthReached ?? 0);

export const campaignChapterDefinitions: readonly CampaignChapterDefinition[] = [
  {
    id: "bootstrapProcess",
    index: 1,
    name: "Bootstrap Process",
    description: "Bring one process from first deploy to a funded, upgraded node.",
    objectiveIds: [
      "boot:first-deploy",
      "boot:first-kill",
      "boot:first-bank",
      "boot:first-hardware",
      "boot:first-site",
    ],
  },
  {
    id: "coherentMachine",
    index: 2,
    name: "Coherent Machine",
    description: "Unify sight, depth, and survival into one dependable machine.",
    objectiveIds: [
      "coherent:cache-mapping",
      "coherent:depth-3",
      "coherent:survive-deadlock",
      "coherent:bank-100",
      "coherent:mine-10",
    ],
  },
  {
    id: "standingOrders",
    index: 3,
    name: "Standing Orders",
    description: "Leave orders the machine keeps while unattended.",
    objectiveIds: [
      "orders:watchdog",
      "orders:offline-run",
      "orders:depth-5",
      "orders:kernel-panic",
      "orders:deliver-5",
    ],
  },
] as const;

export const campaignObjectiveDefinitions: readonly CampaignObjectiveDefinition[] = [
  {
    id: "boot:first-deploy",
    chapterId: "bootstrapProcess",
    label: "Deploy a process",
    description: "Deploy the hero process into the stack.",
    transmission: "First process deployed. The stack notices.",
    requirement: (state) => state.hub.stats.runs > 0 || state.run !== null,
    blockedReason: "Press Deploy.",
  },
  {
    id: "boot:first-kill",
    chapterId: "bootstrapProcess",
    label: "Terminate a fault",
    description: "Kill any enemy process.",
    transmission: "One fault terminated. The heap breathes easier.",
    requirement: (state) => state.hub.stats.totalKills > 0 || (state.run?.kills ?? 0) > 0,
    blockedReason: "Bump into an enemy to attack it.",
  },
  {
    id: "boot:first-bank",
    chapterId: "bootstrapProcess",
    label: "Bank a run",
    description: "Let a run end and bank its credits.",
    transmission: "First core dumped and banked. Death is a billing event.",
    requirement: (state) => state.hub.stats.runs > 0,
    blockedReason: "A run banks when the process dies.",
  },
  {
    id: "boot:first-hardware",
    chapterId: "bootstrapProcess",
    label: "Buy hardware",
    description: "Buy any hardware upgrade.",
    transmission: "New silicon seated. The node is no longer stock.",
    requirement: (state) =>
      state.hub.hardware.clock > 1 ||
      state.hub.hardware.cores > 0 ||
      state.hub.hardware.cache > 0 ||
      state.hub.hardware.ram > 0 ||
      state.hub.hardware.psu > 0 ||
      state.hub.hardware.cooling > 0 ||
      state.hub.hardware.scheduler > 0,
    blockedReason: "Buy any hardware upgrade.",
  },
  {
    id: "boot:first-site",
    chapterId: "bootstrapProcess",
    label: "Complete a work site",
    description: "Finish a data node, job station, or payload delivery.",
    transmission: "First work order closed. The floor is a job queue now.",
    requirement: (state) =>
      state.hub.stats.sitesCompleted > 0 ||
      state.hub.stats.payloadsDelivered > 0 ||
      (state.run?.sitesCompleted ?? 0) > 0 ||
      (state.run?.payloadsDelivered ?? 0) > 0,
    blockedReason: "Interact with a data node, job station, or payload.",
  },
  {
    id: "coherent:cache-mapping",
    chapterId: "coherentMachine",
    label: "Research Cache Mapping",
    description: "Complete Cache Mapping research.",
    transmission: "Cache mapped. The process sees two tiles further.",
    requirement: (state) => researched(state, "cacheMapping"),
    blockedReason: "Research Cache Mapping.",
  },
  {
    id: "coherent:depth-3",
    chapterId: "coherentMachine",
    label: "Reach depth 3",
    description: "Flush through to floor 3, the cache controller floor.",
    transmission: "Depth 3. The cache controller floor. The gate wants its quota.",
    requirement: (state) => deepestKnown(state) >= 3,
    blockedReason: "Meet the quota and flush through to floor 3.",
  },
  {
    id: "coherent:survive-deadlock",
    chapterId: "coherentMachine",
    label: "Survive a deadlock",
    description: "Kill a deadlock, or outlast its hold.",
    transmission: "Deadlock cleared. The scheduler keeps its promise.",
    requirement: (state) =>
      state.hub.stats.deadlocksSurvived > 0 || (state.run?.deadlocksSurvived ?? 0) > 0,
    blockedReason: "Kill a deadlock, or outlast its hold.",
  },
  {
    id: "coherent:bank-100",
    chapterId: "coherentMachine",
    label: "Bank 100 lifetime credits",
    description: "Bank 100 credits across all runs.",
    transmission: "One hundred credits on the ledger. Compound interest begins.",
    requirement: (state) => amountCompare(state.hub.stats.lifetimeCredits, 100) >= 0,
    blockedReason: "Bank 100 credits across all runs.",
  },
  {
    id: "coherent:mine-10",
    chapterId: "coherentMachine",
    label: "Mine 10 Data in one run",
    description: "Channel data nodes for 10 Data in a single run.",
    transmission: "Ten units pulled from the banks in one pass. Mining is literal now.",
    requirement: (state) =>
      (state.run?.dataMined ?? 0) >= 10 || (state.hub.lastRunSummary?.dataMined ?? 0) >= 10,
    blockedReason: "Channel data nodes for 10 Data in a single run.",
  },
  {
    id: "orders:watchdog",
    chapterId: "standingOrders",
    label: "Arm the watchdog",
    description: "Research and purchase Watchdog L1 (Local Scheduler).",
    transmission: "Watchdog armed. The machine can keep a promise while unattended.",
    requirement: (state) => getWatchdogLevel(state.watchdog.ownedLevelId) >= 1,
    blockedReason: "Research Local Scheduler, then purchase Watchdog L1.",
  },
  {
    id: "orders:offline-run",
    chapterId: "standingOrders",
    label: "Complete an offline run",
    description: "Let the watchdog finish a run while the game is closed.",
    transmission: "The node worked while you were gone. Standing orders hold.",
    requirement: (state) => state.hub.stats.offlineRuns > 0,
    blockedReason: "Close the game with a run active and return later.",
  },
  {
    id: "orders:depth-5",
    chapterId: "standingOrders",
    label: "Reach depth 5",
    description: "Descend into the RAM banks on floor 5.",
    transmission: "Depth 5. The RAM banks stretch out — long buses, long hauls.",
    requirement: (state) => deepestKnown(state) >= 5,
    blockedReason: "Descend to floor 5.",
  },
  {
    id: "orders:kernel-panic",
    chapterId: "standingOrders",
    label: "Defeat a Kernel Panic",
    description: "Kill the controller guarding a controller floor's bus gate.",
    transmission: "Kernel Panic contained. The stack reboots around you.",
    requirement: (state) => state.hub.stats.bossKills > 0 || (state.run?.bossKills ?? 0) > 0,
    blockedReason: "Kill the controller guarding a controller floor's bus gate.",
  },
  {
    id: "orders:deliver-5",
    chapterId: "standingOrders",
    label: "Deliver 5 payloads",
    description: "Haul 5 payloads to their I/O ports across all runs.",
    transmission: "Fifth payload docked. The transfer queue trusts you now.",
    requirement: (state) =>
      state.hub.stats.payloadsDelivered + (state.run?.payloadsDelivered ?? 0) >= 5,
    blockedReason: "Haul payloads to their I/O ports.",
  },
] as const;

const objectiveById = new Map(campaignObjectiveDefinitions.map((definition) => [definition.id, definition]));
const chapterById = new Map(campaignChapterDefinitions.map((definition) => [definition.id, definition]));

export const getCampaignObjectiveDefinition = (id: string) => objectiveById.get(id) ?? null;
export const getCampaignChapterDefinition = (id: CampaignChapterId) => {
  const chapter = chapterById.get(id);
  if (!chapter) throw new Error(`Unknown campaign chapter: ${id}`);
  return chapter;
};

export const createCampaignState = (): CampaignState => ({
  completedObjectiveIds: [],
  log: [],
  nextLogSeq: 1,
});

export const normalizeCampaignState = (
  value: Partial<CampaignState> | null | undefined,
): CampaignState => {
  const completedObjectiveIds: string[] = [];
  if (Array.isArray(value?.completedObjectiveIds)) {
    for (const id of value.completedObjectiveIds) {
      if (typeof id === "string" && objectiveById.has(id) && !completedObjectiveIds.includes(id)) {
        completedObjectiveIds.push(id);
      }
    }
  }
  const log: CampaignLogEntry[] = [];
  if (Array.isArray(value?.log)) {
    for (const entry of value.log) {
      if (
        typeof entry === "object" &&
        entry !== null &&
        typeof entry.seq === "number" &&
        Number.isFinite(entry.seq) &&
        typeof entry.objectiveId === "string" &&
        objectiveById.has(entry.objectiveId)
      ) {
        const definition = objectiveById.get(entry.objectiveId)!;
        log.push({
          seq: Math.max(1, Math.trunc(entry.seq)),
          objectiveId: entry.objectiveId,
          label: definition.label,
          text: definition.transmission,
        });
      }
    }
  }
  log.sort((a, b) => a.seq - b.seq);
  const trimmed = log.slice(-CAMPAIGN_LOG_SIZE);
  const maxSeq = trimmed.reduce((max, entry) => Math.max(max, entry.seq), 0);
  const nextLogSeq =
    typeof value?.nextLogSeq === "number" && Number.isFinite(value.nextLogSeq)
      ? Math.max(maxSeq + 1, Math.trunc(value.nextLogSeq))
      : maxSeq + 1;
  return { completedObjectiveIds, log: trimmed, nextLogSeq: Math.max(1, nextLogSeq) };
};

/**
 * Complete every newly-satisfied objective and append its transmission.
 * Returns the input state unchanged (same reference) when nothing completes.
 * Called after every action and after every resolved turn, so the log order is
 * chronological and deterministic for a given play sequence.
 */
export const updateCampaignProgress = (state: GameState): GameState => {
  const campaign = state.campaign;
  if (campaign.completedObjectiveIds.length >= campaignObjectiveDefinitions.length) return state;
  const done = new Set(campaign.completedObjectiveIds);
  let additions: CampaignObjectiveDefinition[] | null = null;
  for (const definition of campaignObjectiveDefinitions) {
    if (done.has(definition.id)) continue;
    if (definition.requirement(state)) (additions ??= []).push(definition);
  }
  if (!additions) return state;
  const completedObjectiveIds = [...campaign.completedObjectiveIds];
  const log = [...campaign.log];
  let seq = campaign.nextLogSeq;
  for (const definition of additions) {
    completedObjectiveIds.push(definition.id);
    log.push({ seq: seq++, objectiveId: definition.id, label: definition.label, text: definition.transmission });
  }
  if (log.length > CAMPAIGN_LOG_SIZE) log.splice(0, log.length - CAMPAIGN_LOG_SIZE);
  return { ...state, campaign: { completedObjectiveIds, log, nextLogSeq: seq } };
};

// ---- selectors --------------------------------------------------------------

export interface VisibleCampaignObjective {
  id: string;
  chapterId: CampaignChapterId;
  label: string;
  description: string;
  transmission: string;
  completed: boolean;
  /** null when completed */
  blockedReason: string | null;
}

export interface VisibleCampaignChapter {
  id: CampaignChapterId;
  index: number;
  name: string;
  description: string;
  completed: boolean;
  objectives: VisibleCampaignObjective[];
}

export interface VisibleCampaign {
  chapters: VisibleCampaignChapter[];
  /** first chapter with an incomplete objective (last chapter once done) */
  currentChapterId: CampaignChapterId;
  /** first incomplete objective of the current chapter; null when all done */
  currentObjective: VisibleCampaignObjective | null;
  completedCount: number;
  totalCount: number;
}

export const getVisibleCampaign = (state: GameState): VisibleCampaign => {
  const done = new Set(state.campaign.completedObjectiveIds);
  const chapters: VisibleCampaignChapter[] = campaignChapterDefinitions.map((chapter) => {
    const objectives = chapter.objectiveIds.map((id) => {
      const definition = objectiveById.get(id)!;
      const completed = done.has(id);
      return {
        id,
        chapterId: chapter.id,
        label: definition.label,
        description: definition.description,
        transmission: definition.transmission,
        completed,
        blockedReason: completed ? null : definition.blockedReason,
      };
    });
    return {
      id: chapter.id,
      index: chapter.index,
      name: chapter.name,
      description: chapter.description,
      completed: objectives.every((objective) => objective.completed),
      objectives,
    };
  });
  const currentChapter = chapters.find((chapter) => !chapter.completed) ?? chapters[chapters.length - 1]!;
  return {
    chapters,
    currentChapterId: currentChapter.id,
    currentObjective: currentChapter.objectives.find((objective) => !objective.completed) ?? null,
    completedCount: done.size,
    totalCount: campaignObjectiveDefinitions.length,
  };
};
