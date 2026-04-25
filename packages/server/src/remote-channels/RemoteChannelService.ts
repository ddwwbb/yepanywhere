import type { RemoteChannelEvent } from "@yep-anywhere/shared";
import type { ServerSettingsService } from "../services/ServerSettingsService.js";
import type { BusEvent, EventBus } from "../watcher/EventBus.js";
import { RemoteChannelAuditLog } from "./AuditLog.js";
import { RemoteChannelDedupStore } from "./DedupStore.js";
import { RemoteChannelDispatcher } from "./Dispatcher.js";
import { FeishuAppAdapter } from "./FeishuAppAdapter.js";
import { normalizeRemoteChannelEvent } from "./normalizer.js";
import { TelegramBotAdapter } from "./TelegramBotAdapter.js";
import type { RemoteChannelAdapter } from "./types.js";

export interface RemoteChannelServiceOptions {
  eventBus: EventBus;
  serverSettingsService: ServerSettingsService;
  dataDir: string;
  yepUrl?: string;
  fetchImpl?: typeof fetch;
}

export class RemoteChannelService {
  private readonly eventBus: EventBus;
  private readonly serverSettingsService: ServerSettingsService;
  private readonly dataDir: string;
  private readonly yepUrl?: string;
  private readonly fetchImpl?: typeof fetch;
  private readonly dedupStore = new RemoteChannelDedupStore();
  private readonly auditLog: RemoteChannelAuditLog;
  private readonly unsubscribe: () => void;

  constructor(options: RemoteChannelServiceOptions) {
    this.eventBus = options.eventBus;
    this.serverSettingsService = options.serverSettingsService;
    this.dataDir = options.dataDir;
    this.yepUrl = options.yepUrl;
    this.fetchImpl = options.fetchImpl;
    this.auditLog = new RemoteChannelAuditLog({ dataDir: this.dataDir });
    this.unsubscribe = this.eventBus.subscribe((event) => {
      void this.handleBusEvent(event);
    });
  }

  dispose(): void {
    this.unsubscribe();
  }

  async sendTestNotification(botId?: string): Promise<{ ok: boolean; error?: string }> {
    const event: RemoteChannelEvent = {
      id: `remote-channel-test:${Date.now()}`,
      type: "summary.available",
      sessionId: "test",
      severity: "info",
      title: "Remote channel test",
      summary: "Yep remote channel notifications are configured.",
      projectLabel: "Yep Anywhere",
      yepUrl: this.yepUrl,
      dedupKey: `remote-channel-test:${Date.now()}`,
      createdAt: new Date().toISOString(),
    };

    const adapters = this.createAdapters();
    const filtered = botId
      ? adapters.filter((a) => a.botId === botId)
      : adapters;
    if (filtered.length === 0) {
      return { ok: false, error: "No enabled remote channel adapter" };
    }

    const dispatcher = new RemoteChannelDispatcher({
      adapters: filtered,
      dedupStore: this.dedupStore,
      auditLog: this.auditLog,
    });

    const results = await dispatcher.dispatch(event);
    const failed = results.find((result) => !result.ok);
    if (failed) {
      return { ok: false, error: failed.error ?? "Remote channel delivery failed" };
    }

    return { ok: results.length > 0 };
  }

  private async handleBusEvent(event: BusEvent): Promise<void> {
    const remoteEvent = normalizeRemoteChannelEvent(event, { yepUrl: this.yepUrl });
    if (!remoteEvent) {
      return;
    }

    const adapters = this.createAdapters();
    // 只分发给 boundSessionId 匹配的 adapter，未绑定的 bot 不发送
    const matched = adapters.filter(
      (a) => a.boundSessionId === remoteEvent.sessionId,
    );
    if (matched.length === 0) {
      return;
    }

    const dispatcher = new RemoteChannelDispatcher({
      adapters: matched,
      dedupStore: this.dedupStore,
      auditLog: this.auditLog,
    });

    await dispatcher.dispatch(remoteEvent);
  }

  createAdapters(): RemoteChannelAdapter[] {
    const settings = this.serverSettingsService.getSettings();
    const rc = settings.remoteChannels;
    if (!rc) return [];

    const adapters: RemoteChannelAdapter[] = [];

    if (rc.feishu?.enabled) {
      for (const bot of rc.feishu.bots ?? []) {
        if (bot.enabled === false) continue;
        if (!bot.appId || !bot.appSecret || !bot.appChatId) continue;
        adapters.push(
          new FeishuAppAdapter({
            botId: bot.id,
            appId: bot.appId,
            appSecret: bot.appSecret,
            appChatId: bot.appChatId,
            proxyUrl: bot.proxyUrl,
            boundSessionId: bot.boundSessionId,
            fetchImpl: this.fetchImpl,
          }),
        );
      }
    }

    if (rc.telegram?.enabled) {
      for (const bot of rc.telegram.bots ?? []) {
        if (bot.enabled === false) continue;
        if (!bot.botToken || !bot.chatId) continue;
        adapters.push(
          new TelegramBotAdapter({
            botId: bot.id,
            botToken: bot.botToken,
            chatId: bot.chatId,
            proxyUrl: bot.proxyUrl,
            boundSessionId: bot.boundSessionId,
            fetchImpl: this.fetchImpl,
          }),
        );
      }
    }

    return adapters;
  }
}
