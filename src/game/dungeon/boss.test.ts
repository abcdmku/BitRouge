import { amount, amountMultiply } from "../amount";
import { getKillCredits } from "../economy";
import { createHeroState, deriveHeroStats } from "../hero";
import { createInitialHubState } from "../initialState";
import { getBiome, TileKind, type EnemyKind } from "../renderSnapshot";
import { createRngState } from "../rng";
import type { Enemy, FloorState, HeroStats, RunState } from "../types";
import { BIOME_ENEMY_WEIGHTS } from "./biomes";
import {
  createEnemy,
  enemyDefinitions,
  getEnemyMaxHp,
  KERNEL_PANIC_BOUNTY_MULTIPLIER,
  KERNEL_PANIC_SPLIT_COUNT,
  pickEnemyKind,
} from "./enemies";
import { generateFloor, isBossDepth } from "./generate";
import { toIndex } from "./grid";
import { resolveTurn } from "./turn";
import { chooseAutoAction } from "./autoExplore";

const W = 12;
const H = 12;

const makeFloor = (stairsLocked = false): FloorState => {
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
    stairsLocked,
  };
};

const strongStats = (): HeroStats => ({
  ...deriveHeroStats(createInitialHubState()),
  attack: 50,
  maxHp: 100,
});

let nextId = 1;
const enemy = (kind: EnemyKind, x: number, y: number, overrides: Partial<Enemy> = {}): Enemy => ({
  ...createEnemy(kind, 5, nextId++, x, y),
  alerted: true,
  ...overrides,
});

const makeRun = (overrides: Partial<RunState> = {}, stats = strongStats()): RunState => ({
  seed: 1,
  rng: createRngState(1),
  depth: 5,
  maxDepthReached: 5,
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
  floor: makeFloor(true),
  enemies: [],
  items: [],
  events: [],
  nextEventSeq: 1,
  nextEntityId: 100,
  pendingPath: null,
  autoPath: null,
  deadlocksSurvived: 0,
  bossKills: 0,
  ...overrides,
});

