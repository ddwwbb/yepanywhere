import { ALL_PROVIDERS, type ProviderName } from "@yep-anywhere/shared";
import { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { BulkActionBar } from "../components/BulkActionBar";
import type { FilterOption } from "../components/FilterDropdown";
import { PageHeader } from "../components/PageHeader";
import { useDrafts } from "../hooks/useDrafts";
import { useGlobalSessions } from "../hooks/useGlobalSessions";
import { useRemoteBasePath } from "../hooks/useRemoteBasePath";
import { useServerSettings } from "../hooks/useServerSettings";
import { useI18n } from "../i18n";
import { useNavigationLayout } from "../layouts";
import { GlobalSessionsEmptyState } from "./global-sessions/GlobalSessionsEmptyState";
import { GlobalSessionsFilterBar } from "./global-sessions/GlobalSessionsFilterBar";
import { GlobalSessionsList } from "./global-sessions/GlobalSessionsList";
import { GlobalSessionsProjectActions } from "./global-sessions/GlobalSessionsProjectActions";
import {
  type AgeFilter,
  LONG_PRESS_MS,
  PROVIDER_COLORS,
  type StatusFilter,
  getBotBoundSessionIds,
} from "./global-sessions/sessionFilters";

/**
 * Global sessions page showing all sessions across all projects.
 * Supports filtering by project, status, provider, and search query.
 * Includes multi-select mode with bulk actions.
 */
export function GlobalSessionsPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { openSidebar, isWideScreen, toggleSidebar, isSidebarCollapsed } =
    useNavigationLayout();
  const basePath = useRemoteBasePath();
  const { settings } = useServerSettings();
  const botBoundSessionIds = useMemo(
    () => getBotBoundSessionIds(settings?.remoteChannels),
    [settings?.remoteChannels],
  );
  const [searchParams, setSearchParams] = useSearchParams();

  // Get filter params from URL
  const searchQuery = searchParams.get("q") || "";
  const projectFilter = searchParams.get("project") || undefined;

  // Local state for search input (instant feedback)
  const [searchInput, setSearchInput] = useState(searchQuery);

  // Status and provider filters from URL
  const statusFilters = useMemo(() => {
    const param = searchParams.get("status");
    if (!param) return [];
    return param
      .split(",")
      .filter((s): s is StatusFilter =>
        ["all", "unread", "starred", "archived"].includes(s),
      );
  }, [searchParams]);

  const providerFilters = useMemo(() => {
    const param = searchParams.get("provider");
    if (!param) return [];
    const knownProviders = Object.keys(PROVIDER_COLORS);
    return param
      .split(",")
      .filter((p): p is ProviderName => knownProviders.includes(p));
  }, [searchParams]);

  const executorFilters = useMemo(() => {
    const param = searchParams.get("executor");
    if (!param) return [];
    return param.split(",").filter(Boolean);
  }, [searchParams]);

  const ageFilter = useMemo(() => {
    const param = searchParams.get("age");
    if (param && ["3", "7", "14", "30"].includes(param))
      return param as AgeFilter;
    return undefined;
  }, [searchParams]);

  const setStatusFilters = useCallback(
    (filters: StatusFilter[]) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (filters.length > 0) {
          next.set("status", filters.join(","));
        } else {
          next.delete("status");
        }
        return next;
      });
    },
    [setSearchParams],
  );

  const setProviderFilters = useCallback(
    (filters: ProviderName[]) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (filters.length > 0) {
          next.set("provider", filters.join(","));
        } else {
          next.delete("provider");
        }
        return next;
      });
    },
    [setSearchParams],
  );

  const setExecutorFilters = useCallback(
    (filters: string[]) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (filters.length > 0) {
          next.set("executor", filters.join(","));
        } else {
          next.delete("executor");
        }
        return next;
      });
    },
    [setSearchParams],
  );

  const setAgeFilter = useCallback(
    (selected: AgeFilter[]) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (selected.length > 0 && selected[0]) {
          next.set("age", selected[0]);
        } else {
          next.delete("age");
        }
        return next;
      });
    },
    [setSearchParams],
  );

  // Include archived sessions when archived filter is selected
  const includeArchived = statusFilters.includes("archived");

  const { sessions, stats, projects, loading, error, hasMore, loadMore } =
    useGlobalSessions({
      projectId: projectFilter,
      searchQuery,
      includeArchived,
      includeStats: !projectFilter,
    });

  // Filter sessions based on status and provider filters (client-side)
  const filteredSessions = useMemo(() => {
    return sessions.filter((session) => {
      // Status filtering (empty = show all non-archived)
      if (statusFilters.length === 0) {
        // Default: show non-archived
        if (session.isArchived) return false;
      } else {
        // Check if session matches any selected status filter
        let matchesStatus = false;
        for (const status of statusFilters) {
          switch (status) {
            case "all":
              if (!session.isArchived) matchesStatus = true;
              break;
            case "unread":
              if (session.hasUnread && !session.isArchived)
                matchesStatus = true;
              break;
            case "starred":
              if (session.isStarred) matchesStatus = true;
              break;
            case "archived":
              if (session.isArchived) matchesStatus = true;
              break;
          }
        }
        if (!matchesStatus) return false;
      }

      // Provider filtering (empty = show all providers)
      if (providerFilters.length > 0) {
        if (!session.provider || !providerFilters.includes(session.provider)) {
          return false;
        }
      }

      // Executor filtering (empty = show all executors)
      if (executorFilters.length > 0) {
        const sessionExecutor = session.executor ?? "local";
        if (!executorFilters.includes(sessionExecutor)) {
          return false;
        }
      }

      // Age filtering (only show sessions older than N days)
      if (ageFilter) {
        const days = Number(ageFilter);
        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
        if (new Date(session.updatedAt).getTime() > cutoff) {
          return false;
        }
      }

      return true;
    });
  }, [sessions, statusFilters, providerFilters, executorFilters, ageFilter]);

  // Track which sessions have unsent drafts
  const drafts = useDrafts();

  // Build status filter options with global counts from server
  // When filtering by project, we don't have global stats, so omit counts
  const statusOptions = useMemo((): FilterOption<StatusFilter>[] => {
    // Only show counts when not filtering by project (global view)
    const showCounts = !projectFilter;

    return [
      {
        value: "all",
        label: t("globalSessionsStatusAll"),
        count: showCounts ? stats.totalCount : undefined,
      },
      {
        value: "unread",
        label: t("globalSessionsStatusUnread"),
        count: showCounts ? stats.unreadCount : undefined,
      },
      {
        value: "starred",
        label: t("globalSessionsStatusStarred"),
        count: showCounts ? stats.starredCount : undefined,
      },
      {
        value: "archived",
        label: t("globalSessionsStatusArchived"),
        count: showCounts ? stats.archivedCount : undefined,
      },
    ];
  }, [stats, projectFilter, t]);

  // Build provider filter options with global counts from server
  // When filtering by project, we don't have global stats, so omit counts
  const providerOptions = useMemo((): FilterOption<ProviderName>[] => {
    const showCounts = !projectFilter;
    const providerCounts = stats.providerCounts;

    // Only show providers that have sessions
    const options: FilterOption<ProviderName>[] = [];
    for (const provider of ALL_PROVIDERS) {
      const count = providerCounts[provider];
      if (count && count > 0) {
        options.push({
          value: provider,
          label: provider.charAt(0).toUpperCase() + provider.slice(1),
          count: showCounts ? count : undefined,
          color: PROVIDER_COLORS[provider],
        });
      }
    }
    return options;
  }, [stats.providerCounts, projectFilter]);

  // Age filter options
  const ageOptions = useMemo((): FilterOption<AgeFilter>[] => {
    return [
      { value: "3", label: t("globalSessionsAge3Days") },
      { value: "7", label: t("globalSessionsAge7Days") },
      { value: "14", label: t("globalSessionsAge14Days") },
      { value: "30", label: t("globalSessionsAge30Days") },
    ];
  }, [t]);

  // Build executor filter options with global counts from server
  const executorOptions = useMemo((): FilterOption<string>[] => {
    const showCounts = !projectFilter;
    const executorCounts = stats.executorCounts;

    // Only show executors that have sessions, sorted with "local" first
    const entries = Object.entries(executorCounts).filter(
      ([_, count]) => count > 0,
    );
    entries.sort((a, b) => {
      // "local" always comes first
      if (a[0] === "local") return -1;
      if (b[0] === "local") return 1;
      return a[0].localeCompare(b[0]);
    });

    return entries.map(([executor, count]) => ({
      value: executor,
      label: executor === "local" ? t("globalSessionsExecutorLocal") : executor,
      count: showCounts ? count : undefined,
    }));
  }, [stats.executorCounts, projectFilter, t]);

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

  // "Archive all" for filtered results (no manual selection needed)
  const handleArchiveAllFiltered = useCallback(async () => {
    if (isBulkActionPending) return;
    const archivable = filteredSessions.filter((s) => !s.isArchived);
    if (archivable.length === 0) return;
    setIsBulkActionPending(true);
    try {
      await Promise.all(
        archivable.map((s) =>
          api.updateSessionMetadata(s.id, { archived: true }),
        ),
      );
    } finally {
      setIsBulkActionPending(false);
    }
  }, [filteredSessions, isBulkActionPending]);

  // Count of archivable sessions in filtered results
  const archivableFilteredCount = useMemo(
    () => filteredSessions.filter((s) => !s.isArchived).length,
    [filteredSessions],
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

  // Handle search form submit
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const newParams = new URLSearchParams(searchParams);
    if (searchInput.trim()) {
      newParams.set("q", searchInput.trim());
    } else {
      newParams.delete("q");
    }
    setSearchParams(newParams);
  };

  // Handle project filter change
  const handleProjectFilter = useCallback(
    (selected: string[]) => {
      const newParams = new URLSearchParams(searchParams);
      if (selected.length > 0 && selected[0]) {
        newParams.set("project", selected[0]);
      } else {
        newParams.delete("project");
      }
      setSearchParams(newParams);
    },
    [searchParams, setSearchParams],
  );

  // Build project filter options
  const projectOptions = useMemo((): FilterOption<string>[] => {
    return projects.map((project) => ({
      value: project.id,
      label: project.name,
    }));
  }, [projects]);

  // Clear all filters
  const clearFilters = () => {
    setSearchInput("");
    setSearchParams(new URLSearchParams());
  };

  const isEmpty = filteredSessions.length === 0;
  const hasFilters = Boolean(
    searchQuery ||
      projectFilter ||
      statusFilters.length > 0 ||
      providerFilters.length > 0 ||
      executorFilters.length > 0 ||
      ageFilter,
  );

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
            {projectFilter && (
              <GlobalSessionsProjectActions
                onOpenGitStatus={() =>
                  navigate(`${basePath}/git-status?projectId=${projectFilter}`)
                }
                onStartNewSession={() =>
                  navigate(`${basePath}/new-session?projectId=${projectFilter}`)
                }
              />
            )}

            <GlobalSessionsFilterBar
              searchInput={searchInput}
              onSearchInputChange={setSearchInput}
              onSearchSubmit={handleSearch}
              projectOptions={projectOptions}
              projectFilter={projectFilter}
              onProjectFilterChange={handleProjectFilter}
              statusOptions={statusOptions}
              statusFilters={statusFilters}
              onStatusFiltersChange={setStatusFilters}
              providerOptions={providerOptions}
              providerFilters={providerFilters}
              onProviderFiltersChange={setProviderFilters}
              executorOptions={executorOptions}
              executorFilters={executorFilters}
              onExecutorFiltersChange={setExecutorFilters}
              ageOptions={ageOptions}
              ageFilter={ageFilter}
              onAgeFilterChange={setAgeFilter}
              hasFilters={hasFilters}
              onClearFilters={clearFilters}
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
              <GlobalSessionsEmptyState hasFilters={hasFilters} />
            )}

            {!error && !isEmpty && (
              <GlobalSessionsList
                sessions={filteredSessions}
                isWideScreen={isWideScreen}
                isSelectionMode={isSelectionMode}
                selectedIds={selectedIds}
                onSelectAll={handleSelectAll}
                onClearSelection={handleClearSelection}
                onSelect={handleSelect}
                onLongPressStart={handleLongPressStart}
                onTouchMove={handleTouchMove}
                onLongPressEnd={handleLongPressEnd}
                onContextMenu={handleContextMenu}
                showProjectName={!projectFilter}
                basePath={basePath}
                draftSessionIds={drafts}
                botBoundSessionIds={botBoundSessionIds}
                onDeleteSession={handleDeleteSession}
                hasMore={hasMore}
                loading={loading}
                onLoadMore={loadMore}
              />
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
              onArchiveAllFiltered={
                hasFilters ? handleArchiveAllFiltered : undefined
              }
              archivableFilteredCount={archivableFilteredCount}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
