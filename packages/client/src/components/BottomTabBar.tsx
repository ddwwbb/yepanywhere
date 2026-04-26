import { FolderKanban, Inbox, Menu, MessagesSquare } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useNeedsAttentionBadge } from "../hooks/useNeedsAttentionBadge";
import { useRemoteBasePath } from "../hooks/useRemoteBasePath";
import { useI18n } from "../i18n";

interface BottomTabBarProps {
  onOpenDrawer: () => void;
}

export function BottomTabBar({ onOpenDrawer }: BottomTabBarProps) {
  const { t, locale } = useI18n();
  const location = useLocation();
  const basePath = useRemoteBasePath();
  const inboxCount = useNeedsAttentionBadge();
  const menuLabel = locale === "zh-CN" ? "更多" : "More";

  const tabs = [
    {
      to: "/sessions",
      icon: <MessagesSquare size={24} strokeWidth={2} />,
      label: t("sidebarAllSessions") || "Sessions",
    },
    {
      to: "/projects",
      icon: <FolderKanban size={24} strokeWidth={2} />,
      label: t("sidebarProjects") || "Projects",
    },
    {
      to: "/inbox",
      icon: <Inbox size={24} strokeWidth={2} />,
      label: t("sidebarInbox") || "Inbox",
      badge: inboxCount,
    },
  ];

  return (
    <nav className="mobile-tab-bar hidden-desktop">
      {tabs.map((tab) => {
        const fullPath = `${basePath}${tab.to}`;
        const isActive =
          location.pathname === fullPath || location.pathname === tab.to;
        return (
          <Link
            key={tab.to}
            to={fullPath}
            className={`tab-bar-item touch-target ${isActive ? "active" : ""}`}
          >
            <div className="tab-icon-wrapper">
              {tab.icon}
              {tab.badge !== undefined && tab.badge > 0 && (
                <span className="tab-badge">{tab.badge}</span>
              )}
            </div>
            <span className="tab-label">{tab.label}</span>
          </Link>
        );
      })}

      {/* "More" button to open the mobile drawer (Sidebar) */}
      <button
        type="button"
        className="tab-bar-item touch-target"
        onClick={onOpenDrawer}
        aria-label={menuLabel}
      >
        <div className="tab-icon-wrapper">
          <Menu size={24} strokeWidth={2} />
        </div>
        <span className="tab-label">{menuLabel}</span>
      </button>
    </nav>
  );
}