describe("kernelPanic boss", () => {
  it("spawns on every 5th floor next to the stairs, with the stairs locked", () => {
    expect(isBossDepth(5)).toBe(true);
    expect(isBossDepth(10)).toBe(true);
    expect(isBossDepth(4)).toBe(false);
    expect(isBossDepth(6)).toBe(false);
    for (let seed = 1; seed <= 50; seed += 1) {
      const generated = generateFloor(createRngState(seed), 5, 1);
      const bosses = generated.enemies.filter((candidate) => candidate.kind === "kernelPanic");
      expect(bosses).toHaveLength(1);
      const boss = bosses[0]!;
      const distance = Math.abs(boss.x - generated.floor.stairs.x) + Math.abs(boss.y - generated.floor.stairs.y);
      expect(distance).toBe(1);
      expect(generated.floor.stairsLocked).toBe(true);
      // nothing else shares the boss cell
      const sameCell = [...generated.enemies, ...generated.items].filter(
        (entity) => entity !== boss && entity.x === boss.x && entity.y === boss.y,
      );
      expect(sameCell).toHaveLength(0);
    }
    // non-boss floors have no boss and unlocked stairs
    const plain = generateFloor(createRngState(1), 4, 1);
    expect(plain.enemies.some((candidate) => candidate.kind === "kernelPanic")).toBe(false);
    expect(plain.floor.stairsLocked).toBe(false);
  });

  it("locked stairs refuse descend and emit a stairsLocked event", () => {
    let run = makeRun({ hero: { ...createHeroState(strongStats(), 9, 9) } });
    run = resolveTurn(run, { type: "descend" }, strongStats());
    expect(run.depth).toBe(5);
    expect(run.events.some((event) => event.kind === "stairsLocked")).toBe(true);
  });

  it("killing the boss pays the bounty, drops a coreDump, unlocks the stairs and counts the kill", () => {
    const stats = strongStats();
    let run = makeRun({ enemies: [enemy("kernelPanic", 3, 2, { hp: 1 })] });
    run = resolveTurn(run, { type: "move", dir: "e" }, stats);
    expect(run.enemies.filter((candidate) => candidate.kind === "kernelPanic")).toHaveLength(0);
    expect(run.bossKills).toBe(1);
    expect(run.floor.stairsLocked).toBe(false);
    expect(run.events.some((event) => event.kind === "stairsUnlocked")).toBe(true);
    expect(run.items.some((item) => item.kind === "coreDump" && item.x === 3 && item.y === 2)).toBe(true);
    const expected = amountMultiply(
      getKillCredits(5, stats.killCreditMultiplier),
      KERNEL_PANIC_BOUNTY_MULTIPLIER,
    );
    expect(run.credits).toBe(expected);
    // descend works now
    run = { ...run, hero: { ...run.hero, x: 9, y: 9 } };
    run = resolveTurn(run, { type: "descend" }, stats);
    expect(run.depth).toBe(6);
  });

  it("spawns two bitFlips once when crossing half HP", () => {
    const maxHp = getEnemyMaxHp("kernelPanic", 5);
    const weakStats: HeroStats = { ...strongStats(), attack: Math.ceil(maxHp / 2) };
    let run = makeRun({ enemies: [enemy("kernelPanic", 3, 2)] }, weakStats);
    run = resolveTurn(run, { type: "move", dir: "e" }, weakStats);
    const boss = run.enemies.find((candidate) => candidate.kind === "kernelPanic")!;
    expect(boss.hp * 2).toBeLessThanOrEqual(boss.maxHp);
    expect(boss.splitTriggered).toBe(true);
    const flips = run.enemies.filter((candidate) => candidate.kind === "bitFlip");
    expect(flips).toHaveLength(KERNEL_PANIC_SPLIT_COUNT);
    for (const flip of flips) expect(flip.alerted).toBe(true);
    // a second hit does not split again
    const before = run.enemies.length;
    run = resolveTurn(run, { type: "move", dir: "e" }, { ...weakStats, attack: 1 });
    expect(run.enemies.length).toBeLessThanOrEqual(before);
  });

  it("boss stats: big HP pool, 2 base damage, slow, out of the random pool", () => {
    const definition = enemyDefinitions.kernelPanic;
    expect(definition.baseHp).toBeGreaterThanOrEqual(5 * enemyDefinitions.bitFlip.baseHp);
    expect(definition.baseDamage).toBe(2);
    expect(definition.slow).toBe(true);
    expect(definition.weight).toBe(0);
    let rng = createRngState(99);
    for (let draw = 0; draw < 500; draw += 1) {
      const picked = pickEnemyKind(rng, 15);
      rng = picked.state;
      expect(picked.value).not.toBe("kernelPanic");
    }
  });

  it("auto-explore hunts the boss instead of parking on locked stairs", () => {
    const stats = strongStats();
    // boss far away (beyond the chase limit), floor fully explored, no frontier
    const run = makeRun({
      hero: { ...createHeroState(stats, 9, 9) },
      enemies: [enemy("kernelPanic", 1, 10, { alerted: false })],
    });
    const decision = chooseAutoAction(run, stats);
    expect(decision.action.type).toBe("move");
    // boss unreachable -> forceDescend (anti-stall) even though stairs are locked
    const walled = makeRun({ hero: { ...createHeroState(stats, 9, 9) } });
    const sealed: RunState = { ...walled, enemies: [enemy("kernelPanic", 1, 1)] };
    sealed.floor = { ...sealed.floor, tiles: [...sealed.floor.tiles] };
    for (const [x, y] of [[1, 2], [2, 1], [2, 2]] as const) {
      sealed.floor.tiles[toIndex(x, y, W)] = TileKind.wall;
    }
    const stuck = chooseAutoAction(sealed, stats);
    expect(stuck.action.type).toBe("forceDescend");
  });

  it("deadlock kills and lock escapes count as survived", () => {
    const stats = strongStats();
    let run = makeRun({ depth: 2, enemies: [enemy("deadlock", 3, 2, { hp: 1 })] });
    run = resolveTurn(run, { type: "move", dir: "e" }, stats);
    expect(run.deadlocksSurvived).toBe(1);
  });
});

