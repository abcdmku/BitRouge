import { useCallback, useEffect, useMemo, useState } from "react";
import {
  deriveRenderSnapshot,
  describeOfflineReport,
  PRIORITY_DEADLINE_MS,
  type ComponentKind,
  type FirmwareId,
  type GameState,
  type RenderCommand,
  type VisibleArchRow,
  type VisibleBuildRow,
  type VisiblePopover,
  type VisibleSystemRow,
} from "../game";
import { RenderDevPage } from "../dev/RenderDevPage";
import { BoardView } from "./BoardView";
import { BacklogStrip, type BacklogChip } from "./BacklogStrip";
import { ComponentPopover, type PopoverData } from "./ComponentPopover";
import { CrashReport } from "./CrashReport";
import { Layout, type TabId } from "./Layout";
import { OfflineReturnDialog, offlineReportIsInteresting } from "./OfflineReturnDialog";
import { PlaceModeBanner } from "./PlaceModeBanner";
import { ResourceHud } from "./ResourceHud";
import { ShopSheet } from "./ShopSheet";
import type { ShopRowData } from "./UpgradeRow";
import { useGamePersistence } from "./hooks/useGamePersistence";

/** Shortest absence worth a return dialog. */
const MIN_OFFLINE_REPORT_MS = 60_000;

const useHash = () => {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
};

export function App() {
  const hash = useHash();
  if (hash.startsWith("#/dev/render")) return <RenderDevPage />;
  return <Game />;
}

// ---- row adapters (selector rows → IdleBit shop rows) -----------------------

const toBuildRow = (row: VisibleBuildRow): ShopRowData => ({
  id: row.kind,
  name: row.label,
  levelLabel: row.owned > 0 ? `×${row.owned}` : "",
  effectLine: row.flavor,
  costLabel: row.costLabel,
  affordable: row.affordable,
  disabled: row.lockedReason !== null,
  reason: row.lockedReason,
  actionLabel: "PLACE",
});

const toSystemRow = (row: VisibleSystemRow): ShopRowData => ({
  id: row.id,
  name: row.label,
  levelLabel: row.isFirmware ? (row.owned ? "OWNED" : "") : `L${row.level}`,
  effectLine: row.flavor,
  costLabel: row.owned ? "" : row.costLabel,
  affordable: row.affordable,
  disabled: row.owned,
  reason: null,
  actionLabel: row.isFirmware ? "FLASH" : "BUY",
});

const toArchRow = (row: VisibleArchRow): ShopRowData => ({
  id: row.id,
  name: row.label,
  levelLabel: row.repeatable ? `×${row.timesOwned}` : row.owned ? "OWNED" : "",
  effectLine: row.flavor,
  costLabel: row.owned ? "" : row.costLabel,
  affordable: row.affordable,
  disabled: row.owned || row.lockedReason !== null,
  reason: row.lockedReason !== null ? `requires ${row.lockedReason}` : null,
  actionLabel: "BUY",
});

/** PRIORITY deadline ring share from the selector's "32s" label. */
const deadlinePctFrom = (deadlineLabel: string | null): number | null => {
  if (deadlineLabel === null) return null;
  const seconds = Number.parseInt(deadlineLabel, 10);
  if (Number.isNaN(seconds)) return null;
  return Math.max(0, Math.min(100, (seconds * 1000 * 100) / PRIORITY_DEADLINE_MS));
};

/** Hottest socket drives the HUD heat tint ("T 74C"). */
const maxHeatOf = (state: GameState): number => {
  let max = 0;
  for (const socket of state.run.board.sockets) {
    if (socket.heat > max) max = socket.heat;
  }
  return max;
};

const popoverDataFrom = (info: VisiblePopover): PopoverData => ({
  title: `${info.label} L${info.level}`,
  subtitle: `${info.drawW} W draw${info.faulted ? " · FAULTED" : ""}`,
  actions: [
    {
      id: "upgrade",
      label: info.upgradeLockedReason !== null ? `Upgrade (${info.upgradeLockedReason})` : "Upgrade",
      costLabel: info.upgradeCostLabel,
      disabled: !info.upgradeAffordable,
    },
    { id: "power", label: "Power", active: info.powered },
    { id: "sell", label: "Sell", costLabel: `+${info.sellRefundLabel}` },
  ],
});

