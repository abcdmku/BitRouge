import type {
  Dir,
  RenderEntity,
  RenderItem,
  RenderSnapshot,
  RunEvent,
  TileKindValue,
} from "../game/renderSnapshot";
import { TileKind } from "../game/renderSnapshot";

type RenderSite = RenderSnapshot["sites"][number];
type RenderPayload = RenderSnapshot["payloads"][number];

/**
 * Hand-built deterministic snapshot so the renderer can be exercised without
 * the sim. 24x16 map: three rooms joined by corridors, dressed with v2 work
 * sites, a payload/port pair, leak cells, a vent and a quota-locked bus gate.
 */
export const SAMPLE_W = 24;
export const SAMPLE_H = 16;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const ROOMS: Rect[] = [
  { x: 1, y: 1, w: 7, h: 6 },
  { x: 10, y: 2, w: 6, h: 5 },
  { x: 14, y: 9, w: 9, h: 6 },
];

function buildTiles(): TileKindValue[] {
  const tiles: TileKindValue[] = new Array<TileKindValue>(SAMPLE_W * SAMPLE_H).fill(TileKind.wall);
  const set = (x: number, y: number, t: TileKindValue) => {
    if (x >= 0 && y >= 0 && x < SAMPLE_W && y < SAMPLE_H) tiles[y * SAMPLE_W + x] = t;
  };
  for (const r of ROOMS) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) set(x, y, TileKind.floor);
  // corridor room0 -> room1 (horizontal at y=4)
  for (let x = 8; x < 10; x++) set(x, 4, TileKind.floor);
  set(8, 4, TileKind.door);
  // corridor room1 -> room2 (down from (15,7) to (15,9))
  for (let y = 7; y < 9; y++) set(15, y, TileKind.floor);
  set(15, 7, TileKind.door);
  set(21, 13, TileKind.stairsDown);
  // v2: a cooling vent near the job station in room 0.
  set(5, 5, TileKind.vent);
  return tiles;
}

const BASE_TILES = buildTiles();

function radiusMask(cx: number, cy: number, r: number): boolean[] {
  const out = new Array<boolean>(SAMPLE_W * SAMPLE_H).fill(false);
  for (let y = 0; y < SAMPLE_H; y++) {
    for (let x = 0; x < SAMPLE_W; x++) {
      if (Math.hypot(x - cx, y - cy) <= r) out[y * SAMPLE_W + x] = true;
    }
  }
  return out;
}

function orMask(a: readonly boolean[], b: readonly boolean[]): boolean[] {
  return a.map((v, i) => v || b[i] === true);
}

const ENEMIES: RenderEntity[] = [
  { id: 1, kind: "bitFlip", x: 6, y: 2, hp: 3, maxHp: 3, facing: "l", anim: "idle" },
  { id: 2, kind: "nullPointer", x: 12, y: 3, hp: 4, maxHp: 4, facing: "r", anim: "idle" },
  { id: 3, kind: "memoryLeak", x: 14, y: 5, hp: 6, maxHp: 6, facing: "l", anim: "idle" },
  { id: 4, kind: "zombieProcess", x: 17, y: 11, hp: 8, maxHp: 8, facing: "r", anim: "idle" },
  { id: 5, kind: "daemon", x: 20, y: 10, hp: 5, maxHp: 5, facing: "l", anim: "idle" },
];

const ITEMS: RenderItem[] = [
  { id: 101, kind: "patch", x: 3, y: 5 },
  { id: 102, kind: "cacheLine", x: 11, y: 6 },
  { id: 103, kind: "coreDump", x: 19, y: 13 },
];

