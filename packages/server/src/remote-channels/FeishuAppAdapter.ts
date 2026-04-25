import type { RemoteChannelEvent } from "@yep-anywhere/shared";
import { formatNotificationText } from "./format-text.js";
import { postThroughTunnel } from "./proxy-tunnel.js";
import type { RemoteChannelAdapter, RemoteChannelDeliveryResult } from "./types.js";

const FEISHU_AUTH_URL = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal";
const FEISHU_MESSAGE_URL = "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id";

export interface FeishuAppAdapterOptions {
  botId: string;
  appId: string;
  appSecret: string;
  appChatId: string;
  proxyUrl?: string;
  boundSessionId?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxTextLength?: number;
}

export class FeishuAppAdapter implements RemoteChannelAdapter {
  readonly channel = "feishu";
  readonly botId: string;
  readonly boundSessionId?: string;

  private readonly appId: string;
  private readonly appSecret: string;
  private readonly appChatId: string;
  private readonly proxyUrl?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxTextLength: number;

  constructor(options: FeishuAppAdapterOptions) {
    this.botId = options.botId;
    this.boundSessionId = options.boundSessionId;
    this.appId = options.appId;
    this.appSecret = options.appSecret;
    this.appChatId = options.appChatId;
    this.proxyUrl = options.proxyUrl;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxTextLength = options.maxTextLength ?? 1800;
  }

  async send(event: RemoteChannelEvent): Promise<RemoteChannelDeliveryResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const tokenResult = await this.getTenantAccessToken(controller.signal);
      if (!tokenResult.ok) {
        return { ok: false, channel: this.channel, error: tokenResult.error };
      }

      const body = JSON.stringify({
        receive_id: this.appChatId,
        msg_type: "text",
        content: JSON.stringify({ text: formatNotificationText(event, this.maxTextLength) }),
      });

      const response = this.proxyUrl
        ? await postThroughTunnel(
            new URL(FEISHU_MESSAGE_URL),
            new URL(this.proxyUrl),
            443,
            body,
            controller.signal,
          )
        : await this.fetchImpl(FEISHU_MESSAGE_URL, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${tokenResult.token}`,
              "Content-Type": "application/json",
            },
            body,
            signal: controller.signal,
          });

      if (!response.ok) {
        return {
          ok: false,
          channel: this.channel,
          error: `Feishu IM API returned HTTP ${response.status}`,
        };
      }

      const responseBody = (await response.json()) as { code?: number; msg?: string };
      if (responseBody.code !== 0) {
        return {
          ok: false,
          channel: this.channel,
          error: responseBody.msg ?? `Feishu IM API error code ${responseBody.code}`,
        };
      }

      return { ok: true, channel: this.channel };
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

  private async getTenantAccessToken(
    signal: AbortSignal,
  ): Promise<{ ok: true; token: string } | { ok: false; error?: string }> {
    const body = JSON.stringify({
      app_id: this.appId,
      app_secret: this.appSecret,
    });

    const response = this.proxyUrl
      ? await postThroughTunnel(
          new URL(FEISHU_AUTH_URL),
          new URL(this.proxyUrl),
          443,
          body,
          signal,
        )
      : await this.fetchImpl(FEISHU_AUTH_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal,
        });

    if (!response.ok) {
      return { ok: false, error: `Feishu auth returned HTTP ${response.status}` };
    }

    const result = (await response.json()) as {
      code?: number;
      msg?: string;
      tenant_access_token?: string;
    };
    if (result.code !== 0 || !result.tenant_access_token) {
      return {
        ok: false,
        error: result.msg ?? `Feishu auth failed with code ${result.code}`,
      };
    }

    return { ok: true, token: result.tenant_access_token };
  }
}
