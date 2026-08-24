#!/usr/bin/env tsx
/**
 * fetch-packs.ts
 *
 * Idempotently downloads third-party asset packs used by this project:
 *   1. 0x72 Dungeon Tileset II v1.7 (CC0)   -> public/assets/packs/0x72-dungeontileset-ii/
 *      (itch.io has no stable direct link; pulled verbatim from public GitHub mirrors,
 *       sha256-verified) then converted with scripts/pack-0x72-atlas.ts
 *   2. Kenney "1-Bit Pack" (CC0)             -> public/assets/packs/kenney-1bit/
 *   3. Kenney "Tiny Dungeon" tileset (CC0)   -> public/assets/packs/kenney-tiny-dungeon/ (legacy, unused at runtime)
 *   4. Press Start 2P font (OFL)             -> public/fonts/
 *
 * Run with: tsx scripts/fetch-packs.ts
 *
 * Requirements:
 *   - Node 18+ (for global fetch)
 *   - A `tar` executable on PATH that can extract .zip archives.
 *     Windows 10+ ships a bsdtar-based `tar.exe` in System32 that handles
 *     zip files out of the box (`tar -xf archive.zip`). macOS/Linux tar
 *     users should ensure `bsdtar` (libarchive) is available, or install
 *     `unzip` and adjust the extractZip() implementation below.
 *
 * This script is safe to re-run: it skips any download/extraction step
 * whose target files already exist.
 */

import {
  existsSync,
  mkdirSync,
  rmSync,
  readdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  statSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const PUBLIC_DIR = join(REPO_ROOT, "public");
const PACKS_DIR = join(PUBLIC_DIR, "assets", "packs");
const FONTS_DIR = join(PUBLIC_DIR, "fonts");

const KENNEY_ZIP_URL =
  "https://kenney.nl/media/pages/assets/tiny-dungeon/f8422efb44-1674742415/kenney_tiny-dungeon.zip";
const KENNEY_FALLBACK_PAGE_URL = "https://kenney.nl/assets/tiny-dungeon";
const KENNEY_PACK_DIR = join(PACKS_DIR, "kenney-tiny-dungeon");
const KENNEY_TILEMAP_DEST = join(KENNEY_PACK_DIR, "tilemap_packed.png");
const KENNEY_LICENSE_DEST = join(KENNEY_PACK_DIR, "LICENSE.txt");

const PACK_0X72_DIR = join(PACKS_DIR, "0x72-dungeontileset-ii");
const PACK_0X72_SHEET = "0x72_DungeonTilesetII_v1.7.png";
const PACK_0X72_SHEET_SHA256 = "b222e563f9006e609cb0a5ec99878b7ef9a92953de3abf4cf2ae9d2aff1355d2";
const PACK_0X72_FILES = [PACK_0X72_SHEET, "tile_list_v1.7", "README"];
/** Public repos that vendor the v1.7 pack unmodified (byte-identical sheets). */
const PACK_0X72_MIRRORS = [
  "https://raw.githubusercontent.com/veroteknic/godot2d/main/map/0x72_DungeonTilesetII_v1.7/",
  "https://raw.githubusercontent.com/kantel/microstudio/main/assets/0x72_DungeonTilesetII_v1.7/",
  "https://raw.githubusercontent.com/ImSauce/WitchType/main/Assets/Imports/0x72_DungeonTilesetII_v1.7/",
];

const KENNEY_1BIT_ZIP_URL =
  "https://kenney.nl/media/pages/assets/1-bit-pack/aa867a1f37-1677578516/kenney_1-bit-pack.zip";
const KENNEY_1BIT_PAGE_URL = "https://kenney.nl/assets/1-bit-pack";
const KENNEY_1BIT_DIR = join(PACKS_DIR, "kenney-1bit");
const KENNEY_1BIT_FILES = ["colored-transparent_packed.png", "monochrome-transparent_packed.png"];

const FONT_TTF_URL =
  "https://raw.githubusercontent.com/google/fonts/main/ofl/pressstart2p/PressStart2P-Regular.ttf";
const FONT_OFL_URL =
  "https://raw.githubusercontent.com/google/fonts/main/ofl/pressstart2p/OFL.txt";
const FONT_TTF_DEST = join(FONTS_DIR, "PressStart2P-Regular.ttf");
const FONT_OFL_DEST = join(FONTS_DIR, "OFL.txt");

async function downloadFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, buf);
}

