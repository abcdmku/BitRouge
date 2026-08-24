# BitRouge Art Style Guide

Sprites are plain text (`assets-src/sprites/<name>.sprite.txt`), one character
per pixel, compiled by `npm run build:sprites`. Read this whole file before
authoring; the checklist at the end is what QA looks for on the contact sheet.

## Setting

A roguelike inside a computer. Floors are server rooms; the hero is a running
process (a cyan "bit"); enemies are software faults. Everything is hardware,
data, heat, power and corruption. No organic textures, no wood, no stone.

## Hard rules

- Frame size is 16x16 unless the brief says otherwise (fx particles may be
  smaller, e.g. `4x4`). All frames in one file share the size.
- Palette only. Every pixel is one of the 20 palette characters or `_`
  (transparent). `override: X=#rrggbb` exists for rare one-offs; ask first.
- 3-4 colors plus `K` outline per sprite. Pick one hue family and one or two
  neutrals. More colors read as noise at 16px.
- 1px `K` (#07080f) outline around every silhouette that stands on the floor
  (characters, props, ports). FX and floor tiles do not need outlines.
- Light comes from the top-left: light shade on the top and left edges, dark
  shade on the bottom and right.
- Characters face RIGHT. The engine flips them to face left. Never author a
  left-facing frame.
- Feet sit on rows 13-14 (0-indexed) so all characters share a baseline. Row 15
  is reserved for a shadow or left empty.
- Floors tile seamlessly: identical edge pixels on every frame; test with
  `contact-sheet --sheet tiles`. Keep floors low contrast (`n`, `B`, `N`) so
  characters pop.
- Animation lengths: idle 2-4 frames, walk 4, death 2-3, fx 1-3. Pulsing props
  2-4. Frame index order in the file is the order shown in the contact sheet.

## Palette `bitrouge-20` (`assets-src/palette.json`)

| char | hex     | use                                   |
|------|---------|---------------------------------------|
| `_`  | -       | transparent                           |
| `K`  | #07080f | outline, deepest shadow               |
| `N`  | #0d1224 | background, socket interiors          |
| `n`  | #161d38 | floor base                            |
| `B`  | #233052 | floor grid, dark metal, shadow        |
| `b`  | #3b4a78 | metal mid                             |
| `S`  | #5a6b94 | metal light                           |
| `s`  | #8a9bbd | metal highlight, bezels               |
| `W`  | #d8e1f2 | text, bone white                      |
| `w`  | #ffffff | specular, eyes, hottest core          |
| `C`  | #0fbfd8 | data, hero, ports (main)              |
| `c`  | #6ff2ff | data highlight                        |
| `G`  | #22c55e | healthy / ok (main)                   |
| `g`  | #8cff9a | healthy highlight, LEDs               |
| `A`  | #f59e0b | thermal / warning (main)              |
| `a`  | #ffd166 | warm highlight, sparks                |
| `R`  | #e0304b | power, damage, danger (main)          |
| `r`  | #ff7a8a | damage highlight                      |
| `M`  | #c026d3 | corruption (main)                     |
| `m`  | #ff6bf1 | corruption highlight                  |
| `P`  | #7c3aed | corruption shadow, void purple        |

Roles (`palette.json` -> `roles`, also emitted as CSS vars): `outline=K`,
`bg=N`, `floor=n`, `metal=S`, `data=C`, `ok=G`, `warn=A`, `danger=R`,
`corrupt=M`, `text=W`.

## Theme vocabulary

- Cyan / green: healthy data, the hero, safe ports, good pickups.
- Amber: heat, throttling, warnings, thermal enemies.
- Red: power faults, damage, PSU trips, hit flashes.
- Magenta / purple: corruption, glitches, memory faults, the void.
- Greys (`B` `b` `S` `s`): hardware, racks, cables, floor.

Shading recipe for a hue: highlight (lowercase) on top-left edges, main
(uppercase) as fill, `B` or `P` as the shadow, `K` outline. Example hero head:
`c` top-left, `C` fill, `B` right edge.

## Enemy concepts

| id            | look                                                      | hue   |
|---------------|-----------------------------------------------------------|-------|
| bitFlip       | beetle; carapace with 1-2 "glitch" pixels that jump frames | M/m   |
| nullPointer   | hollow ring around a void; nothing inside the outline     | P/N   |
| memoryLeak    | drip-shaped blob, lower rows sag/drip between frames      | G/g   |
| deadlock      | two interlocked rings, rotate against each other          | S/s   |
| forkBomb      | spark cluster; idle splits into 2 then rejoins            | A/a   |
| daemon        | hooded process icon, face is a single `c` glyph           | b/S   |
| zombieProcess | grey shambler, hunched, one arm forward, dim `s` eyes     | S/B   |
| throttle      | thermal sprite, amber core, heat shimmer rows             | A/a   |
| surge         | jagged bolt creature, red core                            | R/r   |

All enemies face right, feet on rows 13-14, `K` outline, 3-4 colors.

## File format

```
# comments start with # (whole line only)
name: hero                     # must equal the file name (hero.sprite.txt)
size: 16x16                    # WxH, 1..256
palette: bitrouge-20           # must match palette.json name
override: X=#123456            # optional, adds/replaces one char for this file
anim: idle 0,1,2,3 fps=4 loop  # anim: <name> <frames> fps=N [loop]
anim: death 8,9,10 fps=6       # no `loop` = play once

frame 0                        # frames are contiguous 0..n-1
________________               # exactly H rows of exactly W chars
...

frame 1
...
```

- Header lines come first; `frame` blocks follow. Blank lines are ignored.
- Rows contain only palette chars, override chars, or `_`.
- Anim frame indices must exist. `fps` is required. `loop` is optional.
- Fonts only: `chars: 32-126` (codepoint range) or `chars: "abc"` maps frame i
  to a character. See `assets-src/font/font.sprite.txt`.
- Errors report `path:line: message`. Fix the file, do not change the parser.

## Outputs (do not hand-edit)

- `public/assets/gen/sprites.png` + `sprites.json`: Phaser atlas, frame key
  `<name>:<i>`.
- `public/assets/gen/manifest.json`: sizes, frame counts, anims per sprite,
  plus the palette.
- `public/assets/gen/single/<name>.png`: horizontal strip for React `<img>`.
- `public/assets/gen/font.png` + `font.xml`: BitmapText font.
- `src/ui/palette.generated.css`: `--c-K` ... and role aliases.
- `public/assets/gen/contact-sheet.png` (+ `contact-sheet-tiles.png`): QA.

## Workflow

1. Read this file and `palette.json`.
2. Write only your assigned `assets-src/sprites/<name>.sprite.txt` files.
3. `npx tsx scripts/build-sprites.ts --only <name>` until it parses.
4. `npx tsx scripts/contact-sheet.ts --only <name>` and Read the PNG. For
   floors/walls also run `--sheet tiles`.
5. Iterate until the sprite reads at 1x. Then run the full build with no
   `--only` so the atlas contains everything.

## Checklist

- [ ] `name:` equals file name; `size:` correct; `palette: bitrouge-20`.
- [ ] Every row exactly W chars; every frame exactly H rows; frames 0..n-1.
- [ ] Only palette chars and `_`. No override unless approved.
- [ ] 3-4 colors + `K`. One hue family from the theme vocabulary.
- [ ] `K` outline closed around the silhouette (no leaks into the background).
- [ ] Light top-left; darker bottom-right.
- [ ] Faces right. Feet on rows 13-14.
- [ ] Anims declared with fps; loop set on idle/walk; not on death/burst.
- [ ] Silhouette readable at 1x on both `N` and `n` backgrounds.
- [ ] Floors: seamless in the tile sheet; no bright pixels on the edges.
- [ ] Build passes with no `--only`; contact sheet reviewed.
