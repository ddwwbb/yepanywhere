import { useState, useCallback, useEffect, useRef } from "react";

interface AdapterStatus {
  channelType: string;
  running: boolean;
  lastMessageAt: string | null;
  error: string | null;
}

export interface BridgeStatus {
  running: boolean;
  adapters: AdapterStatus[];
}

const BRIDGE_API = "/api/bridge";
const BRIDGE_HEADERS = { "X-Yep-Anywhere": "true" };
const POLL_INTERVAL_MS = 5000;

/**
 * Hook for polling bridge status and controlling bridge start/stop.
 * Automatically polls every 5 seconds while the bridge is running.
 */
export function useBridgeStatus(): {
  bridgeStatus: BridgeStatus | null;
  starting: boolean;
  stopping: boolean;
  startBridge: () => Promise<string | null>;
  stopBridge: () => Promise<void>;
  refreshStatus: () => Promise<void>;
} {
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch(BRIDGE_API, { headers: BRIDGE_HEADERS });
      if (res.ok) {
        const data = await res.json();
        setBridgeStatus(data);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  // 桥接运行时自动轮询状态
  useEffect(() => {
    if (bridgeStatus?.running) {
      pollRef.current = setInterval(refreshStatus, POLL_INTERVAL_MS);
    } else if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }
    };
  }, [bridgeStatus?.running, refreshStatus]);

  const startBridge = useCallback(async (): Promise<string | null> => {
    setStarting(true);
    try {
      const res = await fetch(BRIDGE_API, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...BRIDGE_HEADERS },
        body: JSON.stringify({ action: "start" }),
      });
      const data = await res.json();
      await refreshStatus();
      if (!data.ok && data.reason) {
        return data.reason;
      }
      return null;
    } catch {
      return "network_error";
    } finally {
      setStarting(false);
    }
  }, [refreshStatus]);

  const stopBridge = useCallback(async () => {
    setStopping(true);
    try {
      await fetch(BRIDGE_API, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...BRIDGE_HEADERS },
        body: JSON.stringify({ action: "stop" }),
      });
      await refreshStatus();
    } catch {
      // ignore
    } finally {
      setStopping(false);
    }
  }, [refreshStatus]);

  return {
    bridgeStatus,
    starting,
    stopping,
    startBridge,
    stopBridge,
    refreshStatus,
  };
}
