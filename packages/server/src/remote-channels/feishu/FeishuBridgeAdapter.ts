/**
 * 飞书双向桥接适配器。
 *
 * 整合飞书 WebSocket 网关、入站解析、session 路由和出站发送。
 * 负责：
 * 1. 通过 WSClient 接收飞书消息
 * 2. 将消息路由到绑定的 session（通过 Supervisor 注入）
 * 3. 将 session 的 AI 回复发回飞书
 */

import type { RemoteChannelFeishuBot } from "../../services/ServerSettingsService.js";
import type { ContentBlock, SDKMessage } from "../../sdk/types.js";
import type { Supervisor } from "../../supervisor/Supervisor.js";
import type { Process } from "../../supervisor/Process.js";
import type { UserMessage } from "../../sdk/types.js";
import { findProjectPathBySessionId } from "../../projects/paths.js";
import { FeishuGateway } from "./FeishuGateway.js";
import { isUserAuthorized, parseInboundMessage } from "./inbound.js";
import { sendPostMessage, sendTextMessage, replyPostMessage, addReaction, removeReaction, sendApprovalCard } from "./outbound.js";

const LOG_TAG = "[feishu/bridge]";

export interface FeishuBridgeAdapterOptions {
  bot: RemoteChannelFeishuBot;
  supervisor: Supervisor;
}

export class FeishuBridgeAdapter {
  readonly botId: string;
  readonly boundSessionId?: string;

  private readonly bot: RemoteChannelFeishuBot;
  private readonly supervisor: Supervisor;
  private gateway: FeishuGateway | null = null;
  private botOpenId: string | undefined;
  private running = false;
  /** 最近一条入站消息的 chatId，用于出站回复 */
  lastChatId: string | undefined;
  /** 缓存的 projectPath，用于会话恢复 */
  private cachedProjectPath: string | undefined;
  /** 每条入站消息的 ID，用于添加 Typing 表情回应 */
  private lastInboundMessageId: string | undefined;
  /** 活跃的 Typing 表情回应 { chatId -> { messageId, reactionId } } */
  private activeReactions = new Map<string, { messageId: string; reactionId: string }>();
  /** 已发送审批卡片的 requestId，避免重复发送 */
  private sentApprovalRequestIds = new Set<string>();
  /** 当前 Process 的消息订阅取消函数 */
  private processUnsubscribe: (() => void) | null = null;
  /** 当前订阅的 process ID，避免重复订阅 */
  private subscribedProcessId: string | undefined;

  constructor(options: FeishuBridgeAdapterOptions) {
    this.bot = options.bot;
    this.botId = options.bot.id;
    this.boundSessionId = options.bot.boundSessionId;
    this.supervisor = options.supervisor;
  }

  async start(): Promise<void> {
    if (this.running) return;

    this.gateway = new FeishuGateway(this.bot);

    // 注册入站消息处理
    this.gateway.registerMessageHandler((data) => {
      this.handleInboundMessage(data).catch((err) => {
        console.error(LOG_TAG, "Error handling inbound message:", err);
      });
    });

    // 注册飞书卡片按钮处理
    this.gateway.registerCardActionHandler((data) => this.handleCardAction(data));

    await this.gateway.start();

    // 异步解析 bot open_id（用于群聊 @提及过滤）
    this.resolveBotIdentity();

    // 如果已有活跃进程，订阅其消息事件
    if (this.boundSessionId) {
      const existingProcess = this.supervisor.getProcessForSession(this.boundSessionId);
      if (existingProcess) {
        this.subscribeToProcess(existingProcess);
      }
    }

    this.running = true;
    console.log(`${LOG_TAG} Started bridge for bot ${this.botId}`);
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.unsubscribeFromProcess();
    this.activeReactions.clear();
    if (this.gateway) {
      await this.gateway.stop();
      this.gateway = null;
    }
    console.log(`${LOG_TAG} Stopped bridge for bot ${this.botId}`);
  }

  isRunning(): boolean {
    return this.running;
  }

  /** 获取 REST 客户端（用于出站发送） */
  getClient() {
    return this.gateway?.client ?? null;
  }

