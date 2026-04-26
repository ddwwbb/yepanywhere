import { MessageCircle, MessageSquare, Radio, Send, Smile } from "lucide-react";
import { useCallback, useState, useSyncExternalStore } from "react";
import { PageHeader } from "../components/PageHeader";
import { PageHero } from "../components/PageHero";
import { BridgeSection } from "../components/bridge/BridgeSection";
import { FeishuBridgeSection } from "../components/bridge/FeishuBridgeSection";
import { QqBridgeSection } from "../components/bridge/QqBridgeSection";
import { TelegramBridgeSection } from "../components/bridge/TelegramBridgeSection";
import { WeixinBridgeSection } from "../components/bridge/WeixinBridgeSection";
import { useI18n } from "../i18n";
import { useNavigationLayout } from "../layouts";

type Section = "bridge" | "feishu" | "telegram" | "qq" | "weixin";

interface SidebarItem {
  id: Section;
  labelKey: string;
  descriptionKey: string;
  icon: "radio" | "telegram" | "feishu" | "discord" | "qq" | "weixin";
}

const OVERVIEW_SIDEBAR_ITEM: SidebarItem = {
  id: "bridge",
  labelKey: "bridge.overview",
  descriptionKey: "bridge.description",
  icon: "radio",
};

const SIDEBAR_ITEMS: SidebarItem[] = [
  OVERVIEW_SIDEBAR_ITEM,
  {
    id: "feishu",
    labelKey: "bridge.feishuSettings",
    descriptionKey: "remoteChannelsFeishuEnableDescription",
    icon: "feishu",
  },
  {
    id: "telegram",
    labelKey: "bridge.telegramSettings",
    descriptionKey: "remoteChannelsTelegramEnableDescription",
    icon: "telegram",
  },
  {
    id: "qq",
    labelKey: "bridge.qqSettings",
    descriptionKey: "remoteChannelsQqEnableDescription",
    icon: "qq",
  },
  {
    id: "weixin",
    labelKey: "bridge.weixinSettings",
    descriptionKey: "remoteChannelsWeixinEnableDescription",
    icon: "weixin",
  },
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
  const hashSection = useSyncExternalStore(
    subscribeToHash,
    getSectionFromHash,
    () => "bridge" as Section,
  );
  const [overrideSection, setOverrideSection] = useState<Section | null>(null);
  const activeSection = overrideSection ?? hashSection;
  const activeItem =
    SIDEBAR_ITEMS.find((item) => item.id === activeSection) ??
    OVERVIEW_SIDEBAR_ITEM;
  const activeLabel = t(activeItem.labelKey as Parameters<typeof t>[0]);
  const activeDescription = t(
    activeItem.descriptionKey as Parameters<typeof t>[0],
  );

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
          <div className="page-content-inner bridge-page-content">
            <PageHero
              eyebrow={t("pageHeroRuntime" as never)}
              title={t("bridge.title")}
              description={t("bridge.description")}
              icon={<Radio size={22} strokeWidth={2} aria-hidden="true" />}
              metrics={[
                {
                  label: t("pageHeroBridgeChannels" as never),
                  value: SIDEBAR_ITEMS.length - 1,
                  tone: "brand",
                },
                {
                  label: t("pageHeroBridgeCurrent" as never),
                  value: activeLabel,
                },
              ]}
            />
            <div className="bridge-layout">
              <nav className="bridge-sidebar-nav">
                {SIDEBAR_ITEMS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`bridge-nav-item ${activeSection === item.id ? "active" : ""}`}
                    onClick={() => handleSectionChange(item.id)}
                  >
                    <span className="bridge-nav-item__icon">
                      <NavIcon icon={item.icon} />
                    </span>
                    <span className="bridge-nav-item__text">
                      <span className="bridge-nav-item__label">
                        {t(item.labelKey as Parameters<typeof t>[0])}
                      </span>
                      <span className="bridge-nav-item__description">
                        {t(item.descriptionKey as Parameters<typeof t>[0])}
                      </span>
                    </span>
                  </button>
                ))}
              </nav>
              <div className="bridge-content-panel bridge-detail-page">
                <PageHero
                  eyebrow={t("pageHeroRuntime" as never)}
                  title={activeLabel}
                  description={activeDescription}
                  icon={<NavIcon icon={activeItem.icon} />}
                  compact
                />
                {renderSection()}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
