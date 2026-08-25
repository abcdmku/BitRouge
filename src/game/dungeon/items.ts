import type { ItemKind } from "../renderSnapshot";
import { nextRngFloat, type RngResult, type Xoshiro128State } from "../rng";
import { MAX_ITEM_SLOTS } from "../hero";
import type { FloorItem, HeroStats, RunState } from "../types";
import { pushEvent } from "./draft";

export interface ItemDefinition {
  kind: ItemKind;
  name: string;
  description: string;
  /** usable items go to inventory; instant items apply on pickup */
  usable: boolean;
  weight: number;
}

export const itemDefinitions: Record<ItemKind, ItemDefinition> = {
  patch: { kind: "patch", name: "Patch", description: "Restore 50% HP.", usable: true, weight: 4 },
  hotfix: { kind: "hotfix", name: "Hotfix", description: "+2 attack for 15 turns.", usable: true, weight: 2 },
  cacheLine: { kind: "cacheLine", name: "Cache Line", description: "Reveals the floor layout.", usable: false, weight: 1 },
  heatsink: { kind: "heatsink", name: "Heatsink", description: "Clears all heat.", usable: true, weight: 2 },
  checkpoint: { kind: "checkpoint", name: "Checkpoint", description: "+1 revive this run.", usable: false, weight: 1 },
  coreDump: { kind: "coreDump", name: "Core Dump", description: "Salvage Data on pickup.", usable: false, weight: 2 },
};

export const HOTFIX_ATTACK_BONUS = 2;
export const HOTFIX_TURNS = 15;

export const pickItemKind = (rng: Xoshiro128State): RngResult<ItemKind> => {
  const pool = Object.values(itemDefinitions);
  const total = pool.reduce((sum, definition) => sum + definition.weight, 0);
  const next = nextRngFloat(rng);
  let roll = next.value * total;
  for (const definition of pool) {
    roll -= definition.weight;
    if (roll < 0) return { state: next.state, value: definition.kind };
  }
  return { state: next.state, value: pool[pool.length - 1]!.kind };
};

export const getCoreDumpData = (depth: number, stats: HeroStats) =>
  (1 + Math.floor(depth / 2)) * stats.coreDumpMultiplier;

/** Try to pick up an item under the hero. Returns false when the inventory is full. */
export const pickUpItem = (run: RunState, stats: HeroStats, item: FloorItem): boolean => {
  const definition = itemDefinitions[item.kind];
  if (definition.usable) {
    if (run.hero.items.length >= MAX_ITEM_SLOTS) return false;
    run.hero.items.push(item.kind);
  } else if (item.kind === "cacheLine") {
    run.floor.explored = run.floor.explored.map(() => true);
  } else if (item.kind === "checkpoint") {
    run.hero.checkpoint += 1;
  } else if (item.kind === "coreDump") {
    // v2: all Data flows through dataMined (salvageData is a v1 leftover)
    run.dataMined += getCoreDumpData(run.depth, stats);
  }
  run.items = run.items.filter((candidate) => candidate.id !== item.id);
  pushEvent(run, { kind: "itemPicked", id: item.id, itemKind: item.kind, x: item.x, y: item.y });
  return true;
};

/** Consume an inventory slot. Returns false when the slot is empty. */
export const useItem = (run: RunState, slot: number): boolean => {
  const kind = run.hero.items[slot];
  if (!kind) return false;
  const hero = run.hero;
  switch (kind) {
    case "patch":
      hero.hp = Math.min(hero.maxHp, hero.hp + Math.ceil(hero.maxHp / 2));
      break;
    case "hotfix":
      hero.buffs.push({ kind: "attack", value: HOTFIX_ATTACK_BONUS, turnsLeft: HOTFIX_TURNS });
      break;
    case "heatsink":
      hero.heat = 0;
      if (hero.throttled) {
        hero.throttled = false;
        pushEvent(run, { kind: "throttled", on: false });
      }
      break;
    default:
      return false;
  }
  hero.items.splice(slot, 1);
  pushEvent(run, { kind: "itemUsed", itemKind: kind });
  return true;
};

export const findItemSlot = (run: RunState, kind: ItemKind) => run.hero.items.indexOf(kind);
