import { TileKind } from "../renderSnapshot";
import { createRngState } from "../rng";
import {
  generateFloor,
  getEnemyCount,
  getHazardCount,
  getItemCount,
  MIN_HAUL_DISTANCE,
  type GeneratedFloor,
} from "./generate";
import { FLOOR_HEIGHT, FLOOR_WIDTH, isWalkableTile, manhattan, neighbors4, toIndex, toPoint, VENT_TILE } from "./grid";
import { bfsDistances } from "./path";
import { getQuotaPlan, getTier, isControllerDepth, TIER_QUOTA_PLANS } from "./tiers";
import { computeQuotaRequired } from "./worksites";

/** Depth sweep covering every tier (incl. controller floors 3, 7, 11, 15). */
const SWEEP_DEPTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15] as const;

const walkable = (generated: GeneratedFloor) => (index: number) =>
  isWalkableTile(generated.floor.tiles[index] ?? null);

const renderAscii = (generated: GeneratedFloor): string => {
  const { floor, sites, payloads, spawn, enemies } = generated;
  const chars: string[] = floor.tiles.map((tile) =>
    tile === TileKind.wall
      ? "#"
      : tile === TileKind.door
        ? "+"
        : tile === TileKind.stairsDown
          ? ">"
          : tile === VENT_TILE
            ? "V"
            : ".",
  );
  for (const hazard of floor.hazards) {
    if (hazard.kind === "corruptedSector") chars[hazard.index] = "~";
  }
  for (const site of sites) {
    chars[toIndex(site.x, site.y, floor.width)] =
      site.kind === "dataNode" ? "N" : site.kind === "jobStation" ? "J" : "O";
  }
  for (const payload of payloads) chars[toIndex(payload.x, payload.y, floor.width)] = "P";
  for (const enemy of enemies) {
    if (enemy.kind === "kernelPanic") chars[toIndex(enemy.x, enemy.y, floor.width)] = "B";
  }
  chars[toIndex(spawn.x, spawn.y, floor.width)] = "@";
  const lines: string[] = [];
  for (let y = 0; y < floor.height; y += 1) {
    lines.push(chars.slice(y * floor.width, (y + 1) * floor.width).join(""));
  }
  return lines.join("\n");
};

