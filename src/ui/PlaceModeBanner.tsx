/**
 * Place-mode banner overlaid on the board — spec §6 item 3:
 * "place-mode banner (\"TAP A SOCKET TO PLACE — tap here to cancel\")".
 */
export interface PlaceModeBannerProps {
  /** Component name being placed, e.g. "CACHE". */
  componentName: string;
  onCancel: () => void;
}

export function PlaceModeBanner({ componentName, onCancel }: PlaceModeBannerProps) {
  return (
    <button type="button" className="place-banner" onClick={onCancel}>
      TAP A SOCKET TO PLACE {componentName} — tap here to cancel
    </button>
  );
}
