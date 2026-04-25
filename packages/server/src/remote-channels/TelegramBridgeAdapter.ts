import type { InputRequest } from "@yep-anywhere/shared";
import type { RemoteChannelTelegramBot } from "../services/ServerSettingsService.js";
import type { Supervisor } from "../supervisor/Supervisor.js";
import { postThroughTunnel } from "./proxy-tunnel.js";
import {
  type RemoteBridgeInbound,
  RemoteSessionBridge,
} from "./SessionBridge.js";

const LOG_TAG = "[telegram/bridge]";
const TELEGRAM_API_BASE = "https://api.telegram.org";
const POLL_TIMEOUT_SECONDS = 30;
const POLL_RETRY_MS = 5000;
const UPDATE_DEDUP_TTL_MS = 10 * 60 * 1000;
const MAX_TEXT_LENGTH = 4096;

export interface TelegramBridgeAdapterOptions {
  bot: RemoteChannelTelegramBot;
  supervisor: Supervisor;
  fetchImpl?: typeof fetch;
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number | string; type?: string };
    from?: { id: number | string; username?: string; first_name?: string };
    text?: string;
    caption?: string;
    date?: number;
  };
  callback_query?: {
    id: string;
    from: { id: number | string; username?: string; first_name?: string };
    message?: { message_id: number; chat: { id: number | string } };
    data?: string;
  };
}

interface TelegramApiResponse<T> {
  ok?: boolean;
  result?: T;
  description?: string;
}

export class TelegramBridgeAdapter {
  readonly botId: string;
  readonly boundSessionId?: string;

  private readonly bot: RemoteChannelTelegramBot;
  private readonly fetchImpl: typeof fetch;
  private readonly bridge: RemoteSessionBridge;
  private running = false;
  private abortController: AbortController | null = null;
  private pollPromise: Promise<void> | null = null;
  private updateOffset = 0;
  private seenUpdates = new Map<number, number>();
  private typingTimers = new Map<string, ReturnType<typeof setInterval>>();
  private lastMessageAt: string | null = null;
  private lastError: string | null = null;

  constructor(options: TelegramBridgeAdapterOptions) {
    this.bot = options.bot;
    this.botId = options.bot.id;
    this.boundSessionId = options.bot.boundSessionId;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.bridge = new RemoteSessionBridge({
      logTag: LOG_TAG,
      supervisor: options.supervisor,
      boundSessionId: this.boundSessionId,
      sendText: async (chatId, text, replyToMessageId) => {
        await this.sendMessage({ chatId, text, replyToMessageId });
      },
      onTurnStarted: (inbound) => this.startTyping(inbound.chatId),
      onAssistantText: async (text, inbound) => {
        if (!inbound) return;
        await this.sendMessage({
          chatId: inbound.chatId,
          text,
          replyToMessageId: inbound.messageId,
        });
        this.stopTyping(inbound.chatId);
        await this.sendMessage({
          chatId: inbound.chatId,
          text: "OK",
          replyToMessageId: inbound.messageId,
        });
      },
      onApprovalPrompt: (request, summary, inbound) =>
        this.sendApprovalPrompt(request, summary, inbound),
      onApprovalResolved: (_decision, _accepted, inbound) => {
        if (inbound) this.stopTyping(inbound.chatId);
      },
    });
  }

