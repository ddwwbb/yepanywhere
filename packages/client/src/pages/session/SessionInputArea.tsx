import type { SlashCommand, UploadedFile } from "@yep-anywhere/shared";
import {
  MessageInput,
  type UploadProgress,
} from "../../components/MessageInput";
import { MessageInputToolbar } from "../../components/MessageInputToolbar";
import { QuestionAnswerPanel } from "../../components/QuestionAnswerPanel";
import { ToolApprovalPanel } from "../../components/ToolApprovalPanel";
import type { DraftControls } from "../../hooks/useDraftPersistence";
import type { ContextUsage, InputRequest, PermissionMode } from "../../types";

type SessionConnectionStatus =
  | "idle"
  | "connected"
  | "connecting"
  | "disconnected";

interface SessionInputAreaProps {
  sessionConnectionStatus: SessionConnectionStatus;
  pendingInputRequest: InputRequest | null | undefined;
  actualSessionId: string;
  isAskUserQuestion: boolean;
  onQuestionSubmit: (answers: Record<string, string>) => Promise<void>;
  onApprove: () => Promise<void>;
  onApproveAcceptEdits: () => Promise<void>;
  onDeny: () => Promise<void>;
  onDenyWithFeedback: (feedback: string) => Promise<void>;
  approvalCollapsed: boolean;
  onApprovalCollapsedChange: (collapsed: boolean) => void;
  permissionMode: PermissionMode;
  onPermissionModeChange: (mode: PermissionMode) => void;
  isHeld?: boolean;
  onHoldChange?: (held: boolean) => void;
  supportsPermissionMode: boolean;
  supportsThinkingToggle: boolean;
  contextUsage?: ContextUsage;
  isRunning: boolean;
  isThinking: boolean;
  onStop: () => void;
  onOpenModelSwitch?: () => void;
  processId?: string;
  mcpServers: Array<{ name: string; status: string }>;
  onSend: (text: string) => void;
  onQueue?: (text: string) => void;
  placeholder: string;
  draftKey: string;
  onDraftControlsReady: (controls: DraftControls) => void;
  projectId: string;
  sessionId: string;
  attachments: UploadedFile[];
  onAttach: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  uploadProgress: UploadProgress[];
  slashCommands: SlashCommand[];
}

export function SessionInputArea({
  sessionConnectionStatus,
  pendingInputRequest,
  actualSessionId,
  isAskUserQuestion,
  onQuestionSubmit,
  onApprove,
  onApproveAcceptEdits,
  onDeny,
  onDenyWithFeedback,
  approvalCollapsed,
  onApprovalCollapsedChange,
  permissionMode,
  onPermissionModeChange,
  isHeld,
  onHoldChange,
  supportsPermissionMode,
  supportsThinkingToggle,
  contextUsage,
  isRunning,
  isThinking,
  onStop,
  onOpenModelSwitch,
  processId,
  mcpServers,
  onSend,
  onQueue,
  placeholder,
  draftKey,
  onDraftControlsReady,
  projectId,
  sessionId,
  attachments,
  onAttach,
  onRemoveAttachment,
  uploadProgress,
  slashCommands,
}: SessionInputAreaProps) {
  const isCurrentPendingInput =
    pendingInputRequest?.sessionId === actualSessionId;
  const showQuestionPanel =
    pendingInputRequest && isCurrentPendingInput && isAskUserQuestion;
  const showToolApproval =
    pendingInputRequest && isCurrentPendingInput && !isAskUserQuestion;

  return (
    <footer className="session-input">
      <div className="session-input-inner">
        {showQuestionPanel && (
          <QuestionAnswerPanel
            request={pendingInputRequest}
            sessionId={actualSessionId}
            onSubmit={onQuestionSubmit}
            onDeny={onDeny}
          />
        )}

        {showToolApproval && (
          <>
            <ToolApprovalPanel
              request={pendingInputRequest}
              sessionId={actualSessionId}
              onApprove={onApprove}
              onDeny={onDeny}
              onApproveAcceptEdits={onApproveAcceptEdits}
              onDenyWithFeedback={onDenyWithFeedback}
              collapsed={approvalCollapsed}
              onCollapsedChange={onApprovalCollapsedChange}
            />
            <MessageInputToolbar
              mode={permissionMode}
              onModeChange={onPermissionModeChange}
              isHeld={isHeld}
              onHoldChange={onHoldChange}
              supportsPermissionMode={supportsPermissionMode}
              supportsThinkingToggle={supportsThinkingToggle}
              contextUsage={contextUsage}
              isRunning={isRunning}
              isThinking={isThinking}
              onStop={onStop}
              onOpenModelSwitch={onOpenModelSwitch}
              processId={processId}
              mcpServers={mcpServers}
              pendingApproval={
                approvalCollapsed
                  ? {
                      type: "tool-approval",
                      onExpand: () => onApprovalCollapsedChange(false),
                    }
                  : undefined
              }
            />
          </>
        )}

        {!showToolApproval && (
          <MessageInput
            onSend={onSend}
            onQueue={onQueue}
            placeholder={placeholder}
            mode={permissionMode}
            onModeChange={onPermissionModeChange}
            isHeld={isHeld}
            onHoldChange={onHoldChange}
            supportsPermissionMode={supportsPermissionMode}
            supportsThinkingToggle={supportsThinkingToggle}
            isRunning={isRunning}
            isThinking={isThinking}
            onStop={onStop}
            draftKey={draftKey}
            onDraftControlsReady={onDraftControlsReady}
            collapsed={!!pendingInputRequest && isCurrentPendingInput}
            contextUsage={contextUsage}
            projectId={projectId}
            sessionId={sessionId}
            attachments={attachments}
            onAttach={onAttach}
            onRemoveAttachment={onRemoveAttachment}
            uploadProgress={uploadProgress}
            slashCommands={slashCommands}
            onOpenModelSwitch={onOpenModelSwitch}
            processId={processId}
            mcpServers={mcpServers}
          />
        )}
      </div>
    </footer>
  );
}
