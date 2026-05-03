import { useState, useCallback, useEffect, useRef } from "react";
import { api } from "../../api/client";
import { useI18n } from "../../i18n";

interface WeixinBot {
  id: string;
  name?: string;
  enabled?: boolean;
  accountId?: string;
  peerUserId?: string;
  boundSessionId?: string;
}

export function WeixinBridgeSection() {
  const { t } = useI18n();
  const [bots, setBots] = useState<WeixinBot[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Partial<WeixinBot>>>({});
  const [isSaving, setIsSaving] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ── Per-bot login state ──
  const [isStartingLogin, setIsStartingLogin] = useState(false);
  const [qrImageForBot, setQrImageForBot] = useState<Record<string, string>>(
    {},
  );

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // ── Fetch ──
  const fetchSettings = useCallback(async () => {
    try {
      const response = await api.getServerSettings();
      const rc = response.settings.remoteChannels;
      const weixin = rc?.weixin;
      setEnabled(weixin?.enabled ?? false);
      setBots(weixin?.bots ?? []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // ── Draft helpers ──
  const getDraft = (bot: WeixinBot): WeixinBot => ({
    ...bot,
    ...drafts[bot.id],
  });
  const hasChanges = (bot: WeixinBot): boolean => {
    const d = drafts[bot.id];
    if (!d) return false;
    return (
      (d.name !== undefined && d.name !== bot.name) ||
      (d.accountId !== undefined && d.accountId !== bot.accountId) ||
      (d.peerUserId !== undefined && d.peerUserId !== bot.peerUserId)
    );
  };

  const updateDraft = (botId: string, field: string, value: string) => {
    setDrafts((prev) => ({
      ...prev,
      [botId]: { ...(prev[botId] ?? {}), [field]: value },
    }));
  };

  // ── Toggle channel enabled ──
  const handleToggleEnabled = async () => {
    try {
      const response = await api.getServerSettings();
      const rc = response.settings.remoteChannels ?? {};
      const weixin = rc.weixin ?? {};
      await api.updateServerSettings({
        remoteChannels: {
          ...rc,
          weixin: { ...weixin, enabled: !enabled, bots: weixin.bots ?? [] },
        },
      });
      await fetchSettings();
    } catch {
      // ignore
    }
  };

  // ── Save bot ──
  const handleSave = async (botId: string) => {
    const draft = drafts[botId];
    if (!draft) return;
    setIsSaving((prev) => ({ ...prev, [botId]: true }));
    setStatus(null);
    try {
      const response = await api.getServerSettings();
      const rc = response.settings.remoteChannels ?? {};
      const weixin = rc.weixin ?? { enabled };
      const updatedBots = (weixin.bots ?? []).map((b: WeixinBot) =>
        b.id === botId ? { ...b, ...draft } : b,
      );
      await api.updateServerSettings({
        remoteChannels: {
          ...rc,
          weixin: { ...weixin, bots: updatedBots },
        },
      });
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[botId];
        return next;
      });
      setStatus(t("remoteChannelsSaved"));
      await fetchSettings();
    } catch (err) {
      setStatus(
        err instanceof Error ? err.message : t("remoteChannelsSaveFailed"),
      );
    } finally {
      setIsSaving((prev) => ({ ...prev, [botId]: false }));
    }
  };

  // ── Add bot ──
  const handleAddBot = async () => {
    const newBot: WeixinBot = { id: `weixin_${Date.now()}`, enabled: true };
    try {
      const response = await api.getServerSettings();
      const rc = response.settings.remoteChannels ?? {};
      const weixin = rc.weixin ?? { enabled };
      await api.updateServerSettings({
        remoteChannels: {
          ...rc,
          weixin: {
            ...weixin,
            bots: [...(weixin.bots ?? []), newBot],
          },
        },
      });
      await fetchSettings();
    } catch {
      // ignore
    }
  };

  // ── Remove bot ──
  const handleRemoveBot = async (botId: string) => {
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[botId];
      return next;
    });
    setQrImageForBot((prev) => {
      const next = { ...prev };
      delete next[botId];
      return next;
    });
    try {
      const response = await api.getServerSettings();
      const rc = response.settings.remoteChannels ?? {};
      const weixin = rc.weixin ?? { enabled };
      await api.updateServerSettings({
        remoteChannels: {
          ...rc,
          weixin: {
            ...weixin,
            bots: (weixin.bots ?? []).filter(
              (b: WeixinBot) => b.id !== botId,
            ),
          },
        },
      });
      await fetchSettings();
    } catch {
      // ignore
    }
  };

  // ── QR Login ──
  const handleStartLogin = async (botId: string) => {
    setIsStartingLogin(true);
    setStatus(null);
    setQrImageForBot((prev) => {
      const next = { ...prev };
      delete next[botId];
      return next;
    });
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const started = await api.startWeixinRemoteChannelLogin();
      setQrImageForBot((prev) => ({ ...prev, [botId]: started.qrImage }));
      for (;;) {
        if (ac.signal.aborted) return;
        const result = await api.waitWeixinRemoteChannelLogin(
          started.sessionId,
        );
        if (result.status === "waiting" || result.status === "scanned") {
          setStatus(
            result.status === "scanned"
              ? t("remoteChannelsWeixinScanned")
              : t("remoteChannelsWeixinWaiting"),
          );
          continue;
        }
        if (result.status === "confirmed") {
          updateDraft(botId, "accountId", result.accountId ?? "");
          updateDraft(botId, "peerUserId", result.peerUserId ?? "");
          setStatus(t("remoteChannelsWeixinLoginConfirmed"));
        } else {
          setStatus(
            result.error || t("remoteChannelsWeixinLoginFailed"),
          );
        }
        break;
      }
    } catch (err) {
      if (ac.signal.aborted) return;
      setStatus(
        err instanceof Error ? err.message : t("remoteChannelsWeixinLoginFailed"),
      );
    } finally {
      setIsStartingLogin(false);
    }
  };

  // ── Status Banner ──
  const StatusBanner = ({
    variant,
    message,
  }: {
    variant: string;
    message: string;
  }) => (
    <div className={`bridge-status-banner bridge-status-banner--${variant}`}>
      {message}
    </div>
  );

  return (
    <div className="bridge-section">
      {/* ── 启用开关 ── */}
      <div className="bridge-card bridge-card--highlight">
        <div className="bridge-toggle-row">
          <div className="bridge-toggle-info">
            <strong>{t("remoteChannelsWeixinEnableTitle")}</strong>
            <p>{t("remoteChannelsWeixinEnableDescription")}</p>
          </div>
          <label className="bridge-switch">
            <input
              type="checkbox"
              checked={enabled}
              onChange={() => void handleToggleEnabled()}
            />
            <span className="bridge-switch-slider" />
          </label>
        </div>
      </div>

      {/* ── 多 Bot 凭据卡片 ── */}
      {enabled &&
        bots.map((bot) => {
          const d = getDraft(bot);
          return (
            <div key={bot.id} className="bridge-card">
              <div className="bridge-card-header bridge-card-header--between">
                <h3>{bot.name || `Bot ${bot.id.slice(-6)}`}</h3>
                <button
                  type="button"
                  className="bridge-button bridge-button--danger-sm"
                  onClick={() => void handleRemoveBot(bot.id)}
                >
                  {t("remoteChannelsRemoveBot")}
                </button>
              </div>
              <p className="bridge-card-desc">
                {t("weixin.credentialsDesc")}
              </p>
              {bot.boundSessionId && (
                <p className="bridge-field-hint" style={{ marginBottom: "var(--space-2)" }}>
                  {t("bridge.boundSession")}: {bot.boundSessionId.slice(0, 8)}...
                </p>
              )}
              <div className="bridge-fields">
                {/* Bot Name */}
                <div className="bridge-field">
                  <label>{t("bridge.botName")}</label>
                  <input
                    className="bridge-input"
                    value={d.name ?? ""}
                    placeholder="My WeChat Bot"
                    onChange={(e) =>
                      updateDraft(bot.id, "name", e.target.value)
                    }
                  />
                </div>
                {/* 扫码登录 */}
                <div className="bridge-field">
                  <label>{t("weixin.accountId")}</label>
                  <div className="bridge-field-row">
                    <input
                      className="bridge-input bridge-field--flex"
                      value={d.accountId ?? ""}
                      placeholder={t("weixin.accountIdPlaceholder")}
                      onChange={(e) =>
                        updateDraft(bot.id, "accountId", e.target.value)
                      }
                    />
                    <button
                      type="button"
                      className="bridge-button bridge-button--outline bridge-button--sm"
                      disabled={isStartingLogin}
                      onClick={() => void handleStartLogin(bot.id)}
                    >
                      {isStartingLogin
                        ? t("remoteChannelsWeixinWaiting")
                        : t("weixin.scanLogin")}
                    </button>
                  </div>
                </div>

                {/* QR 图片 */}
                {qrImageForBot[bot.id] && (
                  <div className="bridge-qr-container">
                    <img
                      alt={t("remoteChannelsWeixinQrAlt")}
                      src={qrImageForBot[bot.id]}
                      className="bridge-qr-image"
                    />
                    <p className="bridge-field-hint">
                      {t("weixin.qrHint")}
                    </p>
                  </div>
                )}

                {/* 对方用户 ID */}
                <div className="bridge-field">
                  <label>{t("weixin.peerUserId")}</label>
                  <input
                    className="bridge-input"
                    value={d.peerUserId ?? ""}
                    placeholder="wxid_..."
                    onChange={(e) =>
                      updateDraft(bot.id, "peerUserId", e.target.value)
                    }
                  />
                  <p className="bridge-field-hint">
                    {t("weixin.peerUserIdHint")}
                  </p>
                </div>
              </div>
              <div className="bridge-actions">
                <button
                  type="button"
                  className="bridge-button bridge-button--sm"
                  disabled={isSaving[bot.id] || !hasChanges(bot)}
                  onClick={() => void handleSave(bot.id)}
                >
                  {isSaving[bot.id]
                    ? t("providersSaving")
                    : t("providersSave")}
                </button>
              </div>
            </div>
          );
        })}

      {/* ── 添加 Bot ── */}
      {enabled && (
        <div className="bridge-actions">
          <button
            type="button"
            className="bridge-button bridge-button--outline"
            onClick={() => void handleAddBot()}
          >
            {t("remoteChannelsAddWeixinBot")}
          </button>
        </div>
      )}

      {/* ── 设置指南 ── */}
      {enabled && (
        <div className="bridge-card">
          <div className="bridge-card-header">
            <h3>{t("weixin.setupGuide")}</h3>
          </div>
          <ol className="bridge-guide-list">
            <li>{t("weixin.step1")}</li>
            <li>{t("weixin.step2")}</li>
            <li>{t("weixin.step3")}</li>
            <li>{t("weixin.step4")}</li>
          </ol>
        </div>
      )}

      {status && <p className="bridge-status-msg">{status}</p>}
    </div>
  );
}
