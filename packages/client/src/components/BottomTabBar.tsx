import { Activity, Inbox, MessagesSquare, PlusCircle, Settings } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useNeedsAttentionBadge } from "../hooks/useNeedsAttentionBadge";
import { resolvePreferredProjectId } from "../hooks/useRecentProject";
import { useRecentProjects } from "../hooks/useRecentProjects";
import { useRemoteBasePath } from "../hooks/useRemoteBasePath";
import { useI18n } from "../i18n";

interface BottomTab {
  to: string;
  icon: ReactNode;
  label: string;
  badge?: number;
  primary?: boolean;
  match: (pathname: string, fullPath: string) => boolean;
}

export function BottomTabBar() {
  const { t } = useI18n();
  const location = useLocation();
  const basePath = useRemoteBasePath();
  const inboxCount = useNeedsAttentionBadge();
  const { projects, recentProjects } = useRecentProjects();
  const newSessionProjectId = resolvePreferredProjectId(
    projects,
    recentProjects[0]?.id,
  );
  const newSessionPath = newSessionProjectId
    ? `/new-session?projectId=${encodeURIComponent(newSessionProjectId)}`
    : "/new-session";

  const tabs: BottomTab[] = [
    {
      to: "/inbox",
      icon: <Inbox size={22} strokeWidth={2} />,
      label: t("sidebarInbox"),
      badge: inboxCount,
      match: (pathname, fullPath) => pathname === fullPath || pathname === "/inbox",
    },
    {
      to: "/sessions",
      icon: <MessagesSquare size={22} strokeWidth={2} />,
      label: t("sidebarAllSessions"),
      match: (pathname, fullPath) =>
        pathname === fullPath ||
        pathname === "/sessions" ||
        pathname.includes("/sessions/"),
    },
    {
      to: newSessionPath,
      icon: <PlusCircle size={24} strokeWidth={2.4} />,
      label: t("sidebarNewSession"),
      primary: true,
      match: (pathname, fullPath) =>
        pathname === fullPath.split("?")[0] || pathname === "/new-session",
    },
    {
      to: "/activity",
      icon: <Activity size={22} strokeWidth={2} />,
      label: t("activityBreadcrumb"),
      match: (pathname, fullPath) => pathname === fullPath || pathname === "/activity",
    },
    {
      to: "/settings",
      icon: <Settings size={22} strokeWidth={2} />,
      label: t("sidebarSettings"),
      match: (pathname, fullPath) =>
        pathname === fullPath ||
        pathname === "/settings" ||
        pathname.startsWith(`${basePath}/settings/`) ||
        pathname.startsWith("/settings/"),
    },
  ];

  return (
    <nav className="mobile-tab-bar hidden-desktop" aria-label="Mobile primary">
      {tabs.map((tab) => {
        const fullPath = `${basePath}${tab.to}`;
        const isActive = tab.match(location.pathname, fullPath);
        return (
          <Link
            key={tab.to}
            to={fullPath}
            className={`tab-bar-item touch-target ${tab.primary ? "tab-bar-item--primary" : ""} ${isActive ? "active" : ""}`}
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
    </nav>
  );
}
