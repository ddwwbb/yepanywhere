import { useState, useCallback, useSyncExternalStore } from "react";
import { Radio, Send, MessageSquare, Smile, MessageCircle } from "lucide-react";
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
  icon: "radio" | "telegram" | "feishu" | "discord" | "qq" | "weixin";
}

const SIDEBAR_ITEMS: SidebarItem[] = [
  { id: "bridge", labelKey: "bridge.overview", icon: "radio" },
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
  const props = { size: 16, strokeWidth: 2 };
  switch (icon) {
    case "radio":
      return <Radio {...props} />;
    case "telegram":
      return <Send {...props} />;
    case "feishu":
      return <MessageSquare {...props} />;
    case "qq":
      return <Smile {...props} />;
    case "weixin":
      return <MessageCircle {...props} />;
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
