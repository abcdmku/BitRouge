import Phaser from "phaser";
import { TEX_GEN, TEX_KENNEY_1BIT, TEX_PACK_0X72, TEX_TILESET, TILE } from "../constants";
import { genAnimKey, KENNEY_ANIMS } from "./manifest";

const BASE = import.meta.env.BASE_URL;
export const GEN_PNG_URL = `${BASE}assets/gen/sprites.png`;
export const GEN_ATLAS_URL = `${BASE}assets/gen/sprites.json`;
export const GEN_MANIFEST_URL = `${BASE}assets/gen/manifest.json`;
export const PACK_0X72_DIR = `${BASE}assets/packs/0x72-dungeontileset-ii/`;
export const PACK_0X72_PNG_URL = `${PACK_0X72_DIR}0x72_DungeonTilesetII_v1.7.png`;
export const PACK_0X72_ATLAS_URL = `${PACK_0X72_DIR}atlas.json`;
export const PACK_0X72_ANIMS_URL = `${PACK_0X72_DIR}anims.json`;
export const KENNEY_1BIT_URL = `${BASE}assets/packs/kenney-1bit/colored-transparent_packed.png`;
export const TILESET_PNG_URL = `${BASE}assets/tileset/tileset.png`;
export const TILESET_JSON_URL = `${BASE}assets/tileset/tileset.json`;

const JSON_0X72_ANIMS = "pack0x72-anims";
const JSON_TILESET = "tileset-json";

/** Flat anim list derived from `public/assets/gen/manifest.json`. */
export interface GenAnim {
  /** Phaser anim key, `<sprite>:<anim>` */
  name: string;
  /** atlas frame names, `<sprite>:<n>` */
  frames: string[];
  fps: number;
  loop: boolean;
}
export interface GenManifest {
  anims: GenAnim[];
}

/** `tileset.json` written by scripts/pack-tileset.ts. */
export interface TilesetInfo {
  image: string;
  tileWidth: number;
  tileHeight: number;
  columns: number;
  firstgid: number;
  /** frame name -> gid */
  gids: Record<string, number>;
}

/** `anims.json` written by scripts/pack-0x72-atlas.ts. */
export type PackAnims = Record<string, { frames: string[]; fps: number; loop: boolean }>;

/** Everything fetched before the Phaser loader runs. */
export interface RenderAssets {
  /** null when the gen atlas is absent (e.g. build:sprites never ran). */
  gen: GenManifest | null;
}

interface RawAnim {
  name?: unknown;
  key?: unknown;
  sprite?: unknown;
  frames?: unknown;
  fps?: unknown;
  loop?: unknown;
}

/**
 * Normalise whatever the sprite pipeline emits into a flat anim list. Accepts
 * `{anims:[...]}`, `{anims:{key:{...}}}` and `{sprites:{name:{anims:...}}}`;
 * numeric frames are expanded to `<sprite>:<n>`.
 */
export function normalizeGenManifest(raw: unknown): GenManifest {
  const anims: GenAnim[] = [];
  if (!raw || typeof raw !== "object") return { anims };
  const root = raw as { anims?: unknown; sprites?: unknown };
  const push = (spriteName: string | undefined, a: RawAnim) => {
    const name = typeof a.name === "string" ? a.name : typeof a.key === "string" ? a.key : undefined;
    const sprite = typeof a.sprite === "string" ? a.sprite : spriteName;
    if (!name || !Array.isArray(a.frames)) return;
    const frames = a.frames.map((f) => (typeof f === "number" && sprite ? `${sprite}:${f}` : String(f)));
    const key = name.includes(":") ? name : sprite ? genAnimKey(sprite, name) : name;
    anims.push({
      name: key,
      frames,
      fps: typeof a.fps === "number" && a.fps > 0 ? a.fps : 6,
      loop: a.loop !== false,
    });
  };
  const visit = (spriteName: string | undefined, list: unknown) => {
    if (Array.isArray(list)) {
      for (const a of list) push(spriteName, a as RawAnim);
    } else if (list && typeof list === "object") {
      for (const [k, v] of Object.entries(list as Record<string, RawAnim>)) push(spriteName, { name: k, ...v });
    }
  };
  visit(undefined, root.anims);
  if (root.sprites && typeof root.sprites === "object") {
    const entries: [string | undefined, unknown][] = Array.isArray(root.sprites)
      ? root.sprites.map((s) => [(s as { name?: string }).name, s])
      : Object.entries(root.sprites as Record<string, unknown>);
    for (const [name, s] of entries) visit(name, (s as { anims?: unknown } | null)?.anims);
  }
  return { anims };
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("json")) return null; // dev servers return index.html for misses
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Fetch the gen manifest before the Phaser loader runs so we know whether the
 * atlas exists. 404 / network failure / HTML fallback -> null.
 */
