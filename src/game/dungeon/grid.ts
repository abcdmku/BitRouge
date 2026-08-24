import { TileKind, type Dir, type Facing, type TileKindValue } from "../renderSnapshot";
import type { FloorState, Point } from "../types";

export const FLOOR_WIDTH = 48;
export const FLOOR_HEIGHT = 32;

export const DIRS: readonly Dir[] = ["n", "s", "e", "w"];

export const DIR_VECTORS: Record<Dir, Point> = {
  n: { x: 0, y: -1 },
  s: { x: 0, y: 1 },
  e: { x: 1, y: 0 },
  w: { x: -1, y: 0 },
};

export const toIndex = (x: number, y: number, width: number) => y * width + x;

export const toPoint = (index: number, width: number): Point => ({
  x: index % width,
  y: Math.floor(index / width),
});

export const inBounds = (floor: Pick<FloorState, "width" | "height">, x: number, y: number) =>
  x >= 0 && y >= 0 && x < floor.width && y < floor.height;

export const tileAt = (floor: FloorState, x: number, y: number): TileKindValue | null =>
  inBounds(floor, x, y) ? (floor.tiles[toIndex(x, y, floor.width)] ?? null) : null;

export const isWalkableTile = (tile: TileKindValue | null) =>
  tile !== null && tile !== TileKind.wall;

/** Doors are corridor mouths, not shutters: only walls block sight. */
export const isOpaqueTile = (tile: TileKindValue | null) => tile === null || tile === TileKind.wall;

export const isWalkableAt = (floor: FloorState, x: number, y: number) =>
  isWalkableTile(tileAt(floor, x, y));

export const manhattan = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

export const chebyshev = (a: Point, b: Point) =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

export const isAdjacent = (a: Point, b: Point) => manhattan(a, b) === 1;

export const samePoint = (a: Point, b: Point) => a.x === b.x && a.y === b.y;

export const facingForDir = (dir: Dir, current: Facing): Facing =>
  dir === "e" ? "r" : dir === "w" ? "l" : current;

export const facingToward = (from: Point, to: Point, current: Facing): Facing =>
  to.x > from.x ? "r" : to.x < from.x ? "l" : current;

/** Direction from `from` to an orthogonally adjacent `to`; null otherwise. */
export const dirTo = (from: Point, to: Point): Dir | null => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 1 && dy === 0) return "e";
  if (dx === -1 && dy === 0) return "w";
  if (dx === 0 && dy === 1) return "s";
  if (dx === 0 && dy === -1) return "n";
  return null;
};

/**
 * Candidate step directions toward a target, best first: primary axis, then the
 * secondary axis, then the perpendicular alternatives. Never the opposite of
 * the primary axis, so greedy chasers do not oscillate backwards.
 */
export const dirsToward = (from: Point, to: Point): Dir[] => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const horizontal: Dir = dx >= 0 ? "e" : "w";
  const vertical: Dir = dy >= 0 ? "s" : "n";
  const ordered: Dir[] = [];
  if (Math.abs(dx) >= Math.abs(dy)) {
    if (dx !== 0) ordered.push(horizontal);
    if (dy !== 0) ordered.push(vertical);
    ordered.push(dy >= 0 ? "n" : "s");
    if (dy === 0) ordered.push("s", "n");
  } else {
    ordered.push(vertical);
    if (dx !== 0) ordered.push(horizontal);
    ordered.push(dx >= 0 ? "w" : "e");
    if (dx === 0) ordered.push("e", "w");
  }
  return [...new Set(ordered)];
};

export const dirsAway = (from: Point, threat: Point): Dir[] => {
  const mirrored: Point = { x: from.x - (threat.x - from.x), y: from.y - (threat.y - from.y) };
  return dirsToward(from, mirrored);
};

export const neighbors4 = (floor: Pick<FloorState, "width" | "height">, x: number, y: number) => {
  const result: Point[] = [];
  for (const dir of DIRS) {
    const nx = x + DIR_VECTORS[dir].x;
    const ny = y + DIR_VECTORS[dir].y;
    if (inBounds(floor, nx, ny)) result.push({ x: nx, y: ny });
  }
  return result;
};

/** Bresenham line including both endpoints. */
export const bresenhamLine = (a: Point, b: Point): Point[] => {
  const points: Point[] = [];
  let x = a.x;
  let y = a.y;
  const dx = Math.abs(b.x - a.x);
  const dy = -Math.abs(b.y - a.y);
  const sx = a.x < b.x ? 1 : -1;
  const sy = a.y < b.y ? 1 : -1;
  let error = dx + dy;
  for (;;) {
    points.push({ x, y });
    if (x === b.x && y === b.y) break;
    const doubled = 2 * error;
    if (doubled >= dy) {
      error += dy;
      x += sx;
    }
    if (doubled <= dx) {
      error += dx;
      y += sy;
    }
  }
  return points;
};

/** True when no opaque tile lies strictly between `a` and `b`. */
export const hasLineOfSight = (floor: FloorState, a: Point, b: Point) => {
  let x = a.x;
  let y = a.y;
  const dx = Math.abs(b.x - a.x);
  const dy = -Math.abs(b.y - a.y);
  const sx = a.x < b.x ? 1 : -1;
  const sy = a.y < b.y ? 1 : -1;
  let error = dx + dy;
  for (;;) {
    const doubled = 2 * error;
    if (doubled >= dy) {
      error += dy;
      x += sx;
    }
    if (doubled <= dx) {
      error += dx;
      y += sy;
    }
    if (x === b.x && y === b.y) return true;
    if (isOpaqueTile(tileAt(floor, x, y))) return false;
  }
};
