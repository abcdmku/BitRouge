import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSprites, paletteCss, shelfPack, type BuildResult } from "./build-sprites.js";
import { renderContactSheet } from "./contact-sheet.js";
import { PixelCanvas } from "./pixel-canvas.js";
import { hexToRgba, parsePalette, parseSprite } from "./sprite-format.js";

const SRC = join(__dirname, "fixtures", "assets-src");

describe("buildSprites into a temp dir", () => {
  let tmp: string;
  let outDir: string;
  let cssPath: string;
  let result: BuildResult;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), "bitrouge-sprites-"));
    outDir = join(tmp, "gen");
    cssPath = join(tmp, "ui", "palette.generated.css");
    result = buildSprites({ srcDir: SRC, outDir, cssPath });
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("writes every artifact", () => {
    for (const f of ["sprites.png", "sprites.json", "manifest.json", "font.png", "font.xml", "single/hero.png", "single/fx_spark.png"]) {
      expect(existsSync(join(outDir, f)), f).toBe(true);
    }
    expect(existsSync(cssPath)).toBe(true);
  });

  it("PNG dimensions match the packer", () => {
    const png = PixelCanvas.fromPNG(readFileSync(join(outDir, "sprites.png")));
    expect(png.width).toBe(result.atlas.width);
    expect(png.height).toBe(result.atlas.height);
    const atlas = JSON.parse(readFileSync(join(outDir, "sprites.json"), "utf8"));
    expect(atlas.meta.size).toEqual({ w: png.width, h: png.height });
    expect(atlas.meta.image).toBe("sprites.png");
  });

  it("atlas frames are present with correct x/y and the pixel at a known cell is K", () => {
    const atlas = JSON.parse(readFileSync(join(outDir, "sprites.json"), "utf8"));
    const names = Object.keys(atlas.frames);
    expect(names).toContain("hero:0");
    expect(names).toContain("hero:10");
    expect(names).toContain("fx_spark:0");
    expect(names).toHaveLength(12);

    const f = atlas.frames["hero:0"];
    expect(f.frame.w).toBe(16);
    expect(f.frame.h).toBe(16);
    expect(f.rotated).toBe(false);
    expect(f.trimmed).toBe(false);
    expect(f.sourceSize).toEqual({ w: 16, h: 16 });
    expect(f.spriteSourceSize).toEqual({ x: 0, y: 0, w: 16, h: 16 });
    expect(f.frame).toEqual(result.atlas.frames["hero:0"].frame);

    // hero frame 0, pixel (7,1) is the antenna outline `K`.
    const palette = parsePalette(readFileSync(join(SRC, "palette.json"), "utf8"));
    const hero = parseSprite(readFileSync(join(SRC, "sprites", "hero.sprite.txt"), "utf8"), palette, "hero");
    expect(hero.frames[0][1][7]).toBe("K");
    const png = PixelCanvas.fromPNG(readFileSync(join(outDir, "sprites.png")));
    expect(png.get(f.frame.x + 7, f.frame.y + 1)).toEqual(hexToRgba(palette.colors.K));
    // Transparent pixel stays alpha 0.
    expect(png.get(f.frame.x, f.frame.y)[3]).toBe(0);
    // Padding column left of the first frame is empty.
    expect(png.get(0, 0)[3]).toBe(0);
  });

  it("manifest has sizes, frame counts and anims", () => {
    const m = JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8"));
    expect(m.sprites.hero.size).toEqual({ w: 16, h: 16 });
    expect(m.sprites.hero.frames).toBe(11);
    expect(m.sprites.hero.anims.idle).toEqual({ frames: [0, 1, 2, 3], fps: 4, loop: true });
    expect(m.sprites.hero.anims.death.loop).toBe(false);
    expect(m.sprites.fx_spark.size).toEqual({ w: 4, h: 4 });
    expect(m.palette.name).toBe("bitrouge-20");
    expect(m.palette.roles.data).toBe("C");
  });

  it("strip PNG is frames * width wide", () => {
    const png = PixelCanvas.fromPNG(readFileSync(join(outDir, "single", "hero.png")));
    expect(png.width).toBe(16 * 11);
    expect(png.height).toBe(16);
  });

  it("generated CSS contains palette vars and role aliases", () => {
    const css = readFileSync(cssPath, "utf8");
    expect(css).toContain("--c-C: #0fbfd8");
    expect(css).toContain("--c-K: #07080f");
    expect(css).toContain("--bg: var(--c-N)");
    expect(css).toContain("--danger: var(--c-R)");
    expect(css).toContain("--text: var(--c-W)");
    expect(css).toContain("--outline: var(--c-K)");
  });

  it("font.xml has 95 chars and matches font.png", () => {
    const xml = readFileSync(join(outDir, "font.xml"), "utf8");
    expect(xml).toContain('<chars count="95">');
    expect((xml.match(/<char /g) ?? []).length).toBe(95);
    expect(xml).toContain('<info face="bitrouge" size="8"');
    expect(xml).toContain('lineHeight="9" base="7"');
    expect(xml).toContain('<page id="0" file="font.png"/>');
    expect(xml).toMatch(/<char id="32" x="0" y="0" width="6" height="8" xoffset="0" yoffset="0" xadvance="6" page="0" chnl="15"/);
    const png = PixelCanvas.fromPNG(readFileSync(join(outDir, "font.png")));
    const scaleW = Number(/scaleW="(\d+)"/.exec(xml)![1]);
    const scaleH = Number(/scaleH="(\d+)"/.exec(xml)![1]);
    expect(png.width).toBe(scaleW);
    expect(png.height).toBe(scaleH);
    expect(result.font?.glyphs).toBe(95);
  });

  it("--only filters sprites and rejects unknown names", () => {
    const dir = join(tmp, "only");
    const r = buildSprites({ srcDir: SRC, outDir: dir, cssPath: join(dir, "p.css"), only: ["fx_spark"] });
    expect(Object.keys(r.atlas.frames)).toEqual(["fx_spark:0"]);
    expect(() => buildSprites({ srcDir: SRC, outDir: dir, cssPath: join(dir, "p.css"), only: ["nope"] })).toThrow(/no sprite named "nope"/);
  });

  it("contact sheet renders both modes", () => {
    const a = renderContactSheet({ srcDir: SRC, outPath: join(tmp, "sheet.png") });
    expect(a.width).toBeGreaterThan(100);
    const png = PixelCanvas.fromPNG(readFileSync(join(tmp, "sheet.png")));
    expect(png.width).toBe(a.width);
    const b = renderContactSheet({ srcDir: SRC, outPath: join(tmp, "tiles.png"), sheet: "tiles" });
    expect(existsSync(join(tmp, "tiles.png"))).toBe(true);
    expect(b.height).toBeGreaterThan(0);
  });
});

describe("shelfPack", () => {
  it("never overlaps and respects max width", () => {
    const palette = parsePalette(readFileSync(join(SRC, "palette.json"), "utf8"));
    const big = parseSprite(readFileSync(join(SRC, "sprites", "hero.sprite.txt"), "utf8"), palette, "hero");
    const { placed, width, height } = shelfPack([big, big, big], 64, 1);
    expect(width).toBeLessThanOrEqual(64);
    expect(height).toBeGreaterThan(16 * 2);
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i];
        const b = placed[j];
        const overlap = a.x < b.x + 16 && b.x < a.x + 16 && a.y < b.y + 16 && b.y < a.y + 16;
        expect(overlap).toBe(false);
      }
    }
  });
});

describe("paletteCss", () => {
  it("falls back to default role chars when roles are missing", () => {
    const css = paletteCss({ name: "x", transparent: "_", colors: { K: "#000000", N: "#111111" }, roles: {} });
    expect(css).toContain("--bg: var(--c-N)");
  });
});
