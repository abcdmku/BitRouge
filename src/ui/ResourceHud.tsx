import { useEffect, useRef, useState } from "react";

export interface HudProps {
  uptimeLabel: string;
  integrity: number;
  integrityMax: number;
  creditsLabel: string;
  dataLabel: string;
  reservePct: number;
  reserveLabel: string;
  netWattsLabel: string;
  tempC: number;
}

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

  useEffect(() => {
    if (integrity >= previousIntegrity.current) {
      previousIntegrity.current = integrity;
      return;
    }
    previousIntegrity.current = integrity;
    setFlash(true);
    const timer = window.setTimeout(() => setFlash(false), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [integrity]);

  const integrityPct = integrityMax > 0 ? (integrity / integrityMax) * 100 : 0;
  const danger = integrityPct <= 35;
  const hot = tempC >= 70;

  return (
    <header className={`hud-v4 ${danger ? "is-critical" : ""}`} aria-label="System status">
      <div className="hud-v4__brand">
        <span className="brand-mark"><i /><i /><i /></span>
        <div><strong>BITROUGE</strong><small>UPTIME LAB</small></div>
      </div>

      <div className="hud-v4__uptime">
        <span>RUN UPTIME</span>
        <strong>{uptimeLabel}</strong>
        <small>KEEP THE NODE ALIVE</small>
      </div>

      <div className={`hud-v4__integrity ${flash ? "is-hit" : ""}`}>
        <div><span>INTEGRITY</span><strong>{Math.round(integrity)} / {integrityMax}</strong></div>
        <span className="bar"><i style={{ width: `${Math.max(0, Math.min(100, integrityPct))}%` }} /></span>
      </div>

      <div className="hud-v4__wallet">
        <div><span>CREDITS</span><strong>{creditsLabel}</strong></div>
        <div><span>DATA</span><strong>{dataLabel}</strong></div>
      </div>

      <div className="hud-v4__system">
        <div className="hud-v4__power">
          <span>POWER RESERVE</span>
          <span className="bar"><i style={{ width: `${Math.max(0, Math.min(100, reservePct))}%` }} /></span>
          <small>{reserveLabel} · {netWattsLabel}</small>
        </div>
        <div className={hot ? "is-hot" : ""}><span>PEAK TEMP</span><strong>{Math.round(tempC)}C</strong></div>
      </div>
    </header>
  );
}
