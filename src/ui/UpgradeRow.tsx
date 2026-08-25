/**
 * One IdleBit-style shop row shared by the BUILD / SYSTEM / ARCH bottom-sheet
 * tabs — spec §6 item 4: "name, level/owned, effect line, cost, BUY with
 * afford-glow", with ARCH rows "disabled mid-run... greyed with reason".
 *
 * Presentational only, decoupled from `VisibleState`'s exact field names so
 * it can be built ahead of WS1 landing; the sheet components adapt.
 */
export interface ShopRowData {
  id: string;
  name: string;
  /** e.g. "L1", "II", "x3 owned" */
  levelLabel: string;
  effectLine: string;
  costLabel: string;
  affordable: boolean;
  disabled: boolean;
  reason: string | null;
  /** "BUY" | "PLACE" | "UNLOCK" | "UPGRADE" */
  actionLabel: string;
}

export interface UpgradeRowProps {
  row: ShopRowData;
  onAction: (id: string) => void;
}

export function UpgradeRow({ row, onAction }: UpgradeRowProps) {
  const canAct = row.affordable && !row.disabled;
  return (
    <div className={`urow ${row.disabled ? "urow--done" : ""}`}>
      <div className="urow__main">
        <div className="urow__head">
          <span className="urow__name">{row.name}</span>
          {row.levelLabel ? <span className="chip">{row.levelLabel}</span> : null}
        </div>
        <span className="urow__effect">{row.effectLine}</span>
        {row.disabled && row.reason ? <span className="urow__reason">{row.reason}</span> : null}
      </div>
      <div className="urow__side">
        {row.costLabel ? <span className="urow__cost">{row.costLabel}</span> : null}
        <button
          type="button"
          className={`btn-buy ${canAct ? "urow--glow" : ""}`}
          disabled={!canAct}
          onClick={() => onAction(row.id)}
        >
          {row.actionLabel}
        </button>
      </div>
    </div>
  );
}
