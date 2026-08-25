import { amount } from "../amount";
import { getEffectiveMsPerTurn } from "../advance";
import { endRun } from "../run";
import { applyAction } from "../actions";
import { createInitialGameState, createInitialHubState } from "../initialState";
import { createHeroState, deriveHeroStats } from "../hero";
import { TileKind, type EnemyKind, type RunEvent } from "../renderSnapshot";
import { createRngState } from "../rng";
import type { Enemy, FloorState, GameState, HeroStats, Payload, RunState, WorkSite } from "../types";
import { createEnemy } from "./enemies";
import { toIndex } from "./grid";
import { resolveTurn } from "./turn";
import {
  applyBitFlipCorruption,
  createDataNode,
  createIoPort,
  createJobStation,
  createPayload,
  DAEMON_STEAL_TURNS,
  getCorruptedNodeYield,
  getHaulPayout,
  getJobPayout,
  getJobUnitsPerTurn,
  getNodeChannelTurns,
  getNodeYield,
} from "./worksites";

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
  dataMined: 0,
  kills: 0,
  hero: createHeroState(stats, 2, 2),
  floor: makeFloor(),
  enemies: [],
  items: [],
  sites: [],
  payloads: [],
  leaks: [],
  quota: { required: 0, done: 0 },
  overclockTurns: 0,
  gcChannel: null,
  sitesCompleted: 0,
  payloadsDelivered: 0,
  leaksCollected: 0,
  events: [],
  nextEventSeq: 1,
  nextEntityId: 100,
  pendingPath: null,
  autoPath: null,
  deadlocksSurvived: 0,
  bossKills: 0,
  ...overrides,
});

const kinds = (run: RunState) => run.events.map((event) => event.kind);
const lastOf = <K extends RunEvent["kind"]>(run: RunState, kind: K) =>
  [...run.events].reverse().find((event): event is Extract<RunEvent, { kind: K }> => event.kind === kind);

const site = (run: RunState, id: number): WorkSite => run.sites.find((s) => s.id === id)!;
const payload = (run: RunState, id: number): Payload => run.payloads.find((p) => p.id === id)!;

describe("§3 numbers", () => {
  it("channel turns, yields and payouts follow the tables", () => {
    expect(getNodeChannelTurns(1, 0)).toBe(4); // cache: 4 + 2*0
    expect(getNodeChannelTurns(5, 0)).toBe(6); // ram
    expect(getNodeChannelTurns(9, 0)).toBe(8); // disk
    expect(getNodeChannelTurns(13, 0)).toBe(10); // kernel
    expect(getNodeChannelTurns(1, 4)).toBe(2); // cache is bandwidth; floor of 2
    expect(getNodeYield(1)).toBe(1);
    expect(getNodeYield(3)).toBe(3); // cache base 1 + depthInTier 3 - 1
    expect(getNodeYield(9)).toBe(11); // disk base 10 + 1
    expect(getJobPayout(1)).toBe("12");
    expect(getJobPayout(2)).toBe("15");
    expect(getJobUnitsPerTurn(3)).toBe(4);
    expect(getHaulPayout(1)).toBe("10");
    expect(getHaulPayout(2)).toBe("13");
  });
});

