import WebSocket from "ws";
import type { InputRequest } from "@yep-anywhere/shared";
import type { RemoteChannelQqBot } from "../services/ServerSettingsService.js";
import type { Supervisor } from "../supervisor/Supervisor.js";
import {
  type RemoteBridgeInbound,
  RemoteSessionBridge,
} from "./SessionBridge.js";

const LOG_TAG = "[qq/bridge]";
const QQ_TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken";
const QQ_GATEWAY_URL = "https://api.sgroup.qq.com/gateway";
const QQ_SEND_URL = "https://api.sgroup.qq.com/v2/users";
const RECONNECT_MAX_ATTEMPTS = 10;
const MESSAGE_DEDUP_TTL_MS = 10 * 60 * 1000;
const MAX_TEXT_LENGTH = 1800;

const OP = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  RESUME: 6,
  RECONNECT: 7,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
} as const;

const INTENTS = {
  PUBLIC_MESSAGES: 1 << 25,
} as const;

export interface QqBridgeAdapterOptions {
  bot: RemoteChannelQqBot;
  supervisor: Supervisor;
  fetchImpl?: typeof fetch;
}

interface QqGatewayPayload {
  op: number;
  d?: unknown;
  s?: number;
  t?: string;
}

interface QqC2CMessageData {
  id?: string;
  author?: { user_openid?: string };
  content?: string;
  timestamp?: string;
}

interface QqTokenResponse {
  access_token?: string;
  expires_in?: number | string;
  message?: string;
}

export class QqBridgeAdapter {
  readonly botId: string;
  readonly boundSessionId?: string;

  private readonly bot: RemoteChannelQqBot;
  private readonly fetchImpl: typeof fetch;
  private readonly bridge: RemoteSessionBridge;
  private running = false;
  private shouldReconnect = false;
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private lastSequence: number | null = null;
  private sessionId: string | null = null;
  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0;
  private seenMessageIds = new Map<string, number>();
  private msgSeqCounters = new Map<string, number>();
  private lastMessageAt: string | null = null;
  private lastError: string | null = null;

