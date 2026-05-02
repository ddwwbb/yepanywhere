import type { ProviderName } from "@yep-anywhere/shared";
import type { KeyboardEvent, RefObject } from "react";
import { Link } from "react-router-dom";
import { ProviderBadge } from "../../components/ProviderBadge";
import { RecentSessionsDropdown } from "../../components/RecentSessionsDropdown";
import { SessionMenu } from "../../components/SessionMenu";
import { useI18n } from "../../i18n";

interface SessionHeaderProps {
  isWideScreen: boolean;
  onOpenSidebar: () => void;
  basePath: string;
  projectId: string;
  projectName?: string;
  sessionId: string;
  displayTitle: string;
  fullTitle?: string | null;
  isStarred: boolean;
  isArchived: boolean;
  hasUnread: boolean;
  loading: boolean;
  isEditingTitle: boolean;
  renameInputRef: RefObject<HTMLInputElement | null>;
  renameValue: string;
  onRenameValueChange: (value: string) => void;
  onTitleKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onTitleBlur: () => void;
  isRenaming: boolean;
  titleButtonRef: RefObject<HTMLButtonElement | null>;
  showRecentSessions: boolean;
  onToggleRecentSessions: () => void;
  onCloseRecentSessions: () => void;
  effectiveProvider?: ProviderName;
  effectiveModel?: string;
  isThinking: boolean;
  onOpenProcessInfo: () => void;
  sessionProvider?: ProviderName;
  processId?: string;
  onToggleStar: () => void;
  onToggleArchive: () => void;
  onToggleRead: () => void;
  onRename: () => void;
  onClone: (newSessionId: string) => void;
  onTerminate: () => void;
  sharingConfigured: boolean;
  onShare: () => void;
}

function SidebarIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
    </svg>
  );
}

export function SessionHeader({
  isWideScreen,
  onOpenSidebar,
  basePath,
  projectId,
  projectName,
  sessionId,
  displayTitle,
  fullTitle,
  isStarred,
  isArchived,
  hasUnread,
  loading,
  isEditingTitle,
  renameInputRef,
  renameValue,
  onRenameValueChange,
  onTitleKeyDown,
  onTitleBlur,
  isRenaming,
  titleButtonRef,
  showRecentSessions,
  onToggleRecentSessions,
  onCloseRecentSessions,
  effectiveProvider,
  effectiveModel,
  isThinking,
  onOpenProcessInfo,
  sessionProvider,
  processId,
  onToggleStar,
  onToggleArchive,
  onToggleRead,
  onRename,
  onClone,
  onTerminate,
  sharingConfigured,
  onShare,
}: SessionHeaderProps) {
  const { t } = useI18n();

  return (
    <header className="session-header">
      <div className="session-header-inner">
        <div className="session-header-left">
          {!isWideScreen && (
            <button
              type="button"
              className="sidebar-toggle"
              onClick={onOpenSidebar}
              title={t("sessionOpenSidebar")}
              aria-label={t("sessionOpenSidebar")}
            >
              <SidebarIcon />
            </button>
          )}
          {projectName && (
            <Link
              to={`${basePath}/sessions?project=${projectId}`}
              className="project-breadcrumb"
              title={projectName}
            >
              {projectName.length > 12
                ? `${projectName.slice(0, 12)}...`
                : projectName}
            </Link>
          )}
          <div className="session-title-row">
            {isStarred && (
              <svg
                className="star-indicator-inline"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="currentColor"
                stroke="currentColor"
                strokeWidth="2"
                role="img"
                aria-label={t("sessionStarredLabel")}
              >
                <title>{t("sessionStarredLabel")}</title>
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            )}
            {loading ? (
              <span className="session-title-skeleton" />
            ) : isEditingTitle ? (
              <input
                ref={renameInputRef}
                type="text"
                className="session-title-input"
                value={renameValue}
                onChange={(event) => onRenameValueChange(event.target.value)}
                onKeyDown={onTitleKeyDown}
                onBlur={onTitleBlur}
                disabled={isRenaming}
              />
            ) : (
              <>
                <button
                  ref={titleButtonRef}
                  type="button"
                  className="session-title session-title-dropdown-trigger"
                  onClick={onToggleRecentSessions}
                  title={fullTitle ?? displayTitle}
                >
                  <span className="session-title-text">{displayTitle}</span>
                  <svg
                    className="session-title-chevron"
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                <RecentSessionsDropdown
                  currentSessionId={sessionId}
                  isOpen={showRecentSessions}
                  onClose={onCloseRecentSessions}
                  onNavigate={onCloseRecentSessions}
                  triggerRef={titleButtonRef}
                  basePath={basePath}
                />
              </>
            )}
            {!loading && isArchived && (
              <span className="archived-badge">
                {t("sessionArchivedBadge")}
              </span>
            )}
            {!loading && (
              <SessionMenu
                sessionId={sessionId}
                projectId={projectId}
                isStarred={isStarred}
                isArchived={isArchived}
                hasUnread={hasUnread}
                provider={sessionProvider}
                processId={processId}
                onToggleStar={onToggleStar}
                onToggleArchive={onToggleArchive}
                onToggleRead={onToggleRead}
                onRename={onRename}
                onClone={onClone}
                onTerminate={onTerminate}
                sharingConfigured={sharingConfigured}
                onShare={onShare}
                useFixedPositioning
                useEllipsisIcon
              />
            )}
          </div>
        </div>
        <div className="session-header-right">
          {!loading && effectiveProvider && (
            <button
              type="button"
              className="provider-badge-button"
              onClick={onOpenProcessInfo}
              title={t("sessionViewInfo")}
            >
              <ProviderBadge
                provider={effectiveProvider}
                model={effectiveModel}
                isThinking={isThinking}
              />
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
