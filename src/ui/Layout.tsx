import { useState, type ReactNode } from "react";

export type TabId = "build" | "system" | "arch";

export const TABS: { id: TabId; label: string }[] = [
  { id: "build", label: "Build" },
  { id: "system", label: "System" },
  { id: "arch", label: "Arch" },
];

export interface LayoutProps {
  header: ReactNode;
  banner?: ReactNode;
  /** The board (BoardView) plus the backlog strip and place-mode overlay. */
  stage: ReactNode;
  /** Tab id → panel content. */
  panels: Record<TabId, ReactNode>;
  /** Tabs that should draw an attention marker (e.g. an affordable upgrade). */
  alerts?: Partial<Record<TabId, boolean>>;
  /** Controlled tab (App drives it for the crash → REFLOW → ARCH flow). */
  tab?: TabId;
  onTabChange?: (tab: TabId) => void;
  initialTab?: TabId;
}

/**
 * §2 one-screen anatomy. Portrait: HUD strip, stage (backlog + board), bottom
 * sheet with BUILD/SYSTEM/ARCH tabs. ≥900px: stage left, sheet right.
 * Geometry never moves with game status.
 */
export function Layout({ header, banner, stage, panels, alerts = {}, tab, onTabChange, initialTab = "build" }: LayoutProps) {
  const [ownTab, setOwnTab] = useState<TabId>(initialTab);
  const activeTab = tab ?? ownTab;
  const selectTab = (next: TabId) => {
    setOwnTab(next);
    onTabChange?.(next);
  };
  return (
    <div className="app">
      <div>
        {header}
        {banner}
      </div>
      <div className="app__body">
        <section className="stage" aria-label="Board">
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
                aria-selected={activeTab === t.id}
                aria-controls={`panel-${t.id}`}
                className={`tabs__tab ${alerts[t.id] ? "tabs__tab--alert" : ""}`}
                onClick={() => selectTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div role="tabpanel" id={`panel-${activeTab}`} aria-labelledby={`tab-${activeTab}`} className="sheet__panel">
            {panels[activeTab]}
          </div>
        </aside>
      </div>
    </div>
  );
}