describe("mining (channel, non-resumable)", () => {
  it("interact each adjacent turn channels the node; completion mines Data and counts quota", () => {
    const stats = baseStats();
    let run = makeRun({
      sites: [createDataNode(50, 3, 2, 1)],
      quota: { required: 1, done: 0 },
      floor: { ...makeFloor(), stairsLocked: true },
    });
    run = resolveTurn(run, { type: "interact" }, stats);
    expect(run.hero.channelSiteId).toBe(50);
    expect(site(run, 50).remainingUnits).toBe(3);
    expect(lastOf(run, "siteChanneled")).toMatchObject({ siteId: 50, remaining: 3 });
    expect(run.hero.heat).toBe(1); // +2 work heat, -1 dissipation
    for (let i = 0; i < 3; i += 1) run = resolveTurn(run, { type: "interact" }, stats);
    expect(site(run, 50).resolved).toBe(true);
    expect(run.dataMined).toBe(1);
    expect(run.sitesCompleted).toBe(1);
    expect(run.hero.channelSiteId).toBeNull();
    expect(lastOf(run, "siteCompleted")).toMatchObject({ siteId: 50, siteKind: "dataNode", data: 1 });
    expect(lastOf(run, "quotaProgress")).toMatchObject({ done: 1, required: 1 });
    expect(run.floor.stairsLocked).toBe(false); // quota met -> gate opens
    expect(kinds(run)).toContain("stairsUnlocked");
  });

  it("taking damage mid-channel resets the node to full turns", () => {
    const stats = baseStats();
    let run = makeRun({
      sites: [createDataNode(50, 3, 2, 1)],
      enemies: [enemy("nullPointer", 2, 3)],
    });
    run = resolveTurn(run, { type: "interact" }, stats);
    expect(kinds(run)).toContain("heroHurt");
    expect(site(run, 50).remainingUnits).toBe(site(run, 50).totalUnits); // reset
    expect(run.hero.channelSiteId).toBeNull();
  });

  it("Branch Predictor absorbs the first hit of a channel", () => {
    const stats: HeroStats = { ...baseStats(), branchPredictor: true };
    let run = makeRun({
      sites: [createDataNode(50, 3, 2, 1)],
      enemies: [enemy("nullPointer", 2, 3)],
    });
    run = resolveTurn(run, { type: "interact" }, stats);
    expect(site(run, 50).remainingUnits).toBe(3); // shielded: progress kept
    expect(run.hero.channelSiteId).toBe(50);
    expect(run.hero.channelShield).toBe(false); // consumed
    run = resolveTurn(run, { type: "interact" }, stats);
    expect(site(run, 50).remainingUnits).toBe(site(run, 50).totalUnits); // second hit resets
  });
});

describe("job stations (execute, resumable)", () => {
  it("processes 1 + cacheLevel units per turn and pays W credits on completion", () => {
    const stats: HeroStats = { ...baseStats(), cacheLevel: 3 }; // 4 units/turn
    let run = makeRun({
      hero: createHeroState(stats, 3, 2),
      sites: [createJobStation(60, 3, 2, 1)], // W = 12
      quota: { required: 1, done: 0 },
    });
    run = resolveTurn(run, { type: "interact" }, stats);
    expect(site(run, 60).remainingUnits).toBe(8);
    run = resolveTurn(run, { type: "interact" }, stats);
    run = resolveTurn(run, { type: "interact" }, stats);
    expect(site(run, 60).resolved).toBe(true);
    expect(run.credits).toBe("12");
    expect(run.quota.done).toBe(1);
    expect(lastOf(run, "siteCompleted")).toMatchObject({ siteId: 60, siteKind: "jobStation", credits: "12" });
  });

  it("is resumable: interruptions keep completed units", () => {
    const stats = baseStats();
    let run = makeRun({
      hero: createHeroState(stats, 3, 2),
      sites: [createJobStation(60, 3, 2, 1)],
      enemies: [enemy("nullPointer", 3, 3)],
    });
    run = resolveTurn(run, { type: "interact" }, stats);
    expect(kinds(run)).toContain("heroHurt");
    expect(site(run, 60).remainingUnits).toBe(11); // units survive the hit
    expect(run.hero.channelSiteId).toBeNull(); // but the channel indicator drops
    run = resolveTurn(run, { type: "interact" }, stats);
    expect(site(run, 60).remainingUnits).toBe(10);
  });

  it("Piecework Rates (+25% work payouts) multiplies the completion credits", () => {
    const stats: HeroStats = { ...baseStats(), cacheLevel: 11, workPayoutMultiplier: amount("1.25") };
    let run = makeRun({
      hero: createHeroState(stats, 3, 2),
      sites: [createJobStation(60, 3, 2, 1)],
    });
    run = resolveTurn(run, { type: "interact" }, stats);
    expect(run.credits).toBe("15"); // 12 × 1.25
  });
});

