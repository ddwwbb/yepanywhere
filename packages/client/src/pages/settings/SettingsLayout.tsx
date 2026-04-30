import { Settings, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "../../components/PageHeader";
import { PageHero } from "../../components/PageHero";
import { useReloadNotifications } from "../../hooks/useReloadNotifications";
import { useRemoteBasePath } from "../../hooks/useRemoteBasePath";
import { useVersion } from "../../hooks/useVersion";
import { useI18n } from "../../i18n";
import {
  getDevelopmentCategory,
  getEmulatorCategory,
  getSettingsCategories,
} from "../../i18n-settings";
import { useNavigationLayout } from "../../layouts";
import { AboutSettings } from "./AboutSettings";
import { AgentContextSettings } from "./AgentContextSettings";
import { AppearanceSettings } from "./AppearanceSettings";
import { DevelopmentSettings } from "./DevelopmentSettings";
import { DevicesSettings } from "./DevicesSettings";
import { EmulatorSettings } from "./EmulatorSettings";
import { LifecycleWebhooksSettings } from "./LifecycleWebhooksSettings";
import { LocalAccessSettings } from "./LocalAccessSettings";
import { ModelSettings } from "./ModelSettings";
import { NotificationsSettings } from "./NotificationsSettings";
import { ProvidersSettings } from "./ProvidersSettings";
import { RemoteAccessSettings } from "./RemoteAccessSettings";
import { RemoteExecutorsSettings } from "./RemoteExecutorsSettings";
import type { SettingsCategory } from "./types";

// Map category IDs to their components
const CATEGORY_COMPONENTS: Record<string, React.ComponentType> = {
  appearance: AppearanceSettings,
  model: ModelSettings,
  "agent-context": AgentContextSettings,
  notifications: NotificationsSettings,
  webhooks: LifecycleWebhooksSettings,
  devices: DevicesSettings,
  "local-access": LocalAccessSettings,
  remote: RemoteAccessSettings,
  providers: ProvidersSettings,
  "remote-executors": RemoteExecutorsSettings,
  emulator: EmulatorSettings,
  about: AboutSettings,
  development: DevelopmentSettings,
};

interface SettingsCategoryItemProps {
  category: SettingsCategory;
  isActive: boolean;
  onClick: () => void;
}

function SettingsCategoryItem({
  category,
  isActive,
  onClick,
}: SettingsCategoryItemProps) {
  return (
    <button
      type="button"
      className={`settings-category-item ${isActive ? "active" : ""}`}
      onClick={onClick}
    >
      <span className="settings-category-icon">{category.icon}</span>
      <div className="settings-category-text">
        <span className="settings-category-label">{category.label}</span>
        <span className="settings-category-description">
          {category.description}
        </span>
      </div>
      <span className="settings-category-chevron">›</span>
    </button>
  );
}

export function SettingsLayout() {
  const { t } = useI18n();
  const { category } = useParams<{ category?: string }>();
  const navigate = useNavigate();
  const basePath = useRemoteBasePath();
  const { openSidebar, isWideScreen, toggleSidebar, isSidebarCollapsed } =
    useNavigationLayout();
  const { isManualReloadMode } = useReloadNotifications();
  const { version: versionInfo } = useVersion();
  const [settingsQuery, setSettingsQuery] = useState("");
  const capabilities = useMemo(
    () => versionInfo?.capabilities ?? [],
    [versionInfo?.capabilities],
  );

  const categories = useMemo<SettingsCategory[]>(() => {
    const items = [...getSettingsCategories((key) => t(key as never))];
    if (
      capabilities.includes("deviceBridge") ||
      capabilities.includes("deviceBridge-download") ||
      capabilities.includes("deviceBridge-available")
    ) {
      const aboutIndex = items.findIndex((c) => c.id === "about");
      items.splice(
        aboutIndex >= 0 ? aboutIndex : items.length,
        0,
        getEmulatorCategory((key) => t(key as never)),
      );
    }
    if (isManualReloadMode) {
      items.push(getDevelopmentCategory((key) => t(key as never)));
    }
    return items;
  }, [capabilities, isManualReloadMode, t]);

  // On wide screen, default to first category if none selected
  const effectiveCategory =
    category || (isWideScreen ? categories[0]?.id : undefined);

  const handleCategoryClick = (categoryId: string) => {
    navigate(`${basePath}/settings/${categoryId}`);
  };

  const handleBack = () => {
    navigate(`${basePath}/settings`);
  };

  // Get the component for the current category
  const CategoryComponent = effectiveCategory
    ? CATEGORY_COMPONENTS[effectiveCategory]
    : null;
  const currentCategory = categories.find((c) => c.id === effectiveCategory);
  const filteredCategories = useMemo(() => {
    const query = settingsQuery.trim().toLocaleLowerCase();
    if (!query) return categories;
    return categories.filter((cat) => {
      const haystack = `${cat.label} ${cat.description}`.toLocaleLowerCase();
      return haystack.includes(query);
    });
  }, [categories, settingsQuery]);
  const detailHeroIcon = currentCategory?.icon ?? (
    <SlidersHorizontal size={22} strokeWidth={2} aria-hidden="true" />
  );

  // Mobile: category list OR category detail (not both)
  if (!isWideScreen) {
    if (!category) {
      // Show category list
      return (
        <div className="main-content-mobile">
          <div className="main-content-mobile-inner">
            <PageHeader
              title={t("pageTitleSettings")}
              onOpenSidebar={openSidebar}
              onToggleSidebar={toggleSidebar}
              isWideScreen={isWideScreen}
              isSidebarCollapsed={isSidebarCollapsed}
            />
            <main className="page-scroll-container">
              <div className="page-content-inner">
                <PageHero
                  title={t("pageTitleSettings")}
                  icon={
                    <Settings size={22} strokeWidth={2} aria-hidden="true" />
                  }
                  metrics={[
                    {
                      label: t("pageHeroSettingsSections"),
                      value: categories.length,
                      tone: "brand",
                    },
                  ]}
                  compact
                />
                <div className="settings-command-search">
                  <input
                    type="search"
                    value={settingsQuery}
                    onChange={(event) => setSettingsQuery(event.target.value)}
                    placeholder={t("settingsSearchPlaceholder")}
                    aria-label={t("settingsSearchPlaceholder")}
                  />
                </div>
                <div className="settings-category-list settings-command-list">
                  {filteredCategories.map((cat) => (
                    <SettingsCategoryItem
                      key={cat.id}
                      category={cat}
                      isActive={false}
                      onClick={() => handleCategoryClick(cat.id)}
                    />
                  ))}
                </div>
              </div>
            </main>
          </div>
        </div>
      );
    }

    // Show category detail with back button
    return (
      <div className="main-content-mobile">
        <div className="main-content-mobile-inner">
          <PageHeader
            title={currentCategory?.label || t("pageTitleSettings")}
            onOpenSidebar={openSidebar}
            showBack
            onBack={handleBack}
          />
          <main className="page-scroll-container">
            <div className="page-content-inner settings-detail-page">
              {currentCategory && (
                <PageHero
                  title={currentCategory.label}
                  icon={detailHeroIcon}
                  compact
                />
              )}
              {CategoryComponent && <CategoryComponent />}
            </div>
          </main>
        </div>
      </div>
    );
  }

  // Desktop: two-column layout with category list on left, content on right
  return (
    <div className="main-content-wrapper">
      <div className="main-content-constrained">
        <PageHeader
          title={t("pageTitleSettings")}
          onOpenSidebar={openSidebar}
          onToggleSidebar={toggleSidebar}
          isWideScreen={isWideScreen}
          isSidebarCollapsed={isSidebarCollapsed}
        />
        <main className="page-scroll-container">
          <div className="page-content-inner settings-page-content">
            <PageHero
              title={t("pageTitleSettings")}
              icon={<Settings size={22} strokeWidth={2} aria-hidden="true" />}
              metrics={[
                {
                  label: t("pageHeroSettingsSections"),
                  value: categories.length,
                  tone: "brand",
                },
              ]}
              compact
            />
            <div className="settings-two-column">
              <nav className="settings-category-nav">
                <div className="settings-category-list">
                  {categories.map((cat) => (
                    <SettingsCategoryItem
                      key={cat.id}
                      category={cat}
                      isActive={effectiveCategory === cat.id}
                      onClick={() => handleCategoryClick(cat.id)}
                    />
                  ))}
                </div>
              </nav>
              <div className="settings-content-panel settings-detail-page">
                {currentCategory && (
                  <PageHero
                    title={currentCategory.label}
                    icon={detailHeroIcon}
                    compact
                  />
                )}
                {CategoryComponent && <CategoryComponent />}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
