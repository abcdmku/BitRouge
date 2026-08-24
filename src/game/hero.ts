import { amount } from "./amount";
import {
  getAttack,
  getClockHz,
  getDaemonSlots,
  getHeatDissipation,
  getMaxHp,
  getPowerBudget,
} from "./hardware";
import { getResearchDefinition, hasResearch, researchDefinitions } from "./research";
import type { HeroState, HeroStats, HubState, ResearchId } from "./types";

export const BASE_FOV_RADIUS = 6;
export const ATTACK_HEAT = 2;
export const THROTTLE_ON_HEAT = 10;
export const THROTTLE_OFF_HEAT = 4;
export const MAX_ITEM_SLOTS = 6;
export const ITEM_WATTS = 1;
export const DEADLOCK_LOCK_TURNS = 10;
export const RETREAT_TURN_BUDGET = 5;

export const deriveHeroStats = (hub: HubState): HeroStats => {
  const daemonSlots = getDaemonSlots(hub.hardware.cores) + (hasResearch(hub, "multiCore") ? 1 : 0);
  const activeDaemons: ResearchId[] = [];
  for (const definition of researchDefinitions) {
    if (!definition.daemon || !hasResearch(hub, definition.id)) continue;
    if (activeDaemons.length >= daemonSlots) break;
    activeDaemons.push(definition.id);
  }
  const daemonDraw = activeDaemons.reduce(
    (total, id) => total + getResearchDefinition(id).watts,
    0,
  );
  const powerBudget =
    getPowerBudget(hub.hardware.psu) * (hasResearch(hub, "redundantRail") ? 1.5 : 1);
  return {
    attack: getAttack(hub.hardware.cache),
    maxHp: getMaxHp(hub.hardware.ram),
    clockHz: getClockHz(hub.hardware.clock),
    powerBudget,
    heatDissipation:
      getHeatDissipation(hub.hardware.cooling) + (activeDaemons.includes("thermalSensors") ? 1 : 0),
    schedulerLevel: hub.hardware.scheduler + (hasResearch(hub, "priorityScheduler") ? 1 : 0),
    daemonSlots,
    activeDaemons,
    fovRadius: BASE_FOV_RADIUS + (hasResearch(hub, "cacheMapping") ? 2 : 0),
    killCreditMultiplier: amount(hasResearch(hub, "bugBounty") ? "1.25" : "1"),
    startingRevives: hasResearch(hub, "checkpointing") ? 1 : 0,
    daemonDraw,
    zombiesRevive: !activeDaemons.includes("processReaper"),
    coreDumpMultiplier: hasResearch(hub, "coreDumpAnalysis") ? 2 : 1,
  };
};

export const createHeroState = (stats: HeroStats, x: number, y: number): HeroState => ({
  x,
  y,
  facing: "r",
  hp: stats.maxHp,
  maxHp: stats.maxHp,
  heat: 0,
  throttled: false,
  lockedTurns: 0,
  items: [],
  buffs: [],
  checkpoint: stats.startingRevives,
  powerDebt: 0,
  skipNextTurn: false,
  retreatTurns: 0,
});

export const getHeroAttack = (hero: HeroState, stats: HeroStats) =>
  stats.attack + hero.buffs.reduce((total, buff) => total + buff.value, 0);

export const getHeroPowerDraw = (hero: HeroState, stats: HeroStats) =>
  stats.daemonDraw + hero.items.length * ITEM_WATTS;
