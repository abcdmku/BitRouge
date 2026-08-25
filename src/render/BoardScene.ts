import Phaser from "phaser";
import type { FxEvent, RenderCommand, RenderSnapshot } from "../game/renderSnapshot";
import type { ComponentKind, Dir, TaskKind } from "../game/types";
import { resolveSprite, type FrameLookup, type SemanticKey, type SpriteRef } from "./assets/manifest";
import { createAnims, queueAssets, type RenderAssets } from "./assets/preload";
import { brownoutAlpha, heatOverlayAlpha, isBrownoutActive, resolveTap, type TapSocket } from "./boardHelpers";
import type { RenderBridge } from "./bridge";
import { BOARD_ROWS_MAX, DEPTH, LONG_PRESS_MS, TILE, VIEW_H, VIEW_W, packetTweenMs } from "./constants";
import { diffEntities, selectNewEvents } from "./diff";

export const BOARD_SCENE_KEY = "board";

export interface BoardSceneData {
  bridge: RenderBridge;
  /** Pre-fetched asset manifest (see fetchRenderAssets). */
  assets: RenderAssets;
}

const PLACEHOLDER_TEX = "placeholderpx";

/** trace_arrow is authored pointing east; rotate it per socket dir. */
const DIR_ROTATION: Record<Dir, number> = {
  N: -Math.PI / 2,
  E: 0,
  S: Math.PI / 2,
  W: Math.PI,
};

const TASK_TINT: Record<TaskKind, number> = {
  bulk: 0xffffff,
  crunch: 0x8cff9a,
  hot: 0xffd166,
  priority: 0xff7a8a,
};

const DIM_TINT = 0x6a7398;
const HEAT_TINT = 0xff3344;
const BROWNOUT_TINT = 0xe0304b;
const LOCKED_ALPHA = 0.5;

const VALUE_TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: '"Press Start 2P", monospace',
  fontSize: "8px",
  color: "#ffd166",
  stroke: "#07080f",
  strokeThickness: 2,
  resolution: 2,
};

const COST_TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: '"Press Start 2P", monospace',
  fontSize: "6px",
  color: "#8a9bbd",
  resolution: 2,
};

function frameLookup(scene: Phaser.Scene): FrameLookup {
  return {
    hasFrame: (texture, frame) => scene.textures.exists(texture) && scene.textures.get(texture).has(frame),
  };
}

function ensurePlaceholder(scene: Phaser.Scene): void {
  if (scene.textures.exists(PLACEHOLDER_TEX)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0xff00ff, 1);
  g.fillRect(2, 2, TILE - 4, TILE - 4);
  g.generateTexture(PLACEHOLDER_TEX, TILE, TILE);
  g.destroy();
}

/** A packet: a small glowing dot tinted by task kind, tweened hop-by-hop. */
class PacketVisual {
  readonly sprite: Phaser.GameObjects.Sprite;
  private tween: Phaser.Tweens.Tween | null = null;

  constructor(
    private scene: Phaser.Scene,
    ref: SpriteRef | null,
    px: number,
    py: number,
    tint: number,
  ) {
    this.sprite = scene.add.sprite(px, py, ref?.texture ?? PLACEHOLDER_TEX, ref?.frame).setDepth(DEPTH.packet);
    this.sprite.setTint(tint);
    if (ref?.idle && scene.anims.exists(ref.idle)) this.sprite.play(ref.idle);
  }

  moveTo(px: number, py: number, durationMs: number): void {
    this.tween?.stop();
    this.tween = null;
    if (durationMs <= 0) {
      this.sprite.setPosition(px, py);
      return;
    }
    this.tween = this.scene.tweens.add({
      targets: this.sprite,
      x: px,
      y: py,
      duration: durationMs,
      ease: "Linear",
      onComplete: () => {
        this.sprite.setPosition(px, py);
        this.tween = null;
      },
    });
  }