describe("generateFloor (v2 tier carvers)", () => {
  it("is deterministic for the same seed and diverges across seeds", () => {
    for (const depth of [1, 5, 9, 13]) {
      const a = generateFloor(createRngState(123), depth, 1);
      const b = generateFloor(createRngState(123), depth, 1);
      expect(a).toEqual(b);
      const c = generateFloor(createRngState(124), depth, 1);
      expect(c.floor.tiles).not.toEqual(a.floor.tiles);
    }
  });

  it("prints one sample floor per tier (report artifact)", () => {
    for (const depth of [1, 5, 9, 13]) {
      const generated = generateFloor(createRngState(7), depth, 1);
      // eslint-disable-next-line no-console
      console.log(
        `tier=${generated.tier} depth=${depth} quota=${generated.quota.required}/${generated.sites.length} sites\n${renderAscii(generated)}`,
      );
    }
  });

  it("carves connected floors with quota-locked gates and §3 site rolls (500 seeds)", () => {
    // aggregate placement-preference counters (hard invariants are asserted per floor)
    let ramNodes = 0;
    let ramNodesAtBankEnds = 0;
    let diskNodes = 0;
    let diskNodesOuterBand = 0;
    for (let seed = 1; seed <= 500; seed += 1) {
      const depth = SWEEP_DEPTHS[seed % SWEEP_DEPTHS.length]!;
      const tier = getTier(depth);
      const plan = getQuotaPlan(depth);
      const generated = generateFloor(createRngState(seed), depth, 1);
      const { floor, spawn, sites, payloads, enemies, items } = generated;
      expect(generated.tier).toBe(tier);
      expect(floor.width).toBe(FLOOR_WIDTH);
      expect(floor.height).toBe(FLOOR_HEIGHT);

      // connectivity: every walkable tile reaches the spawn
      const distances = bfsDistances(floor, spawn, walkable(generated));
      for (let index = 0; index < floor.tiles.length; index += 1) {
        if (isWalkableTile(floor.tiles[index] ?? null)) {
          expect(distances[index]).not.toBe(Number.POSITIVE_INFINITY);
        }
      }
      // exit is the bus gate: stairsDown tile, locked until the quota is met
      expect(floor.tiles[toIndex(floor.stairs.x, floor.stairs.y, floor.width)]).toBe(TileKind.stairsDown);
      expect(floor.stairsLocked).toBe(true);
      expect(isWalkableTile(floor.tiles[toIndex(spawn.x, spawn.y, floor.width)] ?? null)).toBe(true);

      // §3 site roll: exact mix, quota from the tier table
      const nodes = sites.filter((site) => site.kind === "dataNode");
      const jobs = sites.filter((site) => site.kind === "jobStation");
      const ports = sites.filter((site) => site.kind === "ioPort");
      expect(nodes.length).toBe(plan.nodes);
      expect(jobs.length).toBe(plan.jobs);
      expect(ports.length).toBe(plan.hauls);
      expect(payloads.length).toBe(plan.hauls);
      expect(sites.length).toBe(plan.sites);
      expect(generated.quota).toEqual({ required: plan.required, done: 0 });
      expect(generated.quota.required).toBe(computeQuotaRequired(depth, sites, payloads));

      // payload/port pairing and the >= 12 BFS haul separation
      for (const payload of payloads) {
        const port = ports.find((site) => site.id === payload.portId);
        expect(port).toBeDefined();
        expect(payload.heldBy).toBe("floor");
        const fromPayload = bfsDistances(floor, payload, walkable(generated));
        expect(fromPayload[toIndex(port!.x, port!.y, floor.width)]).toBeGreaterThanOrEqual(MIN_HAUL_DISTANCE);
      }

      // every site/payload on a reachable walkable cell, all cells distinct
      const cells = new Set<number>();
      const spawnIndex = toIndex(spawn.x, spawn.y, floor.width);
      for (const entity of [...sites, ...payloads, ...enemies, ...items]) {
        const index = toIndex(entity.x, entity.y, floor.width);
        expect(isWalkableTile(floor.tiles[index] ?? null)).toBe(true);
        expect(distances[index]).not.toBe(Number.POSITIVE_INFINITY);
        expect(cells.has(index)).toBe(false);
        cells.add(index);
        expect(index).not.toBe(spawnIndex);
      }
      for (const hazard of floor.hazards) {
        expect(hazard.index).not.toBe(spawnIndex);
        expect(isWalkableTile(floor.tiles[hazard.index] ?? null)).toBe(true);
      }

      // vents: 1-2 per floor, near a job station
      const vents: number[] = [];
      for (let index = 0; index < floor.tiles.length; index += 1) {
        if (floor.tiles[index] === VENT_TILE) vents.push(index);
      }
      expect(vents.length).toBeGreaterThanOrEqual(1);
      expect(vents.length).toBeLessThanOrEqual(2);
      for (const vent of vents) {
        const point = toPoint(vent, floor.width);
        expect(jobs.some((job) => manhattan(job, point) <= 6)).toBe(true);
      }

      // controller floors: a kernelPanic guards the bus gate
      const bosses = enemies.filter((enemy) => enemy.kind === "kernelPanic");
      if (isControllerDepth(depth)) {
        expect(bosses.length).toBe(1);
        expect(manhattan(bosses[0]!, floor.stairs)).toBe(1);
      } else {
        expect(bosses.length).toBe(0);
      }

      // population counts and id uniqueness
      expect(enemies.length).toBe(getEnemyCount(depth) + bosses.length);
      expect(items.length).toBe(getItemCount(depth));
      expect(floor.hazards.length).toBeGreaterThanOrEqual(getHazardCount(depth));
      const ids = [...sites, ...payloads, ...enemies, ...items].map((entity) => entity.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(generated.nextEntityId).toBe(1 + ids.length);

      // tier-specific placement preferences
      if (tier === "cache") {
        // dead-end banks: the region around a node (bounded by doors) has one gate
        for (const node of nodes) {
          const region = new Set<number>([toIndex(node.x, node.y, floor.width)]);
          const queue = [node as { x: number; y: number }];
          const gates = new Set<number>();
          while (queue.length > 0) {
            const cell = queue.pop()!;
            for (const n of neighbors4(floor, cell.x, cell.y)) {
              const index = toIndex(n.x, n.y, floor.width);
              const tile = floor.tiles[index]!;
              if (tile === TileKind.door) {
                gates.add(index);
                continue;
              }
              if (!isWalkableTile(tile) || region.has(index)) continue;
              region.add(index);
              queue.push(n);
            }
          }
          expect(gates.size).toBe(1);
          expect(region.size).toBeLessThanOrEqual(12);
        }
      }
      if (tier === "ram") {
        for (const node of nodes) {
          ramNodes += 1;
          if (node.x <= 9 || node.x >= FLOOR_WIDTH - 10) ramNodesAtBankEnds += 1;
        }
      }
      if (tier === "disk") {
        for (const node of nodes) {
          diskNodes += 1;
          if (Math.max(Math.abs(node.x - 23), Math.abs(node.y - 15)) >= 7) diskNodesOuterBand += 1;
        }
      }
      // kernel corruption pass: corruptedSector hazards exist beyond the base roll
      if (tier === "kernel") {
        const corrupted = floor.hazards.filter((hazard) => hazard.kind === "corruptedSector");
        expect(corrupted.length).toBeGreaterThan(0);
      }
    }
    // placement preferences hold in the vast majority of rolls
    expect(ramNodesAtBankEnds / ramNodes).toBeGreaterThanOrEqual(0.9);
    expect(diskNodesOuterBand / diskNodes).toBeGreaterThanOrEqual(0.9);
  }, 60_000);

  it("quota plans cover every tier and stay internally consistent", () => {
    for (const plan of Object.values(TIER_QUOTA_PLANS)) {
      expect(plan.nodes + plan.jobs + plan.hauls).toBe(plan.sites);
      expect(plan.required).toBeLessThanOrEqual(plan.sites);
      expect(plan.required).toBeGreaterThan(0);
    }
  });
});
