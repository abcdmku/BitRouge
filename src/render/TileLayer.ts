import Phaser from "phaser";
import type { RenderSnapshot, TileKindValue } from "../game/renderSnapshot";
import { TileKind } from "../game/renderSnapshot";
import { DEPTH, FOG_REMEMBERED, FOG_UNEXPLORED, FOG_VISIBLE, TEX_TILESET, TILE } from "./constants";
import { resolveSprite, SOURCE_TEXTURE, type FrameLookup, type SemanticKey, type SpriteRef } from "./assets/manifest";
import { getTilesetInfo, type TilesetInfo } from "./assets/preload";
import { applyRef, ensurePlaceholder } from "./EntityView";

const FOG_TEX = "fogpx";
const FOG_GID = 1000;

/** Which semantic tile a cell shows, decided from its neighbours. */
export type GroundTile = "floor" | "floor_cable" | "vent" | "wall_rack" | "wall_top" | "door" | "rock";

export interface Neighbours {
  n: boolean;
  s: boolean;
  e: boolean;
  w: boolean;
  ne: boolean;
  nw: boolean;
  se: boolean;
  sw: boolean;
}

/** Deterministic per-cell hash for variation. */
export function cellHash(x: number, y: number): number {
  return ((x * 73856093) ^ (y * 19349663)) >>> 0;
}

/**
 * Wall autotile for a front-facing top-down look: a wall that has floor to
 * its south (or south-diagonal) shows the rack front; one that only borders
 * floor to the north/sides shows the rack top (cable tray); walls buried in
 * rock draw nothing.
 */
export function pickGroundTile(kind: TileKindValue, nb: Neighbours, hash: number): GroundTile {
  switch (kind) {
    case TileKind.wall: {
      if (nb.s || nb.se || nb.sw) return "wall_rack";
      if (nb.n || nb.e || nb.w || nb.ne || nb.nw) return "wall_top";
      return "rock";
    }
    case TileKind.door:
      return "door";
    case TileKind.stairsDown:
      return "floor";
    default: {
      const r = hash % 100;
      if (r < 6) return "vent";
      if (r < 16) return "floor_cable";
      return "floor";
    }
  }
}

const GROUND_KEY: Record<Exclude<GroundTile, "rock">, SemanticKey> = {
  floor: "tile_floor",
  floor_cable: "tile_floor_cable",
  vent: "tile_vent",
  wall_rack: "tile_wall_rack",
  wall_top: "tile_wall_top",
  door: "tile_door",
};

/**
 * Floor/wall tilemap + fog overlay + hazard/port sprites for one floor.
 *
 * Ground tiles come from the gid tileset built by scripts/pack-tileset.ts
 * (tile frames copied out of the hash atlases). The fog is a second classic
 * layer using a solid 16x16 black texture where each `Tile.alpha` is set per
 * cell; `TilemapGPULayer` has no per-tile alpha so it is not used.
 */
export class TileLayer {
  private map: Phaser.Tilemaps.Tilemap | null = null;
  private ground: Phaser.Tilemaps.TilemapLayer | null = null;
  private fog: Phaser.Tilemaps.TilemapLayer | null = null;
  private overlays: Phaser.GameObjects.Sprite[] = [];
  private lastVisible: readonly boolean[] | null = null;
  private lastExplored: readonly boolean[] | null = null;

