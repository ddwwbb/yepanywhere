/**
 * 飞书 WebSocket 网关 — 管理飞书 SDK 客户端和 WebSocket 连接生命周期。
 *
 * WSClient 模式下内部处理鉴权，无需 encryptKey/verificationToken。
 * 卡片动作处理器保证 2.5 秒内返回有效响应。
 */

import * as lark from "@larksuiteoapi/node-sdk";
import type { RemoteChannelFeishuBot } from "../../services/ServerSettingsService.js";

const LOG_TAG = "[feishu/gateway]";

function resolveDomain(brand: string): lark.Domain | string {
  if (brand === "lark") return lark.Domain.Lark;
  if (brand === "feishu") return lark.Domain.Feishu;
  return brand.replace(/\/+$/, "");
}

const FALLBACK_TOAST = {
  toast: { type: "info" as const, content: "已收到，正在处理..." },
};

export type CardActionHandler = (data: unknown) => Promise<unknown>;

export class FeishuGateway {
  client: lark.Client | null = null;
  private wsClient: lark.WSClient | null = null;
  private running = false;
  private eventDispatcher: lark.EventDispatcher;
  private cardActionHandler: CardActionHandler | null = null;

  readonly appId: string;
  readonly appSecret: string;
  readonly domain: string;

  constructor(bot: RemoteChannelFeishuBot) {
    this.appId = bot.appId ?? "";
    this.appSecret = bot.appSecret ?? "";
    this.domain = bot.domain ?? "feishu";
    this.eventDispatcher = new lark.EventDispatcher({
      encryptKey: "",
      verificationToken: "",
    }).register({
      // 注册空处理器，消除 SDK 对未关心事件的 warn 日志
      "im.chat.access_event.bot_p2p_chat_entered_v1": () => {},
      "im.message.reaction.created_v1": () => {},
      "im.message.reaction.deleted_v1": () => {},
    });
  }

  getEventDispatcher(): lark.EventDispatcher {
    return this.eventDispatcher;
  }

  /** 注册 im.message.receive_v1 消息处理器 */
  registerMessageHandler(handler: (data: unknown) => void): void {
    this.eventDispatcher.register<Record<string, (data: unknown) => void>>({
      "im.message.receive_v1": (data: unknown) => {
        handler(data);
      },
    });
  }

  /** 注册卡片动作处理器，保证 2.5 秒内返回 */
  registerCardActionHandler(handler: CardActionHandler): void {
    this.cardActionHandler = handler;
    this.eventDispatcher.register<Record<string, (data: unknown) => Promise<unknown>>>({
      "card.action.trigger": (data: unknown) => this.safeCardActionHandler(data),
    });
  }

  private async safeCardActionHandler(data: unknown): Promise<unknown> {
    const handler = this.cardActionHandler;
    if (!handler) return FALLBACK_TOAST;

    try {
      const result = await Promise.race([
        handler(data),
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 2500)),
      ]);
      if (result && typeof result === "object") return result;
      return FALLBACK_TOAST;
    } catch (err) {
      console.error(LOG_TAG, "Card action handler error:", err);
      return FALLBACK_TOAST;
    }
  }

  /** 启动 WebSocket 连接 */
  async start(): Promise<void> {
    if (this.running) return;

    const domain = resolveDomain(this.domain);

    this.client = new lark.Client({
      appId: this.appId,
      appSecret: this.appSecret,
      domain,
      disableTokenCache: false,
    });

    this.wsClient = new lark.WSClient({
      appId: this.appId,
      appSecret: this.appSecret,
      domain,
      loggerLevel: lark.LoggerLevel.error,
    });

    // Monkey-patch: 将卡片事件 type="card" 转为 type="event"，SDK 默认只处理 "event"
    interface WSHeader { key: string; value: string }
    interface WSEventData { headers: WSHeader[]; [key: string]: unknown }
    type HandleEventDataFn = (data: WSEventData) => unknown;
    const wsClientRecord = this.wsClient as unknown as Record<string, unknown>;
    if (typeof wsClientRecord.handleEventData === "function") {
      const origHandleEventData = (wsClientRecord.handleEventData as HandleEventDataFn).bind(this.wsClient);
      wsClientRecord.handleEventData = (data: WSEventData) => {
        const msgType = data.headers?.find?.((h: WSHeader) => h.key === "type")?.value;
        if (msgType === "card") {
          const patchedData: WSEventData = {
            ...data,
            headers: data.headers.map((h: WSHeader) =>
              h.key === "type" ? { ...h, value: "event" } : h,
            ),
          };
          return origHandleEventData(patchedData);
        }
        return origHandleEventData(data);
      };
    }

    await this.wsClient.start({ eventDispatcher: this.eventDispatcher });
    this.running = true;
    console.log(LOG_TAG, "WebSocket connected");
  }

  /** 停止 WebSocket 连接 */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    if (this.wsClient) {
      try {
        (this.wsClient as unknown as { close: (opts?: { force?: boolean }) => void }).close({ force: true });
      } catch (err) {
        console.warn(LOG_TAG, "WSClient.close failed:", err);
      }
      this.wsClient = null;
    }
    this.client = null;
    console.log(LOG_TAG, "Stopped");
  }

  isRunning(): boolean {
    return this.running;
  }
}
