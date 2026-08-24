#!/usr/bin/env tsx
/**
 * build-sprites.ts
 *
 * Compiles `assets-src/sprites/*.sprite.txt` + `assets-src/font/font.sprite.txt`
 * into:
 *   public/assets/gen/sprites.png        RGBA atlas (shelf packed)
 *   public/assets/gen/sprites.json       Phaser JSON-hash atlas, frames `<name>:<i>`
 *   public/assets/gen/manifest.json      { sprites: { [name]: { size, frames, anims } }, palette }
 *   public/assets/gen/single/<name>.png  horizontal strip per sprite (for React <img>)
 *   public/assets/gen/font.png + font.xml  Phaser BitmapText font (BMFont XML)
 *   src/ui/palette.generated.css         --c-<char> vars + role aliases
 *
 * Usage: tsx scripts/build-sprites.ts [--only hero,tile_floor]
 * `--only` filters which sprites are packed (the font is always built when present).
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PixelCanvas } from "./pixel-canvas.js";
import {
  parsePalette,
  parseSprite,
  SpriteFormatError,
  type Palette,
  type SpriteDef,
} from "./sprite-format.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(__dirname, "..");

export interface BuildOptions {
  /** Directory containing palette.json, sprites/, font/. */
  srcDir: string;
  /** Output directory for png/json/xml (public/assets/gen). */
  outDir: string;
  /** Path of the generated CSS file. */
  cssPath: string;
  /** Sprite names to include; undefined = all. */
  only?: string[];
  log?: (msg: string) => void;
}

export interface AtlasFrame {
  frame: { x: number; y: number; w: number; h: number };
  rotated: false;
  trimmed: false;
  spriteSourceSize: { x: number; y: number; w: number; h: number };
  sourceSize: { w: number; h: number };
}

export interface Manifest {
  sprites: Record<
    string,
    {
      size: { w: number; h: number };
      frames: number;
      anims: Record<string, { frames: number[]; fps: number; loop: boolean }>;
    }
  >;
  palette: { name: string; colors: Record<string, string>; roles: Record<string, string> };
}

export interface BuildResult {
  atlas: { width: number; height: number; frames: Record<string, AtlasFrame> };
  manifest: Manifest;
  sprites: SpriteDef[];
  font?: { glyphs: number; width: number; height: number };
}

export const ATLAS_PADDING = 1;
export const ATLAS_MAX_WIDTH = 512;

// ---------------------------------------------------------------------------
// Loading

export function loadPalette(srcDir: string): Palette {
  const file = join(srcDir, "palette.json");
  return parsePalette(readFileSync(file, "utf8"), file);
}

export function loadSprites(srcDir: string, palette: Palette, only?: string[]): SpriteDef[] {
  const dir = join(srcDir, "sprites");
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sprite.txt"))
    .sort();
  const defs: SpriteDef[] = [];
  const seen = new Map<string, string>();
  for (const f of files) {
    const path = join(dir, f);
    const def = parseSprite(readFileSync(path, "utf8"), palette, path);
    const expected = basename(f, ".sprite.txt");
    if (def.name !== expected) {
      throw new SpriteFormatError(path, 1, `sprite name "${def.name}" must match file name "${expected}"`);
    }
    const dup = seen.get(def.name);
    if (dup) throw new SpriteFormatError(path, 1, `duplicate sprite name "${def.name}" (also in ${dup})`);
    seen.set(def.name, path);
    if (only && !only.includes(def.name)) continue;
    defs.push(def);
  }
  if (only) {
    for (const n of only) if (!seen.has(n)) throw new Error(`--only: no sprite named "${n}" in ${dir}`);
  }
  return defs;
}

export function loadFont(srcDir: string, palette: Palette): SpriteDef | undefined {
  const path = join(srcDir, "font", "font.sprite.txt");
  if (!existsSync(path)) return undefined;
  const def = parseSprite(readFileSync(path, "utf8"), palette, path);
  if (!def.chars) throw new SpriteFormatError(path, 1, "font sprite needs a `chars:` header");
  return def;
}

// ---------------------------------------------------------------------------
// Packing

interface Placed {
  def: SpriteDef;
  frame: number;
  x: number;
  y: number;
}