  destroy(): void {
    this.tween?.stop();
    this.sprite.destroy();
  }
}

/**
 * Display-only scene: draws the SOLDER board from a `RenderSnapshot`, resolves
 * taps/long-presses to bridge events, and plays fx from the sim's event ring.
 * Zero game logic. The backlog strip and HUD numbers are NOT drawn here —
 * they live in the HUD region above the canvas (WS3), reading the same
 * snapshot the caller already has.
 */
export class BoardScene extends Phaser.Scene {
  private bridge!: RenderBridge;
  private assets: RenderAssets = { gen: null };
  private lookup!: FrameLookup;
  private prev: RenderSnapshot | null = null;
  private lastEventSeq = -1;
  private pending: RenderSnapshot | null = null;
  private ready = false;
  private unsubscribeSnapshot: (() => void) | null = null;
  private unsubscribePlaceMode: (() => void) | null = null;
  private placeMode: ComponentKind | null = null;

  private offsetY = 0;

  private base: (Phaser.GameObjects.Sprite | null)[] = [];
  private content: (Phaser.GameObjects.Sprite | null)[] = [];
  private contentKey: (string | null)[] = [];
  private shimmer: (Phaser.GameObjects.Sprite | null)[] = [];
  private faultFx: (Phaser.GameObjects.Sprite | null)[] = [];
  private costText: (Phaser.GameObjects.Text | null)[] = [];
  private heatGraphics!: Phaser.GameObjects.Graphics;
  private brownoutOverlay!: Phaser.GameObjects.Graphics;
  private brownoutBadge!: Phaser.GameObjects.Sprite;
  private deliveryFx: Phaser.GameObjects.Sprite[] = [];

  private packets = new Map<number, PacketVisual>();

  private lastApplyAtMs = 0;
  private lastTweenMs = 425;

  private pointerDownIndex = -1;
  private longPressTimer: Phaser.Time.TimerEvent | null = null;

  constructor() {
    super({ key: BOARD_SCENE_KEY });
  }

  init(data: BoardSceneData): void {
    this.bridge = data.bridge;
    this.assets = data.assets ?? { gen: null };
  }

  preload(): void {
    queueAssets(this, this.assets);
  }

  create(): void {
    ensurePlaceholder(this);
    this.lookup = frameLookup(this);
    createAnims(this, this.assets);

    const cam = this.cameras.main;
    cam.setRoundPixels(true);
    cam.setSize(VIEW_W, VIEW_H);
    cam.setBounds(0, 0, VIEW_W, VIEW_H);

    this.heatGraphics = this.add.graphics().setDepth(DEPTH.heatOverlay);
    this.brownoutOverlay = this.add
      .graphics()
      .fillStyle(BROWNOUT_TINT, 1)
      .fillRect(0, 0, VIEW_W, VIEW_H)
      .setDepth(DEPTH.fx - 1)
      .setAlpha(0);
    this.brownoutBadge = this.spawnSprite("hazard_brownout", TILE / 2, TILE / 2, DEPTH.fx - 1);
    this.brownoutBadge.setVisible(false);

    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    this.input.on(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);
    this.events.once(Phaser.Scenes.Events.DESTROY, this.onShutdown, this);

    this.ready = true;
    const queued = this.pending ?? this.bridge.peekSnapshot();
    this.pending = null;
    this.unsubscribeSnapshot = this.bridge.onSnapshot((snap) => this.applySnapshot(snap));
    this.unsubscribePlaceMode = this.bridge.onPlaceMode((mode) => {
      this.placeMode = mode;
    });
    if (queued && !this.prev) this.applySnapshot(queued);
  }

  private onShutdown(): void {
    this.unsubscribeSnapshot?.();
    this.unsubscribeSnapshot = null;
    this.unsubscribePlaceMode?.();
    this.unsubscribePlaceMode = null;
    this.longPressTimer?.remove();
    this.longPressTimer = null;
    this.clearBoard();
    this.prev = null;
    this.ready = false;
  }

