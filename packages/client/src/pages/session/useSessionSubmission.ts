import type { ProviderName, UploadedFile } from "@yep-anywhere/shared";
import { useCallback, useRef, useState } from "react";
import { api } from "../../api/client";
import type { UploadProgress } from "../../components/MessageInput";
import { useToastContext } from "../../contexts/ToastContext";
import { useConnection } from "../../hooks/useConnection";
import type { DraftControls } from "../../hooks/useDraftPersistence";
import {
  getModelSetting,
  getThinkingSetting,
} from "../../hooks/useModelSettings";
import type { ProcessState } from "../../hooks/useSession";
import { useI18n } from "../../i18n";
import { generateUUID } from "../../lib/uuid";
import type { PermissionMode, SessionStatus } from "../../types";

interface SubmissionSession {
  model?: string;
  provider?: ProviderName;
  executor?: string;
}

interface PendingMessageUpdate {
  status?: string;
}

interface UseSessionSubmissionOptions {
  projectId: string;
  sessionId: string;
  status: SessionStatus;
  processState: ProcessState;
  permissionMode: PermissionMode;
  session: SubmissionSession | null | undefined;
  effectiveProvider?: ProviderName;
  addPendingMessage: (content: string) => string;
  removePendingMessage: (tempId: string) => void;
  updatePendingMessage: (tempId: string, update: PendingMessageUpdate) => void;
  setStatus: (status: SessionStatus) => void;
  setProcessState: (state: ProcessState) => void;
  reconnectStream: () => void;
  onScrollToBottom: () => void;
}

