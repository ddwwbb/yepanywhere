import type { RemoteChannelEvent } from "@yep-anywhere/shared";
import type { ServerSettingsService } from "../services/ServerSettingsService.js";
import type { Supervisor } from "../supervisor/Supervisor.js";
import type { BusEvent, EventBus } from "../watcher/EventBus.js";
import { RemoteChannelAuditLog } from "./AuditLog.js";
import { RemoteChannelDedupStore } from "./DedupStore.js";
import { RemoteChannelDispatcher } from "./Dispatcher.js";
import { FeishuAppAdapter } from "./FeishuAppAdapter.js";
import { FeishuBridgeAdapter } from "./feishu/FeishuBridgeAdapter.js";
import { sendPostMessage } from "./feishu/outbound.js";
import { normalizeRemoteChannelEvent } from "./normalizer.js";
import { QqBotAdapter } from "./QqBotAdapter.js";
import { QqBridgeAdapter } from "./QqBridgeAdapter.js";
import { TelegramBotAdapter } from "./TelegramBotAdapter.js";
import { TelegramBridgeAdapter } from "./TelegramBridgeAdapter.js";
import { WeixinBotAdapter } from "./WeixinBotAdapter.js";
import { WeixinBridgeAdapter } from "./WeixinBridgeAdapter.js";
import type { RemoteChannelAdapter } from "./types.js";

export interface RemoteChannelServiceOptions {
  eventBus: EventBus;
  serverSettingsService: ServerSettingsService;
  supervisor?: Supervisor;
  dataDir: string;
  yepUrl?: string;
  fetchImpl?: typeof fetch;
}

export class RemoteChannelService {
  private readonly eventBus: EventBus;
  private readonly serverSettingsService: ServerSettingsService;
  private readonly supervisor?: Supervisor;
  private readonly dataDir: string;
  private readonly yepUrl?: string;
  private readonly fetchImpl?: typeof fetch;
  private readonly dedupStore = new RemoteChannelDedupStore();
  private readonly auditLog: RemoteChannelAuditLog;
  private unsubscribe: (() => void) | null = null;
  private running = false;
  private startedAt: string | null = null;
  private feishuBridges: FeishuBridgeAdapter[] = [];
  private telegramBridges: TelegramBridgeAdapter[] = [];
  private qqBridges: QqBridgeAdapter[] = [];
  private weixinBridges: WeixinBridgeAdapter[] = [];

  constructor(options: RemoteChannelServiceOptions) {
    this.eventBus = options.eventBus;
    this.serverSettingsService = options.serverSettingsService;
    this.supervisor = options.supervisor;
    this.dataDir = options.dataDir;
    this.yepUrl = options.yepUrl;
    this.fetchImpl = options.fetchImpl;
    this.auditLog = new RemoteChannelAuditLog({ dataDir: this.dataDir });
  }

  dispose(): void {
    this.stop();
  }

  /**
   * 启动桥接：订阅 EventBus，启动飞书双向桥接适配器。
   */
  async start(): Promise<{ started: boolean; reason?: string }> {
    if (this.running) return { started: true };

    const adapters = this.createAdapters();
    const feishuStarted = await this.startFeishuBridges();
    const telegramStarted = await this.startTelegramBridges();
    const qqStarted = await this.startQqBridges();
    const weixinStarted = await this.startWeixinBridges();

    if (
      adapters.length === 0 &&
      !feishuStarted &&
      !telegramStarted &&
      !qqStarted &&
      !weixinStarted
    ) {
      return { started: false, reason: "no_channels_enabled" };
    }

    this.running = true;
    this.startedAt = new Date().toISOString();
    this.unsubscribe = this.eventBus.subscribe((event) => {
      void this.handleBusEvent(event);
    });
    const total =
      adapters.length +
      this.feishuBridges.length +
      this.telegramBridges.length +
      this.qqBridges.length +
      this.weixinBridges.length;
    console.log(`[remote-channel] Bridge started with ${total} adapter(s)`);
    return { started: true };
  }

  /**
   * 停止桥接：取消 EventBus 订阅，停止所有飞书桥接。
   */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.startedAt = null;
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    await this.stopFeishuBridges();
    await this.stopTelegramBridges();
    await this.stopQqBridges();
    await this.stopWeixinBridges();
    console.log("[remote-channel] Bridge stopped");
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
    if (!this.running) return;

    const remoteEvent = normalizeRemoteChannelEvent(event, { yepUrl: this.yepUrl });
    if (!remoteEvent) return;

    // 1. 分发给单向通知 adapters（原有逻辑）
    const adapters = this.createAdapters();
    const matched = adapters.filter(
      (a) => a.boundSessionId === remoteEvent.sessionId,
    );

    if (matched.length > 0) {
      const dispatcher = new RemoteChannelDispatcher({
        adapters: matched,
        dedupStore: this.dedupStore,
        auditLog: this.auditLog,
      });
      await dispatcher.dispatch(remoteEvent);
    }

