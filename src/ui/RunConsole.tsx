import { useEffect, useRef, useState } from "react";
import {
  enemyDefinitions,
  formatAmount,
  hazardNames,
  itemDefinitions,
  type GameState,
  type RunEvent,
  type RunState,
} from "../game";

export type LogTone = "muted" | "ok" | "data" | "warn" | "danger" | "sys";

export interface LogLine {
  id: number;
  turn: number | null;
  text: string;
  tone: LogTone;
}

/** Tolerates enemy kinds added by the sim after this build (e.g. mid-flight content). */
const kindName = (kind: string): string => enemyDefinitions[kind as keyof typeof enemyDefinitions]?.name ?? kind;

const enemyName = (run: RunState, id: number | null): string => {
  if (id === null) return "hazard";
  const enemy = run.enemies.find((e) => e.id === id);
  return enemy ? kindName(enemy.kind) : "process";
};

/** One console line per notable event; movement noise is dropped. */
export const lineForEvent = (event: RunEvent, run: RunState): Omit<LogLine, "id"> | null => {
  const turn = event.turn;
  switch (event.kind) {
    case "enemyDied":
      return { turn, tone: "ok", text: `${kindName(event.enemyKind)} terminated +${formatAmount(event.credits)} cr` };
    case "heroHurt":
      return { turn, tone: "danger", text: `-${event.damage} HP (${enemyName(run, event.sourceId)}) — ${event.hp} left` };
    case "heroDied":
      return { turn, tone: "danger", text: `SEGFAULT — ${event.cause}` };
    case "heroRevived":
      return { turn, tone: "data", text: "checkpoint restored — process revived" };
    case "enemySpawned":
      return { turn, tone: "warn", text: `${kindName(event.enemyKind)} spawned` };
    case "itemPicked":
      return { turn, tone: "data", text: `picked up ${itemDefinitions[event.itemKind].name}` };
    case "itemUsed":
      return { turn, tone: "data", text: `used ${itemDefinitions[event.itemKind].name}` };
    case "hazardTriggered":
      return { turn, tone: "warn", text: `${hazardNames[event.hazard]} triggered` };
    case "throttled":
      return event.on
        ? { turn, tone: "warn", text: "THERMAL THROTTLE — cadence halved" }
        : { turn, tone: "muted", text: "throttle cleared" };
    case "tripped":
      return { turn, tone: "warn", text: "PSU TRIP — turn skipped" };
    case "deadlockPenalty":
      return { turn, tone: "danger", text: `DEADLOCK PENALTY -${formatAmount(event.creditsLost)} cr` };
    case "descended":
      // The sim emits a descended event on deploy; the DEPLOYED line covers it.
      if (event.turn === 0) return null;
      return { turn, tone: "sys", text: `DESCEND → depth ${event.depth}` };
    case "controlChanged":
      return { turn, tone: "muted", text: `control: ${event.control === "manual" ? "MANUAL" : "AUTO-EXPLORE"}` };
    case "stairsLocked":
      return { turn, tone: "danger", text: "ACCESS DENIED — kernel panic active" };
    case "stairsUnlocked":
      return { turn, tone: "ok", text: "stairs unlocked" };
    default:
      return null;
  }
};

const MAX_LINES = 120;

/** Accumulates run events + lifecycle transitions into a persistent feed. */
export function useRunLog(state: GameState): LogLine[] {
  const [lines, setLines] = useState<LogLine[]>([]);
  const nextIdRef = useRef(1);
  const lastSeqRef = useRef(-1);
  const lastSeedRef = useRef<number | null>(null);
  const lastSummaryRef = useRef(state.hub.lastRunSummary);
  const lastCampaignSeqRef = useRef(-1);

  useEffect(() => {
    const pending: Omit<LogLine, "id">[] = [];
    const run = state.run;

    if (run && run.seed !== lastSeedRef.current) {
      lastSeedRef.current = run.seed;
      lastSeqRef.current = -1;
      pending.push({ turn: null, tone: "sys", text: `PROCESS DEPLOYED — pid ${run.seed % 65536}, depth ${run.depth}` });
    }

    if (run) {
      for (const event of run.events) {
        if (event.seq <= lastSeqRef.current) continue;
        lastSeqRef.current = event.seq;
        const line = lineForEvent(event, run);
        if (line) pending.push(line);
      }
    }

    const summary = state.hub.lastRunSummary;
    if (summary && summary !== lastSummaryRef.current) {
      lastSummaryRef.current = summary;
      lastSeedRef.current = null;
      pending.push({
        turn: summary.turns,
        tone: summary.aborted ? "warn" : "danger",
        text: summary.aborted
          ? `SIGKILL — run aborted, banked ${formatAmount(summary.creditsBanked)} cr / ${formatAmount(summary.dataBanked)} D`
          : `CRASH — core dumped, banked ${formatAmount(summary.creditsBanked)} cr / ${formatAmount(summary.dataBanked)} D`,
      });
      if (state.hub.rebootRemainingBits !== null) {
        pending.push({ turn: null, tone: "data", text: "WATCHDOG ARMING — auto-redeploy queued" });
      }
    }

    for (const entry of state.campaign.log) {
      if (entry.seq <= lastCampaignSeqRef.current) continue;
      lastCampaignSeqRef.current = entry.seq;
      pending.push({ turn: null, tone: "sys", text: `Transmission: ${entry.text}` });
    }

    if (pending.length > 0) {
      setLines((prev) => {
        const appended = pending.map((line) => ({ ...line, id: nextIdRef.current++ }));
        return [...prev, ...appended].slice(-MAX_LINES);
      });
    }
  }, [state]);

  return lines;
}

export function RunConsole({ lines }: { lines: LogLine[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div className="console" aria-label="Run log" aria-live="polite">
      <div ref={scrollRef} className="console__scroll">
        {lines.length === 0 ? <span className="console__line">-- no transmissions --</span> : null}
        {lines.map((line) => (
          <span key={line.id} className={`console__line is-${line.tone}`}>
            {line.turn !== null ? <span className="t">t{line.turn}</span> : <span className="t">::</span>}
            {line.text}
          </span>
        ))}
      </div>
    </div>
  );
}
