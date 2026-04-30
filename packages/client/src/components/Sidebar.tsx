import { ArrowRightLeft, PanelLeft, PanelLeftClose, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  type GlobalSessionItem,
  type ServerSettings,
  api,
} from "../api/client";
import { useOptionalRemoteConnection } from "../contexts/RemoteConnectionState";
import { useDrafts } from "../hooks/useDrafts";
import { useGlobalSessions } from "../hooks/useGlobalSessions";
import { useNeedsAttentionBadge } from "../hooks/useNeedsAttentionBadge";
import { resolvePreferredProjectId } from "../hooks/useRecentProject";
import { useRecentProjects } from "../hooks/useRecentProjects";
import { useRemoteBasePath } from "../hooks/useRemoteBasePath";
import { useServerSettings } from "../hooks/useServerSettings";
import { useVersion } from "../hooks/useVersion";
import { useI18n } from "../i18n";
import { getSessionDisplayTitle, toUrlProjectId } from "../utils";
import { AgentsNavItem } from "./AgentsNavItem";
import { SessionListItem } from "./SessionListItem";
import {
  SidebarIcons,
  SidebarNavItem,
  SidebarNavSection,
} from "./SidebarNavItem";
import { YepAnywhereLogo } from "./YepAnywhereLogo";

const SWIPE_THRESHOLD = 50; // Minimum distance to trigger close
const SWIPE_ENGAGE_THRESHOLD = 15; // Minimum vertical distance before sheet drag engages
const RECENT_SESSIONS_INITIAL = 12; // Initial number of recent sessions to show
const RECENT_SESSIONS_INCREMENT = 10; // How many more to show on each expand

type SidebarHistoryBucket = "today" | "yesterday" | "last7Days" | "older";

interface SidebarHistoryTimeGroup {
  bucket: SidebarHistoryBucket;
  label: string;
  sessions: GlobalSessionItem[];
}

interface SidebarHistoryProjectGroup {
  projectId: string;
  projectName: string;
  count: number;
  timeGroups: SidebarHistoryTimeGroup[];
}

const SIDEBAR_HISTORY_BUCKETS: SidebarHistoryBucket[] = [
  "today",
  "yesterday",
  "last7Days",
  "older",
];

function getStartOfDay(date: Date) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}

function getSidebarHistoryBucket(
  updatedAt: string,
  now: Date,
): SidebarHistoryBucket {
  const timestamp = new Date(updatedAt).getTime();
  if (!Number.isFinite(timestamp)) return "older";

  const todayStart = getStartOfDay(now);
  const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
  const lastSevenDaysStart = todayStart - 6 * 24 * 60 * 60 * 1000;

  if (timestamp >= todayStart) return "today";
  if (timestamp >= yesterdayStart) return "yesterday";
  if (timestamp >= lastSevenDaysStart) return "last7Days";
  return "older";
}

function getSidebarHistoryBucketLabel(
  bucket: SidebarHistoryBucket,
  locale: "en" | "zh-CN",
) {
  if (locale === "zh-CN") {
    return {
      today: "今天",
      yesterday: "昨天",
      last7Days: "近 7 天",
      older: "更早",
    }[bucket];
  }
  return {
    today: "Today",
    yesterday: "Yesterday",
    last7Days: "Last 7 days",
    older: "Older",
  }[bucket];
}

