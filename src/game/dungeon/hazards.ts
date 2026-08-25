import { amountCompare } from "../amount";
import { getTier, type HazardKind, type Tier } from "../renderSnapshot";
import type { FloorHazard, FloorState, RunState } from "../types";
import { hurtHero, pushEvent } from "./draft";

export const HOT_TILE_HEAT = 4;
export const CORRUPTED_SECTOR_DAMAGE = 2;

/** Tier-neutral base names (v1 compat; prefer `getHazardName`). */
export const hazardNames: Record<HazardKind, string> = {
  hotTile: "Hot Tile",
  overloadPlate: "Overload Plate",
  corruptedSector: "Corrupted Sector",
  brownout: "Brownout",
};

/**
 * v2 retheme: the same four mechanics read as the tier's own failure modes.
 * cache = silicon, ram = banks/refresh, disk = platters/sectors, kernel = raw
 * machine faults.
 */
export const TIER_HAZARD_NAMES: Record<Tier, Record<HazardKind, string>> = {
  cache: {
    hotTile: "Hot Cache Line",
    overloadPlate: "Bus Contention Plate",
    corruptedSector: "Parity Error Cell",
    brownout: "Clock Gating Zone",
  },
  ram: {
    hotTile: "Refresh Storm Row",
    overloadPlate: "Row Hammer Plate",
    corruptedSector: "ECC Fault Bank",
    brownout: "Voltage Sag Zone",
  },
  disk: {
    hotTile: "Spindle Friction Track",
    overloadPlate: "Head Crash Plate",
    corruptedSector: "Bad Sector",
    brownout: "Spin-Down Zone",
  },
  kernel: {
    hotTile: "Panic Residue",
    overloadPlate: "Interrupt Storm Plate",
    corruptedSector: "Corrupted Page",
    brownout: "Power Fault Zone",
  },
};

/** Display name for a hazard on a floor of the given depth's tier. */
export const getHazardName = (kind: HazardKind, depth: number): string =>
  TIER_HAZARD_NAMES[getTier(depth)][kind];

export const findHazardAt = (floor: FloorState, index: number): FloorHazard | undefined =>
  floor.hazards.find((hazard) => hazard.index === index);

/** Fires when the hero steps onto a hazard tile. */
export const triggerHazard = (run: RunState, hazard: FloorHazard) => {
  const x = hazard.index % run.floor.width;
  const y = (hazard.index - x) / run.floor.width;
  pushEvent(run, { kind: "hazardTriggered", hazard: hazard.kind, x, y });
  switch (hazard.kind) {
    case "hotTile":
      run.hero.heat += HOT_TILE_HEAT;
      return;
    case "overloadPlate":
      run.hero.skipNextTurn = true;
      pushEvent(run, { kind: "tripped" });
      return;
    case "corruptedSector":
      // named failure per the v2 death-cause list
      hurtHero(run, CORRUPTED_SECTOR_DAMAGE, null, "Corrupted sector");
      return;
    case "brownout":
      if (amountCompare(run.credits, 0) <= 0) run.hero.skipNextTurn = true;
      return;
    default:
      return;
  }
};
