/**
 * pixel-canvas.ts
 *
 * Tiny RGBA raster helper shared by build-sprites and contact-sheet.
 * Backed by pngjs; no native deps.
 */

import { PNG } from "pngjs";
import type { Palette, RGBA, SpriteDef } from "./sprite-format.js";
import { resolveColor } from "./sprite-format.js";

export class PixelCanvas {
  readonly data: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Uint8Array(width * height * 4);
  }

  set(x: number, y: number, c: RGBA): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    if (c[3] === 0) return;
    const i = (y * this.width + x) * 4;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = c[3];
  }

  get(x: number, y: number): RGBA {
    const i = (y * this.width + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }

  fillRect(x: number, y: number, w: number, h: number, c: RGBA): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c);
  }

  /** Blit one frame of a sprite at (dx, dy), scaled by an integer factor (nearest neighbour). */
  blitFrame(def: SpriteDef, palette: Palette, frame: number, dx: number, dy: number, scale = 1): void {
    const rows = def.frames[frame];
    for (let y = 0; y < def.height; y++) {
      for (let x = 0; x < def.width; x++) {
        const c = resolveColor(def, palette, rows[y][x]);
        if (c[3] === 0) continue;
        if (scale === 1) this.set(dx + x, dy + y, c);
        else this.fillRect(dx + x * scale, dy + y * scale, scale, scale, c);
      }
    }
  }

  toPNG(): Buffer {
    const png = new PNG({ width: this.width, height: this.height });
    png.data = Buffer.from(this.data.buffer, this.data.byteOffset, this.data.byteLength);
    return PNG.sync.write(png);
  }

  static fromPNG(buf: Buffer): PixelCanvas {
    const png = PNG.sync.read(buf);
    const c = new PixelCanvas(png.width, png.height);
    c.data.set(png.data);
    return c;
  }
}

/**
 * Bitmap text renderer using a font sprite (one frame per char, `chars:` header).
 * Unknown characters render as a blank advance. Returns the advance width used.
 */
export function drawText(
  canvas: PixelCanvas,
  font: SpriteDef,
  palette: Palette,
  x: number,
  y: number,
  text: string,
  color?: RGBA,
  scale = 1,
): number {
  const index = new Map<string, number>();
  font.chars?.forEach((ch, i) => index.set(ch, i));
  let cx = x;
  for (const ch of text) {
    const fi = index.get(ch);
    if (fi !== undefined) {
      const rows = font.frames[fi];
      for (let yy = 0; yy < font.height; yy++) {
        for (let xx = 0; xx < font.width; xx++) {
          const c = rows[yy][xx];
          if (c === palette.transparent) continue;
          const rgba = color ?? resolveColor(font, palette, c);
          if (scale === 1) canvas.set(cx + xx, y + yy, rgba);
          else canvas.fillRect(cx + xx * scale, y + yy * scale, scale, scale, rgba);
        }
      }
    }
    cx += font.width * scale;
  }
  return cx - x;
}