/** v2 work sites: two nodes (one corrupted), two stations (one squatted), one port. */
const SITES: RenderSite[] = [
  { id: 11, kind: "dataNode", x: 2, y: 2, totalUnits: 4, remainingUnits: 4, yieldData: 2, payoutCredits: "0", corrupted: 0, squattedBy: null, resolved: false },
  { id: 12, kind: "dataNode", x: 13, y: 6, totalUnits: 4, remainingUnits: 3, yieldData: 2, payoutCredits: "0", corrupted: 1, squattedBy: null, resolved: false },
  { id: 13, kind: "jobStation", x: 4, y: 4, totalUnits: 12, remainingUnits: 7, yieldData: 0, payoutCredits: "12", corrupted: 0, squattedBy: null, resolved: false },
  { id: 14, kind: "jobStation", x: 17, y: 10, totalUnits: 12, remainingUnits: 12, yieldData: 0, payoutCredits: "12", corrupted: 0, squattedBy: 4, resolved: false },
  { id: 15, kind: "ioPort", x: 20, y: 13, totalUnits: 1, remainingUnits: 1, yieldData: 0, payoutCredits: "10", corrupted: 0, squattedBy: null, resolved: false },
];

const PAYLOADS: RenderPayload[] = [
  { id: 51, x: 11, y: 3, portId: 15, heldBy: "floor" },
];

const LEAKS: number[] = [10 * SAMPLE_W + 15, 11 * SAMPLE_W + 15];

export function createSampleSnapshot(): RenderSnapshot {
  const hero = {
    x: 3,
    y: 3,
    facing: "r" as const,
    hp: 12,
    maxHp: 14,
    heat: 2,
    throttled: false,
    anim: "idle" as const,
    channeling: null,
    carrying: null,
  };
  const visible = radiusMask(hero.x, hero.y, 4.5);
  const explored = orMask(visible, radiusMask(9, 4, 2.5));
  return {
    runId: 42,
    depth: 1,
    width: SAMPLE_W,
    height: SAMPLE_H,
    tiles: BASE_TILES,
    explored,
    visible,
    hazards: [
      { index: 5 * SAMPLE_W + 5, kind: "hotTile" },
      { index: 4 * SAMPLE_W + 13, kind: "corruptedSector" },
      { index: 12 * SAMPLE_W + 16, kind: "overloadPlate" },
    ],
    hero,
    entities: ENEMIES,
    items: ITEMS,
    sites: SITES,
    payloads: PAYLOADS,
    leaks: LEAKS,
    quota: { required: 3, done: 1 },
    overclockTurns: 0,
    control: "auto",
    turn: 0,
    msPerTurn: 500,
    turnProgress: 0,
    events: [],
    tier: "cache",
    stairsLocked: true,
  };
}

const DIR_DELTA: Record<Dir, { dx: number; dy: number }> = {
  n: { dx: 0, dy: -1 },
  s: { dx: 0, dy: 1 },
  w: { dx: -1, dy: 0 },
  e: { dx: 1, dy: 0 },
};

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type EventBody = DistributiveOmit<RunEvent, "seq" | "turn">;

function pushEvent(snap: RenderSnapshot, ev: EventBody): RunEvent[] {
  const seq = (snap.events[snap.events.length - 1]?.seq ?? 0) + 1;
  const events = [...snap.events, { ...ev, seq, turn: snap.turn + 1 } as RunEvent];
  return events.slice(-64);
}

function pushEvents(snap: RenderSnapshot, evs: EventBody[]): RunEvent[] {
  let seq = snap.events[snap.events.length - 1]?.seq ?? 0;
  const appended = evs.map((ev) => ({ ...ev, seq: ++seq, turn: snap.turn + 1 }) as RunEvent);
  return [...snap.events, ...appended].slice(-64);
}

