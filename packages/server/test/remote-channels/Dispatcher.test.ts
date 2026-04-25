import type { RemoteChannelEvent } from "@yep-anywhere/shared";
import { describe, expect, it, vi } from "vitest";
import { RemoteChannelDispatcher } from "../../src/remote-channels/Dispatcher.js";
import { RemoteChannelDedupStore } from "../../src/remote-channels/DedupStore.js";
import type { RemoteChannelAdapter } from "../../src/remote-channels/types.js";

const event: RemoteChannelEvent = {
  id: "evt-1",
  type: "session.completed",
  sessionId: "sess-1",
  severity: "info",
  title: "Session completed",
  summary: "Done",
  dedupKey: "session.completed:sess-1",
  createdAt: "2026-04-25T00:00:00.000Z",
};

describe("RemoteChannelDispatcher", () => {
  it("sends events through adapters and audits sent outcomes", async () => {
    const auditLog = { record: vi.fn(async () => undefined) };
    const adapter: RemoteChannelAdapter = {
      channel: "feishu",
      send: vi.fn(async () => ({ ok: true, channel: "feishu", messageId: "msg-1" })),
    };
    const dispatcher = new RemoteChannelDispatcher({
      adapters: [adapter],
      dedupStore: new RemoteChannelDedupStore(),
      auditLog,
    });

    await expect(dispatcher.dispatch(event)).resolves.toEqual([
      { ok: true, channel: "feishu", messageId: "msg-1" },
    ]);
    expect(adapter.send).toHaveBeenCalledWith(event);
    expect(auditLog.record).toHaveBeenCalledWith({
      eventId: "evt-1",
      eventType: "session.completed",
      sessionId: "sess-1",
      channel: "feishu",
      dedupKey: "session.completed:sess-1",
      outcome: "sent",
      messageId: "msg-1",
      error: undefined,
    });
  });

  it("audits adapter exceptions as failed outcomes", async () => {
    const auditLog = { record: vi.fn(async () => undefined) };
    const adapter: RemoteChannelAdapter = {
      channel: "feishu",
      send: vi.fn(async () => {
        throw new Error("network down");
      }),
    };
    const dispatcher = new RemoteChannelDispatcher({
      adapters: [adapter],
      dedupStore: new RemoteChannelDedupStore(),
      auditLog,
    });

    await expect(dispatcher.dispatch(event)).resolves.toEqual([
      { ok: false, channel: "feishu", error: "network down" },
    ]);
    expect(auditLog.record).toHaveBeenCalledWith({
      eventId: "evt-1",
      eventType: "session.completed",
      sessionId: "sess-1",
      channel: "feishu",
      dedupKey: "session.completed:sess-1",
      outcome: "failed",
      messageId: undefined,
      error: "network down",
    });
  });

  it("does not resend duplicate events", async () => {
    const auditLog = { record: vi.fn(async () => undefined) };
    const adapter: RemoteChannelAdapter = {
      channel: "feishu",
      send: vi.fn(async () => ({ ok: true, channel: "feishu" })),
    };
    const dispatcher = new RemoteChannelDispatcher({
      adapters: [adapter],
      dedupStore: new RemoteChannelDedupStore(),
      auditLog,
    });

    await dispatcher.dispatch(event);
    await expect(dispatcher.dispatch(event)).resolves.toEqual([]);
    expect(adapter.send).toHaveBeenCalledTimes(1);
    expect(auditLog.record).toHaveBeenLastCalledWith({
      eventId: "evt-1",
      eventType: "session.completed",
      sessionId: "sess-1",
      channel: "*",
      dedupKey: "session.completed:sess-1",
      outcome: "deduped",
    });
  });
});
