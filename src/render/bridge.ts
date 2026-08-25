import type { RenderCommand, RenderSnapshot } from "../game/renderSnapshot";
import type { ComponentKind } from "../game/types";

export type CommandListener = (cmd: RenderCommand) => void;
export type SnapshotListener = (snap: RenderSnapshot | null) => void;
/** Long-press on a socket: WS3 consumes this to open the socket's popover. Not a sim action. */
export type PopoverListener = (index: number) => void;
export type PlaceModeListener = (kind: ComponentKind | null) => void;

/**
 * Glue between React (owner of the snapshot + command dispatch) and the Phaser
 * scene. The latest snapshot/place-mode is queued until a scene subscribes, so
 * it does not matter whether React pushes before or after Phaser's `create`.
 */
export class RenderBridge {
  private latestSnapshot: RenderSnapshot | null = null;
  private latestPlaceMode: ComponentKind | null = null;
  private snapshotListeners = new Set<SnapshotListener>();
  private commandListeners = new Set<CommandListener>();
  private popoverListeners = new Set<PopoverListener>();
  private placeModeListeners = new Set<PlaceModeListener>();
  private disposed = false;

  pushSnapshot(snap: RenderSnapshot | null): void {
    if (this.disposed) return;
    this.latestSnapshot = snap;
    for (const cb of this.snapshotListeners) cb(snap);
  }

  /** Returns the last pushed snapshot (used by the scene on `create`). */
  peekSnapshot(): RenderSnapshot | null {
    return this.latestSnapshot;
  }

  /** Scene side: subscribe to snapshots; immediately receives the queued one. */
  onSnapshot(cb: SnapshotListener): () => void {
    this.snapshotListeners.add(cb);
    if (this.latestSnapshot) cb(this.latestSnapshot);
    return () => this.snapshotListeners.delete(cb);
  }

  /** WS3 side: `null` clears place-mode after a placement or cancel. */
  setPlaceMode(kind: ComponentKind | null): void {
    if (this.disposed) return;
    this.latestPlaceMode = kind;
    for (const cb of this.placeModeListeners) cb(kind);
  }

  peekPlaceMode(): ComponentKind | null {
    return this.latestPlaceMode;
  }

  /** Scene side: subscribe to place-mode changes; immediately receives the current value. */
  onPlaceMode(cb: PlaceModeListener): () => void {
    this.placeModeListeners.add(cb);
    cb(this.latestPlaceMode);
    return () => this.placeModeListeners.delete(cb);
  }

  onCommand(cb: CommandListener): () => void {
    this.commandListeners.add(cb);
    return () => this.commandListeners.delete(cb);
  }

  /** Scene side: a socket tap resolved to a sim action. */
  emitCommand(cmd: RenderCommand): void {
    if (this.disposed) return;
    for (const cb of this.commandListeners) cb(cmd);
  }

  onPopover(cb: PopoverListener): () => void {
    this.popoverListeners.add(cb);
    return () => this.popoverListeners.delete(cb);
  }

  /** Scene side: a long-press resolved to "open this socket's popover". */
  emitPopover(index: number): void {
    if (this.disposed) return;
    for (const cb of this.popoverListeners) cb(index);
  }

  dispose(): void {
    this.disposed = true;
    this.latestSnapshot = null;
    this.latestPlaceMode = null;
    this.snapshotListeners.clear();
    this.commandListeners.clear();
    this.popoverListeners.clear();
    this.placeModeListeners.clear();
  }
}
