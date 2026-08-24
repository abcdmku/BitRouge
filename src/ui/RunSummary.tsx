import { formatAmount, formatDurationMs, type RunSummary as RunSummaryData } from "../game";

export interface RunSummaryProps {
  summary: RunSummaryData;
}

export function RunSummary({ summary }: RunSummaryProps) {
  return (
    <section className="card summary" aria-label="Last run">
      <div className="summary__head">
        <span>Last run</span>
        <span className={summary.aborted ? "" : "summary__cause"}>{summary.aborted ? "aborted" : summary.cause}</span>
      </div>
      <dl className="kv">
        <dt>Depth</dt>
        <dd className={summary.newMaxDepth ? "warn" : ""}>
          {summary.maxDepthReached}
          {summary.newMaxDepth ? " ★ new best" : ""}
        </dd>
        <dt>Turns</dt>
        <dd>{summary.turns}</dd>
        <dt>Kills</dt>
        <dd>{summary.kills}</dd>
        <dt>Banked</dt>
        <dd className="warn">{formatAmount(summary.creditsBanked)} cr</dd>
        <dt>Data</dt>
        <dd className="good">+{formatAmount(summary.dataBanked)} D</dd>
        <dt>Time</dt>
        <dd>{formatDurationMs(summary.elapsedMs)}</dd>
      </dl>
    </section>
  );
}
