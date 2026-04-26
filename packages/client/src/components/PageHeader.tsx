import { ChevronLeft, PanelLeftClose } from "lucide-react";
import type { ReactNode } from "react";
import { useI18n } from "../i18n";
import { truncateText } from "../lib/text";

interface PageHeaderProps {
  title: string;
  /** Optional custom element to render instead of the default title */
  titleElement?: ReactNode;
  /** Mobile: opens the sidebar overlay */
  onOpenSidebar?: () => void;
  /** Desktop: toggles sidebar expanded/collapsed */
  onToggleSidebar?: () => void;
  /** Whether we're in desktop mode (wide screen) */
  isWideScreen?: boolean;
  /** Whether the sidebar is currently collapsed (desktop only) */
  isSidebarCollapsed?: boolean;
  /** Show a back button instead of sidebar toggle */
  showBack?: boolean;
  /** Callback when back button is clicked */
  onBack?: () => void;
}

const SidebarToggleIcon = () => (
  <PanelLeftClose size={20} strokeWidth={2} aria-hidden="true" />
);

const BackIcon = () => (
  <ChevronLeft size={20} strokeWidth={2} aria-hidden="true" />
);

export function PageHeader({
  title,
  titleElement,
  onOpenSidebar,
  onToggleSidebar,
  isWideScreen = false,
  isSidebarCollapsed = false,
  showBack = false,
  onBack,
}: PageHeaderProps) {
  const { t } = useI18n();
  // 移动端显示 sidebar toggle，桌面端由 NavigationLayout 统一提供
  const showMobileToggle = !isWideScreen && !showBack;
  const handleMobileToggle = onOpenSidebar;

  return (
    <header className="session-header">
      <div className="session-header-inner">
        <div className="session-header-left">
          {showBack && onBack ? (
            <button
              type="button"
              className="sidebar-toggle"
              onClick={onBack}
              title={t("actionBack")}
              aria-label={t("actionBack")}
            >
              <BackIcon />
            </button>
          ) : showMobileToggle && handleMobileToggle ? (
            <button
              type="button"
              className="sidebar-toggle"
              onClick={handleMobileToggle}
              title={t("actionOpenSidebar")}
              aria-label={t("actionOpenSidebar")}
            >
              <SidebarToggleIcon />
            </button>
          ) : null}
          {titleElement ?? (
            <span
              className="session-title"
              title={title.length > 60 ? title : undefined}
            >
              {truncateText(title)}
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
