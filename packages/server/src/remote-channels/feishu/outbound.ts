/**
 * 飞书出站消息发送。
 *
 * 使用飞书 IM API 发送消息，支持 text 和 post（Markdown）格式。
 * post 格式使用飞书的 md 标签渲染 Markdown 内容。
 */

import type * as lark from "@larksuiteoapi/node-sdk";
import { getLogger } from "../../logging/logger.js";

const LOG_TAG = "[feishu/outbound]";

/** 发送纯文本消息 */
export async function sendTextMessage(
  client: lark.Client,
  chatId: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const result = await client.im.message.create({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: chatId,
        msg_type: "text",
        content: JSON.stringify({ text }),
      },
    });

    if (result.code !== 0) {
      return { ok: false, error: result.msg ?? `Feishu API error: ${result.code}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 发送 post 格式消息（支持 Markdown 渲染） */
export async function sendPostMessage(
  client: lark.Client,
  chatId: string,
  markdown: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const content = buildPostContent(markdown);
    const result = await client.im.message.create({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: chatId,
        msg_type: "post",
        content: JSON.stringify(content),
      },
    });

    if (result.code !== 0) {
      // post 格式失败时降级为纯文本
      getLogger().warn(`${LOG_TAG} Post format failed (${result.code}), falling back to text`);
      return sendTextMessage(client, chatId, markdown);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 回复消息（纯文本） */
export async function replyMessage(
  client: lark.Client,
  messageId: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const result = await client.im.message.reply({
      path: { message_id: messageId },
      data: {
        msg_type: "text",
        content: JSON.stringify({ text }),
      },
    });

    if (result.code !== 0) {
      return { ok: false, error: result.msg ?? `Feishu API error: ${result.code}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 以 post（Markdown）格式回复消息 */
export async function replyPostMessage(
  client: lark.Client,
  messageId: string,
  markdown: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const content = buildPostContent(markdown);
    const result = await client.im.message.reply({
      path: { message_id: messageId },
      data: {
        msg_type: "post",
        content: JSON.stringify(content),
      },
    });

    if (result.code !== 0) {
      // post 格式失败时降级为纯文本回复
      getLogger().warn(`${LOG_TAG} Post reply failed (${result.code}), falling back to text`);
      return replyMessage(client, messageId, markdown);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface FeishuApprovalCardOptions {
  chatId: string;
  sessionId: string;
  requestId: string;
  toolName?: string;
  summary: string;
}

/** 发送飞书工具审批卡片 */
export async function sendApprovalCard(
  client: lark.Client,
  options: FeishuApprovalCardOptions,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const content = JSON.stringify(buildApprovalCard(options));
    const result = await client.im.message.create({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: options.chatId,
        msg_type: "interactive",
        content,
      },
    });

    if (result.code !== 0) {
      return { ok: false, error: result.msg ?? `Feishu API error: ${result.code}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 给消息添加 emoji 表情回应，返回 reactionId */
export async function addReaction(
  client: lark.Client,
  messageId: string,
  emojiType: string = "Typing",
): Promise<string | null> {
  try {
    const result = await client.im.messageReaction.create({
      path: { message_id: messageId },
      data: { reaction_type: { emoji_type: emojiType } },
    });
    if (result.code !== 0) return null;
    return result.data?.reaction_id ?? null;
  } catch {
    return null;
  }
}

/** 移除消息的 emoji 表情回应 */
export async function removeReaction(
  client: lark.Client,
  messageId: string,
  reactionId: string,
): Promise<void> {
  try {
    await client.im.messageReaction.delete({
      path: { message_id: messageId, reaction_id: reactionId },
    });
  } catch {
    // 移除失败不影响主流程
  }
}

/** 构建 post 格式内容体（Markdown） */
function buildPostContent(markdown: string): object {
  return {
    zh_cn: {
      content: [[{ tag: "md", text: markdown }]],
    },
  };
}

function buildApprovalCard(options: FeishuApprovalCardOptions): object {
  const toolName = options.toolName ?? "Tool";
  return {
    schema: "2.0",
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: "工具权限审批" },
      template: "orange",
    },
    body: {
      elements: [
        {
          tag: "markdown",
          content: `**${toolName}** 请求执行权限\n\n${options.summary}`,
        },
        { tag: "hr" },
        {
          tag: "column_set",
          flex_mode: "none",
          background_style: "default",
          columns: [
            {
              tag: "column",
              width: "weighted",
              weight: 1,
              elements: [
                {
                  tag: "button",
                  text: { tag: "plain_text", content: "允许" },
                  type: "primary",
                  value: {
                    callback_data: `yep:approval:approve:${options.sessionId}:${options.requestId}`,
                    chatId: options.chatId,
                  },
                },
              ],
            },
            {
              tag: "column",
              width: "weighted",
              weight: 1,
              elements: [
                {
                  tag: "button",
                  text: { tag: "plain_text", content: "拒绝" },
                  type: "danger",
                  value: {
                    callback_data: `yep:approval:deny:${options.sessionId}:${options.requestId}`,
                    chatId: options.chatId,
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  };
}
