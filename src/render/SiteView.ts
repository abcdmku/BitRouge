import Phaser from "phaser";
import type { RenderSnapshot } from "../game/renderSnapshot";
import { DEPTH } from "./constants";
import { resolveSprite, type FrameLookup } from "./assets/manifest";
import { applyRef, cellCenter, type EntityView } from "./EntityView";

/** Structural aliases so this file tracks the snapshot contract, not type names. */
export type RenderSite = RenderSnapshot["sites"][number];
export type RenderPayload = RenderSnapshot["payloads"][number];

const PLACEHOLDER_TEX = "placeholderpx";
const ARC_RADIUS = 7;

const ARC_COLOR: Record<string, number> = {
  dataNode: 0x6ff2ff,
  jobStation: 0xf5b342,
  ioPort: 0x8cff9a,
};

/**
 * One work site: base sprite + circular progress arc + role motion
 * (§3: data node pulses cyan, job station blinks amber while executed,
 * I/O port lights up when its payload arrives).
 */
export class SiteView {
  readonly sprite: Phaser.GameObjects.Sprite;
  private arc: Phaser.GameObjects.Graphics;
  private pulse: Phaser.Tweens.Tween | null = null;
  private blink: Phaser.Tweens.Tween | null = null;
  private lastState = "";
  private baseTint = 0xffffff;