function groupSidebarHistorySessions(
  sessions: GlobalSessionItem[],
  locale: "en" | "zh-CN",
): SidebarHistoryProjectGroup[] {
  const now = new Date();
  const projects = new Map<
    string,
    {
      projectName: string;
      count: number;
      buckets: Map<SidebarHistoryBucket, GlobalSessionItem[]>;
    }
  >();

  for (const session of sessions) {
    const project = projects.get(session.projectId) ?? {
      projectName: session.projectName || session.projectId,
      count: 0,
      buckets: new Map<SidebarHistoryBucket, GlobalSessionItem[]>(),
    };
    const bucket = getSidebarHistoryBucket(session.updatedAt, now);
    project.count += 1;
    project.buckets.set(bucket, [
      ...(project.buckets.get(bucket) ?? []),
      session,
    ]);
    projects.set(session.projectId, project);
  }

  return Array.from(projects, ([projectId, project]) => ({
    projectId,
    projectName: project.projectName,
    count: project.count,
    timeGroups: SIDEBAR_HISTORY_BUCKETS.flatMap((bucket) => {
      const bucketSessions = project.buckets.get(bucket) ?? [];
      if (bucketSessions.length === 0) return [];
      return [
        {
          bucket,
          label: getSidebarHistoryBucketLabel(bucket, locale),
          sessions: bucketSessions,
        },
      ];
    }),
  }));
}

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

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: () => void;

  /** Current session ID (for highlighting in sidebar) */
  currentSessionId?: string;

  /** Desktop mode: sidebar is always visible, no overlay */
  isDesktop?: boolean;
  /** Desktop mode: sidebar is collapsed (icons only) */
  isCollapsed?: boolean;
  /** Desktop mode: callback to toggle expanded/collapsed state */
  onToggleExpanded?: () => void;
  /** Desktop mode: current sidebar width in pixels */
  sidebarWidth?: number;
  /** Desktop mode: called when resize starts */
  onResizeStart?: () => void;
  /** Desktop mode: called during resize with new width */
  onResize?: (width: number) => void;
  /** Desktop mode: called when resize ends */
  onResizeEnd?: () => void;
}

