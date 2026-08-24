/**
 * sprite-format.ts
 *
 * Pure parser for the BitRouge text sprite format (`*.sprite.txt`) and the
 * compute palette (`assets-src/palette.json`). No filesystem access; the
 * build script feeds text in and gets structured data out.
 *
 * Format (see assets-src/STYLE.md for the human version):
 *
 *   name: hero
 *   size: 16x16
 *   palette: bitrouge-20
 *   override: X=#rrggbb          # optional, adds/replaces a char for this file
 *   anim: idle 0,1,2,3 fps=6 loop
 *   chars: 32-126                 # font files only: frame index -> character
 *   frame 0
 *   ________________             # exactly H rows of exactly W chars
 *   ...
 *
 * Full-line comments start with `#`. Blank lines are ignored. Frames must be
 * numbered contiguously from 0. Errors carry `file:line`.
 */

export interface Palette {
  name: string;
  transparent: string;
  colors: Record<string, string>;
  roles: Record<string, string>;
}

export interface SpriteAnim {
  frames: number[];
  fps: number;
  loop: boolean;
}

export interface SpriteDef {
  name: string;
  width: number;
  height: number;
  palette: string;
  overrides: Record<string, string>;
  anims: Record<string, SpriteAnim>;
  /** frames[i][y] is a row string of exactly `width` chars. */
  frames: string[][];
  /** Font files only: chars[i] is the character drawn by frame i. */
  chars?: string[];
  fileName: string;
}

export type RGBA = [number, number, number, number];

export class SpriteFormatError extends Error {
  constructor(
    public readonly file: string,
    public readonly line: number,
    message: string,
  ) {
    super(`${file}:${line}: ${message}`);
    this.name = "SpriteFormatError";
  }
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const NAME_RE = /^[a-zA-Z_][\w-]*$/;

export function parsePalette(text: string, fileName = "palette.json"): Palette {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new SpriteFormatError(fileName, 1, `invalid JSON: ${(e as Error).message}`);
  }
  const obj = raw as Partial<Palette>;
  if (typeof obj.name !== "string") throw new SpriteFormatError(fileName, 1, "missing `name`");
  const transparent = typeof obj.transparent === "string" ? obj.transparent : "_";
  if (transparent.length !== 1) throw new SpriteFormatError(fileName, 1, "`transparent` must be one char");
  if (!obj.colors || typeof obj.colors !== "object") throw new SpriteFormatError(fileName, 1, "missing `colors`");
  const colors: Record<string, string> = {};
  for (const [ch, hex] of Object.entries(obj.colors)) {
    if (ch.length !== 1) throw new SpriteFormatError(fileName, 1, `color key "${ch}" must be one char`);
    if (ch === transparent) throw new SpriteFormatError(fileName, 1, `color key "${ch}" collides with transparent`);
    if (typeof hex !== "string" || !HEX_RE.test(hex)) {
      throw new SpriteFormatError(fileName, 1, `color "${ch}" must be #rrggbb`);
    }
    colors[ch] = hex.toLowerCase();
  }
  const roles: Record<string, string> = {};
  for (const [role, ch] of Object.entries(obj.roles ?? {})) {
    if (typeof ch !== "string" || !(ch in colors)) {
      throw new SpriteFormatError(fileName, 1, `role "${role}" refers to unknown color "${String(ch)}"`);
    }
    roles[role] = ch;
  }
  return { name: obj.name, transparent, colors, roles };
}

export function hexToRgba(hex: string): RGBA {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff, 255];
}

/** Resolve a sprite char to RGBA, honouring per-file overrides. Transparent -> alpha 0. */
export function resolveColor(def: SpriteDef, palette: Palette, ch: string): RGBA {
  if (ch === palette.transparent) return [0, 0, 0, 0];
  const hex = def.overrides[ch] ?? palette.colors[ch];
  if (!hex) throw new Error(`${def.fileName}: char "${ch}" is not in palette ${palette.name}`);
  return hexToRgba(hex);
}

function parseSize(value: string, file: string, line: number): [number, number] {
  const m = /^(\d+)x(\d+)$/.exec(value);
  if (!m) throw new SpriteFormatError(file, line, `size must be WxH, got "${value}"`);
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (w < 1 || h < 1 || w > 256 || h > 256) {
    throw new SpriteFormatError(file, line, `size ${w}x${h} out of range 1..256`);
  }
  return [w, h];
}

function parseAnim(value: string, file: string, line: number): [string, SpriteAnim] {
  // anim: <name> <f,f,f> fps=N [loop]
  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length < 3) {
    throw new SpriteFormatError(file, line, `anim needs "<name> <frames> fps=N [loop]", got "${value}"`);
  }
  const [name, framesStr, ...rest] = parts;
  if (!NAME_RE.test(name)) throw new SpriteFormatError(file, line, `bad anim name "${name}"`);
  const frames = framesStr.split(",").map((s) => {
    if (!/^\d+$/.test(s)) throw new SpriteFormatError(file, line, `anim "${name}": bad frame index "${s}"`);
    return Number(s);
  });
  let fps: number | undefined;
  let loop = false;
  for (const tok of rest) {
    const fm = /^fps=(\d+(?:\.\d+)?)$/.exec(tok);
    if (fm) fps = Number(fm[1]);
    else if (tok === "loop") loop = true;
    else throw new SpriteFormatError(file, line, `anim "${name}": unknown token "${tok}"`);
  }
  if (fps === undefined || fps <= 0) throw new SpriteFormatError(file, line, `anim "${name}": missing fps=N`);
  return [name, { frames, fps, loop }];
}

