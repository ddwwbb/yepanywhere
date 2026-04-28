import { useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, Clock, Search, Filter } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { PageHero } from "../components/PageHero";
import { useNavigationLayout } from "../layouts";
import {
  type FileChangeEvent,
  type FileType,
  useFileActivity,
} from "../hooks/useFileActivity";
import { useI18n } from "../i18n";

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString();
}

function formatDate(timestamp: string): string {
  return new Date(timestamp).toLocaleDateString();
}

function getTypeIcon(type: FileChangeEvent["changeType"]): string {
  switch (type) {
    case "create":
      return "+";
    case "modify":
      return "~";
    case "delete":
      return "-";
  }
}

function getTypeColor(type: FileChangeEvent["changeType"]): string {
  switch (type) {
    case "create":
      return "#4f4";
    case "modify":
      return "#ff4";
    case "delete":
      return "#f44";
  }
}

function getTypeLabel(
  type: FileChangeEvent["changeType"],
  t: (key: never) => string,
): string {
  switch (type) {
    case "create":
      return t("activityTypeCreated" as never);
    case "modify":
      return t("activityTypeModified" as never);
    case "delete":
      return t("activityTypeDeleted" as never);
  }
}

function getFileTypeLabel(
  fileType: FileType,
  t: (key: never) => string,
): string {
  switch (fileType) {
    case "session":
      return t("activityFileTypeSession" as never);
    case "agent-session":
      return t("activityFileTypeAgentSession" as never);
    case "settings":
      return t("activityFileTypeSettings" as never);
    case "credentials":
      return t("activityFileTypeCredentials" as never);
    case "telemetry":
      return t("activityFileTypeTelemetry" as never);
    case "other":
      return t("activityFileTypeOther" as never);
  }
}

const FILE_TYPE_OPTIONS: FileType[] = [
  "session",
  "agent-session",
  "settings",
  "credentials",
  "telemetry",
  "other",
];