/** Shelf packer: frames sorted by height desc, filled left-to-right in rows. Deterministic. */
export function shelfPack(defs: SpriteDef[], maxWidth = ATLAS_MAX_WIDTH, pad = ATLAS_PADDING) {
  const items: { def: SpriteDef; frame: number }[] = [];
  for (const def of defs) for (let i = 0; i < def.frames.length; i++) items.push({ def, frame: i });
  // Stable sort: taller first, then wider, then name/frame for determinism.
  items.sort(
    (a, b) =>
      b.def.height - a.def.height ||
      b.def.width - a.def.width ||
      a.def.name.localeCompare(b.def.name) ||
      a.frame - b.frame,
  );
  const placed: Placed[] = [];
  let x = pad;
  let y = pad;
  let shelfH = 0;
  let width = 0;
  for (const it of items) {
    const w = it.def.width;
    const h = it.def.height;
    if (x + w + pad > maxWidth && x > pad) {
      x = pad;
      y += shelfH + pad;
      shelfH = 0;
    }
    placed.push({ def: it.def, frame: it.frame, x, y });
    x += w + pad;
    shelfH = Math.max(shelfH, h);
    width = Math.max(width, x);
  }
  const height = placed.length ? y + shelfH + pad : pad;
  return { placed, width: Math.max(width, pad), height };
}

// ---------------------------------------------------------------------------
// Emitters

function buildAtlas(defs: SpriteDef[], palette: Palette, outDir: string): BuildResult["atlas"] {
  const { placed, width, height } = shelfPack(defs);
  const canvas = new PixelCanvas(width, height);
  const frames: Record<string, AtlasFrame> = {};
  for (const p of placed) {
    canvas.blitFrame(p.def, palette, p.frame, p.x, p.y);
    frames[`${p.def.name}:${p.frame}`] = {
      frame: { x: p.x, y: p.y, w: p.def.width, h: p.def.height },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: p.def.width, h: p.def.height },
      sourceSize: { w: p.def.width, h: p.def.height },
    };
  }
  // Deterministic key order: by sprite then frame.
  const ordered: Record<string, AtlasFrame> = {};
  for (const def of defs) for (let i = 0; i < def.frames.length; i++) ordered[`${def.name}:${i}`] = frames[`${def.name}:${i}`];

  writeFileSync(join(outDir, "sprites.png"), canvas.toPNG());
  const json = {
    frames: ordered,
    meta: {
      app: "bitrouge/build-sprites",
      version: "1.0",
      image: "sprites.png",
      format: "RGBA8888",
      size: { w: width, h: height },
      scale: "1",
    },
  };
  writeFileSync(join(outDir, "sprites.json"), JSON.stringify(json, null, 2) + "\n");
  return { width, height, frames: ordered };
}

