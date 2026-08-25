import type { GameAction, VisibleResearchRow, VisibleState } from "../game";

export interface ResearchPanelProps {
  visible: VisibleState;
  dispatch: (action: GameAction) => void;
}

function Group({
  title,
  rows,
  dispatch,
}: {
  title: string;
  rows: VisibleResearchRow[];
  dispatch: (action: GameAction) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <>
      <h2 className="panel__title">
        {title} <small>{rows.length}</small>
      </h2>
      {rows.map((row) => (
        <div key={row.id} className={`urow ${row.completed ? "urow--done" : ""}`}>
          <div className="urow__main">
            <div className="urow__head">
              <span className="urow__name">{row.name}</span>
              {row.daemon ? (
                <span className={`chip ${row.active ? "is-green" : ""}`}>
                  {row.active ? "daemon · live" : row.completed ? "daemon · no slot" : "daemon"}
                </span>
              ) : null}
            </div>
            <span className="urow__desc">{row.description}</span>
            <span className="urow__flavor">{row.flavor}</span>
          </div>
          <div className="urow__side">
            {row.completed ? (
              <span className="urow__done">done</span>
            ) : (
              <>
                <button
                  type="button"
                  className="btn-buy btn-buy--data"
                  disabled={!row.affordable}
                  aria-label={`Research ${row.name}`}
                  onClick={() => dispatch({ type: "buyResearch", id: row.id })}
                >
                  Buy
                </button>
                {row.affordable ? (
                  <span className="urow__cost urow__cost--data">{row.costLabel}</span>
                ) : (
                  <span className="urow__reason">
                    {row.costLabel} — {row.blockedReason ?? "locked"}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      ))}
    </>
  );
}

export function ResearchPanel({ visible, dispatch }: ResearchPanelProps) {
  const available = visible.research.filter((r) => !r.completed && r.affordable);
  const locked = visible.research.filter((r) => !r.completed && !r.affordable);
  const done = visible.research.filter((r) => r.completed);
  return (
    <div className="panel">
      <p className="panel__hint">Research costs Data — mined from data nodes on the floor, +5 per new max depth.</p>
      <Group title="Available" rows={available} dispatch={dispatch} />
      <Group title="Locked" rows={locked} dispatch={dispatch} />
      <Group title="Done" rows={done} dispatch={dispatch} />
    </div>
  );
}