function parseChars(value: string, file: string, line: number): string[] {
  // `chars: 32-126` (codepoint range) or `chars: "abc"` (quoted literal)
  const range = /^(\d+)-(\d+)$/.exec(value);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    if (b < a) throw new SpriteFormatError(file, line, `chars range ${a}-${b} is reversed`);
    const out: string[] = [];
    for (let c = a; c <= b; c++) out.push(String.fromCodePoint(c));
    return out;
  }
  const quoted = /^"(.*)"$/.exec(value);
  if (quoted) return Array.from(quoted[1]);
  throw new SpriteFormatError(file, line, `chars must be "N-M" codepoint range or a quoted string`);
}

export function parseSprite(text: string, palette: Palette, fileName: string): SpriteDef {
  const lines = text.split(/\r?\n/);
  let name: string | undefined;
  let size: [number, number] | undefined;
  let paletteName: string | undefined;
  const overrides: Record<string, string> = {};
  const anims: Record<string, SpriteAnim> = {};
  const animLines: Record<string, number> = {};
  let chars: string[] | undefined;
  const frames: string[][] = [];

  let current: string[] | null = null;
  let currentIndex = -1;
  let currentStartLine = 0;

  const finishFrame = () => {
    if (!current) return;
    const [, h] = size!;
    if (current.length !== h) {
      throw new SpriteFormatError(
        fileName,
        currentStartLine,
        `frame ${currentIndex} has ${current.length} rows, expected ${h}`,
      );
    }
    frames[currentIndex] = current;
    current = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const ln = i + 1;
    const line = lines[i].trim();
    if (line === "" || line.startsWith("#")) continue;

    const frameMatch = /^frame\s+(\d+)$/.exec(line);
    if (frameMatch) {
      finishFrame();
      if (!name || !size) throw new SpriteFormatError(fileName, ln, "frame block before name/size headers");
      const idx = Number(frameMatch[1]);
      if (idx !== frames.length) {
        throw new SpriteFormatError(
          fileName,
          ln,
          `expected "frame ${frames.length}" but got "frame ${idx}" (frames must be contiguous from 0)`,
        );
      }
      current = [];
      currentIndex = idx;
      currentStartLine = ln;
      continue;
    }

    if (current) {
      const [w, h] = size!;
      if (line.length !== w) {
        throw new SpriteFormatError(
          fileName,
          ln,
          `row ${current.length} of frame ${currentIndex} has ${line.length} chars, expected ${w}`,
        );
      }
      for (let x = 0; x < line.length; x++) {
        const ch = line[x];
        if (ch !== palette.transparent && !(ch in palette.colors) && !(ch in overrides)) {
          throw new SpriteFormatError(fileName, ln, `unknown palette char "${ch}" at column ${x + 1}`);
        }
      }
      current.push(line);
      if (current.length === h) finishFrame();
      continue;
    }

    const header = /^([a-z]+):\s*(.*)$/.exec(line);
    if (!header) throw new SpriteFormatError(fileName, ln, `unrecognised line "${line}"`);
    const [, key, value] = header;
    switch (key) {
      case "name":
        if (!NAME_RE.test(value)) throw new SpriteFormatError(fileName, ln, `bad sprite name "${value}"`);
        name = value;
        break;
      case "size":
        size = parseSize(value, fileName, ln);
        break;
      case "palette":
        if (value !== palette.name) {
          throw new SpriteFormatError(fileName, ln, `palette "${value}" does not match "${palette.name}"`);
        }
        paletteName = value;
        break;
      case "override": {
        const m = /^(\S)=(#[0-9a-fA-F]{6})$/.exec(value);
        if (!m) throw new SpriteFormatError(fileName, ln, `override must be X=#rrggbb, got "${value}"`);
        if (m[1] === palette.transparent) throw new SpriteFormatError(fileName, ln, "cannot override transparent char");
        overrides[m[1]] = m[2].toLowerCase();
        break;
      }
      case "anim": {
        const [an, def] = parseAnim(value, fileName, ln);
        if (an in anims) throw new SpriteFormatError(fileName, ln, `duplicate anim "${an}"`);
        anims[an] = def;
        animLines[an] = ln;
        break;
      }
      case "chars":
        chars = parseChars(value, fileName, ln);
        break;
      default:
        throw new SpriteFormatError(fileName, ln, `unknown header "${key}"`);
    }
  }
  finishFrame();

  const last = lines.length;
  if (!name) throw new SpriteFormatError(fileName, last, "missing `name:` header");
  if (!size) throw new SpriteFormatError(fileName, last, "missing `size:` header");
  if (!paletteName) throw new SpriteFormatError(fileName, last, "missing `palette:` header");
  if (frames.length === 0) throw new SpriteFormatError(fileName, last, "sprite has no frames");

  for (const [an, def] of Object.entries(anims)) {
    for (const f of def.frames) {
      if (f >= frames.length) {
        throw new SpriteFormatError(
          fileName,
          animLines[an],
          `anim "${an}" references frame ${f} but sprite has ${frames.length} frames (0..${frames.length - 1})`,
        );
      }
    }
  }
  if (chars && chars.length !== frames.length) {
    throw new SpriteFormatError(fileName, last, `chars maps ${chars.length} characters but sprite has ${frames.length} frames`);
  }

  return { name, width: size[0], height: size[1], palette: paletteName, overrides, anims, frames, chars, fileName };
}

/** Pixel char at (x, y) of frame i. */
export function pixelAt(def: SpriteDef, frame: number, x: number, y: number): string {
  return def.frames[frame][y][x];
}