    // 2. 分发给双向桥接 adapters
    for (const bridge of this.feishuBridges) {
      if (bridge.boundSessionId !== remoteEvent.sessionId) continue;
      await this.deliverToFeishuBridge(bridge, remoteEvent);
    }
    for (const bridge of this.telegramBridges) {
      if (bridge.boundSessionId !== remoteEvent.sessionId) continue;
      await this.deliverToTextBridge(bridge, remoteEvent);
    }
    for (const bridge of this.qqBridges) {
      if (bridge.boundSessionId !== remoteEvent.sessionId) continue;
      await this.deliverToTextBridge(bridge, remoteEvent);
    }
    for (const bridge of this.weixinBridges) {
      if (bridge.boundSessionId !== remoteEvent.sessionId) continue;
      await this.deliverToTextBridge(bridge, remoteEvent);
    }
  }

  /** 将事件发送到飞书桥接（使用 post 格式渲染 AI 回复） */
  private async deliverToFeishuBridge(
    bridge: FeishuBridgeAdapter,
    remoteEvent: RemoteChannelEvent,
  ): Promise<void> {
    if (remoteEvent.type === "session.completed") return;
    if (remoteEvent.type === "permission.attention_needed") {
      await bridge.sendPendingApprovalCard();
      return;
    }
    if (remoteEvent.type === "session.needs_attention") return;

    const client = bridge.getClient();
    if (!client) return;

    // 优先使用入站消息来源的 chatId，其次使用配置的 appChatId
    const chatId = bridge.lastChatId;
    if (!chatId) return;

    const title = remoteEvent.title ?? "通知";
    const body = remoteEvent.summary ?? "";

    await sendPostMessage(client, chatId, `**${title}**\n\n${body}`);
  }

  private async deliverToTextBridge(
    bridge:
      | TelegramBridgeAdapter
      | QqBridgeAdapter
      | WeixinBridgeAdapter,
    remoteEvent: RemoteChannelEvent,
  ): Promise<void> {
    if (remoteEvent.type === "session.completed") return;
    if (remoteEvent.type === "session.needs_attention") return;
    if (remoteEvent.type === "permission.attention_needed") {
      await bridge.sendPendingApprovalPrompt();
    }
  }

  /** 启动飞书双向桥接适配器 */
  private async startFeishuBridges(): Promise<boolean> {
    if (!this.supervisor) return false;

    const settings = this.serverSettingsService.getSettings();
    const feishuSettings = settings.remoteChannels?.feishu;
    if (!feishuSettings?.enabled) return false;

    let started = false;
    for (const bot of feishuSettings.bots ?? []) {
      if (bot.enabled === false) continue;
      if (!bot.appId || !bot.appSecret) continue;

      try {
        const bridge = new FeishuBridgeAdapter({
          bot,
          supervisor: this.supervisor,
        });
        await bridge.start();
        this.feishuBridges.push(bridge);
        started = true;
      } catch (err) {
        console.error(`[remote-channel] Failed to start feishu bridge for bot ${bot.id}:`, err);
      }
    }

    return started;
  }

  /** 停止所有飞书双向桥接 */
  private async stopFeishuBridges(): Promise<void> {
    for (const bridge of this.feishuBridges) {
      try {
        await bridge.stop();
      } catch (err) {
        console.warn(`[remote-channel] Error stopping feishu bridge ${bridge.botId}:`, err);
      }
    }
    this.feishuBridges = [];
  }

  private async startTelegramBridges(): Promise<boolean> {
    if (!this.supervisor) return false;

    const settings = this.serverSettingsService.getSettings();
    const telegramSettings = settings.remoteChannels?.telegram;
    if (!telegramSettings?.enabled) return false;

    let started = false;
    for (const bot of telegramSettings.bots ?? []) {
      if (bot.enabled === false) continue;
      if (!bot.botToken) continue;

      try {
        const bridge = new TelegramBridgeAdapter({
          bot,
          supervisor: this.supervisor,
          fetchImpl: this.fetchImpl,
        });
        await bridge.start();
        this.telegramBridges.push(bridge);
        started = true;
      } catch (err) {
        console.error(`[remote-channel] Failed to start telegram bridge for bot ${bot.id}:`, err);
      }
    }

    return started;
  }

  private async stopTelegramBridges(): Promise<void> {
    for (const bridge of this.telegramBridges) {
      try {
        await bridge.stop();
      } catch (err) {
        console.warn(`[remote-channel] Error stopping telegram bridge ${bridge.botId}:`, err);
      }
    }
    this.telegramBridges = [];
  }

  private async startQqBridges(): Promise<boolean> {
    if (!this.supervisor) return false;

    const settings = this.serverSettingsService.getSettings();
    const qqSettings = settings.remoteChannels?.qq;
    if (!qqSettings?.enabled) return false;

    let started = false;
    for (const bot of qqSettings.bots ?? []) {
      if (bot.enabled === false) continue;
      if (!bot.appId || !bot.appSecret) continue;

      try {
        const bridge = new QqBridgeAdapter({
          bot,
          supervisor: this.supervisor,
          fetchImpl: this.fetchImpl,
        });
        await bridge.start();
        this.qqBridges.push(bridge);
        started = true;
      } catch (err) {
        console.error(`[remote-channel] Failed to start qq bridge for bot ${bot.id}:`, err);
      }
    }

    return started;
  }

  private async stopQqBridges(): Promise<void> {
    for (const bridge of this.qqBridges) {
      try {
        await bridge.stop();
      } catch (err) {
        console.warn(`[remote-channel] Error stopping qq bridge ${bridge.botId}:`, err);
      }
    }
    this.qqBridges = [];
  }

  private async startWeixinBridges(): Promise<boolean> {
    if (!this.supervisor) return false;

    const settings = this.serverSettingsService.getSettings();
    const weixinSettings = settings.remoteChannels?.weixin;
    if (!weixinSettings?.enabled) return false;

    let started = false;
    for (const bot of weixinSettings.bots ?? []) {
      if (bot.enabled === false) continue;
      if (!bot.botToken || !bot.accountId || !bot.peerUserId) continue;

      try {
        const bridge = new WeixinBridgeAdapter({
          bot,
          supervisor: this.supervisor,
          fetchImpl: this.fetchImpl,
        });
        await bridge.start();
        this.weixinBridges.push(bridge);
        started = true;
      } catch (err) {
        console.error(`[remote-channel] Failed to start weixin bridge for bot ${bot.id}:`, err);
      }
    }

    return started;
  }

  private async stopWeixinBridges(): Promise<void> {
    for (const bridge of this.weixinBridges) {
      try {
        await bridge.stop();
      } catch (err) {
        console.warn(`[remote-channel] Error stopping weixin bridge ${bridge.botId}:`, err);
      }
    }
    this.weixinBridges = [];
  }

  getStatus(): { running: boolean; startedAt: string | null; adapters: Array<{ channelType: string; name?: string; running: boolean; lastMessageAt: string | null; error: string | null }> } {
    const adapters = this.createAdapters();
    const allAdapters = [
      ...adapters.map((a) => ({
        channelType: a.channel,
        running: this.running,
        lastMessageAt: null,
        error: null,
      } as const)),
      ...this.feishuBridges.map((b) => ({
        channelType: "feishu" as const,
        name: b.botId,
        running: b.isRunning(),
        lastMessageAt: null,
        error: null,
      })),
      ...this.telegramBridges.map((b) => ({
        channelType: "telegram" as const,
        name: b.botId,
        running: b.isRunning(),
        lastMessageAt: b.getLastMessageAt(),
        error: b.getLastError(),
      })),
      ...this.qqBridges.map((b) => ({
        channelType: "qq" as const,
        name: b.botId,
        running: b.isRunning(),
        lastMessageAt: b.getLastMessageAt(),
        error: b.getLastError(),
      })),
      ...this.weixinBridges.map((b) => ({
        channelType: "weixin" as const,
        name: b.botId,
        running: b.isRunning(),
        lastMessageAt: b.getLastMessageAt(),
        error: b.getLastError(),
      })),
    ];
    return {
      running: this.running,
      startedAt: this.startedAt,
      adapters: allAdapters,
    };
  }

  createAdapters(): RemoteChannelAdapter[] {
    const settings = this.serverSettingsService.getSettings();
    const rc = settings.remoteChannels;
    if (!rc) return [];

    const adapters: RemoteChannelAdapter[] = [];

    if (rc.feishu?.enabled) {
      for (const bot of rc.feishu.bots ?? []) {
        if (bot.enabled === false) continue;
        if (!bot.appId || !bot.appSecret) continue;
        // 飞书通过 FeishuBridgeAdapter 处理，不再需要 FeishuAppAdapter
        // 但保留给非双向场景（无 Supervisor 时降级为单向通知）
        if (this.supervisor) continue;
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
        if (this.supervisor) continue;
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

    if (rc.qq?.enabled) {
      for (const bot of rc.qq.bots ?? []) {
        if (bot.enabled === false) continue;
        if (!bot.appId || !bot.appSecret || !bot.openId) continue;
        if (this.supervisor) continue;
        adapters.push(
          new QqBotAdapter({
            botId: bot.id,
            appId: bot.appId,
            appSecret: bot.appSecret,
            openId: bot.openId,
            proxyUrl: bot.proxyUrl,
            boundSessionId: bot.boundSessionId,
            fetchImpl: this.fetchImpl,
          }),
        );
      }
    }

    if (rc.weixin?.enabled) {
      for (const bot of rc.weixin.bots ?? []) {
        if (bot.enabled === false) continue;
        if (!bot.accountId || !bot.peerUserId) continue;
        if (this.supervisor) continue;
        adapters.push(
          new WeixinBotAdapter({
            botId: bot.id,
            accountId: bot.accountId,
            peerUserId: bot.peerUserId,
            boundSessionId: bot.boundSessionId,
            fetchImpl: this.fetchImpl,
          }),
        );
      }
    }

    return adapters;
  }
}
