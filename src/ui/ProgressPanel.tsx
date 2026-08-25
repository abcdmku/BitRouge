import type { ArchPerkId, GameState, VisibleState } from "../game";

interface ProgressPanelProps {
  state: GameState;
  visible: VisibleState;
  onArch: (id: ArchPerkId) => void;
  onReflow: () => void;
}

const TIERS = [
  { id: "Hz", label: "Hz", research: null },
  { id: "kHz", label: "kHz", research: "cpuTierKhz" },
  { id: "MHz", label: "MHz", research: "cpuTierMhz" },
  { id: "GHz", label: "GHz", research: "cpuTierGhz" },
] as const;

export function ProgressPanel({ state, visible, onArch, onReflow }: ProgressPanelProps) {
  return (
    <div className="control-panel progress-panel">
      <div className="panel-intro">
        <span className="eyebrow">LONG-RUN PROGRESSION</span>
        <h2>Evolution</h2>
        <p>Hold the node together, reflow the failed board, and spend Silicon on permanent architecture.</p>
      </div>

      <div className="run-ledger">
        <div><span>CURRENT UPTIME</span><strong>{visible.hud.uptimeLabel}</strong></div>
        <div><span>BEST UPTIME</span><strong>{Math.floor(state.meta.bestUptimeMs / 60_000)}m</strong></div>
        <div><span>JOBS THIS RUN</span><strong>{state.run.tasksDone}</strong></div>
        <div><span>REFLOWS</span><strong>{state.meta.reflows}</strong></div>
      </div>

      <section className="panel-section">
        <h3>CPU & RAM TIERS</h3>
        <div className="tier-path">
          {TIERS.map((tier, index) => {
            const unlocked = tier.research === null || state.meta.research.completed.includes(tier.research);
            const active = visible.node.clockTier === tier.id;
            return (
              <div key={tier.id} className={`tier-node ${unlocked ? "is-unlocked" : ""} ${active ? "is-active" : ""}`}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{tier.label}</strong>
                <small>{active ? visible.node.clockLabel : unlocked ? "UNLOCKED" : "R&D LOCKED"}</small>
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel-section">
        <div className="section-heading">
          <h3>ARCHITECTURE</h3>
          <span>{visible.hud.siliconLabel} Si</span>
        </div>
        <div className="arch-grid">
          {visible.arch.map((row) => (
            <button
              type="button"
              key={row.id}
              className={`arch-card ${row.owned ? "is-owned" : ""}`}
              disabled={!row.affordable}
              onClick={() => onArch(row.id)}
            >
              <span><strong>{row.label}</strong><small>{row.flavor}</small></span>
              <b>{row.owned ? "OWNED" : row.lockedReason ?? row.costLabel}</b>
            </button>
          ))}
        </div>
      </section>

      <section className="reflow-card">
        <div>
          <span className="eyebrow">RUN RESET</span>
          <h3>REFLOW FOR +{visible.reflow.siliconPayout} Si</h3>
          <p>Hardware, Credits, Data, and research stay. Uptime, heat, faults, and queue pressure reset.</p>
        </div>
        <button type="button" disabled={!visible.reflow.available} onClick={onReflow}>
          {visible.reflow.available ? "REFLOW NODE" : "AVAILABLE AT 10:00"}
        </button>
      </section>
    </div>
  );
}
