import type { Dir, RenderCommand } from "../game/renderSnapshot";
import "./styles/touch.css";

export interface TouchControlsProps {
  onCommand: (cmd: RenderCommand) => void;
  control: "auto" | "manual" | null;
  /** Context verb for the interact button ("MINE", "DELIVER", …); null = nothing near. */
  interactLabel?: string | null;
  /** Overclock turns remaining (>0 shows the countdown). */
  overclockTurns?: number;
  /** Current heat — the OC button warns when running hot. */
  heat?: number;
  /** Show even on fine-pointer devices (dev page). */
  forceShow?: boolean;
  className?: string;
}

const DIRS: { dir: Dir; label: string; cls: string }[] = [
  { dir: "n", label: "▲", cls: "touch__dpad-n" },
  { dir: "w", label: "◀", cls: "touch__dpad-w" },
  { dir: "e", label: "▶", cls: "touch__dpad-e" },
  { dir: "s", label: "▼", cls: "touch__dpad-s" },
];

const HEAT_WARN = 6;

/**
 * On-screen d-pad + Interact / Overclock / Item / Auto-Manual. Shown on coarse
 * pointers via CSS; `forceShow` overrides. Every button dispatches a RenderCommand.
 */
export function TouchControls({
  onCommand,
  control,
  interactLabel = null,
  overclockTurns = 0,
  heat = 0,
  forceShow = false,
  className,
}: TouchControlsProps) {
  const manual = control === "manual";
  const takeThen = (cmd: RenderCommand) => {
    if (control === "auto") onCommand({ type: "takeControl" });
    onCommand(cmd);
  };
  const toggle = () => onCommand({ type: manual ? "releaseControl" : "takeControl" });

  const classes = ["touch", forceShow ? "touch--force" : "", className ?? ""].filter(Boolean).join(" ");
  const ocActive = overclockTurns > 0;
  const ocHot = heat >= HEAT_WARN;

  return (
    <div className={classes} role="group" aria-label="Touch controls">
      <div className="touch__dpad">
        {DIRS.map((d) => (
          <button
            key={d.dir}
            type="button"
            className={`touch__btn ${d.cls}`}
            aria-label={`Move ${d.dir}`}
            onPointerDown={(e) => {
              e.preventDefault();
              takeThen({ type: "heroMove", dir: d.dir });
            }}
          >
            {d.label}
          </button>
        ))}
        <button
          type="button"
          className="touch__btn touch__dpad-c"
          aria-label="Wait"
          onPointerDown={(e) => {
            e.preventDefault();
            takeThen({ type: "heroWait" });
          }}
        >
          {"·"}
        </button>
      </div>
      <div className="touch__actions">
        <button
          type="button"
          className={`touch__btn touch__action touch__interact ${interactLabel ? "touch__interact--live" : ""}`}
          aria-label={interactLabel ? `Interact: ${interactLabel.toLowerCase()}` : "Interact"}
          disabled={!interactLabel}
          onPointerDown={(e) => {
            e.preventDefault();
            takeThen({ type: "interact" });
          }}
        >
          {interactLabel ?? "USE"}
        </button>
        <button
          type="button"
          className={`touch__btn touch__action touch__oc ${ocActive ? "touch__oc--active" : ""} ${ocHot ? "touch__oc--hot" : ""}`}
          aria-label="Overclock"
          disabled={ocActive}
          onPointerDown={(e) => {
            e.preventDefault();
            onCommand({ type: "overclock" });
          }}
        >
          {ocActive ? `OC ${overclockTurns}t` : ocHot ? "OC ⚠" : "OC"}
        </button>
        <button
          type="button"
          className="touch__btn touch__action"
          aria-label="Use item 1"
          onPointerDown={(e) => {
            e.preventDefault();
            onCommand({ type: "useItem", slot: 0 });
          }}
        >
          Item
        </button>
        <button
          type="button"
          className={`touch__btn touch__action touch__mode ${manual ? "touch__mode--manual" : "touch__mode--auto"}`}
          aria-pressed={manual}
          aria-label={manual ? "Switch to auto" : "Take manual control"}
          onPointerDown={(e) => {
            e.preventDefault();
            toggle();
          }}
        >
          {manual ? "Manual" : "Auto"}
        </button>
      </div>
    </div>
  );
}
