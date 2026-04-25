import type { RemoteChannelEvent } from "@yep-anywhere/shared";

export function formatNotificationText(
  event: RemoteChannelEvent,
  maxTextLength: number,
): string {
  const parts = [
    `[Yep] ${event.title}`,
    event.projectLabel ? `Project: ${event.projectLabel}` : undefined,
    `Session: ${event.sessionId}`,
    `Severity: ${event.severity}`,
    event.summary,
    event.yepUrl ? `Open: ${event.yepUrl}` : undefined,
  ].filter(Boolean);

  const text = parts.join("\n");
  if (text.length <= maxTextLength) return text;
  return `${text.slice(0, maxTextLength - 1)}…`;
}
