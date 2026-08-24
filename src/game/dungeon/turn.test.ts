import { amount } from "../amount";
import { createHeroState, deriveHeroStats } from "../hero";
import { createInitialHubState } from "../initialState";
import { TileKind, type EnemyKind, type RunEvent } from "../renderSnapshot";
import { createRngState } from "../rng";
import type { Enemy, FloorState, HeroStats, RunState } from "../types";
import { createEnemy } from "./enemies";
import { toIndex } from "./grid";
import { resolveTurn } from "./turn";

const W = 12;
const H = 12;

const makeFloor = (): FloorState => {
  const tiles = new Array<FloorState["tiles"][number]>(W * H).fill(TileKind.floor);
  for (let x = 0; x < W; x += 1) {
    tiles[toIndex(x, 0, W)] = TileKind.wall;
    tiles[toIndex(x, H - 1, W)] = TileKind.wall;
  }
  for (let y = 0; y < H; y += 1) {
    tiles[toIndex(0, y, W)] = TileKind.wall;
    tiles[toIndex(W - 1, y, W)] = TileKind.wall;
  }
  tiles[toIndex(9, 9, W)] = TileKind.stairsDown;
  return {
    width: W,
    height: H,
    tiles,
    explored: new Array<boolean>(W * H).fill(true),
    visible: new Array<boolean>(W * H).fill(true),
    stairs: { x: 9, y: 9 },
    hazards: [],
  };
};

const baseStats = (): HeroStats => deriveHeroStats(createInitialHubState());

let nextId = 1;
const enemy = (kind: EnemyKind, x: number, y: number, overrides: Partial<Enemy> = {}): Enemy => ({
  ...createEnemy(kind, 1, nextId++, x, y),
  alerted: true,
  ...overrides,
});

const makeRun = (overrides: Partial<RunState> = {}, stats = baseStats()): RunState => ({
  seed: 1,
  rng: createRngState(1),
  depth: 1,
  maxDepthReached: 1,
  turn: 0,
  status: "active",
  deathCause: null,
  control: "auto",
  turnAccumulatorMs: 0,
  elapsedMs: 0,
  credits: amount(0),
  salvageData: 0,
  kills: 0,
  hero: createHeroState(stats, 2, 2),
  floor: makeFloor(),
  enemies: [],
  items: [],
  events: [],
  nextEventSeq: 1,
  nextEntityId: 100,
  pendingPath: null,
  autoPath: null,
  ...overrides,
});

const kinds = (run: RunState) => run.events.map((event) => event.kind);
const lastOf = <K extends RunEvent["kind"]>(run: RunState, kind: K) =>
  [...run.events].reverse().find((event): event is Extract<RunEvent, { kind: K }> => event.kind === kind);

