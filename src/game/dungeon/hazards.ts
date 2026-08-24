import { amountCompare } from "../amount";
import type { HazardKind } from "../renderSnapshot";
import type { FloorHazard, FloorState, RunState } from "../types";
import { hurtHero, pushEvent } from "./draft";

export const HOT_TILE_HEAT = 4;
export const CORRUPTED_SECTOR_DAMAGE = 2;

export const hazardNames: Record<HazardKind, string> = {
  hotTile: "Hot Tile",
  overloadPlate: "Overload Plate",
  corruptedSector: "Corrupted Sector",
  brownout: "Brownout",
};

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
      hurtHero(run, CORRUPTED_SECTOR_DAMAGE, null, hazardNames.corruptedSector);
      return;
    case "brownout":
      if (amountCompare(run.credits, 0) <= 0) run.hero.skipNextTurn = true;
      return;
    default:
      return;
  }
};