describe("payload hauls (deliver)", () => {
  it("pick up, carry (+1 W, doubled alert radius), deliver at the port", () => {
    const stats = baseStats();
    let run = makeRun({
      hero: createHeroState(stats, 2, 2),
      sites: [createIoPort(70, 2, 5, 1)],
      payloads: [createPayload(71, 2, 2, 70, 1)],
      quota: { required: 1, done: 0 },
    });
    run = resolveTurn(run, { type: "interact" }, stats);
    expect(run.hero.carryingPayloadId).toBe(71);
    expect(payload(run, 71).heldBy).toBe("hero");
    expect(kinds(run)).toContain("payloadTaken");
    run = resolveTurn(run, { type: "move", dir: "s" }, stats);
    expect(payload(run, 71)).toMatchObject({ x: 2, y: 3 }); // tracks the carrier
    run = resolveTurn(run, { type: "move", dir: "s" }, stats); // (2,4), adjacent to port
    run = resolveTurn(run, { type: "interact" }, stats);
    expect(run.hero.carryingPayloadId).toBeNull();
    expect(run.credits).toBe("10");
    expect(run.payloadsDelivered).toBe(1);
    expect(run.quota.done).toBe(1);
    expect(run.payloads).toHaveLength(0);
    expect(site(run, 70).resolved).toBe(true);
    expect(lastOf(run, "payloadDelivered")).toMatchObject({ id: 71, credits: "10" });
  });

  it("carrying doubles the fault alert radius; DMA Controller removes that", () => {
    const carryRun = (stats: HeroStats, carrying: boolean): RunState => {
      const hero = createHeroState(stats, 2, 2);
      const payloads = carrying ? [{ ...createPayload(71, 2, 2, 70, 1), heldBy: "hero" as const }] : [];
      if (carrying) hero.carryingPayloadId = 71;
      const floor = makeFloor();
      floor.visible = floor.visible.map(() => false); // out of FOV
      return makeRun({ hero, payloads, floor, enemies: [enemy("daemon", 2, 10, { alerted: false })] });
    };
    const stats = baseStats();
    expect(resolveTurn(carryRun(stats, false), { type: "wait" }, stats).enemies[0]!.alerted).toBe(false);
    expect(resolveTurn(carryRun(stats, true), { type: "wait" }, stats).enemies[0]!.alerted).toBe(true);
    const dma: HeroStats = { ...stats, dmaController: true };
    expect(resolveTurn(carryRun(dma, true), { type: "wait" }, dma).enemies[0]!.alerted).toBe(false);
  });

  it("an adjacent daemon steals the payload; 20 turns later it resolves as lost (still counts quota)", () => {
    const stats = baseStats();
    const hero = createHeroState(stats, 2, 2);
    hero.carryingPayloadId = 71;
    let run = makeRun({
      hero,
      sites: [createIoPort(70, 9, 2, 1)],
      payloads: [{ ...createPayload(71, 2, 2, 70, 1), heldBy: "hero" as const }],
      quota: { required: 1, done: 0 },
      enemies: [enemy("daemon", 3, 2)],
    });
    run = resolveTurn(run, { type: "wait" }, stats);
    expect(run.hero.carryingPayloadId).toBeNull();
    const thief = run.enemies[0]!;
    expect(thief.stolenPayloadId).toBe(71);
    expect(thief.stealTimer).toBe(DAEMON_STEAL_TURNS);
    expect(payload(run, 71).heldBy).toBe(thief.id);
    expect(kinds(run)).toContain("payloadStolen");
    for (let i = 0; i < DAEMON_STEAL_TURNS + 1 && payload(run, 71).heldBy !== "lost"; i += 1) {
      run = resolveTurn(run, { type: "wait" }, stats);
    }
    expect(payload(run, 71).heldBy).toBe("lost");
    expect(run.quota.done).toBe(1); // lost payloads still resolve for quota
    expect(site(run, 70).resolved).toBe(true);
    expect(kinds(run)).toContain("payloadLost");
  });

  it("killing a payload thief pays 5x and drops the payload", () => {
    const stats = baseStats();
    const thief = enemy("daemon", 3, 2, { hp: 1, stolenPayloadId: 71, stealTimer: 10 });
    let run = makeRun({
      sites: [createIoPort(70, 9, 2, 1)],
      payloads: [{ ...createPayload(71, 3, 2, 70, 1), heldBy: thief.id }],
      enemies: [thief],
    });
    run = resolveTurn(run, { type: "move", dir: "e" }, stats);
    expect(run.enemies).toHaveLength(0);
    expect(run.credits).toBe("5"); // 1 × 1.15^0 × 5
    expect(payload(run, 71)).toMatchObject({ heldBy: "floor", x: 3, y: 2 });
  });
});