export function Sidebar({
  isOpen,
  onClose,
  onNavigate,
  currentSessionId,
  // Desktop mode props
  isDesktop = false,
  isCollapsed = false,
  onToggleExpanded,
  sidebarWidth,
  onResizeStart,
  onResize,
  onResizeEnd,
}: SidebarProps) {
  const { t, locale } = useI18n();
  // Get base path for relay mode (e.g., "/remote/my-server")
  const basePath = useRemoteBasePath();
  const navigate = useNavigate();
  const remoteConnection = useOptionalRemoteConnection();

  // Fetch global sessions for sidebar (non-starred only for recent/older sections)
  const { sessions: globalSessions, loading: globalLoading } =
    useGlobalSessions({ limit: 50, includeStats: false });

  // Fetch starred sessions separately to ensure we get ALL starred sessions
  const { sessions: starredSessions, loading: starredLoading } =
    useGlobalSessions({
      starred: true,
      limit: 100,
      includeStats: false,
    });

  const sessionsLoading = globalLoading || starredLoading;

  // Server capabilities for feature gating
  const { version: versionInfo } = useVersion();
  const capabilities = versionInfo?.capabilities ?? [];

  const { settings } = useServerSettings();
  const botBoundSessionIds = useMemo(
    () => getBotBoundSessionIds(settings?.remoteChannels),
    [settings?.remoteChannels],
  );

  // Global inbox count
  const inboxCount = useNeedsAttentionBadge();
  const { recentProjects, projects } = useRecentProjects();
  const newSessionProjectId = resolvePreferredProjectId(
    projects,
    recentProjects[0]?.id,
  );

  const sidebarRef = useRef<HTMLElement>(null);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const swipeEngaged = useRef<boolean>(false);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartX = useRef<number | null>(null);
  const resizeStartWidth = useRef<number | null>(null);
  const [historySessionsLimit, setHistorySessionsLimit] = useState(
    RECENT_SESSIONS_INITIAL,
  );
  const [starredSessionsLimit, setStarredSessionsLimit] = useState(
    RECENT_SESSIONS_INITIAL,
  );
  const [collapsedHistoryProjectIds, setCollapsedHistoryProjectIds] = useState<
    Set<string>
  >(() => new Set());

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
    touchStartY.current = e.touches[0]?.clientY ?? null;
    swipeEngaged.current = false;
    setSwipeOffset(0);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const currentX = e.touches[0]?.clientX;
    const currentY = e.touches[0]?.clientY;
    if (currentX === undefined || currentY === undefined) return;

    const diffX = currentX - touchStartX.current;
    const diffY = currentY - touchStartY.current;

    if (!swipeEngaged.current) {
      const absDiffX = Math.abs(diffX);
      const absDiffY = Math.abs(diffY);

      if (
        absDiffY > SWIPE_ENGAGE_THRESHOLD &&
        absDiffY > absDiffX &&
        diffY > 0
      ) {
        swipeEngaged.current = true;
      } else {
        return;
      }
    }

    if (diffY > 0) {
      setSwipeOffset(diffY);
    }
  };

  const handleTouchEnd = () => {
    if (swipeEngaged.current && swipeOffset > SWIPE_THRESHOLD) {
      onClose();
    }
    touchStartX.current = null;
    touchStartY.current = null;
    swipeEngaged.current = false;
    setSwipeOffset(0);
  };

  // Desktop sidebar resize handlers
  const handleResizeMouseDown = (e: React.MouseEvent) => {
    if (!isDesktop || isCollapsed || !sidebarWidth) return;
    e.preventDefault();
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = sidebarWidth;
    setIsResizing(true);
    onResizeStart?.();
  };

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (resizeStartX.current === null || resizeStartWidth.current === null)
        return;
      const diff = e.clientX - resizeStartX.current;
      const newWidth = resizeStartWidth.current + diff;
      onResize?.(newWidth);
    };

    const handleMouseUp = () => {
      resizeStartX.current = null;
      resizeStartWidth.current = null;
      setIsResizing(false);
      onResizeEnd?.();
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing, onResize, onResizeEnd]);

  // Handle switching hosts - disconnect and go to host picker
  const handleSwitchHost = () => {
    remoteConnection?.disconnect();
    navigate("/login");
    onNavigate();
  };

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

  const primaryNavItems = [
    {
      to: "/inbox",
      icon: SidebarIcons.inbox,
      label: t("sidebarInbox"),
      badge: inboxCount,
    },
    {
      to: "/sessions",
      icon: SidebarIcons.allSessions,
      label: t("sidebarAllSessions"),
    },
    {
      to: "/projects",
      icon: SidebarIcons.projects,
      label: t("sidebarProjects"),
    },
  ];

  const controlNavItems = [
    capabilities.includes("git-status")
      ? {
          to: "/git-status",
          icon: SidebarIcons.sourceControl,
          label: t("sidebarSourceControl"),
        }
      : null,
    capabilities.includes("deviceBridge") ||
    capabilities.includes("deviceBridge-download")
      ? {
          to: "/devices",
          icon: SidebarIcons.emulator,
          label: t("sidebarDevices"),
        }
      : null,
    {
      to: "/bridge",
      icon: SidebarIcons.bridge,
      label: t("sidebarBridge"),
    },
    {
      to: "/settings",
      icon: SidebarIcons.settings,
      label: t("sidebarSettings"),
    },
  ].filter((item) => item !== null);

  // Starred sessions come from dedicated fetch (filtered by server)
  // Filter out archived just in case
  const filteredStarredSessions = useMemo(() => {
    return starredSessions.filter((s) => !s.isArchived);
  }, [starredSessions]);

  const historySessions = useMemo(
    () => globalSessions.filter((s) => !s.isStarred && !s.isArchived),
    [globalSessions],
  );

  const visibleHistorySessions = useMemo(
    () => historySessions.slice(0, historySessionsLimit),
    [historySessions, historySessionsLimit],
  );

  const historyProjectGroups = useMemo(
    () => groupSidebarHistorySessions(visibleHistorySessions, locale),
    [locale, visibleHistorySessions],
  );

  const toggleHistoryProject = useCallback((projectId: string) => {
    setCollapsedHistoryProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  }, []);

  // Track which sessions have unsent drafts in localStorage
  const drafts = useDrafts();

  // In desktop mode, always render. In mobile mode, only render when open.
  if (!isDesktop && !isOpen) return null;

  // Sidebar toggle icon for desktop mode
  const SidebarToggleIcon = () =>
    isCollapsed ? (
      <PanelLeft size={20} strokeWidth={2} aria-hidden="true" />
    ) : (
      <PanelLeftClose size={20} strokeWidth={2} aria-hidden="true" />
    );

  return (
    <>
      {/* Only show overlay in non-desktop mode */}
      {!isDesktop && (
        <div
          className="sidebar-overlay"
          onClick={onClose}
          onKeyDown={(e) => e.key === "Escape" && onClose()}
          role="button"
          tabIndex={0}
          aria-label={t("actionCloseSidebar")}
        />
      )}
      <aside
        ref={sidebarRef}
        className="sidebar"
        onTouchStart={!isDesktop ? handleTouchStart : undefined}
        onTouchMove={!isDesktop ? handleTouchMove : undefined}
        onTouchEnd={!isDesktop ? handleTouchEnd : undefined}
        style={
          !isDesktop && swipeOffset > 0
            ? { transform: `translateY(${swipeOffset}px)`, transition: "none" }
            : undefined
        }
      >
        <div className="sidebar-header">
          {isDesktop && isCollapsed ? (
            /* Desktop collapsed mode: show toggle button to expand */
            <button
              type="button"
              className="sidebar-toggle"
              onClick={onToggleExpanded}
              title={t("actionExpandSidebar")}
              aria-label={t("actionExpandSidebar")}
            >
              <SidebarToggleIcon />
            </button>
          ) : isDesktop ? (
            /* Desktop expanded mode: brand + collapse toggle */
            <>
              <span className="sidebar-brand">
                <YepAnywhereLogo />
              </span>
              <button
                type="button"
                className="sidebar-toggle"
                onClick={onToggleExpanded}
                title={t("actionToggleSidebar")}
                aria-label={t("actionToggleSidebar")}
              >
                <SidebarToggleIcon />
              </button>
            </>
          ) : (
            /* Mobile mode: brand text + close button */
            <>
              <span className="sidebar-brand">
                <YepAnywhereLogo />
              </span>
              <button
                type="button"
                className="sidebar-close"
                onClick={onClose}
                aria-label={t("actionCloseSidebar")}
              >
                <X size={20} strokeWidth={2} aria-hidden="true" />
              </button>
            </>
          )}
        </div>

        <div className="sidebar-actions">
          <SidebarNavSection title={t("sidebarSectionCreate")}>
            <SidebarNavItem
              to={
                newSessionProjectId
                  ? `/new-session?projectId=${encodeURIComponent(newSessionProjectId)}`
                  : "/new-session"
              }
              icon={SidebarIcons.newSession}
              label={t("sidebarNewSession")}
              onClick={onNavigate}
              basePath={basePath}
              variant="primary"
            />
          </SidebarNavSection>
        </div>

        <div className="sidebar-sessions">
          <div className="sidebar-nav-card">
            <SidebarNavSection title={t("sidebarSectionWork")}>
              {primaryNavItems.map((item) => (
                <SidebarNavItem
                  key={item.to}
                  to={item.to}
                  icon={item.icon}
                  label={item.label}
                  badge={item.badge}
                  onClick={onNavigate}
                  basePath={basePath}
                />
              ))}
              <AgentsNavItem onClick={onNavigate} basePath={basePath} />
            </SidebarNavSection>
          </div>

          <div className="sidebar-nav-card sidebar-nav-card--secondary">
            <SidebarNavSection title={t("sidebarSectionControl")}>
              {controlNavItems.map((item) => (
                <SidebarNavItem
                  key={item.to}
                  to={item.to}
                  icon={item.icon}
                  label={item.label}
                  onClick={onNavigate}
                  basePath={basePath}
                />
              ))}
              {remoteConnection && (
              <button
                type="button"
                className="sidebar-nav-item sidebar-switch-host"
                onClick={handleSwitchHost}
              >
                <span className="sidebar-nav-icon">
                  <ArrowRightLeft
                    size={16}
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                </span>
                <span className="sidebar-nav-text">
                  {t("sidebarSwitchHost")}
                </span>
              </button>
              )}
            </SidebarNavSection>
          </div>

          {/* Global sessions list */}
          {filteredStarredSessions.length > 0 && (
            <div className="sidebar-section">
              <h3 className="sidebar-section-title">
                {t("sidebarSectionStarred")}
              </h3>
              <ul className="sidebar-session-list">
                {filteredStarredSessions
                  .slice(0, starredSessionsLimit)
                  .map((session) => (
                    <SessionListItem
                      key={session.id}
                      sessionId={session.id}
                      projectId={session.projectId}
                      title={getSessionDisplayTitle(session)}
                      fullTitle={getSessionDisplayTitle(session)}
                      provider={session.provider}
                      status={session.ownership}
                      pendingInputType={session.pendingInputType}
                      hasUnread={session.hasUnread}
                      isStarred={session.isStarred}
                      isArchived={session.isArchived}
                      mode="compact"
                      isCurrent={session.id === currentSessionId}
                      activity={session.activity}
                      onNavigate={onNavigate}
                      showProjectName
                      projectName={session.projectName}
                      basePath={basePath}
                      messageCount={session.messageCount}
                      hasDraft={drafts.has(session.id)}
                      hasBotBinding={botBoundSessionIds.has(session.id)}
                      onDelete={handleDeleteSession(
                        session.id,
                        session.projectId,
                      )}
                    />
                  ))}
              </ul>
              {filteredStarredSessions.length > starredSessionsLimit && (
                <button
                  type="button"
                  className="sidebar-show-more"
                  onClick={() =>
                    setStarredSessionsLimit(
                      (prev) => prev + RECENT_SESSIONS_INCREMENT,
                    )
                  }
                >
                  {t("actionShowMore", {
                    count: Math.min(
                      RECENT_SESSIONS_INCREMENT,
                      filteredStarredSessions.length - starredSessionsLimit,
                    ),
                  })}
                </button>
              )}
            </div>
          )}

          {historyProjectGroups.length > 0 && (
            <div className="sidebar-section sidebar-history-section">
              <h3 className="sidebar-section-title">
                {locale === "zh-CN" ? "对话历史" : "Conversation history"}
              </h3>
              <div className="sidebar-history-projects">
                {historyProjectGroups.map((projectGroup) => {
                  const isCollapsed = collapsedHistoryProjectIds.has(
                    projectGroup.projectId,
                  );
                  const panelId = `sidebar-history-project-${projectGroup.projectId}`;
                  return (
                    <section
                      key={projectGroup.projectId}
                      className={`sidebar-history-project ${isCollapsed ? "sidebar-history-project--collapsed" : ""}`}
                      aria-label={projectGroup.projectName}
                    >
                      <button
                        type="button"
                        className="sidebar-history-project-header"
                        aria-expanded={!isCollapsed}
                        aria-controls={panelId}
                        onClick={() =>
                          toggleHistoryProject(projectGroup.projectId)
                        }
                      >
                        <span className="sidebar-history-project-chevron">
                          ›
                        </span>
                        <span className="sidebar-history-project-name">
                          {projectGroup.projectName}
                        </span>
                        <span className="sidebar-history-project-count">
                          {projectGroup.count}
                        </span>
                      </button>
                      {!isCollapsed && (
                        <div
                          id={panelId}
                          className="sidebar-history-project-body"
                        >
                          {projectGroup.timeGroups.map((timeGroup) => (
                            <div
                              key={`${projectGroup.projectId}-${timeGroup.bucket}`}
                              className="sidebar-history-time-group"
                            >
                              <div className="sidebar-history-time-label">
                                {timeGroup.label}
                              </div>
                              <ul className="sidebar-session-list sidebar-history-list">
                                {timeGroup.sessions.map((session) => (
                                  <SessionListItem
                                    key={session.id}
                                    sessionId={session.id}
                                    projectId={session.projectId}
                                    title={getSessionDisplayTitle(session)}
                                    fullTitle={getSessionDisplayTitle(session)}
                                    provider={session.provider}
                                    status={session.ownership}
                                    pendingInputType={session.pendingInputType}
                                    hasUnread={session.hasUnread}
                                    isStarred={session.isStarred}
                                    isArchived={session.isArchived}
                                    mode="compact"
                                    isCurrent={session.id === currentSessionId}
                                    activity={session.activity}
                                    onNavigate={onNavigate}
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
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
              {historySessions.length > historySessionsLimit && (
                <button
                  type="button"
                  className="sidebar-show-more"
                  onClick={() =>
                    setHistorySessionsLimit(
                      (prev) => prev + RECENT_SESSIONS_INCREMENT,
                    )
                  }
                >
                  {t("actionShowMore", {
                    count: Math.min(
                      RECENT_SESSIONS_INCREMENT,
                      historySessions.length - historySessionsLimit,
                    ),
                  })}
                </button>
              )}
            </div>
          )}

          {filteredStarredSessions.length === 0 &&
            historyProjectGroups.length === 0 && (
              <p className="sidebar-empty">
                {sessionsLoading
                  ? t("sidebarLoadingSessions")
                  : t("sidebarNoSessions")}
              </p>
            )}
        </div>

        {/* Resize handle - desktop only, when expanded */}
        {isDesktop && !isCollapsed && (
          <div
            className={`sidebar-resize-handle ${isResizing ? "active" : ""}`}
            onMouseDown={handleResizeMouseDown}
            role="separator"
            aria-orientation="vertical"
            aria-label={t("actionResizeSidebar")}
            tabIndex={0}
          />
        )}
      </aside>
    </>
  );
}
