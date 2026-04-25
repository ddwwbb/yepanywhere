import type { RemoteChannelEvent } from "@yep-anywhere/shared";
import { formatNotificationText } from "./format-text.js";
import type { RemoteChannelAdapter, RemoteChannelDeliveryResult } from "./types.js";

const WEIXIN_API_BASE = "https://ilinkai.weixin.qq.com";

export interface WeixinBotAdapterOptions {
  botId: string;
  accountId: string;
  peerUserId: string;
  boundSessionId?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxTextLength?: number;
}

export class WeixinBotAdapter implements RemoteChannelAdapter {
  readonly channel = "weixin";
  readonly botId: string;
  readonly boundSessionId?: string;

  private readonly accountId: string;
  private readonly peerUserId: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxTextLength: number;

  constructor(options: WeixinBotAdapterOptions) {
    this.botId = options.botId;
    this.boundSessionId = options.boundSessionId;
    this.accountId = options.accountId;
    this.peerUserId = options.peerUserId;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxTextLength = options.maxTextLength ?? 1800;
  }

  async send(event: RemoteChannelEvent): Promise<RemoteChannelDeliveryResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const text = formatNotificationText(event, this.maxTextLength);
      const body = JSON.stringify({
        bot_id: this.accountId,
        to_user: this.peerUserId,
        content: text,
      });

      const response = await this.fetchImpl(
        `${WEIXIN_API_BASE}/ilink/bot/send_message`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        return {
          ok: false,
          channel: this.channel,
          error: `Weixin send_message returned HTTP ${response.status}`,
        };
      }

      const responseBody = (await response.json()) as { errmsg?: string; msgid?: string };
      if (responseBody.errmsg && responseBody.errmsg !== "ok") {
        return {
          ok: false,
          channel: this.channel,
          error: responseBody.errmsg,
        };
      }

      return {
        ok: true,
        channel: this.channel,
        messageId: responseBody.msgid,
      };
    } catch (error) {
      return {
        ok: false,
        channel: this.channel,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
