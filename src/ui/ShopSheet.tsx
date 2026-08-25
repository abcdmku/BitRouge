import type { ReactNode } from "react";
import { UpgradeRow, type ShopRowData } from "./UpgradeRow";

/**
 * Generic bottom-sheet tab body shared by BUILD / SYSTEM / ARCH — spec §6
 * item 4. Each tab is just a set of titled sections of shop rows "driven
 * entirely by selector rows"; SYSTEM adds a one-line power summary above.
 */
export interface ShopSection {
  title: string;
  rows: ShopRowData[];
}

export interface ShopSheetProps {
  sections: ShopSection[];
  onAction: (id: string) => void;
  emptyLabel?: string;
  /** SYSTEM tab: e.g. "GEN 12W  DRAW 15W  NET -3W". */
  summary?: string | null;
  /** One quiet line under the rows (e.g. BUILD's "tap a locked socket…"). */
  hint?: string | null;
  /** Extra block below everything (e.g. ARCH's voluntary REFLOW). */
  footer?: ReactNode;
}

export function ShopSheet({ sections, onAction, emptyLabel = "Nothing here yet.", summary = null, hint = null, footer = null }: ShopSheetProps) {
  const hasRows = sections.some((section) => section.rows.length > 0);
  return (
    <div className="panel">
      {summary ? <p className="sheet__summary mono">{summary}</p> : null}
      {!hasRows ? <p className="panel__hint">{emptyLabel}</p> : null}
      {sections.map((section) =>
        section.rows.length === 0 ? null : (
          <section key={section.title} className="sheet__section">
            <h2 className="panel__title">{section.title}</h2>
            <div className="sheet__rows">
              {section.rows.map((row) => (
                <UpgradeRow key={row.id} row={row} onAction={onAction} />
              ))}
            </div>
          </section>
        ),
      )}
      {hint ? <p className="panel__hint">{hint}</p> : null}
      {footer}
    </div>
  );
}
