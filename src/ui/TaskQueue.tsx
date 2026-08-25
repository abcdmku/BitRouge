import type { VisibleRun, VisibleTaskRow } from "../game";

const VERB_CLASS: Record<string, string> = {
  MINE: "is-cyan",
  EXEC: "is-amber",
  HAUL: "is-green",
};

function TaskRow({ task }: { task: VisibleTaskRow }) {
  const pct = Math.round(task.progress * 100);
  return (
    <div
      className={`task ${task.done ? "task--done" : ""} ${task.active ? "task--active" : ""}`}
      role="listitem"
      aria-label={`${task.verb} ${task.name}`}
    >
      <span className={`chip task__verb ${VERB_CLASS[task.verb] ?? ""}`}>{task.verb}</span>
      <div className="task__main">
        <div className="task__head">
          <span className="task__name">{task.name}</span>
          {task.blockedReason ? <span className="task__blocked">{task.blockedReason}</span> : null}
          <span className={`task__payout ${task.verb === "MINE" ? "is-data" : ""}`}>{task.payoutLabel}</span>
        </div>
        <div className={`meter ${task.done ? "is-green" : task.blockedReason ? "is-rose" : task.verb === "MINE" ? "" : "is-amber"}`}>
          <div className="meter__fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <span className={`task__state mono ${task.done ? "task__state--done" : ""}`}>
        {task.done ? "✓" : task.active ? "▶" : `${pct}%`}
      </span>
    </div>
  );
}

/**
 * The floor's work sites as IdleBit job rows — live progress bars, payouts and
 * blocked reasons (spec §6: "the loudest same-universe signal in the game").
 */
export function TaskQueue({ run }: { run: VisibleRun }) {
  return (
    <>
      <h2 className="panel__title">
        Task queue{" "}
        <small className={run.quota.met ? "quota-met" : ""}>
          {run.quota.label}
          {run.quota.met ? " · gate open" : ""}
        </small>
      </h2>
      <div className="tasks" role="list" aria-label="Task queue">
        {run.tasks.length === 0 ? <span className="tasks__empty">no work scheduled on this floor</span> : null}
        {run.tasks.map((task) => (
          <TaskRow key={`${task.kind}:${task.id}`} task={task} />
        ))}
      </div>
    </>
  );
}
