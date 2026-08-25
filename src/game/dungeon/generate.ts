/**
 * Floor generation, redesign v2 (§2): each memory tier carves a different
 * machine topology, then a shared assembly pass places work sites (data nodes,
 * job stations, payload/port pairs), vents, the controller boss, and the
 * regular enemy/item/hazard population.
 *
 *   cache  — 4x3 lattice of 4x3 banks, straight bus corridors, gates at bank mouths
 *   ram    — 3-4 long horizontal banks joined by 2-3 vertical channels
 *   disk   — 2-3 concentric ring corridors with radial spokes; sectors between
 *   kernel — rejection-sampled rooms plus a corruption pass
 *
 * Every carver emits the same FloorState: tiles, one spawn, one exit
 * (TileKind.stairsDown, the bus gate), connected by construction and then
 * verified/repaired. The bus gate starts locked on every floor (quota gate,
 * §3); workstream A's sim unlocks it when `quota.done >= quota.required`
 * (controller floors also need the kernelPanic dead).
 */
import { TileKind, type EnemyKind, type HazardKind, type ItemKind, type TileKindValue } from "../renderSnapshot";
import { nextRngFloat, nextRngInt, type Xoshiro128State } from "../rng";
import type { Enemy, FloorItem, FloorState, Payload, Point, WorkSite } from "../types";
import { createEnemy, pickEnemyKind } from "./enemies";
import { createDataNode, createIoPort, createJobStation, createPayload } from "./worksites";
import {
  FLOOR_HEIGHT,
  FLOOR_WIDTH,
  VENT_TILE,
  inBounds,
  isWalkableTile,
  manhattan,
  neighbors4,
  toIndex,
  toPoint,
} from "./grid";
import { pickItemKind } from "./items";
import { bfsDistances } from "./path";
import { getQuotaPlan, getTier, isControllerDepth, TIER_HAZARD_WEIGHTS, type Tier } from "./tiers";

