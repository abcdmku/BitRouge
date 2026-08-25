import type { CSSProperties } from "react";

/**
 * Backlog strip — spec §2 one-screen anatomy, row 2: "BACKLOG [b][b][c][c][h][ ][ ]  7/12"
 * inbound task chips tinted per kind, a deadline ring on PRIORITY, count n/cap,
 * overflow warning at >= 10.
 *
 * Presentational only, decoupled from `VisibleState`'s exact field names so
 * it can be built ahead of WS1 landing; App.tsx adapts.
 */
export type BacklogTaskKind = "bulk" | "crunch" | "hot" | "priority";

export interface BacklogChip {
  id: number;
  kind: BacklogTaskKind;
  /** Remaining share of the deadline, 0..100 (PRIORITY only); null otherwise. */
  deadlinePct: number | null;
}

export interface BacklogStripProps {
  chips: BacklogChip[];
  cap: number;
}

/** Spec pins the warning at ≥10 for the base cap of 12; generalized to cap−2 so East Port cap bumps keep the same "two slots left" meaning. */
const overflowWarnAt = (cap: number) => Math.max(1, cap - 2);

const KIND_LETTER: Record<BacklogTaskKind, string> = {
  bulk: "b",
  crunch: "c",
  hot: "h",
  priority: "p",
};

export function BacklogStrip({ chips, cap }: BacklogStripProps) {
  const overflowing = chips.length >= overflowWarnAt(cap);
  const empties = Math.max(0, cap - chips.length);

  return (
    <div className={`backlog ${overflowing ? "backlog--warn" : ""}`} aria-label="Backlog">
      <span className="backlog__label">backlog</span>
      <div className="backlog__chips">
        {chips.map((chip) => (
          <span
            key={chip.id}
            className={`backlog__chip backlog__chip--${chip.kind}`}
            style={
              chip.kind === "priority" && chip.deadlinePct !== null
                ? ({ "--deadline-pct": `${Math.max(0, Math.min(100, chip.deadlinePct))}%` } as CSSProperties)
                : undefined
            }
            title={chip.kind}
          >
            {KIND_LETTER[chip.kind]}
          </span>
        ))}
        {Array.from({ length: empties }, (_, i) => (
          <span key={`empty-${i}`} className="backlog__chip backlog__chip--empty" />
        ))}
      </div>
      <span className={`backlog__count mono ${overflowing ? "warn" : ""}`}>
        {chips.length}/{cap}
      </span>
    </div>
  );
}
