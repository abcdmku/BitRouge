import { deriveHeroStats, formatSeconds, getMsPerTurn, type GameAction, type GameState, type VisibleState } from "../game";
import { RunSummary } from "./RunSummary";

export interface HubPanelProps {
  state: GameState;
  visible: VisibleState;
  dispatch: (action: GameAction) => void;
}

/** Deploy screen shown in the stage while no run is active. */
export function HubPanel({ state, visible, dispatch }: HubPanelProps) {
  const stats = deriveHeroStats(state.hub);
  const reboot = visible.reboot;
  const secPerTurn = getMsPerTurn(stats.clockHz, 1) / 1000;

  return (
    <div className="deploy">
      <h1 className="deploy__title">BitRouge</h1>
      <p className="deploy__tag">corrupted stack · one process · descend</p>

      <div className="deploy__stats" aria-label="Hero stats">
        <div className="metric">
          <strong>{stats.maxHp}</strong>
          <small>HP</small>
        </div>
        <div className="metric">
          <strong>{stats.attack}</strong>
          <small>attack</small>
        </div>
        <div className="metric">
          <strong>{formatSeconds(secPerTurn)}</strong>
          <small>per turn</small>
        </div>
        <div className="metric">
          <strong>{stats.powerBudget.toFixed(1)}W</strong>
          <small>psu budget</small>
        </div>
        <div className="metric">
          <strong>-{stats.heatDissipation}</strong>
          <small>heat/turn</small>
        </div>
        <div className="metric">
          <strong>{stats.fovRadius}</strong>
          <small>sight</small>
        </div>
      </div>

      {reboot ? (
        <div className="reboot" role="status">
          <div className="reboot__row">
            <span>watchdog rebooting</span>
            <b>{formatSeconds(reboot.remainingMs / 1000)}</b>
          </div>
          <div className="meter">
            <div className="meter__fill" style={{ width: `${Math.round(reboot.progress * 100)}%` }} />
          </div>
          <div className="reboot__row">
            <span>
              {reboot.totalBits - reboot.remainingBits}/{reboot.totalBits} bits
            </span>
            <span>auto-redeploy on 16/16</span>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        className="deploy__button"
        disabled={!visible.canDeploy}
        onClick={() => dispatch({ type: "deploy" })}
      >
        Deploy
      </button>

      {visible.lastRunSummary ? <RunSummary summary={visible.lastRunSummary} /> : null}
    </div>
  );
}