  applySnapshot(snap: RenderSnapshot | null): void {
    if (!this.ready) {
      this.pending = snap;
      return;
    }
    if (!snap) {
      this.clearBoard();
      this.prev = null;
      this.lastEventSeq = -1;
      return;
    }
    const prev = this.prev;
    const newRun = !!prev && snap.uptimeMs < prev.uptimeMs;
    const dimsChanged = !prev || prev.boardWidth !== snap.boardWidth || prev.boardHeight !== snap.boardHeight;
    const structuralChange = dimsChanged || newRun;
    const skipFx = !prev || newRun;

    const now = this.time.now;
    if (prev) this.lastTweenMs = packetTweenMs(Phaser.Math.Clamp(now - this.lastApplyAtMs, 80, 2000));
    this.lastApplyAtMs = now;

    if (structuralChange) this.rebuildStructure(snap);
    if (newRun) this.lastEventSeq = -1;

    const baseline = skipFx ? snap.lastEventSeq : this.lastEventSeq;
    const fresh = selectNewEvents(snap.events, baseline);
    this.lastEventSeq = fresh.lastSeq;

    const moveHints = new Map<number, { from: number | null; to: number }>();
    for (const ev of fresh.events) if (ev.kind === "packetMoved") moveHints.set(ev.id, { from: ev.from, to: ev.to });

    this.drawHeatOverlay(snap);
    for (const socket of snap.sockets) this.updateSocket(socket, structuralChange);
    this.syncPackets(prev, snap, structuralChange, moveHints);

    for (const ev of fresh.events) this.playFx(ev, snap);
    this.prev = snap;
  }

  // ---- structure ------------------------------------------------------------

  private rebuildStructure(snap: RenderSnapshot): void {
    this.clearBoard();
    this.offsetY = (BOARD_ROWS_MAX - snap.boardHeight) * TILE;
    // Anchor to the board's actual top-left cell, not the fixed canvas
    // corner: on a 5x7 board the top row sits `offsetY` px down, and a
    // canvas-corner badge would float in the dead strip above it.
    this.brownoutBadge.setPosition(TILE / 2, this.offsetY + TILE / 2);
    const n = snap.boardWidth * snap.boardHeight;
    this.base = new Array(n).fill(null);
    this.content = new Array(n).fill(null);
    this.contentKey = new Array(n).fill(null);
    this.shimmer = new Array(n).fill(null);
    this.faultFx = new Array(n).fill(null);
    this.costText = new Array(n).fill(null);

    for (const socket of snap.sockets) {
      const { px, py } = this.cellCenter(socket.x, socket.y);
      this.base[socket.index] = this.spawnSprite(socket.isPort ? "port" : "board_tile", px, py, DEPTH.board);
      const shimmer = this.spawnSprite("hazard_hotTile", px, py, DEPTH.fault);
      shimmer.setVisible(false);
      this.shimmer[socket.index] = shimmer;
      const fault = this.spawnSprite("hazard_corruptedSector", px, py, DEPTH.fault + 0.5);
      fault.setVisible(false);
      this.faultFx[socket.index] = fault;
    }
  }

  private clearBoard(): void {
    for (const s of this.base) s?.destroy();
    for (const s of this.content) s?.destroy();
    for (const s of this.shimmer) s?.destroy();
    for (const s of this.faultFx) s?.destroy();
    for (const t of this.costText) t?.destroy();
    this.base = [];
    this.content = [];
    this.contentKey = [];
    this.shimmer = [];
    this.faultFx = [];
    this.costText = [];
    for (const v of this.packets.values()) v.destroy();
    this.packets.clear();
    this.heatGraphics?.clear();
  }

  // ---- sockets ----------------------------------------------------------------