async function resolveKenneyZipUrl(): Promise<string> {
  // First try the known-good direct link.
  const head = await fetch(KENNEY_ZIP_URL, { method: "HEAD" }).catch(() => undefined);
  if (head && head.ok) return KENNEY_ZIP_URL;

  // Fall back to scraping the asset page for the current zip link.
  const page = await fetch(KENNEY_FALLBACK_PAGE_URL);
  if (!page.ok) {
    throw new Error(
      `Could not resolve Kenney Tiny Dungeon zip URL: HEAD ${KENNEY_ZIP_URL} failed and GET ${KENNEY_FALLBACK_PAGE_URL} returned HTTP ${page.status}`,
    );
  }
  const html = await page.text();
  const match = html.match(/https:\/\/kenney\.nl\/media\/pages\/assets\/tiny-dungeon\/[^"'\s]+\.zip/);
  if (!match) {
    throw new Error(
      `Could not find a .zip link on ${KENNEY_FALLBACK_PAGE_URL}; the page structure may have changed.`,
    );
  }
  return match[0];
}

function extractZip(zipPath: string, destDir: string): void {
  mkdirSync(destDir, { recursive: true });
  const result = spawnSync("tar", ["-xf", zipPath, "-C", destDir], { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(
      `Failed to extract ${zipPath} with 'tar -xf'. Ensure a zip-capable tar (bsdtar) is on PATH.`,
    );
  }
}

function findFileRecursive(dir: string, filename: string): string | undefined {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFileRecursive(full, filename);
      if (found) return found;
    } else if (entry.name.toLowerCase() === filename.toLowerCase()) {
      return full;
    }
  }
  return undefined;
}

async function fetchKenneyTinyDungeon(): Promise<void> {
  if (existsSync(KENNEY_TILEMAP_DEST) && existsSync(KENNEY_LICENSE_DEST)) {
    console.log("[kenney-tiny-dungeon] already present, skipping.");
    return;
  }

  console.log("[kenney-tiny-dungeon] resolving zip URL...");
  const zipUrl = await resolveKenneyZipUrl();

  const workDir = join(tmpdir(), `bitrouge-kenney-${Date.now()}`);
  const zipPath = join(workDir, "pack.zip");
  const extractDir = join(workDir, "extracted");

  try {
    console.log(`[kenney-tiny-dungeon] downloading ${zipUrl}`);
    await downloadFile(zipUrl, zipPath);

    console.log("[kenney-tiny-dungeon] extracting...");
    extractZip(zipPath, extractDir);

    const tilemap = findFileRecursive(extractDir, "tilemap_packed.png");
    if (!tilemap) {
      throw new Error("tilemap_packed.png not found inside the downloaded archive.");
    }
    const license = findFileRecursive(extractDir, "License.txt");

    mkdirSync(KENNEY_PACK_DIR, { recursive: true });
    copyFileSync(tilemap, KENNEY_TILEMAP_DEST);

    const licenseHeader = license ? readFileSync(license, "utf8") : "";
    const licenseNotice = [
      licenseHeader.trimEnd(),
      "",
      "\t\t\t------------------------------",
      "",
      `\tSource: ${KENNEY_FALLBACK_PAGE_URL}`,
      `\tDownloaded from: ${zipUrl}`,
      "\tFile in this directory: tilemap_packed.png (16px tiles)",
      "",
    ].join("\n");
    writeFileSync(KENNEY_LICENSE_DEST, licenseNotice);

    const { width, height } = readPngDimensions(KENNEY_TILEMAP_DEST);
    console.log(
      `[kenney-tiny-dungeon] done. tilemap_packed.png is ${width}x${height} (${width / 16}x${height / 16} tiles @16px)`,
    );
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

function readPngDimensions(pngPath: string): { width: number; height: number } {
  const buf = readFileSync(pngPath);
  // PNG IHDR chunk: width/height are big-endian uint32 starting at byte offset 16.
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}

async function fetch0x72(): Promise<void> {
  const present = PACK_0X72_FILES.every((f) => existsSync(join(PACK_0X72_DIR, f)));
  if (present && existsSync(join(PACK_0X72_DIR, "LICENSE.txt"))) {
    console.log("[0x72-dungeontileset-ii] already present, skipping.");
    return;
  }
  mkdirSync(PACK_0X72_DIR, { recursive: true });
  let lastErr: unknown;
  for (const base of PACK_0X72_MIRRORS) {
    try {
      console.log(`[0x72-dungeontileset-ii] downloading from ${base}`);
      for (const f of PACK_0X72_FILES) await downloadFile(base + f, join(PACK_0X72_DIR, f));
      const sha = createHash("sha256").update(readFileSync(join(PACK_0X72_DIR, PACK_0X72_SHEET))).digest("hex");
      if (sha !== PACK_0X72_SHEET_SHA256) throw new Error(`sha256 mismatch for ${PACK_0X72_SHEET}: ${sha}`);
      const { width, height } = readPngDimensions(join(PACK_0X72_DIR, PACK_0X72_SHEET));
      console.log(`[0x72-dungeontileset-ii] done. sheet is ${width}x${height}. Now run: tsx scripts/pack-0x72-atlas.ts`);
      return;
    } catch (err) {
      lastErr = err;
      console.warn(`[0x72-dungeontileset-ii] mirror failed: ${err instanceof Error ? err.message : err}`);
    }
  }
  throw new Error(`Could not fetch 0x72 DungeonTileset II from any mirror. Download it manually from https://0x72.itch.io/dungeontileset-ii into ${PACK_0X72_DIR}. Last error: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
}

async function resolveKenneyZip(direct: string, page: string, slug: string): Promise<string> {
  const head = await fetch(direct, { method: "HEAD" }).catch(() => undefined);
  if (head && head.ok) return direct;
  const res = await fetch(page);
  if (!res.ok) throw new Error(`GET ${page} returned HTTP ${res.status}`);
  const re = new RegExp(`https://kenney\.nl/media/pages/assets/${slug}/[^"'\s]+\.zip`);
  const match = (await res.text()).match(re);
  if (!match) throw new Error(`Could not find a .zip link on ${page}`);
  return match[0];
}

async function fetchKenney1Bit(): Promise<void> {
  if (KENNEY_1BIT_FILES.every((f) => existsSync(join(KENNEY_1BIT_DIR, f))) && existsSync(join(KENNEY_1BIT_DIR, "LICENSE.txt"))) {
    console.log("[kenney-1bit] already present, skipping.");
    return;
  }
  const zipUrl = await resolveKenneyZip(KENNEY_1BIT_ZIP_URL, KENNEY_1BIT_PAGE_URL, "1-bit-pack");
  const workDir = join(tmpdir(), `bitrouge-kenney1bit-${Date.now()}`);
  const zipPath = join(workDir, "pack.zip");
  const extractDir = join(workDir, "extracted");
  try {
    console.log(`[kenney-1bit] downloading ${zipUrl}`);
    await downloadFile(zipUrl, zipPath);
    extractZip(zipPath, extractDir);
    mkdirSync(KENNEY_1BIT_DIR, { recursive: true });
    for (const f of KENNEY_1BIT_FILES) {
      const src = findFileRecursive(extractDir, f);
      if (!src) throw new Error(`${f} not found inside the downloaded archive.`);
      copyFileSync(src, join(KENNEY_1BIT_DIR, f));
    }
    const license = findFileRecursive(extractDir, "License.txt");
    const notice = [
      (license ? readFileSync(license, "utf8") : "").trimEnd(),
      "",
      "\t\t\t------------------------------",
      "",
      `\tSource: ${KENNEY_1BIT_PAGE_URL}`,
      `\tDownloaded from: ${zipUrl}`,
      `\tFiles: ${KENNEY_1BIT_FILES.join(", ")} (784x352, 49x22 tiles @16px, no spacing)`,
      "",
    ].join("\n");
    writeFileSync(join(KENNEY_1BIT_DIR, "LICENSE.txt"), notice);
    console.log("[kenney-1bit] done.");
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

async function fetchPressStart2P(): Promise<void> {
  const ttfExists = existsSync(FONT_TTF_DEST) && statSync(FONT_TTF_DEST).size > 50 * 1024;
  const oflExists = existsSync(FONT_OFL_DEST);
  if (ttfExists && oflExists) {
    console.log("[press-start-2p] already present, skipping.");
    return;
  }

  mkdirSync(FONTS_DIR, { recursive: true });

  if (!ttfExists) {
    console.log(`[press-start-2p] downloading ${FONT_TTF_URL}`);
    await downloadFile(FONT_TTF_URL, FONT_TTF_DEST);
    const buf = readFileSync(FONT_TTF_DEST);
    const sig = buf.subarray(0, 4);
    const isSfnt = sig.equals(Buffer.from([0x00, 0x01, 0x00, 0x00])) || sig.toString("ascii") === "true";
    if (!isSfnt || buf.length < 50 * 1024) {
      throw new Error("Downloaded PressStart2P-Regular.ttf does not look like a valid font file.");
    }
  }

  if (!oflExists) {
    console.log(`[press-start-2p] downloading ${FONT_OFL_URL}`);
    await downloadFile(FONT_OFL_URL, FONT_OFL_DEST);
  }

  console.log("[press-start-2p] done.");
}

async function main(): Promise<void> {
  mkdirSync(PACKS_DIR, { recursive: true });
  mkdirSync(FONTS_DIR, { recursive: true });

  await fetch0x72();
  await fetchKenney1Bit();
  await fetchKenneyTinyDungeon();
  await fetchPressStart2P();

  console.log("All asset packs are present.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
