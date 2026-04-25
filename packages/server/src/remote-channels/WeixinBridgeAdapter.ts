import crypto from "node:crypto";
import type { RemoteChannelWeixinBot } from "../services/ServerSettingsService.js";
import type { Supervisor } from "../supervisor/Supervisor.js";
import {
  type RemoteBridgeInbound,
  RemoteSessionBridge,
} from "./SessionBridge.js";

const LOG_TAG = "[weixin/bridge]";
const DEFAULT_WEIXIN_API_BASE = "https://ilinkai.weixin.qq.com";
const CHANNEL_VERSION = "yep-anywhere-weixin-bridge/1.0";
const POLL_TIMEOUT_MS = 35_000;
const POLL_RETRY_MS = 5000;
const MESSAGE_DEDUP_TTL_MS = 10 * 60 * 1000;
const MAX_TEXT_LENGTH = 1800;
const MESSAGE_TYPE_BOT = 2;
const MESSAGE_STATE_FINISH = 2;
const MESSAGE_ITEM_TYPE_TEXT = 1;
const TYPING_STATUS_TYPING = 1;
const TYPING_STATUS_CANCEL = 2;

export interface WeixinBridgeAdapterOptions {
  bot: RemoteChannelWeixinBot;
  supervisor: Supervisor;
  fetchImpl?: typeof fetch;
}

interface WeixinMessageItem {
  type?: number;
  text_item?: { text?: string };
}

interface WeixinMessage {
  seq?: number;
  message_id?: string;
  from_user_id?: string;
  item_list?: WeixinMessageItem[];
  context_token?: string;
  create_time?: number;
  ref_message?: {
    title?: string;
    content?: string;
  };
}

interface WeixinUpdatesResponse {
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinMessage[];
  get_updates_buf?: string;
}

interface WeixinConfigResponse {
  errcode?: number;
  errmsg?: string;
  typing_ticket?: string;
  route_tag?: string;
}

export class WeixinBridgeAdapter {
  readonly botId: string;
  readonly boundSessionId?: string;

  private readonly bot: RemoteChannelWeixinBot;
  private readonly fetchImpl: typeof fetch;
  private readonly bridge: RemoteSessionBridge;
  private running = false;
  private abortController: AbortController | null = null;
  private pollPromise: Promise<void> | null = null;
  private getUpdatesBuf = "";
  private contextToken: string | undefined;
  private typingTicket: string | undefined;
  private routeTag: string | undefined;
  private seenMessageIds = new Map<string, number>();
  private lastMessageAt: string | null = null;
  private lastError: string | null = null;

  constructor(options: WeixinBridgeAdapterOptions) {
    this.bot = options.bot;
    this.botId = options.bot.id;
    this.boundSessionId = options.bot.boundSessionId;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.getUpdatesBuf = options.bot.getUpdatesBuf ?? "";
    this.contextToken = options.bot.contextToken;
    this.bridge = new RemoteSessionBridge({
      logTag: LOG_TAG,
      supervisor: options.supervisor,
      boundSessionId: this.boundSessionId,
      sendText: async (chatId, text) => {
        await this.sendMessage({ chatId, text });
      },
      onTurnStarted: (inbound) => {
        void this.sendTyping(inbound.chatId, TYPING_STATUS_TYPING);
      },
      onAssistantText: async (text, inbound) => {
        if (!inbound) return;
        await this.sendMessage({ chatId: inbound.chatId, text });
        await this.sendTyping(inbound.chatId, TYPING_STATUS_CANCEL);
        await this.sendMessage({ chatId: inbound.chatId, text: "OK" });
      },
      onApprovalPrompt: (request, summary, inbound) =>
        this.sendMessage({
          chatId: inbound.chatId,
          text: `工具权限审批\n\n${request.toolName ?? "Tool"} 请求执行权限\n\n${summary}\n\n回复 /approve 允许，或 /deny 拒绝。`,
        }),
      onApprovalResolved: (_decision, _accepted, inbound) => {
        if (inbound) void this.sendTyping(inbound.chatId, TYPING_STATUS_CANCEL);
      },
    });
  }

  async start(): Promise<void> {
    if (this.running) return;
    if (!this.bot.botToken || !this.bot.accountId || !this.bot.peerUserId) {
      throw new Error("Weixin bot token, account ID and peer user ID are required");
    }

    this.running = true;
    this.abortController = new AbortController();
    this.bridge.subscribeToExistingProcess();
    this.pollPromise = this.pollLoop();
    console.log(`${LOG_TAG} Started bridge for bot ${this.botId}`);
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.abortController?.abort();
    this.abortController = null;
    this.bridge.stop();
    await this.pollPromise?.catch(() => {});
    this.pollPromise = null;
    console.log(`${LOG_TAG} Stopped bridge for bot ${this.botId}`);
  }

  isRunning(): boolean {
    return this.running;
  }

