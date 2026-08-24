#!/usr/bin/env tsx
/**
 * fetch-packs.ts
 *
 * Idempotently downloads third-party asset packs used by this project:
 *   1. Kenney "Tiny Dungeon" tileset (CC0) -> public/assets/packs/kenney-tiny-dungeon/
 *   2. Press Start 2P font (OFL)          -> public/fonts/
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

  await fetchKenneyTinyDungeon();
  await fetchPressStart2P();

  console.log("All asset packs are present.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
