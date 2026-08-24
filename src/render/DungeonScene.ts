import Phaser from "phaser";
import type { RenderSnapshot } from "../game/renderSnapshot";
import type { RenderBridge } from "./bridge";
import { moveTweenMs, TILE, VIEW_H, VIEW_W } from "./constants";
import { diffEntities, moved, selectNewEvents } from "./diff";
import { EntityView, enemyView, heroView, itemImage } from "./EntityView";
import { EventPlayer } from "./EventPlayer";
import { TileLayer, frameLookup } from "./TileLayer";
import { createAnims, queueAssets, type RenderAssets } from "./assets/preload";
import type { FrameLookup } from "./assets/manifest";

export const DUNGEON_SCENE_KEY = "dungeon";

export interface DungeonSceneData {
  bridge: RenderBridge;
  /** Pre-fetched asset manifests (see fetchRenderAssets). */
  assets: RenderAssets;
}

const THROTTLE_TINT = 0xffb066;
const DEATH_LINGER_MS = 260;

/**
 * Display-only scene. Pulls snapshots from the bridge, diffs them against the
 * last one, and drives sprites/tweens/effects. Zero game logic.
 */
export class DungeonScene extends Phaser.Scene {
  private bridge!: RenderBridge;
  private assets: RenderAssets = { gen: null };
  private lookup!: FrameLookup;
  private tiles!: TileLayer;
  private fx!: EventPlayer;
  private hero: EntityView | null = null;
  private enemies = new Map<number, EntityView>();
  private items = new Map<number, Phaser.GameObjects.Image>();
  private prev: RenderSnapshot | null = null;
  private lastSeq = -1;
  private pending: RenderSnapshot | null = null;
  private ready = false;
  private unsubscribe: (() => void) | null = null;

  constructor() {
    super({ key: DUNGEON_SCENE_KEY });
  }

  init(data: DungeonSceneData): void {
    this.bridge = data.bridge;
    this.assets = data.assets ?? { gen: null };
  }

  preload(): void {
    queueAssets(this, this.assets);
  }

  create(): void {
    this.lookup = frameLookup(this);
    createAnims(this, this.assets);
    this.tiles = new TileLayer(this);
    this.fx = new EventPlayer(this);

    const cam = this.cameras.main;
    cam.setRoundPixels(true);
    cam.setSize(VIEW_W, VIEW_H);

    this.input.on(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);
    this.events.once(Phaser.Scenes.Events.DESTROY, this.onShutdown, this);

    this.ready = true;
    const queued = this.pending ?? this.bridge.peekSnapshot();
    this.pending = null;
    this.unsubscribe = this.bridge.onSnapshot((snap) => this.applySnapshot(snap));
    if (queued && !this.prev) this.applySnapshot(queued);
  }

  private onShutdown(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.clearEntities();
    this.tiles?.destroy();
    this.fx?.destroy();
    this.prev = null;
    this.ready = false;
  }

  applySnapshot(snap: RenderSnapshot | null): void {
    if (!this.ready) {
      this.pending = snap;
      return;
    }
    if (!snap) {
      this.clearEntities();
      this.tiles.destroy();
      this.prev = null;
      this.lastSeq = -1;
      return;
    }
    const prev = this.prev;
    const newRun = !prev || prev.runId !== snap.runId;
    const floorChanged = newRun || prev.depth !== snap.depth;
    if (newRun) this.lastSeq = -1;

    if (floorChanged) {
      this.rebuild(snap);
    } else {
      this.tiles.updateFog(snap);
      this.syncEntities(prev, snap);
    }

    const fresh = selectNewEvents(snap.events, this.lastSeq);
    this.lastSeq = fresh.lastSeq;
    const enemies = this.dyingEnemies.size
      ? new Map<number, EntityView>([...this.dyingEnemies, ...this.enemies])
      : this.enemies;
    const targets = { hero: this.hero, enemies, lookup: this.lookup };
    for (const ev of fresh.events) {
      // On a brand-new run, old ring-buffer events refer to sprites that no longer exist.
      if (newRun && ev.kind !== "descended") continue;
      this.fx.play(ev, targets);
    }
    this.prev = snap;
  }

