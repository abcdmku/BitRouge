import Phaser from "phaser";
import { BG_COLOR, VIEW_H, VIEW_W } from "./constants";

/**
 * Phaser 4.2 config. Notes vs. v3 (verified against node_modules/phaser/types/phaser.d.ts):
 * - `resolution` is not a GameConfig key in v4 (nor late v3); the canvas is
 *   created at exactly VIEW_W x VIEW_H (effective DPR 1) and upscaled with an
 *   integer `scale.zoom` set by DungeonView's ResizeObserver.
 * - `pixelArt: true` implies `antialias: false` + `roundPixels: true`; both are
 *   set explicitly anyway. v4 adds `smoothPixelArt` (left off).
 * - `input.keyboard: false` is still `boolean | KeyboardInputConfig`.
 * - `Phaser.Scale.NONE` / `NO_CENTER` still exist.
 */
export function createPhaserConfig(
  parent: HTMLElement,
  scene: Phaser.Types.Scenes.SceneType,
  opts: { transparent?: boolean } = {},
): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.WEBGL,
    parent,
    width: VIEW_W,
    height: VIEW_H,
    pixelArt: true,
    antialias: false,
    antialiasGL: false,
    roundPixels: true,
    transparent: opts.transparent ?? false,
    backgroundColor: BG_COLOR,
    banner: false,
    autoFocus: false,
    disableContextMenu: true,
    input: { keyboard: false, mouse: true, touch: true },
    scale: {
      mode: Phaser.Scale.NONE,
      autoCenter: Phaser.Scale.NO_CENTER,
      width: VIEW_W,
      height: VIEW_H,
      zoom: 1,
    },
    fps: { target: 60, min: 20 },
    scene,
  };
}
