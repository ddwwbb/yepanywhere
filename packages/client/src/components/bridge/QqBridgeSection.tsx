import { useState, useCallback, useEffect } from "react";
import { api } from "../../api/client";
import { useI18n } from "../../i18n";

interface QqBot {
  id: string;
  name?: string;
  enabled?: boolean;
  appId?: string;
  appSecret?: string;
  openId?: string;
  boundSessionId?: string;
}

export function QqBridgeSection() {
  const { t } = useI18n();
  const [bots, setBots] = useState<QqBot[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Partial<QqBot>>>({});
  const [isSaving, setIsSaving] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<string | null>(null);

  // ── Allowed users ──
  const [allowedUsers, setAllowedUsers] = useState("");
  const [savingUsers, setSavingUsers] = useState(false);

  // ── Image settings ──
  const [imageInputEnabled, setImageInputEnabled] = useState(true);
  const [maxImageSizeMb, setMaxImageSizeMb] = useState(20);
  const [savingImage, setSavingImage] = useState(false);

  // ── Per-bot verify state ──
  const [verifying, setVerifying] = useState<Record<string, boolean>>({});
  const [verifyResults, setVerifyResults] = useState<
    Record<string, { ok: boolean; message: string }>
  >({});

  // ── Fetch ──
  const fetchSettings = useCallback(async () => {
    try {
      const response = await api.getServerSettings();
      const rc = response.settings.remoteChannels;
      const qq = rc?.qq;
      setEnabled(qq?.enabled ?? false);
      setBots(qq?.bots ?? []);
      setAllowedUsers(qq?.allowedUsers ?? "");
      setImageInputEnabled(qq?.imageInputEnabled ?? true);
      setMaxImageSizeMb(qq?.maxImageSizeMb ?? 20);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // ── Draft helpers ──
  const getDraft = (bot: QqBot): QqBot => ({ ...bot, ...drafts[bot.id] });
  const hasChanges = (bot: QqBot): boolean => {
    const d = drafts[bot.id];
    if (!d) return false;
    return (
      (d.name !== undefined && d.name !== bot.name) ||
      (d.appId !== undefined && d.appId !== bot.appId) ||
      (d.appSecret !== undefined && d.appSecret !== bot.appSecret) ||
      (d.openId !== undefined && d.openId !== bot.openId)
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
      const qq = rc.qq ?? {};
      await api.updateServerSettings({
        remoteChannels: {
          ...rc,
          qq: { ...qq, enabled: !enabled, bots: qq.bots ?? [] },
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
      const qq = rc.qq ?? { enabled };
      const updatedBots = (qq.bots ?? []).map((b: QqBot) =>
        b.id === botId ? { ...b, ...draft } : b,
      );
      await api.updateServerSettings({
        remoteChannels: { ...rc, qq: { ...qq, bots: updatedBots } },
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
    const newBot: QqBot = { id: `qq_${Date.now()}`, enabled: true };
    try {
      const response = await api.getServerSettings();
      const rc = response.settings.remoteChannels ?? {};
      const qq = rc.qq ?? { enabled };
      await api.updateServerSettings({
        remoteChannels: {
          ...rc,
          qq: { ...qq, bots: [...(qq.bots ?? []), newBot] },
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
      const qq = rc.qq ?? { enabled };
      await api.updateServerSettings({
        remoteChannels: {
          ...rc,
          qq: {
            ...qq,
            bots: (qq.bots ?? []).filter((b: QqBot) => b.id !== botId),
          },
        },
      });
      await fetchSettings();
    } catch {
      // ignore
    }
  };

  // ── Verify bot ──
  const handleVerify = async (bot: QqBot) => {
    const d = getDraft(bot);
    setVerifying((prev) => ({ ...prev, [bot.id]: true }));
    setVerifyResults((prev) => {
      const next = { ...prev };
      delete next[bot.id];
      return next;
    });
    try {
      if (!d.appId) {
        setVerifyResults((prev) => ({
          ...prev,
          [bot.id]: {
            ok: false,
            message: t("qq.enterCredentialsFirst"),
          },
        }));
        return;
      }
      const result = await api.verifyQqRemoteChannel({
        appId: d.appId?.trim() || undefined,
        appSecret: d.appSecret?.trim() || undefined,
      });
      setVerifyResults((prev) => ({
        ...prev,
        [bot.id]: {
          ok: result.verified,
          message: result.verified
            ? t("qq.verified")
            : result.error || t("qq.verifyFailed"),
        },
      }));
    } catch (err) {
      setVerifyResults((prev) => ({
        ...prev,
        [bot.id]: {
          ok: false,
          message: err instanceof Error ? err.message : t("qq.verifyFailed"),
        },
      }));
    } finally {
      setVerifying((prev) => ({ ...prev, [bot.id]: false }));
    }
  };

  // ── Save allowed users ──
  const handleSaveAllowedUsers = async () => {
    setSavingUsers(true);
    setStatus(null);
    try {
      const response = await api.getServerSettings();
      const rc = response.settings.remoteChannels ?? {};
      const qq = rc.qq ?? {};
      await api.updateServerSettings({
        remoteChannels: { ...rc, qq: { ...qq, allowedUsers } },
      });
      setStatus(t("remoteChannelsSaved"));
      await fetchSettings();
    } catch (err) {
      setStatus(
        err instanceof Error ? err.message : t("remoteChannelsSaveFailed"),
      );
    } finally {
      setSavingUsers(false);
    }
  };

  // ── Save image settings ──
  const handleSaveImageSettings = async () => {
    setSavingImage(true);
    setStatus(null);
    try {
      const response = await api.getServerSettings();
      const rc = response.settings.remoteChannels ?? {};
      const qq = rc.qq ?? {};
      await api.updateServerSettings({
        remoteChannels: {
          ...rc,
          qq: { ...qq, imageInputEnabled, maxImageSizeMb },
        },
      });
      setStatus(t("remoteChannelsSaved"));
      await fetchSettings();
    } catch (err) {
      setStatus(
        err instanceof Error ? err.message : t("remoteChannelsSaveFailed"),
      );
    } finally {
      setSavingImage(false);
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
            <strong>{t("remoteChannelsQqEnableTitle")}</strong>
            <p>{t("remoteChannelsQqEnableDescription")}</p>
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
                <h3>{bot.name || `Bot ${bot.id.slice(-6)}`}</h3>
                <button
                  type="button"
                  className="bridge-button bridge-button--danger-sm"
                  onClick={() => void handleRemoveBot(bot.id)}
                >
                  {t("remoteChannelsRemoveBot")}
                </button>
              </div>
              <p className="bridge-card-desc">{t("qq.credentialsDesc")}</p>
              {bot.boundSessionId && (
                <p className="bridge-field-hint" style={{ marginBottom: "var(--space-2)" }}>
                  {t("bridge.boundSession")}: {bot.boundSessionId.slice(0, 8)}...
                </p>
              )}
              <div className="bridge-fields">
                <div className="bridge-field">
                  <label>{t("bridge.botName")}</label>
                  <input
                    className="bridge-input"
                    value={d.name ?? ""}
                    placeholder="My QQ Bot"
                    onChange={(e) => updateDraft(bot.id, "name", e.target.value)}
                  />
                </div>
                <div className="bridge-field">
                  <label>{t("qq.appId")}</label>
                  <input
                    className="bridge-input"
                    value={d.appId ?? ""}
                    placeholder="1024..."
                    onChange={(e) => updateDraft(bot.id, "appId", e.target.value)}
                  />
                </div>
                <div className="bridge-field">
                  <label>{t("qq.appSecret")}</label>
                  <input
                    className="bridge-input"
                    type="password"
                    value={d.appSecret ?? ""}
                    placeholder="xxxxxxxxxxxxxxxx"
                    onChange={(e) =>
                      updateDraft(bot.id, "appSecret", e.target.value)
                    }
                  />
                </div>
                <div className="bridge-field">
                  <label>{t("qq.openId")}</label>
                  <input
                    className="bridge-input"
                    value={d.openId ?? ""}
                    placeholder="OpenID"
                    onChange={(e) =>
                      updateDraft(bot.id, "openId", e.target.value)
                    }
                  />
                  <p className="bridge-field-hint">{t("qq.openIdHint")}</p>
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
                <button
                  type="button"
                  className="bridge-button bridge-button--outline bridge-button--sm"
                  disabled={verifying[bot.id] || !d.appId}
                  onClick={() => void handleVerify(bot)}
                >
                  {verifying[bot.id]
                    ? t("remoteChannelsVerifying")
                    : t("qq.verify")}
                </button>
              </div>
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
            {t("remoteChannelsAddQqBot")}
          </button>
        </div>
      )}

      {/* ── 允许的用户 ── */}
      {enabled && (
        <div className="bridge-card">
          <div className="bridge-card-header">
            <h3>{t("qq.allowedUsers")}</h3>
            <p className="bridge-card-desc">
              {t("qq.allowedUsersDesc")}
            </p>
          </div>
          <div className="bridge-fields">
            <div className="bridge-field">
              <input
                className="bridge-input"
                value={allowedUsers}
                placeholder="user_openid_1, user_openid_2"
                onChange={(e) => setAllowedUsers(e.target.value)}
              />
              <p className="bridge-field-hint">
                {t("qq.allowedUsersHint")}
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

      {/* ── 图片设置 ── */}
      {enabled && (
        <div className="bridge-card">
          <div className="bridge-card-header">
            <h3>{t("qq.imageSettings")}</h3>
            <p className="bridge-card-desc">
              {t("qq.imageSettingsDesc")}
            </p>
          </div>
          <div className="bridge-fields">
            <div className="bridge-toggle-row">
              <div className="bridge-toggle-info">
                <strong>{t("qq.imageInputEnabled")}</strong>
                <p>{t("qq.imageInputEnabledDesc")}</p>
              </div>
              <label className="bridge-switch">
                <input
                  type="checkbox"
                  checked={imageInputEnabled}
                  onChange={(e) => setImageInputEnabled(e.target.checked)}
                />
                <span className="bridge-switch-slider" />
              </label>
            </div>
            <div className="bridge-field">
              <label>{t("qq.maxImageSizeMb")}</label>
              <input
                className="bridge-input"
                type="number"
                min={1}
                max={50}
                value={maxImageSizeMb}
                onChange={(e) =>
                  setMaxImageSizeMb(Number(e.target.value) || 20)
                }
              />
              <p className="bridge-field-hint">
                {t("qq.maxImageSizeMbHint")}
              </p>
            </div>
          </div>
          <div className="bridge-actions">
            <button
              type="button"
              className="bridge-button bridge-button--sm"
              disabled={savingImage}
              onClick={() => void handleSaveImageSettings()}
            >
              {savingImage ? t("providersSaving") : t("providersSave")}
            </button>
          </div>
        </div>
      )}

      {/* ── 设置指南 ── */}
      {enabled && (
        <div className="bridge-card">
          <div className="bridge-card-header">
            <h3>{t("qq.setupGuide")}</h3>
          </div>
          <ol className="bridge-guide-list">
            <li>{t("qq.step1")}</li>
            <li>{t("qq.step2")}</li>
            <li>{t("qq.step3")}</li>
            <li>{t("qq.step4")}</li>
            <li>{t("qq.step5")}</li>
          </ol>
        </div>
      )}

      {status && <p className="bridge-status-msg">{status}</p>}
    </div>
  );
}
