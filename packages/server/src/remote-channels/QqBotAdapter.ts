import type { RemoteChannelEvent } from "@yep-anywhere/shared";
import { formatNotificationText } from "./format-text.js";
import { postThroughTunnel } from "./proxy-tunnel.js";
import type { RemoteChannelAdapter, RemoteChannelDeliveryResult } from "./types.js";

const QQ_TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken";
const QQ_SEND_URL = "https://api.sgroup.qq.com/v2/users";

export interface QqBotAdapterOptions {
  botId: string;
  appId: string;
  appSecret: string;
  openId: string;
  proxyUrl?: string;
  boundSessionId?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxTextLength?: number;
}

export class QqBotAdapter implements RemoteChannelAdapter {
  readonly channel = "qq";
  readonly botId: string;
  readonly boundSessionId?: string;

  private readonly appId: string;
  private readonly appSecret: string;
  private readonly openId: string;
  private readonly proxyUrl?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxTextLength: number;

  constructor(options: QqBotAdapterOptions) {
    this.botId = options.botId;
    this.boundSessionId = options.boundSessionId;
    this.appId = options.appId;
    this.appSecret = options.appSecret;
    this.openId = options.openId;
    this.proxyUrl = options.proxyUrl;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxTextLength = options.maxTextLength ?? 1800;
  }

  async send(event: RemoteChannelEvent): Promise<RemoteChannelDeliveryResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const tokenResult = await this.getAccessToken(controller.signal);
      if (!tokenResult.ok) {
        return { ok: false, channel: this.channel, error: tokenResult.error };
      }

      const text = formatNotificationText(event, this.maxTextLength);
      const body = JSON.stringify({
        content: text,
        msg_type: 0,
        msg_id: event.id,
      });

      const url = `${QQ_SEND_URL}/${encodeURIComponent(this.openId)}/messages`;
      const response = this.proxyUrl
        ? await postThroughTunnel(
            new URL(url),
            new URL(this.proxyUrl),
            443,
            body,
            controller.signal,
          )
        : await this.fetchImpl(url, {
            method: "POST",
            headers: {
              Authorization: `QQBot ${tokenResult.token}`,
              "Content-Type": "application/json",
            },
            body,
            signal: controller.signal,
          });

      if (!response.ok) {
        return {
          ok: false,
          channel: this.channel,
          error: `QQ send message returned HTTP ${response.status}`,
        };
      }

      const responseBody = (await response.json()) as { id?: string; message?: string };
      return {
        ok: true,
        channel: this.channel,
        messageId: responseBody.id,
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

  private async getAccessToken(
    signal: AbortSignal,
  ): Promise<{ ok: true; token: string } | { ok: false; error?: string }> {
    const body = JSON.stringify({ appId: this.appId, clientSecret: this.appSecret });

    const response = this.proxyUrl
      ? await postThroughTunnel(
          new URL(QQ_TOKEN_URL),
          new URL(this.proxyUrl),
          443,
          body,
          signal,
        )
      : await this.fetchImpl(QQ_TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal,
        });

    if (!response.ok) {
      return { ok: false, error: `QQ token returned HTTP ${response.status}` };
    }

    const result = (await response.json()) as { access_token?: string; message?: string };
    if (!result.access_token) {
      return { ok: false, error: result.message ?? "QQ token response missing access_token" };
    }

    return { ok: true, token: result.access_token };
  }
}
