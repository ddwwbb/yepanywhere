import type { ProviderName, SlashCommand } from "@yep-anywhere/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { ModelSwitchModal } from "../components/ModelSwitchModal";
import { ProcessInfoModal } from "../components/ProcessInfoModal";
import {
  StreamingMarkdownProvider,
  useStreamingMarkdownContext,
} from "../contexts/StreamingMarkdownContext";
import { useToastContext } from "../contexts/ToastContext";
import { useActivityBusState } from "../hooks/useActivityBusState";
import { useDeveloperMode } from "../hooks/useDeveloperMode";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useEngagementTracking } from "../hooks/useEngagementTracking";
import { useProject } from "../hooks/useProjects";
import { useProviders } from "../hooks/useProviders";
import { recordSessionVisit } from "../hooks/useRecentSessions";
import { useRemoteBasePath } from "../hooks/useRemoteBasePath";
import {
  type StreamingMarkdownCallbacks,
  useSession,
} from "../hooks/useSession";
import { useI18n } from "../i18n";
import { useNavigationLayout } from "../layouts";
import { preprocessMessages } from "../lib/preprocessMessages";
import { getSessionDisplayTitle } from "../utils";
import { DeferredQueueBanner } from "./session/DeferredQueueBanner";
import { SessionErrorState } from "./session/SessionErrorState";
import { SessionHeader } from "./session/SessionHeader";
import { SessionInputArea } from "./session/SessionInputArea";
import { SessionMessages } from "./session/SessionMessages";
import { SessionWarnings } from "./session/SessionWarnings";
import { useSessionSubmission } from "./session/useSessionSubmission";

export function SessionPage() {
  const { projectId, sessionId } = useParams<{
    projectId: string;
    sessionId: string;
  }>();

  // Guard against missing params - this shouldn't happen with proper routing
  if (!projectId || !sessionId) {
    return <SessionPageInvalidRoute />;
  }

  // Key ensures component remounts on session change, resetting all state
  // Wrap with StreamingMarkdownProvider for server-rendered markdown streaming
  return (
    <StreamingMarkdownProvider>
      <SessionPageContent
        key={sessionId}
        projectId={projectId}
        sessionId={sessionId}
      />
    </StreamingMarkdownProvider>
  );
}

function SessionPageInvalidRoute() {
  const { t } = useI18n();
  return <div className="error">{t("sessionInvalidUrl")}</div>;
}

