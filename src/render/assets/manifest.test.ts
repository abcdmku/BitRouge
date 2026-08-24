import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TEX_GEN, TEX_KENNEY_1BIT, TEX_PACK_0X72 } from "../constants";
import {
  KENNEY_1BIT_FRAME_COUNT,
  KENNEY_ANIMS,
  MANIFEST,
  manifestFrames,
  resolveSprite,
  SOURCE_TEXTURE,
  type SemanticKey,
} from "./manifest";

const PUBLIC = join(__dirname, "..", "..", "..", "public", "assets");

function atlasFrameNames(jsonPath: string): Set<string> {
  const atlas = JSON.parse(readFileSync(jsonPath, "utf8")) as { frames: Record<string, unknown> | { filename: string }[] };
  return new Set(Array.isArray(atlas.frames) ? atlas.frames.map((f) => f.filename) : Object.keys(atlas.frames));
}

describe("manifest", () => {
  const keys = Object.keys(MANIFEST) as SemanticKey[];
  const frames = manifestFrames();

  it("covers all enemy, item and hazard kinds", () => {
    const enemies = ["bitFlip", "nullPointer", "memoryLeak", "deadlock", "forkBomb", "daemon", "zombieProcess", "kernelPanic"];
    const items = ["patch", "hotfix", "cacheLine", "heatsink", "checkpoint", "coreDump"];
    const hazards = ["hotTile", "overloadPlate", "corruptedSector", "brownout"];
    for (const e of enemies) expect(keys).toContain(`enemy_${e}`);
    for (const i of items) expect(keys).toContain(`item_${i}`);
    for (const h of hazards) expect(keys).toContain(`hazard_${h}`);
  });

  it("every key has at least one candidate", () => {
    for (const key of keys) expect(MANIFEST[key].candidates.length, key).toBeGreaterThan(0);
  });

  it("every 0x72 frame exists in the committed atlas", () => {
    const names = atlasFrameNames(join(PUBLIC, "packs", "0x72-dungeontileset-ii", "atlas.json"));
    for (const f of frames["0x72"]) expect(names.has(String(f)), `0x72 frame ${String(f)}`).toBe(true);
  });

  it("every 0x72 clip exists in the committed anims.json", () => {
    const anims = JSON.parse(readFileSync(join(PUBLIC, "packs", "0x72-dungeontileset-ii", "anims.json"), "utf8")) as Record<string, unknown>;
    for (const key of keys) {
      for (const src of MANIFEST[key].candidates) {
        if (src.source !== "0x72") continue;
        for (const clip of Object.values(src.clips ?? {})) {
          expect(clip.startsWith("0x72:"), clip).toBe(true);
          expect(anims[clip.slice(5)], `${key} clip ${clip}`).toBeDefined();
        }
      }
    }
  });

  it("every gen frame exists in the built gen atlas", () => {
    const names = atlasFrameNames(join(PUBLIC, "gen", "sprites.json"));
    for (const f of frames.gen) expect(names.has(String(f)), `gen frame ${String(f)}`).toBe(true);
  });

  it("every gen tile frame is in the gid tileset", () => {
    const tileset = JSON.parse(readFileSync(join(PUBLIC, "tileset", "tileset.json"), "utf8")) as { gids: Record<string, number> };
    for (const f of frames.gen) {
      if (!/^tile_/.test(String(f))) continue;
      expect(tileset.gids[String(f)], `tileset gid for ${String(f)}`).toBeTypeOf("number");
    }
  });

  it("Kenney indices are inside the 49x22 sheet and clips are registered", () => {
    for (const f of frames.kenney1bit) {
      expect(f).toBeTypeOf("number");
      expect(f as number).toBeGreaterThanOrEqual(0);
      expect(f as number).toBeLessThan(KENNEY_1BIT_FRAME_COUNT);
    }
    for (const key of keys) {
      for (const src of MANIFEST[key].candidates) {
        if (src.source !== "kenney1bit") continue;
        for (const clip of Object.values(src.clips ?? {})) expect(KENNEY_ANIMS[clip], `${key} clip ${clip}`).toBeDefined();
      }
    }
  });

  it("resolves the first loaded candidate and falls through", () => {
    const onlyPack = { hasFrame: (t: string) => t === TEX_PACK_0X72 };
    const ref = resolveSprite("enemy_bitFlip", onlyPack);
    expect(ref?.texture).toBe(TEX_PACK_0X72);
    expect(ref?.frame).toBe("tiny_zombie_idle_anim_f0");
    const all = { hasFrame: () => true };
    expect(resolveSprite("enemy_bitFlip", all)?.texture).toBe(TEX_KENNEY_1BIT);
    expect(resolveSprite("hero", all)?.texture).toBe(TEX_GEN);
    expect(resolveSprite("hero", { hasFrame: () => false })).toBeNull();
  });

  it("cycles alternates by variant", () => {
    const all = { hasFrame: () => true };
    const alts = MANIFEST.tile_floor.candidates[0]!.alts!;
    expect(resolveSprite("tile_floor", all, 3)?.frame).toBe(alts[3]);
    expect(resolveSprite("tile_floor", all, alts.length)?.frame).toBe(alts[0]);
  });

  it("maps every source to a texture key", () => {
    expect(Object.keys(SOURCE_TEXTURE).sort()).toEqual(["0x72", "gen", "kenney1bit"]);
  });
});