describe("bitFlip corruption", () => {
  it("a bitFlip walks to the node, corrupts it (-25% of original), resets the channel, despawns", () => {
    const stats = baseStats();
    let run = makeRun({
      sites: [{ ...createDataNode(50, 6, 2, 3), yieldData: 4 }],
      enemies: [enemy("bitFlip", 6, 4)],
      depth: 3,
    });
    // hero channels from (2,2)? not adjacent — just watch the flip seek the node
    run = resolveTurn(run, { type: "wait" }, stats);
    run = resolveTurn(run, { type: "wait" }, stats);
    expect(run.enemies).toHaveLength(0); // despawned on arrival
    expect(site(run, 50).corrupted).toBe(1);
    expect(getCorruptedNodeYield(site(run, 50), false)).toBe(3); // 4 - 25%
    expect(kinds(run)).toContain("siteCorrupted");
  });

  it("four unanswered flips zero a node; a zeroed node resolves for quota", () => {
    const run = makeRun({
      sites: [{ ...createDataNode(50, 3, 2, 1), yieldData: 8 }],
      quota: { required: 1, done: 0 },
      floor: { ...makeFloor(), stairsLocked: true },
    });
    const stats = baseStats();
    for (let i = 0; i < 4; i += 1) applyBitFlipCorruption(run, stats, run.sites[0]!);
    expect(run.sites[0]!.corrupted).toBe(4);
    expect(getCorruptedNodeYield(run.sites[0]!, false)).toBe(0);
    expect(run.sites[0]!.resolved).toBe(true);
    expect(run.quota.done).toBe(1);
    expect(run.floor.stairsLocked).toBe(false); // floors can never become uncompletable
  });

  it("ECC Memory halves the corruption step", () => {
    const node = { ...createDataNode(50, 3, 2, 1), yieldData: 8 };
    node.corrupted = 2;
    expect(getCorruptedNodeYield(node, false)).toBe(4); // -50%
    expect(getCorruptedNodeYield(node, true)).toBe(6); // -25%
  });
});