  /** 处理入站消息 */
  private async handleInboundMessage(eventData: unknown): Promise<void> {
    const inbound = parseInboundMessage(eventData, this.bot, this.botOpenId);
    if (!inbound) return;

    // 访问控制
    if (!isUserAuthorized(this.bot, inbound.senderId, inbound.chatId)) {
      return;
    }

    // 记录消息来源 chatId 和 messageId，用于后续回复和 Typing 反应
    this.lastChatId = inbound.chatId;
    this.lastInboundMessageId = inbound.messageId;

    const client = this.getClient();
    const sessionId = this.boundSessionId;
    if (!sessionId) {
      if (client) {
        await sendTextMessage(client, inbound.chatId, "请先绑定一个会话后再发送消息。");
      }
      return;
    }

    const message: UserMessage = { text: inbound.text };

    // 尝试获取现有进程
    let process = this.supervisor.getProcessForSession(sessionId);

    if (process && !process.isTerminated) {
      // 缓存 projectPath
      this.cachedProjectPath = process.projectPath;
      // 确保已订阅该进程的消息事件
      this.subscribeToProcess(process);
      // 排队消息
      process.queueMessage(message);
      // 添加 Typing 表情回应
      this.addTypingReaction(inbound.chatId, inbound.messageId);
      return;
    }

    // 进程不存在或已终止，需要恢复会话
    const projectPath = await this.resolveProjectPath(sessionId, process);
    if (!projectPath) {
      if (client) {
        await sendTextMessage(client, inbound.chatId, "无法找到会话的项目路径，请重新绑定。");
      }
      return;
    }

    this.cachedProjectPath = projectPath;

    try {
      const result = await this.supervisor.resumeSession(
        sessionId,
        projectPath,
        message,
      );

      // resumeSession 返回新进程或队列响应
      if ("subscribe" in result && typeof result.subscribe === "function") {
        // 返回的是 Process 对象
        this.subscribeToProcess(result as Process);
      }

      // 添加 Typing 表情回应
      this.addTypingReaction(inbound.chatId, inbound.messageId);

      console.log(`${LOG_TAG} Session resumed for ${sessionId}`);
    } catch (err) {
      console.error(`${LOG_TAG} Failed to resume session ${sessionId}:`, err);
      if (client) {
        await sendTextMessage(client, inbound.chatId, "恢复会话失败，请稍后重试。");
      }
    }
  }

  /** 解析 projectPath：内存缓存 → 已终止进程列表 → 磁盘扫描 */
  private async resolveProjectPath(sessionId: string, process?: Process): Promise<string | undefined> {
    // 从当前进程获取
    if (process?.projectPath) {
      return process.projectPath;
    }

    // 从缓存获取
    if (this.cachedProjectPath) {
      return this.cachedProjectPath;
    }

    // 从已终止进程列表获取（10 分钟窗口）
    const terminated = this.supervisor.getRecentlyTerminatedProcesses();
    const match = terminated.find((p) => p.sessionId === sessionId);
    if (match?.projectPath) {
      return match.projectPath;
    }

    // 从磁盘扫描 session 文件获取（服务重启后的兜底）
    const diskPath = await findProjectPathBySessionId(sessionId);
    if (diskPath) {
      console.log(`${LOG_TAG} Resolved projectPath from disk for session ${sessionId}: ${diskPath}`);
      return diskPath;
    }

    return undefined;
  }

  /** 订阅 Process 的消息事件，接收 AI 助手回复 */
  private subscribeToProcess(process: Process): void {
    // 避免重复订阅同一个进程
    if (this.subscribedProcessId === process.id && this.processUnsubscribe) {
      return;
    }

    // 取消之前的订阅
    this.unsubscribeFromProcess();

    this.subscribedProcessId = process.id;
    this.processUnsubscribe = process.subscribe((event) => {
      if (event.type === "message") {
        this.handleProcessMessage(event.message).catch((err) => {
          console.error(LOG_TAG, "Error forwarding assistant message to Feishu:", err);
        });
      }
    });

    console.log(`${LOG_TAG} Subscribed to process ${process.id} for session ${process.sessionId}`);
  }

  /** 取消当前 Process 订阅 */
  private unsubscribeFromProcess(): void {
    if (this.processUnsubscribe) {
      this.processUnsubscribe();
      this.processUnsubscribe = null;
      this.subscribedProcessId = undefined;
    }
  }

  /** 发送当前待审批工具的飞书卡片 */
  async sendPendingApprovalCard(): Promise<void> {
    const client = this.getClient();
    const chatId = this.lastChatId;
    const sessionId = this.boundSessionId;
    if (!client || !chatId || !sessionId) return;

    const process = this.supervisor.getProcessForSession(sessionId);
    const request = process?.getPendingInputRequest();
    if (!request || request.type !== "tool-approval") return;

    if (this.sentApprovalRequestIds.has(request.id)) return;

    const summary = buildApprovalSummary(request.toolInput);
    const result = await sendApprovalCard(client, {
      chatId,
      sessionId,
      requestId: request.id,
      toolName: request.toolName,
      summary,
    });
    if (result.ok) {
      this.sentApprovalRequestIds.add(request.id);
    } else {
      console.warn(`${LOG_TAG} Failed to send approval card: ${result.error}`);
    }
  }

  /** 处理飞书卡片按钮回调 */
  private async handleCardAction(data: unknown): Promise<unknown> {
    const parsed = parseApprovalAction(data);
    if (!parsed) {
      return { toast: { type: "info", content: "已收到" } };
    }

    const process = this.supervisor.getProcessForSession(parsed.sessionId);
    if (!process) {
      return { toast: { type: "warning", content: "会话未运行，无法审批" } };
    }

    const accepted = process.respondToInput(
      parsed.requestId,
      parsed.decision === "approve" ? "approve" : "deny",
    );
    if (accepted) {
      this.sentApprovalRequestIds.delete(parsed.requestId);
    }

    return {
      toast: {
        type: accepted ? "success" : "warning",
        content: accepted
          ? parsed.decision === "approve" ? "已允许" : "已拒绝"
          : "审批请求已失效",
      },
    };
  }

