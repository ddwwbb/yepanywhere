import type { ProviderName } from "@yep-anywhere/shared";
import type { ServerSettings } from "../../api/client";

export const LONG_PRESS_MS = 500;

export type StatusFilter = "all" | "unread" | "starred" | "archived";
export type AgeFilter = "3" | "7" | "14" | "30";

export const PROVIDER_COLORS: Record<ProviderName, string> = {
  claude: "var(--color-brand)",
  "claude-ollama": "var(--color-brand)",
  codex: "var(--provider-codex)",
  "codex-oss": "var(--provider-codex-oss)",
  gemini: "var(--provider-gemini)",
  "gemini-acp": "var(--provider-gemini)",
  opencode: "var(--provider-opencode)",
};

type RemoteChannels = ServerSettings["remoteChannels"];

export function getBotBoundSessionIds(
  remoteChannels: RemoteChannels,
): Set<string> {
  const ids = new Set<string>();
  for (const channel of [
    remoteChannels?.feishu,
    remoteChannels?.telegram,
    remoteChannels?.qq,
    remoteChannels?.weixin,
  ]) {
    for (const bot of channel?.bots ?? []) {
      if (bot.boundSessionId) ids.add(bot.boundSessionId);
    }
  }
  return ids;
}
