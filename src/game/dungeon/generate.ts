import { TileKind, type EnemyKind, type HazardKind, type ItemKind, type TileKindValue } from "../renderSnapshot";
import { nextRngFloat, nextRngInt, type Xoshiro128State } from "../rng";
import type { Enemy, FloorItem, FloorState, Point } from "../types";
import { createEnemy, pickEnemyKind } from "./enemies";
import { FLOOR_HEIGHT, FLOOR_WIDTH, inBounds, isWalkableTile, neighbors4, toIndex, toPoint } from "./grid";
import { pickItemKind } from "./items";
import { bfsDistances } from "./path";

export interface Room {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GeneratedFloor {
  rng: Xoshiro128State;
  floor: FloorState;
  rooms: Room[];
  spawn: Point;
  enemies: Enemy[];
  items: FloorItem[];
  nextEntityId: number;
}

export const MIN_ROOMS = 8;
export const MAX_ROOMS = 12;
export const ROOM_PLACEMENT_TRIES = 200;

export const getEnemyCount = (depth: number) => 4 + 2 * depth;
export const getItemCount = (depth: number) => 3 + Math.floor(depth / 2);
export const getHazardCount = (depth: number) => 2 * depth;

const HAZARD_KINDS: readonly HazardKind[] = ["hotTile", "overloadPlate", "corruptedSector", "brownout"];

const roomCenter = (room: Room): Point => ({
  x: room.x + Math.floor(room.w / 2),
  y: room.y + Math.floor(room.h / 2),
});

const roomsOverlap = (a: Room, b: Room) =>
  a.x - 1 < b.x + b.w + 1 && a.x + a.w + 1 > b.x - 1 && a.y - 1 < b.y + b.h + 1 && a.y + a.h + 1 > b.y - 1;

const roomContains = (room: Room, x: number, y: number) =>
  x >= room.x && x < room.x + room.w && y >= room.y && y < room.y + room.h;

export const generateFloor = (
  inputRng: Xoshiro128State,
  depth: number,
  firstEntityId: number,
): GeneratedFloor => {
  let rng = inputRng;
  const int = (min: number, maxExclusive: number) => {
    const next = nextRngInt(rng, min, maxExclusive);
    rng = next.state;
    return next.value;
  };
  const float = () => {
    const next = nextRngFloat(rng);
    rng = next.state;
    return next.value;
  };

  const width = FLOOR_WIDTH;
  const height = FLOOR_HEIGHT;
  const size = width * height;
  const tiles: TileKindValue[] = new Array<TileKindValue>(size).fill(TileKind.wall);
  const dims = { width, height };

  // 1. rooms via rejection sampling
  const targetRooms = int(MIN_ROOMS, MAX_ROOMS + 1);
  const rooms: Room[] = [];
  for (let tries = 0; tries < ROOM_PLACEMENT_TRIES && rooms.length < targetRooms; tries += 1) {
    const w = int(4, 11);
    const h = int(3, 8);
    const x = int(1, width - w - 1);
    const y = int(1, height - h - 1);
    const candidate: Room = { x, y, w, h };
    if (rooms.some((room) => roomsOverlap(room, candidate))) continue;
    rooms.push(candidate);
  }
  if (rooms.length < 2) {
    // Practically unreachable on a 48x32 grid; keep the floor well-formed anyway.
    rooms.length = 0;
    rooms.push({ x: 2, y: 2, w: 6, h: 4 }, { x: width - 9, y: height - 7, w: 6, h: 4 });
  }
  // 2. sort by x
  rooms.sort((a, b) => a.x - b.x || a.y - b.y);
  for (const room of rooms) {
    for (let y = room.y; y < room.y + room.h; y += 1) {
      for (let x = room.x; x < room.x + room.w; x += 1) tiles[toIndex(x, y, width)] = TileKind.floor;
    }
  }

  // 3. L corridors between consecutive rooms
  const corridor: number[] = [];
  const carve = (x: number, y: number) => {
    const index = toIndex(x, y, width);
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
    if (float() < 0.5) {
      carveH(a.x, b.x, a.y);
      carveV(a.y, b.y, b.x);
    } else {
      carveV(a.y, b.y, a.x);
      carveH(a.x, b.x, b.y);
    }
  }
  // doors: corridor cells that touch a room interior
  for (const index of corridor) {
    const { x, y } = toPoint(index, width);
    if (rooms.some((room) => roomContains(room, x, y))) continue;
    const touchesRoom = neighbors4(dims, x, y).some((n) =>
      rooms.some((room) => roomContains(room, n.x, n.y)),
    );
    if (touchesRoom) tiles[index] = TileKind.door;
  }

  // 4. spawn in room 0; stairs in the BFS-farthest room
  const spawn = roomCenter(rooms[0]!);
  const distances = bfsDistances(dims, spawn, (index) => isWalkableTile(tiles[index] ?? null));
  let stairsRoom = rooms.length > 1 ? rooms[1]! : rooms[0]!;
  let best = -1;
  for (let index = 1; index < rooms.length; index += 1) {
    const center = roomCenter(rooms[index]!);
    const distance = distances[toIndex(center.x, center.y, width)]!;
    if (Number.isFinite(distance) && distance > best) {
      best = distance;
      stairsRoom = rooms[index]!;
    }
  }
  const stairs = roomCenter(stairsRoom);
  tiles[toIndex(stairs.x, stairs.y, width)] = TileKind.stairsDown;

  // 5. population
  const spawnRoom = rooms[0]!;
  const candidates: number[] = [];
  for (let index = 0; index < size; index += 1) {
    if (tiles[index] !== TileKind.floor) continue;
    const { x, y } = toPoint(index, width);
    if (roomContains(spawnRoom, x, y)) continue;
    if (!inBounds(dims, x, y)) continue;
    candidates.push(index);
  }
  const takeCell = (): Point | null => {
    if (candidates.length === 0) return null;
    const pick = int(0, candidates.length);
    const index = candidates[pick]!;
    candidates[pick] = candidates[candidates.length - 1]!;
    candidates.pop();
    return toPoint(index, width);
  };

  let nextEntityId = firstEntityId;
  const enemies: Enemy[] = [];
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
  const hazards: FloorState["hazards"] = [];
  for (let count = 0; count < getHazardCount(depth); count += 1) {
    const cell = takeCell();
    if (!cell) break;
    hazards.push({ index: toIndex(cell.x, cell.y, width), kind: HAZARD_KINDS[int(0, HAZARD_KINDS.length)]! });
  }

  const floor: FloorState = {
    width,
    height,
    tiles,
    explored: new Array<boolean>(size).fill(false),
    visible: new Array<boolean>(size).fill(false),
    stairs,
    hazards,
  };
  return { rng, floor, rooms, spawn, enemies, items, nextEntityId };
};
