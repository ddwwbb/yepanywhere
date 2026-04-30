import { createContext, useContext } from "react";
import type { Connection } from "../lib/connection/types";

export interface StoredSession {
  wsUrl: string;
  username: string;
  sessionId: string;
  sessionKey: string;
}

export type RelayConnectionStatus =
  | "idle"
  | "connecting_relay"
  | "waiting_server"
  | "authenticating"
  | "error";

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

export interface ConnectViaRelayOptions {
  relayUrl: string;
  relayUsername: string;
  srpUsername: string;
  srpPassword: string;
  rememberMe?: boolean;
  onStatusChange?: (status: RelayConnectionStatus) => void;
  session?: StoredSession;
}

export interface RemoteConnectionState {
  connection: Connection | null;
  isConnecting: boolean;
  isAutoResuming: boolean;
  error: string | null;
  autoResumeError: AutoResumeError | null;
  currentHostId: string | null;
  currentRelayUsername: string | null;
  setCurrentHostId: (hostId: string | null) => void;
  isIntentionalDisconnect: boolean;
  connect: (
    wsUrl: string,
    username: string,
    password: string,
    rememberMe?: boolean,
  ) => Promise<void>;
  connectViaRelay: (options: ConnectViaRelayOptions) => Promise<void>;
  disconnect: (isIntentional?: boolean) => void;
  clearAutoResumeError: () => void;
  retryAutoResume: () => void;
  storedUrl: string | null;
  storedUsername: string | null;
  hasStoredSession: boolean;
  resumeSession: (password: string) => Promise<void>;
}

export const RemoteConnectionContext =
  createContext<RemoteConnectionState | null>(null);

export function useRemoteConnection(): RemoteConnectionState {
  const context = useContext(RemoteConnectionContext);
  if (!context) {
    throw new Error(
      "useRemoteConnection must be used within RemoteConnectionProvider",
    );
  }
  return context;
}

export function useOptionalRemoteConnection(): RemoteConnectionState | null {
  return useContext(RemoteConnectionContext);
}

export function useRequiredConnection(): Connection {
  const { connection } = useRemoteConnection();
  if (!connection) {
    throw new Error("No active connection");
  }
  return connection;
}