/** Move the hero one cell (walls block; bumping an enemy attacks it). Renderer-dev helper only. */
export function sampleMove(snap: RenderSnapshot, dir: Dir): RenderSnapshot {
  const { dx, dy } = DIR_DELTA[dir];
  const nx = snap.hero.x + dx;
  const ny = snap.hero.y + dy;
  const facing = dx < 0 ? "l" : dx > 0 ? "r" : snap.hero.facing;
  if (nx < 0 || ny < 0 || nx >= snap.width || ny >= snap.height) return snap;
  if (snap.tiles[ny * snap.width + nx] === TileKind.wall) return { ...snap, hero: { ...snap.hero, facing } };
  if (snap.leaks.includes(ny * snap.width + nx)) return { ...snap, hero: { ...snap.hero, facing } };
  const target = snap.entities.find((e) => e.x === nx && e.y === ny);
  if (target) return sampleAttack({ ...snap, hero: { ...snap.hero, facing } }, target.id);
  const visible = radiusMask(nx, ny, 4.5);
  const explored = orMask(snap.explored, visible);
  let events = pushEvent(snap, { kind: "heroMoved", from: { x: snap.hero.x, y: snap.hero.y }, to: { x: nx, y: ny } });
  let items = snap.items;
  const picked = items.find((i) => i.x === nx && i.y === ny);
  if (picked) {
    items = items.filter((i) => i.id !== picked.id);
    events = [...events, { ...events[events.length - 1]!, seq: events[events.length - 1]!.seq + 1, kind: "itemPicked", id: picked.id, itemKind: picked.kind, x: nx, y: ny } as RunEvent];
  }
  return {
    ...snap,
    hero: { ...snap.hero, x: nx, y: ny, facing, anim: "walk", channeling: null },
    visible,
    explored,
    items,
    turn: snap.turn + 1,
    events,
  };
}

export function sampleAttack(snap: RenderSnapshot, targetId: number): RenderSnapshot {
  const target = snap.entities.find((e) => e.id === targetId);
  if (!target) return snap;
  const damage = 2;
  const hp = target.hp - damage;
  let events = pushEvent(snap, { kind: "heroAttacked", targetId, damage });
  const seq = events[events.length - 1]!.seq;
  const turn = snap.turn + 1;
  let entities = snap.entities;
  if (hp <= 0) {
    entities = entities.filter((e) => e.id !== targetId);
    events = [...events, { seq: seq + 1, turn, kind: "enemyDied", id: targetId, enemyKind: target.kind, x: target.x, y: target.y, credits: "1.2" }];
  } else {
    entities = entities.map((e) => (e.id === targetId ? { ...e, hp, anim: "hurt" as const } : e));
    events = [...events, { seq: seq + 1, turn, kind: "enemyHurt", id: targetId, damage, hp }];
  }
  return { ...snap, entities, turn, events, hero: { ...snap.hero, anim: "attack" } };
}

/** Hero takes a hit from the nearest enemy (or an unknown source). */
export function sampleHurt(snap: RenderSnapshot): RenderSnapshot {
  const damage = 3;
  const hp = Math.max(0, snap.hero.hp - damage);
  const source = snap.entities[0]?.id ?? null;
  let events = pushEvent(snap, { kind: "heroHurt", sourceId: source, damage, hp });
  if (hp === 0) {
    events = [...events, { ...events[events.length - 1]!, seq: events[events.length - 1]!.seq + 1, kind: "heroDied", cause: "Segmentation fault" } as RunEvent];
  }
  return { ...snap, hero: { ...snap.hero, hp, anim: hp === 0 ? "dead" : "hurt", channeling: null }, turn: snap.turn + 1, events };
}

/** Random walk every enemy one step (deterministic per turn). */
export function sampleEnemiesStep(snap: RenderSnapshot): RenderSnapshot {
  const dirs: Dir[] = ["n", "e", "s", "w"];
  let events = [...snap.events];
  let seq = events[events.length - 1]?.seq ?? 0;
  const turn = snap.turn + 1;
  const entities = snap.entities.map((e, i) => {
    if (e.kind === "deadlock" || e.kind === "zombieProcess") return e;
    const d = DIR_DELTA[dirs[(turn + i * 7 + e.id) % 4]!];
    const nx = e.x + d.dx;
    const ny = e.y + d.dy;
    const blocked =
      snap.tiles[ny * snap.width + nx] === TileKind.wall ||
      snap.leaks.includes(ny * snap.width + nx) ||
      (nx === snap.hero.x && ny === snap.hero.y) ||
      snap.entities.some((o) => o.x === nx && o.y === ny);
    if (blocked) return e;
    seq += 1;
    events.push({ seq, turn, kind: "enemyMoved", id: e.id, from: { x: e.x, y: e.y }, to: { x: nx, y: ny } });
    return { ...e, x: nx, y: ny, facing: d.dx < 0 ? ("l" as const) : d.dx > 0 ? ("r" as const) : e.facing, anim: "walk" as const };
  });
  const daemon = entities.find((e) => e.kind === "daemon");
  if (daemon) {
    seq += 1;
    events.push({ seq, turn, kind: "projectile", from: { x: daemon.x, y: daemon.y }, to: { x: snap.hero.x, y: snap.hero.y } });
  }
  events = events.slice(-64);
  return { ...snap, entities, turn, events };
}

