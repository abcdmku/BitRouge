import { useEffect, type RefObject } from "react";
import type { Dir } from "../../game/renderSnapshot";

const MIN_SWIPE_PX = 24;
const MAX_SWIPE_MS = 600;

/** Direction of a swipe vector, or null when it is too short. Pure; exported for tests. */
export function swipeDir(dx: number, dy: number, minPx = MIN_SWIPE_PX): Dir | null {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < minPx) return null;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "e" : "w";
  return dy > 0 ? "s" : "n";
}

/**
 * Pointer swipe on an element -> direction. Uses pointer events so mouse drags
 * work too. Taps (short moves) are ignored here; Phaser handles cell taps.
 */
export function useSwipe(ref: RefObject<HTMLElement | null>, onSwipe: (dir: Dir) => void): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let start: { x: number; y: number; t: number; id: number } | null = null;

    const down = (e: PointerEvent) => {
      if (!e.isPrimary) return;
      start = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
    };
    const up = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      const dt = performance.now() - start.t;
      start = null;
      if (dt > MAX_SWIPE_MS) return;
      const dir = swipeDir(dx, dy);
      if (dir) onSwipe(dir);
    };
    const cancel = () => {
      start = null;
    };

    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", cancel);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", cancel);
    };
  }, [ref, onSwipe]);
}
