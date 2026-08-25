import type { ComponentKind } from "../../game/types";
import { TEX_GEN } from "../constants";

/** Hazard art kinds reused verbatim from v2 (§4); renderer-only, not part of the sim contract. */
export type HazardKind = "hotTile" | "overloadPlate" | "corruptedSector" | "brownout";

/**
 * Semantic sprite keys -> the gen sprite (compiled by scripts/build-sprites.ts
 * from assets-src/sprites/*.sprite.txt) that draws them. SOLDER's whole scope
 * is `public/assets/gen`; no external art packs are loaded.
 */
export type SourceName = "gen";

export const SOURCE_TEXTURE: Record<SourceName, string> = { gen: TEX_GEN };

export interface SpriteSource {
  source: SourceName;
  /** Static frame, `<name>:<index>`. */
  frame: string;
  /** Looping idle anim key, `<name>:<anim>`, when the sprite declares one. */
  idle?: string;
  tint?: number;
  alpha?: number;
}

export interface ManifestEntry {
  candidates: readonly SpriteSource[];
}

export type SemanticKey =
  | "board_tile"
  | "port"
  | "socket_locked"
  | "trace_arrow"
  | `chip_${ComponentKind}`
  | `hazard_${HazardKind}`
  | "fx_packet"
  | "fx_delivery"
  | "fx_crash";

export interface SpriteRef {
  texture: string;
  frame: string;
  idle: string | null;
  tint: number;
  alpha: number;
}

const gen = (name: string, anim?: string, extra: Partial<SpriteSource> = {}): SpriteSource => ({
  source: "gen",
  frame: `${name}:0`,
  idle: anim ? `${name}:${anim}` : undefined,
  ...extra,
});

const COMPONENT_KINDS = ["core", "cache", "cooler", "miner", "gpu"] as const satisfies readonly ComponentKind[];
const COMPONENT_ANIM: Record<ComponentKind, string> = {
  core: "pulse",
  cache: "scan",
  cooler: "spin",
  miner: "glint",
  gpu: "pulse",
};

const chipEntries = Object.fromEntries(
  COMPONENT_KINDS.map((kind) => [`chip_${kind}`, { candidates: [gen(`chip_${kind}`, COMPONENT_ANIM[kind])] }]),
) as unknown as Record<`chip_${ComponentKind}`, ManifestEntry>;

export const MANIFEST: Record<SemanticKey, ManifestEntry> = {
  board_tile: { candidates: [gen("tile_floor_cable")] },
  port: { candidates: [gen("port_down", "pulse")] },
  socket_locked: { candidates: [gen("socket_locked", "flicker")] },
  trace_arrow: { candidates: [gen("trace_arrow", "flow")] },
  ...chipEntries,

  hazard_hotTile: { candidates: [gen("hazard_hotTile", "shimmer")] },
  hazard_overloadPlate: { candidates: [gen("hazard_overloadPlate", "arc")] },
  hazard_corruptedSector: { candidates: [gen("hazard_corruptedSector", "glitch")] },
  hazard_brownout: { candidates: [gen("hazard_brownout", "flicker")] },

  fx_packet: { candidates: [gen("fx_spark")] },
  fx_delivery: { candidates: [gen("fx_hit", "burst")] },
  fx_crash: { candidates: [gen("fx_bolt", "fly")] },
};

/** Minimal texture lookup so this stays testable without Phaser. */
export interface FrameLookup {
  hasFrame(texture: string, frame: string): boolean;
}

function toRef(src: SpriteSource): SpriteRef {
  return {
    texture: SOURCE_TEXTURE[src.source],
    frame: src.frame,
    idle: src.idle ?? null,
    tint: src.tint ?? 0xffffff,
    alpha: src.alpha ?? 1,
  };
}

/** Picks the first loaded candidate. Returns null when nothing is loaded (caller draws a placeholder). */
export function resolveSprite(key: SemanticKey, textures: FrameLookup): SpriteRef | null {
  for (const src of MANIFEST[key].candidates) {
    if (textures.hasFrame(SOURCE_TEXTURE[src.source], src.frame)) return toRef(src);
  }
  return null;
}

/** Every static frame the manifest can ask for (manifest test + atlas coverage). */
export function manifestFrames(): Set<string> {
  const out = new Set<string>();
  for (const entry of Object.values(MANIFEST)) for (const src of entry.candidates) out.add(src.frame);
  return out;
}