function SessionPageContent({
  projectId,
  sessionId,
}: {
  projectId: string;
  sessionId: string;
}) {
  const { t } = useI18n();
  const { openSidebar, isWideScreen, toggleSidebar, isSidebarCollapsed } =
    useNavigationLayout();
  const basePath = useRemoteBasePath();
  const { project } = useProject(projectId);
  const navigate = useNavigate();
  const location = useLocation();
  // Get initial status and title from navigation state (passed by NewSessionPage)
  // This allows SSE to connect immediately and show optimistic title without waiting for getSession
  // Also get model/provider so ProviderBadge can render immediately
  const navState = location.state as {
    initialStatus?: { owner: "self"; processId: string };
    initialTitle?: string;
    initialModel?: string;
    initialProvider?: ProviderName;
  } | null;
  const initialStatus = navState?.initialStatus;
  const initialTitle = navState?.initialTitle;
  const initialModel = navState?.initialModel;
  const initialProvider = navState?.initialProvider;

  // Get streaming markdown context for server-rendered markdown streaming
  const streamingMarkdownContext = useStreamingMarkdownContext();

  // Memoize the callbacks object to avoid recreating on every render
  const streamingMarkdownCallbacks = useMemo<
    StreamingMarkdownCallbacks | undefined
  >(() => {
    if (!streamingMarkdownContext) return undefined;
    return {
      onAugment: streamingMarkdownContext.dispatchAugment,
      onPending: streamingMarkdownContext.dispatchPending,
      onStreamEnd: streamingMarkdownContext.dispatchStreamEnd,
      setCurrentMessageId: streamingMarkdownContext.setCurrentMessageId,
      captureHtml: streamingMarkdownContext.captureStreamingHtml,
    };
  }, [streamingMarkdownContext]);

  const {
    session,
    messages,
    agentContent,
    setAgentContent,
    toolUseToAgent,
    markdownAugments,
    status,
    processState,
    isCompacting,
    pendingInputRequest,
    actualSessionId,
    permissionMode,
    loading,
    error,
    connected,
    sessionUpdatesConnected,
    lastStreamActivityAt,
    setStatus,
    setProcessState,
    setPermissionMode,
    setHold,
    isHeld,
    pendingMessages,
    addPendingMessage,
    removePendingMessage,
    updatePendingMessage,
    deferredMessages,
    slashCommands,
    setSessionModel,
    sessionTools,
    mcpServers,
    pagination,
    loadingOlder,
    loadOlderMessages,
    reconnectStream,
  } = useSession(
    projectId,
    sessionId,
    initialStatus,
    streamingMarkdownCallbacks,
  );

  const { holdModeEnabled, showConnectionBars } = useDeveloperMode();

  // Session connection bar state for active session update streams
  const { connectionState } = useActivityBusState();
  const hasSessionUpdateStream =
    status.owner === "self" || status.owner === "external";
  const sessionConnectionStatus =
    !showConnectionBars || !hasSessionUpdateStream
      ? "idle"
      : sessionUpdatesConnected
        ? "connected"
        : connectionState === "reconnecting"
          ? "connecting"
          : "disconnected";

  // Effective provider/model for immediate display before session data loads
  const effectiveProvider = session?.provider ?? initialProvider;
  const effectiveModel = session?.model ?? initialModel;

  const [scrollTrigger, setScrollTrigger] = useState(0);
  const handleScrollToBottom = useCallback(() => {
    setScrollTrigger((prev) => prev + 1);
  }, []);
  const { showToast } = useToastContext();

  // Sharing: check if configured (hidden unless sharing.json exists on server)
  const [sharingConfigured, setSharingConfigured] = useState(false);
  useEffect(() => {
    api
      .getSharingStatus()
      .then((res) => setSharingConfigured(res.configured))
      .catch(() => {});
  }, []);

  const allSlashCommands = useMemo<SlashCommand[]>(
    () => (status.owner === "self" ? slashCommands : []),
    [slashCommands, status.owner],
  );

  // Get provider capabilities based on session's provider
  const { providers } = useProviders();
  const currentProviderInfo = useMemo(() => {
    if (!session?.provider) return null;
    return providers.find((p) => p.name === session.provider) ?? null;
  }, [providers, session?.provider]);
  // Default to true for backwards compatibility (except slash commands)
  const supportsPermissionMode =
    currentProviderInfo?.supportsPermissionMode ?? true;
  const supportsThinkingToggle =
    currentProviderInfo?.supportsThinkingToggle ?? true;

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const isSavingTitleRef = useRef(false);

  const [showRecentSessions, setShowRecentSessions] = useState(false);
  const titleButtonRef = useRef<HTMLButtonElement>(null);

  // Local metadata state (for optimistic updates)
  // Reset when session changes to avoid showing stale data from previous session
  const [localCustomTitle, setLocalCustomTitle] = useState<string | undefined>(
    undefined,
  );
  const [localIsArchived, setLocalIsArchived] = useState<boolean | undefined>(
    undefined,
  );
  const [localIsStarred, setLocalIsStarred] = useState<boolean | undefined>(
    undefined,
  );
  const [localHasUnread, setLocalHasUnread] = useState<boolean | undefined>(
    undefined,
  );

  // Reset local metadata state when sessionId changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally reset on sessionId change
  useEffect(() => {
    setLocalCustomTitle(undefined);
    setLocalIsArchived(undefined);
    setLocalIsStarred(undefined);
    setLocalHasUnread(undefined);
  }, [sessionId]);

  // Record session visit for recents tracking
  useEffect(() => {
    recordSessionVisit(sessionId, projectId);
  }, [sessionId, projectId]);

  // Navigate to new session ID when temp ID is replaced with real SDK session ID
  // This ensures the URL stays in sync with the actual session
  useEffect(() => {
    if (actualSessionId && actualSessionId !== sessionId) {
      // Use replace to avoid creating a history entry for the temp ID
      navigate(
        `${basePath}/projects/${projectId}/sessions/${actualSessionId}`,
        {
          replace: true,
          state: location.state, // Preserve initial state for seamless transition
        },
      );
    }
  }, [
    actualSessionId,
    sessionId,
    projectId,
    navigate,
    location.state,
    basePath,
  ]);

  // Approval panel collapsed state (separate from message input collapse)
  const [approvalCollapsed, setApprovalCollapsed] = useState(false);

  // Process info modal state
  const [showProcessInfoModal, setShowProcessInfoModal] = useState(false);

  // Model switch modal state
  const [showModelSwitchModal, setShowModelSwitchModal] = useState(false);

  // Track user engagement to mark session as "seen"
  // Only enabled when not in external session (we own or it's idle)
  //
  // We use two timestamps:
  // - activityAt: max(file mtime, SSE activity) - triggers the mark-seen action
  // - updatedAt: file mtime only - the timestamp we record
  //
  // This separation prevents a race condition where SSE timestamps (client clock)
  // could be ahead of file mtime (server disk write time), causing sessions to
  // never become unread again after viewing.
  const sessionUpdatedAt = session?.updatedAt ?? null;
  const activityAt = useMemo(() => {
    if (!sessionUpdatedAt && !lastStreamActivityAt) return null;
    if (!sessionUpdatedAt) return lastStreamActivityAt;
    if (!lastStreamActivityAt) return sessionUpdatedAt;
    // Return the more recent timestamp
    return sessionUpdatedAt > lastStreamActivityAt
      ? sessionUpdatedAt
      : lastStreamActivityAt;
  }, [sessionUpdatedAt, lastStreamActivityAt]);

  useEngagementTracking({
    sessionId,
    activityAt,
    updatedAt: sessionUpdatedAt,
    lastSeenAt: session?.lastSeenAt,
    hasUnread: session?.hasUnread,
    enabled: status.owner !== "external",
  });

  const {
    attachments,
    uploadProgress,
    handleSend,
    handleQueue,
    handleAttach,
    handleRemoveAttachment,
    handleDraftControlsReady,
  } = useSessionSubmission({
    projectId,
    sessionId,
    status,
    processState,
    permissionMode,
    session,
    effectiveProvider,
    addPendingMessage,
    removePendingMessage,
    updatePendingMessage,
    setStatus,
    setProcessState,
    reconnectStream,
    onScrollToBottom: handleScrollToBottom,
  });

  const handleModelChanged = useCallback(
    (model: string) => {
      setSessionModel(model);
      showToast(t("sessionSwitchedModel", { model }), "success");
    },
    [setSessionModel, showToast, t],
  );

  const handleOpenModelSwitch = useCallback(() => {
    setShowModelSwitchModal(true);
  }, []);

  const activeProcessId =
    status.owner === "self" ? status.processId : undefined;

  const handleAbort = async () => {
    if (status.owner === "self" && status.processId) {
      // Try interrupt first (graceful stop), fall back to abort if not supported
      try {
        const result = await api.interruptProcess(status.processId);
        if (result.interrupted) {
          // Successfully interrupted - process is still alive
          return;
        }
        // Interrupt not supported or failed, fall back to abort
      } catch {
        // Interrupt endpoint failed (404 = old server, or other error)
      }
      // Fall back to abort (kills the process)
      await api.abortProcess(status.processId);
    }
  };

  const handleApprove = useCallback(async () => {
    if (pendingInputRequest) {
      try {
        await api.respondToInput(sessionId, pendingInputRequest.id, "approve");
      } catch (err) {
        const status = (err as { status?: number }).status;
        const msg = status ? `Error ${status}` : t("sessionApproveFailed");
        showToast(msg, "error");
      }
    }
  }, [sessionId, pendingInputRequest, showToast, t]);

  const handleApproveAcceptEdits = useCallback(async () => {
    if (pendingInputRequest) {
      try {
        // Approve and switch to acceptEdits mode
        await api.respondToInput(
          sessionId,
          pendingInputRequest.id,
          "approve_accept_edits",
        );
        // Update local permission mode
        setPermissionMode("acceptEdits");
      } catch (err) {
        const status = (err as { status?: number }).status;
        const msg = status ? `Error ${status}` : t("sessionApproveFailed");
        showToast(msg, "error");
      }
    }
  }, [sessionId, pendingInputRequest, setPermissionMode, showToast, t]);

  const handleDeny = useCallback(async () => {
    if (pendingInputRequest) {
      try {
        await api.respondToInput(sessionId, pendingInputRequest.id, "deny");
      } catch (err) {
        const status = (err as { status?: number }).status;
        const msg = status ? `Error ${status}` : t("sessionDenyFailed");
        showToast(msg, "error");
      }
    }
  }, [sessionId, pendingInputRequest, showToast, t]);

  const handleDenyWithFeedback = useCallback(
    async (feedback: string) => {
      if (pendingInputRequest) {
        try {
          await api.respondToInput(
            sessionId,
            pendingInputRequest.id,
            "deny",
            undefined,
            feedback,
          );
        } catch (err) {
          const status = (err as { status?: number }).status;
          const msg = status ? `Error ${status}` : t("sessionFeedbackFailed");
          showToast(msg, "error");
        }
      }
    },
    [sessionId, pendingInputRequest, showToast, t],
  );

  const handleQuestionSubmit = useCallback(
    async (answers: Record<string, string>) => {
      if (pendingInputRequest) {
        try {
          await api.respondToInput(
            sessionId,
            pendingInputRequest.id,
            "approve",
            answers,
          );
        } catch (err) {
          const status = (err as { status?: number }).status;
          const msg = status ? `Error ${status}` : t("sessionAnswerFailed");
          showToast(msg, "error");
        }
      }
    },
    [sessionId, pendingInputRequest, showToast, t],
  );

  // Check if pending request is an AskUserQuestion
  const isAskUserQuestion = pendingInputRequest?.toolName === "AskUserQuestion";

  // If process is actively in-turn or waiting for input, don't mark tools as orphaned.
  // "orphanedToolUseIds" from server just means "no result yet" - but if the process is
  // in-turn (e.g., executing a Task subagent) or waiting for approval, they're not orphaned.
  // Also suppress orphan marking when the session stream is disconnected - we can't trust
  // processState without the stream, so show tools as pending (spinner) rather than
  // incorrectly marking them as interrupted.
  const activeToolApproval =
    processState === "in-turn" ||
    processState === "waiting-input" ||
    (hasSessionUpdateStream && !sessionUpdatesConnected);

  // Detect if session has pending tool calls without results
  // This can happen when the session is unowned but was active in another process (VS Code, CLI)
  // that is waiting for user input (tool approval, question answer)
  const hasPendingToolCalls = useMemo(() => {
    if (status.owner !== "none") return false;
    const items = preprocessMessages(messages);
    return items.some(
      (item) => item.type === "tool_call" && item.status === "pending",
    );
  }, [messages, status.owner]);

  // Compute display title - priority:
  // 1. Local custom title (user renamed in this session)
  // 2. Session title from server
  // 3. Initial title from navigation state (optimistic, before server responds)
  // 4. "Untitled" as final fallback
  const sessionTitle = getSessionDisplayTitle(session);
  const displayTitle =
    localCustomTitle ??
    (sessionTitle !== "Untitled" ? sessionTitle : null) ??
    initialTitle ??
    t("sessionUntitled");
  const isArchived = localIsArchived ?? session?.isArchived ?? false;
  const isStarred = localIsStarred ?? session?.isStarred ?? false;

  // Update browser tab title
  useDocumentTitle(project?.name, displayTitle);

  const handleStartEditingTitle = () => {
    setRenameValue(displayTitle);
    setIsEditingTitle(true);
    // Focus the input and select all text after it renders
    setTimeout(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }, 0);
  };

  const handleCancelEditingTitle = () => {
    // Don't cancel if we're in the middle of saving
    if (isSavingTitleRef.current) return;
    setIsEditingTitle(false);
    setRenameValue("");
  };

  // On blur, save if value changed (handles mobile keyboard dismiss on Enter)
  const handleTitleBlur = () => {
    // Don't interfere if we're already saving
    if (isSavingTitleRef.current) return;
    // If value is empty or unchanged, just cancel
    if (!renameValue.trim() || renameValue.trim() === displayTitle) {
      handleCancelEditingTitle();
      return;
    }
    // Otherwise save (handles mobile Enter which blurs before keydown fires)
    handleSaveTitle();
  };

  const handleSaveTitle = async () => {
    if (!renameValue.trim() || isRenaming) return;
    isSavingTitleRef.current = true;
    setIsRenaming(true);
    try {
      await api.updateSessionMetadata(sessionId, { title: renameValue.trim() });
      setLocalCustomTitle(renameValue.trim());
      setIsEditingTitle(false);
      showToast(t("sessionRenamed"), "success");
    } catch (err) {
      console.error("Failed to rename session:", err);
      showToast(t("sessionRenameFailed"), "error");
    } finally {
      setIsRenaming(false);
      isSavingTitleRef.current = false;
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSaveTitle();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleCancelEditingTitle();
    }
  };

  const handleToggleArchive = async () => {
    const newArchived = !isArchived;
    try {
      await api.updateSessionMetadata(sessionId, { archived: newArchived });
      setLocalIsArchived(newArchived);
      showToast(
        newArchived ? t("sessionArchived") : t("sessionUnarchived"),
        "success",
      );
    } catch (err) {
      console.error("Failed to update archive status:", err);
      showToast(t("sessionArchiveFailed"), "error");
    }
  };

  const handleToggleStar = async () => {
    const newStarred = !isStarred;
    try {
      await api.updateSessionMetadata(sessionId, { starred: newStarred });
      setLocalIsStarred(newStarred);
      showToast(
        newStarred ? t("sessionStarred") : t("sessionUnstarred"),
        "success",
      );
    } catch (err) {
      console.error("Failed to update star status:", err);
      showToast(t("sessionStarFailed"), "error");
    }
  };

  const hasUnread = localHasUnread ?? session?.hasUnread ?? false;

  const handleToggleRead = async () => {
    const newHasUnread = !hasUnread;
    setLocalHasUnread(newHasUnread);
    try {
      if (newHasUnread) {
        await api.markSessionUnread(sessionId);
      } else {
        await api.markSessionSeen(sessionId);
      }
      showToast(
        newHasUnread ? t("sessionMarkedUnread") : t("sessionMarkedRead"),
        "success",
      );
    } catch (err) {
      console.error("Failed to update read status:", err);
      setLocalHasUnread(undefined); // Revert on error
      showToast(t("sessionReadFailed"), "error");
    }
  };

  const handleTerminate = async () => {
    if (status.owner === "self" && status.processId) {
      try {
        await api.abortProcess(status.processId);
        showToast(t("sessionTerminated"), "success");
      } catch (err) {
        console.error("Failed to terminate session:", err);
        const errorMsg = err instanceof Error ? err.message : String(err);
        showToast(t("sessionTerminateFailed", { message: errorMsg }), "error");
      }
    }
  };

  const handleShare = useCallback(async () => {
    try {
      const { snapshotSession } = await import(
        "../lib/sharing/snapshotSession"
      );
      const html = snapshotSession(displayTitle);
      const result = await api.shareSession(html, displayTitle);
      await navigator.clipboard.writeText(result.url);
      showToast(t("sessionLinkCopied"), "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("sessionShareFailed");
      showToast(msg, "error");
    }
  }, [displayTitle, showToast, t]);

  if (error) return <SessionErrorState message={error.message} />;

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
        <SessionHeader
          isWideScreen={isWideScreen}
          onOpenSidebar={openSidebar}
          basePath={basePath}
          projectId={projectId}
          projectName={project?.name}
          sessionId={sessionId}
          displayTitle={displayTitle}
          fullTitle={session?.fullTitle}
          isStarred={isStarred}
          isArchived={isArchived}
          hasUnread={hasUnread}
          loading={loading}
          isEditingTitle={isEditingTitle}
          renameInputRef={renameInputRef}
          renameValue={renameValue}
          onRenameValueChange={setRenameValue}
          onTitleKeyDown={handleTitleKeyDown}
          onTitleBlur={handleTitleBlur}
          isRenaming={isRenaming}
          titleButtonRef={titleButtonRef}
          showRecentSessions={showRecentSessions}
          onToggleRecentSessions={() =>
            setShowRecentSessions(!showRecentSessions)
          }
          onCloseRecentSessions={() => setShowRecentSessions(false)}
          effectiveProvider={effectiveProvider}
          effectiveModel={effectiveModel}
          isThinking={processState === "in-turn"}
          onOpenProcessInfo={() => setShowProcessInfoModal(true)}
          sessionProvider={session?.provider}
          processId={status.owner === "self" ? status.processId : undefined}
          onToggleStar={handleToggleStar}
          onToggleArchive={handleToggleArchive}
          onToggleRead={handleToggleRead}
          onRename={handleStartEditingTitle}
          onClone={(newSessionId) => {
            navigate(
              `${basePath}/projects/${projectId}/sessions/${newSessionId}`,
            );
          }}
          onTerminate={handleTerminate}
          sharingConfigured={sharingConfigured}
          onShare={handleShare}
        />

        {/* Process Info Modal */}
        {showProcessInfoModal && session && (
          <ProcessInfoModal
            sessionId={actualSessionId}
            provider={session.provider}
            model={session.model}
            status={status}
            processState={processState}
            contextUsage={session.contextUsage}
            originator={session.originator}
            cliVersion={session.cliVersion}
            sessionSource={session.source}
            approvalPolicy={session.approvalPolicy}
            sandboxPolicy={session.sandboxPolicy}
            createdAt={session.createdAt}
            sessionStreamConnected={sessionUpdatesConnected}
            lastSessionEventAt={lastStreamActivityAt}
            onClose={() => setShowProcessInfoModal(false)}
          />
        )}

        {/* Model Switch Modal */}
        {showModelSwitchModal && (
          <ModelSwitchModal
            processId={status.owner === "self" ? status.processId : undefined}
            currentModel={session?.model}
            onModelChanged={handleModelChanged}
            onClose={() => setShowModelSwitchModal(false)}
          />
        )}

        <SessionWarnings
          isExternal={status.owner === "external"}
          hasPendingToolCalls={hasPendingToolCalls}
        />

        <SessionMessages
          loading={loading}
          loadingLabel={t("sessionLoading")}
          projectId={projectId}
          projectPath={project?.path ?? null}
          sessionId={sessionId}
          agentContent={agentContent}
          setAgentContent={setAgentContent}
          toolUseToAgent={toolUseToAgent}
          messages={messages}
          provider={session?.provider}
          isProcessing={status.owner === "self" && processState === "in-turn"}
          isCompacting={isCompacting}
          scrollTrigger={scrollTrigger}
          pendingMessages={pendingMessages}
          markdownAugments={markdownAugments}
          activeToolApproval={activeToolApproval}
          hasOlderMessages={pagination?.hasOlderMessages}
          loadingOlder={loadingOlder}
          onLoadOlderMessages={loadOlderMessages}
        />

        <DeferredQueueBanner
          messages={deferredMessages}
          onCancel={(tempId) => api.cancelDeferredMessage(sessionId, tempId)}
        />
        <SessionInputArea
          sessionConnectionStatus={sessionConnectionStatus}
          pendingInputRequest={pendingInputRequest}
          actualSessionId={actualSessionId}
          isAskUserQuestion={isAskUserQuestion}
          onQuestionSubmit={handleQuestionSubmit}
          onApprove={handleApprove}
          onApproveAcceptEdits={handleApproveAcceptEdits}
          onDeny={handleDeny}
          onDenyWithFeedback={handleDenyWithFeedback}
          approvalCollapsed={approvalCollapsed}
          onApprovalCollapsedChange={setApprovalCollapsed}
          permissionMode={permissionMode}
          onPermissionModeChange={setPermissionMode}
          isHeld={holdModeEnabled ? isHeld : undefined}
          onHoldChange={holdModeEnabled ? setHold : undefined}
          supportsPermissionMode={supportsPermissionMode}
          supportsThinkingToggle={supportsThinkingToggle}
          contextUsage={session?.contextUsage}
          isRunning={status.owner === "self"}
          isThinking={processState === "in-turn"}
          onStop={handleAbort}
          onOpenModelSwitch={
            activeProcessId ? handleOpenModelSwitch : undefined
          }
          processId={activeProcessId}
          mcpServers={mcpServers}
          onSend={handleSend}
          onQueue={
            status.owner !== "none" && processState !== "idle"
              ? handleQueue
              : undefined
          }
          placeholder={
            status.owner === "external"
              ? t("sessionPlaceholderExternal")
              : processState === "idle"
                ? t("sessionPlaceholderResume")
                : t("sessionPlaceholderQueue")
          }
          draftKey={`draft-message-${sessionId}`}
          onDraftControlsReady={handleDraftControlsReady}
          projectId={projectId}
          sessionId={sessionId}
          attachments={attachments}
          onAttach={handleAttach}
          onRemoveAttachment={handleRemoveAttachment}
          uploadProgress={uploadProgress}
          slashCommands={allSlashCommands}
        />
      </div>
    </div>
  );
}
