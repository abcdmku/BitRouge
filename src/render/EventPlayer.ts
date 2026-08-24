import Phaser from "phaser";
import type { RunEvent } from "../game/renderSnapshot";
import { DEPTH, TILE } from "./constants";
import { resolveSprite, type FrameLookup } from "./assets/manifest";
import { cellCenter, type EntityView } from "./EntityView";

export interface EventTargets {
  hero: EntityView | null;
  enemies: Map<number, EntityView>;
  lookup: FrameLookup;
}

const TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: '"Press Start 2P", monospace',
  fontSize: "8px",
  color: "#ffffff",
  stroke: "#07080f",
  strokeThickness: 2,
  resolution: 2,
};

const THROTTLE_TINT = 0xffb066;

/** Maps RunEvents to visual effects. Display only; never touches game state. */
export class EventPlayer {
  private pickupEmitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;

  constructor(private scene: Phaser.Scene) {}

  play(ev: RunEvent, t: EventTargets): void {
    switch (ev.kind) {
      case "heroAttacked": {
        const target = t.enemies.get(ev.targetId);
        if (target) this.flash(target, 0xffffff);
        if (t.hero) this.lunge(t.hero, target);
        break;
      }
      case "enemyHurt": {
        const target = t.enemies.get(ev.id);
        if (target) {
          this.flash(target, 0xff5566);
          this.floatText(target.sprite.x, target.sprite.y - 6, `-${ev.damage}`, "#ff7a8a");
        }
        break;
      }
      case "heroHurt": {
        if (t.hero) {
          this.flash(t.hero, 0xff3344);
          this.floatText(t.hero.sprite.x, t.hero.sprite.y - 6, `-${ev.damage}`, "#ff7a8a");
        }
        this.scene.cameras.main.shake(80, 0.004);
        break;
      }
      case "enemyDied": {
        const target = t.enemies.get(ev.id);
        if (target) this.deathFade(target);
        const { px, py } = cellCenter(ev.x, ev.y);
        this.floatText(px, py - 8, `+${trimNumber(ev.credits)}`, "#ffd166");
        break;
      }
      case "heroDied":
        if (t.hero) this.deathFade(t.hero, true);
        this.scene.cameras.main.shake(200, 0.01);
        break;
      case "heroRevived":
        if (t.hero) {
          t.hero.sprite.setAlpha(1).setScale(1).setTint(t.hero.baseTintValue);
          this.flash(t.hero, 0x8cff9a, 250);
        }
        break;
      case "itemPicked": {
        const { px, py } = cellCenter(ev.x, ev.y);
        this.burst(px, py, t.lookup);
        break;
      }
      case "itemUsed":
        if (t.hero) this.flash(t.hero, 0x6ff2ff, 200);
        break;
      case "projectile":
        this.projectile(ev.from, ev.to, t.lookup);
        break;
      case "hazardTriggered": {
        const { px, py } = cellCenter(ev.x, ev.y);
        this.hazardFlash(px, py);
        break;
      }
      case "throttled":
        if (t.hero) t.hero.setBaseTint(ev.on ? THROTTLE_TINT : 0xffffff);
        break;
      case "tripped":
        this.scene.cameras.main.flash(120, 224, 48, 75, true);
        break;
      case "deadlockPenalty":
        if (t.hero) {
          this.floatText(t.hero.sprite.x, t.hero.sprite.y - 10, `-${trimNumber(ev.creditsLost)}cr`, "#ff6bf1");
        }
        break;
      case "descended":
        // The scene has already rebuilt for the new depth; just mask the swap.
        this.scene.cameras.main.fadeIn(180, 7, 8, 15);
        break;
      case "enemySpawned": {
        const target = t.enemies.get(ev.id);
        if (target) {
          target.sprite.setAlpha(0);
          this.scene.tweens.add({ targets: target.sprite, alpha: 1, duration: 160 });
        }
        break;
      }
      case "heroMoved":
      case "enemyMoved":
      case "controlChanged":
        break;
      default:
        break;
    }
  }

