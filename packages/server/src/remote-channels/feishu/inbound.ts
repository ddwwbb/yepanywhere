/**
 * 飞书入站消息解析。
 *
 * 将原始飞书 im.message.receive_v1 事件解析为内部消息格式。
 */

import type { RemoteChannelFeishuBot } from "../../services/ServerSettingsService.js";

const LOG_TAG = "[feishu/inbound]";

/** 入站消息 */
export interface FeishuInboundMessage {
  messageId: string;
  chatId: string;
  senderId: string;
  text: string;
  isGroupChat: boolean;
  timestamp: number;
}

/** 飞书消息中的 @mention 条目 */
interface FeishuMention {
  key?: string;
  id?: { open_id?: string };
  name?: string;
}

/** 飞书原始消息形状 */
interface FeishuRawMessage {
  chat_id?: string;
  message_id?: string;
  message_type?: string;
  content?: string;
  root_id?: string;
  create_time?: string;
  mentions?: FeishuMention[];
}

/** 飞书事件形状（可能是包装或非包装的） */
interface FeishuRawEvent {
  event?: {
    message?: FeishuRawMessage;
    sender?: { sender_id?: { open_id?: string } };
  };
  message?: FeishuRawMessage;
  sender?: { sender_id?: { open_id?: string } };
}

/** 检查用户是否被授权 */
export function isUserAuthorized(
  config: RemoteChannelFeishuBot,
  userId: string,
  chatId: string,
): boolean {
  const isGroupChat = chatId.startsWith("oc_");

  if (isGroupChat) {
    if (config.groupPolicy === "disabled") return false;
    if (config.groupPolicy === "allowlist") {
      if (!config.groupAllowFrom?.includes(chatId)) return false;
    }
    return true;
  }

  // 私信
  if (config.dmPolicy === "disabled") return false;
  if (config.dmPolicy === "open") {
    if (!config.allowFrom || config.allowFrom.length === 0) return true;
    return config.allowFrom.includes("*") || config.allowFrom.includes(userId);
  }
  if (config.dmPolicy === "allowlist") {
    return config.allowFrom?.includes(userId) ?? false;
  }

  // 默认允许
  return true;
}

/** 解析飞书入站消息 */
export function parseInboundMessage(
  eventData: unknown,
  config: RemoteChannelFeishuBot,
  botOpenId?: string,
): FeishuInboundMessage | null {
  try {
    const raw = eventData as FeishuRawEvent;
    const event = raw?.event ?? raw;
    const message = event?.message;
    if (!message) return null;

    const chatId = message.chat_id ?? "";
    const messageId = message.message_id ?? "";
    const senderId = event.sender?.sender_id?.open_id ?? "";
    const msgType = message.message_type;
    const isGroupChat = chatId.startsWith("oc_");

    // 群聊 @提及检测
    const botMention = isGroupChat && message.mentions
      ? message.mentions.find((m) => m?.id?.open_id === botOpenId)
      : undefined;

    // 需要提及但未提及，丢弃
    if (isGroupChat && config.requireMention && botOpenId && !botMention) {
      return null;
    }

    // 线程会话模式：用 chatId:thread:rootId 作为路由地址
    const rootId = message.root_id ?? "";
    const effectiveChatId = config.threadSession && rootId
      ? `${chatId}:thread:${rootId}`
      : chatId;

    const timestamp = Number.parseInt(message.create_time ?? "0", 10) || Date.now();

    // 只处理文本消息
    if (msgType !== "text") return null;

    let text = "";
    try {
      const content = JSON.parse(message.content ?? "{}");
      text = content.text ?? "";
    } catch {
      text = message.content ?? "";
    }
    if (!text.trim()) return null;

    // 移除 @mention 标记
    if (botMention?.key) {
      text = text.split(botMention.key).join("").trim();
    }

    return {
      messageId,
      chatId: effectiveChatId,
      senderId,
      text: text.trim(),
      isGroupChat,
      timestamp,
    };
  } catch (err) {
    console.error(LOG_TAG, "Failed to parse inbound message:", err);
    return null;
  }
}
