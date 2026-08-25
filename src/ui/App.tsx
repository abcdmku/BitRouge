import { useEffect, useMemo, useState } from "react";
import {
  deriveRenderSnapshot,
  formatSeconds,
  type AdvanceReport,
  type GameAction,
  type VisibleCampaign,
  type VisibleRun,
} from "../game";
import { RenderDevPage } from "../dev/RenderDevPage";
import { AsciiFloor } from "./AsciiFloor";
import { DeathReport } from "./DeathReport";
import { DungeonView } from "./DungeonView";
import { HardwarePanel } from "./HardwarePanel";
import { HubPanel } from "./HubPanel";
import { Layout } from "./Layout";
import { OfflineReturnDialog, offlineReportIsInteresting } from "./OfflineReturnDialog";
import { ResearchPanel } from "./ResearchPanel";
import { ResourceHud } from "./ResourceHud";
import { RunConsole, useRunLog, type LogLine } from "./RunConsole";
import { RunHud, ItemSlots } from "./RunHud";
import { SystemPanel } from "./SystemPanel";
import { TaskQueue } from "./TaskQueue";
import { TouchControls } from "./TouchControls";
import { useGamePersistence } from "./hooks/useGamePersistence";
import { useKeyboard } from "./hooks/useKeyboard";

const useHash = () => {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
};

const asciiEnabled = () => new URLSearchParams(window.location.search).get("ascii") === "1";

