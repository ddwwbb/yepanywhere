import type { RemoteChannelEvent } from "@yep-anywhere/shared";
import { formatNotificationText } from "./format-text.js";
import { postThroughTunnel } from "./proxy-tunnel.js";
import type { RemoteChannelAdapter, RemoteChannelDeliveryResult } from "./types.js";

export interface TelegramBotAdapterOptions {
  botId: string;
  botToken: string;
  chatId: string;
  proxyUrl?: string;
  boundSessionId?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxTextLength?: number;
}

export class TelegramBotAdapter implements RemoteChannelAdapter {
  readonly channel = "telegram";
  readonly botId: string;
  readonly boundSessionId?: string;

  private readonly botToken: string;
  private readonly chatId: string;
  private readonly proxyUrl?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxTextLength: number;

  constructor(options: TelegramBotAdapterOptions) {
    this.botId = options.botId;
    this.boundSessionId = options.boundSessionId;
    this.botToken = options.botToken;
    this.chatId = options.chatId;
    this.proxyUrl = options.proxyUrl;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxTextLength = options.maxTextLength ?? 3500;
  }

  async send(event: RemoteChannelEvent): Promise<RemoteChannelDeliveryResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const body = JSON.stringify({
        chat_id: this.chatId,
        text: formatNotificationText(event, this.maxTextLength),
        disable_web_page_preview: true,
      });
      const response = this.proxyUrl
        ? await postThroughTunnel(
            new URL(`https://api.telegram.org/bot${this.botToken}/sendMessage`),
            new URL(this.proxyUrl),
            443,
            body,
            controller.signal,
          )
        : await this.fetchImpl(
            `https://api.telegram.org/bot${this.botToken}/sendMessage`,
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
          error: `Telegram sendMessage returned HTTP ${response.status}`,
        };
      }

      const responseBody = (await response.json()) as {
        ok?: boolean;
        description?: string;
        result?: { message_id?: number };
      };
      if (!responseBody.ok) {
        return {
          ok: false,
          channel: this.channel,
          error: responseBody.description ?? "Telegram sendMessage failed",
        };
      }

      return {
        ok: true,
        channel: this.channel,
        messageId: responseBody.result?.message_id?.toString(),
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
