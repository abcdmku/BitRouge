import { useCallback, useState } from "react";
import type { RenderCommand, RenderSnapshot } from "../game/renderSnapshot";
import type { ComponentKind } from "../game/types";
import { BoardView } from "../ui/BoardView";
import {
  createSampleSnapshot,
  DEMO_ARROW_INDEX,
  DEMO_CORE_INDEX,
  sampleCrash,
  sampleFaultSpread,
  sampleHeatSpike,
  sampleReflow,
  sampleRotate,
  sampleTick,
  sampleToggleBrownout,
  sampleWorkTap,
} from "./sampleSnapshot";

const COMPONENT_KINDS: ComponentKind[] = ["core", "cache", "cooler", "miner", "gpu"];

/**
 * Renderer smoke page: BoardView driven by a fake snapshot, no sim involved.
 * Mutator buttons walk BoardScene through packets/heat/fault/brownout/crash/
 * reflow so its tween/overlay/fx handling can be eyeballed and screenshotted.
 */
export function RenderDevPage() {
  const [snap, setSnap] = useState<RenderSnapshot | null>(() => createSampleSnapshot());
  const [mounted, setMounted] = useState(true);
  const [placeMode, setPlaceMode] = useState<ComponentKind | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const onCommand = useCallback((cmd: RenderCommand) => {
    setLog((l) => [JSON.stringify(cmd), ...l].slice(0, 8));
    setSnap((s) => {
      if (!s) return s;
      switch (cmd.type) {
        case "workSocket":
          return sampleWorkTap(s, cmd.index);
        case "rotateSocket":
          return sampleRotate(s, cmd.index);
        case "unlockSocket":
        case "placeComponent":
        case "upgradeComponent":
        case "sellComponent":
        case "togglePower":
        default:
          return s;
      }
    });
    if (cmd.type === "placeComponent") setPlaceMode(null);
  }, []);

  const onPopover = useCallback((index: number) => {
    setLog((l) => [`openPopover(${index})`, ...l].slice(0, 8));
  }, []);

  const mutate = (fn: (s: RenderSnapshot) => RenderSnapshot) => setSnap((s) => (s ? fn(s) : s));

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh", background: "#07080f" }}>
      <div style={{ flex: 1, minHeight: 0 }}>
        {mounted ? <BoardView snapshot={snap} onCommand={onCommand} onPopover={onPopover} placeMode={placeMode} /> : null}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: 6, fontSize: 10 }}>
        <button type="button" onClick={() => mutate(sampleTick)}>tick</button>
        <button type="button" onClick={() => mutate((s) => sampleWorkTap(s, DEMO_CORE_INDEX))}>work core</button>
        <button type="button" onClick={() => mutate((s) => sampleRotate(s, DEMO_ARROW_INDEX))}>rotate junction</button>
        <button type="button" onClick={() => mutate(sampleFaultSpread)}>fault spreads</button>
        <button type="button" onClick={() => mutate(sampleHeatSpike)}>heat spike</button>
        <button type="button" onClick={() => mutate(sampleToggleBrownout)}>toggle brownout</button>
        <button type="button" onClick={() => mutate(sampleCrash)}>crash</button>
        <button type="button" onClick={() => setSnap(sampleReflow())}>reflow</button>
        <button type="button" onClick={() => setSnap(createSampleSnapshot())}>reset</button>
        <button type="button" onClick={() => setSnap(null)}>null snapshot</button>
        <button type="button" onClick={() => setMounted((m) => !m)}>{mounted ? "unmount" : "mount"}</button>
        {COMPONENT_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => setPlaceMode((m) => (m === kind ? null : kind))}
            style={{ outline: placeMode === kind ? "2px solid #6ff2ff" : undefined }}
          >
            place {kind}
          </button>
        ))}
        <span style={{ color: "#7f8bb3" }}>
          {snap
            ? `up${Math.round(snap.uptimeMs / 1000)}s integ${snap.integrity}/${snap.integrityMax} duty${snap.duty.toFixed(2)} net${snap.netWatts}W backlog${snap.backlog.length}/${snap.backlogCap} gen${snap.gen}${snap.crash ? " CRASHED" : ""}${placeMode ? ` place:${placeMode}` : ""}`
            : "no run"}
        </span>
      </div>
      <pre style={{ margin: 0, padding: "0 6px 6px", fontSize: 9, color: "#7f8bb3", maxHeight: 80, overflow: "auto" }}>
        {log.join("\n")}
      </pre>
    </div>
  );
}
