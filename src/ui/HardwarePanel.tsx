import type {
  ComponentKind,
  VisibleBuildRow,
  VisibleState,
  VisibleSystemRow,
} from "../game";

interface HardwarePanelProps {
  visible: VisibleState;
  onComponent: (kind: ComponentKind, action: "install" | "upgrade") => void;
  onSystem: (id: VisibleSystemRow["id"]) => void;
}

const GROUPS: Array<{ label: string; kinds: ComponentKind[] }> = [
  { label: "COMPUTE", kinds: ["core", "cache", "gpu"] },
  { label: "MEMORY & THERMALS", kinds: ["miner", "cooler"] },
];

function ComponentUpgrade({
  row,
  visible,
  onComponent,
}: {
  row: VisibleBuildRow;
  visible: VisibleState;
  onComponent: HardwarePanelProps["onComponent"];
}) {
  const installed = visible.popovers.filter(
    (popover) => popover?.kind === row.kind,
  );
  const upgrade = installed
    .filter((popover) => popover !== null)
    .sort((a, b) => a.level - b.level)[0] ?? null;
  return (
    <article
      className={`hardware-card ${row.owned === 0 && row.lockedReason ? "is-locked" : ""}`}
    >
      <div className="hardware-card__head">
        <div>
          <span className="eyebrow">{row.kind === "miner" ? "MEMORY" : row.kind.toUpperCase()}</span>
          <h3>{row.label}</h3>
        </div>
        <span className="level-badge">{row.owned > 0 ? `${row.owned} INSTALLED` : "EMPTY"}</span>
      </div>
      <p>{row.flavor}</p>
      {row.lockedReason ? (
        <div className="locked-line">
          {row.owned > 0 ? `ADD MODULE: ${row.lockedReason}` : row.lockedReason}
        </div>
      ) : null}
      <div className="hardware-card__actions">
        {upgrade ? (
          <button
            type="button"
            className="upgrade-button"
            disabled={!upgrade.upgradeAffordable}
            onClick={() => onComponent(row.kind, "upgrade")}
          >
            <span>UPGRADE TO L{upgrade.level + 1}</span>
            <strong>{upgrade.upgradeCostLabel} CR</strong>
          </button>
        ) : null}
        <button
          type="button"
          className="upgrade-button upgrade-button--secondary"
          disabled={!row.affordable || row.lockedReason !== null}
          onClick={() => onComponent(row.kind, "install")}
        >
          <span>{row.owned > 0 ? "ADD MODULE" : "INSTALL"}</span>
          <strong>{row.costLabel} CR</strong>
        </button>
      </div>
    </article>
  );
}

export function HardwarePanel({ visible, onComponent, onSystem }: HardwarePanelProps) {
  const hardware = visible.system.filter((row) => !row.isFirmware);
  return (
    <div className="control-panel hardware-panel">
      <div className="panel-intro">
        <span className="eyebrow">NODE WORKSHOP</span>
        <h2>Hardware</h2>
        <p>Buy the bottleneck. Faster parts raise output, but power draw and heat rise with them.</p>
      </div>

      <div className="power-summary">
        <div><span>GENERATION</span><strong>{visible.hud.generationW} W</strong></div>
        <div><span>DRAW</span><strong>{visible.hud.drawW} W</strong></div>
        <div><span>DUTY</span><strong>{visible.hud.dutyLabel}</strong></div>
      </div>

      <section className="panel-section">
        <h3>BASE SYSTEM</h3>
        <div className="system-upgrades">
          {hardware.map((row) => (
            <button
              type="button"
              key={row.id}
              className={`system-upgrade ${row.glow ? "can-buy" : ""}`}
              disabled={!row.affordable || row.lockedReason !== null}
              onClick={() => onSystem(row.id)}
            >
              <span className="system-upgrade__level">L{row.level}</span>
              <span className="system-upgrade__copy"><strong>{row.label}</strong><small>{row.flavor}</small></span>
              <span className="system-upgrade__cost">
                {row.lockedReason ?? `${row.costLabel} CR`}
              </span>
            </button>
          ))}
        </div>
      </section>

      {GROUPS.map((group) => (
        <section className="panel-section" key={group.label}>
          <h3>{group.label}</h3>
          <div className="hardware-grid">
            {group.kinds.map((kind) => {
              const row = visible.build.find((candidate) => candidate.kind === kind);
              return row ? (
                <ComponentUpgrade
                  key={kind}
                  row={row}
                  visible={visible}
                  onComponent={onComponent}
                />
              ) : null;
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
