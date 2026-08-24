import type { FloorState, Point } from "../types";
import { isOpaqueTile, toIndex } from "./grid";

export interface FovResult {
  visible: boolean[];
  /** indices marked visible (unordered, may repeat); lets callers avoid full-grid scans */
  marked: number[];
}

/** Ray-cast field of view: rays to every cell on the perimeter of the radius square. */
export const computeFov = (floor: FloorState, origin: Point, radius: number): FovResult => {
  const visible = new Array<boolean>(floor.width * floor.height).fill(false);
  const marked: number[] = [];
  const originIndex = toIndex(origin.x, origin.y, floor.width);
  visible[originIndex] = true;
  marked.push(originIndex);
  const { width, height, tiles } = floor;
  // Bresenham without building a point list; this runs every turn.
  const castRay = (target: Point) => {
    let x = origin.x;
    let y = origin.y;
    const dx = Math.abs(target.x - x);
    const dy = -Math.abs(target.y - y);
    const sx = x < target.x ? 1 : -1;
    const sy = y < target.y ? 1 : -1;
    let error = dx + dy;
    for (;;) {
      if (x === target.x && y === target.y) break;
      const doubled = 2 * error;
      if (doubled >= dy) {
        error += dy;
        x += sx;
      }
      if (doubled <= dx) {
        error += dx;
        y += sy;
      }
      if (x < 0 || y < 0 || x >= width || y >= height) break;
      const cell = y * width + x;
      if (!visible[cell]) {
        visible[cell] = true;
        marked.push(cell);
      }
      if (isOpaqueTile(tiles[cell] ?? null)) break;
    }
  };
  for (let dx = -radius; dx <= radius; dx += 1) {
    castRay({ x: origin.x + dx, y: origin.y - radius });
    castRay({ x: origin.x + dx, y: origin.y + radius });
  }
  for (let dy = -radius + 1; dy < radius; dy += 1) {
    castRay({ x: origin.x - radius, y: origin.y + dy });
    castRay({ x: origin.x + radius, y: origin.y + dy });
  }
  return { visible, marked };
};

export const computeVisible = (floor: FloorState, origin: Point, radius: number): boolean[] =>
  computeFov(floor, origin, radius).visible;

/** Merge newly seen cells into the explored map; returns the same array when nothing changed. */
export const revealExplored = (explored: boolean[], marked: readonly number[]): boolean[] => {
  let changed = false;
  for (const index of marked) {
    if (!explored[index]) {
      changed = true;
      break;
    }
  }
  if (!changed) return explored;
  const next = explored.slice();
  for (const index of marked) next[index] = true;
  return next;
};
