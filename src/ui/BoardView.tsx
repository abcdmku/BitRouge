import Phaser from "phaser";
import { useEffect, useRef, type CSSProperties } from "react";
import type { RenderCommand, RenderSnapshot } from "../game/renderSnapshot";
import type { ComponentKind } from "../game/types";
import { fetchRenderAssets } from "../render/assets/preload";
import { BoardScene, BOARD_SCENE_KEY, type BoardSceneData } from "../render/BoardScene";
import { RenderBridge } from "../render/bridge";
import { VIEW_H, VIEW_W } from "../render/constants";
import { createPhaserConfig } from "../render/phaserConfig";

export interface BoardViewProps {
  snapshot: RenderSnapshot | null;
  onCommand: (cmd: RenderCommand) => void;
  /** Long-press on a socket: open its popover (upgrade / sell / power). Not a sim action. */
  onPopover: (index: number) => void;
  /** Set by the shop sheet; the next socket tap emits `placeComponent`. */
  placeMode: ComponentKind | null;
  className?: string;
}

/** Minimum zoom so a 16px socket is >= 44 logical px (spec §7: taps >= 44px logical). */
const MIN_ZOOM = 3;

/** Largest integer zoom that fits the container, never below MIN_ZOOM. */
export function fitZoom(containerW: number, containerH: number): number {
  const fit = Math.floor(Math.min(containerW / VIEW_W, containerH / VIEW_H));
  return Math.max(MIN_ZOOM, fit);
}

/**
 * React owner of the Phaser game for the SOLDER board. One `Phaser.Game` per
 * mount; StrictMode's mount/unmount/mount leaves exactly one canvas because
 * cleanup destroys the game (or cancels its creation if the manifest fetch is
 * still in flight). Coordinate: this is the only file WS2 owns in `src/ui` —
 * WS3 mounts it with `{ snapshot, onCommand, onPopover, placeMode }`.
 */
export function BoardView({ snapshot, onCommand, onPopover, placeMode, className }: BoardViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const bridgeRef = useRef<RenderBridge | null>(null);
  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;
  const onPopoverRef = useRef(onPopover);
  onPopoverRef.current = onPopover;

  useEffect(() => {
    const mount = mountRef.current;
    const host = hostRef.current;
    if (!mount || !host) return;

    const bridge = new RenderBridge();
    bridgeRef.current = bridge;
    const offCommand = bridge.onCommand((cmd) => onCommandRef.current(cmd));
    const offPopover = bridge.onPopover((index) => onPopoverRef.current(index));

    let game: Phaser.Game | null = null;
    let cancelled = false;
    let zoom = 0;

    const applyZoom = () => {
      const rect = host.getBoundingClientRect();
      const z = fitZoom(rect.width, rect.height);
      if (z === zoom) return;
      zoom = z;
      mount.style.width = `${VIEW_W * z}px`;
      mount.style.height = `${VIEW_H * z}px`;
      if (game) game.scale.setZoom(z);
    };

    const ro = new ResizeObserver(applyZoom);
    ro.observe(host);
    applyZoom();

    void fetchRenderAssets().then((assets) => {
      if (cancelled) return;
      const config = createPhaserConfig(mount, BoardScene);
      game = new Phaser.Game(config);
      // Dev hook so tooling (screenshots) can reach the renderer.
      if (import.meta.env.DEV) (window as unknown as { __bitrougeGame?: Phaser.Game }).__bitrougeGame = game;
      const data: BoardSceneData = { bridge, assets };
      game.scene.start(BOARD_SCENE_KEY, data);
      if (zoom > 0) game.scale.setZoom(zoom);
      const canvas = game.canvas;
      canvas.style.touchAction = "none";
      canvas.style.imageRendering = "pixelated";
      canvas.classList.add("board-view__canvas");
    });

    return () => {
      cancelled = true;
      ro.disconnect();
      offCommand();
      offPopover();
      bridge.dispose();
      bridgeRef.current = null;
      if (game) {
        game.destroy(true);
        game = null;
      }
      // Belt and braces: Phaser removes the canvas on destroy(true), but make
      // sure nothing lingers under StrictMode remounts.
      while (mount.firstChild) mount.removeChild(mount.firstChild);
    };
  }, []);

  useEffect(() => {
    bridgeRef.current?.pushSnapshot(snapshot);
  }, [snapshot]);

  useEffect(() => {
    bridgeRef.current?.setPlaceMode(placeMode);
  }, [placeMode]);

  return (
    <div
      ref={hostRef}
      className={["board-view", className].filter(Boolean).join(" ")}
      style={HOST_STYLE}
    >
      <div ref={mountRef} className="board-view__mount" style={MOUNT_STYLE} />
    </div>
  );
}

// Inline (not an external stylesheet): this is the one file WS2 owns in
// src/ui, and src/ui/styles/** belongs to WS3's layout pass.
const HOST_STYLE: CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  minHeight: VIEW_H,
  display: "grid",
  placeItems: "center",
  overflow: "hidden",
  background: "#07080f",
  touchAction: "none",
  userSelect: "none",
  WebkitUserSelect: "none",
};

const MOUNT_STYLE: CSSProperties = {
  position: "relative",
  width: VIEW_W,
  height: VIEW_H,
  lineHeight: 0,
};
