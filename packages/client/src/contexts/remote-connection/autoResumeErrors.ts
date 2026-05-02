export type AutoResumeErrorReason =
  | "server_offline"
  | "unknown_username"
  | "relay_timeout"
  | "relay_unreachable"
  | "direct_unreachable"
  | "resume_incompatible"
  | "auth_failed"
  | "other";

export interface AutoResumeError {
  reason: AutoResumeErrorReason;
  mode: "relay" | "direct";
  relayUsername?: string;
  serverUrl?: string;
  message: string;
}

export function categorizeAutoResumeError(
  message: string,
): AutoResumeErrorReason {
  const lowerMessage = message.toLowerCase();

  if (
    lowerMessage.includes("resume_incompatible") ||
    lowerMessage.includes("session resume unsupported")
  ) {
    return "resume_incompatible";
  }

  if (lowerMessage.includes("server_offline")) {
    return "server_offline";
  }
  if (lowerMessage.includes("unknown_username")) {
    return "unknown_username";
  }
  if (
    lowerMessage.includes("waiting for server timed out") ||
    lowerMessage.includes("relay connection timeout")
  ) {
    return "relay_timeout";
  }
  if (
    lowerMessage.includes("failed to connect to relay") ||
    lowerMessage.includes("relay connection closed") ||
    lowerMessage.includes("relay connection error")
  ) {
    return "relay_unreachable";
  }

  if (
    lowerMessage.includes("websocket") ||
    lowerMessage.includes("econnrefused") ||
    lowerMessage.includes("connection refused") ||
    lowerMessage.includes("failed to connect") ||
    lowerMessage.includes("connection failed") ||
    lowerMessage.includes("network error")
  ) {
    return "direct_unreachable";
  }

  if (
    lowerMessage.includes("authentication") ||
    lowerMessage.includes("session") ||
    lowerMessage.includes("invalid_identity") ||
    lowerMessage.includes("unauthorized")
  ) {
    return "auth_failed";
  }

  return "other";
}
