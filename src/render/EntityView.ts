import Phaser from "phaser";
import type { EntityAnim, RenderEntity, RenderHero, RenderItem } from "../game/renderSnapshot";
import { DEPTH, TILE } from "./constants";
import { resolveSprite, type ClipName, type FrameLookup, type SemanticKey, type SpriteRef } from "./assets/manifest";

export function cellCenter(x: number, y: number): { px: number; py: number } {
  return { px: x * TILE + TILE / 2, py: y * TILE + TILE / 2 };
}

const PLACEHOLDER_TEX = "placeholderpx";

/** Solid magenta square so a missing asset is obvious instead of invisible. */
export function ensurePlaceholder(scene: Phaser.Scene): void {
  if (scene.textures.exists(PLACEHOLDER_TEX)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0xff00ff, 1);
  g.fillRect(2, 2, TILE - 4, TILE - 4);
  g.generateTexture(PLACEHOLDER_TEX, TILE, TILE);
  g.destroy();
}

/**
 * Create a game object for a semantic key, applying the source's tint/alpha
 * and bottom-aligning tall pack sprites to the cell. Returns the ref used
 * (null when the placeholder was drawn).
 */
export function applyRef(obj: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image, ref: SpriteRef | null): void {
  if (!ref) {
    obj.setTexture(PLACEHOLDER_TEX);
    return;
  }
  obj.setTexture(ref.texture, ref.frame);
  if (ref.tint !== 0xffffff) obj.setTint(ref.tint);
  if (ref.alpha !== 1) obj.setAlpha(ref.alpha);
  // Feet on the cell's bottom edge: origin y such that (1-oy)*h == TILE/2 - footOffset.
  const h = obj.height;
  if (h > 0) obj.setOrigin(0.5, 1 - (TILE / 2 - ref.footOffset) / h);
}

/** Sprite wrapper that tweens between cells and plays the source's clips. */
export class EntityView {
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly ref: SpriteRef | null;
  private moveTween: Phaser.Tweens.Tween | null = null;
  private currentAnim: EntityAnim | null = null;
  private baseTint = 0xffffff;
  /** Hero draws above enemies on the same row. */
  private depthBias = 0;

  constructor(
    private scene: Phaser.Scene,
    readonly key: SemanticKey,
    x: number,
    y: number,
    lookup: FrameLookup,
    variant = 0,
  ) {
    ensurePlaceholder(scene);
    this.ref = resolveSprite(key, lookup, variant);
    const { px, py } = cellCenter(x, y);
    this.sprite = scene.add.sprite(px, py, this.ref?.texture ?? PLACEHOLDER_TEX, this.ref?.frame);
    applyRef(this.sprite, this.ref);
    this.baseTint = this.ref?.tint ?? 0xffffff;
    this.sprite.setDepth(DEPTH.entity + py);
  }

  setDepthBias(bias: number): void {
    this.depthBias = bias;
    this.sprite.setDepth(DEPTH.entity + this.sprite.y + bias);
  }

  /** Override the tint (throttle, status). Pass 0xffffff to restore the source tint. */
  setBaseTint(tint: number): void {
    this.baseTint = tint === 0xffffff ? (this.ref?.tint ?? 0xffffff) : tint;
    this.sprite.setTint(this.baseTint);
  }

  get baseTintValue(): number {
    return this.baseTint;
  }

  /** Snap (duration 0) or tween to a cell. */
  moveTo(x: number, y: number, durationMs: number): void {
    const { px, py } = cellCenter(x, y);
    this.moveTween?.stop();
    this.moveTween = null;
    if (durationMs <= 0 || (this.sprite.x === px && this.sprite.y === py)) {
      this.sprite.setPosition(px, py);
      this.sprite.setDepth(DEPTH.entity + py + this.depthBias);
      return;
    }
    this.moveTween = this.scene.tweens.add({
      targets: this.sprite,
      x: px,
      y: py,
      duration: durationMs,
      ease: "Linear",
      onUpdate: () => this.sprite.setDepth(DEPTH.entity + this.sprite.y + this.depthBias),
      onComplete: () => {
        this.sprite.setPosition(px, py);
        this.sprite.setDepth(DEPTH.entity + py + this.depthBias);
        this.moveTween = null;
      },
    });
  }

  setFacing(facing: "l" | "r"): void {
    this.sprite.setFlipX(facing === "l");
  }

  setAnim(anim: EntityAnim): void {
    if (anim === this.currentAnim) return;
    this.currentAnim = anim;
    const clips = this.ref?.clips;
    if (!clips) return;
    // Contract anims -> clip preference order; sources without a clip fall through to idle.
    const order: ClipName[] =
      anim === "walk" ? ["walk", "idle"]
      : anim === "attack" ? ["walk", "idle"]
      : anim === "hurt" ? ["hurt", "idle"]
      : anim === "dead" ? ["dead", "hurt", "idle"]
      : ["idle"];
    for (const c of order) {
      const key = clips[c];
      if (key && this.scene.anims.exists(key)) {
        this.sprite.play(key, true);
        return;
      }
    }
  }

  destroy(): void {
    this.moveTween?.stop();
    this.moveTween = null;
    this.sprite.destroy();
  }
}

export function heroView(scene: Phaser.Scene, hero: RenderHero, lookup: FrameLookup): EntityView {
  const v = new EntityView(scene, "hero", hero.x, hero.y, lookup);
  v.setDepthBias(0.5);
  return v;
}

export function enemyView(scene: Phaser.Scene, e: RenderEntity, lookup: FrameLookup): EntityView {
  return new EntityView(scene, `enemy_${e.kind}` as SemanticKey, e.x, e.y, lookup);
}

/** Items are sprites so icon anims (coin spin) can play; they are not tweened. */
export function itemImage(scene: Phaser.Scene, item: RenderItem, lookup: FrameLookup): Phaser.GameObjects.Sprite {
  ensurePlaceholder(scene);
  const ref = resolveSprite(`item_${item.kind}` as SemanticKey, lookup);
  const { px, py } = cellCenter(item.x, item.y);
  const s = scene.add.sprite(px, py, ref?.texture ?? PLACEHOLDER_TEX, ref?.frame);
  applyRef(s, ref);
  s.setDepth(DEPTH.item);
  const idle = ref?.clips.idle;
  if (idle && scene.anims.exists(idle)) s.play(idle);
  // Gentle bob so pickups read as interactive.
  scene.tweens.add({ targets: s, y: py - 1, duration: 600, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
  return s;
}
