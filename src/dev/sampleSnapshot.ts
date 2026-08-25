import { getPortIndices, stepIndex, toIndex, toXY } from "../game/board";
import type { ComponentKind, DamageSource, Dir } from "../game/types";
import type {
  RenderBacklogRow,
  RenderComponent,
  RenderPacket,
  RenderSnapshot,
  RenderSocket,
} from "../game/renderSnapshot";

/**
 * Hand-built deterministic snapshot so BoardScene can be exercised without the
 * sim: a mid-run 5x7 board (spec §3 base size) with packets crawling a main
 * column, a faulted MINER off to the side, a hot empty junction, locked
 * sockets, and a brownout in progress (duty < 1). No sim involved; the
 * mutator helpers below hand-roll just enough state transitions to demo
 * BoardScene's tween/overlay/fx handling.
 */
export const WIDTH = 5;
export const HEIGHT = 7;
const PORT_INDEX = getPortIndices(WIDTH, HEIGHT, false)[0]!;

interface SocketOverride {
  unlocked?: boolean;
  dir?: Dir;
  heat?: number;
  component?: RenderComponent | null;
}

const at = (x: number, y: number) => toIndex(x, y, WIDTH);

const component = (kind: ComponentKind, level: number, opts: Partial<RenderComponent> = {}): RenderComponent => ({
  kind,
  level,
  powered: true,
  faulted: false,
  faultSpreadProgress: 0,
  ...opts,
});

const OVERRIDES: Record<number, SocketOverride> = {
  [at(2, 1)]: { unlocked: true, dir: "S", component: component("miner", 1), heat: 22 },
  [at(2, 2)]: { unlocked: true, dir: "S", component: component("gpu", 1, { powered: false }), heat: 8 },
  [at(2, 3)]: { unlocked: true, dir: "S", component: component("cooler", 1), heat: 12 },
  [at(2, 4)]: { unlocked: true, dir: "S", component: component("cache", 2), heat: 34 },
  [at(2, 5)]: { unlocked: true, dir: "S", component: component("core", 2), heat: 18 },
  [at(1, 3)]: {
    unlocked: true,
    dir: "E",
    component: component("miner", 1, { faulted: true, faultSpreadProgress: 0.4 }),
    heat: 55,
  },
  [at(3, 3)]: { unlocked: true, dir: "W", heat: 85 },
  [at(1, 4)]: { unlocked: false },
  [at(3, 4)]: { unlocked: false },
  [at(1, 2)]: { unlocked: false },
  [at(3, 2)]: { unlocked: true, dir: "W" },
};

function buildSockets(): RenderSocket[] {
  const sockets: RenderSocket[] = [];
  for (let index = 0; index < WIDTH * HEIGHT; index += 1) {
    const { x, y } = toXY(index, WIDTH);
    const isPort = index === PORT_INDEX;
    const override = OVERRIDES[index] ?? {};
    const unlocked = isPort ? true : (override.unlocked ?? false);
    const heat = override.heat ?? 0;
    sockets.push({
      index,
      x,
      y,
      unlocked,
      isPort,
      dir: override.dir ?? "S",
      heat,
      throttled: heat >= 70,
      component: isPort ? null : (override.component ?? null),
      unlockCostLabel: unlocked ? null : `${4 + (index % 5) * 2}`,
      lit: false, // recomputed below once packets/backlog are known
    });
  }
  return sockets;
}

const BASE_PACKETS: RenderPacket[] = [
  { id: 1, socketIndex: at(2, 1), taskKind: "bulk", valueLabel: "1.1" },
  { id: 2, socketIndex: at(2, 3), taskKind: "crunch", valueLabel: "3.4" },
  { id: 3, socketIndex: at(2, 4), taskKind: "hot", valueLabel: "2.2" },
  { id: 4, socketIndex: at(2, 5), taskKind: "priority", valueLabel: "5.0" },
];

const BASE_BACKLOG: RenderBacklogRow[] = [
  { id: 101, kind: "bulk", valueLabel: "1.1", deadlineLeftMs: null },
  { id: 102, kind: "crunch", valueLabel: "3.4", deadlineLeftMs: null },
  { id: 103, kind: "priority", valueLabel: "5.0", deadlineLeftMs: 8000 },
];

function relight(sockets: RenderSocket[], packets: RenderPacket[], backlogLen: number): RenderSocket[] {
  const occupiedByPacket = new Set(packets.map((p) => p.socketIndex));
  return sockets.map((s) => {
    const faulted = !!s.component?.faulted;
    const readyCore = !faulted && s.component?.kind === "core" && backlogLen > 0 && !occupiedByPacket.has(s.index);
    return { ...s, lit: s.unlocked && (occupiedByPacket.has(s.index) || faulted || !!readyCore) };
  });
}

