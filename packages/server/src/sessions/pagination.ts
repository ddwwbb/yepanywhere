/**
 * Compact-boundary pagination for session messages.
 *
 * Slices a normalized message array at compact_boundary positions to reduce
 * payload size for initial loads. This runs AFTER normalization but BEFORE
 * expensive augmentation (markdown, diffs, syntax highlighting).
 */

import type { Message } from "../supervisor/types.js";

/** Pagination metadata returned alongside sliced messages */
export interface PaginationInfo {
  /** Whether there are older messages not included in this response */
  hasOlderMessages: boolean;
  /** Total message count in the full session */
  totalMessageCount: number;
  /** Number of messages returned in this response */
  returnedMessageCount: number;
  /** UUID of the first returned message (pass as beforeMessageId to load previous chunk) */
  truncatedBeforeMessageId?: string;
  /** Total number of compact_boundary entries in the session */
  totalCompactions: number;
}

/** Result of slicing messages at compact boundaries */
export interface SliceResult {
  messages: Message[];
  pagination: PaginationInfo;
}

export interface SliceOptions {
  messageLimit?: number;
}

const SAFE_START_LOOKBACK = 20;

function getMessageId(m: Message): string | undefined {
  return m.uuid ?? (typeof m.id === "string" ? m.id : undefined);
}

function getFirstMessageId(messages: Message[]): string | undefined {
  for (const message of messages) {
    const id = getMessageId(message);
    if (id) return id;
  }
  return undefined;
}

function isCompactBoundary(m: Message): boolean {
  return m.type === "system" && m.subtype === "compact_boundary";
}

function hasToolResultContent(m: Message): boolean {
  const content = m.message?.content;
  return (
    Array.isArray(content) &&
    content.some((block) => block.type === "tool_result")
  );
}

function isSafeWindowStart(m: Message): boolean {
  return (
    isCompactBoundary(m) || (m.type === "user" && !hasToolResultContent(m))
  );
}

function normalizeMessageLimit(
  messageLimit: number | undefined,
): number | undefined {
  if (messageLimit === undefined || !Number.isFinite(messageLimit)) {
    return undefined;
  }
  const normalized = Math.floor(messageLimit);
  return normalized > 0 ? normalized : undefined;
}

function findSafeStartIndex(
  messages: Message[],
  strictStartIndex: number,
  minimumStartIndex: number,
): number {
  const searchFrom = Math.max(
    minimumStartIndex,
    strictStartIndex - SAFE_START_LOOKBACK,
  );
  for (let i = strictStartIndex; i >= searchFrom; i--) {
    const message = messages[i];
    if (message && isSafeWindowStart(message)) {
      return i;
    }
  }
  return strictStartIndex;
}

function findIdentifiedStartIndex(
  messages: Message[],
  startIndex: number,
): number {
  for (let i = startIndex; i < messages.length; i++) {
    const message = messages[i];
    if (message && getMessageId(message)) {
      return i;
    }
  }
  return startIndex;
}

/**
 * Slice messages to return only the tail portion starting from the Nth-from-last
 * compact_boundary. The boundary message itself is included so the client sees
 * the "Context compacted" divider.
 *
 * @param messages - Normalized message array (active branch, in conversation order)
 * @param tailCompactions - Number of compact boundaries to include from the end
 * @param beforeMessageId - Optional cursor: only consider messages before this ID
 *                          (used for loading progressively older chunks)
 */
export function sliceAtCompactBoundaries(
  messages: Message[],
  tailCompactions: number,
  beforeMessageId?: string,
  options: SliceOptions = {},
): SliceResult {
  const totalMessageCount = messages.length;
  const messageLimit = normalizeMessageLimit(options.messageLimit);

  // For "load older" requests: work with messages before the cursor
  let workingMessages = messages;
  if (beforeMessageId) {
    const idx = messages.findIndex((m) => getMessageId(m) === beforeMessageId);
    if (idx >= 0) {
      workingMessages = messages.slice(0, idx);
    }
    // If not found, use all messages (graceful fallback)
  }

  // Find all compact_boundary indices in the working set
  const compactIndices: number[] = [];
  for (let i = 0; i < workingMessages.length; i++) {
    const m = workingMessages[i];
    if (m && isCompactBoundary(m)) {
      compactIndices.push(i);
    }
  }

  const totalCompactions = compactIndices.length;
  let slicedMessages = workingMessages;
  let hasOlderMessages = false;

  if (compactIndices.length > tailCompactions) {
    const sliceFromIdx =
      compactIndices[compactIndices.length - tailCompactions] ?? 0;
    slicedMessages = workingMessages.slice(sliceFromIdx);
    hasOlderMessages = true;
  }

  if (messageLimit !== undefined && slicedMessages.length > messageLimit) {
    const strictStartIndex = Math.max(workingMessages.length - messageLimit, 0);
    const minimumStartIndex = hasOlderMessages
      ? workingMessages.length - slicedMessages.length
      : 0;
    const safeStartIndex = findSafeStartIndex(
      workingMessages,
      strictStartIndex,
      minimumStartIndex,
    );
    const identifiedStartIndex = findIdentifiedStartIndex(
      workingMessages,
      safeStartIndex,
    );
    slicedMessages = workingMessages.slice(identifiedStartIndex);
    hasOlderMessages = identifiedStartIndex > 0;
  }

  const firstId = getFirstMessageId(slicedMessages);
  const canLoadOlder = hasOlderMessages && firstId !== undefined;

  return {
    messages: slicedMessages,
    pagination: {
      hasOlderMessages: canLoadOlder,
      totalMessageCount,
      returnedMessageCount: slicedMessages.length,
      truncatedBeforeMessageId: canLoadOlder ? firstId : undefined,
      totalCompactions,
    },
  };
}
