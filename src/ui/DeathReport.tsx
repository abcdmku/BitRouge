import type { RunState } from "../game";
import { lineForEvent, type LogLine } from "./RunConsole";

const SYSLOG_LINES = 10;

/**
 * Death screen: the named failure mode plus a syslog excerpt of the last ten
 * notable events from the run's event ring (spec §4: "death reads fairly").
 */
export function DeathReport({ run }: { run: RunState }) {
  const lines: Omit<LogLine, "id">[] = [];
  for (const event of run.events) {
    const line = lineForEvent(event, run);
    if (line) lines.push(line);
  }
  const excerpt = lines.slice(-SYSLOG_LINES);

  return (
    <div className="death" role="alertdialog" aria-label="Process terminated">
      <div className="death__title">PROCESS TERMINATED</div>
      <div className="death__cause mono">{run.deathCause ?? "Unknown failure"}</div>
      <div className="death__log" aria-label="Last events">
        {excerpt.length === 0 ? <span className="death__line">-- no log --</span> : null}
        {excerpt.map((line, i) => (
          <span key={i} className={`death__line is-${line.tone}`}>
            <span className="t">{line.turn !== null ? `t${line.turn}` : "::"}</span>
            {line.text}
          </span>
        ))}
      </div>
      <small className="death__hint">core dumped — banking credits, watchdog will redeploy</small>
    </div>
  );
}