let nextEventSeq = 1;
let nextPacketId = 1000;

function withEvents(snap: RenderSnapshot, added: RenderSnapshot["events"]): RenderSnapshot {
  const events = [...snap.events, ...added].slice(-64);
  return { ...snap, events, lastEventSeq: events[events.length - 1]?.seq ?? snap.lastEventSeq };
}

export function createSampleSnapshot(): RenderSnapshot {
  const sockets = relight(buildSockets(), BASE_PACKETS, BASE_BACKLOG.length);
  return {
    boardWidth: WIDTH,
    boardHeight: HEIGHT,
    portIndices: [PORT_INDEX],
    sockets,
    packets: BASE_PACKETS,
    backlog: BASE_BACKLOG,
    backlogCap: 12,
    integrity: 58,
    integrityMax: 100,
    reserveJ: 12,
    reserveMax: 100,
    netWatts: -3,
    uptimeMs: 754_000,
    gen: 2,
    duty: 0.62,
    crash: null,
    events: [],
    lastEventSeq: 0,
  };
}

/** One tick: every packet advances a hop along its socket's dir; cores pull from the backlog. Deterministic, no rng. */
export function sampleTick(snap: RenderSnapshot): RenderSnapshot {
  const events: RenderSnapshot["events"] = [];
  const t = snap.uptimeMs + 500;
  let backlog = snap.backlog;
  const nextPackets: RenderPacket[] = [];
  const occupied = new Set<number>();

  for (const packet of snap.packets) {
    const socket = snap.sockets[packet.socketIndex]!;
    if (socket.component?.faulted) {
      nextPackets.push(packet);
      occupied.add(packet.socketIndex);
      continue;
    }
    const to = stepIndex(packet.socketIndex, socket.dir, snap.boardWidth, snap.boardHeight);
    if (to === -1 || occupied.has(to)) {
      nextPackets.push(packet);
      occupied.add(packet.socketIndex);
      continue;
    }
    events.push({ seq: nextEventSeq++, t, kind: "packetMoved", id: packet.id, from: packet.socketIndex, to, manual: false });
    if (snap.portIndices.includes(to)) {
      events.push({ seq: nextEventSeq++, t, kind: "packetDelivered", id: packet.id, socketIndex: to, valueLabel: packet.valueLabel, manual: false });
      continue; // delivered: does not survive into nextPackets
    }
    occupied.add(to);
    nextPackets.push({ ...packet, socketIndex: to });
  }

  // Cores with an empty socket pull the oldest backlog task.
  for (const socket of snap.sockets) {
    if (socket.component?.kind !== "core" || socket.component.faulted || occupied.has(socket.index)) continue;
    const task = backlog[0];
    if (!task) continue;
    backlog = backlog.slice(1);
    occupied.add(socket.index);
    events.push({ seq: nextEventSeq++, t, kind: "taskArrived", id: nextPacketId, taskKind: task.kind });
    nextPackets.push({ id: nextPacketId, socketIndex: socket.index, taskKind: task.kind, valueLabel: task.valueLabel });
    nextPacketId += 1;
  }

  const sockets = relight(snap.sockets, nextPackets, backlog.length);
  return withEvents({ ...snap, uptimeMs: t, packets: nextPackets, backlog, sockets }, events);
}

/** Manual WORK tap on `index`: mirrors the sim's tap semantics closely enough for a dev smoke test. */
export function sampleWorkTap(snap: RenderSnapshot, index: number): RenderSnapshot {
  const socket = snap.sockets[index];
  if (!socket || !socket.lit) return snap;
  const t = snap.uptimeMs;
  const events: RenderSnapshot["events"] = [{ seq: nextEventSeq++, t, kind: "workTap", index }];

  if (socket.component?.faulted) {
    const sockets = snap.sockets.map((s) => (s.index === index ? { ...s, component: { ...s.component!, faulted: false, faultSpreadProgress: 0 }, heat: 50 } : s));
    events.push({ seq: nextEventSeq++, t, kind: "faultPatched", index, manual: true });
    return withEvents({ ...snap, sockets: relight(sockets, snap.packets, snap.backlog.length) }, events);
  }

  const packet = snap.packets.find((p) => p.socketIndex === index);
  if (packet) {
    const to = stepIndex(index, socket.dir, snap.boardWidth, snap.boardHeight);
    events.push({ seq: nextEventSeq++, t, kind: "packetMoved", id: packet.id, from: index, to: to === -1 ? index : to, manual: true });
    let packets: RenderPacket[];
    if (to !== -1 && snap.portIndices.includes(to)) {
      events.push({ seq: nextEventSeq++, t, kind: "packetDelivered", id: packet.id, socketIndex: to, valueLabel: packet.valueLabel, manual: true });
      packets = snap.packets.filter((p) => p.id !== packet.id);
    } else {
      packets = snap.packets.map((p) => (p.id === packet.id ? { ...p, socketIndex: to === -1 ? index : to } : p));
    }
    return withEvents({ ...snap, packets, sockets: relight(snap.sockets, packets, snap.backlog.length) }, events);
  }

  if (socket.component?.kind === "core" && snap.backlog.length > 0) {
    const task = snap.backlog[0]!;
    const packets = [...snap.packets, { id: nextPacketId, socketIndex: index, taskKind: task.kind, valueLabel: task.valueLabel }];
    nextPacketId += 1;
    const backlog = snap.backlog.slice(1);
    return withEvents({ ...snap, packets, backlog, sockets: relight(snap.sockets, packets, backlog.length) }, events);
  }
  return snap;
}

