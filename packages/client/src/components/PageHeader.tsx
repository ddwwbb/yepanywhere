import type { ReactNode } from "react";
import { PanelLeftClose, ChevronLeft } from "lucide-react";
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
  // On desktop: toggle sidebar collapse. On mobile: open sidebar overlay
  // Hide the toggle on desktop when sidebar is collapsed (sidebar has its own toggle)
  const handleToggle = isWideScreen
    ? isSidebarCollapsed
      ? undefined
      : onToggleSidebar
    : onOpenSidebar;
  const toggleTitle = isWideScreen
    ? t("actionToggleSidebar")
    : t("actionOpenSidebar");

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
          ) : (
            handleToggle && (
              <button
                type="button"
                className="sidebar-toggle"
                onClick={handleToggle}
                title={toggleTitle}
                aria-label={toggleTitle}
              >
                <SidebarToggleIcon />
              </button>
            )
          )}
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
