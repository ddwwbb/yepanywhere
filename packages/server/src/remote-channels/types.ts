import type { RemoteChannelEvent } from "@yep-anywhere/shared";

export interface RemoteChannelDeliveryResult {
  ok: boolean;
  channel: string;
  messageId?: string;
  error?: string;
}

export interface RemoteChannelAdapter {
  readonly channel: string;
  readonly botId: string;
  readonly boundSessionId?: string;
  send(event: RemoteChannelEvent): Promise<RemoteChannelDeliveryResult>;
}

export interface RemoteChannelAuditEntry {
  timestamp: string;
  eventId: string;
  eventType: RemoteChannelEvent["type"];
  sessionId: string;
  channel: string;
  dedupKey: string;
  outcome: "sent" | "failed" | "deduped";
  messageId?: string;
  error?: string;
}
