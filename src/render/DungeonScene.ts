import Phaser from "phaser";
import type { RenderSnapshot } from "../game/renderSnapshot";
import type { RenderBridge } from "./bridge";
import { DEPTH, moveTweenMs, TILE, VIEW_H, VIEW_W } from "./constants";
import { diffEntities, moved, selectNewEvents } from "./diff";
import { EntityView, enemyView, heroView, itemImage } from "./EntityView";
import { EventPlayer } from "./EventPlayer";
import { leakSprite, PayloadView, SiteView } from "./SiteView";
import { TileLayer, frameLookup } from "./TileLayer";
import { createAnims, queueAssets, type RenderAssets } from "./assets/preload";
import { resolveSprite, type FrameLookup } from "./assets/manifest";

export const DUNGEON_SCENE_KEY = "dungeon";

export interface DungeonSceneData {
  bridge: RenderBridge;
  /** Pre-fetched asset manifests (see fetchRenderAssets). */
  assets: RenderAssets;
}

const THROTTLE_TINT = 0xffb066;
const OVERCLOCK_TINT = 0x9fe8ff;
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
  private sites = new Map<number, SiteView>();
  private payloads = new Map<number, PayloadView>();
  private leaks = new Map<number, Phaser.GameObjects.Sprite>();
  private beam: Phaser.GameObjects.Graphics | null = null;
  private speedLines: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
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
    // A kernelPanic floor scramble re-carves tiles at the same depth: rebuild too.
    const floorChanged = newRun || prev.depth !== snap.depth || prev.tiles !== snap.tiles;
    if (newRun) this.lastSeq = -1;

    if (floorChanged) {
      this.rebuild(snap);
    } else {
      this.tiles.updateFog(snap);
      this.syncEntities(prev, snap);
    }
    this.syncWork(floorChanged ? null : prev, snap);

    const fresh = selectNewEvents(snap.events, this.lastSeq);
    this.lastSeq = fresh.lastSeq;
    const enemies = this.dyingEnemies.size
      ? new Map<number, EntityView>([...this.dyingEnemies, ...this.enemies])
      : this.enemies;
    const targets = {
      hero: this.hero,
      enemies,
      sites: this.sites,
      width: snap.width,
      lookup: this.lookup,
    };
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

  /** v2 work layer: sites, payloads, leaks, gate lock, channel beam, overclock. */
  private syncWork(prev: RenderSnapshot | null, snap: RenderSnapshot): void {
    // Sites: persistent per floor; update visuals in place.
    const liveSiteIds = new Set<number>();
    for (const site of snap.sites) {
      liveSiteIds.add(site.id);
      const working = snap.hero.channeling === site.id;
      const view = this.sites.get(site.id);
      if (view) view.update(site, working);
      else this.sites.set(site.id, new SiteView(this, site, this.lookup));
    }
    for (const [id, view] of this.sites) {
      if (!liveSiteIds.has(id)) {
        view.destroy();
        this.sites.delete(id);
      }
    }

    // Payloads.
    const livePayloadIds = new Set<number>();
    for (const p of snap.payloads) {
      livePayloadIds.add(p.id);
      const view = this.payloads.get(p.id);
      if (view) view.update(p);
      else this.payloads.set(p.id, new PayloadView(this, p, this.lookup));
    }
    for (const [id, view] of this.payloads) {
      if (!livePayloadIds.has(id)) {
        view.destroy();
        this.payloads.delete(id);
      }
    }

    // Leak cells (magenta goo overlay).
    const liveLeaks = new Set<number>(snap.leaks);
    for (const index of snap.leaks) {
      if (!this.leaks.has(index)) this.leaks.set(index, leakSprite(this, index, snap.width, this.lookup));
    }
    for (const [index, sprite] of this.leaks) {
      if (!liveLeaks.has(index)) {
        this.tweens.add({ targets: sprite, alpha: 0, scaleY: 0.2, duration: 180, onComplete: () => sprite.destroy() });
        this.leaks.delete(index);
      }
    }

    // Quota gate latch colour.
    if (!prev || prev.stairsLocked !== snap.stairsLocked) this.tiles.setGateLocked(snap.stairsLocked);

    // Overclock: white-hot tint + speed lines while turns remain.
    const overclocked = snap.overclockTurns > 0;
    const wasOverclocked = (prev?.overclockTurns ?? 0) > 0;
    if (this.hero && (overclocked !== wasOverclocked || prev === null || prev.hero.throttled !== snap.hero.throttled)) {
      this.hero.setBaseTint(snap.hero.throttled ? THROTTLE_TINT : overclocked ? OVERCLOCK_TINT : 0xffffff);
    }
    this.setSpeedLines(overclocked);
  }

  /** Speed-line particles trailing the hero while overclocked. */
  private setSpeedLines(on: boolean): void {
    if (on && this.hero) {
      if (!this.speedLines) {
        const ref = resolveSprite("fx_spark", this.lookup);
        if (!ref) return;
        this.speedLines = this.add.particles(0, 0, ref.texture, {
          frame: ref.frame,
          lifespan: 260,
          frequency: 55,
          quantity: 1,
          speed: { min: 8, max: 22 },
          angle: { min: 160, max: 200 },
          alpha: { start: 0.9, end: 0 },
          scale: { start: 0.9, end: 0.2 },
          tint: OVERCLOCK_TINT,
        });
        this.speedLines.setDepth(DEPTH.fx - 1);
      }
      this.speedLines.startFollow(this.hero.sprite, 0, -4);
      this.speedLines.emitting = true;
    } else if (this.speedLines) {
      this.speedLines.emitting = false;
    }
  }

  /** Per-frame: carried payloads ride their carrier; channel beam tracks the hero. */
  update(time: number): void {
    const snap = this.prev;
    if (!snap) return;
    for (const p of snap.payloads) {
      const view = this.payloads.get(p.id);
      if (!view) continue;
      const carrier =
        p.heldBy === "hero" ? this.hero : typeof p.heldBy === "number" ? (this.enemies.get(p.heldBy) ?? null) : null;
      if (carrier) view.follow(carrier, time);
    }
    this.updateBeam(snap, time);
  }

  /** Channeling: pulsing energy beam hero → site plus a soft glow on both ends. */
  private updateBeam(snap: RenderSnapshot, time: number): void {
    const siteId = snap.hero.channeling;
    const site = siteId !== null ? this.sites.get(siteId) : undefined;
    if (siteId === null || !site || !this.hero) {
      if (this.beam) {
        this.beam.destroy();
        this.beam = null;
      }
      return;
    }
    if (!this.beam) this.beam = this.add.graphics().setDepth(DEPTH.fx - 2);
    const g = this.beam;
    const hx = this.hero.sprite.x;
    const hy = this.hero.sprite.y - 4;
    const sx = site.sprite.x;
    const sy = site.sprite.y;
    const pulse = 0.55 + 0.35 * Math.sin(time / 90);
    g.clear();
    g.lineStyle(3, 0x0fbfd8, 0.25);
    g.lineBetween(hx, hy, sx, sy);
    g.lineStyle(1, 0x6ff2ff, pulse);
    g.lineBetween(hx, hy, sx, sy);
    g.fillStyle(0x6ff2ff, 0.18 + 0.1 * pulse);
    g.fillCircle(hx, hy + 4, 7);
    g.fillCircle(sx, sy, 6);
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
    for (const s of this.sites.values()) s.destroy();
    this.sites.clear();
    for (const p of this.payloads.values()) p.destroy();
    this.payloads.clear();
    for (const l of this.leaks.values()) l.destroy();
    this.leaks.clear();
    this.beam?.destroy();
    this.beam = null;
    this.speedLines?.destroy();
    this.speedLines = null;
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
    // Tapping the hero's own cell = context interact (mine/execute/pick up/deliver/GC).
    if (x === this.prev.hero.x && y === this.prev.hero.y) {
      this.bridge.emitCommand({ type: "interact" });
      return;
    }
    this.bridge.emitCellTap(x, y);
  }
}
