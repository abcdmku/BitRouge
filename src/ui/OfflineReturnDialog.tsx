/**
 * Return-from-away dialog — spec §2 "Idle loop and offline story":
 * "Away 6h 12m — 2,140 tasks done at 71% duty, +5,320 cr, +148 data,
 * backlog 11/12, integrity 44. It needs you."
 *
 * Field names mirror the sim's `VisibleOfflineReport` (src/game/selectors.ts,
 * built by `describeOfflineReport`); the interface is duplicated here so the
 * component stays purely presentational and testable without the sim.
 */
export interface VisibleOfflineReport {
  awayLabel: string;
  tasksDone: number;
  dutyLabel: string;
  creditsLabel: string;
  dataLabel: string;
  backlogLabel: string;
  integrityLabel: string;
  hadActivity: boolean;
  /** Integrity or backlog is critical — the board wants hands. */
  needsAttention: boolean;
}

export interface OfflineReturnDialogProps {
  report: VisibleOfflineReport;
  onDismiss: () => void;
}

/** True when an offline report has anything worth telling the player. */
export function offlineReportIsInteresting(
  report: VisibleOfflineReport | null | undefined,
): report is VisibleOfflineReport {
  return !!report && report.hadActivity;
}

export function OfflineReturnDialog({ report, onDismiss }: OfflineReturnDialogProps) {
  const integrity = Number(report.integrityLabel);
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="offline-title">
      <div className="modal__sheet">
        <h2 id="offline-title" className="modal__title">
          While you were away
        </h2>
        <p className="offline__summary">
          Away <b className="mono">{report.awayLabel}</b> — <b className="mono">{report.tasksDone.toLocaleString()}</b>{" "}
          tasks done at <b className="mono">{report.dutyLabel}</b> duty.
        </p>
        <dl className="kv">
          <dt>Credits</dt>
          <dd className="warn">+{report.creditsLabel}</dd>
          <dt>Data</dt>
          <dd className="good">+{report.dataLabel}</dd>
          <dt>Backlog</dt>
          <dd className={report.needsAttention ? "bad" : ""}>{report.backlogLabel}</dd>
          <dt>Integrity</dt>
          <dd className={integrity <= 25 ? "bad" : integrity < 60 ? "warn" : "good"}>{report.integrityLabel}</dd>
        </dl>
        {report.needsAttention ? <p className="offline__needs">It needs you.</p> : null}
        <button type="button" className="btn-buy--data" onClick={onDismiss} autoFocus>
          Continue
        </button>
      </div>
    </div>
  );
}
