import type { EnemyKind, HazardKind, ItemKind } from "../../game/renderSnapshot";
import { TEX_GEN, TEX_KENNEY_1BIT, TEX_PACK_0X72 } from "../constants";

/**
 * Semantic sprite keys -> ordered source candidates. The first candidate whose
 * texture+frame is loaded wins, so a missing pack degrades to the next entry.
 *
 * Sources:
 *  - `gen`        in-repo sprites (`public/assets/gen`), frames `<name>:<n>`,
 *                 anims `<name>:<anim>`.
 *  - `0x72`       0x72 DungeonTileset II atlas, frames per `tile_list_v1.7`,
 *                 anims `0x72:<base>` (e.g. `0x72:chort_idle`).
 *  - `kenney1bit` Kenney 1-Bit Pack spritesheet, frame = index (row*49+col),
 *                 anims `k1:<key>` created from `KENNEY_ANIMS`.
 *
 * Per-key choices are explained in docs/art-decisions.md.
 */
export type SourceName = "gen" | "0x72" | "kenney1bit";

export const SOURCE_TEXTURE: Record<SourceName, string> = {
  gen: TEX_GEN,
  "0x72": TEX_PACK_0X72,
  kenney1bit: TEX_KENNEY_1BIT,
};

export const KENNEY_1BIT_COLS = 49;
export const KENNEY_1BIT_ROWS = 22;
export const KENNEY_1BIT_FRAME_COUNT = KENNEY_1BIT_COLS * KENNEY_1BIT_ROWS;

/** Entity anim contract -> per-source clip names. */
export type ClipName = "idle" | "walk" | "hurt" | "dead";

export interface SpriteSource {
  source: SourceName;
  /** Static frame (atlas name or sheet index). */
  frame: string | number;
  /** Alternate static frames for per-cell variation. */
  alts?: readonly (string | number)[];
  /**
   * Anim clips. Values are full Phaser anim keys (`hero:idle`, `0x72:chort_run`,
   * `k1:invader`). Kenney clips must also be listed in `KENNEY_ANIMS`.
   */
  clips?: Partial<Record<ClipName, string>>;
  /** Multiply tint (0xffffff = none). Colours monochrome/fantasy art per kind. */
  tint?: number;
  alpha?: number;
  /**
   * Where the sprite's feet sit, in px above the cell's bottom edge. Tall pack
   * sprites (16x23, 16x28) get bottom-aligned to the cell like 16px ones.
   */
  footOffset?: number;
}

export interface ManifestEntry {
  candidates: readonly SpriteSource[];
}

export type SemanticKey =
  | "hero"
  | "tile_floor"
  | "tile_floor_cable"
  | "tile_vent"
  | "tile_wall_rack"
  | "tile_wall_top"
  | "tile_door"
  | "tile_corrupt"
  | "port_down"
  | "fx_hit"
  | "fx_spark"
  | "fx_bolt"
  | `enemy_${EnemyKind}`
  | `item_${ItemKind}`
  | `hazard_${HazardKind}`;

export interface SpriteRef {
  texture: string;
  frame: string | number;
  source: SourceName;
  clips: Partial<Record<ClipName, string>>;
  tint: number;
  alpha: number;
  footOffset: number;
}

const K = (row: number, col: number) => row * KENNEY_1BIT_COLS + col;

/** Kenney 1-Bit sheet indices used below (row*49+col on the packed sheet). */
export const K1 = {
  invaderA: K(7, 23),
  invaderB: K(7, 24),
  medkit: K(11, 43),
  heart: K(10, 39),
  snowflake: K(11, 36),
  skull: K(11, 38),
  flag: K(8, 22),
  coin: [K(12, 43), K(12, 44), K(12, 45), K(12, 46), K(12, 47)] as const,
} as const;

/** Anims built from Kenney sheet indices at load time. Keys are `k1:<name>`. */
export const KENNEY_ANIMS: Record<string, { frames: readonly number[]; fps: number; loop: boolean }> = {
  "k1:invader": { frames: [K1.invaderA, K1.invaderB], fps: 2, loop: true },
  "k1:coin": { frames: K1.coin, fps: 6, loop: true },
};

const gen = (name: string, extra: Partial<SpriteSource> = {}): SpriteSource => ({
  source: "gen",
  frame: `${name}:0`,
  ...extra,
});

/** A gen sprite with the clips the sprite pipeline emits for actors. */
const genActor = (name: string): SpriteSource =>
  gen(name, { clips: { idle: `${name}:idle`, walk: `${name}:walk`, dead: `${name}:death` } });

/** 0x72 monster with `<base>_idle` / `<base>_run` anims (or one `<base>` clip). Monsters have no hit frame; hurt falls through to idle + flash. */
const monster = (
  base: string,
  tint: number,
  footOffset: number,
  opts: { single?: boolean; alpha?: number } = {},
): SpriteSource => {
  const clips: Partial<Record<ClipName, string>> = opts.single
    ? { idle: `0x72:${base}`, walk: `0x72:${base}` }
    : { idle: `0x72:${base}_idle`, walk: `0x72:${base}_run` };
  const src: SpriteSource = {
    source: "0x72",
    frame: opts.single ? `${base}_anim_f0` : `${base}_idle_anim_f0`,
    clips,
    tint,
    footOffset,
  };
  if (opts.alpha !== undefined) src.alpha = opts.alpha;
  return src;
};

const k1 = (frame: number, extra: Partial<SpriteSource> = {}): SpriteSource => ({
  source: "kenney1bit",
  frame,
  ...extra,
});