describe("resolveTurn", () => {
  it("is pure: the input run is not mutated and seq is monotonic", () => {
    const run = makeRun({ enemies: [enemy("bitFlip", 5, 2)] });
    const snapshot = JSON.stringify(run);
    const next = resolveTurn(run, { type: "move", dir: "e" }, baseStats());
    expect(JSON.stringify(run)).toBe(snapshot);
    expect(next.turn).toBe(1);
    const seqs = next.events.map((event) => event.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it("bitFlip chases the hero and attacks when adjacent", () => {
    let run = makeRun({ enemies: [enemy("bitFlip", 6, 2)] });
    const stats = baseStats();
    for (let i = 0; i < 3; i += 1) run = resolveTurn(run, { type: "wait" }, stats);
    expect(run.enemies[0]!.x).toBe(3);
    run = resolveTurn(run, { type: "wait" }, stats);
    expect(kinds(run)).toContain("heroHurt");
    expect(run.hero.hp).toBe(run.hero.maxHp - 1);
  });

  it("bump attacks; killing banks credits and kills", () => {
    let run = makeRun({ enemies: [enemy("bitFlip", 3, 2, { hp: 1 })] });
    run = resolveTurn(run, { type: "move", dir: "e" }, baseStats());
    expect(run.enemies).toHaveLength(0);
    expect(run.kills).toBe(1);
    expect(run.credits).toBe("2.4");
    expect(lastOf(run, "enemyDied")?.credits).toBe("2.4");
    expect(run.hero.x).toBe(2);
  });

  it("nullPointer lunges along a line and attacks in the same turn", () => {
    const run = makeRun({ enemies: [enemy("nullPointer", 5, 2)] });
    const next = resolveTurn(run, { type: "wait" }, baseStats());
    expect(next.enemies[0]!.x).toBe(3);
    expect(kinds(next)).toContain("heroHurt");
    expect(next.hero.hp).toBe(next.hero.maxHp - 1);
  });

  it("memoryLeak is slow and each hit lowers max HP for the floor", () => {
    let run = makeRun({ enemies: [enemy("memoryLeak", 3, 2)] });
    const stats = baseStats();
    run = resolveTurn(run, { type: "wait" }, stats);
    expect(run.hero.maxHp).toBe(7);
    expect(run.hero.hp).toBe(6);
    run = resolveTurn(run, { type: "wait" }, stats);
    expect(run.hero.maxHp).toBe(7); // cooldown turn
    run = resolveTurn(run, { type: "wait" }, stats);
    expect(run.hero.maxHp).toBe(6);
    // descending restores hardware max HP
    run = { ...run, hero: { ...run.hero, x: 9, y: 9 } };
    run = resolveTurn(run, { type: "descend" }, stats);
    expect(run.depth).toBe(2);
    expect(run.hero.maxHp).toBe(8);
  });

  it("deadlock pins the hero; 10 locked turns cost 25% of run credits and release it", () => {
    let run = makeRun({ enemies: [enemy("deadlock", 3, 2)], credits: amount(100) });
    const stats = baseStats();
    run = resolveTurn(run, { type: "move", dir: "w" }, stats);
    expect(run.hero.x).toBe(2); // movement refused while locked
    expect(run.hero.lockedTurns).toBe(1);
    for (let i = 0; i < 8; i += 1) run = resolveTurn(run, { type: "wait" }, stats);
    expect(run.hero.lockedTurns).toBe(9);
    expect(run.credits).toBe("100");
    run = resolveTurn(run, { type: "wait" }, stats);
    expect(run.credits).toBe("75");
    expect(lastOf(run, "deadlockPenalty")?.creditsLost).toBe("25");
    expect(run.enemies).toHaveLength(0);
    expect(run.hero.lockedTurns).toBe(0);
    expect(run.hero.hp).toBe(run.hero.maxHp); // deadlocks never deal damage
  });

  it("forkBomb splits when hit and survives", () => {
    const run = makeRun({ enemies: [enemy("forkBomb", 3, 2, { hp: 6, maxHp: 6 })] });
    const next = resolveTurn(run, { type: "move", dir: "e" }, baseStats());
    const forks = next.enemies.filter((candidate) => candidate.kind === "forkBomb");
    expect(forks).toHaveLength(2);
    expect(forks.reduce((sum, fork) => sum + fork.hp, 0)).toBe(5);
    expect(kinds(next)).toContain("enemySpawned");
    expect(new Set(forks.map((fork) => fork.id)).size).toBe(2);
  });

  it("zombieProcess revives once after three turns, unless the reaper daemon is running", () => {
    const stats = baseStats();
    let run = makeRun({ enemies: [enemy("zombieProcess", 3, 2, { hp: 1 })] });
    run = resolveTurn(run, { type: "move", dir: "e" }, stats);
    expect(run.kills).toBe(1);
    expect(run.enemies).toHaveLength(1);
    expect(run.enemies[0]!.dormantTurns).toBe(2); // 3, ticked once in this turn's enemy phase
    // move away so the corpse cell is free
    run = resolveTurn(run, { type: "move", dir: "w" }, stats);
    expect(run.enemies[0]!.dormantTurns).toBe(1);
    run = resolveTurn(run, { type: "wait" }, stats);
    expect(run.enemies[0]!.dormantTurns).toBe(0);
    expect(run.enemies[0]!.revived).toBe(true);
    expect(run.enemies[0]!.hp).toBe(Math.ceil(run.enemies[0]!.maxHp / 2));
    expect(kinds(run)).toContain("enemySpawned");
    // second death is final
    run = { ...run, enemies: [{ ...run.enemies[0]!, hp: 1, x: 3, y: 2 }], hero: { ...run.hero, x: 2, y: 2 } };
    run = resolveTurn(run, { type: "move", dir: "e" }, stats);
    expect(run.enemies).toHaveLength(0);

    const reaper: HeroStats = { ...stats, zombiesRevive: false };
    let reaped = makeRun({ enemies: [enemy("zombieProcess", 3, 2, { hp: 1 })] });
    reaped = resolveTurn(reaped, { type: "move", dir: "e" }, reaper);
    expect(reaped.enemies).toHaveLength(0);
  });

  it("daemon shoots from range with line of sight and backs away when adjacent", () => {
    const stats = baseStats();
    let run = makeRun({ enemies: [enemy("daemon", 5, 2)] });
    run = resolveTurn(run, { type: "wait" }, stats);
    expect(kinds(run)).toContain("projectile");
    expect(run.hero.hp).toBe(run.hero.maxHp - 1);
    // adjacent: either backs off or fires point-blank (rng), never both
    let retreats = 0;
    let shots = 0;
    for (let seed = 1; seed <= 12; seed += 1) {
      let close = makeRun({ enemies: [enemy("daemon", 3, 2)], rng: createRngState(seed) });
      close = resolveTurn(close, { type: "wait" }, stats);
      if (close.enemies[0]!.x === 4) retreats += 1;
      else if (close.hero.hp === close.hero.maxHp - 1) shots += 1;
    }
    expect(retreats + shots).toBe(12);
    expect(retreats).toBeGreaterThan(0);
    expect(shots).toBeGreaterThan(0);
  });

  it("attacking adds heat; heat >= 10 throttles and enemies act twice", () => {
    const stats = baseStats();
    let run = makeRun({ enemies: [enemy("bitFlip", 3, 2, { hp: 50, maxHp: 50 }), enemy("bitFlip", 7, 2)] });
    run = { ...run, hero: { ...run.hero, heat: 9 } };
    run = resolveTurn(run, { type: "move", dir: "e" }, stats);
    expect(run.hero.heat).toBe(10); // 9 + 2 - 1
    expect(run.hero.throttled).toBe(true);
    expect(lastOf(run, "throttled")?.on).toBe(true);
    const farBefore = run.enemies[1]!.x;
    run = resolveTurn(run, { type: "wait" }, stats);
    expect(farBefore - run.enemies[1]!.x).toBe(2); // two moves in one turn
    // cool down clears the throttle (with hysteresis)
    let cool = { ...run, enemies: [] as Enemy[] };
    for (let i = 0; i < 10 && cool.hero.throttled; i += 1) cool = resolveTurn(cool, { type: "wait" }, stats);
    expect(cool.hero.throttled).toBe(false);
    expect(cool.hero.heat).toBeLessThanOrEqual(4);
  });

  it("PSU overdraw trips: the hero loses turns when the budget is exceeded", () => {
    const stats: HeroStats = { ...baseStats(), powerBudget: 1 };
    let run = makeRun();
    run = { ...run, hero: { ...run.hero, items: ["patch", "patch", "hotfix"] } }; // 3 W vs 1 W budget
    run = resolveTurn(run, { type: "move", dir: "e" }, stats);
    expect(kinds(run)).toContain("tripped");
    expect(run.hero.x).toBe(2); // the action was skipped
    const within: HeroStats = { ...baseStats(), powerBudget: 10 };
    const fine = resolveTurn(makeRun({ hero: { ...run.hero, x: 2 } }), { type: "move", dir: "e" }, within);
    expect(fine.hero.x).toBe(3);
    expect(kinds(fine)).not.toContain("tripped");
  });

  it("hazards: hot tile heats, corrupted sector damages, overload plate and brownout skip a turn", () => {
    const stats = baseStats();
    const at = (x: number, y: number) => toIndex(x, y, W);
    const run = makeRun({
      floor: {
        ...makeFloor(),
        hazards: [
          { index: at(3, 2), kind: "hotTile" },
          { index: at(2, 3), kind: "corruptedSector" },
          { index: at(1, 2), kind: "overloadPlate" },
          { index: at(2, 1), kind: "brownout" },
        ],
      },
    });
    const hot = resolveTurn(run, { type: "move", dir: "e" }, stats);
    expect(hot.hero.heat).toBe(3); // +4 -1 dissipation
    expect(lastOf(hot, "hazardTriggered")?.hazard).toBe("hotTile");
    const corrupt = resolveTurn(run, { type: "move", dir: "s" }, stats);
    expect(corrupt.hero.hp).toBe(run.hero.maxHp - 2);
    let plate = resolveTurn(run, { type: "move", dir: "w" }, stats);
    expect(kinds(plate)).toContain("tripped");
    plate = resolveTurn(plate, { type: "move", dir: "e" }, stats);
    expect(plate.hero.x).toBe(1); // skipped
    let brown = resolveTurn(run, { type: "move", dir: "n" }, stats);
    brown = resolveTurn(brown, { type: "move", dir: "s" }, stats);
    expect(brown.hero.y).toBe(1); // no credits → lost the turn
    let paid = resolveTurn({ ...run, credits: amount(5) }, { type: "move", dir: "n" }, stats);
    paid = resolveTurn(paid, { type: "move", dir: "s" }, stats);
    expect(paid.hero.y).toBe(2);
  });

  it("items: pickup, use, instant effects", () => {
    const stats = baseStats();
    let run = makeRun({
      items: [
        { id: 50, kind: "patch", x: 3, y: 2 },
        { id: 51, kind: "coreDump", x: 4, y: 2 },
        { id: 52, kind: "checkpoint", x: 5, y: 2 },
        { id: 53, kind: "cacheLine", x: 6, y: 2 },
      ],
    });
    run = { ...run, hero: { ...run.hero, hp: 2 }, floor: { ...run.floor, explored: run.floor.explored.map(() => false) } };
    run = resolveTurn(run, { type: "move", dir: "e" }, stats);
    expect(run.hero.items).toEqual(["patch"]);
    expect(lastOf(run, "itemPicked")?.itemKind).toBe("patch");
    run = resolveTurn(run, { type: "useItem", slot: 0 }, stats);
    expect(run.hero.items).toEqual([]);
    expect(run.hero.hp).toBe(6);
    expect(lastOf(run, "itemUsed")?.itemKind).toBe("patch");
    run = resolveTurn(run, { type: "move", dir: "e" }, stats);
    expect(run.salvageData).toBe(1);
    run = resolveTurn(run, { type: "move", dir: "e" }, stats);
    expect(run.hero.checkpoint).toBe(1);
    run = resolveTurn(run, { type: "move", dir: "e" }, stats);
    expect(run.floor.explored.every(Boolean)).toBe(true);
    expect(run.items).toHaveLength(0);
  });

  it("a revive consumes a checkpoint; without one the hero dies with a cause", () => {
    const stats = baseStats();
    let run = makeRun({ enemies: [enemy("bitFlip", 3, 2, { hp: 50 })] });
    run = { ...run, hero: { ...run.hero, hp: 1, checkpoint: 1 } };
    run = resolveTurn(run, { type: "wait" }, stats);
    expect(run.status).toBe("active");
    expect(run.hero.hp).toBe(run.hero.maxHp);
    expect(run.hero.checkpoint).toBe(0);
    expect(kinds(run)).toContain("heroRevived");
    run = { ...run, hero: { ...run.hero, hp: 1 } };
    run = resolveTurn(run, { type: "wait" }, stats);
    expect(run.status).toBe("dead");
    expect(run.deathCause).toBe("Bit Flip");
    expect(lastOf(run, "heroDied")?.cause).toBe("Bit Flip");
    // dead runs are inert
    expect(resolveTurn(run, { type: "wait" }, stats)).toBe(run);
  });

  it("descend only works on the stairs; forceDescend always works", () => {
    const stats = baseStats();
    const run = makeRun();
    expect(resolveTurn(run, { type: "descend" }, stats).depth).toBe(1);
    const forced = resolveTurn(run, { type: "forceDescend" }, stats);
    expect(forced.depth).toBe(2);
    expect(forced.maxDepthReached).toBe(2);
    expect(lastOf(forced, "descended")?.depth).toBe(2);
    expect(forced.floor.width).toBe(48);
    expect(forced.enemies.length).toBe(8);
  });

  it("keeps at most 64 events in the ring", () => {
    const stats = baseStats();
    let run = makeRun();
    for (let i = 0; i < 100; i += 1) run = resolveTurn(run, { type: "move", dir: i % 2 === 0 ? "e" : "w" }, stats);
    expect(run.events.length).toBeLessThanOrEqual(64);
    expect(run.nextEventSeq).toBeGreaterThan(100);
  });
});