  private updateSocket(socket: RenderSnapshot["sockets"][number], force: boolean): void {
    const i = socket.index;
    const { px, py } = this.cellCenter(socket.x, socket.y);

    let key: string | null = null;
    let semantic: SemanticKey | null = null;
    if (socket.isPort) {
      key = null;
    } else if (!socket.unlocked) {
      key = "locked";
      semantic = "socket_locked";
    } else if (socket.component) {
      key = `chip:${socket.component.kind}`;
      semantic = `chip_${socket.component.kind}` as SemanticKey;
    } else {
      key = `arrow:${socket.dir}`;
      semantic = "trace_arrow";
    }

    if (force || this.contentKey[i] !== key) {
      this.content[i]?.destroy();
      this.content[i] = null;
      if (semantic) {
        const s = this.spawnSprite(semantic, px, py, DEPTH.socket);
        if (semantic === "trace_arrow") s.setRotation(DIR_ROTATION[socket.dir]);
        if (semantic === "socket_locked") s.setAlpha(LOCKED_ALPHA); // a wall of identical padlocks reads heavy; dim it so unlocked area pops
        this.content[i] = s;
      }
      this.contentKey[i] = key;
    }

    // Powered vs unpowered (dim).
    const chip = this.content[i];
    if (chip && socket.component) {
      const dim = !socket.component.powered;
      chip.setAlpha(dim ? 0.45 : 1);
      chip.setTint(dim ? DIM_TINT : 0xffffff);
    }

    // Locked cost label.
    if (socket.unlockCostLabel) {
      const existing = this.costText[i];
      if (existing) existing.setText(socket.unlockCostLabel);
      else this.costText[i] = this.add.text(px, py + 5, socket.unlockCostLabel, COST_TEXT_STYLE).setOrigin(0.5).setDepth(DEPTH.socket + 1);
    } else if (this.costText[i]) {
      this.costText[i]?.destroy();
      this.costText[i] = null;
    }

    // Throttle shimmer + fault glitch overlays.
    this.shimmer[i]?.setVisible(socket.throttled && !socket.isPort);
    this.faultFx[i]?.setVisible(!!socket.component?.faulted);
  }

  private drawHeatOverlay(snap: RenderSnapshot): void {
    const g = this.heatGraphics;
    g.clear();
    for (const socket of snap.sockets) {
      const a = heatOverlayAlpha(socket.heat);
      if (a <= 0) continue;
      const { px, py } = this.cellCenter(socket.x, socket.y);
      g.fillStyle(HEAT_TINT, a);
      g.fillRect(px - TILE / 2, py - TILE / 2, TILE, TILE);
    }
  }

  // ---- packets ----------------------------------------------------------------

  private syncPackets(
    prev: RenderSnapshot | null,
    snap: RenderSnapshot,
    structuralChange: boolean,
    moveHints: Map<number, { from: number | null; to: number }>,
  ): void {
    if (structuralChange) {
      for (const v of this.packets.values()) v.destroy();
      this.packets.clear();
    }
    const prevPackets = structuralChange ? [] : (prev?.packets ?? []);
    const d = diffEntities(prevPackets, snap.packets);
    for (const id of d.removed) {
      this.packets.get(id)?.destroy();
      this.packets.delete(id);
    }
    for (const p of d.added) this.packets.set(p.id, this.spawnPacket(p, snap, moveHints.get(p.id)));
    for (const { prev: prevPacket, next } of d.updated) {
      const v = this.packets.get(next.id);
      if (!v) continue;
      if (prevPacket.socketIndex !== next.socketIndex) {
        const { px, py } = this.indexCenter(snap, next.socketIndex);
        v.moveTo(px, py, this.lastTweenMs);
      }
    }
  }