describe("quota gate", () => {
  it("controller floors need quota AND the kernelPanic dead", () => {
    const stats = baseStats();
    let run = makeRun({
      depth: 3,
      sites: [createDataNode(50, 3, 2, 3)],
      quota: { required: 1, done: 0 },
      // visible=false so the unalerted boss stays parked by the gate
      floor: { ...makeFloor(), stairsLocked: true, visible: new Array<boolean>(W * H).fill(false) },
      enemies: [enemy("kernelPanic", 9, 8, { hp: 1, alerted: false })],
    });
    const turns = getNodeChannelTurns(3, 0);
    for (let i = 0; i < turns; i += 1) run = resolveTurn(run, { type: "interact" }, stats);
    expect(run.quota.done).toBe(1);
    expect(run.floor.stairsLocked).toBe(true); // controller still alive
    // kill the controller: gate opens now that both conditions hold
    run = { ...run, hero: { ...run.hero, x: 9, y: 7 } };
    run = resolveTurn(run, { type: "move", dir: "s" }, stats);
    expect(run.floor.stairsLocked).toBe(false);
    expect(kinds(run)).toContain("stairsUnlocked");
  });

  it("killing the boss before the quota keeps the gate shut", () => {
    const stats = baseStats();
    let run = makeRun({
      depth: 3,
      sites: [createDataNode(50, 3, 2, 3)],
      quota: { required: 1, done: 0 },
      floor: { ...makeFloor(), stairsLocked: true },
      enemies: [enemy("kernelPanic", 3, 3, { hp: 1 })],
      hero: createHeroState(baseStats(), 3, 4),
    });
    run = resolveTurn(run, { type: "move", dir: "n" }, stats);
    expect(run.enemies).toHaveLength(0);
    expect(run.floor.stairsLocked).toBe(true); // quota unmet: killing everything never opens the gate
    // descend refused
    run = { ...run, hero: { ...run.hero, x: 9, y: 9 } };
    const refused = resolveTurn(run, { type: "descend" }, stats);
    expect(refused.depth).toBe(3);
    expect(kinds(refused)).toContain("stairsLocked");
  });
});

describe("overclock and heat", () => {
  it("overclock: 10 turns of half cadence, +2 heat/turn, +4 W draw", () => {
    const stats = baseStats();
    let run = makeRun();
    run = resolveTurn(run, { type: "overclock" }, stats);
    expect(run.overclockTurns).toBe(9); // set to 10, ticked once this turn
    expect(lastOf(run, "overclocked")?.on).toBe(true);
    expect(run.hero.heat).toBe(1); // +2 overclock, -1 dissipation
    expect(getEffectiveMsPerTurn(2, run)).toBeCloseTo((1000 * 2) / 2 / 2, 6); // × 0.5
    // +4 W: a 2 W budget trips immediately
    const tight: HeroStats = { ...stats, powerBudget: 2 };
    const tripped = resolveTurn(run, { type: "wait" }, tight);
    expect(kinds(tripped)).toContain("tripped");
    // runs out after 10 turns and announces off
    let cool = run;
    for (let i = 0; i < 9; i += 1) cool = resolveTurn(cool, { type: "wait" }, stats);
    expect(cool.overclockTurns).toBe(0);
    expect(lastOf(cool, "overclocked")?.on).toBe(false);
  });

  it("standing on a vent adds +3 dissipation", () => {
    const stats = baseStats();
    const floor = makeFloor();
    floor.tiles[toIndex(2, 2, W)] = TileKind.vent;
    let run = makeRun({ floor });
    run = { ...run, hero: { ...run.hero, heat: 5 } };
    run = resolveTurn(run, { type: "wait" }, stats);
    expect(run.hero.heat).toBe(1); // 5 - (1 + 3)
  });

  it("dying while throttled reads as Thermal shutdown", () => {
    const stats = baseStats();
    let run = makeRun({ enemies: [enemy("nullPointer", 3, 2, { hp: 50, maxHp: 50 })] });
    run = { ...run, hero: { ...run.hero, hp: 1, heat: 20, throttled: true } };
    run = resolveTurn(run, { type: "wait" }, stats);
    expect(run.status).toBe("dead");
    expect(run.deathCause).toBe("Thermal shutdown");
    // the same death un-throttled names the fault
    let cold = makeRun({ enemies: [enemy("nullPointer", 3, 2, { hp: 50, maxHp: 50 })] });
    cold = { ...cold, hero: { ...cold.hero, hp: 1 } };
    cold = resolveTurn(cold, { type: "wait" }, stats);
    expect(cold.deathCause).toBe("Segmentation fault");
  });
});

