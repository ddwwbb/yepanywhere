import { useState, useCallback, useEffect } from "react";
import { Send, MessageSquare, Smile, MessageCircle } from "lucide-react";
import { api } from "../../api/client";
import { useI18n } from "../../i18n";
import { useBridgeStatus } from "../../hooks/useBridgeStatus";
import { useProviders } from "../../hooks/useProviders";
import { useProjects } from "../../hooks/useProjects";
import type { ProviderInfo } from "@yep-anywhere/shared";

/** 频道图标映射 */
function ChannelIcon({ channel }: { channel: string }) {
  const props = { size: 16, strokeWidth: 2 };
  switch (channel) {
    case "telegram":
      return <Send {...props} />;
    case "feishu":
      return <MessageSquare {...props} />;
    case "qq":
      return <Smile {...props} />;
    case "weixin":
      return <MessageCircle {...props} />;
    default:
      return null;
  }
}

interface ChannelConfig {
  key: "feishu" | "telegram" | "qq" | "weixin";
  enabled: boolean;
}

export function BridgeSection() {
  const { t } = useI18n();
  const { bridgeStatus, starting, stopping, startBridge, stopBridge } =
    useBridgeStatus();
  const { providers } = useProviders();
  const { projects } = useProjects();

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 主开关
  const [isEnabled, setIsEnabled] = useState(false);
  // 频道开关
  const [channels, setChannels] = useState<ChannelConfig[]>([
    { key: "feishu", enabled: false },
    { key: "telegram", enabled: false },
    { key: "qq", enabled: false },
    { key: "weixin", enabled: false },
  ]);
  // 自动启动
  const [autoStart, setAutoStart] = useState(false);
  // 默认配置
  const [workDir, setWorkDir] = useState("");
  const [model, setModel] = useState("");

  const fetchSettings = useCallback(async () => {
    try {
      const response = await api.getServerSettings();
      const s = response.settings;
      setIsEnabled(s.remoteBridgeEnabled ?? false);
      setAutoStart(s.bridgeAutoStart ?? false);
      setWorkDir(s.bridgeDefaultWorkDir ?? "");
      // 组合 provider_id::model 值
      if (s.bridgeDefaultProviderId && s.bridgeDefaultModel) {
        setModel(`${s.bridgeDefaultProviderId}::${s.bridgeDefaultModel}`);
      } else if (s.bridgeDefaultModel) {
        setModel(s.bridgeDefaultModel);
      } else {
        setModel("");
      }
      // 频道开关
      const rc = s.remoteChannels ?? {};
      setChannels([
        { key: "feishu", enabled: rc.feishu?.enabled ?? false },
        { key: "telegram", enabled: rc.telegram?.enabled ?? false },
        { key: "qq", enabled: rc.qq?.enabled ?? false },
        { key: "weixin", enabled: rc.weixin?.enabled ?? false },
      ]);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // 保存设置
  const saveSettings = async (updates: Record<string, unknown>) => {
    setSaving(true);
    try {
      await api.updateServerSettings(updates);
      await fetchSettings();
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  // 主开关切换
  const handleToggleEnabled = (checked: boolean) => {
    setIsEnabled(checked);
    saveSettings({ remoteBridgeEnabled: checked });
  };

  // 频道开关切换
  const handleToggleChannel = (
    channelKey: string,
    checked: boolean,
  ) => {
    setChannels((prev) =>
      prev.map((ch) =>
        ch.key === channelKey ? { ...ch, enabled: checked } : ch,
      ),
    );
    // 读取当前设置并更新对应频道
    api.getServerSettings().then((response) => {
      const rc = response.settings.remoteChannels ?? {};
      const channelSettings = rc[channelKey as keyof typeof rc] ?? {};
      api.updateServerSettings({
        remoteChannels: {
          ...rc,
          [channelKey]: { ...channelSettings, enabled: checked },
        },
      });
    });
  };

  // 自动启动切换
  const handleToggleAutoStart = (checked: boolean) => {
    setAutoStart(checked);
    saveSettings({ bridgeAutoStart: checked });
  };

  // 保存默认配置
  const handleSaveDefaults = () => {
    const parts = model.split("::");
    const providerId = parts.length === 2 ? parts[0] : "";
    const modelValue = parts.length === 2 ? parts[1] : model;
    saveSettings({
      bridgeDefaultWorkDir: workDir,
      bridgeDefaultModel: modelValue,
      bridgeDefaultProviderId: providerId,
    });
  };

  // 启动桥接
  const handleStartBridge = async () => {
    setError(null);
    const reason = await startBridge();
    if (reason) {
      const reasonMap: Record<string, string> = {
        no_channels_enabled: t("bridge.errorNoChannels"),
        bridge_not_available: t("bridge.errorNotAvailable"),
        network_error: t("bridge.errorNetwork"),
      };
      setError(reasonMap[reason] ?? reason);
    }
  };

  // 停止桥接
  const handleStopBridge = () => {
    stopBridge();
  };

  const isRunning = bridgeStatus?.running ?? false;
  const adapterCount = bridgeStatus?.adapters?.length ?? 0;

  // 获取有模型的可用 provider 列表
  const availableProviders = providers.filter(
    (p) => p.installed && (p.authenticated || p.enabled) && p.models && p.models.length > 0,
  );

  return (
    <div className="bridge-section">
      {/* 主开关 */}
      <div
        className={`bridge-card ${isEnabled ? "bridge-card--highlight" : ""}`}
      >
        <div className="bridge-toggle-row">
          <div className="bridge-toggle-info">
            <strong>{t("bridge.title")}</strong>
            <p>{t("bridge.description")}</p>
          </div>
          <label className="bridge-switch">
            <input
              type="checkbox"
              checked={isEnabled}
              onChange={(e) => handleToggleEnabled(e.target.checked)}
            />
            <span className="bridge-switch-slider" />
          </label>
        </div>
        {isEnabled && (
          <div className="bridge-status-banner bridge-status-banner--success">
            <span className="bridge-channel-dot bridge-channel-dot--on" />
            {t("bridge.activeHint")}
          </div>
        )}
      </div>

      {/* 桥接状态 + 启停控制 */}
      {isEnabled && (
        <div className="bridge-card">
          <div className="bridge-status-row">
            <div className="bridge-status-info">
              <h3>{t("bridge.status")}</h3>
              <p className="bridge-status-detail">
                {isRunning
                  ? t("bridge.activeBindings", {
                      count: String(adapterCount),
                    })
                  : t("bridge.noBindings")}
              </p>
            </div>
            <div className="bridge-status-actions">
              <div
                className={`bridge-status-badge ${isRunning ? "bridge-status-badge--running" : ""}`}
              >
                {isRunning
                  ? t("bridge.statusConnected")
                  : t("bridge.statusDisconnected")}
              </div>
              {isRunning ? (
                <button
                  type="button"
                  className="bridge-button bridge-button--outline"
                  onClick={handleStopBridge}
                  disabled={stopping}
                >
                  {stopping ? t("bridge.stopping") : t("bridge.stop")}
                </button>
              ) : (
                <button
                  type="button"
                  className="bridge-button"
                  onClick={handleStartBridge}
                  disabled={starting}
                >
                  {starting ? t("bridge.starting") : t("bridge.start")}
                </button>
              )}
            </div>
          </div>
          {error && <p className="bridge-error">{error}</p>}
        </div>
      )}

      {/* 频道开关 */}
      {isEnabled && (
        <div className="bridge-card">
          <div className="bridge-card-header">
            <h3>{t("bridge.channels")}</h3>
            <p className="bridge-card-desc">{t("bridge.channelsDesc")}</p>
          </div>
          <div className="bridge-channel-switches">
            {channels.map((ch, idx) => (
              <div
                key={ch.key}
                className={`bridge-channel-switch-row ${idx > 0 ? "bridge-channel-divider" : ""}`}
              >
                <div className="bridge-channel-switch-info">
                  <ChannelIcon channel={ch.key} />
                  <div>
                    <p className="bridge-channel-switch-label">
                      {t(`bridge.${ch.key}Channel`)}
                    </p>
                    <p className="bridge-channel-switch-desc">
                      {t(`bridge.${ch.key}ChannelDesc`)}
                    </p>
                  </div>
                </div>
                <label className="bridge-switch">
                  <input
                    type="checkbox"
                    checked={ch.enabled}
                    onChange={(e) =>
                      handleToggleChannel(ch.key, e.target.checked)
                    }
                    disabled={saving}
                  />
                  <span className="bridge-switch-slider" />
                </label>
              </div>
            ))}

            {/* 自动启动 */}
            <div className="bridge-channel-divider">
              <div className="bridge-channel-switch-row">
                <div className="bridge-channel-switch-info">
                  <div>
                    <p className="bridge-channel-switch-label">
                      {t("bridge.autoStart")}
                    </p>
                    <p className="bridge-channel-switch-desc">
                      {t("bridge.autoStartDesc")}
                    </p>
                  </div>
                </div>
                <label className="bridge-switch">
                  <input
                    type="checkbox"
                    checked={autoStart}
                    onChange={(e) =>
                      handleToggleAutoStart(e.target.checked)
                    }
                    disabled={saving}
                  />
                  <span className="bridge-switch-slider" />
                </label>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 适配器状态 */}
      {isEnabled && isRunning && adapterCount > 0 && (
        <div className="bridge-card">
          <div className="bridge-card-header">
            <h3>{t("bridge.adapters")}</h3>
            <p className="bridge-card-desc">{t("bridge.adaptersDesc")}</p>
          </div>
          <div className="bridge-adapter-list">
            {bridgeStatus?.adapters.map((adapter) => (
              <div key={adapter.channelType} className="bridge-adapter-item">
                <div className="bridge-adapter-header">
                  <span className="bridge-adapter-name">
                    {t(
                      `bridge.${adapter.channelType}Channel` as Parameters<
                        typeof t
                      >[0],
                    )}
                  </span>
                  <span
                    className={`bridge-adapter-badge ${adapter.running ? "bridge-adapter-badge--running" : ""}`}
                  >
                    {adapter.running
                      ? t("bridge.adapterRunning")
                      : t("bridge.adapterStopped")}
                  </span>
                </div>
                {adapter.lastMessageAt && (
                  <p className="bridge-adapter-detail">
                    {t("bridge.adapterLastMessage")}:{" "}
                    {new Date(adapter.lastMessageAt).toLocaleString()}
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

      {/* 默认配置 */}
      {isEnabled && (
        <div className="bridge-card">
          <div className="bridge-card-header">
            <h3>{t("bridge.defaults")}</h3>
            <p className="bridge-card-desc">{t("bridge.defaultsDesc")}</p>
            <p className="bridge-field-hint" style={{ marginBottom: "var(--space-3)" }}>
              {t("bridge.defaultsAutoCreateHint")}
            </p>
          </div>
          <div className="bridge-fields">
            <div className="bridge-field">
              <label>{t("bridge.defaultWorkDir")}</label>
              <select
                className="bridge-select"
                value={workDir}
                onChange={(e) => setWorkDir(e.target.value)}
              >
                <option value="">{t("bridge.defaultWorkDirHint")}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.path}>
                    {p.name || p.path}
                  </option>
                ))}
              </select>
            </div>
            <div className="bridge-field">
              <label>{t("bridge.defaultModel")}</label>
              {availableProviders.length > 0 ? (
                <select
                  className="bridge-select"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                >
                  <option value="">{t("bridge.defaultModelHint")}</option>
                  {availableProviders.map((provider: ProviderInfo) => (
                    <optgroup
                      key={provider.name}
                      label={provider.displayName}
                    >
                      {provider.models?.map((m) => (
                        <option
                          key={`${provider.name}::${m.id}`}
                          value={`${provider.name}::${m.id}`}
                        >
                          {m.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              ) : (
                <input
                  className="bridge-input"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="sonnet"
                />
              )}
              <p className="bridge-field-hint">
                {t("bridge.defaultModelHint")}
              </p>
            </div>
          </div>
          <div className="bridge-actions">
            <button
              type="button"
              className="bridge-button bridge-button--sm"
              disabled={saving}
              onClick={handleSaveDefaults}
            >
              {saving ? t("providersSaving") : t("providersSave")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
