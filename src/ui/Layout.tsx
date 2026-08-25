import { useEffect, useRef, useState, type ReactNode } from "react";

export type TabId = "hardware" | "research" | "evolution";

export const TABS: { id: TabId; label: string }[] = [
  { id: "hardware", label: "Hardware" },
  { id: "research", label: "Research" },
  { id: "evolution", label: "Evolution" },
];

export interface LayoutProps {
  header: ReactNode;
  banner?: ReactNode;
  /** The active node and its intervention controls. */
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
 * Fixed one-screen anatomy. Compact screens swap between the node and three
 * panels with bottom navigation. Wide screens keep the node and panel side by side.
 * Geometry never moves with game status.
 */
export function Layout({ header, banner, stage, panels, alerts = {}, tab, onTabChange, initialTab = "hardware" }: LayoutProps) {
  const [ownTab, setOwnTab] = useState<TabId>(initialTab);
  const [mobileView, setMobileView] = useState<"node" | TabId>("node");
  const previousControlledTab = useRef(tab);
  const activeTab = tab ?? ownTab;
  const selectTab = (next: TabId) => {
    setOwnTab(next);
    setMobileView(next);
    onTabChange?.(next);
  };

  useEffect(() => {
    if (tab !== undefined && tab !== previousControlledTab.current) {
      setMobileView(tab);
    }
    previousControlledTab.current = tab;
  }, [tab]);

  return (
    <div className="app">
      <div>
        {header}
        {banner}
      </div>
      <div className={`app__body app__body--${mobileView}`}>
        <section className="stage" aria-label="Active node">
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
      <nav className="mobile-nav" aria-label="Game views">
        <button
          type="button"
          aria-current={mobileView === "node" ? "page" : undefined}
          onClick={() => setMobileView("node")}
        >
          <span>01</span>Node
        </button>
        {TABS.map((item, index) => (
          <button
            key={item.id}
            type="button"
            aria-current={mobileView === item.id ? "page" : undefined}
            className={alerts[item.id] ? "is-alert" : ""}
            onClick={() => selectTab(item.id)}
          >
            <span>0{index + 2}</span>{item.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