export interface Room {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GeneratedFloor {
  rng: Xoshiro128State;
  floor: FloorState;
  /** banks / sector rooms / kernel rooms (debug + tests) */
  rooms: Room[];
  spawn: Point;
  enemies: Enemy[];
  items: FloorItem[];
  /** work sites for RunState.sites (workstream A wires them in enterFloor) */
  sites: WorkSite[];
  /** payloads for RunState.payloads; each references its ioPort site id */
  payloads: Payload[];
  /** quota roll for RunState.quota */
  quota: { required: number; done: number };
  tier: Tier;
  nextEntityId: number;
}

// kernel carver (kept from v1)
export const MIN_ROOMS = 8;
export const MAX_ROOMS = 12;
export const ROOM_PLACEMENT_TRIES = 200;
/** corruption pass: fraction of interior wall cells eaten / floor cells hazarded */
export const KERNEL_WALL_EAT_FRACTION = 0.08;
export const KERNEL_FLOOR_HAZARD_FRACTION = 0.05;

/** Minimum BFS separation between a payload and its I/O port (§2). */
export const MIN_HAUL_DISTANCE = 12;

export const getEnemyCount = (depth: number) => 4 + 2 * depth;
export const getItemCount = (depth: number) => 3 + Math.floor(depth / 2);
export const getHazardCount = (depth: number) => 2 * depth;

/** @deprecated v1 name; controller floors are 3, 7, 11, 15+4k now. */
export const isBossDepth = (depth: number) => isControllerDepth(depth);

const HAZARD_KINDS: readonly HazardKind[] = ["hotTile", "overloadPlate", "corruptedSector", "brownout"];

interface Rand {
  int(min: number, maxExclusive: number): number;
  float(): number;
}

interface Carved {
  tiles: TileKindValue[];
  spawn: Point;
  exit: Point;
  rooms: Room[];
  /** dead-end cells for data nodes, best first */
  nodeSpots: Point[];
  /** corridor-mouth cells for job stations */
  jobSpots: Point[];
  /** spread-out cells for payloads and ports */
  haulSpots: Point[];
  /** kernel corruption: extra corruptedSector hazard indices */
  corruption: number[];
}

// literals, not FLOOR_WIDTH/FLOOR_HEIGHT: this module sits inside the
// renderSnapshot -> advance -> turn -> generate import cycle and must not read
// grid.ts exports at module eval (the carver geometry assumes 48x32 anyway).
const DIMS = { width: 48, height: 32 };

const blankTiles = (): TileKindValue[] =>
  new Array<TileKindValue>(FLOOR_WIDTH * FLOOR_HEIGHT).fill(TileKind.wall);

const idx = (x: number, y: number) => toIndex(x, y, FLOOR_WIDTH);

const walkablePassable = (tiles: TileKindValue[]) => (index: number) =>
  isWalkableTile(tiles[index] ?? null);

/** BFS-farthest point of `candidates` from `from` (ties: first). */
const farthestFrom = (tiles: TileKindValue[], from: Point, candidates: readonly Point[]): Point => {
  const distances = bfsDistances(DIMS, from, walkablePassable(tiles));
  let best = candidates[0]!;
  let bestDistance = -1;
  for (const candidate of candidates) {
    const distance = distances[idx(candidate.x, candidate.y)]!;
    if (Number.isFinite(distance) && distance > bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
};

// ---------------------------------------------------------------------------
// cache: bank lattice (used area 29x19, centered on the 48x32 grid)
// ---------------------------------------------------------------------------

const CACHE_COLS = 4;
const CACHE_ROWS = 3;
const CACHE_BANK_W = 4;
const CACHE_BANK_H = 3;
const CACHE_PERIOD_X = CACHE_BANK_W + 3; // corridor, wall, bank, wall
const CACHE_PERIOD_Y = CACHE_BANK_H + 3;
const CACHE_W = CACHE_COLS * CACHE_PERIOD_X + 1; // 29
const CACHE_H = CACHE_ROWS * CACHE_PERIOD_Y + 1; // 19

const carveCache = (rand: Rand): Carved => {
  const tiles = blankTiles();
  const ox = Math.floor((FLOOR_WIDTH - CACHE_W) / 2);
  const oy = Math.floor((FLOOR_HEIGHT - CACHE_H) / 2);
  const set = (lx: number, ly: number, tile: TileKindValue) => {
    tiles[idx(ox + lx, oy + ly)] = tile;
  };
  // bus corridors: a full grid of straight lines
  for (let c = 0; c <= CACHE_COLS; c += 1) {
    for (let ly = 0; ly < CACHE_H; ly += 1) set(c * CACHE_PERIOD_X, ly, TileKind.floor);
  }
  for (let r = 0; r <= CACHE_ROWS; r += 1) {
    for (let lx = 0; lx < CACHE_W; lx += 1) set(lx, r * CACHE_PERIOD_Y, TileKind.floor);
  }
  const rooms: Room[] = [];
  const nodeSpots: Point[] = [];
  const jobSpots: Point[] = [];
  const haulSpots: Point[] = [];
  const bankCenters: Point[] = [];
  let twoGateBanks = 0;
  for (let r = 0; r < CACHE_ROWS; r += 1) {
    for (let c = 0; c < CACHE_COLS; c += 1) {
      const bx = c * CACHE_PERIOD_X + 2; // interior top-left (local)
      const by = r * CACHE_PERIOD_Y + 2;
      rooms.push({ x: ox + bx, y: oy + by, w: CACHE_BANK_W, h: CACHE_BANK_H });
      for (let dy = 0; dy < CACHE_BANK_H; dy += 1) {
        for (let dx = 0; dx < CACHE_BANK_W; dx += 1) set(bx + dx, by + dy, TileKind.floor);
      }
      // gates at the bank mouths; cap two-gate banks so dead-end banks always exist
      const sides = ["w", "e", "n", "s"] as const;
      const first = rand.int(0, 4);
      const wantSecond = rand.float() < 0.4 && twoGateBanks < CACHE_COLS * CACHE_ROWS - 4;
      const gateCells: Point[] = [];
      const chosen = wantSecond ? [sides[first]!, sides[(first + 1 + rand.int(0, 3)) % 4]!] : [sides[first]!];
      for (const side of new Set(chosen)) {
        let gx = 0;
        let gy = 0;
        if (side === "w" || side === "e") {
          gx = side === "w" ? bx - 1 : bx + CACHE_BANK_W;
          gy = by + rand.int(0, CACHE_BANK_H);
        } else {
          gx = bx + rand.int(0, CACHE_BANK_W);
          gy = side === "n" ? by - 1 : by + CACHE_BANK_H;
        }
        set(gx, gy, TileKind.door);
        gateCells.push({ x: ox + gx, y: oy + gy });
      }
      if (gateCells.length >= 2) twoGateBanks += 1;
      const center = { x: ox + bx + 1, y: oy + by + 1 };
      bankCenters.push(center);
      haulSpots.push(center);
      if (gateCells.length === 1) {
        // dead-end bank: node in the interior cell farthest from the gate
        const gate = gateCells[0]!;
        let spot = center;
        let bestDistance = -1;
        for (let dy = 0; dy < CACHE_BANK_H; dy += 1) {
          for (let dx = 0; dx < CACHE_BANK_W; dx += 1) {
            const cell = { x: ox + bx + dx, y: oy + by + dy };
            const distance = manhattan(cell, gate);
            if (distance > bestDistance) {
              bestDistance = distance;
              spot = cell;
            }
          }
        }
        nodeSpots.push(spot);
      } else {
        // bank mouth cell just inside the first gate: near the bus corridor
        const gate = gateCells[0]!;
        const inside = neighbors4(DIMS, gate.x, gate.y).find(
          (n) =>
            n.x >= ox + bx && n.x < ox + bx + CACHE_BANK_W && n.y >= oy + by && n.y < oy + by + CACHE_BANK_H,
        );
        if (inside) jobSpots.push(inside);
      }
    }
  }
  const spawn = { x: ox, y: oy };
  const exit = farthestFrom(tiles, spawn, bankCenters);
  return { tiles, spawn, exit, rooms, nodeSpots, jobSpots, haulSpots, corruption: [] };
};

// ---------------------------------------------------------------------------
// ram: 3-4 long horizontal banks + 2-3 vertical channels
// ---------------------------------------------------------------------------

const RAM_BANK_H = 4;
const RAM_INNER_W = 42;

const carveRam = (rand: Rand): Carved => {
  const tiles = blankTiles();
  const banks = 3 + (rand.float() < 0.5 ? 1 : 0);
  const localH = banks * (RAM_BANK_H + 1) + 1;
  const ox = Math.floor((FLOOR_WIDTH - (RAM_INNER_W + 2)) / 2);
  const oy = Math.floor((FLOOR_HEIGHT - localH) / 2);
  const rooms: Room[] = [];
  const bankMidY: number[] = [];
  for (let r = 0; r < banks; r += 1) {
    const by = r * (RAM_BANK_H + 1) + 1;
    rooms.push({ x: ox + 1, y: oy + by, w: RAM_INNER_W, h: RAM_BANK_H });
    bankMidY.push(oy + by + 1);
    for (let dy = 0; dy < RAM_BANK_H; dy += 1) {
      for (let lx = 1; lx <= RAM_INNER_W; lx += 1) tiles[idx(ox + lx, oy + by + dy)] = TileKind.floor;
    }
  }
  // 2-3 vertical channels: a gate through every inter-bank wall
  const channelCount = banks === 4 ? 3 : 2 + (rand.int(0, 2) === 0 ? 1 : 0);
  const thirds = [3 + rand.int(0, 8), 17 + rand.int(0, 9), 31 + rand.int(0, 9)];
  const channels = (channelCount === 2 ? [thirds[0]!, thirds[2]!] : thirds).map((lx) => ox + lx);
  const jobSpots: Point[] = [];
  for (const cx of channels) {
    for (let r = 1; r < banks; r += 1) {
      const wy = oy + r * (RAM_BANK_H + 1);
      tiles[idx(cx, wy)] = TileKind.door;
      jobSpots.push({ x: cx, y: wy - 1 }, { x: cx, y: wy + 1 });
    }
  }
  // bank ends far from every channel are the dead-end pockets
  const nodeSpots: Point[] = [];
  const endCells: Point[] = [];
  for (const my of bankMidY) {
    for (const ex of [ox + 2, ox + RAM_INNER_W - 1]) {
      const cell = { x: ex, y: my };
      endCells.push(cell);
      const nearestChannel = Math.min(...channels.map((cx) => Math.abs(cx - ex)));
      if (nearestChannel >= 6) nodeSpots.push(cell);
    }
  }
  if (nodeSpots.length < 3) nodeSpots.push(...endCells.filter((cell) => !nodeSpots.includes(cell)));
  const haulSpots: Point[] = [];
  for (const my of bankMidY) {
    for (const lx of [6, 14, 22, 30, 37]) haulSpots.push({ x: ox + lx, y: my });
  }
  const spawn = { x: ox + 2, y: bankMidY[0]! };
  const exit = farthestFrom(tiles, spawn, endCells);
  return { tiles, spawn, exit, rooms, nodeSpots, jobSpots, haulSpots, corruption: [] };
};

// ---------------------------------------------------------------------------
// disk: concentric ring corridors + radial spokes; sector rooms between rings
// ---------------------------------------------------------------------------

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const onRectBorder = (rect: Rect, x: number, y: number) =>
  x >= rect.x0 &&
  x <= rect.x1 &&
  y >= rect.y0 &&
  y <= rect.y1 &&
  (x === rect.x0 || x === rect.x1 || y === rect.y0 || y === rect.y1);

const carveDisk = (rand: Rand): Carved => {
  const tiles = blankTiles();
  const threeRings = rand.float() < 0.6;
  const rings: Rect[] = threeRings
    ? [
        { x0: 2, y0: 2, x1: 45, y1: 29 },
        { x0: 7, y0: 7, x1: 40, y1: 24 },
        { x0: 12, y0: 12, x1: 35, y1: 19 },
      ]
    : [
        { x0: 2, y0: 2, x1: 45, y1: 29 },
        { x0: 10, y0: 10, x1: 37, y1: 21 },
      ];
  for (const ring of rings) {
    for (let x = ring.x0; x <= ring.x1; x += 1) {
      tiles[idx(x, ring.y0)] = TileKind.floor;
      tiles[idx(x, ring.y1)] = TileKind.floor;
    }
    for (let y = ring.y0; y <= ring.y1; y += 1) {
      tiles[idx(ring.x0, y)] = TileKind.floor;
      tiles[idx(ring.x1, y)] = TileKind.floor;
    }
  }
  // hub room inside the innermost ring; the bus gate flush point
  const hub: Rect = threeRings ? { x0: 20, y0: 14, x1: 27, y1: 17 } : { x0: 18, y0: 14, x1: 29, y1: 17 };
  for (let y = hub.y0; y <= hub.y1; y += 1) {
    for (let x = hub.x0; x <= hub.x1; x += 1) tiles[idx(x, y)] = TileKind.floor;
  }
  // radial spokes through everything (vertical + horizontal), inside the hub band
  const vx = hub.x0 + 2 + rand.int(0, hub.x1 - hub.x0 - 3);
  const hy = hub.y0 + rand.int(0, hub.y1 - hub.y0 + 1);
  const outer = rings[0]!;
  const spokeCells: Point[] = [];
  for (let y = outer.y0; y <= outer.y1; y += 1) {
    if (tiles[idx(vx, y)] === TileKind.wall) {
      tiles[idx(vx, y)] = TileKind.floor;
      spokeCells.push({ x: vx, y });
    }
  }
  for (let x = outer.x0; x <= outer.x1; x += 1) {
    if (tiles[idx(x, hy)] === TileKind.wall) {
      tiles[idx(x, hy)] = TileKind.floor;
      spokeCells.push({ x, y: hy });
    }
  }
  // gates: spoke cells that sit right next to a ring corridor line
  const onAnyRing = (x: number, y: number) => rings.some((ring) => onRectBorder(ring, x, y));
  for (const cell of spokeCells) {
    if (onAnyRing(cell.x, cell.y)) continue;
    const besideRing =
      cell.x === vx
        ? onAnyRing(cell.x, cell.y - 1) || onAnyRing(cell.x, cell.y + 1)
        : onAnyRing(cell.x - 1, cell.y) || onAnyRing(cell.x + 1, cell.y);
    if (besideRing) tiles[idx(cell.x, cell.y)] = TileKind.door;
  }
  // sector rooms between consecutive rings, one gate each onto the outer ring
  const rooms: Room[] = [];
  const nodeSpots: Point[] = [];
  const jobSpots: Point[] = [];
  const haulSpots: Point[] = [];
  const carveSector = (rect: Rect, gate: Point, role: "node" | "job") => {
    if (rect.x1 < rect.x0 || rect.y1 < rect.y0) return;
    for (let y = rect.y0; y <= rect.y1; y += 1) {
      for (let x = rect.x0; x <= rect.x1; x += 1) tiles[idx(x, y)] = TileKind.floor;
    }
    tiles[idx(gate.x, gate.y)] = TileKind.door;
    rooms.push({ x: rect.x0, y: rect.y0, w: rect.x1 - rect.x0 + 1, h: rect.y1 - rect.y0 + 1 });
    const center = {
      x: rect.x0 + Math.floor((rect.x1 - rect.x0) / 2),
      y: rect.y0 + Math.floor((rect.y1 - rect.y0) / 2),
    };
    if (role === "node") nodeSpots.push(center);
    else jobSpots.push(center);
    haulSpots.push(center);
  };
  for (let band = 0; band + 1 < rings.length; band += 1) {
    const outerRing = rings[band]!;
    const innerRing = rings[band + 1]!;
    // richest nodes on the outer ring: outer-band sectors hold nodes. With 3
    // rings the inner band hosts stations; with 2 rings the side sectors do.
    const topBottomRole: "node" | "job" = band === 0 ? "node" : "job";
    const sideRole: "node" | "job" = rings.length === 2 ? "job" : topBottomRole;
    const topY: [number, number] = [outerRing.y0 + 2, innerRing.y0 - 2];
    const bottomY: [number, number] = [innerRing.y1 + 2, outerRing.y1 - 2];
    // top + bottom rooms, split by the vertical spoke
    for (const [ry0, ry1] of [topY, bottomY]) {
      const gateY = ry0 === topY[0] ? outerRing.y0 + 1 : outerRing.y1 - 1;
      carveSector(
        { x0: outerRing.x0 + 2, y0: ry0, x1: vx - 2, y1: ry1 },
        { x: Math.floor((outerRing.x0 + 2 + vx - 2) / 2), y: gateY },
        topBottomRole,
      );
      carveSector(
        { x0: vx + 2, y0: ry0, x1: outerRing.x1 - 2, y1: ry1 },
        { x: Math.floor((vx + 2 + outerRing.x1 - 2) / 2), y: gateY },
        topBottomRole,
      );
    }
    // left + right rooms, split by the horizontal spoke
    for (const [rx0, rx1] of [
      [outerRing.x0 + 2, innerRing.x0 - 2],
      [innerRing.x1 + 2, outerRing.x1 - 2],
    ] as const) {
      const gateX = rx0 === outerRing.x0 + 2 ? outerRing.x0 + 1 : outerRing.x1 - 1;
      carveSector(
        { x0: rx0, y0: innerRing.y0, x1: rx1, y1: hy - 2 },
        { x: gateX, y: Math.floor((innerRing.y0 + hy - 2) / 2) },
        sideRole,
      );
      carveSector(
        { x0: rx0, y0: hy + 2, x1: rx1, y1: innerRing.y1 },
        { x: gateX, y: Math.floor((hy + 2 + innerRing.y1) / 2) },
        sideRole,
      );
    }
  }
  // ring corridor waypoints spread the haul goals around the loops
  for (const ring of rings) {
    const mx = Math.floor((ring.x0 + ring.x1) / 2);
    const my = Math.floor((ring.y0 + ring.y1) / 2);
    haulSpots.push(
      { x: ring.x0, y: ring.y0 },
      { x: ring.x1, y: ring.y0 },
      { x: ring.x0, y: ring.y1 },
      { x: ring.x1, y: ring.y1 },
      { x: mx, y: ring.y0 },
      { x: mx, y: ring.y1 },
      { x: ring.x0, y: my },
      { x: ring.x1, y: my },
    );
  }
  rooms.push({ x: hub.x0, y: hub.y0, w: hub.x1 - hub.x0 + 1, h: hub.y1 - hub.y0 + 1 });
  const spawn = { x: outer.x0, y: outer.y0 };
  const exit = {
    x: Math.floor((hub.x0 + hub.x1) / 2),
    y: Math.floor((hub.y0 + hub.y1) / 2),
  };
  return { tiles, spawn, exit, rooms, nodeSpots, jobSpots, haulSpots, corruption: [] };
};

// ---------------------------------------------------------------------------
// kernel: v1 rejection-sampled rooms + corruption pass
// ---------------------------------------------------------------------------

const roomCenter = (room: Room): Point => ({
  x: room.x + Math.floor(room.w / 2),
  y: room.y + Math.floor(room.h / 2),
});

const roomsOverlap = (a: Room, b: Room) =>
  a.x - 1 < b.x + b.w + 1 && a.x + a.w + 1 > b.x - 1 && a.y - 1 < b.y + b.h + 1 && a.y + a.h + 1 > b.y - 1;

const roomContains = (room: Room, x: number, y: number) =>
  x >= room.x && x < room.x + room.w && y >= room.y && y < room.y + room.h;

const carveKernel = (rand: Rand): Carved => {
  const tiles = blankTiles();
  const width = FLOOR_WIDTH;
  const height = FLOOR_HEIGHT;
  const targetRooms = rand.int(MIN_ROOMS, MAX_ROOMS + 1);
  const rooms: Room[] = [];
  for (let tries = 0; tries < ROOM_PLACEMENT_TRIES && rooms.length < targetRooms; tries += 1) {
    const w = rand.int(4, 11);
    const h = rand.int(3, 8);
    const x = rand.int(1, width - w - 1);
    const y = rand.int(1, height - h - 1);
    const candidate: Room = { x, y, w, h };
    if (rooms.some((room) => roomsOverlap(room, candidate))) continue;
    rooms.push(candidate);
  }
  if (rooms.length < 2) {
    rooms.length = 0;
    rooms.push({ x: 2, y: 2, w: 6, h: 4 }, { x: width - 9, y: height - 7, w: 6, h: 4 });
  }
  rooms.sort((a, b) => a.x - b.x || a.y - b.y);
  for (const room of rooms) {
    for (let y = room.y; y < room.y + room.h; y += 1) {
      for (let x = room.x; x < room.x + room.w; x += 1) tiles[idx(x, y)] = TileKind.floor;
    }
  }
  // L corridors between consecutive rooms, doors at corridor mouths
  const corridor: number[] = [];
  const carve = (x: number, y: number) => {
    const index = idx(x, y);
    if (tiles[index] === TileKind.wall) {
      tiles[index] = TileKind.floor;
      corridor.push(index);
    }
  };
  const carveH = (x0: number, x1: number, y: number) => {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x += 1) carve(x, y);
  };
  const carveV = (y0: number, y1: number, x: number) => {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y += 1) carve(x, y);
  };
  for (let index = 0; index + 1 < rooms.length; index += 1) {
    const a = roomCenter(rooms[index]!);
    const b = roomCenter(rooms[index + 1]!);
    if (rand.float() < 0.5) {
      carveH(a.x, b.x, a.y);
      carveV(a.y, b.y, b.x);
    } else {
      carveV(a.y, b.y, a.x);
      carveH(a.x, b.x, b.y);
    }
  }
  const doorCells: Point[] = [];
  for (const index of corridor) {
    const { x, y } = toPoint(index, width);
    if (rooms.some((room) => roomContains(room, x, y))) continue;
    const touchesRoom = neighbors4(DIMS, x, y).some((n) => rooms.some((room) => roomContains(room, n.x, n.y)));
    if (touchesRoom) {
      tiles[index] = TileKind.door;
      doorCells.push({ x, y });
    }
  }
  // corruption pass: eat interior walls that touch existing floor (stays connected)
  const snapshot = tiles.slice();
  const eatCandidates: number[] = [];
  let wallCount = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = idx(x, y);
      if (snapshot[index] !== TileKind.wall) continue;
      wallCount += 1;
      const touchesFloor = neighbors4(DIMS, x, y).some((n) => isWalkableTile(snapshot[idx(n.x, n.y)] ?? null));
      if (touchesFloor) eatCandidates.push(index);
    }
  }
  const eatCount = Math.min(eatCandidates.length, Math.floor(wallCount * KERNEL_WALL_EAT_FRACTION));
  for (let eaten = 0; eaten < eatCount; eaten += 1) {
    const pick = rand.int(0, eatCandidates.length);
    const index = eatCandidates[pick]!;
    eatCandidates[pick] = eatCandidates[eatCandidates.length - 1]!;
    eatCandidates.pop();
    tiles[index] = TileKind.floor;
  }
  const spawn = roomCenter(rooms[0]!);
  const exit = farthestFrom(tiles, spawn, rooms.slice(1).map(roomCenter));
  // 5% of floor cells become corruption hazards (never spawn/exit)
  const floorCells: number[] = [];
  const spawnIndex = idx(spawn.x, spawn.y);
  const exitIndex = idx(exit.x, exit.y);
  for (let index = 0; index < tiles.length; index += 1) {
    if (tiles[index] === TileKind.floor && index !== spawnIndex && index !== exitIndex) floorCells.push(index);
  }
  const corruption: number[] = [];
  const corruptCount = Math.floor(floorCells.length * KERNEL_FLOOR_HAZARD_FRACTION);
  for (let count = 0; count < corruptCount; count += 1) {
    const pick = rand.int(0, floorCells.length);
    corruption.push(floorCells[pick]!);
    floorCells[pick] = floorCells[floorCells.length - 1]!;
    floorCells.pop();
  }
  // deep rooms far from the spawn hold the nodes; door mouths host stations
  const centers = rooms.slice(1).map(roomCenter);
  const distances = bfsDistances(DIMS, spawn, walkablePassable(tiles));
  const finiteDistance = (p: Point) => {
    const distance = distances[idx(p.x, p.y)]!;
    return Number.isFinite(distance) ? distance : -1;
  };
  const nodeSpots = [...centers].sort((a, b) => finiteDistance(b) - finiteDistance(a));
  const jobSpots: Point[] = [];
  for (const door of doorCells) {
    const inside = neighbors4(DIMS, door.x, door.y).find((n) =>
      rooms.some((room) => roomContains(room, n.x, n.y)),
    );
    if (inside) jobSpots.push(inside);
  }
  return { tiles, spawn, exit, rooms, nodeSpots, jobSpots, haulSpots: centers, corruption };
};

