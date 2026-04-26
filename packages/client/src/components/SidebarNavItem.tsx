import { type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Inbox,
  FolderKanban,
  Activity,
  Settings,
  MessagesSquare,
  PlusCircle,
  GitBranch,
  History,
  Smartphone,
  Waypoints
} from "lucide-react";
import { ThinkingIndicator } from "./ThinkingIndicator";

/**
 * Common icons used in sidebar navigation, migrated to lucide-react.
 */
export const SidebarIcons = {
  inbox: <Inbox size={18} strokeWidth={2} />,
  projects: <FolderKanban size={18} strokeWidth={2} />,
  agents: <Activity size={18} strokeWidth={2} />,
  settings: <Settings size={18} strokeWidth={2} />,
  allSessions: <MessagesSquare size={18} strokeWidth={2} />,
  newSession: <PlusCircle size={20} strokeWidth={2.5} color="var(--color-brand)" />,
  sourceControl: <GitBranch size={18} strokeWidth={2} />,
  recents: <History size={18} strokeWidth={2} />,
  emulator: <Smartphone size={18} strokeWidth={2} />,
  bridge: <Waypoints size={18} strokeWidth={2} />,
};

export interface SidebarNavItemProps {
  /** Route path to navigate to */
  to: string;
  /** Icon to display (use SidebarIcons or custom ReactNode) */
  icon: ReactNode;
  /** Label text */
  label: string;
  /** Optional badge count (displays if > 0) */
  badge?: number;
  /** Called when item is clicked (e.g., to close mobile sidebar) */
  onClick?: () => void;
  /** Title tooltip */
  title?: string;
  /** Whether this item has an unsent draft */
  hasDraft?: boolean;
  /** Show pulsing activity indicator (e.g., for active agents) */
  hasActivityIndicator?: boolean;
  /** Base path prefix for relay mode (e.g., "/remote/my-server") */
  basePath?: string;
}

/**
 * Unified sidebar navigation item component.
 * Features a modern pill design with smooth background transitions on hover and active states.
 */
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
}: SidebarNavItemProps) {
  const location = useLocation();
  const fullPath = `${basePath}${to}`;
  // Check if current path matches (with or without basePath prefix)
  const isActive = location.pathname === fullPath || location.pathname === to;

  return (
    <Link
      to={fullPath}
      className={`sidebar-nav-item ${isActive ? "active" : ""}`}
      onClick={onClick}
      title={title ?? label}
    >
      <div className="sidebar-nav-icon">
        {icon}
      </div>
      
      <span className="sidebar-nav-text">{label}</span>
      
      {hasDraft && <span className="session-draft-badge">(draft)</span>}
      {hasActivityIndicator && <ThinkingIndicator />}
      
      {badge !== undefined && badge > 0 && (
        <span className="sidebar-nav-badge">
          {badge}
        </span>
      )}
    </Link>
  );
}

export interface SidebarNavSectionProps {
  children: ReactNode;
}

/**
 * Container for sidebar navigation items.
 * Provides consistent spacing between items.
 */
export function SidebarNavSection({ children }: SidebarNavSectionProps) {
  return <nav className="sidebar-nav-section">{children}</nav>;
}
