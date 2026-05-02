import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client";
import { useI18n } from "../i18n";
import { getProvider } from "../providers/registry";

export interface SessionMenuProps {
  sessionId: string;
  projectId: string;
  isStarred: boolean;
  isArchived: boolean;
  hasUnread?: boolean;
  /** Provider name - used for capability checks like cloning support */
  provider?: string;
  /** Process ID if session has an active process (enables terminate option) */
  processId?: string;
  onToggleStar: () => void | Promise<void>;
  onToggleArchive: () => void | Promise<void>;
  onToggleRead?: () => void | Promise<void>;
  onRename: () => void;
  /** Called after successful clone with the new session ID */
  onClone?: (newSessionId: string) => void | Promise<void>;
  /** Called to terminate the session's process */
  onTerminate?: () => void | Promise<void>;
  /** Called to delete the session (with confirmation handled by caller) */
  onDelete?: () => void | Promise<void>;
  /** Use "..." icon instead of chevron */
  useEllipsisIcon?: boolean;
  /** Whether session sharing is configured */
  sharingConfigured?: boolean;
  /** Called to share the session as a snapshot */
  onShare?: () => void | Promise<void>;
  /** Additional class for the wrapper */
  className?: string;
  /** Use fixed positioning for dropdown (escapes overflow clipping) */
  useFixedPositioning?: boolean;
  /** Currently bound remote channel bot ID, if any */
  boundBotId?: string;
}