export function sampleHazard(snap: RenderSnapshot): RenderSnapshot {
  const h = snap.hazards[0];
  if (!h) return snap;
  const events = pushEvent(snap, { kind: "hazardTriggered", hazard: h.kind, x: h.index % snap.width, y: Math.floor(h.index / snap.width) });
  return { ...snap, turn: snap.turn + 1, events, hero: { ...snap.hero, heat: snap.hero.heat + 3, throttled: snap.hero.heat + 3 >= 10 } };
}

// ---------------------------------------------------------------------------
// v2 work-machine helpers
// ---------------------------------------------------------------------------

const chebyshev = (ax: number, ay: number, bx: number, by: number) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

const completeQuota = (snap: RenderSnapshot, events: EventBody[]): { quota: RenderSnapshot["quota"]; stairsLocked: boolean } => {
  const done = snap.quota.done + 1;
  events.push({ kind: "quotaProgress", done, required: snap.quota.required });
  const stairsLocked = done < snap.quota.required;
  if (!stairsLocked && snap.stairsLocked) events.push({ kind: "stairsUnlocked" });
  return { quota: { ...snap.quota, done }, stairsLocked };
};

/**
 * Context interact, mirroring the sim's priority: deliver > pick up > channel
 * the nearest adjacent site > GC an adjacent leak.
 */
export function sampleInteract(snap: RenderSnapshot): RenderSnapshot {
  const { x: hx, y: hy } = snap.hero;
  const events: EventBody[] = [];
  const carried = snap.payloads.find((p) => p.heldBy === "hero");

  // Deliver.
  if (carried) {
    const port = snap.sites.find((s) => s.id === carried.portId);
    if (port && chebyshev(hx, hy, port.x, port.y) <= 1) {
      events.push({ kind: "payloadDelivered", id: carried.id, credits: port.payoutCredits });
      const q = completeQuota(snap, events);
      return {
        ...snap,
        payloads: snap.payloads.filter((p) => p.id !== carried.id),
        sites: snap.sites.map((s) => (s.id === port.id ? { ...s, remainingUnits: 0, resolved: true } : s)),
        hero: { ...snap.hero, carrying: null },
        quota: q.quota,
        stairsLocked: q.stairsLocked,
        turn: snap.turn + 1,
        events: pushEvents(snap, events),
      };
    }
  }

  // Pick up.
  if (!carried) {
    const loose = snap.payloads.find((p) => p.heldBy === "floor" && chebyshev(hx, hy, p.x, p.y) <= 1);
    if (loose) {
      events.push({ kind: "payloadTaken", id: loose.id });
      return {
        ...snap,
        payloads: snap.payloads.map((p) => (p.id === loose.id ? { ...p, heldBy: "hero" as const } : p)),
        hero: { ...snap.hero, carrying: loose.id },
        turn: snap.turn + 1,
        events: pushEvents(snap, events),
      };
    }
  }

  // Channel a node / execute a station.
  const site = snap.sites.find(
    (s) => !s.resolved && s.kind !== "ioPort" && s.squattedBy === null && chebyshev(hx, hy, s.x, s.y) <= 1,
  );
  if (site) {
    const remaining = Math.max(0, site.remainingUnits - (site.kind === "jobStation" ? 3 : 1));
    events.push({ kind: "siteChanneled", siteId: site.id, remaining });
    let quota = snap.quota;
    let stairsLocked = snap.stairsLocked;
    let resolved = false;
    if (remaining === 0) {
      resolved = true;
      events.push({
        kind: "siteCompleted",
        siteId: site.id,
        siteKind: site.kind,
        credits: site.payoutCredits,
        data: site.yieldData,
      });
      const q = completeQuota(snap, events);
      quota = q.quota;
      stairsLocked = q.stairsLocked;
    }
    return {
      ...snap,
      sites: snap.sites.map((s) => (s.id === site.id ? { ...s, remainingUnits: remaining, resolved } : s)),
      hero: { ...snap.hero, channeling: resolved ? null : site.id, heat: snap.hero.heat + 2 },
      quota,
      stairsLocked,
      turn: snap.turn + 1,
      events: pushEvents(snap, events),
    };
  }

  // GC a leak.
  const leak = snap.leaks.find((i) => chebyshev(hx, hy, i % snap.width, Math.floor(i / snap.width)) <= 1);
  if (leak !== undefined) {
    events.push({ kind: "leakCollected", index: leak, credits: "2.4" });
    return {
      ...snap,
      leaks: snap.leaks.filter((i) => i !== leak),
      turn: snap.turn + 1,
      events: pushEvents(snap, events),
    };
  }
  return snap;
}