interface PlaceModeState {
  kind: ComponentKind;
  name: string;
}

function Game() {
  const { state, visible, dispatch, offlineReport, dismissOfflineReport, saveDriver, hydrated } =
    useGamePersistence();

  const snapshot = useMemo(() => deriveRenderSnapshot(state), [state]);
  const maxHeat = useMemo(() => maxHeatOf(state), [state]);

  const [tab, setTab] = useState<TabId>("build");
  const [placeMode, setPlaceMode] = useState<PlaceModeState | null>(null);
  const [pressedSocket, setPressedSocket] = useState<number | null>(null);

  // ---- board events ---------------------------------------------------------

  const onCommand = useCallback(
    (action: RenderCommand) => {
      dispatch(action);
      if (action.type === "placeComponent") setPlaceMode(null);
    },
    [dispatch],
  );

  const onPopover = useCallback((index: number) => setPressedSocket(index), []);

  // ---- long-press popover (upgrade / sell 50% / power, §2 tap type 4) -------

  const popover = useMemo(() => {
    if (pressedSocket === null) return null;
    const info = visible.popovers[pressedSocket];
    if (!info) return null;
    return { index: pressedSocket, data: popoverDataFrom(info) };
  }, [pressedSocket, visible.popovers]);

  const onPopoverAction = useCallback(
    (actionId: string) => {
      if (!popover) return;
      const index = popover.index;
      if (actionId === "upgrade") dispatch({ type: "upgradeComponent", index });
      else if (actionId === "sell") dispatch({ type: "sellComponent", index });
      else if (actionId === "power") dispatch({ type: "togglePower", index });
      setPressedSocket(null);
    },
    [dispatch, popover],
  );

  // ---- sheet actions --------------------------------------------------------

  const onBuildAction = useCallback(
    (id: string) => {
      const row = visible.build.find((r) => r.kind === id);
      if (row) setPlaceMode({ kind: row.kind, name: row.label });
    },
    [visible.build],
  );

  const onSystemAction = useCallback(
    (id: string) => {
      const row = visible.system.find((r) => r.id === id);
      if (!row) return;
      if (row.isFirmware) dispatch({ type: "buyFirmware", id: row.id as FirmwareId });
      else dispatch({ type: "buySystem", item: row.id as "rail" | "capacitor" | "clock" });
    },
    [dispatch, visible.system],
  );

  const onArchAction = useCallback(
    (id: string) => {
      const row = visible.arch.find((r) => r.id === id);
      if (row) dispatch({ type: "buyArch", id: row.id });
    },
    [dispatch, visible.arch],
  );

  const onReflow = useCallback(() => {
    setPlaceMode(null);
    setPressedSocket(null);
    setTab("arch");
    dispatch({ type: "reflow" });
  }, [dispatch]);

  // ---- offline return (§2 idle loop) ----------------------------------------
  // hadActivity alone fires on any visibilitychange round-trip (a 27 s tab
  // switch drains a little integrity), so the dialog also requires a real
  // absence — it's the "you were gone" story, not a per-blur nag.

  const offlineVisible =
    offlineReport && offlineReport.hadActivity && offlineReport.awayMs >= MIN_OFFLINE_REPORT_MS
      ? describeOfflineReport(offlineReport, visible.backlogCap)
      : null;

  if (!hydrated) return <div className="loading">booting…</div>;

  const hud = visible.hud;
  const chips: BacklogChip[] = visible.backlog.map((task) => ({
    id: task.id,
    kind: task.kind,
    deadlinePct: task.kind === "priority" ? deadlinePctFrom(task.deadlineLabel) : null,
  }));

  const systemPower = visible.system.filter((row) => !row.isFirmware);
  const systemFirmware = visible.system.filter((row) => row.isFirmware);

  return (
    <>
      <Layout
        header={
          <ResourceHud
            uptimeLabel={hud.uptimeLabel}
            integrity={hud.integrity}
            integrityMax={hud.integrityMax}
            creditsLabel={hud.creditsLabel}
            dataLabel={hud.dataLabel}
            reservePct={hud.reserveMax > 0 ? (hud.reserveJ / hud.reserveMax) * 100 : 0}
            reserveLabel={hud.reserveLabel}
            netWattsLabel={hud.netWattsLabel}
            tempC={maxHeat}
          />
        }
        banner={
          saveDriver === "memory" ? (
            <div className="banner">saved to memory only — progress is lost on reload</div>
          ) : null
        }
        stage={
          <>
            <BacklogStrip chips={chips} cap={visible.backlogCap} />
            <div className="board">
              <BoardView
                snapshot={snapshot}
                onCommand={onCommand}
                onPopover={onPopover}
                placeMode={placeMode?.kind ?? null}
              />
              {placeMode ? (
                <PlaceModeBanner componentName={placeMode.name} onCancel={() => setPlaceMode(null)} />
              ) : null}
            </div>
          </>
        }
        alerts={{
          build: visible.build.some((row) => row.glow),
          system: visible.system.some((row) => row.glow),
          arch: visible.arch.some((row) => row.glow),
        }}
        tab={tab}
        onTabChange={setTab}
        panels={{
          build: (
            <ShopSheet
              sections={[{ title: "Components", rows: visible.build.map(toBuildRow) }]}
              onAction={onBuildAction}
              emptyLabel="No components available yet."
              hint="Tap a shop row, then a socket, to place. Tap a locked socket on the board to unlock it."
            />
          ),
          system: (
            <ShopSheet
              summary={`gen ${hud.generationW} W · draw ${hud.drawW} W · net ${hud.netWattsLabel} · duty ${hud.dutyLabel}`}
              sections={[
                { title: "Power & clock", rows: systemPower.map(toSystemRow) },
                { title: "Firmware", rows: systemFirmware.map(toSystemRow) },
              ]}
              onAction={onSystemAction}
              emptyLabel="No system upgrades yet."
            />
          ),
          arch: (
            <ShopSheet
              summary={`silicon ${hud.siliconLabel} Si · gen ${hud.gen}`}
              sections={[{ title: "Architecture", rows: visible.arch.map(toArchRow) }]}
              onAction={onArchAction}
              emptyLabel="Crash to earn Silicon — architecture survives the reflow."
              footer={
                <div className="card reflow">
                  <div className="reflow__head">
                    <span className="reflow__title">Voluntary reflow</span>
                    <span className="reflow__payout mono">+{visible.reflow.siliconPayout} Si</span>
                  </div>
                  <p className="panel__hint">
                    {visible.reflow.available
                      ? "Melt the board down now. Chips, credits and data reset — Silicon and architecture stay."
                      : "Available after 10:00 uptime. Pushing a run further pays superlinear Silicon."}
                  </p>
                  <button
                    type="button"
                    className="btn-danger reflow__button"
                    disabled={!visible.reflow.available}
                    onClick={onReflow}
                  >
                    REFLOW NOW
                  </button>
                </div>
              }
            />
          ),
        }}
      />
      {popover ? (
        <ComponentPopover data={popover.data} onAction={onPopoverAction} onClose={() => setPressedSocket(null)} />
      ) : null}
      {offlineReportIsInteresting(offlineVisible) ? (
        <OfflineReturnDialog report={offlineVisible} onDismiss={dismissOfflineReport} />
      ) : null}
      {visible.crash ? (
        <CrashReport
          uptimeLabel={visible.crash.uptimeLabel}
          tasksCompleted={visible.crash.tasksDone}
          siliconPayout={visible.crash.siliconPayout}
          damage={visible.crash.rows.map((row) => ({
            source: row.source,
            label: row.label,
            amount: row.amount,
            pct: row.percent,
          }))}
          onReflow={onReflow}
        />
      ) : null}
    </>
  );
}
