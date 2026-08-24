import type { VisibleState } from "../game";

export interface ResourceHudProps {
  visible: VisibleState;
}

export function ResourceHud({ visible }: ResourceHudProps) {
  return (
    <header className="res" aria-label="Resources">
      <span className="res__brand">BitRouge</span>
      <div className="metric is-amber">
        <strong>{visible.resources.creditsLabel}</strong>
        <small>credits</small>
      </div>
      <div className="metric is-cyan">
        <strong>{visible.resources.dataLabel}</strong>
        <small>data</small>
      </div>
      <div className="metric">
        <strong>{visible.creditsPerSecond > 0 ? visible.creditsPerSecondLabel : "--"}</strong>
        <small>cr/s</small>
      </div>
      <div className="metric">
        <strong>L{visible.watchdog.level}</strong>
        <small>watchdog</small>
      </div>
    </header>
  );
}
