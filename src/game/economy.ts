import {
  amount,
  amountAdd,
  amountCompare,
  amountMultiply,
  amountPow,
  amountSubtract,
  type Amount,
  type AmountInput,
} from "./amount";
import { getHardwareCost, HARDWARE_MAX_LEVEL } from "./hardware";
import { getResearchDefinition, hasResearch } from "./research";
import type { HardwareKind, HubState, ResearchId } from "./types";

export interface Price {
  credits: AmountInput;
  data: AmountInput;
}

export const zeroPrice: Price = { credits: amount(0), data: amount(0) };

export const canAfford = (hub: HubState, price: Price) =>
  amountCompare(hub.credits, price.credits) >= 0 && amountCompare(hub.data, price.data) >= 0;

export const spend = (hub: HubState, price: Price): HubState => ({
  ...hub,
  credits: amountSubtract(hub.credits, price.credits),
  data: amountSubtract(hub.data, price.data),
});

export const getHardwareBlockedReason = (hub: HubState, kind: HardwareKind): string | null => {
  const level = hub.hardware[kind];
  if (level >= HARDWARE_MAX_LEVEL) return "Max level.";
  if (!canAfford(hub, getHardwareCost(kind, level))) return "Insufficient resources.";
  return null;
};

export const buyHardware = (hub: HubState, kind: HardwareKind): HubState => {
  if (getHardwareBlockedReason(hub, kind)) return hub;
  const level = hub.hardware[kind];
  const paid = spend(hub, getHardwareCost(kind, level));
  return { ...paid, hardware: { ...paid.hardware, [kind]: level + 1 } };
};

export const getResearchBlockedReason = (hub: HubState, id: ResearchId): string | null => {
  const definition = getResearchDefinition(id);
  if (hasResearch(hub, id)) return "Already researched.";
  if (!canAfford(hub, { credits: definition.costCredits, data: definition.costData })) {
    return "Insufficient Data.";
  }
  return null;
};

export const buyResearch = (hub: HubState, id: ResearchId): HubState => {
  if (getResearchBlockedReason(hub, id)) return hub;
  const definition = getResearchDefinition(id);
  const paid = spend(hub, { credits: definition.costCredits, data: definition.costData });
  return { ...paid, research: { completed: [...paid.research.completed, id] } };
};

/**
 * Kill reward: 1 × 1.15^(depth-1) credits (v2: kills pay pocket change; work
 * pays). `multiplier` stays for boss bounties and future research. Exact.
 */
export const getKillCredits = (depth: number, multiplier: AmountInput = 1): Amount =>
  amountMultiply(amountPow("1.15", Math.max(0, Math.trunc(depth) - 1)), multiplier);

export const DATA_PER_NEW_DEPTH = 5;

/**
 * Banked Data = dataMined + 5 × each new max depth. BREAKING (approved,
 * spec §8): the v1 floor(credits/10) conversion is removed — Data is mined,
 * not rebated.
 */
export const computeBankedData = (dataMined: number, newDepths: number): Amount =>
  amountAdd(Math.max(0, dataMined), DATA_PER_NEW_DEPTH * Math.max(0, newDepths));

export const bankIntoHub = (hub: HubState, credits: AmountInput, data: AmountInput): HubState => ({
  ...hub,
  credits: amountAdd(hub.credits, credits),
  data: amountAdd(hub.data, data),
  stats: { ...hub.stats, lifetimeCredits: amountAdd(hub.stats.lifetimeCredits, credits) },
});
