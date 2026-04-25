import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { RemoteChannelAuditLog } from "../../src/remote-channels/AuditLog.js";

describe("RemoteChannelAuditLog", () => {
  it("appends delivery outcomes as jsonl", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "remote-channel-audit-"));
    const auditLog = new RemoteChannelAuditLog({
      dataDir,
      now: () => "2026-04-25T00:00:00.000Z",
    });

    await auditLog.record({
      eventId: "evt-1",
      eventType: "session.completed",
      sessionId: "sess-1",
      channel: "feishu",
      dedupKey: "session.completed:sess-1",
      outcome: "sent",
      messageId: "msg-1",
    });

    const content = await readFile(
      join(dataDir, "remote-channels", "audit.jsonl"),
      "utf-8",
    );

    expect(content.trim()).toBe(
      JSON.stringify({
        timestamp: "2026-04-25T00:00:00.000Z",
        eventId: "evt-1",
        eventType: "session.completed",
        sessionId: "sess-1",
        channel: "feishu",
        dedupKey: "session.completed:sess-1",
        outcome: "sent",
        messageId: "msg-1",
      }),
    );
  });
});
