import {
  Activity,
  FolderKanban,
  GitBranch,
  History,
  Inbox,
  MessagesSquare,
  PlusCircle,
  Settings,
  Smartphone,
  Waypoints,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { ThinkingIndicator } from "./ThinkingIndicator";

export const SidebarIcons = {
  inbox: <Inbox size={18} strokeWidth={2} />,
  projects: <FolderKanban size={18} strokeWidth={2} />,
  agents: <Activity size={18} strokeWidth={2} />,
  settings: <Settings size={18} strokeWidth={2} />,
  allSessions: <MessagesSquare size={18} strokeWidth={2} />,
  newSession: <PlusCircle size={20} strokeWidth={2.5} />,
  sourceControl: <GitBranch size={18} strokeWidth={2} />,
  recents: <History size={18} strokeWidth={2} />,
  emulator: <Smartphone size={18} strokeWidth={2} />,
  bridge: <Waypoints size={18} strokeWidth={2} />,
};

export interface SidebarNavItemProps {
  to: string;
  icon: ReactNode;
  label: string;
  badge?: number;
  onClick?: () => void;
  title?: string;
  hasDraft?: boolean;
  hasActivityIndicator?: boolean;
  basePath?: string;
  variant?: "default" | "primary";
}

export function SidebarNavItem({
  to,
  icon,
  label,
  badge,
  onClick,
  title,
  hasDraft,
  hasActivityIndicator,
  basePath = "",
  variant = "default",
}: SidebarNavItemProps) {
  const location = useLocation();
  const fullPath = `${basePath}${to}`;
  const isActive = location.pathname === fullPath || location.pathname === to;

  return (
    <Link
      to={fullPath}
      className={`sidebar-nav-item sidebar-nav-item--${variant} ${isActive ? "active" : ""}`}
      onClick={onClick}
      title={title ?? label}
    >
      <div className="sidebar-nav-icon">{icon}</div>

      <span className="sidebar-nav-text">{label}</span>

      {hasDraft && <span className="session-draft-badge">(draft)</span>}
      {hasActivityIndicator && <ThinkingIndicator />}

      {badge !== undefined && badge > 0 && (
        <span className="sidebar-nav-badge">{badge}</span>
      )}
    </Link>
  );
}

export interface SidebarNavSectionProps {
  title?: string;
  children: ReactNode;
}

export function SidebarNavSection({ title, children }: SidebarNavSectionProps) {
  return (
    <section className="sidebar-nav-section" aria-label={title}>
      {title && <h3 className="sidebar-nav-section-title">{title}</h3>}
      <nav className="sidebar-nav-section-items">{children}</nav>
    </section>
  );
}
