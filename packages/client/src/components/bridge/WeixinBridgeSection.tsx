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
  const [drafts, setDrafts] = useState<Record<string, WeixinBot>>({});
  const [isSaving, setIsSaving] = useState<Record<string, boolean>>({});
  const [isStartingLogin, setIsStartingLogin] = useState(false);
  const [qrImageForBot, setQrImageForBot] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

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

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  const getDraft = (bot: WeixinBot): WeixinBot => ({ ...bot, ...drafts[bot.id] });
  const hasChanges = (bot: WeixinBot): boolean => {
    const d = drafts[bot.id];
    if (!d) return false;
    return d.accountId !== bot.accountId || d.peerUserId !== bot.peerUserId;
  };

  const updateDraft = (botId: string, field: string, value: string) => {
    setDrafts((prev) => ({ ...prev, [botId]: { ...(prev[botId] ?? {} as WeixinBot), [field]: value } as WeixinBot }));
  };

  const handleToggleEnabled = async () => {
    const response = await api.getServerSettings();
    const rc = response.settings.remoteChannels ?? {};
    const weixin = rc.weixin ?? {};
    await api.updateServerSettings({
      remoteChannels: { ...rc, weixin: { ...weixin, enabled: !enabled, bots: weixin.bots ?? [] } },
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
      const weixin = rc.weixin ?? { enabled };
      const updatedBots = (weixin.bots ?? []).map((b: WeixinBot) =>
        b.id === botId ? { ...b, ...draft } : b
      );
      await api.updateServerSettings({
        remoteChannels: { ...rc, weixin: { ...weixin, bots: updatedBots } },
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
    const newBot: WeixinBot = { id: `weixin_${Date.now()}`, enabled: true };
    const response = await api.getServerSettings();
    const rc = response.settings.remoteChannels ?? {};
    const weixin = rc.weixin ?? { enabled };
    await api.updateServerSettings({
      remoteChannels: { ...rc, weixin: { ...weixin, bots: [...(weixin.bots ?? []), newBot] } },
    });
    await fetchSettings();
  };

  const handleRemoveBot = async (botId: string) => {
    setDrafts((prev) => { const next = { ...prev }; delete next[botId]; return next; });
    setQrImageForBot((prev) => { const next = { ...prev }; delete next[botId]; return next; });
    const response = await api.getServerSettings();
    const rc = response.settings.remoteChannels ?? {};
    const weixin = rc.weixin ?? { enabled };
    await api.updateServerSettings({
      remoteChannels: { ...rc, weixin: { ...weixin, bots: (weixin.bots ?? []).filter((b: WeixinBot) => b.id !== botId) } },
    });
    await fetchSettings();
  };

  const handleStartLogin = async (botId: string) => {
    setIsStartingLogin(true);
    setStatus(null);
    setQrImageForBot((prev) => { const next = { ...prev }; delete next[botId]; return next; });
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const started = await api.startWeixinRemoteChannelLogin();
      setQrImageForBot((prev) => ({ ...prev, [botId]: started.qrImage }));
      for (;;) {
        if (ac.signal.aborted) return;
        const result = await api.waitWeixinRemoteChannelLogin(started.sessionId);
        if (result.status === "waiting" || result.status === "scanned") {
          setStatus(result.status === "scanned" ? t("remoteChannelsWeixinScanned") : t("remoteChannelsWeixinWaiting"));
          continue;
        }
        if (result.status === "confirmed") {
          updateDraft(botId, "accountId", result.accountId ?? "");
          updateDraft(botId, "peerUserId", result.peerUserId ?? "");
          setStatus(t("remoteChannelsWeixinLoginConfirmed"));
        } else {
          setStatus(result.error || t("remoteChannelsWeixinLoginFailed"));
        }
        break;
      }
    } catch (err) {
      if (ac.signal.aborted) return;
      setStatus(err instanceof Error ? err.message : t("remoteChannelsWeixinLoginFailed"));
    } finally {
      setIsStartingLogin(false);
    }
  };

  return (
    <div className="bridge-section">
      <div className="bridge-card bridge-card--highlight">
        <div className="bridge-toggle-row">
          <div className="bridge-toggle-info">
            <strong>{t("remoteChannelsWeixinEnableTitle")}</strong>
            <p>{t("remoteChannelsWeixinEnableDescription")}</p>
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
                <label>{t("remoteChannelsWeixinAccountIdTitle")}</label>
                <input className="bridge-input" value={d.accountId ?? ""} onChange={(e) => updateDraft(bot.id, "accountId", e.target.value)} />
              </div>
              <div className="bridge-actions">
                <button type="button" className="bridge-button bridge-button--outline bridge-button--sm" disabled={isStartingLogin} onClick={() => void handleStartLogin(bot.id)}>
                  {isStartingLogin ? t("remoteChannelsWeixinWaiting") : t("remoteChannelsWeixinScanLogin")}
                </button>
              </div>
              {qrImageForBot[bot.id] && (
                <img alt={t("remoteChannelsWeixinQrAlt")} src={qrImageForBot[bot.id]} style={{ width: 256, height: 256, marginTop: 8, borderRadius: 8 }} />
              )}
              <div className="bridge-field">
                <label>{t("remoteChannelsWeixinPeerUserIdTitle")}</label>
                <input className="bridge-input" value={d.peerUserId ?? ""} onChange={(e) => updateDraft(bot.id, "peerUserId", e.target.value)} />
              </div>
            </div>
            <div className="bridge-actions">
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
            {t("remoteChannelsAddWeixinBot")}
          </button>
        </div>
      )}

      {status && <p className="bridge-status-msg">{status}</p>}
    </div>
  );
}