describe("fault behaviors (v2)", () => {
  it("forkBomb duplicates every 12 undamaged turns, capped", () => {
    const stats = baseStats();
    let run = makeRun({ enemies: [enemy("forkBomb", 10, 10, { alerted: false })] });
    for (let i = 0; i < 11; i += 1) run = resolveTurn(run, { type: "wait" }, stats);
    expect(run.enemies).toHaveLength(1);
    run = resolveTurn(run, { type: "wait" }, stats);
    expect(run.enemies).toHaveLength(2); // 12th turn: duplicated
    expect(kinds(run)).toContain("enemySpawned");
  });

  it("damaging any forkBomb resets the duplication window", () => {
    const stats = baseStats();
    let run = makeRun({ enemies: [enemy("forkBomb", 3, 2, { alerted: false, hp: 1, workTimer: 2 })] });
    run = resolveTurn(run, { type: "move", dir: "e" }, stats); // kill it before it duplicates
    expect(run.enemies).toHaveLength(0);
    // and a survivor gets its timer reset on damage
    let survivor = makeRun({ enemies: [enemy("forkBomb", 3, 2, { alerted: false, hp: 6, maxHp: 6, workTimer: 3 })] });
    survivor = resolveTurn(survivor, { type: "move", dir: "e" }, stats);
    for (const fork of survivor.enemies) {
      expect(fork.workTimer).toBeGreaterThanOrEqual(10); // 12 reset, minus this turn's ticks
    }
  });

  it("zombieProcess squats the nearest job station; the station is unusable until it dies for good", () => {
    const stats = baseStats();
    let run = makeRun({
      hero: createHeroState(baseStats(), 9, 5),
      sites: [createJobStation(60, 6, 2, 1)],
      enemies: [enemy("zombieProcess", 4, 2)],
    });
    for (let i = 0; i < 6 && site(run, 60).squattedBy === null; i += 1) {
      run = resolveTurn(run, { type: "wait" }, stats);
    }
    expect(site(run, 60).squattedBy).toBe(run.enemies[0]!.id);
    expect(kinds(run)).toContain("siteSquatted");
    // interact on the squatted station does nothing
    let blocked = { ...run, hero: { ...run.hero, x: 6, y: 2 } };
    blocked = resolveTurn(blocked, { type: "interact" }, stats);
    expect(site(blocked, 60).remainingUnits).toBe(site(blocked, 60).totalUnits);
    // final death clears the squat
    let cleared = {
      ...run,
      hero: { ...run.hero, x: 6, y: 3 },
      enemies: [{ ...run.enemies[0]!, hp: 1, revived: true }],
    };
    cleared = resolveTurn(cleared, { type: "move", dir: "n" }, stats);
    expect(cleared.enemies).toHaveLength(0);
    expect(site(cleared, 60).squattedBy).toBeNull();
  });

  it("kernel-tier kernelPanic scrambles the floor at half HP, preserving progress", () => {
    const stats: HeroStats = { ...baseStats(), attack: 5, maxHp: 100 };
    const boss = enemy("kernelPanic", 3, 2);
    boss.hp = Math.floor(boss.maxHp / 2) + 4; // one 5-attack hit crosses half without killing
    let run = makeRun(
      {
        depth: 13,
        hero: createHeroState(stats, 2, 2),
        sites: [{ ...createDataNode(50, 6, 6, 13), resolved: true }],
        quota: { required: 2, done: 1 },
        floor: { ...makeFloor(), stairsLocked: true },
        enemies: [boss],
        leaks: [toIndex(5, 5, W)],
      },
      stats,
    );
    run = resolveTurn(run, { type: "move", dir: "e" }, stats);
    expect(kinds(run)).toContain("floorScrambled");
    const after = run.enemies.find((candidate) => candidate.kind === "kernelPanic")!;
    expect(after.splitTriggered).toBe(true);
    expect(run.enemies.filter((candidate) => candidate.kind === "bitFlip")).toHaveLength(0); // no adds on kernel
    expect(run.quota).toEqual({ required: 2, done: 1 }); // progress preserved
    expect(site(run, 50).resolved).toBe(true);
    expect(run.leaks).toHaveLength(0); // scramble frees leaked cells
    expect(run.floor.stairsLocked).toBe(true);
    // everyone landed on walkable cells of the new floor
    const walkable = (x: number, y: number) =>
      run.floor.tiles[toIndex(x, y, run.floor.width)] !== TileKind.wall;
    expect(walkable(run.hero.x, run.hero.y)).toBe(true);
    for (const entity of [...run.enemies, ...run.sites]) expect(walkable(entity.x, entity.y)).toBe(true);
  });
});

