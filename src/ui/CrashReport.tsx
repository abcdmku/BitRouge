/**
 * Full-screen autopsy shown on crash (integrity 0) — spec §2 "Prestige —
 * REFLOW" and §6: "ranked damage log, uptime, Si payout, REFLOW button".
 * The report is the teacher: its top line names the killer so a player can
 * state in one sentence why they died (§7 success criterion 4).
 *
 * Presentational only — deliberately decoupled from `VisibleState`'s exact
 * shape so it can be built ahead of WS1 landing; App.tsx adapts.
 */
export interface CrashDamageEntry {
  /** Stable id, e.g. "backlogOverflow" | "priorityExpired" | "faultSpread" | "heatRunaway". */
  source: string;
  /** Human label, e.g. "BACKLOG OVERFLOW". */
  label: string;
  amount: number;
  /** Share of total damage, 0..100. */
  pct: number;
}

export interface CrashReportProps {
  uptimeLabel: string;
  tasksCompleted: number;
  siliconPayout: number;
  /** Ranked highest-damage-first; empty renders a fallback line. */
  damage: CrashDamageEntry[];
  onReflow: () => void;
}

export function CrashReport({ uptimeLabel, tasksCompleted, siliconPayout, damage, onReflow }: CrashReportProps) {
  const top = damage[0] ?? null;

  return (
    <div className="crash" role="alertdialog" aria-modal="true" aria-label="System crash">
      <div className="crash__title">SYSTEM CRASH</div>
      <p className="crash__autopsy">
        {top
          ? `Killed by ${top.label} (${Math.round(top.pct)}% of damage).`
          : "Cause unknown — the board went dark before it could log one."}
      </p>
      <div className="crash__bars" aria-label="Damage by source">
        {damage.length === 0 ? <span className="crash__empty">-- no damage recorded --</span> : null}
        {damage.map((entry) => (
          <div key={entry.source} className="crash-bar">
            <div className="crash-bar__head">
              <span className="crash-bar__label">{entry.label}</span>
              <span className="crash-bar__value mono">
                {entry.amount} · {Math.round(entry.pct)}%
              </span>
            </div>
            <div className="crash-bar__track">
              <div className="crash-bar__fill" style={{ width: `${Math.min(100, Math.max(0, entry.pct))}%` }} />
            </div>
          </div>
        ))}
      </div>
      <dl className="kv crash__stats">
        <dt>Uptime</dt>
        <dd className="mono">{uptimeLabel}</dd>
        <dt>Tasks done</dt>
        <dd className="mono">{tasksCompleted}</dd>
        <dt>Silicon</dt>
        <dd className="good mono">+{siliconPayout}</dd>
      </dl>
      <button type="button" className="crash__reflow" onClick={onReflow} autoFocus>
        REFLOW
      </button>
    </div>
  );
}