  private spawnPacket(
    p: RenderSnapshot["packets"][number],
    snap: RenderSnapshot,
    hint: { from: number | null; to: number } | undefined,
  ): PacketVisual {
    const target = this.indexCenter(snap, p.socketIndex);
    const origin = hint?.from != null ? this.indexCenter(snap, hint.from) : target;
    const ref = resolveSprite("fx_packet", this.lookup);
    const v = new PacketVisual(this, ref, origin.px, origin.py, TASK_TINT[p.taskKind]);
    if (hint?.from != null) v.moveTo(target.px, target.py, this.lastTweenMs);
    return v;
  }

  // ---- fx ----------------------------------------------------------------------

  private playFx(ev: FxEvent, snap: RenderSnapshot): void {
    switch (ev.kind) {
      case "packetDelivered": {
        const { px, py } = this.indexCenter(snap, ev.socketIndex);
        this.burst(px, py);
        this.floatText(px, py - 6, `+${ev.valueLabel}`, ev.manual ? "#ffd166" : "#8cff9a");
        break;
      }
      case "packetDropped": {
        const { px, py } = this.indexCenter(snap, ev.socketIndex);
        this.floatText(px, py - 6, "DROP", "#ff7a8a");
        this.cellFlash(px, py, 0xff5566);
        break;
      }
      case "faultSpawned": {
        const { px, py } = this.indexCenter(snap, ev.index);
        this.cellFlash(px, py, 0xc026d3);
        break;
      }
      case "faultPatched": {
        const { px, py } = this.indexCenter(snap, ev.index);
        this.cellFlash(px, py, 0x22c55e);
        break;
      }
      case "faultSpread": {
        const { px, py } = this.indexCenter(snap, ev.to);
        this.cellFlash(px, py, 0xc026d3);
        this.cameras.main.shake(90, 0.003);
        break;
      }
      case "workTap":
        this.workPop(ev.index);
        break;
      case "crash":
        this.crashBurst();
        break;
      // packetMoved is played as the packet's own tween (syncPackets); taskArrived/
      // taskDropped/chipPlaced/brownout/throttle already read straight from state
      // (backlog strip and socket visuals are not in-canvas / already synced).
      default:
        break;
    }
  }

  private workPop(index: number): void {
    const target = this.content[index] ?? this.base[index];
    if (!target) return;
    target.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    this.tweens.add({
      targets: target,
      scale: 1.3,
      duration: 70,
      yoyo: true,
      onComplete: () => {
        if (!target.active) return;
        target.setTintMode(Phaser.TintModes.MULTIPLY);
        const socket = this.prev?.sockets[index];
        if (socket) this.updateSocket(socket, false);
      },
    });
  }