function buildManifest(defs: SpriteDef[], palette: Palette, outDir: string): Manifest {
  const manifest: Manifest = { sprites: {}, palette: { name: palette.name, colors: palette.colors, roles: palette.roles } };
  for (const def of defs) {
    manifest.sprites[def.name] = {
      size: { w: def.width, h: def.height },
      frames: def.frames.length,
      anims: Object.fromEntries(
        Object.entries(def.anims).map(([k, a]) => [k, { frames: [...a.frames], fps: a.fps, loop: a.loop }]),
      ),
    };
  }
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

function buildStrips(defs: SpriteDef[], palette: Palette, outDir: string): void {
  const dir = join(outDir, "single");
  mkdirSync(dir, { recursive: true });
  for (const def of defs) {
    const canvas = new PixelCanvas(def.width * def.frames.length, def.height);
    for (let i = 0; i < def.frames.length; i++) canvas.blitFrame(def, palette, i, i * def.width, 0);
    writeFileSync(join(dir, `${def.name}.png`), canvas.toPNG());
  }
}

export function paletteCss(palette: Palette): string {
  const lines = ["/* Generated by scripts/build-sprites.ts from assets-src/palette.json. Do not edit. */", ":root {"];
  for (const [ch, hex] of Object.entries(palette.colors)) lines.push(`  --c-${ch}: ${hex};`);
  lines.push("");
  const alias = (name: string, role: string, fallback: string) => {
    const ch = palette.roles[role] ?? fallback;
    lines.push(`  --${name}: var(--c-${ch});`);
  };
  alias("outline", "outline", "K");
  alias("bg", "bg", "N");
  alias("floor", "floor", "n");
  alias("metal", "metal", "S");
  alias("data", "data", "C");
  alias("ok", "ok", "G");
  alias("warn", "warn", "A");
  alias("danger", "danger", "R");
  alias("corrupt", "corrupt", "M");
  alias("text", "text", "W");
  lines.push("}");
  return lines.join("\n") + "\n";
}

export const FONT_LINE_HEIGHT = 9;
export const FONT_BASE = 7;
const FONT_COLUMNS = 16;

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function buildFont(font: SpriteDef, palette: Palette, outDir: string): NonNullable<BuildResult["font"]> {
  const chars = font.chars!;
  const cols = Math.min(FONT_COLUMNS, chars.length);
  const rows = Math.ceil(chars.length / cols);
  const canvas = new PixelCanvas(cols * font.width, rows * font.height);
  const charXml: string[] = [];
  for (let i = 0; i < chars.length; i++) {
    const x = (i % cols) * font.width;
    const y = Math.floor(i / cols) * font.height;
    canvas.blitFrame(font, palette, i, x, y);
    const id = chars[i].codePointAt(0)!;
    charXml.push(
      `    <char id="${id}" x="${x}" y="${y}" width="${font.width}" height="${font.height}" xoffset="0" yoffset="0" xadvance="${font.width}" page="0" chnl="15" letter="${xmlEscape(chars[i])}"/>`,
    );
  }
  writeFileSync(join(outDir, "font.png"), canvas.toPNG());
  const xml = [
    `<?xml version="1.0"?>`,
    `<font>`,
    `  <info face="bitrouge" size="${font.height}" bold="0" italic="0" charset="" unicode="1" stretchH="100" smooth="0" aa="1" padding="0,0,0,0" spacing="0,0" outline="0"/>`,
    `  <common lineHeight="${FONT_LINE_HEIGHT}" base="${FONT_BASE}" scaleW="${canvas.width}" scaleH="${canvas.height}" pages="1" packed="0" alphaChnl="0" redChnl="4" greenChnl="4" blueChnl="4"/>`,
    `  <pages>`,
    `    <page id="0" file="font.png"/>`,
    `  </pages>`,
    `  <chars count="${chars.length}">`,
    ...charXml,
    `  </chars>`,
    `</font>`,
    ``,
  ].join("\n");
  writeFileSync(join(outDir, "font.xml"), xml);
  return { glyphs: chars.length, width: font.width, height: font.height };
}

// ---------------------------------------------------------------------------
// Entry

export function buildSprites(opts: BuildOptions): BuildResult {
  const log = opts.log ?? (() => {});
  const palette = loadPalette(opts.srcDir);
  const sprites = loadSprites(opts.srcDir, palette, opts.only);
  mkdirSync(opts.outDir, { recursive: true });
  mkdirSync(dirname(opts.cssPath), { recursive: true });

  const atlas = buildAtlas(sprites, palette, opts.outDir);
  const manifest = buildManifest(sprites, palette, opts.outDir);
  buildStrips(sprites, palette, opts.outDir);
  writeFileSync(opts.cssPath, paletteCss(palette));
  log(`atlas ${atlas.width}x${atlas.height}, ${Object.keys(atlas.frames).length} frames from ${sprites.length} sprites`);

  let font: BuildResult["font"];
  const fontDef = loadFont(opts.srcDir, palette);
  if (fontDef) {
    font = buildFont(fontDef, palette, opts.outDir);
    log(`font ${font.glyphs} glyphs @ ${font.width}x${font.height}`);
  }
  return { atlas, manifest, sprites, font };
}

export function parseOnly(argv: string[]): string[] | undefined {
  const i = argv.indexOf("--only");
  if (i === -1) return undefined;
  const v = argv[i + 1];
  if (!v) throw new Error("--only needs a comma-separated list of sprite names");
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

const isMain = /build-sprites.ts$/.test(process.argv[1] ?? "");
if (isMain) {
  try {
    buildSprites({
      srcDir: join(REPO_ROOT, "assets-src"),
      outDir: join(REPO_ROOT, "public", "assets", "gen"),
      cssPath: join(REPO_ROOT, "src", "ui", "palette.generated.css"),
      only: parseOnly(process.argv.slice(2)),
      log: (m) => console.log(m),
    });
  } catch (e) {
    console.error(e instanceof SpriteFormatError ? e.message : e);
    process.exit(1);
  }
}