  constructor(options: QqBridgeAdapterOptions) {
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
      onAssistantText: async (text, inbound) => {
        if (!inbound) return;
        await this.sendMessage({
          chatId: inbound.chatId,
          text,
          replyToMessageId: inbound.messageId,
        });
        await this.sendMessage({
          chatId: inbound.chatId,
          text: "OK",
          replyToMessageId: inbound.messageId,
        });
      },
      onApprovalPrompt: (request, summary, inbound) =>
        this.sendApprovalPrompt(request, summary, inbound),
    });
  }

  async start(): Promise<void> {
    if (this.running) return;
    if (!this.bot.appId || !this.bot.appSecret) {
      throw new Error("QQ App ID and App Secret are required");
    }

    this.running = true;
    this.shouldReconnect = true;
    this.reconnectAttempts = 0;

    try {
      const token = await this.getAccessToken();
      const gatewayUrl = await this.getGatewayUrl(token);
      this.bridge.subscribeToExistingProcess();
      await this.connectGateway(gatewayUrl, token);
      console.log(`${LOG_TAG} Started bridge for bot ${this.botId}`);
    } catch (err) {
      this.running = false;
      this.shouldReconnect = false;
      this.lastError = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.shouldReconnect = false;
    this.bridge.stop();
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close(1000, "Bridge stopping");
      this.ws = null;
    }
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

  private async connectGateway(gatewayUrl: string, token: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(gatewayUrl);
      this.ws = ws;
      let settled = false;

      const finish = () => {
        if (settled) return;
        settled = true;
        this.lastError = null;
        resolve();
      };
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        reject(err);
      };

      ws.on("message", (data) => {
        try {
          const payload = JSON.parse(data.toString()) as QqGatewayPayload;
          this.handleGatewayPayload(payload, token, ws);
          if (payload.op === OP.DISPATCH && payload.t === "READY") {
            finish();
          }
        } catch (err) {
          this.lastError = err instanceof Error ? err.message : String(err);
          console.error(`${LOG_TAG} Failed to handle gateway message:`, err);
        }
      });

      ws.on("close", (code) => {
        this.stopHeartbeat();
        if (this.ws === ws) this.ws = null;
        if (this.shouldReconnect && this.running) this.scheduleReconnect();
        fail(new Error(`QQ gateway closed before READY: ${code}`));
      });

      ws.on("error", (err) => {
        this.lastError = err.message;
        console.error(`${LOG_TAG} Gateway error: ${err.message}`);
        fail(err);
      });
    });
  }

  private handleGatewayPayload(
    payload: QqGatewayPayload,
    token: string,
    ws: WebSocket,
  ): void {
    switch (payload.op) {
      case OP.HELLO: {
        const hello = payload.d as { heartbeat_interval?: number } | undefined;
        this.startHeartbeat(ws, hello?.heartbeat_interval ?? 41_250);
        if (this.sessionId && this.lastSequence !== null) {
          this.sendGateway(ws, {
            op: OP.RESUME,
            d: {
              token: `QQBot ${token}`,
              session_id: this.sessionId,
              seq: this.lastSequence,
            },
          });
        } else {
          this.sendGateway(ws, {
            op: OP.IDENTIFY,
            d: {
              token: `QQBot ${token}`,
              intents: INTENTS.PUBLIC_MESSAGES,
              shard: [0, 1],
            },
          });
        }
        break;
      }
      case OP.DISPATCH:
        if (payload.s !== undefined) this.lastSequence = payload.s;
        if (payload.t === "READY") {
          const ready = payload.d as { session_id?: string } | undefined;
          this.sessionId = ready?.session_id ?? null;
          this.reconnectAttempts = 0;
        } else if (payload.t === "C2C_MESSAGE_CREATE") {
          void this.handleC2CMessage(payload.d as QqC2CMessageData);
        } else if (payload.t === "RESUMED") {
          this.reconnectAttempts = 0;
        }
        break;
      case OP.RECONNECT:
        ws.close(4000, "Server requested reconnect");
        break;
      case OP.INVALID_SESSION:
        this.sessionId = null;
        this.lastSequence = null;
        ws.close(4000, "Invalid session");
        break;
      case OP.HEARTBEAT_ACK:
        break;
    }
  }

  private async handleC2CMessage(data: QqC2CMessageData): Promise<void> {
    if (!data.id || !data.author?.user_openid) return;
    if (!this.markMessage(data.id)) return;

    const userOpenId = data.author.user_openid;
    if (this.bot.openId && this.bot.openId !== userOpenId) return;

    const text = (data.content ?? "").trim();
    if (!text) return;

    this.lastMessageAt = new Date().toISOString();
    await this.bridge.handleInbound({
      chatId: userOpenId,
      messageId: data.id,
      text,
    });
  }

  private startHeartbeat(ws: WebSocket, intervalMs: number): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.sendGateway(ws, { op: OP.HEARTBEAT, d: this.lastSequence });
    }, intervalMs);
  }

  private stopHeartbeat(): void {
    if (!this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private sendGateway(ws: WebSocket, payload: QqGatewayPayload): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(payload));
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    if (this.reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
      this.running = false;
      this.lastError = "QQ gateway reconnect attempts exhausted";
      console.error(`${LOG_TAG} ${this.lastError}`);
      return;
    }

    this.reconnectAttempts += 1;
    const delayMs = Math.min(1000 * 2 ** (this.reconnectAttempts - 1), 60_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.reconnect();
    }, delayMs);
  }

  private async reconnect(): Promise<void> {
    if (!this.running || !this.shouldReconnect) return;
    try {
      const token = await this.getAccessToken();
      const gatewayUrl = await this.getGatewayUrl(token);
      await this.connectGateway(gatewayUrl, token);
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      console.error(`${LOG_TAG} Reconnect failed:`, err);
      this.scheduleReconnect();
    }
  }

  private async sendApprovalPrompt(
    request: InputRequest,
    summary: string,
    inbound: RemoteBridgeInbound,
  ): Promise<boolean> {
    return this.sendMessage({
      chatId: inbound.chatId,
      text: `工具权限审批\n\n${request.toolName ?? "Tool"} 请求执行权限\n\n${summary}\n\n回复 /approve 允许，或 /deny 拒绝。`,
      replyToMessageId: inbound.messageId,
    });
  }

  private async sendMessage(options: {
    chatId: string;
    text: string;
    replyToMessageId?: string;
  }): Promise<boolean> {
    if (!options.replyToMessageId) return false;
    const chunks = splitText(options.text, MAX_TEXT_LENGTH);
    let ok = true;

    for (const chunk of chunks) {
      try {
        const token = await this.getAccessToken();
        const response = await this.fetchImpl(
          `${QQ_SEND_URL}/${encodeURIComponent(options.chatId)}/messages`,
          {
            method: "POST",
            headers: {
              Authorization: `QQBot ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              content: chunk,
              msg_type: 0,
              msg_id: options.replyToMessageId,
              msg_seq: this.nextMsgSeq(options.replyToMessageId),
            }),
            signal: AbortSignal.timeout(15_000),
          },
        );
        if (!response.ok) {
          const body = await response.text().catch((err: unknown) => String(err));
          throw new Error(`QQ send message returned HTTP ${response.status}: ${body}`);
        }
      } catch (err) {
        ok = false;
        this.lastError = err instanceof Error ? err.message : String(err);
        console.warn(`${LOG_TAG} sendMessage failed: ${this.lastError}`);
      }
    }

    return ok;
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt - 60_000) {
      return this.accessToken;
    }
    if (!this.bot.appId || !this.bot.appSecret) {
      throw new Error("QQ App ID and App Secret are required");
    }

    const response = await this.fetchImpl(QQ_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appId: this.bot.appId, clientSecret: this.bot.appSecret }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await response.json()) as QqTokenResponse;
    if (!response.ok || !body.access_token) {
      throw new Error(body.message ?? `QQ token returned HTTP ${response.status}`);
    }

    const expiresIn = Number(body.expires_in ?? 7200);
    this.accessToken = body.access_token;
    this.accessTokenExpiresAt = Date.now() + expiresIn * 1000;
    return body.access_token;
  }

  private async getGatewayUrl(token: string): Promise<string> {
    const response = await this.fetchImpl(QQ_GATEWAY_URL, {
      method: "GET",
      headers: { Authorization: `QQBot ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await response.json()) as { url?: string; message?: string };
    if (!response.ok || !body.url) {
      throw new Error(body.message ?? `QQ gateway returned HTTP ${response.status}`);
    }
    return body.url;
  }

  private nextMsgSeq(messageId: string): number {
    const next = (this.msgSeqCounters.get(messageId) ?? 0) + 1;
    this.msgSeqCounters.set(messageId, next);
    if (this.msgSeqCounters.size > 500) {
      const firstKey = this.msgSeqCounters.keys().next().value;
      if (firstKey) this.msgSeqCounters.delete(firstKey);
    }
    return next;
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
