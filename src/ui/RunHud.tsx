import { THROTTLE_ON_HEAT, type GameAction, type VisibleRun } from "../game";

export interface RunHudProps {
  run: VisibleRun;
  dispatch: (action: GameAction) => void;
}

const HEAT_WARN = 6;

/** Console strip above the dungeon canvas. Geometry is fixed; values tick in place. */
export function RunHud({ run, dispatch }: RunHudProps) {
  const manual = run.control === "manual";
  const hpPct = run.maxHp > 0 ? Math.round((run.hp / run.maxHp) * 100) : 0;
  const heatPct = Math.min(100, Math.round((run.heat / THROTTLE_ON_HEAT) * 100));
  const dead = run.status === "dead";
  const ocActive = run.overclockTurns > 0;
  const ocHot = run.heat >= HEAT_WARN;

  return (
    <div className="runhud" aria-label="Run status">
      <span className="chip is-cyan">D{run.depth}</span>
      <span className="chip">{run.tier}</span>
      <span
        className={`chip quota ${run.quota.met ? "is-green" : "is-amber"}`}
        aria-label={`Quota ${run.quota.done} of ${run.quota.required}`}
      >
        {run.quota.label}
      </span>
      {run.carrying ? (
        <span className="chip is-cyan carry" aria-label="Carrying payload">
          ▣ {run.carrying.label}
        </span>
      ) : null}
      {run.channeling ? (
        <span className="chip is-cyan channel" aria-label="Channeling">
          ⇅ {run.channeling.name} · {run.channeling.remainingTurns}t
        </span>
      ) : null}

      <div className="runhud__vital">
        <small>HP</small>
        <span className="mono">
          {run.hp}/{run.maxHp}
        </span>
        <div className={`meter ${hpPct <= 30 ? "is-rose" : "is-green"}`}>
          <div className="meter__fill" style={{ width: `${hpPct}%` }} />
        </div>
      </div>

      <div className="runhud__vital">
        <small>Heat</small>
        <span className="mono">{run.throttled ? "THROTTLED" : run.heat}</span>
        <div className={`meter ${run.throttled ? "is-rose" : "is-amber"}`}>
          <div className="meter__fill" style={{ width: `${heatPct}%` }} />
        </div>
      </div>

      <div className="metric is-amber">
        <strong>{run.creditsLabel}</strong>
        <small>run cr</small>
      </div>
      <div className="metric is-cyan">
        <strong>{run.dataMined}</strong>
        <small>data</small>
      </div>
      <div className="metric">
        <strong>t{run.turn}</strong>
        <small>turn</small>
      </div>
      {run.overBudget ? <span className="chip is-rose">PSU {run.powerDraw.toFixed(1)}/{run.powerBudget.toFixed(1)}W</span> : null}
      {run.boss ? (
        <div className="runhud__vital runhud__boss" aria-label="Boss">
          <small>{run.boss.name}</small>
          <span className="mono">
            {run.boss.hp}/{run.boss.maxHp}
          </span>
          <div className="meter is-rose">
            <div
              className="meter__fill"
              style={{ width: `${run.boss.maxHp > 0 ? Math.round((run.boss.hp / run.boss.maxHp) * 100) : 0}%` }}
            />
          </div>
        </div>
      ) : null}

      <div className="runhud__actions">
        <button
          type="button"
          className={`btn-overclock ${ocActive ? "btn-overclock--active" : ""} ${ocHot ? "btn-overclock--hot" : ""}`}
          disabled={ocActive || dead}
          title={ocHot ? "Running hot — overclock adds +2 heat/turn" : "2× clock for 10 turns (+2 heat, +4 W)"}
          onClick={() => dispatch({ type: "overclock" })}
        >
          {ocActive ? `OC ${run.overclockTurns}t` : ocHot ? "Overclock ⚠" : "Overclock"}
        </button>
        <button
          type="button"
          className="btn-mode"
          aria-pressed={manual}
          onClick={() => dispatch({ type: manual ? "releaseControl" : "takeControl" })}
        >
          {manual ? "Manual" : "Auto"}
        </button>
        <button
          type="button"
          className="btn-buy--data"
          disabled={!run.onStairs || dead || run.stairsLocked}
          title={run.stairsLocked ? "Bus gate latched — complete the quota" : "Flush the buffer: descend a tier"}
          onClick={() => {
            if (!manual) dispatch({ type: "takeControl" });
            dispatch({ type: "descend" });
          }}
        >
          Flush{run.stairsLocked ? <span className="badge-lock">quota</span> : null}
        </button>
        <button type="button" className="btn-danger" onClick={() => dispatch({ type: "abortRun" })}>
          Abort
        </button>
      </div>
    </div>
  );
}

export interface ItemSlotsProps {
  run: VisibleRun;
  dispatch: (action: GameAction) => void;
}

/** Slots 1–6; tapping a usable item dispatches `useItem`. */
export function ItemSlots({ run, dispatch }: ItemSlotsProps) {
  const slots = Array.from({ length: run.itemSlots }, (_, i) => run.items[i] ?? null);
  return (
    <div className="slots" aria-label="Items">
      {slots.map((item, i) =>
        item ? (
          <button
            key={i}
            type="button"
            className={`slot ${item.usable ? "" : "slot--passive"}`}
            title={item.description}
            disabled={!item.usable}
            onClick={() => dispatch({ type: "useItem", slot: i })}
          >
            <small>{i + 1}</small>
            {item.name}
          </button>
        ) : (
          <button key={i} type="button" className="slot slot--empty" disabled aria-label={`Slot ${i + 1} empty`}>
            <small>{i + 1}</small>—
          </button>
        ),
      )}
    </div>
  );
}
