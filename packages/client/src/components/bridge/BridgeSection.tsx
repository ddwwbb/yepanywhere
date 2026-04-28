import { useState, useCallback, useEffect, useRef } from "react";
import { api } from "../../api/client";
import { useI18n } from "../../i18n";

interface AdapterStatus {
  channelType: string;
  name?: string;
  running: boolean;
  lastMessageAt: string | null;
  error: string | null;
}

interface BridgeStatus {
  running: boolean;
  adapters: AdapterStatus[];
}

export function BridgeSection() {
  const { t } = useI18n();
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [settings, setSettings] = useState<{
    feishuEnabled: boolean;
    telegramEnabled: boolean;
    qqEnabled: boolean;
    weixinEnabled: boolean;
    remoteChannelsEnabled: boolean;
  }>({ feishuEnabled: false, telegramEnabled: false, qqEnabled: false, weixinEnabled: false, remoteChannelsEnabled: false });
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const data = await fetch("/api/bridge", { headers: { "X-Yep-Anywhere": "true" } }).then((r) => r.json());
      setStatus(data);
    } catch {
      // ignore
    }
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      const response = await api.getServerSettings();
      const rc = response.settings.remoteChannels;
      setSettings({
        feishuEnabled: rc?.feishu?.enabled ?? false,
        telegramEnabled: rc?.telegram?.enabled ?? false,
        qqEnabled: rc?.qq?.enabled ?? false,
        weixinEnabled: rc?.weixin?.enabled ?? false,
        remoteChannelsEnabled: !!(rc?.feishu?.enabled || rc?.telegram?.enabled || rc?.qq?.enabled || rc?.weixin?.enabled),
      });
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchSettings();
    refreshStatus();
  }, [fetchSettings, refreshStatus]);

  useEffect(() => {
    if (status?.running) {
      pollRef.current = setInterval(refreshStatus, 5000);
    } else if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [status?.running, refreshStatus]);

  const handleStart = async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/bridge", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Yep-Anywhere": "true" },
        body: JSON.stringify({ action: "start" }),
      });
      const data = await res.json();
      await refreshStatus();
      if (!data.ok && data.reason) {
        const reasonMap: Record<string, string> = {
          no_channels_enabled: t("bridge.errorNoChannels"),
          bridge_not_available: t("bridge.errorNotAvailable"),
        };
        setError(reasonMap[data.reason] ?? data.reason);
      }
    } catch {
      setError(t("bridge.errorNetwork"));
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    setStopping(true);
    try {
      await fetch("/api/bridge", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Yep-Anywhere": "true" },
        body: JSON.stringify({ action: "stop" }),
      });
      await refreshStatus();
    } catch {
      // ignore
    } finally {
      setStopping(false);
    }
  };

  const isRunning = status?.running ?? false;
  const adapterCount = status?.adapters?.length ?? 0;

  return (
    <div className="bridge-section">
      {/* 启用状态总览 */}
      <div className="bridge-card bridge-card--highlight">
        <div className="bridge-card-header">
          <h3>{t("bridge.channelStatus")}</h3>
        </div>
        <div className="bridge-channel-toggles">
          {(["feishu", "telegram", "qq", "weixin"] as const).map((ch) => {
            const enabled = settings[`${ch}Enabled` as keyof typeof settings];
            return (
              <div key={ch} className="bridge-channel-toggle">
                <span className={`bridge-channel-dot ${enabled ? "bridge-channel-dot--on" : ""}`} />
                <span className="bridge-channel-label">{t(`bridge.${ch}Channel`)}</span>
                <span className={`bridge-channel-status ${enabled ? "bridge-channel-status--on" : ""}`}>
                  {enabled ? t("bridge.channelOn") : t("bridge.channelOff")}
                </span>
              </div>
            );
          })}
        </div>
        <p className="bridge-hint">{t("bridge.channelToggleHint")}</p>
      </div>

      {/* 桥接状态 + 启停控制 */}
      <div className="bridge-card">
        <div className="bridge-status-row">
          <div className="bridge-status-info">
            <h3>{t("bridge.status")}</h3>
            <p className="bridge-status-detail">
              {isRunning
                ? t("bridge.activeBindings", { count: String(adapterCount) })
                : t("bridge.noBindings")}
            </p>
          </div>
          <div className="bridge-status-actions">
            <div className={`bridge-status-badge ${isRunning ? "bridge-status-badge--running" : ""}`}>
              {isRunning ? t("bridge.statusConnected") : t("bridge.statusDisconnected")}
            </div>
            {isRunning ? (
              <button type="button" className="bridge-button bridge-button--outline" onClick={handleStop} disabled={stopping}>
                {stopping ? t("bridge.stopping") : t("bridge.stop")}
              </button>
            ) : (
              <button type="button" className="bridge-button" onClick={handleStart} disabled={starting}>
                {starting ? t("bridge.starting") : t("bridge.start")}
              </button>
            )}
          </div>
        </div>
        {error && <p className="bridge-error">{error}</p>}
      </div>

      {/* 适配器状态 */}
      {isRunning && adapterCount > 0 && (
        <div className="bridge-card">
          <div className="bridge-card-header">
            <h3>{t("bridge.adapters")}</h3>
            <p className="bridge-card-desc">{t("bridge.adaptersDesc")}</p>
          </div>
          <div className="bridge-adapter-list">
            {status?.adapters.map((adapter, idx) => (
              <div key={`${adapter.channelType}-${adapter.name ?? idx}`} className="bridge-adapter-item">
                <div className="bridge-adapter-header">
                  <span className="bridge-adapter-name">
                    {t(`bridge.${adapter.channelType}Channel` as Parameters<typeof t>[0])}
                    {adapter.name && <span className="bridge-adapter-id">{adapter.name}</span>}
                  </span>
                  <span className={`bridge-adapter-badge ${adapter.running ? "bridge-adapter-badge--running" : ""}`}>
                    {adapter.running ? t("bridge.adapterRunning") : t("bridge.adapterStopped")}
                  </span>
                </div>
                {adapter.lastMessageAt && (
                  <p className="bridge-adapter-detail">
                    {t("bridge.adapterLastMessage")}: {new Date(adapter.lastMessageAt).toLocaleString()}
                  </p>
                )}
                {adapter.error && (
                  <p className="bridge-adapter-error">{adapter.error}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
