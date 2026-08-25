import type { ComponentKind, GameState, VisibleState } from "../game";

interface NodeStageProps {
  state: GameState;
  visible: VisibleState;
  onPulse: () => void;
  onVent: () => void;
  onShed: () => void;
  onInspect: (index: number) => void;
}

const MODULE_ORDER: ComponentKind[] = ["core", "cache", "miner", "gpu", "cooler"];

const MODULE_META: Record<
  ComponentKind,
  { label: string; short: string; sprite: string }
> = {
  core: { label: "CPU ARRAY", short: "CPU", sprite: "chip_core" },
  cache: { label: "CACHE", short: "L1", sprite: "chip_cache" },
  miner: { label: "RAM", short: "RAM", sprite: "chip_miner" },
  gpu: { label: "GPU", short: "GPU", sprite: "chip_gpu" },
  cooler: { label: "COOLING", short: "FAN", sprite: "chip_cooler" },
};

const heatTone = (heat: number) => (heat >= 90 ? "danger" : heat >= 70 ? "warn" : "ok");

export function NodeStage({
  state,
  visible,
  onPulse,
  onVent,
  onShed,
  onInspect,
}: NodeStageProps) {
  const { node, hud } = visible;
  const activeResearch = visible.research.find((row) => row.status === "active") ?? null;
  const packetCount = state.run.board.packets.length;

  const modules = MODULE_ORDER.map((kind) => {
    const sockets = state.run.board.sockets
      .map((socket, index) => ({ socket, index }))
      .filter(({ socket }) => socket.component?.kind === kind);
    const level = sockets.reduce(
      (max, { socket }) => Math.max(max, socket.component?.level ?? 0),
      0,
    );
    const heat = sockets.reduce((max, { socket }) => Math.max(max, socket.heat), 0);
    const faulted = sockets.some(({ socket }) => socket.component?.faulted);
    const powered = sockets.some(({ socket }) => socket.component?.powered && !socket.component.faulted);
    return {
      kind,
      sockets,
      level,
      heat,
      faulted,
      powered,
      installed: sockets.length > 0,
    };
  });

  return (
    <section className={`nodeview nodeview--${node.condition}`} aria-label="Active node">
      <div className="nodeview__topline">
        <div>
          <span className="eyebrow">NODE 01 / LOAD TEST {node.pressureLevel}</span>
          <h1>Starting Node</h1>
        </div>
        <div className={`condition condition--${node.condition}`}>
          <span className="condition__light" />
          <div>
            <strong>{node.conditionLabel}</strong>
            <small>{node.conditionDetail}</small>
          </div>
        </div>
      </div>

      <div className="nodeview__telemetry">
        <div className="telemetry-block">
          <span>INCOMING</span>
          <strong>{node.arrivalLabel}</strong>
          <small>next in {node.nextJobLabel}</small>
        </div>
        <div className="telemetry-block telemetry-block--wide">
          <span>QUEUE PRESSURE</span>
          <div className="queue-meter" aria-label={`${visible.backlog.length} of ${visible.backlogCap} queued`}>
            {Array.from({ length: visible.backlogCap }, (_, index) => (
              <i
                key={index}
                className={index < visible.backlog.length ? "is-full" : ""}
              />
            ))}
          </div>
          <small>{visible.backlog.length}/{visible.backlogCap} jobs waiting</small>
        </div>
        <div className="telemetry-block">
          <span>THROUGHPUT</span>
          <strong>{node.clockLabel}</strong>
          <small>{hud.dutyLabel} duty</small>
        </div>
      </div>

      <div className="machine" aria-label="Installed hardware">
        <div className="machine__bus">
          <span className="machine__bus-label">JOB BUS</span>
          <div className={`data-stream ${packetCount > 0 ? "is-live" : ""}`}>
            {Array.from({ length: Math.min(6, Math.max(1, packetCount)) }, (_, index) => (
              <i key={index} style={{ animationDelay: `${index * -0.42}s` }} />
            ))}
          </div>
          <span className="machine__bus-label">OUTPUT</span>
        </div>

        <div className="machine__modules">
          {modules.map((module) => {
            const meta = MODULE_META[module.kind];
            const inspectIndex = module.sockets[0]?.index;
            return (
              <button
                key={module.kind}
                type="button"
                className={`machine-module ${module.installed ? "is-installed" : "is-empty"} ${
                  module.faulted ? "is-faulted" : ""
                }`}
                disabled={!module.installed}
                onClick={() => inspectIndex !== undefined && onInspect(inspectIndex)}
              >
                <span
                  className={`pixel-chip pixel-chip--${module.kind}`}
                  style={{ backgroundImage: `url(/assets/gen/single/${meta.sprite}.png)` }}
                />
                <span className="machine-module__copy">
                  <strong>{meta.label}</strong>
                  {module.installed ? (
                    <>
                      <small>
                        {module.sockets.length > 1 ? `${module.sockets.length}x · ` : ""}L{module.level} · {module.powered ? "ON" : "OFF"}
                      </small>
                      <span className={`heatline heatline--${heatTone(module.heat)}`}>
                        <i style={{ width: `${Math.min(100, module.heat)}%` }} />
                      </span>
                      <small>{module.faulted ? "FAULT · TAP TO REPAIR" : `${Math.round(module.heat)}C`}</small>
                    </>
                  ) : (
                    <small>NOT INSTALLED</small>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        <div className="machine__support">
          <div className="support-card">
            <span>POWER</span>
            <strong>{hud.generationW} W / {hud.drawW} W</strong>
            <small>{hud.netWattsLabel} net · {hud.reserveLabel}</small>
          </div>
          <div className="support-card">
            <span>AUTOMATION</span>
            <strong>{node.bufferLabel.split(" · ")[0]}</strong>
            <small>{node.bufferLabel.includes(" · ") ? node.bufferLabel.split(" · ")[1] : "offline work enabled"}</small>
          </div>
        </div>
      </div>

      {activeResearch ? (
        <div className="active-research">
          <div>
            <span className="eyebrow">R&D SLOT</span>
            <strong>{activeResearch.name}</strong>
          </div>
          <div className="active-research__progress">
            <span><i style={{ width: `${activeResearch.progress * 100}%` }} /></span>
            <small>{activeResearch.blockedReason}</small>
          </div>
        </div>
      ) : null}

      <div className="interventions" aria-label="Manual controls">
        <button type="button" className="intervention intervention--primary" disabled={!node.canPulse} onClick={onPulse}>
          <span className="intervention__key">01</span>
          <span><strong>PROCESS NOW</strong><small>advance one job · no power</small></span>
        </button>
        <button type="button" className="intervention" disabled={!node.canVent} onClick={onVent}>
          <span className="intervention__key">02</span>
          <span><strong>VENT HEAT</strong><small>{node.ventCooldownLabel ? `ready in ${node.ventCooldownLabel}` : "-25C · 8s reset"}</small></span>
        </button>
        <button type="button" className="intervention" disabled={!node.canShed} onClick={onShed}>
          <span className="intervention__key">03</span>
          <span><strong>SHED LOAD</strong><small>discard 3 oldest jobs</small></span>
        </button>
      </div>
    </section>
  );
}
