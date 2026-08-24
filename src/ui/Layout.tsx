import { useState, type ReactNode } from "react";

export type TabId = "run" | "hardware" | "research" | "system";

export const TABS: { id: TabId; label: string }[] = [
  { id: "run", label: "Run" },
  { id: "hardware", label: "Hardware" },
  { id: "research", label: "Research" },
  { id: "system", label: "System" },
];

export interface LayoutProps {
  header: ReactNode;
  banner?: ReactNode;
  /** Dungeon canvas / deploy screen plus any overlays. */
  stage: ReactNode;
  /** Tab id → panel content. */
  panels: Record<TabId, ReactNode>;
  /** Tabs that should draw an attention marker (e.g. an affordable upgrade). */
  alerts?: Partial<Record<TabId, boolean>>;
  initialTab?: TabId;
}

/**
 * Portrait: stage on top, bottom sheet with tabs below.
 * ≥900px: stage left, panel column right. Geometry never moves with game status.
 */
export function Layout({ header, banner, stage, panels, alerts = {}, initialTab = "run" }: LayoutProps) {
  const [tab, setTab] = useState<TabId>(initialTab);
  return (
    <div className="app">
      <div>
        {header}
        {banner}
      </div>
      <div className="app__body">
        <section className="stage" aria-label="Stage">
          {stage}
        </section>
        <aside className="sheet">
          <div className="tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls={`panel-${t.id}`}
                className={`tabs__tab ${alerts[t.id] ? "tabs__tab--alert" : ""}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} style={{ minHeight: 0, display: "grid" }}>
            {panels[tab]}
          </div>
        </aside>
      </div>
    </div>
  );
}
