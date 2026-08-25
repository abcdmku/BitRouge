import Phaser from "phaser";
import { TEX_GEN } from "../constants";

const BASE = import.meta.env.BASE_URL;
export const GEN_PNG_URL = `${BASE}assets/gen/sprites.png`;
export const GEN_ATLAS_URL = `${BASE}assets/gen/sprites.json`;
export const GEN_MANIFEST_URL = `${BASE}assets/gen/manifest.json`;

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
    const key = name.includes(":") ? name : sprite ? `${sprite}:${name}` : name;
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

/** Queue loader files. Call from `Scene.preload`. */
export function queueAssets(scene: Phaser.Scene, assets: RenderAssets): void {
  if (assets.gen) scene.load.atlas(TEX_GEN, GEN_PNG_URL, GEN_ATLAS_URL);
}

function addAnim(scene: Phaser.Scene, key: string, texture: string, frames: readonly string[], fps: number, loop: boolean): void {
  if (scene.anims.exists(key) || !scene.textures.exists(texture)) return;
  const tex = scene.textures.get(texture);
  const list = frames.filter((f) => tex.has(f)).map((frame) => ({ key: texture, frame }));
  if (list.length === 0) return;
  scene.anims.create({ key, frames: list, frameRate: fps, repeat: loop ? -1 : 0 });
}

/** Create anims for the loaded gen atlas. Call from `Scene.create`. Missing frames are skipped. */
export function createAnims(scene: Phaser.Scene, assets: RenderAssets): void {
  if (assets.gen) for (const a of assets.gen.anims) addAnim(scene, a.name, TEX_GEN, a.frames, a.fps, a.loop);
}
