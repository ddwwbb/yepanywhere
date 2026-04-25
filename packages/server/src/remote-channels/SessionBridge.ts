import type { InputRequest } from "@yep-anywhere/shared";
import { findProjectPathBySessionId } from "../projects/paths.js";
import type { ContentBlock, SDKMessage, UserMessage } from "../sdk/types.js";
import type { Process } from "../supervisor/Process.js";
import type { Supervisor } from "../supervisor/Supervisor.js";

export interface RemoteBridgeInbound {
  chatId: string;
  messageId?: string;
  text: string;
}

export interface RemoteSessionBridgeOptions {
  logTag: string;
  supervisor: Supervisor;
  boundSessionId?: string;
  sendText: (
    chatId: string,
    text: string,
    replyToMessageId?: string,
  ) => Promise<void>;
  onTurnStarted?: (inbound: RemoteBridgeInbound) => void;
  onAssistantText: (
    text: string,
    inbound: RemoteBridgeInbound | undefined,
  ) => Promise<void>;
  onApprovalPrompt?: (
    request: InputRequest,
    summary: string,
    inbound: RemoteBridgeInbound,
  ) => Promise<boolean>;
  onApprovalResolved?: (
    decision: "approve" | "deny",
    accepted: boolean,
    inbound: RemoteBridgeInbound | undefined,
  ) => Promise<void> | void;
}

export class RemoteSessionBridge {
  private readonly options: RemoteSessionBridgeOptions;
  private cachedProjectPath: string | undefined;
  private processUnsubscribe: (() => void) | null = null;
  private subscribedProcessId: string | undefined;
  private sentApprovalRequestIds = new Set<string>();
  private lastInbound: RemoteBridgeInbound | undefined;

  constructor(options: RemoteSessionBridgeOptions) {
    this.options = options;
  }

  get boundSessionId(): string | undefined {
    return this.options.boundSessionId;
  }

  getLastInbound(): RemoteBridgeInbound | undefined {
    return this.lastInbound;
  }

  stop(): void {
    this.unsubscribeFromProcess();
    this.sentApprovalRequestIds.clear();
  }

  subscribeToExistingProcess(): void {
    if (!this.options.boundSessionId) return;
    const process = this.options.supervisor.getProcessForSession(
      this.options.boundSessionId,
    );
    if (process) {
      this.subscribeToProcess(process);
    }
  }

  async handleInbound(inbound: RemoteBridgeInbound): Promise<void> {
    this.lastInbound = inbound;

    if (await this.handleApprovalCommand(inbound)) return;

    const sessionId = this.options.boundSessionId;
    if (!sessionId) {
      await this.options.sendText(
        inbound.chatId,
        "请先绑定一个会话后再发送消息。",
        inbound.messageId,
      );
      return;
    }

    const message: UserMessage = { text: inbound.text };
    let process = this.options.supervisor.getProcessForSession(sessionId);

    if (process && !process.isTerminated) {
      this.cachedProjectPath = process.projectPath;
      this.subscribeToProcess(process);
      const queued = process.queueMessage(message);
      if (!queued.success) {
        await this.options.sendText(
          inbound.chatId,
          queued.error ?? "发送到会话失败，请稍后重试。",
          inbound.messageId,
        );
        return;
      }
      this.options.onTurnStarted?.(inbound);
      return;
    }

    const projectPath = await this.resolveProjectPath(sessionId, process);
    if (!projectPath) {
      await this.options.sendText(
        inbound.chatId,
        "无法找到会话的项目路径，请重新绑定。",
        inbound.messageId,
      );
      return;
    }

    this.cachedProjectPath = projectPath;

    try {
      const result = await this.options.supervisor.resumeSession(
        sessionId,
        projectPath,
        message,
      );
      if (isProcess(result)) {
        this.subscribeToProcess(result);
      }
      this.options.onTurnStarted?.(inbound);
      console.log(`${this.options.logTag} Session resumed for ${sessionId}`);
    } catch (err) {
      console.error(
        `${this.options.logTag} Failed to resume session ${sessionId}:`,
        err,
      );
      await this.options.sendText(
        inbound.chatId,
        "恢复会话失败，请稍后重试。",
        inbound.messageId,
      );
    }
  }

  async sendPendingApprovalPrompt(): Promise<void> {
    const inbound = this.lastInbound;
    const sessionId = this.options.boundSessionId;
    const onApprovalPrompt = this.options.onApprovalPrompt;
    if (!inbound || !sessionId || !onApprovalPrompt) return;

    const process = this.options.supervisor.getProcessForSession(sessionId);
    const request = process?.getPendingInputRequest();
    if (!request || request.type !== "tool-approval") return;

    if (this.sentApprovalRequestIds.has(request.id)) return;

    const sent = await onApprovalPrompt(
      request,
      buildApprovalSummary(request.toolInput),
      inbound,
    );
    if (sent) {
      this.sentApprovalRequestIds.add(request.id);
    }
  }

