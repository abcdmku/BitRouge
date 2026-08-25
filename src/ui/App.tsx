import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  describeOfflineReport,
  type ComponentKind,
  type FirmwareId,
  type ResearchId,
  type VisiblePopover,
  type VisibleSystemRow,
} from "../game";
import { ComponentPopover, type PopoverData } from "./ComponentPopover";
import { CrashReport } from "./CrashReport";
import { HardwarePanel } from "./HardwarePanel";
import { Layout, type TabId } from "./Layout";
import { NodeStage } from "./NodeStage";
import { OfflineReturnDialog, offlineReportIsInteresting } from "./OfflineReturnDialog";
import { ProgressPanel } from "./ProgressPanel";
import { ResearchPanel } from "./ResearchPanel";
import { ResourceHud } from "./ResourceHud";
import { useGamePersistence } from "./hooks/useGamePersistence";

const MIN_OFFLINE_REPORT_MS = 60_000;
const RenderDevPage = lazy(() =>
  import("../dev/RenderDevPage").then((module) => ({ default: module.RenderDevPage })),
);

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
  if (hash.startsWith("#/dev/render")) {
    return (
      <Suspense fallback={<div className="loading">LOADING RENDER DIAGNOSTICS...</div>}>
        <RenderDevPage />
      </Suspense>
    );
  }
  return <Game />;
}

const popoverDataFrom = (info: VisiblePopover): PopoverData => ({
  title: `${info.label} L${info.level}`,
  subtitle: `${info.drawW} W draw${info.faulted ? " · FAULTED" : ""}`,
  actions: [
    {
      id: "upgrade",
      label: info.upgradeLockedReason !== null
        ? `Upgrade · ${info.upgradeLockedReason}`
        : "Upgrade",
      costLabel: `${info.upgradeCostLabel} CR`,
      disabled: !info.upgradeAffordable,
    },
    { id: "power", label: "Power", active: info.powered },
    { id: "sell", label: "Sell", costLabel: `+${info.sellRefundLabel} CR` },
  ],
});

function Game() {
  const {
    state,
    visible,
    dispatch,
    offlineReport,
    dismissOfflineReport,
    saveDriver,
    hydrated,
  } = useGamePersistence();
  const [tab, setTab] = useState<TabId>("hardware");
  const [inspectedSocket, setInspectedSocket] = useState<number | null>(null);

  const popover = useMemo(() => {
    if (inspectedSocket === null) return null;
    const info = visible.popovers[inspectedSocket];
    return info ? { index: inspectedSocket, data: popoverDataFrom(info) } : null;
  }, [inspectedSocket, visible.popovers]);

  const onPopoverAction = useCallback(
    (actionId: string) => {
      if (!popover) return;
      const index = popover.index;
      if (actionId === "upgrade") dispatch({ type: "upgradeComponent", index });
      if (actionId === "sell") dispatch({ type: "sellComponent", index });
      if (actionId === "power") dispatch({ type: "togglePower", index });
      setInspectedSocket(null);
    },
    [dispatch, popover],
  );

  const onComponent = useCallback(
    (kind: ComponentKind, action: "install" | "upgrade") => {
      if (action === "install") {
        dispatch({ type: "installComponent", kind });
        return;
      }
      const target = visible.popovers
        .filter((candidate) => candidate?.kind === kind)
        .sort((a, b) => (a?.level ?? 0) - (b?.level ?? 0))[0];
      if (target) dispatch({ type: "upgradeComponent", index: target.index });
    },
    [dispatch, visible.popovers],
  );

  const onSystem = useCallback(
    (id: VisibleSystemRow["id"]) => {
      const row = visible.system.find((candidate) => candidate.id === id);
      if (!row || row.isFirmware) return;
      dispatch({ type: "buySystem", item: id as "rail" | "capacitor" | "clock" });
    },
    [dispatch, visible.system],
  );

  const onFirmware = useCallback(
    (id: FirmwareId) => dispatch({ type: "buyFirmware", id }),
    [dispatch],
  );

  const onResearch = useCallback(
    (id: ResearchId) => dispatch({ type: "startResearch", id }),
    [dispatch],
  );

  const onReflow = useCallback(() => {
    setInspectedSocket(null);
    setTab("evolution");
    dispatch({ type: "reflow" });
  }, [dispatch]);

  if (!hydrated) return <div className="loading">BOOTING NODE...</div>;

  const hud = visible.hud;
  const offlineVisible =
    offlineReport &&
    offlineReport.hadActivity &&
    offlineReport.awayMs >= MIN_OFFLINE_REPORT_MS
      ? describeOfflineReport(offlineReport, visible.backlogCap)
      : null;

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
            tempC={hud.maxHeat ?? 0}
          />
        }
        banner={
          saveDriver === "memory" ? (
            <div className="banner">LOCAL SAVE UNAVAILABLE · THIS SESSION WILL NOT PERSIST</div>
          ) : null
        }
        stage={
          <NodeStage
            state={state}
            visible={visible}
            onPulse={() => dispatch({ type: "pulseSystem" })}
            onVent={() => dispatch({ type: "ventSystem" })}
            onShed={() => dispatch({ type: "shedLoad" })}
            onInspect={setInspectedSocket}
          />
        }
        alerts={{
          hardware:
            visible.build.some((row) => row.glow) ||
            visible.system.some((row) => !row.isFirmware && row.glow),
          research:
            visible.research.some((row) => row.affordable) ||
            visible.system.some((row) => row.isFirmware && row.glow),
          evolution: visible.arch.some((row) => row.glow),
        }}
        tab={tab}
        onTabChange={setTab}
        panels={{
          hardware: (
            <HardwarePanel visible={visible} onComponent={onComponent} onSystem={onSystem} />
          ),
          research: (
            <ResearchPanel visible={visible} onStart={onResearch} onFirmware={onFirmware} />
          ),
          evolution: (
            <ProgressPanel
              state={state}
              visible={visible}
              onArch={(id) => dispatch({ type: "buyArch", id })}
              onReflow={onReflow}
            />
          ),
        }}
      />

      {popover ? (
        <ComponentPopover
          data={popover.data}
          onAction={onPopoverAction}
          onClose={() => setInspectedSocket(null)}
        />
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
