# Art source decisions

Per semantic sprite key: which source the renderer uses and why. Rule applied:
a pack asset replaces the in-repo (`gen`) sprite only when it is both visibly
better and at least as on-theme (corrupted data center / network stack).

Sources compared:

- `gen`: hand-authored sprites in `assets-src/sprites/*.sprite.txt`, built to
  `public/assets/gen/` by `npm run build:sprites`. 16px, 3-4 colours + outline,
  shaded, animated (hero 11 frames; hazards 2-3; port 4).
- `0x72`: 0x72 Dungeon Tileset II v1.7 (CC0). 16px shaded fantasy dungeon
  sprites, monsters with 4-frame idle + 4-frame run. Stone/wood dungeon tiles.
- `kenney1bit`: Kenney 1-Bit Pack v1.2 (CC0). 1078 single-frame 16px line
  glyphs (some pre-coloured), incl. computers, robots, invaders, medkit, coins.

The manifest (`src/render/assets/manifest.ts`) lists candidates in preference
order; the first loaded one wins, so a missing pack degrades to the next entry.

| Key | Chosen | Frame / clip | Why |
|---|---|---|---|
| `hero` | gen | `hero:0`, clips `hero:idle` / `hero:walk` / `hero:death` | Only source with an on-theme animated protagonist (cyan process-bit robot, 11 frames). 0x72 knight is nicer pixel art but a fantasy knight; Kenney robot glyphs are flat single frames. |
| `tile_floor` | gen | `tile_floor:0..2` | Server-room floor plates, low contrast so characters pop. 0x72 floors are cobblestone (off-theme); Kenney floors are outlines only. |
| `tile_floor_cable` | gen | `tile_floor_cable:0..1` | Cable channel variant, ~10% of floor cells. No pack equivalent. |
| `tile_vent` | gen | `tile_vent:0..1` | Cooling vent variant, ~6% of floor cells. No pack equivalent. |
| `tile_wall_rack` | gen | `tile_wall_rack:0..1` | Server rack front (blinking LEDs). Used for any wall with floor to its south / south-diagonal, and for side walls. 0x72 brick walls are prettier but stone. |
| `tile_wall_top` | gen | `tile_wall_top:0` | Cable-tray cap used for walls that only touch floor to the north/sides (bottom edge of rooms). |
| `tile_door` | gen | `tile_door:0` | Server-room sliding door. 0x72 door is a 32x32 wooden arch (two cells, off-theme). |
| `tile_corrupt` | gen | `tile_corrupt:0..2` | Corrupted floor variant (available for the sim; not placed by the sample map). |
| `port_down` | gen | `port_down:0`, clip `port_down:pulse` | Pulsing data port as the exit. 0x72 `floor_ladder`/`floor_stairs` are stone stairs. |
| `fx_hit` / `fx_spark` / `fx_bolt` | gen | `fx_*:0`, clips `fx_hit:burst`, `fx_bolt:fly` | On-theme cyan/amber effects, sized for 16px cells. |
| `hazard_hotTile` | gen | clip `hazard_hotTile:shimmer` | Orange heat-vent plate, animated. 0x72 has only spikes/lava-less; Kenney has static warning glyphs. |
| `hazard_overloadPlate` | gen | clip `hazard_overloadPlate:arc` | Arcing pressure plate, animated. 0x72 `floor_spikes` is a spike trap (off-theme). |
| `hazard_corruptedSector` | gen | clip `hazard_corruptedSector:glitch` | Magenta glitch blob, animated. No pack equivalent. |
| `hazard_brownout` | gen | clip `hazard_brownout:flicker` | Flickering dark plate, animated. No pack equivalent. |
| `enemy_bitFlip` | kenney1bit (fallback 0x72 `tiny_zombie`) | idx 366/367, clip `k1:invader`, tint `#8cff9a` | gen has no enemies. The space-invader glyph is the archetypal "bug"; two sheet frames make a 2-frame idle. Green tint. |
| `enemy_nullPointer` | 0x72 | `angel_idle_anim_f0`, clips `0x72:angel_idle` / `angel_run`, tint `#9fd8ff`, alpha 0.75 | Pale floating figure, drawn translucent to read as a dangling/empty reference. |
| `enemy_memoryLeak` | 0x72 | `swampy_anim_f0`, clip `0x72:swampy`, tint `#7dffb0` | Green ooze blob, animated; reads as a leak that spreads. |
| `enemy_deadlock` | 0x72 | `skelet_idle_anim_f0`, clips `0x72:skelet_idle` / `skelet_run`, tint `#ff9a7a` | Skeleton tinted red-orange: a stuck, locked-up thing. Stationary in the sim so the idle loop is what you see. |
| `enemy_forkBomb` | 0x72 | `goblin_idle_anim_f0`, clips `0x72:goblin_idle` / `goblin_run`, tint `#ffc266` | Small swarming goblin, amber tint; fork bombs multiply. |
| `enemy_daemon` | 0x72 | `chort_idle_anim_f0`, clips `0x72:chort_idle` / `chort_run`, tint `#d48cff` | Little devil = the BSD daemon mascot, purple tint. Best pun-to-pixels ratio in the pack. |
| `enemy_zombieProcess` | 0x72 | `zombie_anim_f0`, clip `0x72:zombie`, tint `#a8ff8c` | A zombie process is a zombie. Green tint. |
| `item_patch` | kenney1bit | idx 582 (red medkit) | Reads as "heal" instantly; gen has no items; 0x72 flasks are fantasy potions. |
| `item_hotfix` | kenney1bit | idx 529 (red heart) | Bigger heal; heart is the universal glyph. |
| `item_cacheLine` | kenney1bit | idx 631..635, clip `k1:coin` | Currency pickup; the sheet has a 5-frame spinning coin. |
| `item_heatsink` | kenney1bit | idx 575 (snowflake), tint `#6ff2ff` | Cooling item, cyan snowflake. |
| `item_checkpoint` | kenney1bit | idx 414 (flag), tint `#6ff2ff` | Save-point flag. |
| `item_coreDump` | kenney1bit | idx 577 (skull), tint `#d8e1f2` | A core dump is what is left after a crash. |

Rejected for everything: Kenney Tiny Dungeon (previous fallback). Fantasy
dungeon, static, and lower detail than both alternatives; the files stay in
`public/assets/packs/kenney-tiny-dungeon/` but nothing loads them.

## Known weaknesses

- The 0x72 monsters are fantasy art with a colour multiply on top. Tinting
  makes them read as "glitched creatures" but they are still zombies and
  goblins; a proper set of software-fault enemies in the gen style would be
  better and should replace them one by one as they get authored.
- Kenney items are 1-bit glyphs next to shaded sprites. They are readable but
  flat; the bob tween helps them feel like pickups.
- Walls are one cell thick with no vertical side piece in the gen set, so side
  walls also show rack fronts. It reads fine top-down but is not true 3/4 view.
