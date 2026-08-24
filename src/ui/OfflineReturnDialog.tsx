import { formatAmount, formatDurationMs, type AdvanceReport } from "../game";

export interface OfflineReturnDialogProps {
  report: AdvanceReport;
  onDismiss: () => void;
}

/** True when an offline report has anything worth telling the player. */
export function offlineReportIsInteresting(report: AdvanceReport | null | undefined): report is AdvanceReport {
  return !!report && report.mode === "offline" && report.hadActivity;
}

export function OfflineReturnDialog({ report, onDismiss }: OfflineReturnDialogProps) {
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="offline-title">
      <div className="modal__sheet">
        <h2 id="offline-title" className="modal__title">
          Offline report
        </h2>
        <dl className="kv">
          <dt>Away</dt>
          <dd>{formatDurationMs(report.elapsedMs)}</dd>
          <dt>Simulated</dt>
          <dd>{formatDurationMs(report.simulatedMs)}</dd>
          <dt>Runs</dt>
          <dd>
            {report.runsCompleted}
            {report.extrapolatedRuns > 0 ? ` (+${report.extrapolatedRuns} est.)` : ""}
          </dd>
          <dt>Credits</dt>
          <dd className="warn">+{formatAmount(report.creditsBanked)}</dd>
          <dt>Data</dt>
          <dd className="good">+{formatAmount(report.dataBanked)}</dd>
          {report.overflowMs > 0 ? (
            <>
              <dt>Lost</dt>
              <dd className="bad">{formatDurationMs(report.overflowMs)} past the buffer</dd>
            </>
          ) : null}
        </dl>
        {report.overflowMs > 0 ? (
          <p className="panel__hint">Buffer was {formatDurationMs(report.bufferCapacityMs)}. Upgrade the Watchdog in System.</p>
        ) : null}
        <button type="button" className="btn-buy--data" onClick={onDismiss} autoFocus>
          Continue
        </button>
      </div>
    </div>
  );
}
