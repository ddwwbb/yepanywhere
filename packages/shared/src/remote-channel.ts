export type RemoteChannelEventType =
  | "session.started"
  | "session.completed"
  | "session.failed"
  | "session.needs_attention"
  | "permission.attention_needed"
  | "process.stale"
  | "summary.available";

export type RemoteChannelSeverity = "info" | "warning" | "error";

export interface RemoteChannelEvent {
  id: string;
  type: RemoteChannelEventType;
  sessionId: string;
  provider?: string;
  severity: RemoteChannelSeverity;
  title: string;
  summary: string;
  projectLabel?: string;
  yepUrl?: string;
  dedupKey: string;
  createdAt: string;
  expiresAt?: string;
}
