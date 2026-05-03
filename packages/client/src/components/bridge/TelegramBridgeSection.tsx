import { useState, useCallback, useEffect } from "react";
import { api } from "../../api/client";
import { useI18n } from "../../i18n";

interface TelegramBot {
  id: string;
  name?: string;
  enabled?: boolean;
  botToken?: string;
  chatId?: string;
  proxyUrl?: string;
  boundSessionId?: string;
}

export function TelegramBridgeSection() {
  const { t } = useI18n();
  const [bots, setBots] = useState<TelegramBot[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [allowedUsers, setAllowedUsers] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Partial<TelegramBot>>>({});
  const [isSaving, setIsSaving] = useState<Record<string, boolean>>({});
  const [savingUsers, setSavingUsers] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  // ── Per-bot verify state ──
  const [verifying, setVerifying] = useState<Record<string, boolean>>({});
  const [detecting, setDetecting] = useState<Record<string, boolean>>({});
  const [verifyResults, setVerifyResults] = useState<
    Record<string, { ok: boolean; message: string }>
  >({});

  // ── Fetch ──
  const fetchSettings = useCallback(async () => {
    try {
      const response = await api.getServerSettings();
      const rc = response.settings.remoteChannels;
      const telegram = rc?.telegram;
      setEnabled(telegram?.enabled ?? false);
      setBots(telegram?.bots ?? []);
      setAllowedUsers(telegram?.allowedUsers ?? "");
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // ── Draft helpers ──
  const getDraft = (bot: TelegramBot): TelegramBot => ({
    ...bot,
    ...drafts[bot.id],
  });
  const hasChanges = (bot: TelegramBot): boolean => {
    const d = drafts[bot.id];
    if (!d) return false;
    return (
      (d.name !== undefined && d.name !== bot.name) ||
      (d.botToken !== undefined && d.botToken !== bot.botToken) ||
      (d.chatId !== undefined && d.chatId !== bot.chatId) ||
      (d.proxyUrl !== undefined && d.proxyUrl !== bot.proxyUrl)
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
      const telegram = rc.telegram ?? {};
      await api.updateServerSettings({
        remoteChannels: {
          ...rc,
          telegram: {
            ...telegram,
            enabled: !enabled,
            bots: telegram.bots ?? [],
          },
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
      const telegram = rc.telegram ?? { enabled };
      const updatedBots = (telegram.bots ?? []).map((b: TelegramBot) =>
        b.id === botId ? { ...b, ...draft } : b,
      );
      await api.updateServerSettings({
        remoteChannels: { ...rc, telegram: { ...telegram, bots: updatedBots } },
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
    const newBot: TelegramBot = { id: `telegram_${Date.now()}`, enabled: true };
    try {
      const response = await api.getServerSettings();
      const rc = response.settings.remoteChannels ?? {};
      const telegram = rc.telegram ?? { enabled };
      await api.updateServerSettings({
        remoteChannels: {
          ...rc,
          telegram: {
            ...telegram,
            bots: [...(telegram.bots ?? []), newBot],
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
    try {
      const response = await api.getServerSettings();
      const rc = response.settings.remoteChannels ?? {};
      const telegram = rc.telegram ?? { enabled };
      await api.updateServerSettings({
        remoteChannels: {
          ...rc,
          telegram: {
            ...telegram,
            bots: (telegram.bots ?? []).filter(
              (b: TelegramBot) => b.id !== botId,
            ),
          },
        },
      });
      await fetchSettings();
    } catch {
      // ignore
    }
  };

  // ── Verify bot ──
  const handleVerify = async (bot: TelegramBot) => {
    const d = getDraft(bot);
    setVerifying((prev) => ({ ...prev, [bot.id]: true }));
    setVerifyResults((prev) => {
      const next = { ...prev };
      delete next[bot.id];
      return next;
    });
    try {
      if (!d.botToken) {
        setVerifyResults((prev) => ({
          ...prev,
          [bot.id]: {
            ok: false,
            message: t("telegram.enterTokenFirst"),
          },
        }));
        return;
      }
      const result = await api.verifyTelegramRemoteChannel({
        action: "verify",
        botToken: d.botToken?.trim() || undefined,
        chatId: d.chatId?.trim() || undefined,
        proxyUrl: d.proxyUrl?.trim() || undefined,
      });
      if (result.verified) {
        setVerifyResults((prev) => ({
          ...prev,
          [bot.id]: {
            ok: true,
            message: result.botName
              ? t("telegram.verifiedAs", { name: result.botName })
              : t("telegram.verified"),
          },
        }));
      } else {
        setVerifyResults((prev) => ({
          ...prev,
          [bot.id]: {
            ok: false,
            message: result.error || t("telegram.verifyFailed"),
          },
        }));
      }
    } catch (err) {
      setVerifyResults((prev) => ({
        ...prev,
        [bot.id]: {
          ok: false,
          message:
            err instanceof Error ? err.message : t("telegram.verifyFailed"),
        },
      }));
    } finally {
      setVerifying((prev) => ({ ...prev, [bot.id]: false }));
    }
  };

  // ── Detect Chat ID ──
  const handleDetectChatId = async (bot: TelegramBot) => {
    const d = getDraft(bot);
    setDetecting((prev) => ({ ...prev, [bot.id]: true }));
    setVerifyResults((prev) => {
      const next = { ...prev };
      delete next[bot.id];
      return next;
    });
    try {
      if (!d.botToken) {
        setVerifyResults((prev) => ({
          ...prev,
          [bot.id]: {
            ok: false,
            message: t("telegram.enterTokenFirst"),
          },
        }));
        return;
      }
      const result = await api.verifyTelegramRemoteChannel({
        action: "detect_chat_id",
        botToken: d.botToken?.trim() || undefined,
        proxyUrl: d.proxyUrl?.trim() || undefined,
      });
      if (result.detected && result.chatId) {
        updateDraft(bot.id, "chatId", result.chatId);
        setVerifyResults((prev) => ({
          ...prev,
          [bot.id]: {
            ok: true,
            message: t("telegram.chatIdDetected"),
          },
        }));
      } else {
        setVerifyResults((prev) => ({
          ...prev,
          [bot.id]: {
            ok: false,
            message: result.error || t("telegram.chatIdDetectFailed"),
          },
        }));
      }
    } catch {
      setVerifyResults((prev) => ({
        ...prev,
        [bot.id]: {
          ok: false,
          message: t("telegram.chatIdDetectFailed"),
        },
      }));
    } finally {
      setDetecting((prev) => ({ ...prev, [bot.id]: false }));
    }
  };

  // ── Save allowed users ──
  const handleSaveAllowedUsers = async () => {
    setSavingUsers(true);
    try {
      const response = await api.getServerSettings();
      const rc = response.settings.remoteChannels ?? {};
      const telegram = rc.telegram ?? {};
      await api.updateServerSettings({
        remoteChannels: {
          ...rc,
          telegram: { ...telegram, allowedUsers },
        },
      });
    } catch {
      // ignore
    } finally {
      setSavingUsers(false);
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
            <strong>{t("remoteChannelsTelegramEnableTitle")}</strong>
            <p>{t("remoteChannelsTelegramEnableDescription")}</p>
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
          const vResult = verifyResults[bot.id];
          return (
            <div key={bot.id} className="bridge-card">
              <div className="bridge-card-header bridge-card-header--between">
                <h3>
                  {bot.name || `Bot ${bot.id.slice(-6)}`}
                </h3>
                <button
                  type="button"
                  className="bridge-button bridge-button--danger-sm"
                  onClick={() => void handleRemoveBot(bot.id)}
                >
                  {t("remoteChannelsRemoveBot")}
                </button>
              </div>
              <p className="bridge-card-desc">
                {t("telegram.credentialsDesc")}
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
                    placeholder="My Telegram Bot"
                    onChange={(e) =>
                      updateDraft(bot.id, "name", e.target.value)
                    }
                  />
                </div>
                {/* Bot Token */}
                <div className="bridge-field">
                  <label>{t("telegram.botToken")}</label>
                  <input
                    className="bridge-input"
                    type="password"
                    value={d.botToken ?? ""}
                    placeholder="123456:ABC-DEF..."
                    onChange={(e) =>
                      updateDraft(bot.id, "botToken", e.target.value)
                    }
                  />
                </div>

                {/* Chat ID + 自动检测 */}
                <div className="bridge-field">
                  <label>{t("telegram.chatId")}</label>
                  <div className="bridge-field-row">
                    <input
                      className="bridge-input bridge-field--flex"
                      value={d.chatId ?? ""}
                      placeholder="-1001234567890"
                      onChange={(e) =>
                        updateDraft(bot.id, "chatId", e.target.value)
                      }
                    />
                    <button
                      type="button"
                      className="bridge-button bridge-button--outline bridge-button--sm"
                      disabled={detecting[bot.id] || !d.botToken}
                      onClick={() => void handleDetectChatId(bot)}
                    >
                      {detecting[bot.id]
                        ? t("remoteChannelsVerifying")
                        : t("telegram.detectChatId")}
                    </button>
                  </div>
                  <p className="bridge-field-hint">
                    {t("telegram.chatIdHint")}
                  </p>
                </div>

                {/* Proxy URL */}
                <div className="bridge-field">
                  <label>{t("remoteChannelsTelegramProxyTitle")}</label>
                  <input
                    className="bridge-input"
                    value={d.proxyUrl ?? ""}
                    placeholder="socks5://user:pass@127.0.0.1:1080"
                    onChange={(e) =>
                      updateDraft(bot.id, "proxyUrl", e.target.value)
                    }
                  />
                </div>
              </div>

              {/* 操作按钮 */}
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
                <button
                  type="button"
                  className="bridge-button bridge-button--outline bridge-button--sm"
                  disabled={verifying[bot.id] || !d.botToken}
                  onClick={() => void handleVerify(bot)}
                >
                  {verifying[bot.id]
                    ? t("remoteChannelsVerifying")
                    : t("telegram.verify")}
                </button>
              </div>

              {/* 验证结果 */}
              {vResult && (
                <StatusBanner
                  variant={vResult.ok ? "success" : "error"}
                  message={vResult.message}
                />
              )}
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
            {t("remoteChannelsAddTelegramBot")}
          </button>
        </div>
      )}

      {/* ── 允许的用户 ── */}
      {enabled && (
        <div className="bridge-card">
          <div className="bridge-card-header">
            <h3>{t("telegram.allowedUsers")}</h3>
            <p className="bridge-card-desc">
              {t("telegram.allowedUsersDesc")}
            </p>
          </div>
          <div className="bridge-fields">
            <div className="bridge-field">
              <input
                className="bridge-input"
                value={allowedUsers}
                placeholder="123456789, 987654321"
                onChange={(e) => setAllowedUsers(e.target.value)}
              />
              <p className="bridge-field-hint">
                {t("telegram.allowedUsersHint")}
              </p>
            </div>
          </div>
          <div className="bridge-actions">
            <button
              type="button"
              className="bridge-button bridge-button--sm"
              disabled={savingUsers}
              onClick={() => void handleSaveAllowedUsers()}
            >
              {savingUsers ? t("providersSaving") : t("providersSave")}
            </button>
          </div>
        </div>
      )}

      {/* ── 设置指南 ── */}
      {enabled && (
        <div className="bridge-card">
          <div className="bridge-card-header">
            <h3>{t("telegram.setupGuide")}</h3>
          </div>
          <ol className="bridge-guide-list">
            <li>{t("telegram.step1")}</li>
            <li>{t("telegram.step2")}</li>
            <li>{t("telegram.step3")}</li>
            <li>{t("telegram.step4")}</li>
            <li>{t("telegram.step5")}</li>
            <li>{t("telegram.step6")}</li>
          </ol>
        </div>
      )}

      {status && <p className="bridge-status-msg">{status}</p>}
    </div>
  );
}
