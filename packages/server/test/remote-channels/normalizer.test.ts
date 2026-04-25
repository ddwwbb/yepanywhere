import { describe, expect, it } from "vitest";
import type { BusEvent } from "../../src/watcher/EventBus.js";
import { encodeProjectId } from "../../src/projects/paths.js";
import { normalizeRemoteChannelEvent } from "../../src/remote-channels/normalizer.js";

const timestamp = "2026-04-25T00:00:00.000Z";
const projectId = encodeProjectId("/Users/me/private-repo");

describe("normalizeRemoteChannelEvent", () => {
  it("maps session-created to session.started", () => {
    const event: BusEvent = {
      type: "session-created",
      timestamp,
      session: {
        id: "sess-1",
        projectId,
        title: "Work on /Users/me/private-repo/src/index.ts token=abc",
        fullTitle: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        messageCount: 1,
        ownership: { owner: "self", processId: "proc-1" },
        provider: "claude",
      },
    };

    expect(normalizeRemoteChannelEvent(event, { yepUrl: "http://localhost:7777" })).toEqual({
      id: `session-created:sess-1:${timestamp}`,
      type: "session.started",
      sessionId: "sess-1",
      provider: "claude",
      severity: "info",
      title: "Session started",
      summary: "Work on index.ts token=[redacted]",
      projectLabel: "private-repo",
      yepUrl: "http://localhost:7777",
      dedupKey: "session-created:sess-1",
      createdAt: timestamp,
    });
  });

  it("maps tool approval waiting-input to permission attention", () => {
    const event: BusEvent = {
      type: "process-state-changed",
      sessionId: "sess-1",
      projectId,
      activity: "waiting-input",
      pendingInputType: "tool-approval",
      timestamp,
    };

    expect(normalizeRemoteChannelEvent(event)).toMatchObject({
      type: "permission.attention_needed",
      sessionId: "sess-1",
      severity: "warning",
      summary: "Open Yep to review a pending tool permission.",
      dedupKey: "process-state-changed:sess-1:tool-approval",
    });
  });

  it("maps question waiting-input to session attention", () => {
    const event: BusEvent = {
      type: "process-state-changed",
      sessionId: "sess-1",
      projectId,
      activity: "waiting-input",
      pendingInputType: "user-question",
      timestamp,
    };

    expect(normalizeRemoteChannelEvent(event)).toMatchObject({
      type: "session.needs_attention",
      summary: "Open Yep to answer a pending question.",
    });
  });

  it("maps idle process state to session completed", () => {
    const event: BusEvent = {
      type: "process-state-changed",
      sessionId: "sess-1",
      projectId,
      activity: "idle",
      timestamp,
    };

    expect(normalizeRemoteChannelEvent(event)).toMatchObject({
      type: "session.completed",
      severity: "info",
      summary: "The session is idle after completing its latest turn.",
      dedupKey: "process-state-changed:sess-1:idle",
    });
  });

  it("ignores non-notifiable process state changes", () => {
    const event: BusEvent = {
      type: "process-state-changed",
      sessionId: "sess-1",
      projectId,
      activity: "in-turn",
      timestamp,
    };

    expect(normalizeRemoteChannelEvent(event)).toBeNull();
  });

  it("maps process termination to redacted failure", () => {
    const event: BusEvent = {
      type: "process-terminated",
      sessionId: "sess-1",
      projectId,
      processId: "proc-1",
      provider: "claude",
      reason: "Failed in /tmp/private/file.ts with secret=abc",
      timestamp,
    };

    expect(normalizeRemoteChannelEvent(event)).toMatchObject({
      type: "session.failed",
      provider: "claude",
      severity: "error",
      summary: "Failed in file.ts with secret=[redacted]",
      dedupKey: "process-terminated:sess-1:proc-1",
    });
  });

  it("maps session aborted to warning failure", () => {
    const event: BusEvent = {
      type: "session-aborted",
      sessionId: "sess-1",
      projectId,
      timestamp,
    };

    expect(normalizeRemoteChannelEvent(event)).toMatchObject({
      type: "session.failed",
      severity: "warning",
      summary: "The session was aborted from Yep.",
    });
  });
});