  constructor(private scene: Phaser.Scene) {
    if (!scene.textures.exists(FOG_TEX)) {
      const g = scene.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0x000000, 1);
      g.fillRect(0, 0, TILE, TILE);
      g.generateTexture(FOG_TEX, TILE, TILE);
      g.destroy();
    }
    ensurePlaceholder(scene);
  }

  build(snap: RenderSnapshot): void {
    this.destroy();
    const { width, height } = snap;
    const lookup = frameLookup(this.scene);
    const info = getTilesetInfo(this.scene);
    const map = this.scene.make.tilemap({ tileWidth: TILE, tileHeight: TILE, width, height });
    this.map = map;

    const tileset = info ? map.addTilesetImage("tiles", TEX_TILESET, TILE, TILE, 0, 0, info.firstgid) : null;
    const fogset = map.addTilesetImage("fog", FOG_TEX, TILE, TILE, 0, 0, FOG_GID);
    if (!fogset) return;

    const ground = tileset ? map.createBlankLayer("ground", tileset, 0, 0, width, height) : null;
    const fog = map.createBlankLayer("fog", fogset, 0, 0, width, height);
    if (!fog) return;
    ground?.setDepth(DEPTH.floor);
    fog.setDepth(DEPTH.fog);
    this.ground = ground;
    this.fog = fog;

    const isFloor = (x: number, y: number): boolean => {
      if (x < 0 || y < 0 || x >= width || y >= height) return false;
      return snap.tiles[y * width + x] !== TileKind.wall;
    };

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const t = snap.tiles[y * width + x]!;
        const nb: Neighbours = {
          n: isFloor(x, y - 1),
          s: isFloor(x, y + 1),
          e: isFloor(x + 1, y),
          w: isFloor(x - 1, y),
          ne: isFloor(x + 1, y - 1),
          nw: isFloor(x - 1, y - 1),
          se: isFloor(x + 1, y + 1),
          sw: isFloor(x - 1, y + 1),
        };
        const hash = cellHash(x, y);
        const kind = pickGroundTile(t, nb, hash);
        if (ground && info && kind !== "rock") {
          const gid = groundGid(GROUND_KEY[kind], info, lookup, hash >>> 8);
          if (gid !== null) ground.putTileAt(gid, x, y);
          else this.addOverlay(GROUND_KEY[kind], x, y, lookup, DEPTH.floor, hash >>> 8);
        } else if (!ground && kind !== "rock") {
          this.addOverlay(GROUND_KEY[kind], x, y, lookup, DEPTH.floor, hash >>> 8);
        }
        if (t === TileKind.stairsDown) this.addOverlay("port_down", x, y, lookup, DEPTH.hazard);
        const f = fog.putTileAt(FOG_GID, x, y);
        f.alpha = FOG_UNEXPLORED;
      }
    }

    for (const h of snap.hazards) {
      this.addOverlay(`hazard_${h.kind}` as SemanticKey, h.index % width, Math.floor(h.index / width), lookup, DEPTH.hazard);
    }
    this.lastVisible = null;
    this.lastExplored = null;
    this.updateFog(snap);
  }

  /** Animated/static sprite sitting on a cell (hazards, the exit port, or tiles the tileset lacks). */
  private addOverlay(key: SemanticKey, x: number, y: number, lookup: FrameLookup, depth: number, variant = 0): void {
    const ref = resolveSprite(key, lookup, variant);
    const s = this.scene.add.sprite(x * TILE + TILE / 2, y * TILE + TILE / 2, ref?.texture ?? "placeholderpx", ref?.frame);
    applyRef(s, ref);
    s.setDepth(depth);
    const idle = ref?.clips.idle;
    if (idle && this.scene.anims.exists(idle)) s.play(idle);
    this.overlays.push(s);
  }

  updateFog(snap: RenderSnapshot): void {
    const fog = this.fog;
    if (!fog) return;
    if (snap.visible === this.lastVisible && snap.explored === this.lastExplored) return;
    const { width, height } = snap;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const a = snap.visible[i] ? FOG_VISIBLE : snap.explored[i] ? FOG_REMEMBERED : FOG_UNEXPLORED;
        const tile = fog.getTileAt(x, y);
        if (tile && tile.alpha !== a) tile.alpha = a;
      }
    }
    this.lastVisible = snap.visible;
    this.lastExplored = snap.explored;
  }

  destroy(): void {
    for (const s of this.overlays) s.destroy();
    this.overlays = [];
    this.ground?.destroy();
    this.fog?.destroy();
    this.map?.destroy();
    this.ground = null;
    this.fog = null;
    this.map = null;
    this.lastVisible = null;
    this.lastExplored = null;
  }
}

/** gid for a semantic tile, or null when the resolved frame is not in the tileset. */
export function groundGid(key: SemanticKey, info: TilesetInfo, lookup: FrameLookup, variant: number): number | null {
  const ref = resolveSprite(key, lookup, variant);
  if (!ref) return null;
  return tilesetGid(ref, info);
}

export function tilesetGid(ref: SpriteRef, info: TilesetInfo): number | null {
  const name = ref.source === "gen" ? String(ref.frame) : `${ref.source}/${String(ref.frame)}`;
  const gid = info.gids[name];
  return typeof gid === "number" ? gid : null;
}

export function frameLookup(scene: Phaser.Scene): FrameLookup {
  return {
    hasFrame: (texture, frame) => scene.textures.exists(texture) && scene.textures.get(texture).has(String(frame)),
  };
}

export { SOURCE_TEXTURE };