export async function fetchGenManifest(): Promise<GenManifest | null> {
  const raw = await fetchJson(GEN_MANIFEST_URL);
  return raw ? normalizeGenManifest(raw) : null;
}

export async function fetchRenderAssets(): Promise<RenderAssets> {
  return { gen: await fetchGenManifest() };
}

/** Queue loader files. Call from `Scene.preload`. Packs are always queued; missing files just log. */
export function queueAssets(scene: Phaser.Scene, assets: RenderAssets): void {
  if (assets.gen) scene.load.atlas(TEX_GEN, GEN_PNG_URL, GEN_ATLAS_URL);
  scene.load.atlas(TEX_PACK_0X72, PACK_0X72_PNG_URL, PACK_0X72_ATLAS_URL);
  scene.load.json(JSON_0X72_ANIMS, PACK_0X72_ANIMS_URL);
  scene.load.spritesheet(TEX_KENNEY_1BIT, KENNEY_1BIT_URL, { frameWidth: TILE, frameHeight: TILE });
  scene.load.image(TEX_TILESET, TILESET_PNG_URL);
  scene.load.json(JSON_TILESET, TILESET_JSON_URL);
}

/** Tileset gid table loaded by `queueAssets`, or null when the tileset is missing. */
export function getTilesetInfo(scene: Phaser.Scene): TilesetInfo | null {
  if (!scene.textures.exists(TEX_TILESET) || !scene.cache.json.exists(JSON_TILESET)) return null;
  const info = scene.cache.json.get(JSON_TILESET) as Partial<TilesetInfo> | null;
  if (!info || typeof info !== "object" || !info.gids || typeof info.columns !== "number") return null;
  return {
    image: info.image ?? "tileset.png",
    tileWidth: info.tileWidth ?? TILE,
    tileHeight: info.tileHeight ?? TILE,
    columns: info.columns,
    firstgid: info.firstgid ?? 1,
    gids: info.gids,
  };
}

function addAnim(scene: Phaser.Scene, key: string, texture: string, frames: readonly (string | number)[], fps: number, loop: boolean): void {
  if (scene.anims.exists(key) || !scene.textures.exists(texture)) return;
  const tex = scene.textures.get(texture);
  const list = frames.filter((f) => tex.has(String(f))).map((frame) => ({ key: texture, frame }));
  if (list.length === 0) return;
  scene.anims.create({ key, frames: list, frameRate: fps, repeat: loop ? -1 : 0 });
}

/** Create anims for every loaded source. Call from `Scene.create`. Missing frames are skipped. */
export function createAnims(scene: Phaser.Scene, assets: RenderAssets): void {
  if (assets.gen) for (const a of assets.gen.anims) addAnim(scene, a.name, TEX_GEN, a.frames, a.fps, a.loop);

  if (scene.cache.json.exists(JSON_0X72_ANIMS)) {
    const pack = scene.cache.json.get(JSON_0X72_ANIMS) as PackAnims | null;
    if (pack && typeof pack === "object") {
      for (const [name, a] of Object.entries(pack)) {
        if (!a || !Array.isArray(a.frames)) continue;
        addAnim(scene, `0x72:${name}`, TEX_PACK_0X72, a.frames, a.fps > 0 ? a.fps : 6, a.loop !== false);
      }
    }
  }

  for (const [key, a] of Object.entries(KENNEY_ANIMS)) addAnim(scene, key, TEX_KENNEY_1BIT, a.frames, a.fps, a.loop);
}
