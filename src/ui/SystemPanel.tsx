import { useState } from "react";
import type { GameAction, VisibleState } from "../game";

export interface SystemPanelProps {
  visible: VisibleState;
  saveDriver: string;
  dispatch: (action: GameAction) => void;
}

export function SystemPanel({ visible, saveDriver, dispatch }: SystemPanelProps) {
  const [confirming, setConfirming] = useState(false);
  const wd = visible.watchdog;

  return (
    <div className="panel">
      <h2 className="panel__title">
        Watchdog <small>L{wd.level} · {wd.capacityLabel} offline buffer</small>
      </h2>
      {wd.rows
        .filter((row) => row.level > 0)
        .map((row) => (
          <div key={row.id} className={`urow ${row.owned ? "urow--done" : ""}`}>
            <div className="urow__main">
              <div className="urow__head">
                <span className="urow__name">{row.name}</span>
                <span className="chip">L{row.level}</span>
                <span className="chip is-cyan">{row.capacityLabel}</span>
              </div>
              <span className="urow__desc">{row.capability}</span>
            </div>
            <div className="urow__side">
              {row.owned ? (
                <span className="urow__done">owned</span>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn-buy"
                    disabled={!row.affordable}
                    aria-label={`Buy watchdog ${row.name}`}
                    onClick={() => dispatch({ type: "purchaseWatchdog" })}
                  >
                    Buy
                  </button>
                  {row.isNext && row.blockedReason ? (
                    <span className="urow__reason">
                      {row.costLabel} — {row.blockedReason}
                    </span>
                  ) : (
                    <span className="urow__cost">{row.costLabel}</span>
                  )}
                </>
              )}
            </div>
          </div>
        ))}

      <h2 className="panel__title">Stats</h2>
      <div className="tiles">
        <div className="metric">
          <strong>{visible.stats.runs}</strong>
          <small>runs</small>
        </div>
        <div className="metric">
          <strong>{visible.stats.maxDepth}</strong>
          <small>max depth</small>
        </div>
        <div className="metric">
          <strong>{visible.stats.totalKills}</strong>
          <small>kills</small>
        </div>
        <div className="metric is-amber">
          <strong>{visible.lifetimeCreditsLabel}</strong>
          <small>lifetime cr</small>
        </div>
        <div className="metric">
          <strong>{saveDriver}</strong>
          <small>save driver</small>
        </div>
      </div>

      <h2 className="panel__title">Danger</h2>
      {confirming ? (
        <div className="card" style={{ display: "grid", gap: 8 }}>
          <span className="urow__reason">Wipe all progress? This cannot be undone.</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="btn-danger"
              onClick={() => {
                dispatch({ type: "reset" });
                setConfirming(false);
              }}
            >
              Confirm reset
            </button>
            <button type="button" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn-danger" style={{ justifySelf: "start" }} onClick={() => setConfirming(true)}>
          Reset save
        </button>
      )}
    </div>
  );
}
