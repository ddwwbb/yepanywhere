import type { RemoteChannelEvent } from "@yep-anywhere/shared";
import type { RemoteChannelAuditLog } from "./AuditLog.js";
import type { RemoteChannelDedupStore } from "./DedupStore.js";
import type { RemoteChannelAdapter, RemoteChannelDeliveryResult } from "./types.js";

export interface RemoteChannelDispatcherOptions {
  adapters: RemoteChannelAdapter[];
  dedupStore: RemoteChannelDedupStore;
  auditLog: RemoteChannelAuditLog;
  dedupTtlMs?: number;
}

export class RemoteChannelDispatcher {
  private readonly adapters: RemoteChannelAdapter[];
  private readonly dedupStore: RemoteChannelDedupStore;
  private readonly auditLog: RemoteChannelAuditLog;
  private readonly dedupTtlMs: number;

  constructor(options: RemoteChannelDispatcherOptions) {
    this.adapters = options.adapters;
    this.dedupStore = options.dedupStore;
    this.auditLog = options.auditLog;
    this.dedupTtlMs = options.dedupTtlMs ?? 5 * 60 * 1000;
  }

  async dispatch(event: RemoteChannelEvent): Promise<RemoteChannelDeliveryResult[]> {
    if (!this.dedupStore.mark(event.dedupKey, this.dedupTtlMs)) {
      await this.recordDeduped(event);
      return [];
    }

    const results: RemoteChannelDeliveryResult[] = [];

    for (const adapter of this.adapters) {
      try {
        const result = await adapter.send(event);
        results.push(result);
        this.recordResult(event, result).catch(() => {});
      } catch (error) {
        const result: RemoteChannelDeliveryResult = {
          ok: false,
          channel: adapter.channel,
          error: error instanceof Error ? error.message : String(error),
        };
        results.push(result);
        this.recordResult(event, result).catch(() => {});
      }
    }

    return results;
  }

  private async recordDeduped(event: RemoteChannelEvent): Promise<void> {
    this.auditLog.record({
      eventId: event.id,
      eventType: event.type,
      sessionId: event.sessionId,
      channel: "*",
      dedupKey: event.dedupKey,
      outcome: "deduped",
    });
  }

  private async recordResult(
    event: RemoteChannelEvent,
    result: RemoteChannelDeliveryResult,
  ): Promise<void> {
    await this.auditLog.record({
      eventId: event.id,
      eventType: event.type,
      sessionId: event.sessionId,
      channel: result.channel,
      dedupKey: event.dedupKey,
      outcome: result.ok ? "sent" : "failed",
      messageId: result.messageId,
      error: result.error,
    });
  }
}