/** The memoryLeak allocator walls another adjacent cell. */
export function sampleLeakGrow(snap: RenderSnapshot): RenderSnapshot {
  const alloc = snap.entities.find((e) => e.kind === "memoryLeak");
  if (!alloc) return snap;
  const candidates: number[] = [];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const x = alloc.x + dx;
    const y = alloc.y + dy;
    const i = y * snap.width + x;
    if (snap.tiles[i] !== TileKind.wall && !snap.leaks.includes(i) && !(x === snap.hero.x && y === snap.hero.y)) {
      candidates.push(i);
    }
  }
  const index = candidates[snap.turn % Math.max(1, candidates.length)];
  if (index === undefined) return snap;
  return {
    ...snap,
    leaks: [...snap.leaks, index],
    turn: snap.turn + 1,
    events: pushEvents(snap, [{ kind: "leakSpawned", index }]),
  };
}

/** The daemon snatches whatever the hero carries (or the floor payload). */
export function sampleSteal(snap: RenderSnapshot): RenderSnapshot {
  const daemon = snap.entities.find((e) => e.kind === "daemon");
  const payload = snap.payloads.find((p) => p.heldBy === "hero") ?? snap.payloads.find((p) => p.heldBy === "floor");
  if (!daemon || !payload) return snap;
  return {
    ...snap,
    payloads: snap.payloads.map((p) => (p.id === payload.id ? { ...p, heldBy: daemon.id } : p)),
    hero: { ...snap.hero, carrying: null },
    turn: snap.turn + 1,
    events: pushEvents(snap, [{ kind: "payloadStolen", id: payload.id, byId: daemon.id }]),
  };
}

/** A bitFlip lands on the in-progress node: yield −25%, channel reset. */
export function sampleCorrupt(snap: RenderSnapshot): RenderSnapshot {
  const node = snap.sites.find((s) => s.kind === "dataNode" && !s.resolved);
  if (!node) return snap;
  return {
    ...snap,
    sites: snap.sites.map((s) =>
      s.id === node.id ? { ...s, corrupted: s.corrupted + 1, remainingUnits: s.totalUnits, yieldData: Math.max(0, s.yieldData - 1) } : s,
    ),
    hero: { ...snap.hero, channeling: null },
    turn: snap.turn + 1,
    events: pushEvents(snap, [{ kind: "siteCorrupted", siteId: node.id }]),
  };
}

/** Toggle a 10-turn overclock window (halved cadence). */
export function sampleOverclock(snap: RenderSnapshot): RenderSnapshot {
  const on = snap.overclockTurns === 0;
  return {
    ...snap,
    overclockTurns: on ? 10 : 0,
    msPerTurn: on ? 250 : 500,
    hero: { ...snap.hero, heat: on ? snap.hero.heat + 2 : snap.hero.heat },
    turn: snap.turn + 1,
    events: pushEvents(snap, [{ kind: "overclocked", on }]),
  };
}

