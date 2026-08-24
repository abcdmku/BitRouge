import { useCallback, useState } from "react";
import type { RenderCommand, RenderSnapshot } from "../game/renderSnapshot";
import { DungeonView } from "../ui/DungeonView";
import { TouchControls } from "../ui/TouchControls";
import { useKeyboard } from "../ui/hooks/useKeyboard";
import {
  createSampleSnapshot,
  sampleDescend,
  sampleEnemiesStep,
  sampleHazard,
  sampleHurt,
  sampleMove,
  sampleRevealAll,
  sampleToggleControl,
} from "./sampleSnapshot";

/**
 * Renderer smoke page: DungeonView + TouchControls driven by a fake snapshot.
 * Mount at hash route `#/dev/render`. No sim involved; commands mutate the
 * sample snapshot with the helpers in sampleSnapshot.ts.
 */
export function RenderDevPage() {
  const [snap, setSnap] = useState<RenderSnapshot | null>(() => createSampleSnapshot());
  const [mounted, setMounted] = useState(true);
  const [log, setLog] = useState<string[]>([]);

  const onCommand = useCallback((cmd: RenderCommand) => {
    setLog((l) => [JSON.stringify(cmd), ...l].slice(0, 8));
    setSnap((s) => {
      if (!s) return s;
      switch (cmd.type) {
        case "heroMove":
          return sampleMove(s, cmd.dir);
        case "heroWait":
          return sampleEnemiesStep(s);
        case "descend":
          return sampleDescend(s);
        case "takeControl":
          return s.control === "manual" ? s : sampleToggleControl(s);
        case "releaseControl":
          return s.control === "auto" ? s : sampleToggleControl(s);
        case "heroPathTo":
        case "useItem":
        default:
          return s;
      }
    });
  }, []);

  useKeyboard(onCommand, { control: snap?.control ?? null });

  const mutate = (fn: (s: RenderSnapshot) => RenderSnapshot) => setSnap((s) => (s ? fn(s) : s));

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh", background: "#07080f" }}>
      <div style={{ flex: 1, minHeight: 0 }}>
        {mounted ? <DungeonView snapshot={snap} onCommand={onCommand} /> : null}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: 6, fontSize: 10 }}>
        <button type="button" onClick={() => mutate(sampleEnemiesStep)}>enemies step</button>
        <button type="button" onClick={() => mutate(sampleHurt)}>hero hurt</button>
        <button type="button" onClick={() => mutate(sampleHazard)}>hazard</button>
        <button type="button" onClick={() => mutate(sampleDescend)}>descend</button>
        <button type="button" onClick={() => mutate(sampleToggleControl)}>toggle control</button>
        <button type="button" onClick={() => mutate(sampleRevealAll)}>reveal all</button>
        <button type="button" onClick={() => setSnap(createSampleSnapshot())}>reset</button>
        <button type="button" onClick={() => setSnap(null)}>null snapshot</button>
        <button type="button" onClick={() => setMounted((m) => !m)}>{mounted ? "unmount" : "mount"}</button>
        <span style={{ color: "#7f8bb3" }}>
          {snap ? `d${snap.depth} t${snap.turn} ${snap.control} hp${snap.hero.hp}/${snap.hero.maxHp} @${snap.hero.x},${snap.hero.y}` : "no run"}
        </span>
      </div>
      <TouchControls onCommand={onCommand} control={snap?.control ?? null} forceShow />
      <pre style={{ margin: 0, padding: "0 6px 6px", fontSize: 9, color: "#7f8bb3", maxHeight: 80, overflow: "auto" }}>
        {log.join("\n")}
      </pre>
    </div>
  );
}
