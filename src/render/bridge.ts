import type { RenderCommand, RenderSnapshot } from "../game/renderSnapshot";

export type CommandListener = (cmd: RenderCommand) => void;
export type CellTapListener = (x: number, y: number) => void;
export type SnapshotListener = (snap: RenderSnapshot | null) => void;

/**
 * Glue between React (owner of the snapshot + command dispatch) and the Phaser
 * scene. The latest snapshot is queued until a scene subscribes, so it does not
 * matter whether React pushes before or after Phaser's `create`.
 */
export class RenderBridge {
  private latest: RenderSnapshot | null = null;
  private snapshotListeners = new Set<SnapshotListener>();
  private commandListeners = new Set<CommandListener>();
  private cellTapListeners = new Set<CellTapListener>();
  private disposed = false;

  pushSnapshot(snap: RenderSnapshot | null): void {
    if (this.disposed) return;
    this.latest = snap;
    for (const cb of this.snapshotListeners) cb(snap);
  }

  /** Returns the last pushed snapshot (used by the scene on `create`). */
  peekSnapshot(): RenderSnapshot | null {
    return this.latest;
  }

  /** Scene side: subscribe to snapshots; immediately receives the queued one. */
  onSnapshot(cb: SnapshotListener): () => void {
    this.snapshotListeners.add(cb);
    if (this.latest) cb(this.latest);
    return () => this.snapshotListeners.delete(cb);
  }

  onCommand(cb: CommandListener): () => void {
    this.commandListeners.add(cb);
    return () => this.commandListeners.delete(cb);
  }

  onCellTap(cb: CellTapListener): () => void {
    this.cellTapListeners.add(cb);
    return () => this.cellTapListeners.delete(cb);
  }

  emitCommand(cmd: RenderCommand): void {
    if (this.disposed) return;
    for (const cb of this.commandListeners) cb(cmd);
  }

  emitCellTap(x: number, y: number): void {
    if (this.disposed) return;
    for (const cb of this.cellTapListeners) cb(x, y);
    this.emitCommand({ type: "heroPathTo", x, y });
  }

  dispose(): void {
    this.disposed = true;
    this.latest = null;
    this.snapshotListeners.clear();
    this.commandListeners.clear();
    this.cellTapListeners.clear();
  }
}