describe("integration: a scripted hero completes a quota floor and banks it", () => {
  it("mine + execute + deliver -> gate opens -> flush -> banking", () => {
    const stats = baseStats();
    const sites = [
      createDataNode(50, 3, 2, 1),
      createJobStation(60, 2, 3, 1),
      createIoPort(70, 2, 6, 1),
    ];
    const payloads = [createPayload(71, 2, 4, 70, 1)];
    let run = makeRun({
      sites,
      payloads,
      quota: { required: 3, done: 0 },
      floor: { ...makeFloor(), stairsLocked: true },
    });
    // mine the node at (3,2) from (2,2): 4 channel turns
    for (let i = 0; i < 4; i += 1) run = resolveTurn(run, { type: "interact" }, stats);
    expect(run.dataMined).toBe(1);
    expect(run.quota.done).toBe(1);
    // execute the job under (2,3): 12 units at 1/turn
    run = resolveTurn(run, { type: "move", dir: "s" }, stats);
    for (let i = 0; i < 12; i += 1) run = resolveTurn(run, { type: "interact" }, stats);
    expect(run.credits).toBe("12");
    expect(run.quota.done).toBe(2);
    // haul the payload at (2,4) to the port at (2,6)
    run = resolveTurn(run, { type: "move", dir: "s" }, stats);
    run = resolveTurn(run, { type: "interact" }, stats); // pick up
    expect(run.hero.carryingPayloadId).toBe(71);
    run = resolveTurn(run, { type: "move", dir: "s" }, stats);
    run = resolveTurn(run, { type: "interact" }, stats); // deliver (adjacent)
    expect(run.credits).toBe("22");
    expect(run.quota.done).toBe(3);
    expect(run.floor.stairsLocked).toBe(false);
    expect(kinds(run)).toContain("stairsUnlocked");
    // walk to the bus gate and flush
    for (let i = 0; i < 7; i += 1) run = resolveTurn(run, { type: "move", dir: "e" }, stats);
    for (let i = 0; i < 4; i += 1) run = resolveTurn(run, { type: "move", dir: "s" }, stats);
    expect(run.hero).toMatchObject({ x: 9, y: 9 });
    run = resolveTurn(run, { type: "descend" }, stats);
    expect(run.depth).toBe(2);
    expect(run.quota.done).toBe(0); // fresh floor, fresh quota
    expect(run.sites.length).toBeGreaterThan(0); // generator provided new sites
    // banking: hub.data += dataMined + 5 × new max depths; no credit conversion
    let state: GameState = applyAction(createInitialGameState(1), { type: "deploy" });
    state = { ...state, run: { ...run, maxDepthReached: 2 } };
    const ended = endRun(state, "test");
    expect(ended.hub.data).toBe("11"); // 1 mined + 2 new depths × 5
    expect(ended.hub.stats.sitesCompleted).toBe(2);
    expect(ended.hub.stats.payloadsDelivered).toBe(1);
    expect(ended.hub.stats.dataMined).toBe(1);
    expect(ended.hub.lastRunSummary?.dataMined).toBe(1);
  });
});