  constructor(
    private scene: Phaser.Scene,
    site: RenderSite,
    private lookup: FrameLookup,
  ) {
    const { px, py } = cellCenter(site.x, site.y);
    const ref = this.refFor(site);
    this.sprite = scene.add.sprite(px, py, ref?.texture ?? PLACEHOLDER_TEX, ref?.frame);
    applyRef(this.sprite, ref);
    this.baseTint = ref?.tint ?? 0xffffff;
    this.sprite.setDepth(DEPTH.item);
    this.arc = scene.add.graphics().setDepth(DEPTH.item + 1);
    if (site.kind === "dataNode") {
      // Cyan "powered crystal" pulse.
      this.pulse = scene.tweens.add({
        targets: this.sprite,
        alpha: 0.65,
        duration: 800,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    }
    this.update(site, false);
  }

  private applyTint(tint: number): void {
    this.baseTint = tint;
    if (tint === 0xffffff) this.sprite.clearTint();
    else this.sprite.setTint(tint);
  }

  /** Fill-flash then restore the state tint (used by EventPlayer). */
  flash(tint: number, ms = 120): void {
    this.sprite.setTint(tint).setTintMode(Phaser.TintModes.FILL);
    this.scene.time.delayedCall(ms, () => {
      if (!this.sprite.active) return;
      this.sprite.setTintMode(Phaser.TintModes.MULTIPLY);
      this.applyTint(this.baseTint);
    });
  }

  private refFor(site: RenderSite) {
    if (site.kind === "ioPort") {
      // variant 1 = lit (blue button) once the port has been served.
      return resolveSprite("site_ioPort", this.lookup, site.resolved ? 1 : 0);
    }
    return resolveSprite(site.kind === "dataNode" ? "site_dataNode" : "site_jobStation", this.lookup);
  }

  /** Re-sync visuals from the snapshot. `working` = hero is channeling this site this turn. */
  update(site: RenderSite, working: boolean): void {
    const stateKey = `${site.remainingUnits}/${site.totalUnits}/${site.resolved}/${site.corrupted}/${site.squattedBy}/${working}`;
    if (stateKey === this.lastState) return;
    this.lastState = stateKey;

    if (site.kind === "ioPort") {
      const ref = this.refFor(site);
      if (ref) {
        this.sprite.setTexture(ref.texture, ref.frame);
        this.applyTint(site.resolved ? 0x8cff9a : 0xffffff);
      }
    }

    // Resolved sites dim out; corrupted nodes shift magenta; squatted stations sick-green.
    if (site.resolved) {
      this.pulse?.stop();
      this.sprite.setAlpha(site.kind === "ioPort" ? 1 : 0.35);
    } else if (site.kind === "dataNode" && site.corrupted > 0) {
      this.applyTint(0xff6bf1);
    } else if (site.kind === "jobStation" && site.squattedBy !== null) {
      this.applyTint(0xa8ff8c);
    } else if (site.kind === "jobStation") {
      this.applyTint(0xffc266);
    }

    // Amber activity blink while the hero executes a job.
    if (site.kind === "jobStation") {
      if (working && !this.blink) {
        this.blink = this.scene.tweens.add({
          targets: this.sprite,
          alpha: 0.5,
          duration: 160,
          yoyo: true,
          repeat: -1,
        });
      } else if (!working && this.blink) {
        this.blink.stop();
        this.blink = null;
        this.sprite.setAlpha(1);
      }
    }

    this.drawArc(site);
  }

  /** Circular progress arc over the site while work is underway (§ workstream C). */
  private drawArc(site: RenderSite): void {
    this.arc.clear();
    if (site.resolved || site.totalUnits <= 0 || site.remainingUnits >= site.totalUnits) return;
    const frac = Math.min(1, Math.max(0, 1 - site.remainingUnits / site.totalUnits));
    if (frac <= 0) return;
    const { px, py } = cellCenter(site.x, site.y);
    const color = ARC_COLOR[site.kind] ?? 0xffffff;
    this.arc.lineStyle(1.5, 0x07080f, 0.8);
    this.arc.beginPath();
    this.arc.arc(px, py, ARC_RADIUS + 1, 0, Math.PI * 2);
    this.arc.strokePath();
    this.arc.lineStyle(2, color, 0.95);
    this.arc.beginPath();
    this.arc.arc(px, py, ARC_RADIUS, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
    this.arc.strokePath();
  }

  destroy(): void {
    this.pulse?.stop();
    this.blink?.stop();
    this.arc.destroy();
    this.sprite.destroy();
  }
}

/**
 * A payload crate. On the floor it bobs like an item; while carried the scene
 * repositions it over its carrier every frame (`follow`).
 */
export class PayloadView {
  readonly sprite: Phaser.GameObjects.Sprite;
  private bob: Phaser.Tweens.Tween | null = null;
  private carried = false;

  constructor(
    scene: Phaser.Scene,
    payload: RenderPayload,
    lookup: FrameLookup,
    private sceneRef: Phaser.Scene = scene,
  ) {
    const ref = resolveSprite("payload", lookup);
    const { px, py } = cellCenter(payload.x, payload.y);
    this.sprite = scene.add.sprite(px, py, ref?.texture ?? PLACEHOLDER_TEX, ref?.frame);
    applyRef(this.sprite, ref);
    this.sprite.setScale(0.8);
    this.sprite.setDepth(DEPTH.item + 2);
    this.update(payload);
  }

  update(payload: RenderPayload): void {
    const carriedNow = payload.heldBy === "hero" || typeof payload.heldBy === "number";
    if (payload.heldBy === "lost") {
      this.sprite.setVisible(false);
      return;
    }
    this.sprite.setVisible(true);
    if (carriedNow === this.carried && !carriedNow) {
      // still on the floor — keep position in sync (steal drops etc.)
      const { px, py } = cellCenter(payload.x, payload.y);
      if (!this.bob) this.sprite.setPosition(px, py);
      this.ensureBob(py);
      return;
    }
    this.carried = carriedNow;
    if (carriedNow) {
      this.bob?.stop();
      this.bob = null;
      this.sprite.setScale(0.6);
    } else {
      const { px, py } = cellCenter(payload.x, payload.y);
      this.sprite.setScale(0.8);
      this.sprite.setPosition(px, py);
      this.ensureBob(py);
    }
  }

  private ensureBob(py: number): void {
    if (this.bob) return;
    this.bob = this.sceneRef.tweens.add({
      targets: this.sprite,
      y: py - 2,
      duration: 620,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }

  /** Called every frame while carried: ride the carrier with a small bob. */
  follow(carrier: EntityView, timeMs: number): void {
    if (!this.carried) return;
    const bob = Math.sin(timeMs / 180) * 1.5;
    this.sprite.setPosition(carrier.sprite.x + 5, carrier.sprite.y - 9 + bob);
    this.sprite.setDepth(DEPTH.entity + carrier.sprite.y + 1);
  }

  destroy(): void {
    this.bob?.stop();
    this.sprite.destroy();
  }
}

/** Magenta goo overlay for a leak cell. */
export function leakSprite(scene: Phaser.Scene, index: number, width: number, lookup: FrameLookup): Phaser.GameObjects.Sprite {
  const ref = resolveSprite("leak", lookup);
  const { px, py } = cellCenter(index % width, Math.floor(index / width));
  const s = scene.add.sprite(px, py, ref?.texture ?? PLACEHOLDER_TEX, ref?.frame);
  applyRef(s, ref);
  s.setDepth(DEPTH.hazard + 1);
  s.setScale(0);
  scene.tweens.add({ targets: s, scaleX: 1, scaleY: 1, duration: 200, ease: "Back.easeOut" });
  return s;
}