  async start(): Promise<void> {
    if (this.running) return;
    if (!this.bot.botToken) {
      throw new Error("Telegram bot token is required");
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
    for (const timer of this.typingTimers.values()) {
      clearInterval(timer);
    }
    this.typingTimers.clear();
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
        const updates = await this.callApi<TelegramUpdate[]>("getUpdates", {
          offset: this.updateOffset || undefined,
          timeout: POLL_TIMEOUT_SECONDS,
          allowed_updates: ["message", "callback_query"],
        });

        for (const update of updates ?? []) {
          this.updateOffset = Math.max(this.updateOffset, update.update_id + 1);
          if (!this.markUpdate(update.update_id)) continue;
          await this.handleUpdate(update);
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

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    if (update.callback_query) {
      await this.handleCallback(update.callback_query);
      return;
    }

    const message = update.message;
    if (!message) return;

    const chatId = String(message.chat.id);
    if (!this.isAuthorizedChat(chatId)) return;

    const text = (message.text ?? message.caption ?? "").trim();
    if (!text) return;

    this.lastMessageAt = new Date().toISOString();
    await this.bridge.handleInbound({
      chatId,
      messageId: String(message.message_id),
      text,
    });
  }

  private async handleCallback(
    callback: NonNullable<TelegramUpdate["callback_query"]>,
  ): Promise<void> {
    const data = callback.data ?? "";
    const parsed = parseApprovalCallback(data);
    const chatId = callback.message?.chat.id;
    if (!parsed || chatId === undefined) {
      await this.answerCallback(callback.id, "已收到");
      return;
    }

    const chatIdString = String(chatId);
    if (!this.isAuthorizedChat(chatIdString)) {
      await this.answerCallback(callback.id, "未授权");
      return;
    }

    const inbound: RemoteBridgeInbound = {
      chatId: chatIdString,
      messageId: callback.message?.message_id
        ? String(callback.message.message_id)
        : undefined,
      text: "",
    };
    const accepted = await this.bridge.respondToApproval(
      parsed.decision,
      parsed.requestId,
      inbound,
    );
    await this.answerCallback(
      callback.id,
      accepted
        ? parsed.decision === "approve"
          ? "已允许"
          : "已拒绝"
        : "审批已失效",
    );
  }

  private async sendApprovalPrompt(
    request: InputRequest,
    summary: string,
    inbound: RemoteBridgeInbound,
  ): Promise<boolean> {
    const result = await this.sendMessage({
      chatId: inbound.chatId,
      text: `工具权限审批\n\n${request.toolName ?? "Tool"} 请求执行权限\n\n${summary}`,
      replyToMessageId: inbound.messageId,
      replyMarkup: {
        inline_keyboard: [
          [
            {
              text: "允许",
              callback_data: `yep:approval:approve:${request.id}`,
            },
            {
              text: "拒绝",
              callback_data: `yep:approval:deny:${request.id}`,
            },
          ],
        ],
      },
    });
    return result;
  }

  private async sendMessage(options: {
    chatId: string;
    text: string;
    replyToMessageId?: string;
    replyMarkup?: object;
  }): Promise<boolean> {
    if (!this.bot.botToken) return false;
    const chunks = splitText(options.text, MAX_TEXT_LENGTH);
    let ok = true;

    for (let i = 0; i < chunks.length; i++) {
      const body: Record<string, unknown> = {
        chat_id: options.chatId,
        text: chunks[i],
        disable_web_page_preview: true,
      };
      if (i === 0 && options.replyToMessageId) {
        body.reply_to_message_id = Number.isFinite(Number(options.replyToMessageId))
          ? Number(options.replyToMessageId)
          : options.replyToMessageId;
      }
      if (i === 0 && options.replyMarkup) {
        body.reply_markup = options.replyMarkup;
      }

      try {
        await this.callApi("sendMessage", body);
      } catch (err) {
        ok = false;
        this.lastError = err instanceof Error ? err.message : String(err);
        console.warn(`${LOG_TAG} sendMessage failed: ${this.lastError}`);
      }
    }

    return ok;
  }

  private startTyping(chatId: string): void {
    this.stopTyping(chatId);
    this.sendChatAction(chatId).catch(() => {});
    const timer = setInterval(() => {
      this.sendChatAction(chatId).catch(() => {});
    }, 5000);
    this.typingTimers.set(chatId, timer);
  }

  private stopTyping(chatId: string): void {
    const timer = this.typingTimers.get(chatId);
    if (!timer) return;
    clearInterval(timer);
    this.typingTimers.delete(chatId);
  }

  private async sendChatAction(chatId: string): Promise<void> {
    await this.callApi("sendChatAction", { chat_id: chatId, action: "typing" });
  }

  private async answerCallback(callbackQueryId: string, text: string): Promise<void> {
    await this.callApi("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      text,
    }).catch(() => {});
  }

  private async callApi<T>(method: string, payload: object): Promise<T> {
    if (!this.bot.botToken) {
      throw new Error("Telegram bot token is required");
    }

    const body = JSON.stringify(payload);
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      method === "getUpdates" ? (POLL_TIMEOUT_SECONDS + 10) * 1000 : 15_000,
    );
    const externalSignal = this.abortController?.signal;
    const onAbort = () => controller.abort();
    externalSignal?.addEventListener("abort", onAbort, { once: true });

    try {
      const url = new URL(
        `${TELEGRAM_API_BASE}/bot${this.bot.botToken}/${method}`,
      );
      const response = this.bot.proxyUrl
        ? await postThroughTunnel(
            url,
            new URL(this.bot.proxyUrl),
            443,
            body,
            controller.signal,
          )
        : await this.fetchImpl(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
            signal: controller.signal,
          });

      const responseBody = (await response.json()) as TelegramApiResponse<T>;
      if (!response.ok || !responseBody.ok) {
        throw new Error(
          responseBody.description ??
            `Telegram ${method} returned HTTP ${response.status}`,
        );
      }
      return responseBody.result as T;
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", onAbort);
    }
  }

  private isAuthorizedChat(chatId: string): boolean {
    return !this.bot.chatId || this.bot.chatId === chatId;
  }

  private markUpdate(updateId: number): boolean {
    const now = Date.now();
    for (const [id, expiresAt] of this.seenUpdates) {
      if (expiresAt <= now) this.seenUpdates.delete(id);
    }
    if (this.seenUpdates.has(updateId)) return false;
    this.seenUpdates.set(updateId, now + UPDATE_DEDUP_TTL_MS);
    return true;
  }
}

function parseApprovalCallback(
  data: string,
): { decision: "approve" | "deny"; requestId: string } | null {
  const parts = data.split(":");
  if (parts.length < 4) return null;
  const [prefix, type, decision, ...requestParts] = parts;
  if (prefix !== "yep" || type !== "approval") return null;
  if (decision !== "approve" && decision !== "deny") return null;
  const requestId = requestParts.join(":");
  if (!requestId) return null;
  return { decision, requestId };
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
