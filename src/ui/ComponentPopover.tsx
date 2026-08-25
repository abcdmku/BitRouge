/**
 * Long-press popover — spec §2 tap type (4): "long-press component = popover
 * (upgrade / sell 50% / POWER on-off)". Triggered by WS2's `BoardView` via
 * `onPopover`; App.tsx owns open/close state and feeds this component the
 * popover data straight from the selector.
 */
export interface PopoverAction {
  /** "upgrade" | "sell" | "power" | ... */
  id: string;
  label: string;
  costLabel?: string | null;
  disabled?: boolean;
  /** For the power toggle: reflects current on/off so the button reads "POWER OFF"/"POWER ON". */
  active?: boolean;
}

export interface PopoverData {
  title: string;
  subtitle?: string | null;
  actions: PopoverAction[];
  /** Screen-space anchor from the board tap, if the renderer provides one. */
  anchor?: { x: number; y: number } | null;
}

export interface ComponentPopoverProps {
  data: PopoverData;
  onAction: (actionId: string) => void;
  onClose: () => void;
}

export function ComponentPopover({ data, onAction, onClose }: ComponentPopoverProps) {
  const style = data.anchor ? { left: data.anchor.x, top: data.anchor.y } : undefined;
  return (
    <div className="popover-backdrop" onClick={onClose}>
      <div
        className="popover"
        style={style}
        role="dialog"
        aria-label={data.title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="popover__title">{data.title}</div>
        {data.subtitle ? <div className="popover__subtitle">{data.subtitle}</div> : null}
        <div className="popover__actions">
          {data.actions.map((action) => (
            <button
              key={action.id}
              type="button"
              className={`popover__action ${action.id === "sell" ? "btn-danger" : ""}`}
              disabled={action.disabled}
              onClick={() => onAction(action.id)}
            >
              <span>{action.label}</span>
              {action.active !== undefined ? (
                <span className={`chip ${action.active ? "is-green" : "is-rose"}`}>{action.active ? "on" : "off"}</span>
              ) : action.costLabel ? (
                <span className="popover__cost mono">{action.costLabel}</span>
              ) : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