// ---------------------------------------------------------------------------
// shared assembly
// ---------------------------------------------------------------------------

/** Carve straight repair tunnels until every walkable tile reaches the spawn. */
const repairConnectivity = (tiles: TileKindValue[], spawn: Point) => {
  for (let guard = 0; guard < 32; guard += 1) {
    const distances = bfsDistances(DIMS, spawn, walkablePassable(tiles));
    let orphan: Point | null = null;
    for (let index = 0; index < tiles.length; index += 1) {
      if (isWalkableTile(tiles[index] ?? null) && !Number.isFinite(distances[index]!)) {
        orphan = toPoint(index, FLOOR_WIDTH);
        break;
      }
    }
    if (!orphan) return;
    // L tunnel from the orphan toward the spawn
    const stepX = spawn.x >= orphan.x ? 1 : -1;
    for (let x = orphan.x; x !== spawn.x; x += stepX) {
      if (tiles[idx(x, orphan.y)] === TileKind.wall) tiles[idx(x, orphan.y)] = TileKind.floor;
    }
    const stepY = spawn.y >= orphan.y ? 1 : -1;
    for (let y = orphan.y; y !== spawn.y; y += stepY) {
      if (tiles[idx(spawn.x, y)] === TileKind.wall) tiles[idx(spawn.x, y)] = TileKind.floor;
    }
  }
};

