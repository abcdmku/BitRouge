import type { FloorState, Point } from "../types";
import { DIRS, DIR_VECTORS, inBounds, toIndex, toPoint } from "./grid";

export type PassableFn = (index: number) => boolean;
export type GoalFn = (index: number) => boolean;

const UNVISITED = -2;
const START = -1;
const BLOCKED = -3;

/**
 * Breadth-first search over the grid. Goal cells are accepted even when not
 * passable (attacking an enemy, stepping onto stairs), and the returned path
 * excludes the start and includes the goal. Returns [] when already at a goal.
 */
export const bfsSearch = (
  floor: Pick<FloorState, "width" | "height">,
  start: Point,
  passable: PassableFn,
  isGoal: GoalFn,
): Point[] | null => {
  const { width, height } = floor;
  const size = width * height;
  const startIndex = toIndex(start.x, start.y, width);
  if (isGoal(startIndex)) return [];
  const prev = new Int32Array(size).fill(UNVISITED);
  const queue = new Int32Array(size);
  let head = 0;
  let tail = 0;
  prev[startIndex] = START;
  queue[tail++] = startIndex;
  while (head < tail) {
    const current = queue[head++]!;
    const cx = current % width;
    const cy = (current - cx) / width;
    for (const dir of DIRS) {
      const nx = cx + DIR_VECTORS[dir].x;
      const ny = cy + DIR_VECTORS[dir].y;
      if (!inBounds(floor, nx, ny)) continue;
      const next = toIndex(nx, ny, width);
      if (prev[next] !== UNVISITED) continue;
      if (isGoal(next)) {
        prev[next] = current;
        const path: Point[] = [];
        let cursor = next;
        while (cursor !== startIndex) {
          path.push(toPoint(cursor, width));
          cursor = prev[cursor]!;
        }
        path.reverse();
        return path;
      }
      if (!passable(next)) {
        prev[next] = BLOCKED;
        continue;
      }
      prev[next] = current;
      queue[tail++] = next;
    }
  }
  return null;
};

export const findPath = (
  floor: Pick<FloorState, "width" | "height">,
  from: Point,
  to: Point,
  passable: PassableFn,
): Point[] | null => {
  const goal = toIndex(to.x, to.y, floor.width);
  return bfsSearch(floor, from, passable, (index) => index === goal);
};

/** BFS distance map from `start` (Infinity where unreachable). */
export const bfsDistances = (
  floor: Pick<FloorState, "width" | "height">,
  start: Point,
  passable: PassableFn,
): Float64Array => {
  const { width, height } = floor;
  const size = width * height;
  const distances = new Float64Array(size).fill(Number.POSITIVE_INFINITY);
  const queue = new Int32Array(size);
  let head = 0;
  let tail = 0;
  const startIndex = toIndex(start.x, start.y, width);
  distances[startIndex] = 0;
  queue[tail++] = startIndex;
  while (head < tail) {
    const current = queue[head++]!;
    const cx = current % width;
    const cy = (current - cx) / width;
    for (const dir of DIRS) {
      const nx = cx + DIR_VECTORS[dir].x;
      const ny = cy + DIR_VECTORS[dir].y;
      if (!inBounds(floor, nx, ny)) continue;
      const next = toIndex(nx, ny, width);
      if (distances[next] !== Number.POSITIVE_INFINITY || !passable(next)) continue;
      distances[next] = distances[current]! + 1;
      queue[tail++] = next;
    }
  }
  return distances;
};