  private burst(px: number, py: number): void {
    const ref = resolveSprite("fx_delivery", this.lookup);
    if (!ref) return;
    const s = this.add.sprite(px, py, ref.texture, ref.frame).setDepth(DEPTH.fx);
    this.deliveryFx.push(s);
    if (ref.idle && this.anims.exists(ref.idle)) {
      s.play(ref.idle);
      s.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
        this.deliveryFx = this.deliveryFx.filter((d) => d !== s);
        s.destroy();
      });
    } else {
      this.time.delayedCall(200, () => {
        this.deliveryFx = this.deliveryFx.filter((d) => d !== s);
        s.destroy();
      });
    }
  }

  private crashBurst(): void {
    this.cameras.main.flash(260, 224, 48, 75, true);
    this.cameras.main.shake(220, 0.01);
    const ref = resolveSprite("fx_crash", this.lookup);
    if (!ref) return;
    const s = this.add.sprite(VIEW_W / 2, VIEW_H / 2, ref.texture, ref.frame).setDepth(DEPTH.fx).setScale(2);
    if (ref.idle && this.anims.exists(ref.idle)) s.play(ref.idle);
    this.tweens.add({ targets: s, alpha: 0, duration: 600, delay: 150, onComplete: () => s.destroy() });
  }

  private floatText(x: number, y: number, text: string, color: string): void {
    const label = this.add
      .text(Math.round(x), Math.round(y), text, { ...VALUE_TEXT_STYLE, color })
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.fx);
    this.tweens.add({ targets: label, y: y - 12, alpha: 0, duration: 500, ease: "Quad.easeOut", onComplete: () => label.destroy() });
  }

  private cellFlash(x: number, y: number, color: number): void {
    const g = this.add.graphics().setDepth(DEPTH.fx);
    g.fillStyle(color, 0.55);
    g.fillRect(x - TILE / 2, y - TILE / 2, TILE, TILE);
    this.tweens.add({ targets: g, alpha: 0, duration: 220, onComplete: () => g.destroy() });
  }

  // ---- input --------------------------------------------------------------------

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (!this.prev) return;
    const index = this.indexAt(pointer.x, pointer.y);
    if (index === null) return;
    const socket = this.prev.sockets[index];
    if (!socket || socket.isPort) return;
    this.pointerDownIndex = index;
    this.longPressTimer?.remove();
    this.longPressTimer = this.time.delayedCall(LONG_PRESS_MS, () => {
      if (this.pointerDownIndex === index) {
        this.bridge.emitPopover(index);
        this.pointerDownIndex = -1;
      }
    });
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    this.longPressTimer?.remove();
    this.longPressTimer = null;
    if (!this.prev) return;
    const dx = pointer.upX - pointer.downX;
    const dy = pointer.upY - pointer.downY;
    const index = this.pointerDownIndex;
    this.pointerDownIndex = -1;
    if (index < 0) return; // consumed by long-press, or the down never hit a workable socket
    if (Math.hypot(dx, dy) > 10) return; // drag, not a tap
    const socket = this.prev.sockets[index];
    if (!socket) return;
    const tapSocket: TapSocket = { index, unlocked: socket.unlocked, lit: socket.lit, hasComponent: !!socket.component };
    const result = resolveTap(tapSocket, this.placeMode);
    if (result) this.bridge.emitCommand(result as RenderCommand);
  }

  private indexAt(sx: number, sy: number): number | null {
    if (!this.prev) return null;
    const world = this.cameras.main.getWorldPoint(sx, sy);
    const x = Math.floor(world.x / TILE);
    const y = Math.floor((world.y - this.offsetY) / TILE);
    if (x < 0 || y < 0 || x >= this.prev.boardWidth || y >= this.prev.boardHeight) return null;
    return y * this.prev.boardWidth + x;
  }

  // ---- per-frame ------------------------------------------------------------------

  update(time: number): void {
    const snap = this.prev;
    if (!snap) return;
    if (isBrownoutActive(snap.duty, snap.sockets)) {
      this.brownoutOverlay.setAlpha(brownoutAlpha(snap.duty, time));
      this.brownoutBadge.setVisible(true);
    } else {
      this.brownoutOverlay.setAlpha(0);
      this.brownoutBadge.setVisible(false);
    }
  }

  // ---- geometry --------------------------------------------------------------------

  private cellCenter(x: number, y: number): { px: number; py: number } {
    return { px: x * TILE + TILE / 2, py: this.offsetY + y * TILE + TILE / 2 };
  }

  private indexCenter(snap: RenderSnapshot, index: number): { px: number; py: number } {
    const socket = snap.sockets[index];
    if (!socket) return { px: VIEW_W / 2, py: VIEW_H / 2 };
    return this.cellCenter(socket.x, socket.y);
  }

  private spawnSprite(key: SemanticKey, px: number, py: number, depth: number): Phaser.GameObjects.Sprite {
    const ref = resolveSprite(key, this.lookup);
    const s = this.add.sprite(px, py, ref?.texture ?? PLACEHOLDER_TEX, ref?.frame).setDepth(depth);
    if (ref) {
      if (ref.tint !== 0xffffff) s.setTint(ref.tint);
      if (ref.alpha !== 1) s.setAlpha(ref.alpha);
      if (ref.idle && this.anims.exists(ref.idle)) s.play(ref.idle);
    }
    return s;
  }
}