function CampaignSection({ campaign }: { campaign: VisibleCampaign }) {
  return (
    <>
      <h2 className="panel__title">
        Campaign{" "}
        <small>
          {campaign.completedCount}/{campaign.totalCount}
        </small>
      </h2>
      {campaign.chapters.map((chapter) => (
        <div key={chapter.id} className={`card campaign ${chapter.completed ? "campaign--done" : ""}`}>
          <div className="campaign__head">
            <span className="campaign__name">
              {chapter.index}. {chapter.name}
            </span>
            {chapter.completed ? (
              <span className="chip is-green">done</span>
            ) : chapter.id === campaign.currentChapterId ? (
              <span className="chip is-cyan">active</span>
            ) : (
              <span className="chip">pending</span>
            )}
          </div>
          <span className="campaign__desc">{chapter.description}</span>
          <ul className="objectives">
            {chapter.objectives.map((objective) => (
              <li key={objective.id} className={`objective ${objective.completed ? "objective--done" : ""}`}>
                <span className="objective__mark mono">{objective.completed ? "[x]" : "[ ]"}</span>
                <span className="objective__label" title={objective.description}>
                  {objective.label}
                </span>
                {!objective.completed && objective.blockedReason ? (
                  <span className="objective__reason">{objective.blockedReason}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

function RunPanel({
  run,
  log,
  campaign,
  dispatch,
}: {
  run: VisibleRun | null;
  log: LogLine[];
  campaign: VisibleCampaign;
  dispatch: (a: GameAction) => void;
}) {
  return (
    <div className="panel">
      {run ? <TaskQueue run={run} /> : null}
      <h2 className="panel__title">
        Console <small>{run ? "live" : "idle"}</small>
      </h2>
      <RunConsole lines={log} />
      {run ? (
        <>
          <h2 className="panel__title">
            Items <small>keys 1–6</small>
          </h2>
          <ItemSlots run={run} dispatch={dispatch} />
          <h2 className="panel__title">Process</h2>
          <dl className="kv card">
            <dt>Seed</dt>
            <dd>{run.seed}</dd>
            <dt>Tier</dt>
            <dd>
              {run.tier} · D{run.depth} (best {run.maxDepthReached})
            </dd>
            <dt>Quota</dt>
            <dd className={run.quota.met ? "good" : "warn"}>
              {run.quota.done}/{run.quota.required}
              {run.quota.met ? " — gate open" : ""}
            </dd>
            <dt>Attack</dt>
            <dd>{run.attack}</dd>
            <dt>Power</dt>
            <dd className={run.overBudget ? "bad" : ""}>
              {run.powerDraw.toFixed(1)}/{run.powerBudget.toFixed(1)} W
            </dd>
            <dt>Cadence</dt>
            <dd>
              {formatSeconds(run.msPerTurn / 1000)}/turn
              {run.overclockTurns > 0 ? ` (OC ${run.overclockTurns}t)` : ""}
            </dd>
            <dt>Faults</dt>
            <dd>{run.enemiesRemaining} awake</dd>
            <dt>Data mined</dt>
            <dd className="good">{run.dataMined} D</dd>
            <dt>Revives</dt>
            <dd>{run.revives}</dd>
            <dt>Control</dt>
            <dd>
              {run.control}
              {run.pathPending ? " (pathing)" : ""}
            </dd>
          </dl>
          <p className="panel__hint">
            Arrows/WASD move · E interacts (mine/execute/haul/GC) · O overclocks · &quot;.&quot; waits · &quot;&gt;&quot;
            flushes on the bus gate · Tab toggles auto. Swipe, tap a cell, or tap the hero to interact on touch.
          </p>
        </>
      ) : (
        <p className="panel__hint">No process running. Hit DEPLOY to descend.</p>
      )}
      <CampaignSection campaign={campaign} />
    </div>
  );
}

export function App() {
  const hash = useHash();
  if (hash.startsWith("#/dev/render")) return <RenderDevPage />;
  return <Game />;
}

function Game() {
  const { state, visible, dispatch, lastReport, saveDriver, hydrated } = useGamePersistence();
  const run = visible.run;
  const control = run?.control ?? null;
  useKeyboard(dispatch, { control, enabled: run !== null });
  const log = useRunLog(state);

  const snapshot = useMemo(() => deriveRenderSnapshot(state), [state]);
  const [dismissedReport, setDismissedReport] = useState<AdvanceReport | null>(null);
  const offlineReport = offlineReportIsInteresting(lastReport) && lastReport !== dismissedReport ? lastReport : null;

  if (!hydrated) return <div className="loading">Booting…</div>;

  const stage =
    run && state.run ? (
      <>
        <RunHud run={run} dispatch={dispatch} />
        <div className="stage__canvas">
          <DungeonView snapshot={snapshot} onCommand={dispatch} />
          {asciiEnabled() ? <AsciiFloor run={state.run} /> : null}
          {run.status === "dead" ? <DeathReport run={state.run} /> : null}
          <div className="stage__hud">
            <TouchControls
              onCommand={dispatch}
              control={control}
              interactLabel={run.interactLabel}
              overclockTurns={run.overclockTurns}
              heat={run.heat}
              className="stage__touch"
            />
          </div>
        </div>
      </>
    ) : (
      <HubPanel state={state} visible={visible} dispatch={dispatch} />
    );

  const anyHardware = visible.hardware.some((r) => r.affordable && r.blockedReason === null);
  const anyResearch = visible.research.some((r) => r.affordable);
  const anyWatchdog = visible.watchdog.next?.affordable ?? false;

  return (
    <>
      <Layout
        header={<ResourceHud visible={visible} />}
        banner={saveDriver === "memory" ? <div className="banner">saved to memory only — progress is lost on reload</div> : null}
        stage={stage}
        alerts={{ hardware: anyHardware, research: anyResearch, system: anyWatchdog }}
        panels={{
          run: <RunPanel run={run} log={log} campaign={visible.campaign} dispatch={dispatch} />,
          hardware: <HardwarePanel visible={visible} dispatch={dispatch} />,
          research: <ResearchPanel visible={visible} dispatch={dispatch} />,
          system: <SystemPanel visible={visible} saveDriver={saveDriver} dispatch={dispatch} />,
        }}
      />
      {offlineReport ? <OfflineReturnDialog report={offlineReport} onDismiss={() => setDismissedReport(offlineReport)} /> : null}
    </>
  );
}
