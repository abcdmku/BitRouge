import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePalette, parseSprite, pixelAt, resolveColor, SpriteFormatError } from "./sprite-format.js";

const FIXTURES = join(__dirname, "fixtures");
const palette = parsePalette(readFileSync(join(FIXTURES, "assets-src", "palette.json"), "utf8"));

function readFixture(rel: string): string {
  return readFileSync(join(FIXTURES, rel), "utf8");
}

describe("parsePalette", () => {
  it("loads 20 colors, transparent char, and roles", () => {
    expect(palette.name).toBe("bitrouge-20");
    expect(palette.transparent).toBe("_");
    expect(Object.keys(palette.colors)).toHaveLength(20);
    expect(palette.colors.K).toBe("#07080f");
    expect(palette.colors.C).toBe("#0fbfd8");
    expect(palette.roles.outline).toBe("K");
    expect(palette.roles.corrupt).toBe("M");
  });

  it("rejects roles that point at unknown colors", () => {
    const bad = JSON.stringify({ name: "x", colors: { K: "#000000" }, roles: { bg: "Z" } });
    expect(() => parsePalette(bad, "p.json")).toThrow(/role "bg"/);
  });
});

describe("parseSprite: hero example", () => {
  const def = parseSprite(readFixture("assets-src/sprites/hero.sprite.txt"), palette, "hero.sprite.txt");

  it("reads size and frame count", () => {
    expect(def.name).toBe("hero");
    expect(def.width).toBe(16);
    expect(def.height).toBe(16);
    expect(def.frames).toHaveLength(11);
    for (const f of def.frames) {
      expect(f).toHaveLength(16);
      for (const row of f) expect(row).toHaveLength(16);
    }
  });

  it("reads anims with fps and loop", () => {
    expect(def.anims.idle).toEqual({ frames: [0, 1, 2, 3], fps: 4, loop: true });
    expect(def.anims.walk).toEqual({ frames: [4, 5, 6, 7], fps: 8, loop: true });
    expect(def.anims.death).toEqual({ frames: [8, 9, 10], fps: 6, loop: false });
  });

  it("resolves pixel colors through the palette", () => {
    expect(pixelAt(def, 0, 7, 1)).toBe("K");
    expect(resolveColor(def, palette, "K")).toEqual([0x07, 0x08, 0x0f, 255]);
    expect(resolveColor(def, palette, "_")).toEqual([0, 0, 0, 0]);
  });
});

describe("parseSprite: small sprites and overrides", () => {
  it("accepts a 4x4 sprite with no anims", () => {
    const def = parseSprite(readFixture("assets-src/sprites/fx_spark.sprite.txt"), palette, "fx_spark.sprite.txt");
    expect(def.width).toBe(4);
    expect(def.frames).toHaveLength(1);
    expect(def.anims).toEqual({});
  });

  it("applies override chars", () => {
    const text = ["name: o", "size: 2x1", "palette: bitrouge-20", "override: X=#123456", "frame 0", "XK"].join("\n");
    const def = parseSprite(text, palette, "o.sprite.txt");
    expect(resolveColor(def, palette, "X")).toEqual([0x12, 0x34, 0x56, 255]);
  });

  it("parses a chars range for fonts", () => {
    const text = ["name: f", "size: 1x1", "palette: bitrouge-20", "chars: 65-66", "frame 0", "W", "frame 1", "K"].join("\n");
    const def = parseSprite(text, palette, "f.sprite.txt");
    expect(def.chars).toEqual(["A", "B"]);
  });
});

describe("parseSprite: errors carry file:line", () => {
  const cases: [string, RegExp, number][] = [
    ["bad/row-length.sprite.txt", /has 3 chars, expected 4/, 6],
    ["bad/unknown-char.sprite.txt", /unknown palette char "\?"/, 5],
    ["bad/missing-frame.sprite.txt", /expected "frame 1" but got "frame 2"/, 6],
    ["bad/anim-range.sprite.txt", /anim "idle" references frame 1/, 4],
  ];
  for (const [file, re, line] of cases) {
    it(`${file} -> ${re}`, () => {
      let err: unknown;
      try {
        parseSprite(readFixture(file), palette, file);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(SpriteFormatError);
      const e = err as SpriteFormatError;
      expect(e.message).toMatch(re);
      expect(e.message.startsWith(`${file}:${line}:`)).toBe(true);
      expect(e.line).toBe(line);
    });
  }

  it("rejects wrong row count", () => {
    const text = ["name: x", "size: 2x2", "palette: bitrouge-20", "frame 0", "KK"].join("\n");
    expect(() => parseSprite(text, palette, "x.sprite.txt")).toThrow(/has 1 rows, expected 2/);
  });

  it("rejects missing headers and palette mismatch", () => {
    expect(() => parseSprite("size: 1x1\npalette: bitrouge-20", palette, "x")).toThrow(/missing `name:`/);
    expect(() => parseSprite("name: x\nsize: 1x1\npalette: other\nframe 0\nK", palette, "x")).toThrow(/x:3: palette "other"/);
    expect(() => parseSprite("name: x\nsize: 1x1\npalette: bitrouge-20", palette, "x")).toThrow(/no frames/);
  });

  it("rejects anim without fps", () => {
    const text = "name: x\nsize: 1x1\npalette: bitrouge-20\nanim: idle 0 loop\nframe 0\nK";
    expect(() => parseSprite(text, palette, "x")).toThrow(/x:4: anim "idle": missing fps/);
  });
});