describe("kernelPanic integration (real advance loop)", () => {
  it("a strong hub crosses the depth-5 boss floor: boss killed, bounty banked, campaign objective set", async () => {
    const { advanceGame } = await import("../advance");
    const { applyAction } = await import("../actions");
    const { createInitialGameState } = await import("../initialState");
    let totalBossKills = 0;
    let crossed = 0;
    for (let seed = 1; seed <= 10; seed += 1) {
      let state = createInitialGameState(seed);
      state = {
        ...state,
        hub: {
          ...state.hub,
          hardware: { ...state.hub.hardware, clock: 6, cache: 10, ram: 10, cooling: 6, psu: 4, scheduler: 2 },
        },
      };
      state = applyAction(state, { type: "deploy" });
      let guard = 0;
      while (state.run && guard++ < 2000) state = advanceGame(state, 60_000, "foreground").state;
      expect(state.run).toBeNull();
      totalBossKills += state.hub.stats.bossKills;
      if (state.hub.stats.maxDepth >= 6) {
        crossed += 1;
        // descending past 5 normally means the boss died (forceDescend is the rare fallback)
        expect(state.campaign.completedObjectiveIds).toContain("orders:depth-5");
      }
      if (state.hub.stats.bossKills > 0) {
        expect(state.campaign.completedObjectiveIds).toContain("orders:kernel-panic");
      }
    }
    expect(crossed).toBeGreaterThan(0);
    expect(totalBossKills).toBeGreaterThan(0);
  }, 60_000);
});

describe("biomes", () => {
  it("maps depth bands to network / storage / kernel", () => {
    expect(getBiome(1)).toBe("network");
    expect(getBiome(5)).toBe("network");
    expect(getBiome(6)).toBe("storage");
    expect(getBiome(10)).toBe("storage");
    expect(getBiome(11)).toBe("kernel");
    expect(getBiome(42)).toBe("kernel");
  });

  it("biome weights shift the enemy mix per band", () => {
    const sample = (depth: number) => {
      let rng = createRngState(1234 + depth);
      const counts = new Map<EnemyKind, number>();
      for (let draw = 0; draw < 2000; draw += 1) {
        const picked = pickEnemyKind(rng, depth);
        rng = picked.state;
        counts.set(picked.value, (counts.get(picked.value) ?? 0) + 1);
      }
      return counts;
    };
    const storage = sample(7);
    const kernel = sample(12);
    const network = sample(4);
    // storage favors memoryLeak/zombieProcess over the network band
    expect(storage.get("memoryLeak") ?? 0).toBeGreaterThan(network.get("memoryLeak") ?? 0);
    expect(storage.get("zombieProcess") ?? 0).toBeGreaterThan(0);
    // kernel favors deadlock/forkBomb/nullPointer, and suppresses bitFlip
    expect(kernel.get("deadlock") ?? 0).toBeGreaterThan(storage.get("deadlock") ?? 0);
    expect(kernel.get("bitFlip") ?? 0).toBeLessThan(network.get("bitFlip") ?? 0);
    // weights table stays total-positive per biome
    for (const weights of Object.values(BIOME_ENEMY_WEIGHTS)) {
      for (const value of Object.values(weights)) expect(value).toBeGreaterThan(0);
    }
  });

  it("hazards on deep floors follow the biome weighting and stay valid kinds", () => {
    for (const depth of [6, 12]) {
      const generated = generateFloor(createRngState(depth), depth, 1);
      for (const hazard of generated.floor.hazards) {
        expect(["hotTile", "overloadPlate", "corruptedSector", "brownout"]).toContain(hazard.kind);
      }
    }
  });
});
