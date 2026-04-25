import { useState, useCallback, useSyncExternalStore } from "react";
import { useI18n } from "../i18n";
import { PageHeader } from "../components/PageHeader";
import { useNavigationLayout } from "../layouts";
import { BridgeSection } from "../components/bridge/BridgeSection";
import { FeishuBridgeSection } from "../components/bridge/FeishuBridgeSection";
import { TelegramBridgeSection } from "../components/bridge/TelegramBridgeSection";
import { QqBridgeSection } from "../components/bridge/QqBridgeSection";
import { WeixinBridgeSection } from "../components/bridge/WeixinBridgeSection";

type Section = "bridge" | "feishu" | "telegram" | "qq" | "weixin";

interface SidebarItem {
  id: Section;
  labelKey: string;
  icon: "wifi" | "telegram" | "feishu" | "discord" | "qq" | "weixin";
}

const SIDEBAR_ITEMS: SidebarItem[] = [
  { id: "bridge", labelKey: "bridge.overview", icon: "wifi" },
  { id: "feishu", labelKey: "bridge.feishuSettings", icon: "feishu" },
  { id: "telegram", labelKey: "bridge.telegramSettings", icon: "telegram" },
  { id: "qq", labelKey: "bridge.qqSettings", icon: "qq" },
  { id: "weixin", labelKey: "bridge.weixinSettings", icon: "weixin" },
];

function getSectionFromHash(): Section {
  if (typeof window === "undefined") return "bridge";
  const hash = window.location.hash.replace("#", "");
  if (SIDEBAR_ITEMS.some((item) => item.id === hash)) {
    return hash as Section;
  }
  return "bridge";
}

function subscribeToHash(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}

function NavIcon({ icon }: { icon: SidebarItem["icon"] }) {
  switch (icon) {
    case "wifi":
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.55a11 11 0 0 1 14.08 0" /><path d="M1.42 9a16 16 0 0 1 21.16 0" /><path d="M8.53 16.11a6 6 0 0 1 6.95 0" /><line x1="12" y1="20" x2="12.01" y2="20" />
        </svg>
      );
    case "telegram":
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21.2 4.6L2.4 11.1c-.8.3-.8.8 0 1l4.5 1.7 2 6.3c.2.6.5.7.9.4l2.7-2.2 4.5 3.3c.5.3.9.2 1-.5l3.5-15.5c.2-.8-.3-1.2-1-.9z" />
        </svg>
      );
    case "feishu":
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      );
    case "qq":
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" />
        </svg>
      );
    case "weixin":
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      );
    default:
      return null;
  }
}

export function BridgePage() {
  const { t } = useI18n();
  const { openSidebar, isWideScreen, toggleSidebar, isSidebarCollapsed } =
    useNavigationLayout();
  const hashSection = useSyncExternalStore(subscribeToHash, getSectionFromHash, () => "bridge" as Section);
  const [overrideSection, setOverrideSection] = useState<Section | null>(null);
  const activeSection = overrideSection ?? hashSection;

  const handleSectionChange = useCallback((section: Section) => {
    setOverrideSection(section);
    window.history.replaceState(null, "", `/bridge#${section}`);
    queueMicrotask(() => setOverrideSection(null));
  }, []);

  const renderSection = () => {
    switch (activeSection) {
      case "bridge":
        return <BridgeSection />;
      case "feishu":
        return <FeishuBridgeSection />;
      case "telegram":
        return <TelegramBridgeSection />;
      case "qq":
        return <QqBridgeSection />;
      case "weixin":
        return <WeixinBridgeSection />;
      default:
        return <BridgeSection />;
    }
  };

  return (
    <div className="main-content-wrapper">
      <div className="main-content-constrained">
        <PageHeader
          title={t("bridge.title")}
          onOpenSidebar={openSidebar}
          onToggleSidebar={toggleSidebar}
          isWideScreen={isWideScreen}
          isSidebarCollapsed={isSidebarCollapsed}
        />
        <main className="page-scroll-container">
          <div className="bridge-page-content">
            <p className="bridge-description">{t("bridge.description")}</p>
            <div className="bridge-layout">
              <nav className="bridge-sidebar-nav">
                {SIDEBAR_ITEMS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`bridge-nav-item ${activeSection === item.id ? "active" : ""}`}
                    onClick={() => handleSectionChange(item.id)}
                  >
                    <NavIcon icon={item.icon} />
                    <span>{t(item.labelKey as Parameters<typeof t>[0])}</span>
                  </button>
                ))}
              </nav>
              <div className="bridge-content-panel">
                {renderSection()}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