const floorAlts = ["tile_floor:0", "tile_floor:0", "tile_floor:0", "tile_floor:1", "tile_floor:2"];
const rackAlts = ["tile_wall_rack:0", "tile_wall_rack:1", "tile_wall_rack:0", "tile_wall_rack:1", "tile_wall_rack:1"];

export const MANIFEST: Record<SemanticKey, ManifestEntry> = {
  hero: { candidates: [genActor("hero")] },

  tile_floor: { candidates: [gen("tile_floor", { alts: floorAlts })] },
  tile_floor_cable: { candidates: [gen("tile_floor_cable", { alts: ["tile_floor_cable:0", "tile_floor_cable:1"] })] },
  tile_vent: { candidates: [gen("tile_vent", { alts: ["tile_vent:0", "tile_vent:1"] })] },
  tile_wall_rack: { candidates: [gen("tile_wall_rack", { alts: rackAlts })] },
  tile_wall_top: { candidates: [gen("tile_wall_top")] },
  tile_door: { candidates: [gen("tile_door")] },
  tile_corrupt: { candidates: [gen("tile_corrupt", { alts: ["tile_corrupt:0", "tile_corrupt:1", "tile_corrupt:2"] })] },
  port_down: { candidates: [gen("port_down", { clips: { idle: "port_down:pulse" } })] },

  fx_hit: { candidates: [gen("fx_hit", { clips: { idle: "fx_hit:burst" } })] },
  fx_spark: { candidates: [gen("fx_spark")] },
  fx_bolt: { candidates: [gen("fx_bolt", { clips: { idle: "fx_bolt:fly" } })] },

  // Enemies are software faults: 0x72 monsters (animated, shaded) tinted per
  // kind; bitFlip is the classic "bug" glyph (2-frame Kenney invader).
  enemy_bitFlip: {
    candidates: [
      k1(K1.invaderA, { clips: { idle: "k1:invader", walk: "k1:invader" }, tint: 0x8cff9a }),
      monster("tiny_zombie", 0x8cff9a, 0),
    ],
  },
  enemy_nullPointer: { candidates: [monster("angel", 0x9fd8ff, 0, { alpha: 0.75 })] },
  enemy_memoryLeak: { candidates: [monster("swampy", 0x7dffb0, 0, { single: true })] },
  enemy_deadlock: { candidates: [monster("skelet", 0xff9a7a, 0)] },
  enemy_forkBomb: { candidates: [monster("goblin", 0xffc266, 0)] },
  enemy_daemon: { candidates: [monster("chort", 0xd48cff, 1)] },
  enemy_zombieProcess: { candidates: [monster("zombie", 0xa8ff8c, 0, { single: true })] },

  // Items: Kenney 1-bit icons read as pickups; tinted per effect.
  item_patch: { candidates: [k1(K1.medkit)] },
  item_hotfix: { candidates: [k1(K1.heart)] },
  item_cacheLine: { candidates: [k1(K1.coin[0], { clips: { idle: "k1:coin" } })] },
  item_heatsink: { candidates: [k1(K1.snowflake, { tint: 0x6ff2ff })] },
  item_checkpoint: { candidates: [k1(K1.flag, { tint: 0x6ff2ff })] },
  item_coreDump: { candidates: [k1(K1.skull, { tint: 0xd8e1f2 })] },

  hazard_hotTile: { candidates: [gen("hazard_hotTile", { clips: { idle: "hazard_hotTile:shimmer" } })] },
  hazard_overloadPlate: { candidates: [gen("hazard_overloadPlate", { clips: { idle: "hazard_overloadPlate:arc" } })] },
  hazard_corruptedSector: { candidates: [gen("hazard_corruptedSector", { clips: { idle: "hazard_corruptedSector:glitch" } })] },
  hazard_brownout: { candidates: [gen("hazard_brownout", { clips: { idle: "hazard_brownout:flicker" } })] },
};

/** Minimal texture lookup so this stays testable without Phaser. */
export interface FrameLookup {
  hasFrame(texture: string, frame: string | number): boolean;
}

function toRef(src: SpriteSource, frame: string | number): SpriteRef {
  return {
    texture: SOURCE_TEXTURE[src.source],
    frame,
    source: src.source,
    clips: src.clips ?? {},
    tint: src.tint ?? 0xffffff,
    alpha: src.alpha ?? 1,
    footOffset: src.footOffset ?? 0,
  };
}

/**
 * Pick the first loaded candidate. `variant` cycles `alts` for per-cell
 * variety. Returns null when nothing is loaded (caller draws a placeholder).
 */
export function resolveSprite(key: SemanticKey, textures: FrameLookup, variant = 0): SpriteRef | null {
  for (const src of MANIFEST[key].candidates) {
    const tex = SOURCE_TEXTURE[src.source];
    const alts = src.alts;
    const frame = alts && alts.length > 0 ? alts[Math.abs(variant) % alts.length]! : src.frame;
    if (textures.hasFrame(tex, frame)) return toRef(src, frame);
    if (frame !== src.frame && textures.hasFrame(tex, src.frame)) return toRef(src, src.frame);
  }
  return null;
}

/** Every static frame the manifest can ask for, grouped by source (tests + tileset build). */
export function manifestFrames(): Record<SourceName, Set<string | number>> {
  const out: Record<SourceName, Set<string | number>> = { gen: new Set(), "0x72": new Set(), kenney1bit: new Set() };
  for (const entry of Object.values(MANIFEST)) {
    for (const src of entry.candidates) {
      out[src.source].add(src.frame);
      for (const a of src.alts ?? []) out[src.source].add(a);
    }
  }
  return out;
}

/** Anim key for a gen sprite, e.g. `hero:walk`. */
export function genAnimKey(genKey: string, anim: string): string {
  return `${genKey}:${anim}`;
}
