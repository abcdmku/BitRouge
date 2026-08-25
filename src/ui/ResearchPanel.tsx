import type { FirmwareId, ResearchId, VisibleState, VisibleSystemRow } from "../game";

interface ResearchPanelProps {
  visible: VisibleState;
  onStart: (id: ResearchId) => void;
  onFirmware: (id: FirmwareId) => void;
}

const BRANCH_LABEL = {
  compute: "COMPUTE",
  automation: "AUTOMATION",
  system: "SYSTEMS",
  tier: "CPU TIERS",
};

const RESEARCH_ORDER: ResearchId[] = [
  "decodeLogic",
  "cacheMapping",
  "benchmarkHarness",
  "multiCore",
  "localScheduler",
  "ramControl",
  "systemBus",
  "cronScheduler",
  "systemScheduler",
  "thermalControl",
  "specializedCompute",
  "cpuTierKhz",
  "cpuTierMhz",
  "cpuTierGhz",
];

export function ResearchPanel({ visible, onStart, onFirmware }: ResearchPanelProps) {
  const firmware = visible.system.filter((row) => row.isFirmware) as Array<
    VisibleSystemRow & { id: FirmwareId }
  >;
  return (
    <div className="control-panel research-panel">
      <div className="panel-intro">
        <span className="eyebrow">ONE ACTIVE SLOT</span>
        <h2>Research</h2>
        <p>Completed jobs advance R&D. Better hardware finishes the same project sooner.</p>
      </div>

      <div className="research-tree">
        {[...visible.research]
          .sort((a, b) => RESEARCH_ORDER.indexOf(a.id) - RESEARCH_ORDER.indexOf(b.id))
          .map((row) => (
          <article
            key={row.id}
            className={`research-card research-card--${row.status}`}
          >
            <div className="research-card__rail"><i /></div>
            <div className="research-card__body">
              <div className="research-card__head">
                <span>{BRANCH_LABEL[row.branch]}</span>
                <strong>{row.status.toUpperCase()}</strong>
              </div>
              <h3>{row.name}</h3>
              <p>{row.description}</p>
              <div className="research-card__meta">
                <span>{row.costLabel}</span>
                <span>{row.workLabel}</span>
              </div>
              {row.status === "active" || row.status === "completed" ? (
                <div className="research-progress">
                  <span><i style={{ width: `${row.progress * 100}%` }} /></span>
                  <small>{row.blockedReason ?? "COMPLETE"}</small>
                </div>
              ) : null}
              {row.status !== "completed" && row.status !== "active" ? (
                <button
                  type="button"
                  className="research-button"
                  disabled={!row.affordable}
                  onClick={() => onStart(row.id)}
                >
                  {row.blockedReason ?? (row.affordable ? "START RESEARCH" : "NEED RESOURCES")}
                </button>
              ) : null}
            </div>
          </article>
          ))}
      </div>

      <section className="panel-section firmware-section">
        <h3>FIRMWARE</h3>
        <div className="system-upgrades">
          {firmware.map((row) => (
            <button
              key={row.id}
              type="button"
              className="system-upgrade"
              disabled={row.owned || !row.affordable || row.lockedReason !== null}
              onClick={() => onFirmware(row.id)}
            >
              <span className="system-upgrade__copy"><strong>{row.label}</strong><small>{row.flavor}</small></span>
              <span className="system-upgrade__cost">
                {row.owned ? "INSTALLED" : row.lockedReason ?? `${row.costLabel} DATA`}
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