  getLastMessageAt(): string | null {
    return this.lastMessageAt;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  async sendPendingApprovalPrompt(): Promise<void> {
    await this.bridge.sendPendingApprovalPrompt();
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        const response = await this.callApi<WeixinUpdatesResponse>(
          "getupdates",
          {
            get_updates_buf: this.getUpdatesBuf,
            base_info: { channel_version: CHANNEL_VERSION },
          },
          POLL_TIMEOUT_MS + 5000,
        );

        if (response.errcode && response.errcode !== 0) {
          throw new Error(response.errmsg ?? `Weixin getupdates failed with ${response.errcode}`);
        }
        if (response.get_updates_buf) {
          this.getUpdatesBuf = response.get_updates_buf;
        }
        for (const message of response.msgs ?? []) {
          await this.handleMessage(message);
        }
        this.lastError = null;
      } catch (err) {
        if (!this.running || isAbortError(err)) break;
        this.lastError = err instanceof Error ? err.message : String(err);
        console.warn(`${LOG_TAG} Polling error: ${this.lastError}`);
        await sleep(POLL_RETRY_MS, this.abortController?.signal);
      }
    }
  }

  private async handleMessage(message: WeixinMessage): Promise<void> {
    if (!message.from_user_id) return;
    if (this.bot.peerUserId && message.from_user_id !== this.bot.peerUserId) return;

    const messageId = message.message_id ?? `seq_${message.seq ?? Date.now()}`;
    if (!this.markMessage(messageId)) return;

    if (message.context_token) this.contextToken = message.context_token;

    const text = extractWeixinText(message).trim();
    if (!text) return;

    this.lastMessageAt = new Date().toISOString();
    await this.bridge.handleInbound({
      chatId: message.from_user_id,
      messageId,
      text,
    });
  }

  private async sendMessage(options: { chatId: string; text: string }): Promise<boolean> {
    if (!this.contextToken) return false;
    const chunks = splitText(stripMarkdown(options.text), MAX_TEXT_LENGTH);
    let ok = true;

    for (const chunk of chunks) {
      try {
        await this.callApi<Record<string, unknown>>("sendmessage", {
          msg: {
            from_user_id: "",
            to_user_id: options.chatId,
            client_id: `yep-wx-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
            message_type: MESSAGE_TYPE_BOT,
            message_state: MESSAGE_STATE_FINISH,
            item_list: [
              {
                type: MESSAGE_ITEM_TYPE_TEXT,
                text_item: { text: chunk },
              },
            ],
            context_token: this.contextToken,
          },
          base_info: { channel_version: CHANNEL_VERSION },
        });
      } catch (err) {
        ok = false;
        this.lastError = err instanceof Error ? err.message : String(err);
        console.warn(`${LOG_TAG} sendMessage failed: ${this.lastError}`);
      }
    }

    return ok;
  }

  private async sendTyping(chatId: string, status: number): Promise<void> {
    if (!this.contextToken) return;
    if (!this.typingTicket) {
      const config = await this.callApi<WeixinConfigResponse>(
        "getconfig",
        {
          ilink_user_id: chatId,
          context_token: this.contextToken,
          base_info: { channel_version: CHANNEL_VERSION },
        },
        10_000,
      ).catch(() => null);
      this.typingTicket = config?.typing_ticket;
      this.routeTag = config?.route_tag;
    }
    if (!this.typingTicket) return;
    await this.callApi<Record<string, unknown>>(
      "sendtyping",
      {
        ilink_user_id: chatId,
        typing_ticket: this.typingTicket,
        status,
        base_info: { channel_version: CHANNEL_VERSION },
      },
      10_000,
      this.routeTag,
    ).catch(() => {});
  }

  private async callApi<T>(
    endpoint: string,
    payload: object,
    timeoutMs = 15_000,
    routeTag?: string,
  ): Promise<T> {
    if (!this.bot.botToken) {
      throw new Error("Weixin bot token is required");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const externalSignal = this.abortController?.signal;
    const onAbort = () => controller.abort();
    externalSignal?.addEventListener("abort", onAbort, { once: true });

    try {
      const response = await this.fetchImpl(
        `${this.bot.baseUrl ?? DEFAULT_WEIXIN_API_BASE}/ilink/bot/${endpoint}`,
        {
          method: "POST",
          headers: this.buildHeaders(routeTag),
          body: JSON.stringify(payload),
          signal: controller.signal,
        },
      );
      const bodyText = await response.text();
      if (!response.ok) {
        throw new Error(`Weixin ${endpoint} returned HTTP ${response.status}: ${bodyText}`);
      }
      if (!bodyText.trim()) return {} as T;
      return JSON.parse(bodyText) as T;
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", onAbort);
    }
  }

  private buildHeaders(routeTag?: string): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      AuthorizationType: "ilink_bot_token",
      Authorization: `Bearer ${this.bot.botToken}`,
      "X-WECHAT-UIN": crypto.randomBytes(4).toString("base64"),
    };
    if (routeTag) headers.SKRouteTag = routeTag;
    return headers;
  }

  private markMessage(messageId: string): boolean {
    const now = Date.now();
    for (const [id, expiresAt] of this.seenMessageIds) {
      if (expiresAt <= now) this.seenMessageIds.delete(id);
    }
    if (this.seenMessageIds.has(messageId)) return false;
    this.seenMessageIds.set(messageId, now + MESSAGE_DEDUP_TTL_MS);
    return true;
  }
}

function extractWeixinText(message: WeixinMessage): string {
  const parts: string[] = [];
  if (message.ref_message) {
    const refs = [message.ref_message.title, message.ref_message.content].filter(Boolean);
    if (refs.length > 0) parts.push(`[引用: ${refs.join(" | ")}]`);
  }
  for (const item of message.item_list ?? []) {
    if (item.type === MESSAGE_ITEM_TYPE_TEXT && item.text_item?.text) {
      parts.push(item.text_item.text);
    }
  }
  return parts.join("\n");
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/_(.*?)_/g, "$1")
    .replace(/`{3}[\s\S]*?`{3}/g, (match) =>
      match.replace(/`{3}\w*\n?/g, "").replace(/`{3}/g, ""),
    )
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1");
}

function splitText(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > maxLength) {
    chunks.push(rest.slice(0, maxLength));
    rest = rest.slice(maxLength);
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}