export function useSessionSubmission({
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
  onScrollToBottom,
}: UseSessionSubmissionOptions) {
  const { t } = useI18n();
  const { showToast } = useToastContext();
  const connection = useConnection();
  const draftControlsRef = useRef<DraftControls | null>(null);
  const [attachments, setAttachments] = useState<UploadedFile[]>([]);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress[]>([]);
  const pendingUploadsRef = useRef<Map<string, Promise<UploadedFile | null>>>(
    new Map(),
  );

  const handleDraftControlsReady = useCallback((controls: DraftControls) => {
    draftControlsRef.current = controls;
  }, []);

  const handleSend = async (text: string) => {
    const tempId = addPendingMessage(text);
    setProcessState("in-turn");
    onScrollToBottom();

    const currentAttachments = [...attachments];
    const pendingAtSendTime = [...pendingUploadsRef.current.values()];
    if (pendingAtSendTime.length > 0) {
      updatePendingMessage(tempId, { status: t("sessionUploading") });
      setAttachments([]);
      const results = await Promise.all(pendingAtSendTime);
      for (const result of results) {
        if (result) currentAttachments.push(result);
      }
      const sentIds = new Set(
        currentAttachments.map((attachment) => attachment.id),
      );
      setAttachments((prev) =>
        prev.filter((attachment) => !sentIds.has(attachment.id)),
      );
      updatePendingMessage(tempId, { status: undefined });
    } else {
      setAttachments([]);
    }

    try {
      if (status.owner === "none") {
        const model = session?.model ?? getModelSetting();
        const thinking = getThinkingSetting();
        const result = await api.resumeSession(
          projectId,
          sessionId,
          text,
          {
            mode: permissionMode,
            model,
            thinking,
            provider: effectiveProvider,
            executor: session?.executor,
          },
          currentAttachments.length > 0 ? currentAttachments : undefined,
          tempId,
        );
        setStatus({ owner: "self", processId: result.processId });
      } else {
        const thinking = getThinkingSetting();
        const result = await api.queueMessage(
          sessionId,
          text,
          permissionMode,
          currentAttachments.length > 0 ? currentAttachments : undefined,
          tempId,
          thinking,
        );
        if (result.restarted && result.processId) {
          setStatus({ owner: "self", processId: result.processId });
          reconnectStream();
        }
      }
      draftControlsRef.current?.clearDraft();
    } catch (err) {
      console.error("Failed to send:", err);
      const is404 =
        err instanceof Error &&
        (err.message.includes("404") ||
          err.message.includes("No active process"));
      if (is404) {
        try {
          const model = session?.model ?? getModelSetting();
          const thinking = getThinkingSetting();
          const result = await api.resumeSession(
            projectId,
            sessionId,
            text,
            {
              mode: permissionMode,
              model,
              thinking,
              provider: effectiveProvider,
              executor: session?.executor,
            },
            currentAttachments.length > 0 ? currentAttachments : undefined,
            tempId,
          );
          setStatus({ owner: "self", processId: result.processId });
          draftControlsRef.current?.clearDraft();
          return;
        } catch (retryErr) {
          console.error("Failed to resume session:", retryErr);
        }
      }

      removePendingMessage(tempId);
      draftControlsRef.current?.restoreFromStorage();
      setAttachments(currentAttachments);
      setProcessState("idle");
      const errorMsg = err instanceof Error ? err.message : String(err);
      showToast(t("sessionSendFailed", { message: errorMsg }), "error");
    }
  };

  const handleQueue = async (text: string) => {
    const tempId = addPendingMessage(text);
    onScrollToBottom();

    const currentAttachments = [...attachments];
    const pendingAtSendTime = [...pendingUploadsRef.current.values()];
    if (pendingAtSendTime.length > 0) {
      updatePendingMessage(tempId, { status: t("sessionUploading") });
      setAttachments([]);
      const results = await Promise.all(pendingAtSendTime);
      for (const result of results) {
        if (result) currentAttachments.push(result);
      }
      const sentIds = new Set(
        currentAttachments.map((attachment) => attachment.id),
      );
      setAttachments((prev) =>
        prev.filter((attachment) => !sentIds.has(attachment.id)),
      );
      updatePendingMessage(tempId, { status: undefined });
    } else {
      setAttachments([]);
    }

    try {
      const thinking = getThinkingSetting();
      await api.queueMessage(
        sessionId,
        text,
        permissionMode,
        currentAttachments.length > 0 ? currentAttachments : undefined,
        tempId,
        thinking,
        true,
      );
      removePendingMessage(tempId);
      draftControlsRef.current?.clearDraft();
    } catch (err) {
      console.error("Failed to queue deferred message:", err);
      removePendingMessage(tempId);
      draftControlsRef.current?.restoreFromStorage();
      setAttachments(currentAttachments);
      const errorMsg = err instanceof Error ? err.message : String(err);
      showToast(t("sessionQueueFailed", { message: errorMsg }), "error");
    }
  };

  const handleAttach = useCallback(
    (files: File[]) => {
      for (const file of files) {
        const tempId = generateUUID();
        setUploadProgress((prev) => [
          ...prev,
          {
            fileId: tempId,
            fileName: file.name,
            bytesUploaded: 0,
            totalBytes: file.size,
            percent: 0,
          },
        ]);

        const uploadPromise = connection
          .upload(projectId, sessionId, file, {
            onProgress: (bytesUploaded) => {
              setUploadProgress((prev) =>
                prev.map((progress) =>
                  progress.fileId === tempId
                    ? {
                        ...progress,
                        bytesUploaded,
                        percent: Math.round((bytesUploaded / file.size) * 100),
                      }
                    : progress,
                ),
              );
            },
          })
          .then(
            (uploaded) => {
              setAttachments((prev) => [...prev, uploaded]);
              return uploaded;
            },
            (err) => {
              console.error("Upload failed:", err);
              const errorMsg =
                err instanceof Error ? err.message : t("sessionShareFailed");
              showToast(
                t("sessionUploadFailed", {
                  file: file.name,
                  message: errorMsg,
                }),
                "error",
              );
              return null as UploadedFile | null;
            },
          )
          .finally(() => {
            setUploadProgress((prev) =>
              prev.filter((progress) => progress.fileId !== tempId),
            );
            pendingUploadsRef.current.delete(tempId);
          });

        pendingUploadsRef.current.set(tempId, uploadPromise);
      }
    },
    [projectId, sessionId, showToast, connection, t],
  );

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((attachment) => attachment.id !== id));
  }, []);

  return {
    attachments,
    uploadProgress,
    handleSend,
    handleQueue,
    handleAttach,
    handleRemoveAttachment,
    handleDraftControlsReady,
  };
}