  private rebuild(snap: RenderSnapshot): void {
    this.clearEntities();
    this.tiles.build(snap);
    this.cameras.main.setBounds(0, 0, snap.width * TILE, snap.height * TILE);
    this.hero = heroView(this, snap.hero, this.lookup);
    this.hero.setFacing(snap.hero.facing);
    this.hero.setAnim(snap.hero.anim);
    if (snap.hero.throttled) this.hero.setBaseTint(THROTTLE_TINT);
    for (const e of snap.entities) this.addEnemy(e.id, e);
    for (const it of snap.items) this.items.set(it.id, itemImage(this, it, this.lookup));
    const cam = this.cameras.main;
    cam.stopFollow();
    cam.centerOn(this.hero.sprite.x, this.hero.sprite.y);
    cam.startFollow(this.hero.sprite, true, 0.15, 0.15);
  }

  private addEnemy(id: number, e: RenderSnapshot["entities"][number]): void {
    const v = enemyView(this, e, this.lookup);
    v.setFacing(e.facing);
    v.setAnim(e.anim);
    this.enemies.set(id, v);
  }

  private syncEntities(prev: RenderSnapshot, snap: RenderSnapshot): void {
    const ms = moveTweenMs(snap.msPerTurn);
    if (this.hero) {
      if (moved(prev.hero, snap.hero)) this.hero.moveTo(snap.hero.x, snap.hero.y, ms);
      this.hero.setFacing(snap.hero.facing);
      this.hero.setAnim(snap.hero.anim);
      if (prev.hero.throttled !== snap.hero.throttled) {
        this.hero.setBaseTint(snap.hero.throttled ? THROTTLE_TINT : 0xffffff);
      }
    }

    const d = diffEntities(prev.entities, snap.entities);
    for (const id of d.removed) {
      const v = this.enemies.get(id);
      if (!v) continue;
      this.enemies.delete(id);
      // Keep the sprite briefly so the enemyDied fade (played right after) has a target.
      const dying = v;
      this.dyingEnemies.set(id, dying);
      this.time.delayedCall(DEATH_LINGER_MS, () => {
        this.dyingEnemies.delete(id);
        dying.destroy();
      });
    }
    for (const e of d.added) this.addEnemy(e.id, e);
    for (const { prev: p, next } of d.updated) {
      const v = this.enemies.get(next.id);
      if (!v) continue;
      if (moved(p, next)) v.moveTo(next.x, next.y, ms);
      v.setFacing(next.facing);
      v.setAnim(next.anim);
    }

    const di = diffEntities(prev.items, snap.items);
    for (const id of di.removed) {
      this.items.get(id)?.destroy();
      this.items.delete(id);
    }
    for (const it of di.added) this.items.set(it.id, itemImage(this, it, this.lookup));
  }

  /** Enemies removed from the snapshot but still fading out. Event lookups check both maps. */
  private dyingEnemies = new Map<number, EntityView>();

  private clearEntities(): void {
    this.hero?.destroy();
    this.hero = null;
    for (const v of this.enemies.values()) v.destroy();
    this.enemies.clear();
    for (const v of this.dyingEnemies.values()) v.destroy();
    this.dyingEnemies.clear();
    for (const i of this.items.values()) i.destroy();
    this.items.clear();
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    if (!this.prev) return;
    // Ignore drags; swipes are handled by React's useSwipe on the container.
    const dx = pointer.upX - pointer.downX;
    const dy = pointer.upY - pointer.downY;
    if (Math.hypot(dx, dy) > 10) return;
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const x = Math.floor(world.x / TILE);
    const y = Math.floor(world.y / TILE);
    if (x < 0 || y < 0 || x >= this.prev.width || y >= this.prev.height) return;
    if (!this.prev.explored[y * this.prev.width + x]) return;
    this.bridge.emitCellTap(x, y);
  }
}