/** kernelPanic floor scramble: mirror the carve in place, same depth. */
export function sampleScramble(snap: RenderSnapshot): RenderSnapshot {
  const mirror = (x: number) => SAMPLE_W - 1 - x;
  const tiles = snap.tiles.map((_, i) => {
    const x = i % SAMPLE_W;
    const y = Math.floor(i / SAMPLE_W);
    return snap.tiles[y * SAMPLE_W + mirror(x)]!;
  });
  const all = new Array<boolean>(snap.width * snap.height).fill(true);
  return {
    ...snap,
    tiles,
    explored: all,
    visible: all,
    hero: { ...snap.hero, x: mirror(snap.hero.x), channeling: null },
    entities: snap.entities.map((e) => ({ ...e, x: mirror(e.x) })),
    items: snap.items.map((i) => ({ ...i, x: mirror(i.x) })),
    sites: snap.sites.map((s) => ({ ...s, x: mirror(s.x) })),
    payloads: snap.payloads.map((p) => ({ ...p, x: mirror(p.x) })),
    leaks: snap.leaks.map((i) => Math.floor(i / SAMPLE_W) * SAMPLE_W + mirror(i % SAMPLE_W)),
    hazards: snap.hazards.map((h) => ({ ...h, index: Math.floor(h.index / SAMPLE_W) * SAMPLE_W + mirror(h.index % SAMPLE_W) })),
    turn: snap.turn + 1,
    events: pushEvents(snap, [{ kind: "floorScrambled" }]),
  };
}

/** New depth: same layout mirrored so the rebuild is visible; hero at the start room. */
export function sampleDescend(snap: RenderSnapshot): RenderSnapshot {
  const depth = snap.depth + 1;
  const tiles = BASE_TILES.map((_, i) => {
    const x = i % SAMPLE_W;
    const y = Math.floor(i / SAMPLE_W);
    return BASE_TILES[y * SAMPLE_W + (SAMPLE_W - 1 - x)]!;
  });
  const hero = { ...snap.hero, x: SAMPLE_W - 1 - 3, y: 3, facing: "l" as const, anim: "idle" as const, channeling: null, carrying: null };
  const visible = radiusMask(hero.x, hero.y, 4.5);
  const events = pushEvent(snap, { kind: "descended", depth });
  return {
    ...snap,
    depth,
    tiles,
    visible,
    explored: visible,
    hero,
    entities: ENEMIES.map((e) => ({ ...e, x: SAMPLE_W - 1 - e.x, facing: e.facing === "l" ? "r" : "l" })),
    items: ITEMS.map((i) => ({ ...i, x: SAMPLE_W - 1 - i.x })),
    sites: SITES.map((s) => ({ ...s, x: SAMPLE_W - 1 - s.x })),
    payloads: PAYLOADS.map((p) => ({ ...p, x: SAMPLE_W - 1 - p.x })),
    leaks: LEAKS.map((i) => Math.floor(i / SAMPLE_W) * SAMPLE_W + (SAMPLE_W - 1 - (i % SAMPLE_W))),
    quota: { required: 3, done: 0 },
    stairsLocked: true,
    hazards: snap.hazards.map((h) => ({ ...h, index: Math.floor(h.index / SAMPLE_W) * SAMPLE_W + (SAMPLE_W - 1 - (h.index % SAMPLE_W)) })),
    turn: snap.turn + 1,
    events,
  };
}

export function sampleToggleControl(snap: RenderSnapshot): RenderSnapshot {
  const control = snap.control === "auto" ? "manual" : "auto";
  return { ...snap, control, events: pushEvent(snap, { kind: "controlChanged", control }) };
}

/** Lift the fog everywhere (renderer-dev aid for checking every sprite). */
export function sampleRevealAll(snap: RenderSnapshot): RenderSnapshot {
  const all = new Array<boolean>(snap.width * snap.height).fill(true);
  return { ...snap, visible: all, explored: all };
}
