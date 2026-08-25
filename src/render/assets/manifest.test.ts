import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TEX_GEN } from "../constants";
import { MANIFEST, manifestFrames, resolveSprite, SOURCE_TEXTURE, type SemanticKey } from "./manifest";

const PUBLIC = join(__dirname, "..", "..", "..", "public", "assets");

function atlasFrameNames(jsonPath: string): Set<string> {
  const atlas = JSON.parse(readFileSync(jsonPath, "utf8")) as { frames: Record<string, unknown> | { filename: string }[] };
  return new Set(Array.isArray(atlas.frames) ? atlas.frames.map((f) => f.filename) : Object.keys(atlas.frames));
}

describe("manifest", () => {
  const keys = Object.keys(MANIFEST) as SemanticKey[];

  it("covers every chip kind and hazard kind SOLDER reuses", () => {
    const chips = ["core", "cache", "cooler", "miner", "gpu"];
    const hazards = ["hotTile", "overloadPlate", "corruptedSector", "brownout"];
    for (const c of chips) expect(keys).toContain(`chip_${c}`);
    for (const h of hazards) expect(keys).toContain(`hazard_${h}`);
  });

  it("every key has at least one candidate", () => {
    for (const key of keys) expect(MANIFEST[key].candidates.length, key).toBeGreaterThan(0);
  });

  it("every semantic key resolves to a frame in the built gen atlas", () => {
    const names = atlasFrameNames(join(PUBLIC, "gen", "sprites.json"));
    for (const key of keys) {
      const entry = MANIFEST[key].candidates[0]!;
      expect(names.has(entry.frame), `${key} frame ${entry.frame}`).toBe(true);
    }
  });

  it("every manifest frame exists in the built gen atlas", () => {
    const names = atlasFrameNames(join(PUBLIC, "gen", "sprites.json"));
    for (const f of manifestFrames()) expect(names.has(f), `gen frame ${f}`).toBe(true);
  });

  it("every idle clip exists in the gen manifest anims", () => {
    const manifest = JSON.parse(readFileSync(join(PUBLIC, "gen", "manifest.json"), "utf8")) as {
      sprites: Record<string, { anims: Record<string, unknown> }>;
    };
    for (const key of keys) {
      for (const src of MANIFEST[key].candidates) {
        if (!src.idle) continue;
        const [sprite, anim] = src.idle.split(":");
        expect(manifest.sprites[sprite!]?.anims[anim!], `${key} idle clip ${src.idle}`).toBeDefined();
      }
    }
  });

  it("resolves the loaded candidate and returns null when unloaded", () => {
    const all = { hasFrame: () => true };
    const none = { hasFrame: () => false };
    expect(resolveSprite("chip_core", all)?.texture).toBe(TEX_GEN);
    expect(resolveSprite("chip_core", none)).toBeNull();
  });

  it("maps every source to a texture key", () => {
    expect(Object.keys(SOURCE_TEXTURE).sort()).toEqual(["gen"]);
  });
});
