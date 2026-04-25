import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ServerSettingsService } from "../../src/services/ServerSettingsService.js";
import { encodeProjectId } from "../../src/projects/paths.js";
import { RemoteChannelService } from "../../src/remote-channels/RemoteChannelService.js";
import { EventBus } from "../../src/watcher/EventBus.js";

function createSettingsService(telegramEnabled = false): ServerSettingsService {
  return {
    getSettings: vi.fn(() => ({
      serviceWorkerEnabled: true,
      persistRemoteSessionsToDisk: false,
      remoteChannels: telegramEnabled
        ? {
            telegram: {
              enabled: true,
              bots: [{
                id: "telegram_test",
                enabled: true,
                botToken: "test-token",
                chatId: "test-chat",
                boundSessionId: "sess-1",
              }],
            },
          }
        : {},
    })),
  } as unknown as ServerSettingsService;
}

describe("RemoteChannelService", () => {
  it("dispatches normalized EventBus events to enabled Telegram adapter", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "remote-channel-service-"));
    const eventBus = new EventBus();
    const fetchImpl = vi.fn(async () => Response.json({ ok: true }));

    new RemoteChannelService({
      eventBus,
      serverSettingsService: createSettingsService(true),
      dataDir,
      yepUrl: "http://localhost:7777",
      fetchImpl,
    });

    eventBus.emit({
      type: "process-state-changed",
      sessionId: "sess-1",
      projectId: encodeProjectId("/tmp/repo"),
      activity: "waiting-input",
      pendingInputType: "tool-approval",
      timestamp: "2026-04-25T00:00:00.000Z",
    });

    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(body.text).toContain("Open Yep to review a pending tool permission.");

    let audit = "";
    await vi.waitFor(async () => {
      audit = await readFile(
        join(dataDir, "remote-channels", "audit.jsonl"),
        "utf-8",
      );
      expect(audit).toContain('"outcome":"sent"');
    });
    expect(audit).toContain('"channel":"telegram"');
  });

  it("sends a test notification when configured", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "remote-channel-service-"));
    const fetchImpl = vi.fn(async () => Response.json({ ok: true }));
    const service = new RemoteChannelService({
      eventBus: new EventBus(),
      serverSettingsService: createSettingsService(true),
      dataDir,
      fetchImpl,
    });

    await expect(service.sendTestNotification()).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reports unavailable test notification when no adapter is enabled", async () => {
    const service = new RemoteChannelService({
      eventBus: new EventBus(),
      serverSettingsService: createSettingsService(),
      dataDir: await mkdtemp(join(tmpdir(), "remote-channel-service-")),
    });

    await expect(service.sendTestNotification()).resolves.toEqual({
      ok: false,
      error: "No enabled remote channel adapter",
    });
  });
});
