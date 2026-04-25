import type { RemoteChannelEvent } from "@yep-anywhere/shared";
import { decodeProjectId } from "../projects/paths.js";
import type { BusEvent } from "../watcher/EventBus.js";
import { redactRemoteChannelText } from "./redaction.js";

export interface RemoteChannelNormalizeOptions {
  yepUrl?: string;
}

export function normalizeRemoteChannelEvent(
  event: BusEvent,
  options: RemoteChannelNormalizeOptions = {},
): RemoteChannelEvent | null {
  switch (event.type) {
    case "session-created":
      return {
        id: eventId(event.type, event.session.id, event.timestamp),
        type: "session.started",
        sessionId: event.session.id,
        provider: event.session.provider,
        severity: "info",
        title: "Session started",
        summary: buildSessionSummary(event.session.title),
        projectLabel: getProjectLabel(event.session.projectId),
        yepUrl: options.yepUrl,
        dedupKey: `${event.type}:${event.session.id}`,
        createdAt: event.timestamp,
      };

    case "process-state-changed":
      if (event.activity === "idle") {
        return {
          id: eventId(event.type, event.sessionId, event.timestamp),
          type: "session.completed",
          sessionId: event.sessionId,
          severity: "info",
          title: "Session completed",
          summary: "The session is idle after completing its latest turn.",
          projectLabel: getProjectLabel(event.projectId),
          yepUrl: options.yepUrl,
          dedupKey: `${event.type}:${event.sessionId}:idle`,
          createdAt: event.timestamp,
        };
      }

      if (event.activity !== "waiting-input") {
        return null;
      }

      return {
        id: eventId(event.type, event.sessionId, event.timestamp),
        type:
          event.pendingInputType === "tool-approval"
            ? "permission.attention_needed"
            : "session.needs_attention",
        sessionId: event.sessionId,
        severity: "warning",
        title: "Session needs attention",
        summary:
          event.pendingInputType === "tool-approval"
            ? "Open Yep to review a pending tool permission."
            : "Open Yep to answer a pending question.",
        projectLabel: getProjectLabel(event.projectId),
        yepUrl: options.yepUrl,
        dedupKey: `${event.type}:${event.sessionId}:${event.pendingInputType ?? "unknown"}`,
        createdAt: event.timestamp,
      };

    case "process-terminated":
      return {
        id: eventId(event.type, event.sessionId, event.timestamp),
        type: "session.failed",
        sessionId: event.sessionId,
        provider: event.provider,
        severity: "error",
        title: "Session process terminated",
        summary: redactRemoteChannelText(event.reason),
        projectLabel: getProjectLabel(event.projectId),
        yepUrl: options.yepUrl,
        dedupKey: `${event.type}:${event.sessionId}:${event.processId}`,
        createdAt: event.timestamp,
      };

    case "session-aborted":
      return {
        id: eventId(event.type, event.sessionId, event.timestamp),
        type: "session.failed",
        sessionId: event.sessionId,
        severity: "warning",
        title: "Session aborted",
        summary: "The session was aborted from Yep.",
        projectLabel: getProjectLabel(event.projectId),
        yepUrl: options.yepUrl,
        dedupKey: `${event.type}:${event.sessionId}`,
        createdAt: event.timestamp,
      };

    default:
      return null;
  }
}

function eventId(type: string, sessionId: string, timestamp: string): string {
  return `${type}:${sessionId}:${timestamp}`;
}

function buildSessionSummary(title: string | null): string {
  if (!title) {
    return "A session started.";
  }

  return redactRemoteChannelText(title);
}

function getProjectLabel(projectId: string): string {
  try {
    const path = decodeProjectId(projectId as never);
    const normalized = path.replace(/\\/g, "/");
    return normalized.split("/").filter(Boolean).at(-1) ?? "Unknown Project";
  } catch {
    return "Unknown Project";
  }
}