export function SessionMenu({
  sessionId,
  projectId,
  isStarred,
  isArchived,
  hasUnread,
  provider,
  processId,
  onToggleStar,
  onToggleArchive,
  onToggleRead,
  onRename,
  onClone,
  onTerminate,
  onDelete,
  sharingConfigured,
  onShare,
  useEllipsisIcon = false,
  className = "",
  useFixedPositioning = false,
  boundBotId,
}: SessionMenuProps) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [isCloning, setIsCloning] = useState(false);
  const [isTerminating, setIsTerminating] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [isBindingBot, setIsBindingBot] = useState(false);
  const [showBotPicker, setShowBotPicker] = useState(false);
  const [availableBots, setAvailableBots] = useState<Array<{
    botId: string;
    channel: string;
    name?: string;
    boundSessionId?: string;
  }> | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState<{
    top: number;
    left?: number;
    right?: number;
  } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside or scrolling (mobile)
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      // Check both wrapper and dropdown (dropdown may be in portal)
      const clickedInWrapper = wrapperRef.current?.contains(target);
      const clickedInDropdown = dropdownRef.current?.contains(target);
      if (!clickedInWrapper && !clickedInDropdown) {
        setIsOpen(false);
        triggerRef.current?.blur();
      }
    };
    const handleScroll = (e: Event) => {
      // Only close if scroll happens in an ancestor of the menu trigger
      // This prevents closing when unrelated areas (like main content pane) scroll
      const scrollTarget = e.target as Node;
      if (
        scrollTarget instanceof Node &&
        wrapperRef.current &&
        !scrollTarget.contains(wrapperRef.current)
      ) {
        return; // Scroll is not in an ancestor of the menu, ignore
      }
      setIsOpen(false);
      setDropdownPosition(null);
      triggerRef.current?.blur();
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("scroll", handleScroll, true);
    };
  }, [isOpen]);

  const handleToggleOpen = () => {
    if (isOpen) {
      setIsOpen(false);
      setDropdownPosition(null);
      setShowBotPicker(false);
      setAvailableBots(null);
      triggerRef.current?.blur();
    } else {
      // Calculate position synchronously before opening to avoid flicker
      if (useFixedPositioning && triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        const dropdownWidth = 140; // Approximate width of dropdown
        const dropdownHeight = 180; // Approximate height of dropdown (varies by options)
        const rightPosition = window.innerWidth - rect.right;
        const margin = 8;

        // Check if dropdown would overflow bottom of viewport
        const wouldOverflowBottom =
          rect.bottom + margin + dropdownHeight > window.innerHeight;

        // Calculate vertical position - show above trigger if it would overflow bottom
        const top = wouldOverflowBottom
          ? rect.top - dropdownHeight - margin
          : rect.bottom + margin;

        // If right-aligned would overflow left edge, use left-aligned instead
        if (rect.right - dropdownWidth < margin) {
          setDropdownPosition({
            top,
            left: rect.left,
          });
        } else {
          setDropdownPosition({
            top,
            right: rightPosition,
          });
        }
      }
      setIsOpen(true);
    }
  };

  const handleAction = (action: () => void | Promise<void>) => {
    setIsOpen(false);
    setDropdownPosition(null);
    setShowBotPicker(false);
    setAvailableBots(null);
    triggerRef.current?.blur();
    action();
  };

  const handleClone = async () => {
    if (isCloning) return;
    setIsCloning(true);
    setIsOpen(false);
    setDropdownPosition(null);
    triggerRef.current?.blur();
    try {
      const result = await api.cloneSession(
        projectId,
        sessionId,
        undefined,
        provider,
      );
      onClone?.(result.sessionId);
    } catch (error) {
      console.error("Failed to clone session:", error);
    } finally {
      setIsCloning(false);
    }
  };

  const handleTerminate = async () => {
    if (isTerminating || !onTerminate) return;
    setIsTerminating(true);
    setIsOpen(false);
    setDropdownPosition(null);
    triggerRef.current?.blur();
    try {
      await onTerminate();
    } catch (error) {
      console.error("Failed to terminate session:", error);
    } finally {
      setIsTerminating(false);
    }
  };

  const handleShare = async () => {
    if (isSharing || !onShare) return;
    setIsSharing(true);
    setIsOpen(false);
    setDropdownPosition(null);
    triggerRef.current?.blur();
    try {
      await onShare();
    } catch (error) {
      console.error("Failed to share session:", error);
    } finally {
      setIsSharing(false);
    }
  };

  const handleShowBotPicker = async () => {
    setIsBindingBot(true);
    try {
      const result = await api.getAvailableBots();
      setAvailableBots(result.bots);
      setShowBotPicker(true);
    } catch (error) {
      console.error("Failed to load available bots:", error);
    } finally {
      setIsBindingBot(false);
    }
  };

  const handleBindBot = async (botId: string) => {
    setIsBindingBot(true);
    try {
      await api.bindRemoteChannelBot(botId, sessionId);
      setShowBotPicker(false);
      setIsOpen(false);
      setDropdownPosition(null);
    } catch (error) {
      console.error("Failed to bind bot:", error);
    } finally {
      setIsBindingBot(false);
    }
  };

  const handleUnbindBot = async () => {
    if (!boundBotId) return;
    setIsBindingBot(true);
    try {
      await api.bindRemoteChannelBot(boundBotId, null);
      setIsOpen(false);
      setDropdownPosition(null);
    } catch (error) {
      console.error("Failed to unbind bot:", error);
    } finally {
      setIsBindingBot(false);
    }
  };

  const wrapperClasses = [
    "session-menu-wrapper",
    className,
    isOpen && "is-open",
  ]
    .filter(Boolean)
    .join(" ");

  // For portal mode, we must have fixed positioning with calculated coordinates
  // Fall back to a visible position if calculation failed
  const dropdownStyle = useFixedPositioning
    ? {
        position: "fixed" as const,
        top: dropdownPosition?.top ?? 100,
        ...(dropdownPosition?.left !== undefined
          ? { left: dropdownPosition.left }
          : { right: dropdownPosition?.right ?? 20 }),
      }
    : undefined;

  const dropdownContent = (
    <div
      ref={dropdownRef}
      className="session-menu-dropdown"
      style={dropdownStyle}
    >
      <button type="button" onClick={() => handleAction(onToggleStar)}>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill={isStarred ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
        {isStarred ? t("sessionMenuUnstar") : t("sessionMenuStar")}
      </button>
      <button type="button" onClick={() => handleAction(onRename)}>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
        {t("sessionMenuRename")}
      </button>
      {onClone && getProvider(provider).capabilities.supportsCloning && (
        <button type="button" onClick={handleClone} disabled={isCloning}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          {isCloning ? t("sessionMenuCloning") : t("sessionMenuClone")}
        </button>
      )}
      {sharingConfigured && onShare && (
        <button type="button" onClick={handleShare} disabled={isSharing}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
          {isSharing ? t("sessionMenuSharing") : t("sessionMenuShare")}
        </button>
      )}
      <button type="button" onClick={() => handleAction(onToggleArchive)}>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <polyline points="21 8 21 21 3 21 3 8" />
          <rect x="1" y="3" width="22" height="5" />
          <line x1="10" y1="12" x2="14" y2="12" />
        </svg>
        {isArchived ? t("sessionMenuUnarchive") : t("sessionMenuArchive")}
      </button>
      <button
        type="button"
        onClick={boundBotId ? handleUnbindBot : handleShowBotPicker}
        disabled={isBindingBot}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {boundBotId
          ? isBindingBot
            ? t("sessionMenuUnbinding")
            : t("sessionMenuUnbindChannel")
          : isBindingBot
            ? t("sessionMenuLoadingBots")
            : t("sessionMenuBindChannel")}
      </button>
      {showBotPicker && availableBots && (
        <div className="session-menu-bot-picker">
          {availableBots.length === 0 && (
            <span className="session-menu-bot-empty">
              {t("sessionMenuNoBotsAvailable")}
            </span>
          )}
          {availableBots.map((bot) => (
            <button
              key={bot.botId}
              type="button"
              className="session-menu-bot-option"
              onClick={() => void handleBindBot(bot.botId)}
              disabled={isBindingBot}
            >
              <span className="session-menu-bot-channel">[{bot.channel}]</span>
              {bot.name || bot.botId.slice(-6)}
              {bot.boundSessionId && (
                <span className="session-menu-bot-bound">
                  {t("sessionMenuBotBoundReplace")}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      {onToggleRead && (
        <button type="button" onClick={() => handleAction(onToggleRead)}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            {hasUnread ? (
              // Checkmark icon for "Mark as read"
              <polyline points="20 6 9 17 4 12" />
            ) : (
              // Envelope/circle icon for "Mark as unread"
              <circle cx="12" cy="12" r="10" />
            )}
          </svg>
          {hasUnread ? t("sessionMenuMarkRead") : t("sessionMenuMarkUnread")}
        </button>
      )}
      {processId && onTerminate && (
        <button
          type="button"
          onClick={handleTerminate}
          disabled={isTerminating}
          className="terminate-button"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            {/* X in a square (stop/terminate icon) */}
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="9" y1="9" x2="15" y2="15" />
            <line x1="15" y1="9" x2="9" y2="15" />
          </svg>
          {isTerminating
            ? t("sessionMenuTerminating")
            : t("sessionMenuTerminate")}
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          className="session-menu-delete-button"
          onClick={() => handleAction(onDelete)}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
          {t("sessionMenuDelete")}
        </button>
      )}
    </div>
  );

  // Render dropdown via portal when using fixed positioning to escape overflow clipping
  const renderDropdown = () => {
    if (useFixedPositioning) {
      return createPortal(dropdownContent, document.body);
    }
    return dropdownContent;
  };

  return (
    <div className={wrapperClasses} ref={wrapperRef}>
      <button
        ref={triggerRef}
        type="button"
        className="session-menu-trigger"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          handleToggleOpen();
        }}
        title={t("sessionMenuOptions")}
        aria-label={t("sessionMenuOptions")}
        aria-expanded={isOpen}
      >
        {useEllipsisIcon ? (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="currentColor"
            stroke="none"
            aria-hidden="true"
          >
            <circle cx="5" cy="12" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="19" cy="12" r="2" />
          </svg>
        ) : (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        )}
      </button>
      {isOpen && renderDropdown()}
    </div>
  );
}
