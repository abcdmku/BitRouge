/** Renderer-only constants. No game rules live here. */
export const TILE = 16;
export const VIEW_TILES_W = 12;
export const VIEW_TILES_H = 9;
export const VIEW_W = TILE * VIEW_TILES_W; // 192
export const VIEW_H = TILE * VIEW_TILES_H; // 144
export const BG_COLOR = "#07080f";

/** Fog overlay alpha per visibility state. */
export const FOG_UNEXPLORED = 1;
export const FOG_REMEMBERED = 0.6;
export const FOG_VISIBLE = 0;

/** Draw order buckets; entities add their y on top of ENTITY. */
export const DEPTH = {
  floor: 0,
  wall: 1,
  hazard: 2,
  item: 3,
  entity: 10,
  fog: 10_000,
  fx: 20_000,
} as const;

export const MOVE_TWEEN_MAX_MS = 120;
export const MOVE_TWEEN_FRACTION = 0.8;

/** Texture keys. */
export const TEX_PACK_0X72 = "pack0x72";
export const TEX_KENNEY_1BIT = "kenney1bit";
export const TEX_TILESET = "tileset";
export const TEX_GEN = "gen";

export function moveTweenMs(msPerTurn: number): number {
  return Math.max(0, Math.min(msPerTurn * MOVE_TWEEN_FRACTION, MOVE_TWEEN_MAX_MS));
}
