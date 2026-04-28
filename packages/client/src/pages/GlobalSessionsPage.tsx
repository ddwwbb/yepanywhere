import {
  ChevronRight,
  FolderKanban,
  MessagesSquare,
  Trash2,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  type GlobalSessionItem,
  type ServerSettings,
  api,
} from "../api/client";
import { BulkActionBar } from "../components/BulkActionBar";
import { PageHeader } from "../components/PageHeader";
import { PageHero } from "../components/PageHero";
import { SessionListItem } from "../components/SessionListItem";
import { useDrafts } from "../hooks/useDrafts";
import { useGlobalSessions } from "../hooks/useGlobalSessions";
import { useRemoteBasePath } from "../hooks/useRemoteBasePath";
import { useServerSettings } from "../hooks/useServerSettings";
import { useI18n } from "../i18n";
import { useNavigationLayout } from "../layouts";
import { getSessionDisplayTitle, toUrlProjectId } from "../utils";

// Long-press threshold for entering selection mode on mobile
const LONG_PRESS_MS = 500;

type RemoteChannels = ServerSettings["remoteChannels"];

function getBotBoundSessionIds(remoteChannels: RemoteChannels): Set<string> {
  const ids = new Set<string>();
  for (const channel of [
    remoteChannels?.feishu,
    remoteChannels?.telegram,
    remoteChannels?.qq,
    remoteChannels?.weixin,
  ]) {
    for (const bot of channel?.bots ?? []) {
      if (bot.boundSessionId) ids.add(bot.boundSessionId);
    }
  }
  return ids;
}

/**
 * Global sessions page showing all sessions across all projects.
 * Supports filtering by project, status, provider, and search query.
 * Includes multi-select mode with bulk actions.
 */
