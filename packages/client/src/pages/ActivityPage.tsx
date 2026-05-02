import { useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  type FileChangeEvent,
  type FileType,
  useFileActivity,
} from "../hooks/useFileActivity";
import { type Translate, useI18n } from "../i18n";

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

function getTypeClass(type: FileChangeEvent["changeType"]): string {
  return `activity-event-type activity-event-type--${type}`;
}

function getTypeLabel(
  type: FileChangeEvent["changeType"],
  t: Translate,
): string {
  switch (type) {
    case "create":
      return t("activityTypeCreated");
    case "modify":
      return t("activityTypeModified");
    case "delete":
      return t("activityTypeDeleted");
  }
}

function getFileTypeLabel(fileType: FileType, t: Translate): string {
  switch (fileType) {
    case "session":
      return t("activityFileTypeSession");
    case "agent-session":
      return t("activityFileTypeAgentSession");
    case "settings":
      return t("activityFileTypeSettings");
    case "credentials":
      return t("activityFileTypeCredentials");
    case "telemetry":
      return t("activityFileTypeTelemetry");
    case "other":
      return t("activityFileTypeOther");
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

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  let filteredEvents = events;

  if (pathFilter) {
    const regex = new RegExp(pathFilter, "i");
    filteredEvents = filteredEvents.filter((event) =>
      regex.test(event.relativePath),
    );
  }

  if (typeFilters.size > 0) {
    filteredEvents = filteredEvents.filter((event) =>
      typeFilters.has(event.fileType),
    );
  }

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

  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const threshold = 20;
    isAtBottomRef.current =
      container.scrollHeight - container.scrollTop - container.clientHeight <
      threshold;
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally trigger on events change
  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (container && isAtBottomRef.current) {
      container.scrollTop = container.scrollHeight;
    }
  }, [displayedEvents.length]);

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
    <div className="page activity-page">
      <nav className="breadcrumb">
        <Link to="/projects">{t("pageTitleProjects")}</Link> /{" "}
        {t("activityBreadcrumb")}
      </nav>

      <div className="activity-header">
        <h1>{t("activityTitle")}</h1>
        <div className="activity-connection">
          <span
            className={`activity-status-dot ${
              connected
                ? "activity-status-dot--connected"
                : "activity-status-dot--disconnected"
            }`}
          />
          <span className="activity-connection-label">
            {connected ? t("activityConnected") : t("activityDisconnected")}
          </span>
        </div>
      </div>

      <div className="activity-controls">
        <input
          type="text"
          value={pathFilter}
          onChange={(event) => setPathFilter(event.target.value)}
          placeholder={t("activityPathPlaceholder")}
          className="activity-search"
        />
        <button
          type="button"
          onClick={togglePause}
          className={`activity-button${paused ? " activity-button--paused" : ""}`}
        >
          {paused ? t("activityResume") : t("activityPause")}
        </button>
        <button type="button" onClick={clearEvents} className="activity-button">
          {t("activityClear")}
        </button>
      </div>

      <div className="activity-type-filters">
        {FILE_TYPE_OPTIONS.map((type) => {
          const selected = typeFilters.has(type);
          return (
            <button
              type="button"
              key={type}
              onClick={() => toggleTypeFilter(type)}
              className={`activity-filter-button${
                selected ? " activity-filter-button--selected" : ""
              }`}
            >
              {getFileTypeLabel(type, t)}
            </button>
          );
        })}
        {typeFilters.size > 0 && (
          <button
            type="button"
            onClick={() => setTypeFilters(new Set())}
            className="activity-filter-button"
          >
            {t("activityClearFilters")}
          </button>
        )}
      </div>

      <div className="activity-stats">
        <span>{t("activityTotal", { count: events.length })}</span>
        <span>{t("activityShowing", { count: displayedEvents.length })}</span>
      </div>

      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="activity-events"
      >
        {Object.entries(eventsByDate).length === 0 ? (
          <div className="activity-empty">
            {events.length === 0
              ? t("activityWaiting")
              : t("activityNoMatches")}
          </div>
        ) : (
          Object.entries(eventsByDate).map(([date, dateEvents]) => (
            <div key={date} className="activity-date-group">
              <h3 className="activity-date-heading">{date}</h3>
              <div className="activity-date-events">
                {dateEvents.map((event, index) => (
                  <div
                    key={`${event.timestamp}-${event.path}-${index}`}
                    className="activity-event-row"
                  >
                    <span className="activity-event-time">
                      {formatTime(event.timestamp)}
                    </span>
                    <span
                      className={getTypeClass(event.changeType)}
                      title={getTypeLabel(event.changeType, t)}
                    >
                      {getTypeIcon(event.changeType)}
                    </span>
                    <span className="activity-file-type">
                      {getFileTypeLabel(event.fileType, t)}
                    </span>
                    <span className="activity-path" title={event.path}>
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
  );
}
