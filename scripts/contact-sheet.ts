#!/usr/bin/env tsx
/**
 * contact-sheet.ts
 *
 * Renders public/assets/gen/contact-sheet.png for visual QA of sprite sources.
 * One block per sprite: label (own bitmap font), all frames at 1x and 4x on the
 * `N` background, then the same on `n` (floor) so contrast can be judged on both.
 * 1px `B` grid lines separate frames. The full font is rendered as its own row.
 *
 * Usage:
 *   tsx scripts/contact-sheet.ts [--only hero,tile_floor] [--sheet tiles] [--out path]
 *
 * `--sheet tiles` renders every `tile_*` sprite into a 6x4 mock room (frames
 * cycled deterministically) at 1x and 3x so seams show up; `port_down` is
 * dropped in the middle when present.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PixelCanvas, drawText } from "./pixel-canvas.js";
import { REPO_ROOT, loadFont, loadPalette, loadSprites, parseOnly } from "./build-sprites.js";
import { hexToRgba, SpriteFormatError, type Palette, type RGBA, type SpriteDef } from "./sprite-format.js";

export interface SheetOptions {
  srcDir: string;
  outPath: string;
  only?: string[];
  sheet?: "sprites" | "tiles";
}

const MARGIN = 6;
const LABEL_W = 15 * 6; // 15 glyphs of the 6px font
const GAP = 8;
const BIG = 4;

function color(palette: Palette, ch: string): RGBA {
  return hexToRgba(palette.colors[ch]);
}

/** Draw all frames of a sprite in a grid-lined strip; returns strip width. */
function strip(
  canvas: PixelCanvas,
  def: SpriteDef,
  palette: Palette,
  x: number,
  y: number,
  scale: number,
  bg: RGBA,
  grid: RGBA,
): number {
  const cw = def.width * scale + 1;
  const ch = def.height * scale + 1;
  const n = def.frames.length;
  canvas.fillRect(x, y, cw * n + 1, ch + 1, bg);
  for (let i = 0; i <= n; i++) canvas.fillRect(x + i * cw, y, 1, ch + 1, grid);
  canvas.fillRect(x, y, cw * n + 1, 1, grid);
  canvas.fillRect(x, y + ch, cw * n + 1, 1, grid);
  for (let i = 0; i < n; i++) canvas.blitFrame(def, palette, i, x + 1 + i * cw, y + 1, scale);
  return cw * n + 1;
}

function stripWidth(def: SpriteDef, scale: number): number {
  return (def.width * scale + 1) * def.frames.length + 1;
}

export function renderSpriteSheet(sprites: SpriteDef[], font: SpriteDef | undefined, palette: Palette): PixelCanvas {
  const N = color(palette, "N");
  const n = color(palette, "n");
  const B = color(palette, "B");
  const text = color(palette, "W");
  const dim = color(palette, "s");

  // Measure.
  let width = MARGIN * 2 + LABEL_W;
  let height = MARGIN;
  const rowH: number[] = [];
  for (const def of sprites) {
    const w = stripWidth(def, 1) * 2 + GAP + stripWidth(def, BIG) * 2 + GAP * 3;
    width = Math.max(width, MARGIN * 2 + LABEL_W + w);
    const h = Math.max(def.height * BIG + 2, 18);
    rowH.push(h);
    height += h + GAP;
  }
  let fontRowH = 0;
  if (font) {
    const chars = font.chars ?? [];
    fontRowH = font.height * 3 + font.height + GAP * 2;
    width = Math.max(width, MARGIN * 2 + LABEL_W + chars.length * font.width + GAP);
    height += fontRowH + GAP;
  }
  height += MARGIN;

  const canvas = new PixelCanvas(width, height);
  canvas.fillRect(0, 0, width, height, N);

  let y = MARGIN;
  sprites.forEach((def, i) => {
    let x = MARGIN;
    if (font) {
      drawText(canvas, font, palette, x, y, def.name, text);
      drawText(canvas, font, palette, x, y + 9, `${def.width}x${def.height} f${def.frames.length}`, dim);
      const anims = Object.keys(def.anims);
      if (anims.length) drawText(canvas, font, palette, x, y + 18, anims.join(" ").slice(0, 14), dim);
    }
    x += LABEL_W;
    x += strip(canvas, def, palette, x, y, 1, N, B) + GAP;
    x += strip(canvas, def, palette, x, y, 1, n, B) + GAP * 2;
    x += strip(canvas, def, palette, x, y, BIG, N, B) + GAP;
    x += strip(canvas, def, palette, x, y, BIG, n, B);
    y += rowH[i] + GAP;
  });

  if (font) {
    const chars = font.chars ?? [];
    drawText(canvas, font, palette, MARGIN, y, "font", text);
    drawText(canvas, font, palette, MARGIN, y + 9, `${chars.length} glyphs`, dim);
    const all = chars.join("");
    const x = MARGIN + LABEL_W;
    const half = Math.ceil(chars.length / 2);
    drawText(canvas, font, palette, x, y, all, text);
    drawText(canvas, font, palette, x, y + font.height + 2, all.slice(0, half), text, 2);
    drawText(canvas, font, palette, x, y + font.height * 3 + 4, all.slice(half), text, 2);
  }
  return canvas;
}

