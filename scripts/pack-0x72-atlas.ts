#!/usr/bin/env tsx
/**
 * pack-0x72-atlas.ts
 *
 * Converts the 0x72 DungeonTileset II tile list into runtime assets:
 *   public/assets/packs/0x72-dungeontileset-ii/
 *     atlas.json   Phaser JSON-hash atlas over 0x72_DungeonTilesetII_v1.7.png
 *     anims.json   { key: { frames: string[], fps, loop } } inferred from *_anim_fN names
 *     tileset.png  gid-indexed 16px grid of every 16x16 frame (for Phaser tilemaps)
 *     tileset.json { columns, tileWidth, tileHeight, image, gids: { frameName: gid } }
 *
 * Run: tsx scripts/pack-0x72-atlas.ts   (outputs are committed; no build step on Pages)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACK_DIR = join(__dirname, "..", "public", "assets", "packs", "0x72-dungeontileset-ii");
const SHEET = "0x72_DungeonTilesetII_v1.7.png";
const TILE_LIST = "tile_list_v1.7";
const TILE = 16;
const TILESET_COLUMNS = 16;

export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Known typos in the upstream tile list. */
const FIXES: Record<string, Partial<Frame> | { rename: string }> = {
  wall_edge_top_left: { x: 32 }, // listed at x=31
  zombie_anim_f10: { rename: "zombie_anim_f0" },
};

/** Extra 16x16 crops of larger art so single-cell tiles exist for them. */
const EXTRA_FRAMES: Record<string, Frame> = {
  // centre of doors_leaf_closed (32x32 at 32,240): a wooden door that fits one cell
  door_closed_16: { x: 40, y: 250, w: 16, h: 16 },
  door_open_16: { x: 88, y: 250, w: 16, h: 16 },
};

export function parseTileList(text: string): Map<string, Frame> {
  const out = new Map<string, Frame>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const [name0, xs, ys, ws, hs] = line.split(/\s+/);
    if (!name0 || !xs || !ys || !ws || !hs) continue;
    let name = name0;
    let f: Frame = { x: +xs, y: +ys, w: +ws, h: +hs };
    const fix = FIXES[name];
    if (fix) {
      if ("rename" in fix) name = fix.rename;
      else f = { ...f, ...fix };
    }
    out.set(name, f);
  }
  for (const [k, v] of Object.entries(EXTRA_FRAMES)) out.set(k, v);
  return out;
}

export interface AnimDef {
  frames: string[];
  fps: number;
  loop: boolean;
}

const ANIM_RE = /^(.+)_anim_f(\d+)$/;

export function inferAnims(frames: Map<string, Frame>): Record<string, AnimDef> {
  const groups = new Map<string, { n: number; name: string }[]>();
  for (const name of frames.keys()) {
    const m = ANIM_RE.exec(name);
    if (!m) continue;
    const key = m[1]!;
    const list = groups.get(key) ?? [];
    list.push({ n: +m[2]!, name });
    groups.set(key, list);
  }
  const anims: Record<string, AnimDef> = {};
  for (const [key, list] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    list.sort((a, b) => a.n - b.n);
    const isHit = key.endsWith("_hit");
    const isRun = key.endsWith("_run");
    const isOpen = key.includes("_open");
    anims[key] = {
      frames: list.map((f) => f.name),
      fps: isRun ? 10 : key === "floor_spikes" ? 5 : 6,
      loop: !(isHit || isOpen),
    };
  }
  return anims;
}

function main(): void {
  const text = readFileSync(join(PACK_DIR, TILE_LIST), "utf8");
  const frames = parseTileList(text);
  const sheet = PNG.sync.read(readFileSync(join(PACK_DIR, SHEET)));

  // atlas.json (Phaser JSON hash)
  const atlasFrames: Record<string, unknown> = {};
  for (const [name, f] of [...frames.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (f.x + f.w > sheet.width || f.y + f.h > sheet.height) throw new Error(`frame ${name} outside sheet`);
    atlasFrames[name] = {
      frame: { x: f.x, y: f.y, w: f.w, h: f.h },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: f.w, h: f.h },
      sourceSize: { w: f.w, h: f.h },
    };
  }
  const atlas = {
    frames: atlasFrames,
    meta: {
      app: "scripts/pack-0x72-atlas.ts",
      image: SHEET,
      format: "RGBA8888",
      size: { w: sheet.width, h: sheet.height },
      scale: "1",
    },
  };
  writeFileSync(join(PACK_DIR, "atlas.json"), JSON.stringify(atlas, null, 1) + "\n");

  // anims.json
  const anims = inferAnims(frames);
  writeFileSync(join(PACK_DIR, "anims.json"), JSON.stringify(anims, null, 1) + "\n");

  // tileset.png / tileset.json: every 16x16 frame on a grid, gid = index + 1
  const tiles = [...frames.entries()].filter(([, f]) => f.w === TILE && f.h === TILE).sort(([a], [b]) => a.localeCompare(b));
  const rows = Math.ceil(tiles.length / TILESET_COLUMNS);
  const out = new PNG({ width: TILESET_COLUMNS * TILE, height: rows * TILE });
  const gids: Record<string, number> = {};
  tiles.forEach(([name, f], i) => {
    gids[name] = i + 1;
    const dx = (i % TILESET_COLUMNS) * TILE;
    const dy = Math.floor(i / TILESET_COLUMNS) * TILE;
    PNG.bitblt(sheet, out, f.x, f.y, TILE, TILE, dx, dy);
  });
  writeFileSync(join(PACK_DIR, "tileset.png"), PNG.sync.write(out));
  writeFileSync(
    join(PACK_DIR, "tileset.json"),
    JSON.stringify({ image: "tileset.png", tileWidth: TILE, tileHeight: TILE, columns: TILESET_COLUMNS, firstgid: 1, gids }, null, 1) + "\n",
  );

  console.log(`atlas: ${frames.size} frames, anims: ${Object.keys(anims).length}, tileset: ${tiles.length} tiles (${out.width}x${out.height})`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
