import { TileKind } from "../renderSnapshot";
import { createRngState } from "../rng";
import { generateFloor, getEnemyCount, getHazardCount, getItemCount } from "./generate";
import { FLOOR_HEIGHT, FLOOR_WIDTH, isWalkableTile, toIndex } from "./grid";
import { bfsDistances } from "./path";

describe("generateFloor", () => {
  it("is deterministic for the same seed", () => {
    const a = generateFloor(createRngState(123), 1, 1);
    const b = generateFloor(createRngState(123), 1, 1);
    expect(a).toEqual(b);
    const c = generateFloor(createRngState(124), 1, 1);
    expect(c.floor.tiles).not.toEqual(a.floor.tiles);
  });

  it("never throws and every walkable tile is reachable from the spawn (500 seeds)", () => {
    for (let seed = 1; seed <= 500; seed += 1) {
      const depth = 1 + (seed % 6);
      const generated = generateFloor(createRngState(seed), depth, 1);
      const { floor, spawn, rooms, enemies, items } = generated;
      expect(floor.width).toBe(FLOOR_WIDTH);
      expect(floor.height).toBe(FLOOR_HEIGHT);
      expect(rooms.length).toBeGreaterThanOrEqual(2);
      expect(rooms.length).toBeLessThanOrEqual(12);
      const distances = bfsDistances(floor, spawn, (index) => isWalkableTile(floor.tiles[index] ?? null));
      for (let index = 0; index < floor.tiles.length; index += 1) {
        if (isWalkableTile(floor.tiles[index] ?? null)) expect(distances[index]).not.toBe(Number.POSITIVE_INFINITY);
      }
      expect(floor.tiles[toIndex(floor.stairs.x, floor.stairs.y, floor.width)]).toBe(TileKind.stairsDown);
      expect(floor.tiles[toIndex(spawn.x, spawn.y, floor.width)]).toBe(TileKind.floor);
      expect(enemies.length).toBe(getEnemyCount(depth));
      expect(items.length).toBe(getItemCount(depth));
      expect(floor.hazards.length).toBe(getHazardCount(depth));
      // no two entities share a cell, nothing sits on the spawn
      const cells = new Set<number>();
      for (const entity of [...enemies, ...items]) {
        const index = toIndex(entity.x, entity.y, floor.width);
        expect(cells.has(index)).toBe(false);
        cells.add(index);
        expect(index).not.toBe(toIndex(spawn.x, spawn.y, floor.width));
      }
      for (const hazard of floor.hazards) {
        expect(cells.has(hazard.index)).toBe(false);
        cells.add(hazard.index);
      }
      const ids = [...enemies, ...items].map((entity) => entity.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(generated.nextEntityId).toBe(1 + ids.length);
    }
  });

  it("only spawns enemy kinds allowed at the depth", () => {
    const shallow = generateFloor(createRngState(9), 1, 1);
    for (const enemy of shallow.enemies) expect(["bitFlip", "nullPointer", "memoryLeak"]).toContain(enemy.kind);
  });
});
