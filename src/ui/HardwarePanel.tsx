import { formatSeconds, getMsPerTurn, type GameAction, type VisibleHardwareRow, type VisibleState } from "../game";

export interface HardwarePanelProps {
  visible: VisibleState;
  dispatch: (action: GameAction) => void;
}

/** Clock rows get the derived cadence appended: "2.30 Hz → 0.9s/turn". */
export function effectLine(row: VisibleHardwareRow, clockHz: number): string {
  if (row.kind !== "clock") return row.effect;
  return `${row.effect} = ${formatSeconds(getMsPerTurn(clockHz, 1) / 1000)}/turn`;
}

export function HardwarePanel({ visible, dispatch }: HardwarePanelProps) {
  return (
    <div className="panel">
      <h2 className="panel__title">
        Hardware <small>7 modules</small>
      </h2>
      {visible.hardware.map((row) => {
        const blocked = row.blockedReason !== null || !row.affordable;
        return (
          <div key={row.kind} className="urow">
            <div className="urow__main">
              <div className="urow__head">
                <span className="urow__name">{row.name}</span>
                <span className="chip">L{row.level}</span>
              </div>
              <span className="urow__effect">
                <b>{effectLine(row, visible.clockHz)}</b> <span className="arrow">→</span> {row.nextEffect}
              </span>
            </div>
            <div className="urow__side">
              <button
                type="button"
                className="btn-buy"
                disabled={blocked}
                aria-label={`Buy ${row.name}`}
                onClick={() => dispatch({ type: "buyHardware", kind: row.kind })}
              >
                Buy
              </button>
              {blocked && row.blockedReason ? (
                <span className="urow__reason">{row.blockedReason}</span>
              ) : (
                <span className="urow__cost">{row.costLabel}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