export function ActivityPage() {
  const { t } = useI18n();
  const [pathFilter, setPathFilter] = useState("");
  const [typeFilters, setTypeFilters] = useState<Set<FileType>>(new Set());
  const { events, connected, paused, clearEvents, togglePause } =
    useFileActivity();
  const nav = useNavigationLayout();
  // Fallback if context is missing (e.g. during transitions or if route is misconfigured)
  const { openSidebar, isWideScreen, toggleSidebar, isSidebarCollapsed } = nav || {
    openSidebar: () => {},
    isWideScreen: true,
    toggleSidebar: () => {},
    isSidebarCollapsed: false,
  };


  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  // Apply filters
  let filteredEvents = events;

  if (pathFilter) {
    const regex = new RegExp(pathFilter, "i");
    filteredEvents = filteredEvents.filter((e) => regex.test(e.relativePath));
  }

  if (typeFilters.size > 0) {
    filteredEvents = filteredEvents.filter((e) => typeFilters.has(e.fileType));
  }

  // Reverse for chronological order (oldest at top, newest at bottom)
  const displayedEvents = [...filteredEvents].reverse();

  const toggleTypeFilter = (type: FileType) => {
    setTypeFilters((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  // Track scroll position to know if we should auto-scroll
  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const threshold = 20;
    isAtBottomRef.current =
      container.scrollHeight - container.scrollTop - container.clientHeight <
      threshold;
  };

  // Auto-scroll to bottom when new events arrive (if already at bottom)
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally trigger on events change
  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (container && isAtBottomRef.current) {
      container.scrollTop = container.scrollHeight;
    }
  }, [displayedEvents.length]);



  // Group events by date
  const eventsByDate = displayedEvents.reduce(
    (acc, event) => {
      const date = formatDate(event.timestamp);
      if (!acc[date]) {
        acc[date] = [];
      }
      acc[date].push(event);
      return acc;
    },
    {} as Record<string, FileChangeEvent[]>,
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
          title={t("activityTitle" as never)}
          onOpenSidebar={openSidebar}
          onToggleSidebar={toggleSidebar}
          isWideScreen={isWideScreen}
          isSidebarCollapsed={isSidebarCollapsed}
        />

        <main className="page-scroll-container">
          <div className="page-content-inner">


      <PageHero
        title={t("activityTitle" as never)}
        icon={<Activity size={28} />}
        metrics={[
          {
            label: "Total Events",
            value: events.length,
            icon: <Clock size={18} />,
          },
          {
            label: "Filtered",
            value: displayedEvents.length,
            icon: <Filter size={18} />,
          },
        ]}
      >
        <div className="page-hero__search">
          <Search size={16} />
          <input
            type="text"
            value={pathFilter}
            onChange={(e) => setPathFilter(e.target.value)}
            placeholder={t("activityPathPlaceholder" as never)}
          />
        </div>
      </PageHero>


      {/* Controls */}
      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          marginBottom: "1rem",
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          onClick={togglePause}
          className="page-hero-action"
          style={{
            background: paused ? "var(--color-error)" : "var(--bg-secondary)",
            color: paused ? "white" : "var(--text-primary)",
          }}
        >
          {paused ? t("activityResume" as never) : t("activityPause" as never)}
        </button>
        <button
          type="button"
          onClick={clearEvents}
          className="page-hero-action"
        >
          {t("activityClear" as never)}
        </button>
      </div>

      {/* Type filters */}
      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          marginBottom: "1rem",
          flexWrap: "wrap",
        }}
      >
        {FILE_TYPE_OPTIONS.map((type) => (
          <button
            type="button"
            key={type}
            onClick={() => toggleTypeFilter(type)}
            style={{
              padding: "0.5rem 0.75rem",
              fontSize: "0.875rem",
              background: typeFilters.has(type) ? "#4a4aff" : "#333",
              border: typeFilters.has(type)
                ? "1px solid #5a5aff"
                : "1px solid #444",
            }}
          >
            {getFileTypeLabel(type, t)}
          </button>
        ))}
        {typeFilters.size > 0 && (
          <button
            type="button"
            onClick={() => setTypeFilters(new Set())}
            style={{
              padding: "0.5rem 0.75rem",
              fontSize: "0.875rem",
              background: "#444",
            }}
          >
            {t("activityClearFilters" as never)}
          </button>
        )}
      </div>



      {/* Events - scrollable container */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="activity-scroll-container"
      >

        {Object.entries(eventsByDate).length === 0 ? (
          <div style={{ textAlign: "center", padding: "3rem", color: "#888" }}>
            {events.length === 0
              ? t("activityWaiting" as never)
              : t("activityNoMatches" as never)}
          </div>
        ) : (
          Object.entries(eventsByDate).map(([date, dateEvents]) => (
            <div key={date} style={{ marginBottom: "1.5rem" }}>
              <h3
                style={{
                  color: "#888",
                  fontSize: "0.875rem",
                  marginBottom: "0.5rem",
                }}
              >
                {date}
              </h3>
              <div className="activity-date-group">

                {dateEvents.map((event, i) => (
                  <div
                    key={`${event.timestamp}-${event.path}-${i}`}
                    className="activity-item"
                  >
                    <span className="activity-item__time">
                      {formatTime(event.timestamp)}
                    </span>
                    <span
                      className={`activity-item__type activity-item__type--${event.changeType}`}
                      title={getTypeLabel(event.changeType, t)}
                    >
                      {getTypeIcon(event.changeType)}
                    </span>
                    <span className="activity-item__file-type">
                      {getFileTypeLabel(event.fileType, t)}
                    </span>
                    <span
                      className="activity-item__path"
                      title={event.path}
                    >
                      {event.relativePath}
                    </span>
                  </div>

                ))}
              </div>
            </div>
          ))
        )}
      </div>
          </div>
        </main>
      </div>
    </div>
  );
}