  async respondToApproval(
    decision: "approve" | "deny",
    requestId?: string,
    inbound = this.lastInbound,
  ): Promise<boolean> {
    const sessionId = this.options.boundSessionId;
    if (!sessionId) return false;

    const process = this.options.supervisor.getProcessForSession(sessionId);
    const pending = process?.getPendingInputRequest();
    const targetRequestId = requestId || pending?.id;
    if (!process || !targetRequestId) return false;

    const accepted = process.respondToInput(targetRequestId, decision);
    if (accepted) {
      this.sentApprovalRequestIds.delete(targetRequestId);
    }
    await this.options.onApprovalResolved?.(decision, accepted, inbound);
    return accepted;
  }

  private async handleApprovalCommand(
    inbound: RemoteBridgeInbound,
  ): Promise<boolean> {
    const command = parseApprovalCommand(inbound.text);
    if (!command) return false;

    const accepted = await this.respondToApproval(
      command.decision,
      command.requestId,
      inbound,
    );
    await this.options.sendText(
      inbound.chatId,
      accepted
        ? command.decision === "approve"
          ? "已允许工具请求。"
          : "已拒绝工具请求。"
        : "审批请求已失效或会话未运行。",
      inbound.messageId,
    );
    return true;
  }

  private async resolveProjectPath(
    sessionId: string,
    process?: Process,
  ): Promise<string | undefined> {
    if (process?.projectPath) return process.projectPath;
    if (this.cachedProjectPath) return this.cachedProjectPath;

    const terminated = this.options.supervisor.getRecentlyTerminatedProcesses();
    const match = terminated.find((p) => p.sessionId === sessionId);
    if (match?.projectPath) return match.projectPath;

    const diskPath = await findProjectPathBySessionId(sessionId);
    if (diskPath) {
      console.log(
        `${this.options.logTag} Resolved projectPath from disk for session ${sessionId}: ${diskPath}`,
      );
      return diskPath;
    }

    return undefined;
  }

  private subscribeToProcess(process: Process): void {
    if (this.subscribedProcessId === process.id && this.processUnsubscribe) {
      return;
    }

    this.unsubscribeFromProcess();

    this.subscribedProcessId = process.id;
    this.processUnsubscribe = process.subscribe((event) => {
      if (event.type !== "message") return;
      this.handleProcessMessage(event.message).catch((err) => {
        console.error(
          `${this.options.logTag} Error forwarding assistant message:`,
          err,
        );
      });
    });

    console.log(
      `${this.options.logTag} Subscribed to process ${process.id} for session ${process.sessionId}`,
    );
  }

  private unsubscribeFromProcess(): void {
    if (!this.processUnsubscribe) return;
    this.processUnsubscribe();
    this.processUnsubscribe = null;
    this.subscribedProcessId = undefined;
  }

  private async handleProcessMessage(message: SDKMessage): Promise<void> {
    if (message.type !== "assistant") return;

    const text = extractAssistantText(message);
    if (!text) return;

    await this.options.onAssistantText(text, this.lastInbound);
  }
}

export function extractAssistantText(message: SDKMessage): string | null {
  const content = message.message?.content;
  if (!content) return null;

  if (typeof content === "string") {
    return content.trim() || null;
  }

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

export function buildApprovalSummary(toolInput: unknown): string {
  if (!toolInput) return "请求执行工具。";
  try {
    return `\`\`\`json\n${JSON.stringify(toolInput, null, 2)}\n\`\`\``;
  } catch {
    return String(toolInput);
  }
}

function parseApprovalCommand(
  text: string,
): { decision: "approve" | "deny"; requestId?: string } | null {
  const trimmed = text.trim();
  const match = trimmed.match(
    /^\/?(?:perm|permission|approve|allow|deny|reject)(?:\s+(approve|allow|allow_session|deny|reject))?(?:\s+(.+))?$/i,
  );
  if (!match) return null;

  const firstToken = trimmed.split(/\s+/, 1)[0]?.replace(/^\//, "").toLowerCase();
  const action = (match[1]?.toLowerCase() || firstToken) ?? "";
  const decision =
    action === "approve" || action === "allow" || action === "allow_session"
      ? "approve"
      : action === "deny" || action === "reject"
        ? "deny"
        : null;
  if (!decision) return null;

  const requestId = match[2]?.trim() || undefined;
  return { decision, requestId };
}

function isProcess(value: unknown): value is Process {
  return (
    typeof value === "object" &&
    value !== null &&
    "subscribe" in value &&
    typeof (value as { subscribe?: unknown }).subscribe === "function"
  );
}