  private flash(view: EntityView, tint: number, ms = 90): void {
    // Phaser 4: tint color and tint mode are separate (setTintFill is a no-op).
    view.sprite.setTint(tint).setTintMode(Phaser.TintModes.FILL);
    this.scene.time.delayedCall(ms, () => {
      if (view.sprite.active) view.sprite.setTint(view.baseTintValue).setTintMode(Phaser.TintModes.MULTIPLY);
    });
  }

  private lunge(hero: EntityView, target: EntityView | undefined): void {
    if (!target) return;
    const dx = Math.sign(target.sprite.x - hero.sprite.x);
    const dy = Math.sign(target.sprite.y - hero.sprite.y);
    if (dx === 0 && dy === 0) return;
    const s = hero.sprite;
    const ox = s.x;
    const oy = s.y;
    this.scene.tweens.add({
      targets: s,
      x: ox + dx * 4,
      y: oy + dy * 4,
      duration: 50,
      yoyo: true,
      onComplete: () => s.setPosition(ox, oy),
    });
  }

  private floatText(x: number, y: number, text: string, color: string): void {
    const label = this.scene.add.text(Math.round(x), Math.round(y), text, { ...TEXT_STYLE, color });
    label.setOrigin(0.5, 1).setDepth(DEPTH.fx);
    this.scene.tweens.add({
      targets: label,
      y: y - 12,
      alpha: 0,
      duration: 500,
      ease: "Quad.easeOut",
      onComplete: () => label.destroy(),
    });
  }

  private deathFade(view: EntityView, keep = false): void {
    const s = view.sprite;
    s.setTint(0x888888);
    this.scene.tweens.add({
      targets: s,
      alpha: keep ? 0.3 : 0,
      scaleY: keep ? 1 : 0.6,
      duration: 220,
      ease: "Quad.easeIn",
    });
  }

  private burst(x: number, y: number, lookup: FrameLookup): void {
    if (!this.pickupEmitter) {
      const ref = resolveSprite("fx_spark", lookup);
      if (!ref) return;
      this.pickupEmitter = this.scene.add.particles(0, 0, ref.texture, {
        frame: ref.frame,
        lifespan: 320,
        speed: { min: 20, max: 50 },
        scale: { start: 1, end: 0 },
        alpha: { start: 1, end: 0 },
        tint: ref.tint,
        emitting: false,
      });
      this.pickupEmitter.setDepth(DEPTH.fx);
    }
    this.pickupEmitter.explode(8, x, y);
  }

  private projectile(from: { x: number; y: number }, to: { x: number; y: number }, lookup: FrameLookup): void {
    const ref = resolveSprite("fx_bolt", lookup);
    if (!ref) return;
    const a = cellCenter(from.x, from.y);
    const b = cellCenter(to.x, to.y);
    const img = this.scene.add.sprite(a.px, a.py, ref.texture, ref.frame).setDepth(DEPTH.fx);
    if (ref.tint !== 0xffffff) img.setTint(ref.tint);
    if (ref.clips.idle && this.scene.anims.exists(ref.clips.idle)) img.play(ref.clips.idle);
    img.setRotation(Math.atan2(b.py - a.py, b.px - a.px));
    const dist = Math.hypot(b.px - a.px, b.py - a.py);
    this.scene.tweens.add({
      targets: img,
      x: b.px,
      y: b.py,
      duration: Math.min(220, 40 + dist * 2),
      ease: "Linear",
      onComplete: () => img.destroy(),
    });
  }

  private hazardFlash(x: number, y: number): void {
    const g = this.scene.add.graphics().setDepth(DEPTH.fx);
    g.fillStyle(0xf59e0b, 0.6);
    g.fillRect(x - TILE / 2, y - TILE / 2, TILE, TILE);
    this.scene.tweens.add({ targets: g, alpha: 0, duration: 180, onComplete: () => g.destroy() });
  }

  destroy(): void {
    this.pickupEmitter?.destroy();
    this.pickupEmitter = null;
  }
}

function trimNumber(s: string): string {
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  if (n >= 100) return Math.round(n).toString();
  return n % 1 === 0 ? n.toFixed(0) : n.toFixed(1);
}
