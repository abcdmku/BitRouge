#!/usr/bin/env tsx
/**
 * pack-tileset.ts
 *
 * Builds the gid-indexed tileset Phaser's Tilemap needs for ground tiles:
 *   public/assets/tileset/tileset.png   16px grid of tile frames
 *   public/assets/tileset/tileset.json  { columns, tileWidth, tileHeight, firstgid, gids: { frame: gid } }
 *
 * Frames are pulled from the hash-packed sources the renderer's manifest can
 * choose between (gen atlas `tile_*` / `port_down` frames, plus any 0x72 tiles
 * listed in EXTRA_0X72). Run after `npm run build:sprites`:
 *   tsx scripts/pack-tileset.ts
 * Output is committed (no build step on Pages).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const GEN_DIR = join(ROOT, "public", "assets", "gen");
const PACK_0X72_DIR = join(ROOT, "public", "assets", "packs", "0x72-dungeontileset-ii");
const OUT_DIR = join(ROOT, "public", "assets", "tileset");
const TILE = 16;
const COLUMNS = 16;

/** 0x72 frames to include as ground tiles (name in tile_list). Prefixed `0x72/` in the gid table. */
const EXTRA_0X72: readonly string[] = [];

interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface HashAtlas {
  frames: Record<string, { frame: Frame }> | { filename: string; frame: Frame }[];
}

function readAtlasFrames(jsonPath: string): Map<string, Frame> {
  const atlas = JSON.parse(readFileSync(jsonPath, "utf8")) as HashAtlas;
  const out = new Map<string, Frame>();
  if (Array.isArray(atlas.frames)) {
    for (const f of atlas.frames) out.set(f.filename, f.frame);
  } else {
    for (const [name, f] of Object.entries(atlas.frames)) out.set(name, f.frame);
  }
  return out;
}

const GEN_TILE_RE = /^(tile_[a-z_]+|port_(up|down)):\d+$/;

function main(): void {
  const tiles: { name: string; png: PNG; frame: Frame }[] = [];

  const genJson = join(GEN_DIR, "sprites.json");
  if (existsSync(genJson)) {
    const png = PNG.sync.read(readFileSync(join(GEN_DIR, "sprites.png")));
    for (const [name, frame] of readAtlasFrames(genJson)) {
      if (GEN_TILE_RE.test(name) && frame.w === TILE && frame.h === TILE) tiles.push({ name, png, frame });
    }
  } else {
    console.warn("gen atlas missing; run `npm run build:sprites` first");
  }

  if (EXTRA_0X72.length > 0) {
    const png = PNG.sync.read(readFileSync(join(PACK_0X72_DIR, "0x72_DungeonTilesetII_v1.7.png")));
    const frames = readAtlasFrames(join(PACK_0X72_DIR, "atlas.json"));
    for (const name of EXTRA_0X72) {
      const frame = frames.get(name);
      if (!frame) throw new Error(`0x72 frame not found: ${name}`);
      tiles.push({ name: `0x72/${name}`, png, frame });
    }
  }

  tiles.sort((a, b) => a.name.localeCompare(b.name));
  const rows = Math.max(1, Math.ceil(tiles.length / COLUMNS));
  const out = new PNG({ width: COLUMNS * TILE, height: rows * TILE });
  const gids: Record<string, number> = {};
  tiles.forEach((t, i) => {
    gids[t.name] = i + 1;
    PNG.bitblt(t.png, out, t.frame.x, t.frame.y, TILE, TILE, (i % COLUMNS) * TILE, Math.floor(i / COLUMNS) * TILE);
  });

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "tileset.png"), PNG.sync.write(out));
  writeFileSync(
    join(OUT_DIR, "tileset.json"),
    JSON.stringify({ image: "tileset.png", tileWidth: TILE, tileHeight: TILE, columns: COLUMNS, firstgid: 1, gids }, null, 1) + "\n",
  );
  console.log(`tileset: ${tiles.length} tiles -> ${out.width}x${out.height}`);
}

main();