  /** 处理 Process 的消息事件，转发助手回复到飞书 */
  private async handleProcessMessage(message: SDKMessage): Promise<void> {
    // 只转发 assistant 类型的消息
    if (message.type !== "assistant") return;

    const client = this.getClient();
    if (!client) return;

    const chatId = this.lastChatId;
    if (!chatId) return;

    // 提取文本内容
    const text = extractAssistantText(message);
    if (!text) return;

    // 以 Markdown 格式回复原消息
    const replyToId = this.lastInboundMessageId;
    if (replyToId) {
      await replyPostMessage(client, replyToId, text);
    } else {
      await sendPostMessage(client, chatId, text);
    }

    // 回复完成：移除 Typing 表情，添加 OK 表情
    this.removeTypingReaction(chatId);
    this.addOkReaction(chatId);
  }

  /** AI 回复完成后添加 OK 表情回应 */
  private addOkReaction(chatId: string): void {
    const client = this.getClient();
    const messageId = this.lastInboundMessageId;
    if (!client || !messageId) return;

    addReaction(client, messageId, "OK").catch(() => {});
  }

  /** 给用户消息添加 Typing 表情回应，表示正在处理 */
  private addTypingReaction(chatId: string, messageId: string): void {
    const client = this.getClient();
    if (!client || !messageId) return;

    addReaction(client, messageId, "Typing").then((reactionId) => {
      if (reactionId) {
        this.activeReactions.set(chatId, { messageId, reactionId });
      }
    }).catch(() => {});
  }

  /** 移除 Typing 表情回应 */
  private removeTypingReaction(chatId: string): void {
    const client = this.getClient();
    const reaction = this.activeReactions.get(chatId);
    if (!client || !reaction) return;

    this.activeReactions.delete(chatId);
    removeReaction(client, reaction.messageId, reaction.reactionId).catch(() => {});
  }

  /** 异步解析 bot open_id（用于群聊 @提及过滤） */
  private async resolveBotIdentity(): Promise<void> {
    try {
      const domain = this.bot.domain === "lark" ? "open.larksuite.com" : "open.feishu.cn";
      // 获取 tenant_access_token
      const authRes = await fetch(`https://${domain}/open-apis/auth/v3/tenant_access_token/internal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app_id: this.bot.appId, app_secret: this.bot.appSecret }),
      });
      const authData = await authRes.json() as { code?: number; tenant_access_token?: string };
      if (authData.code !== 0 || !authData.tenant_access_token) return;

      // 获取 bot info
      const botRes = await fetch(`https://${domain}/open-apis/bot/v3/info/`, {
        headers: { Authorization: `Bearer ${authData.tenant_access_token}` },
      });
      const botData = await botRes.json() as { code?: number; bot?: { open_id?: string } };
      if (botData.code === 0 && botData.bot?.open_id) {
        this.botOpenId = botData.bot.open_id;
        console.log(`${LOG_TAG} Bot open_id resolved: ${this.botOpenId}`);
      }
    } catch (err) {
      console.warn(`${LOG_TAG} Failed to resolve bot identity:`, err);
    }
  }
}

/** 从 SDKMessage 提取 assistant 消息的文本内容 */
interface FeishuCardActionPayload {
  event?: {
    action?: { value?: { callback_data?: string } };
  };
  action?: { value?: { callback_data?: string } };
}

function parseApprovalAction(data: unknown): {
  decision: "approve" | "deny";
  sessionId: string;
  requestId: string;
} | null {
  const payload = data as FeishuCardActionPayload;
  const callbackData =
    payload.event?.action?.value?.callback_data ??
    payload.action?.value?.callback_data;
  if (!callbackData) return null;

  const parts = callbackData.split(":");
  if (parts.length < 5) return null;
  const [prefix, type, decision, sessionId, ...requestParts] = parts;
  if (prefix !== "yep" || type !== "approval") return null;
  if (decision !== "approve" && decision !== "deny") return null;
  const requestId = requestParts.join(":");
  if (!sessionId || !requestId) return null;

  return { decision, sessionId, requestId };
}

function buildApprovalSummary(toolInput: unknown): string {
  if (!toolInput) return "请求执行工具。";
  try {
    return `\`\`\`json\n${JSON.stringify(toolInput, null, 2)}\n\`\`\``;
  } catch {
    return String(toolInput);
  }
}

function extractAssistantText(message: SDKMessage): string | null {
  const content = message.message?.content;
  if (!content) return null;

  if (typeof content === "string") {
    return content.trim() || null;
  }

  // ContentBlock[] — 提取 text 块
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content as ContentBlock[]) {
      if (block.type === "text" && typeof block.text === "string") {
        parts.push(block.text);
      }
    }
    return parts.length > 0 ? parts.join("\n").trim() : null;
  }

  return null;
}
