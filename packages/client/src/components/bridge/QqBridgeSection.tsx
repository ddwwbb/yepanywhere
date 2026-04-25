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
  const [drafts, setDrafts] = useState<Record<string, QqBot>>({});
  const [isSaving, setIsSaving] = useState<Record<string, boolean>>({});
  const [isVerifying, setIsVerifying] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    try {
      const response = await api.getServerSettings();
      const rc = response.settings.remoteChannels;
      const qq = rc?.qq;
      setEnabled(qq?.enabled ?? false);
      setBots(qq?.bots ?? []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  const getDraft = (bot: QqBot): QqBot => ({ ...bot, ...drafts[bot.id] });
  const hasChanges = (bot: QqBot): boolean => {
    const d = drafts[bot.id];
    if (!d) return false;
    return d.appId !== bot.appId || d.appSecret !== bot.appSecret || d.openId !== bot.openId;
  };

  const updateDraft = (botId: string, field: string, value: string) => {
    setDrafts((prev) => ({ ...prev, [botId]: { ...(prev[botId] ?? {} as QqBot), [field]: value } as QqBot }));
  };

  const handleToggleEnabled = async () => {
    const response = await api.getServerSettings();
    const rc = response.settings.remoteChannels ?? {};
    const qq = rc.qq ?? {};
    await api.updateServerSettings({
      remoteChannels: { ...rc, qq: { ...qq, enabled: !enabled, bots: qq.bots ?? [] } },
    });
    await fetchSettings();
  };

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
        b.id === botId ? { ...b, ...draft } : b
      );
      await api.updateServerSettings({
        remoteChannels: { ...rc, qq: { ...qq, bots: updatedBots } },
      });
      setDrafts((prev) => { const next = { ...prev }; delete next[botId]; return next; });
      setStatus(t("remoteChannelsSaved"));
      await fetchSettings();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : t("remoteChannelsSaveFailed"));
    } finally {
      setIsSaving((prev) => ({ ...prev, [botId]: false }));
    }
  };

  const handleAddBot = async () => {
    const newBot: QqBot = { id: `qq_${Date.now()}`, enabled: true };
    const response = await api.getServerSettings();
    const rc = response.settings.remoteChannels ?? {};
    const qq = rc.qq ?? { enabled };
    await api.updateServerSettings({
      remoteChannels: { ...rc, qq: { ...qq, bots: [...(qq.bots ?? []), newBot] } },
    });
    await fetchSettings();
  };

  const handleRemoveBot = async (botId: string) => {
    setDrafts((prev) => { const next = { ...prev }; delete next[botId]; return next; });
    const response = await api.getServerSettings();
    const rc = response.settings.remoteChannels ?? {};
    const qq = rc.qq ?? { enabled };
    await api.updateServerSettings({
      remoteChannels: { ...rc, qq: { ...qq, bots: (qq.bots ?? []).filter((b: QqBot) => b.id !== botId) } },
    });
    await fetchSettings();
  };

  const handleVerify = async (bot: QqBot) => {
    const d = getDraft(bot);
    setIsVerifying(true);
    setStatus(null);
    try {
      const result = await api.verifyQqRemoteChannel({
        appId: d.appId?.trim() || undefined,
        appSecret: d.appSecret?.trim() || undefined,
      });
      setStatus(result.verified ? t("remoteChannelsQqVerified") : result.error || t("remoteChannelsQqVerifyFailed"));
    } catch (err) {
      setStatus(err instanceof Error ? err.message : t("remoteChannelsQqVerifyFailed"));
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="bridge-section">
      <div className="bridge-card bridge-card--highlight">
        <div className="bridge-toggle-row">
          <div className="bridge-toggle-info">
            <strong>{t("remoteChannelsQqEnableTitle")}</strong>
            <p>{t("remoteChannelsQqEnableDescription")}</p>
          </div>
          <label className="bridge-switch">
            <input type="checkbox" checked={enabled} onChange={handleToggleEnabled} />
            <span className="bridge-switch-slider" />
          </label>
        </div>
      </div>

      {enabled && bots.map((bot) => {
        const d = getDraft(bot);
        return (
          <div key={bot.id} className="bridge-card">
            <div className="bridge-card-header bridge-card-header--between">
              <h3>{bot.name || `Bot ${bot.id.slice(-6)}`}</h3>
              <button type="button" className="bridge-button bridge-button--danger-sm" onClick={() => void handleRemoveBot(bot.id)}>
                {t("remoteChannelsRemoveBot")}
              </button>
            </div>
            <div className="bridge-fields">
              <div className="bridge-field">
                <label>{t("remoteChannelsQqAppIdTitle")}</label>
                <input className="bridge-input" value={d.appId ?? ""} onChange={(e) => updateDraft(bot.id, "appId", e.target.value)} />
              </div>
              <div className="bridge-field">
                <label>{t("remoteChannelsQqAppSecretTitle")}</label>
                <input className="bridge-input" type="password" value={d.appSecret ?? ""} onChange={(e) => updateDraft(bot.id, "appSecret", e.target.value)} />
              </div>
              <div className="bridge-field">
                <label>{t("remoteChannelsQqOpenIdTitle")}</label>
                <input className="bridge-input" value={d.openId ?? ""} onChange={(e) => updateDraft(bot.id, "openId", e.target.value)} />
              </div>
            </div>
            <div className="bridge-actions">
              <button type="button" className="bridge-button bridge-button--outline bridge-button--sm" disabled={isVerifying} onClick={() => void handleVerify(bot)}>
                {isVerifying ? t("remoteChannelsVerifying") : t("remoteChannelsVerify")}
              </button>
              <button type="button" className="bridge-button bridge-button--sm" disabled={isSaving[bot.id] || !hasChanges(bot)} onClick={() => void handleSave(bot.id)}>
                {isSaving[bot.id] ? t("providersSaving") : t("providersSave")}
              </button>
            </div>
          </div>
        );
      })}

      {enabled && (
        <div className="bridge-actions">
          <button type="button" className="bridge-button bridge-button--outline" onClick={() => void handleAddBot()}>
            {t("remoteChannelsAddQqBot")}
          </button>
        </div>
      )}

      {status && <p className="bridge-status-msg">{status}</p>}
    </div>
  );
}
