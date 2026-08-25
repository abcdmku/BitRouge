/** Renderer-only constants. No game rules live here. */
export const TILE = 16;

/** Board grid: 5 columns always; up to 8 rows once the Board 5x8 ARCH perk is bought. */
export const BOARD_COLS = 5;
export const BOARD_ROWS_MAX = 8;
export const VIEW_W = TILE * BOARD_COLS; // 80
export const VIEW_H = TILE * BOARD_ROWS_MAX; // 128
export const BG_COLOR = "#07080f";

/** Draw order buckets. Heat washes over the chip/arrow/lock content and its fault glitch. */
export const DEPTH = {
  board: 0,
  socket: 3,
  fault: 4,
  heatOverlay: 5,
  packet: 10,
  fx: 20_000,
} as const;

export const PACKET_TWEEN_FRACTION = 0.85;

/** Packet hop tween duration: always <= the effective tick so hops never overlap. */
export function packetTweenMs(effectiveTickMs: number): number {
  return Math.max(0, effectiveTickMs * PACKET_TWEEN_FRACTION);
}

/** Minimum logical hit target side, in board pixels at 1x (spec: >= 44px logical -> CSS px via zoom). */
export const MIN_HIT_PX = 44;

/** Long-press duration before a tap resolves to `openPopover` instead of a work/rotate/unlock tap. */
export const LONG_PRESS_MS = 450;

/** Texture keys. */
export const TEX_GEN = "gen";
