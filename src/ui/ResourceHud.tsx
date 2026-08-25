import { useEffect, useRef, useState } from "react";

/**
 * HUD strip — spec §2 one-screen anatomy, row 1:
 * "UP 12:41  INTEG ####._ 82  CR 1,204 / DA 18   PWR ###._ 62J -3W   T 74C"
 * uptime, integrity (flashes on damage), credits/data, power reserve bar +
 * net watts, heat-warning tint. Dense but calm — labels muted, numbers mono.
 */
export interface HudProps {
  uptimeLabel: string;
  integrity: number;
  /** Meter scale — arch perks can push max integrity past 100. */
  integrityMax: number;
  creditsLabel: string;
  dataLabel: string;
  reservePct: number; // 0..100, power reserve bar fill
  reserveLabel: string; // e.g. "62 J"
  netWattsLabel: string; // e.g. "-3 W"
  /** Hottest socket heat; ≥70 tints the strip amber. */
  tempC: number;
}

const HEAT_WARN_C = 70;
const FLASH_MS = 500;

export function ResourceHud({
  uptimeLabel,
  integrity,
  integrityMax,
  creditsLabel,
  dataLabel,
  reservePct,
  reserveLabel,
  netWattsLabel,
  tempC,
}: HudProps) {
  const [flash, setFlash] = useState(false);
  const previousIntegrity = useRef(integrity);
  const flashTimeout = useRef<number | null>(null);

  useEffect(() => {
    if (integrity < previousIntegrity.current) {
      setFlash(true);
      if (flashTimeout.current !== null) window.clearTimeout(flashTimeout.current);
      flashTimeout.current = window.setTimeout(() => setFlash(false), FLASH_MS);
    }
    previousIntegrity.current = integrity;
    return () => {
      if (flashTimeout.current !== null) window.clearTimeout(flashTimeout.current);
    };
  }, [integrity]);

  const integrityPct = integrityMax > 0 ? (integrity / integrityMax) * 100 : 0;
  const integrityTone = integrityPct <= 25 ? "is-rose" : integrityPct < 60 ? "is-amber" : "is-green";
  const heatHot = tempC >= HEAT_WARN_C;

  return (
    <header className={`hud ${heatHot ? "hud--hot" : ""}`} aria-label="System status">
      <div className="hud__row">
        <span className="hud__brand">BitRouge</span>
        <div className="metric hud__uptime">
          <strong className="mono">{uptimeLabel}</strong>
          <small>uptime</small>
        </div>
        <div className={`hud__integrity ${flash ? "hud__integrity--flash" : ""}`} aria-label="Integrity">
          <div className="hud__integrity-head">
            <small>integ</small>
            <strong className={`mono ${integrityTone}`}>{Math.round(integrity)}</strong>
          </div>
          <span className={`meter ${integrityTone}`}>
            <span className="meter__fill" style={{ width: `${Math.max(0, Math.min(100, integrityPct))}%` }} />
          </span>
        </div>
      </div>
      <div className="hud__row">
        <div className="metric is-amber">
          <strong className="mono">{creditsLabel}</strong>
          <small>cr</small>
        </div>
        <div className="metric is-cyan">
          <strong className="mono">{dataLabel}</strong>
          <small>data</small>
        </div>
        <div className="hud__pwr" aria-label="Power reserve">
          <span className="meter">
            <span className="meter__fill" style={{ width: `${Math.max(0, Math.min(100, reservePct))}%` }} />
          </span>
          <small className="mono">
            {reserveLabel} · {netWattsLabel}
          </small>
        </div>
        <div className={`metric hud__temp ${heatHot ? "is-amber" : ""}`}>
          <strong className="mono">{Math.round(tempC)}C</strong>
          <small>temp</small>
        </div>
      </div>
    </header>
  );
}
