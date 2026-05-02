import type { MouseEvent, TouchEvent } from "react";
import type { GlobalSessionItem } from "../../api/client";
import { SessionListItem } from "../../components/SessionListItem";
import { useI18n } from "../../i18n";
import { getSessionDisplayTitle } from "../../utils";

interface GlobalSessionsListProps {
  sessions: GlobalSessionItem[];
  isWideScreen: boolean;
  isSelectionMode: boolean;
  selectedIds: ReadonlySet<string>;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onSelect: (sessionId: string, selected: boolean) => void;
  onLongPressStart: (sessionId: string, event: TouchEvent | MouseEvent) => void;
  onTouchMove: (event: TouchEvent) => void;
  onLongPressEnd: () => void;
  onContextMenu: (event: MouseEvent) => void;
  showProjectName: boolean;
  basePath: string;
  draftSessionIds: ReadonlySet<string>;
  botBoundSessionIds: ReadonlySet<string>;
  onDeleteSession: (sessionId: string, projectId: string) => () => void;
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
}

export function GlobalSessionsList({
  sessions,
  isWideScreen,
  isSelectionMode,
  selectedIds,
  onSelectAll,
  onClearSelection,
  onSelect,
  onLongPressStart,
  onTouchMove,
  onLongPressEnd,
  onContextMenu,
  showProjectName,
  basePath,
  draftSessionIds,
  botBoundSessionIds,
  onDeleteSession,
  hasMore,
  loading,
  onLoadMore,
}: GlobalSessionsListProps) {
  const { t } = useI18n();

  return (
    <>
      {(isWideScreen || isSelectionMode) && sessions.length > 0 && (
        <div className="session-list-header">
          <label className="session-list-header__select-all">
            <input
              type="checkbox"
              checked={
                selectedIds.size === sessions.length && sessions.length > 0
              }
              onChange={(event) =>
                event.target.checked ? onSelectAll() : onClearSelection()
              }
            />
            <span>
              {selectedIds.size > 0
                ? t("bulkSelectedCount", { count: selectedIds.size })
                : t("globalSessionsSelectAll")}
            </span>
          </label>
        </div>
      )}

      <ul
        className={`session-list ${isSelectionMode ? "session-list--selection-mode" : ""}`}
      >
        {sessions.map((session) => (
          <div
            key={session.id}
            onTouchStart={(event) => onLongPressStart(session.id, event)}
            onTouchMove={onTouchMove}
            onTouchEnd={onLongPressEnd}
            onTouchCancel={onLongPressEnd}
            onMouseDown={(event) =>
              !isWideScreen && onLongPressStart(session.id, event)
            }
            onMouseUp={onLongPressEnd}
            onMouseLeave={onLongPressEnd}
            onContextMenu={onContextMenu}
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
              isSelectionMode={isSelectionMode && !isWideScreen}
              onNavigate={() => {
                if (isSelectionMode && !isWideScreen) {
                  onSelect(session.id, !selectedIds.has(session.id));
                }
              }}
              onSelect={isWideScreen || isSelectionMode ? onSelect : undefined}
              showProjectName={showProjectName}
              projectName={session.projectName}
              basePath={basePath}
              messageCount={session.messageCount}
              hasDraft={draftSessionIds.has(session.id)}
              hasBotBinding={botBoundSessionIds.has(session.id)}
              onDelete={onDeleteSession(session.id, session.projectId)}
            />
          </div>
        ))}
      </ul>

      {hasMore && (
        <div className="global-sessions-load-more">
          <button
            type="button"
            onClick={onLoadMore}
            className="global-sessions-load-more-button"
            disabled={loading}
          >
            {loading ? t("gitStatusLoading") : t("globalSessionsLoadMore")}
          </button>
        </div>
      )}
    </>
  );
}
