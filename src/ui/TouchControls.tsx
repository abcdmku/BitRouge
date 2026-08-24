import type { Dir, RenderCommand } from "../game/renderSnapshot";
import "./styles/touch.css";

export interface TouchControlsProps {
  onCommand: (cmd: RenderCommand) => void;
  control: "auto" | "manual" | null;
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

/**
 * On-screen d-pad + Wait / Item / Auto-Manual. Shown on coarse pointers via
 * CSS; `forceShow` overrides. Every button dispatches a RenderCommand.
 */
export function TouchControls({ onCommand, control, forceShow = false, className }: TouchControlsProps) {
  const manual = control === "manual";
  const move = (dir: Dir) => {
    if (control === "auto") onCommand({ type: "takeControl" });
    onCommand({ type: "heroMove", dir });
  };
  const wait = () => {
    if (control === "auto") onCommand({ type: "takeControl" });
    onCommand({ type: "heroWait" });
  };
  const toggle = () => onCommand({ type: manual ? "releaseControl" : "takeControl" });

  const classes = ["touch", forceShow ? "touch--force" : "", className ?? ""].filter(Boolean).join(" ");

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
              move(d.dir);
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
            wait();
          }}
        >
          {"·"}
        </button>
      </div>
      <div className="touch__actions">
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
          className="touch__btn touch__action"
          aria-label="Descend"
          onPointerDown={(e) => {
            e.preventDefault();
            if (control === "auto") onCommand({ type: "takeControl" });
            onCommand({ type: "descend" });
          }}
        >
          Down
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