/** Rotate an empty unlocked socket's trace arrow N -> E -> S -> W -> N. */
export function sampleRotate(snap: RenderSnapshot, index: number): RenderSnapshot {
  const order: Dir[] = ["N", "E", "S", "W"];
  const sockets = snap.sockets.map((s) => (s.index === index ? { ...s, dir: order[(order.indexOf(s.dir) + 1) % 4]! } : s));
  return { ...snap, sockets };
}

/** Spread the first faulted chip's fault to one unfaulted neighbour. */
export function sampleFaultSpread(snap: RenderSnapshot): RenderSnapshot {
  const from = snap.sockets.find((s) => s.component?.faulted);
  if (!from) return snap;
  const to = stepIndex(from.index, "E", snap.boardWidth, snap.boardHeight);
  const target = to !== -1 ? snap.sockets[to] : undefined;
  if (!target?.component || target.component.faulted) return snap;
  const t = snap.uptimeMs;
  const sockets = snap.sockets.map((s) => (s.index === to ? { ...s, component: { ...s.component!, faulted: true, faultSpreadProgress: 0 } } : s));
  return withEvents({ ...snap, sockets: relight(sockets, snap.packets, snap.backlog.length), integrity: Math.max(0, snap.integrity - 5) }, [
    { seq: nextEventSeq++, t, kind: "faultSpread", from: from.index, to },
  ]);
}

/** Toggle the board-wide brownout (spec: duty < 1 while draw > generation and reserve is empty). */
export function sampleToggleBrownout(snap: RenderSnapshot): RenderSnapshot {
  const on = snap.duty >= 1;
  return withEvents({ ...snap, duty: on ? 0.55 : 1 }, [{ seq: nextEventSeq++, t: snap.uptimeMs, kind: "brownout", on }]);
}

/** Bump the hottest empty junction's heat by 15 (capped at 100) to walk the throttle threshold. */
export function sampleHeatSpike(snap: RenderSnapshot): RenderSnapshot {
  let best: RenderSocket | null = null;
  for (const s of snap.sockets) if (s.unlocked && (!best || s.heat > best.heat)) best = s;
  if (!best) return snap;
  const heat = Math.min(100, best.heat + 15);
  const wasThrottled = best.throttled;
  const sockets = snap.sockets.map((s) => (s.index === best!.index ? { ...s, heat, throttled: heat >= 70 } : s));
  const events = wasThrottled === heat >= 70 ? [] : [{ seq: nextEventSeq++, t: snap.uptimeMs, kind: "throttle" as const, index: best.index, on: heat >= 70 }];
  return withEvents({ ...snap, sockets }, events);
}

/** Crash the run: sets the crash payload BoardScene reacts to with a flash + burst. */
export function sampleCrash(snap: RenderSnapshot): RenderSnapshot {
  const damage: { source: DamageSource; amount: number }[] = [
    { source: "backlogOverflow", amount: 24 },
    { source: "overheat", amount: 12 },
    { source: "faultSpread", amount: 10 },
  ];
  return withEvents({ ...snap, integrity: 0, crash: { uptimeMs: snap.uptimeMs, siliconPayout: 7, damage } }, [
    { seq: nextEventSeq++, t: snap.uptimeMs, kind: "crash" },
  ]);
}

/** REFLOW: fresh boot state at the same board size (exercises BoardScene's structural-rebuild path). */
export function sampleReflow(): RenderSnapshot {
  nextPacketId = 1000;
  return {
    ...createSampleSnapshot(),
    uptimeMs: 0,
    integrity: 100,
    crash: null,
    packets: [],
    backlog: [],
    duty: 1,
    events: [],
    lastEventSeq: 0,
  };
}

export const DEMO_CORE_INDEX = at(2, 5);
export const DEMO_ARROW_INDEX = at(3, 2);