export const generateFloor = (
  inputRng: Xoshiro128State,
  depth: number,
  firstEntityId: number,
): GeneratedFloor => {
  let rng = inputRng;
  const rand: Rand = {
    int: (min, maxExclusive) => {
      const next = nextRngInt(rng, min, maxExclusive);
      rng = next.state;
      return next.value;
    },
    float: () => {
      const next = nextRngFloat(rng);
      rng = next.state;
      return next.value;
    },
  };

  const tier = getTier(depth);
  const carved =
    tier === "cache"
      ? carveCache(rand)
      : tier === "ram"
        ? carveRam(rand)
        : tier === "disk"
          ? carveDisk(rand)
          : carveKernel(rand);
  const { tiles, spawn, exit, rooms } = carved;
  tiles[idx(exit.x, exit.y)] = TileKind.stairsDown;
  repairConnectivity(tiles, spawn);

  const spawnIndex = idx(spawn.x, spawn.y);
  const exitIndex = idx(exit.x, exit.y);
  const used = new Set<number>([spawnIndex, exitIndex]);
  const corruptionSet = new Set(carved.corruption);
  const distances = bfsDistances(DIMS, spawn, walkablePassable(tiles));
  const usable = (cell: Point) => {
    const index = idx(cell.x, cell.y);
    return (
      tiles[index] === TileKind.floor &&
      !used.has(index) &&
      !corruptionSet.has(index) &&
      Number.isFinite(distances[index]!)
    );
  };
  const takeSpot = (spots: readonly Point[]): Point | null => {
    for (const spot of spots) {
      if (!usable(spot)) continue;
      used.add(idx(spot.x, spot.y));
      return spot;
    }
    return null;
  };
  /** last-resort spot: the farthest usable plain floor cell */
  const takeFallback = (): Point | null => {
    let best: Point | null = null;
    let bestDistance = -1;
    for (let index = 0; index < tiles.length; index += 1) {
      const cell = toPoint(index, FLOOR_WIDTH);
      if (!usable(cell)) continue;
      const distance = distances[index]!;
      if (distance > bestDistance) {
        bestDistance = distance;
        best = cell;
      }
    }
    if (best) used.add(idx(best.x, best.y));
    return best;
  };

  // --- work sites (§2 placement, §3 numbers) -------------------------------
  let nextEntityId = firstEntityId;
  const plan = getQuotaPlan(depth);
  const sites: WorkSite[] = [];
  const payloads: Payload[] = [];
  for (let count = 0; count < plan.nodes; count += 1) {
    const cell = takeSpot(carved.nodeSpots) ?? takeFallback();
    if (!cell) break;
    sites.push(createDataNode(nextEntityId++, cell.x, cell.y, depth));
  }
  for (let count = 0; count < plan.jobs; count += 1) {
    const cell = takeSpot(carved.jobSpots) ?? takeSpot(carved.haulSpots) ?? takeFallback();
    if (!cell) break;
    sites.push(createJobStation(nextEntityId++, cell.x, cell.y, depth));
  }
  for (let count = 0; count < plan.hauls; count += 1) {
    const payloadCell = takeSpot(carved.haulSpots) ?? takeFallback();
    if (!payloadCell) break;
    const fromPayload = bfsDistances(DIMS, payloadCell, walkablePassable(tiles));
    const farEnough = (cell: Point) => (fromPayload[idx(cell.x, cell.y)] ?? 0) >= MIN_HAUL_DISTANCE;
    let portCell = takeSpot(carved.haulSpots.filter((cell) => usable(cell) && farEnough(cell)));
    if (!portCell) {
      // fallback: any usable floor cell, preferring >= MIN_HAUL_DISTANCE, else max
      let best: Point | null = null;
      let bestDistance = -1;
      for (let index = 0; index < tiles.length; index += 1) {
        const cell = toPoint(index, FLOOR_WIDTH);
        if (!usable(cell)) continue;
        const distance = fromPayload[index]!;
        if (!Number.isFinite(distance)) continue;
        if (distance >= MIN_HAUL_DISTANCE) {
          best = cell;
          break;
        }
        if (distance > bestDistance) {
          bestDistance = distance;
          best = cell;
        }
      }
      portCell = best;
      if (portCell) used.add(idx(portCell.x, portCell.y));
    }
    if (!portCell) break;
    const portId = nextEntityId++;
    sites.push(createIoPort(portId, portCell.x, portCell.y, depth));
    payloads.push(createPayload(nextEntityId++, payloadCell.x, payloadCell.y, portId, depth));
  }

  // --- vents: 1-2 per floor, next to job stations (§2) ---------------------
  const ventTarget = 1 + (rand.float() < 0.5 ? 1 : 0);
  let vents = 0;
  const jobSites = sites.filter((site) => site.kind === "jobStation");
  for (const radius of [3, 6]) {
    for (const site of jobSites) {
      if (vents >= ventTarget) break;
      let best: Point | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const cell = { x: site.x + dx, y: site.y + dy };
          if (!inBounds(DIMS, cell.x, cell.y) || !usable(cell)) continue;
          const distance = Math.abs(dx) + Math.abs(dy);
          if (distance > 0 && distance < bestDistance) {
            bestDistance = distance;
            best = cell;
          }
        }
      }
      if (best) {
        tiles[idx(best.x, best.y)] = VENT_TILE;
        used.add(idx(best.x, best.y));
        vents += 1;
      }
    }
    if (vents > 0) break;
  }

  // --- controller floors: a kernelPanic guards the bus gate ----------------
  let bossCell: Point | null = null;
  if (isControllerDepth(depth)) {
    for (const cell of neighbors4(DIMS, exit.x, exit.y)) {
      const index = idx(cell.x, cell.y);
      if (isWalkableTile(tiles[index] ?? null) && !used.has(index)) {
        bossCell = cell;
        used.add(index);
        break;
      }
    }
  }

  // --- population ----------------------------------------------------------
  const candidates: number[] = [];
  for (let index = 0; index < tiles.length; index += 1) {
    if (tiles[index] !== TileKind.floor) continue;
    if (used.has(index) || corruptionSet.has(index)) continue;
    const cell = toPoint(index, FLOOR_WIDTH);
    if (manhattan(cell, spawn) <= 3) continue;
    if (!Number.isFinite(distances[index]!)) continue;
    candidates.push(index);
  }
  const takeCell = (): Point | null => {
    if (candidates.length === 0) return null;
    const pick = rand.int(0, candidates.length);
    const index = candidates[pick]!;
    candidates[pick] = candidates[candidates.length - 1]!;
    candidates.pop();
    return toPoint(index, FLOOR_WIDTH);
  };

  const enemies: Enemy[] = [];
  if (bossCell) enemies.push(createEnemy("kernelPanic", depth, nextEntityId++, bossCell.x, bossCell.y));
  for (let count = 0; count < getEnemyCount(depth); count += 1) {
    const cell = takeCell();
    if (!cell) break;
    const picked = pickEnemyKind(rng, depth);
    rng = picked.state;
    const kind: EnemyKind = picked.value;
    enemies.push(createEnemy(kind, depth, nextEntityId++, cell.x, cell.y));
  }
  const items: FloorItem[] = [];
  for (let count = 0; count < getItemCount(depth); count += 1) {
    const cell = takeCell();
    if (!cell) break;
    const picked = pickItemKind(rng);
    rng = picked.state;
    const kind: ItemKind = picked.value;
    items.push({ id: nextEntityId++, kind, x: cell.x, y: cell.y });
  }
  const hazardWeights = TIER_HAZARD_WEIGHTS[tier];
  const hazardTotal = HAZARD_KINDS.reduce((sum, kind) => sum + hazardWeights[kind], 0);
  const pickHazard = (): HazardKind => {
    let roll = rand.float() * hazardTotal;
    for (const kind of HAZARD_KINDS) {
      roll -= hazardWeights[kind];
      if (roll < 0) return kind;
    }
    return HAZARD_KINDS[HAZARD_KINDS.length - 1]!;
  };
  const hazards: FloorState["hazards"] = carved.corruption.map((index) => ({
    index,
    kind: "corruptedSector" as const,
  }));
  for (let count = 0; count < getHazardCount(depth); count += 1) {
    const cell = takeCell();
    if (!cell) break;
    hazards.push({ index: idx(cell.x, cell.y), kind: pickHazard() });
  }

  const floor: FloorState = {
    width: FLOOR_WIDTH,
    height: FLOOR_HEIGHT,
    tiles,
    explored: new Array<boolean>(tiles.length).fill(false),
    visible: new Array<boolean>(tiles.length).fill(false),
    stairs: exit,
    hazards,
    // quota gate (§3): every floor's bus gate starts locked; the sim unlocks it
    stairsLocked: true,
  };
  return {
    rng,
    floor,
    rooms,
    spawn,
    enemies,
    items,
    sites,
    payloads,
    quota: { required: plan.required, done: 0 },
    tier,
    nextEntityId,
  };
};