/** 6x4 mock room per tile sprite: seams become obvious at 1x, 3x. */
export function renderTileSheet(sprites: SpriteDef[], font: SpriteDef | undefined, palette: Palette): PixelCanvas {
  const N = color(palette, "N");
  const text = color(palette, "W");
  const tiles = sprites.filter((s) => s.name.startsWith("tile_"));
  const port = sprites.find((s) => s.name === "port_down");
  const hero = sprites.find((s) => s.name === "hero");
  const COLS = 6;
  const ROWS = 4;

  const rooms: { label: string; draw: (c: PixelCanvas, x: number, y: number, scale: number) => void; w: number; h: number }[] = [];
  for (const t of tiles) {
    rooms.push({
      label: t.name,
      w: t.width * COLS,
      h: t.height * ROWS,
      draw: (c, x, y, scale) => {
        for (let r = 0; r < ROWS; r++) {
          for (let col = 0; col < COLS; col++) {
            const f = (r * 5 + col * 7 + r * col) % t.frames.length;
            c.blitFrame(t, palette, f, x + col * t.width * scale, y + r * t.height * scale, scale);
          }
        }
      },
    });
  }
  const floor = tiles.find((t) => t.name === "tile_floor");
  const wall = tiles.find((t) => t.name.startsWith("tile_wall"));
  if (floor && wall) {
    rooms.push({
      label: "mock room",
      w: floor.width * COLS,
      h: floor.height * ROWS,
      draw: (c, x, y, scale) => {
        for (let r = 0; r < ROWS; r++) {
          for (let col = 0; col < COLS; col++) {
            const isWall = r === 0;
            const t = isWall ? wall : floor;
            const f = isWall ? col % t.frames.length : (r * 5 + col * 7 + r * col) % t.frames.length;
            c.blitFrame(t, palette, f, x + col * t.width * scale, y + r * t.height * scale, scale);
          }
        }
        if (port) c.blitFrame(port, palette, 0, x + 4 * floor.width * scale, y + 2 * floor.height * scale, scale);
        if (hero) c.blitFrame(hero, palette, 0, x + 1 * floor.width * scale, y + 2 * floor.height * scale, scale);
      },
    });
  }

  let width = MARGIN * 2 + LABEL_W;
  let height = MARGIN;
  for (const r of rooms) {
    width = Math.max(width, MARGIN * 2 + LABEL_W + r.w + GAP + r.w * 3);
    height += r.h * 3 + GAP;
  }
  height += MARGIN;
  const canvas = new PixelCanvas(width, height);
  canvas.fillRect(0, 0, width, height, N);
  let y = MARGIN;
  for (const r of rooms) {
    if (font) drawText(canvas, font, palette, MARGIN, y, r.label, text);
    r.draw(canvas, MARGIN + LABEL_W, y, 1);
    r.draw(canvas, MARGIN + LABEL_W + r.w + GAP, y, 3);
    y += r.h * 3 + GAP;
  }
  return canvas;
}

export function renderContactSheet(opts: SheetOptions): { width: number; height: number } {
  const palette = loadPalette(opts.srcDir);
  const sprites = loadSprites(opts.srcDir, palette, opts.only);
  const font = loadFont(opts.srcDir, palette);
  const canvas = opts.sheet === "tiles" ? renderTileSheet(sprites, font, palette) : renderSpriteSheet(sprites, font, palette);
  mkdirSync(dirname(opts.outPath), { recursive: true });
  writeFileSync(opts.outPath, canvas.toPNG());
  return { width: canvas.width, height: canvas.height };
}

function argValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i === -1 ? undefined : argv[i + 1];
}

const isMain = /contact-sheet\.ts$/.test(process.argv[1] ?? "");
if (isMain) {
  try {
    const argv = process.argv.slice(2);
    const sheet = (argValue(argv, "--sheet") ?? "sprites") as SheetOptions["sheet"];
    if (sheet !== "sprites" && sheet !== "tiles") throw new Error(`--sheet must be "sprites" or "tiles"`);
    const outPath =
      argValue(argv, "--out") ??
      join(REPO_ROOT, "public", "assets", "gen", sheet === "tiles" ? "contact-sheet-tiles.png" : "contact-sheet.png");
    const size = renderContactSheet({ srcDir: join(REPO_ROOT, "assets-src"), outPath, only: parseOnly(argv), sheet });
    console.log(`wrote ${outPath} (${size.width}x${size.height})`);
  } catch (e) {
    console.error(e instanceof SpriteFormatError ? e.message : e);
    process.exit(1);
  }
}
