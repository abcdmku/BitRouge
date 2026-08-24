import Phaser from "phaser";
import { useEffect, useRef, type ReactNode } from "react";
import type { RenderCommand, RenderSnapshot } from "../game/renderSnapshot";
import { RenderBridge } from "../render/bridge";
import { VIEW_H, VIEW_W } from "../render/constants";
import { DUNGEON_SCENE_KEY, DungeonScene, type DungeonSceneData } from "../render/DungeonScene";
import { createPhaserConfig } from "../render/phaserConfig";
import { fetchRenderAssets } from "../render/assets/preload";
import { useSwipe } from "./hooks/useSwipe";
import "./styles/dungeon.css";

export interface DungeonViewProps {
  snapshot: RenderSnapshot | null;
  onCommand: (cmd: RenderCommand) => void;
  /** Overlay children (HUD) rendered above the canvas. */
  children?: ReactNode;
  className?: string;
}

/** Largest integer zoom where the 192x144 viewport fits the container; never below 1. */
export function fitZoom(containerW: number, containerH: number): number {
  const z = Math.floor(Math.min(containerW / VIEW_W, containerH / VIEW_H));
  return Math.max(1, z);
}

/**
 * React owner of the Phaser game. One `Phaser.Game` per mount; StrictMode's
 * mount/unmount/mount leaves exactly one canvas because cleanup destroys the
 * game (or cancels its creation if the manifest fetch is still in flight).
 */
export function DungeonView({ snapshot, onCommand, children, className }: DungeonViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const bridgeRef = useRef<RenderBridge | null>(null);
  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;

  useSwipe(hostRef, (dir) => onCommandRef.current({ type: "heroMove", dir }));

  useEffect(() => {
    const mount = mountRef.current;
    const host = hostRef.current;
    if (!mount || !host) return;

    const bridge = new RenderBridge();
    bridgeRef.current = bridge;
    const offCommand = bridge.onCommand((cmd) => onCommandRef.current(cmd));

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
      if (game) {
        game.scale.setZoom(z);
      }
    };

    const ro = new ResizeObserver(applyZoom);
    ro.observe(host);
    applyZoom();

    void fetchRenderAssets().then((assets) => {
      if (cancelled) return;
      const config = createPhaserConfig(mount, DungeonScene);
      game = new Phaser.Game(config);
      // Dev hook so tooling (screenshots) can reach the renderer.
      if (import.meta.env.DEV) (window as unknown as { __bitrougeGame?: Phaser.Game }).__bitrougeGame = game;
      const data: DungeonSceneData = { bridge, assets };
      game.scene.start(DUNGEON_SCENE_KEY, data);
      if (zoom > 0) game.scale.setZoom(zoom);
      const canvas = game.canvas;
      canvas.style.touchAction = "none";
      canvas.style.imageRendering = "pixelated";
      canvas.classList.add("dungeon-view__canvas");
    });

    return () => {
      cancelled = true;
      ro.disconnect();
      offCommand();
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

  return (
    <div ref={hostRef} className={["dungeon-view", className].filter(Boolean).join(" ")}>
      <div ref={mountRef} className="dungeon-view__mount" />
      {children ? <div className="dungeon-view__overlay">{children}</div> : null}
    </div>
  );
}