export function GlobalSessionsPage() {
  const { t } = useI18n();
  const { openSidebar, isWideScreen, toggleSidebar, isSidebarCollapsed } =
    useNavigationLayout();
  const basePath = useRemoteBasePath();
  const { settings } = useServerSettings();
  const botBoundSessionIds = useMemo(
    () => getBotBoundSessionIds(settings?.remoteChannels),
    [settings?.remoteChannels],
  );

  const { sessions, stats, loading, error, hasMore, loadMore } =
    useGlobalSessions({
      includeStats: true,
    });

  // 默认显示非归档会话
  const filteredSessions = useMemo(() => {
    return sessions.filter((session) => !session.isArchived);
  }, [sessions]);

  // 按 projectId 分组
  interface ProjectGroup {
    projectId: string;
    projectName: string;
    sessions: GlobalSessionItem[];
  }

  const groupedSessions = useMemo((): ProjectGroup[] => {
    const map = new Map<string, { name: string; list: GlobalSessionItem[] }>();
    for (const s of filteredSessions) {
      const g = map.get(s.projectId) ?? {
        name: s.projectName || s.projectId,
        list: [],
      };
      g.list.push(s);
      map.set(s.projectId, g);
    }
    return Array.from(map, ([projectId, { name, list }]) => ({
      projectId,
      projectName: name,
      sessions: list,
    }));
  }, [filteredSessions]);

  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(
    new Set(),
  );
  const toggleProject = useCallback((projectId: string) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }, []);

  // Track which sessions have unsent drafts
  const drafts = useDrafts();

  // Selection state for multi-select mode
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [isBulkActionPending, setIsBulkActionPending] = useState(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressSessionRef = useRef<string | null>(null);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);

  // Selection handlers
  const handleSelect = useCallback((sessionId: string, selected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (selected) {
        next.add(sessionId);
      } else {
        next.delete(sessionId);
      }
      // Exit selection mode when nothing is selected
      if (next.size === 0) {
        setIsSelectionMode(false);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedIds(new Set(filteredSessions.map((s) => s.id)));
    setIsSelectionMode(true);
  }, [filteredSessions]);

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setIsSelectionMode(false);
  }, []);

  // Long-press handlers for mobile selection mode
  const handleLongPressStart = useCallback(
    (sessionId: string, e: React.TouchEvent | React.MouseEvent) => {
      // Already in selection mode or on desktop - don't start long-press
      if (isSelectionMode || isWideScreen) return;

      // Record starting position to detect movement (scrolling)
      if ("touches" in e) {
        const touch = e.touches[0];
        if (touch) {
          touchStartPosRef.current = { x: touch.clientX, y: touch.clientY };
        }
      } else if ("clientX" in e) {
        touchStartPosRef.current = { x: e.clientX, y: e.clientY };
      }

      longPressSessionRef.current = sessionId;
      longPressTimerRef.current = setTimeout(() => {
        // Enter selection mode and select this session
        setIsSelectionMode(true);
        setSelectedIds(new Set([sessionId]));
        longPressSessionRef.current = null;
        touchStartPosRef.current = null;
      }, LONG_PRESS_MS);
    },
    [isSelectionMode, isWideScreen],
  );

  const handleLongPressEnd = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressSessionRef.current = null;
    touchStartPosRef.current = null;
  }, []);

  // Cancel long press if user moves finger (scrolling)
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchStartPosRef.current || !longPressTimerRef.current) return;

    const touch = e.touches[0];
    if (!touch) return;

    const dx = touch.clientX - touchStartPosRef.current.x;
    const dy = touch.clientY - touchStartPosRef.current.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Cancel if moved more than 10px (scrolling threshold)
    if (distance > 10) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
      longPressSessionRef.current = null;
      touchStartPosRef.current = null;
    }
  }, []);

  // Prevent native context menu during long press
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      // Suppress context menu if long press is active or in selection mode
      if (longPressTimerRef.current || isSelectionMode) {
        e.preventDefault();
      }
    },
    [isSelectionMode],
  );

  // Bulk action handlers
  const handleBulkArchive = useCallback(async () => {
    if (isBulkActionPending) return;
    setIsBulkActionPending(true);
    try {
      await Promise.all(
        Array.from(selectedIds).map((id) =>
          api.updateSessionMetadata(id, { archived: true }),
        ),
      );
      handleClearSelection();
    } finally {
      setIsBulkActionPending(false);
    }
  }, [selectedIds, isBulkActionPending, handleClearSelection]);

  const handleBulkUnarchive = useCallback(async () => {
    if (isBulkActionPending) return;
    setIsBulkActionPending(true);
    try {
      await Promise.all(
        Array.from(selectedIds).map((id) =>
          api.updateSessionMetadata(id, { archived: false }),
        ),
      );
      handleClearSelection();
    } finally {
      setIsBulkActionPending(false);
    }
  }, [selectedIds, isBulkActionPending, handleClearSelection]);

  const handleBulkStar = useCallback(async () => {
    if (isBulkActionPending) return;
    setIsBulkActionPending(true);
    try {
      await Promise.all(
        Array.from(selectedIds).map((id) =>
          api.updateSessionMetadata(id, { starred: true }),
        ),
      );
      handleClearSelection();
    } finally {
      setIsBulkActionPending(false);
    }
  }, [selectedIds, isBulkActionPending, handleClearSelection]);

  const handleBulkUnstar = useCallback(async () => {
    if (isBulkActionPending) return;
    setIsBulkActionPending(true);
    try {
      await Promise.all(
        Array.from(selectedIds).map((id) =>
          api.updateSessionMetadata(id, { starred: false }),
        ),
      );
      handleClearSelection();
    } finally {
      setIsBulkActionPending(false);
    }
  }, [selectedIds, isBulkActionPending, handleClearSelection]);

  const handleBulkMarkRead = useCallback(async () => {
    if (isBulkActionPending) return;
    setIsBulkActionPending(true);
    try {
      await Promise.all(
        Array.from(selectedIds).map((id) => api.markSessionSeen(id)),
      );
      handleClearSelection();
    } finally {
      setIsBulkActionPending(false);
    }
  }, [selectedIds, isBulkActionPending, handleClearSelection]);

  const handleBulkMarkUnread = useCallback(async () => {
    if (isBulkActionPending) return;
    setIsBulkActionPending(true);
    try {
      await Promise.all(
        Array.from(selectedIds).map((id) => api.markSessionUnread(id)),
      );
      handleClearSelection();
    } finally {
      setIsBulkActionPending(false);
    }
  }, [selectedIds, isBulkActionPending, handleClearSelection]);

  const handleBulkDelete = useCallback(async () => {
    if (isBulkActionPending) return;
    const confirmed = window.confirm(
      t("bulkDeleteConfirm", { count: selectedIds.size }),
    );
    if (!confirmed) return;
    setIsBulkActionPending(true);
    try {
      const selectedSessions = sessions.filter((s) => selectedIds.has(s.id));
      await Promise.all(
        selectedSessions.map((s) => api.deleteSession(s.id, s.projectId)),
      );
      handleClearSelection();
    } finally {
      setIsBulkActionPending(false);
    }
  }, [selectedIds, sessions, isBulkActionPending, handleClearSelection, t]);

  const handleDeleteSession = useCallback(
    (sessionId: string, projectId: string) => async () => {
      const confirmed = window.confirm(t("deleteSessionConfirm"));
      if (!confirmed) return;
      try {
        await api.deleteSession(sessionId, projectId);
      } catch (err) {
        console.error("Failed to delete session:", err);
      }
    },
    [t],
  );

  // Compute which bulk actions are applicable based on selection
  const bulkActionState = useMemo(() => {
    const selectedSessions = sessions.filter((s) => selectedIds.has(s.id));
    return {
      canArchive: selectedSessions.some((s) => !s.isArchived),
      canUnarchive: selectedSessions.some((s) => s.isArchived),
      canStar: selectedSessions.some((s) => !s.isStarred),
      canUnstar: selectedSessions.some((s) => s.isStarred),
      canMarkRead: selectedSessions.some((s) => s.hasUnread),
      canMarkUnread: selectedSessions.some((s) => !s.hasUnread),
    };
  }, [sessions, selectedIds]);

  const isEmpty = filteredSessions.length === 0;
  const unreadVisibleCount = filteredSessions.filter((s) => s.hasUnread).length;
  const activeVisibleCount = filteredSessions.filter(
    (s) => s.activity === "in-turn" || s.ownership.owner !== "none",
  ).length;
  const starredVisibleCount = filteredSessions.filter(
    (s) => s.isStarred,
  ).length;

  return (
    <div
      className={isWideScreen ? "main-content-wrapper" : "main-content-mobile"}
    >
      <div
        className={
          isWideScreen
            ? "main-content-constrained"
            : "main-content-mobile-inner"
        }
      >
        <PageHeader
          title={t("globalSessionsTitle")}
          onOpenSidebar={openSidebar}
          onToggleSidebar={toggleSidebar}
          isWideScreen={isWideScreen}
          isSidebarCollapsed={isSidebarCollapsed}
        />

        <main className="page-scroll-container">
          <div className="page-content-inner">
            <PageHero
              title={t("globalSessionsTitle")}
              icon={
                <MessagesSquare size={22} strokeWidth={2} aria-hidden="true" />
              }
              metrics={[
                {
                  label: t("pageHeroSessionsVisible"),
                  value: filteredSessions.length,
                  tone: "brand",
                },
                {
                  label: t("pageHeroSessionsUnread"),
                  value: unreadVisibleCount,
                  tone: unreadVisibleCount > 0 ? "warning" : "default",
                },
                {
                  label: t("pageHeroSessionsActive"),
                  value: activeVisibleCount,
                  tone: activeVisibleCount > 0 ? "success" : "default",
                },
                {
                  label: t("pageHeroSessionsStarred"),
                  value: starredVisibleCount,
                },
              ]}
            />

            {loading && sessions.length === 0 && (
              <p className="loading">{t("sidebarLoadingSessions")}</p>
            )}

            {error && (
              <p className="error">
                {t("projectsErrorPrefix")} {error.message}
              </p>
            )}

            {!loading && !error && isEmpty && (
              <div className="inbox-empty">
                <svg
                  width="48"
                  height="48"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                <h3>{t("globalSessionsNoResultsTitle")}</h3>
                <p>{t("globalSessionsNoResultsEmpty")}</p>
              </div>
            )}

            {!error && !isEmpty && (
              <>
                {/* Select all header (desktop or when in selection mode) */}
                {(isWideScreen || isSelectionMode) &&
                  filteredSessions.length > 0 && (
                    <div className="session-list-header">
                      <label className="session-list-header__select-all">
                        <input
                          type="checkbox"
                          checked={
                            selectedIds.size === filteredSessions.length &&
                            filteredSessions.length > 0
                          }
                          onChange={(e) =>
                            e.target.checked
                              ? handleSelectAll()
                              : handleClearSelection()
                          }
                        />
                        <span>
                          {selectedIds.size > 0
                            ? t("bulkSelectedCount", {
                                count: selectedIds.size,
                              })
                            : t("globalSessionsSelectAll")}
                        </span>
                      </label>
                    </div>
                  )}

                <div className="session-list-grouped">
                  {groupedSessions.map((group) => {
                    const isCollapsed = collapsedProjects.has(group.projectId);
                    return (
                      <section
                        key={group.projectId}
                        className={`session-project-group ${isCollapsed ? "session-project-group--collapsed" : ""}`}
                      >
                        <button
                          type="button"
                          className="session-project-group-header"
                          onClick={() => toggleProject(group.projectId)}
                          aria-expanded={!isCollapsed}
                        >
                          <ChevronRight
                            size={16}
                            strokeWidth={2.5}
                            className={`session-project-group-chevron ${isCollapsed ? "" : "open"}`}
                            aria-hidden="true"
                          />
                          <FolderKanban
                            size={16}
                            strokeWidth={2}
                            aria-hidden="true"
                          />
                          <span className="session-project-group-name">
                            {group.projectName}
                          </span>
                          <span className="session-project-group-count">
                            {group.sessions.length}
                          </span>
                          <button
                            type="button"
                            className="session-project-group-delete"
                            onClick={(e) => {
                              e.stopPropagation();
                              const confirmed = window.confirm(
                                t("deleteProjectConfirm", {
                                  name: group.projectName,
                                  count: group.sessions.length,
                                }),
                              );
                              if (!confirmed) return;
                              Promise.all(
                                group.sessions.map((s) =>
                                  api.deleteSession(s.id, s.projectId),
                                ),
                              ).catch((err) =>
                                console.error(
                                  "Failed to delete project sessions:",
                                  err,
                                ),
                              );
                            }}
                            title={t("deleteProjectTitle" as never)}
                            aria-label={t("deleteProjectTitle" as never)}
                          >
                            <Trash2
                              size={14}
                              strokeWidth={2}
                              aria-hidden="true"
                            />
                          </button>
                        </button>
                        {!isCollapsed && (
                          <ul
                            className={`session-list ${isSelectionMode ? "session-list--selection-mode" : ""}`}
                          >
                            {group.sessions.map((session) => (
                              <div
                                key={session.id}
                                onTouchStart={(e) =>
                                  handleLongPressStart(session.id, e)
                                }
                                onTouchMove={handleTouchMove}
                                onTouchEnd={handleLongPressEnd}
                                onTouchCancel={handleLongPressEnd}
                                onMouseDown={(e) =>
                                  !isWideScreen &&
                                  handleLongPressStart(session.id, e)
                                }
                                onMouseUp={handleLongPressEnd}
                                onMouseLeave={handleLongPressEnd}
                                onContextMenu={handleContextMenu}
                              >
                                <SessionListItem
                                  sessionId={session.id}
                                  projectId={session.projectId}
                                  title={getSessionDisplayTitle(session)}
                                  fullTitle={getSessionDisplayTitle(session)}
                                  updatedAt={session.updatedAt}
                                  hasUnread={session.hasUnread}
                                  activity={session.activity}
                                  pendingInputType={session.pendingInputType}
                                  status={session.ownership}
                                  provider={session.provider}
                                  executor={session.executor}
                                  isStarred={session.isStarred}
                                  isArchived={session.isArchived}
                                  mode="card"
                                  showContextUsage={false}
                                  isSelected={selectedIds.has(session.id)}
                                  isSelectionMode={
                                    isSelectionMode && !isWideScreen
                                  }
                                  onNavigate={() => {
                                    if (isSelectionMode && !isWideScreen) {
                                      handleSelect(
                                        session.id,
                                        !selectedIds.has(session.id),
                                      );
                                    }
                                  }}
                                  onSelect={
                                    isWideScreen || isSelectionMode
                                      ? handleSelect
                                      : undefined
                                  }
                                  showProjectName={false}
                                  basePath={basePath}
                                  messageCount={session.messageCount}
                                  hasDraft={drafts.has(session.id)}
                                  hasBotBinding={botBoundSessionIds.has(
                                    session.id,
                                  )}
                                  onDelete={handleDeleteSession(
                                    session.id,
                                    session.projectId,
                                  )}
                                />
                              </div>
                            ))}
                          </ul>
                        )}
                      </section>
                    );
                  })}
                </div>

                {hasMore && (
                  <div className="global-sessions-load-more">
                    <button
                      type="button"
                      onClick={loadMore}
                      className="global-sessions-load-more-button"
                      disabled={loading}
                    >
                      {loading
                        ? t("gitStatusLoading")
                        : t("globalSessionsLoadMore")}
                    </button>
                  </div>
                )}
              </>
            )}

            {/* Bulk action bar */}
            <BulkActionBar
              selectedCount={selectedIds.size}
              onArchive={handleBulkArchive}
              onUnarchive={handleBulkUnarchive}
              onStar={handleBulkStar}
              onUnstar={handleBulkUnstar}
              onMarkRead={handleBulkMarkRead}
              onMarkUnread={handleBulkMarkUnread}
              onDelete={handleBulkDelete}
              onClearSelection={handleClearSelection}
              isPending={isBulkActionPending}
              canArchive={bulkActionState.canArchive}
              canUnarchive={bulkActionState.canUnarchive}
              canStar={bulkActionState.canStar}
              canUnstar={bulkActionState.canUnstar}
              canMarkRead={bulkActionState.canMarkRead}
              canMarkUnread={bulkActionState.canMarkUnread}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
