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
  const [drafts, setDrafts] = useState<Record<string, TelegramBot>>({});
  const [isSaving, setIsSaving] = useState<Record<string, boolean>>({});
  const [isVerifying, setIsVerifying] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    try {
      const response = await api.getServerSettings();
      const rc = response.settings.remoteChannels;
      const telegram = rc?.telegram;
      setEnabled(telegram?.enabled ?? false);
      setBots(telegram?.bots ?? []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  const getDraft = (bot: TelegramBot): TelegramBot => ({ ...bot, ...drafts[bot.id] });
  const hasChanges = (bot: TelegramBot): boolean => {
    const d = drafts[bot.id];
    if (!d) return false;
    return d.botToken !== bot.botToken || d.chatId !== bot.chatId || d.proxyUrl !== bot.proxyUrl;
  };

  const updateDraft = (botId: string, field: string, value: string) => {
    setDrafts((prev) => ({ ...prev, [botId]: { ...(prev[botId] ?? {} as TelegramBot), [field]: value } as TelegramBot }));
  };

  const handleToggleEnabled = async () => {
    const response = await api.getServerSettings();
    const rc = response.settings.remoteChannels ?? {};
    const telegram = rc.telegram ?? {};
    await api.updateServerSettings({
      remoteChannels: { ...rc, telegram: { ...telegram, enabled: !enabled, bots: telegram.bots ?? [] } },
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
      const telegram = rc.telegram ?? { enabled };
      const updatedBots = (telegram.bots ?? []).map((b: TelegramBot) =>
        b.id === botId ? { ...b, ...draft } : b
      );
      await api.updateServerSettings({
        remoteChannels: { ...rc, telegram: { ...telegram, bots: updatedBots } },
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
    const newBot: TelegramBot = { id: `telegram_${Date.now()}`, enabled: true };
    const response = await api.getServerSettings();
    const rc = response.settings.remoteChannels ?? {};
    const telegram = rc.telegram ?? { enabled };
    await api.updateServerSettings({
      remoteChannels: { ...rc, telegram: { ...telegram, bots: [...(telegram.bots ?? []), newBot] } },
    });
    await fetchSettings();
  };

  const handleRemoveBot = async (botId: string) => {
    setDrafts((prev) => { const next = { ...prev }; delete next[botId]; return next; });
    const response = await api.getServerSettings();
    const rc = response.settings.remoteChannels ?? {};
    const telegram = rc.telegram ?? { enabled };
    await api.updateServerSettings({
      remoteChannels: { ...rc, telegram: { ...telegram, bots: (telegram.bots ?? []).filter((b: TelegramBot) => b.id !== botId) } },
    });
    await fetchSettings();
  };

  const handleVerify = async (bot: TelegramBot, action: "verify" | "detect_chat_id") => {
    const d = getDraft(bot);
    setIsVerifying(true);
    setStatus(null);
    try {
      const result = await api.verifyTelegramRemoteChannel({
        action,
        botToken: d.botToken?.trim() || undefined,
        chatId: d.chatId?.trim() || undefined,
        proxyUrl: d.proxyUrl?.trim() || undefined,
      });
      if (action === "detect_chat_id" && result.detected && result.chatId) {
        updateDraft(bot.id, "chatId", result.chatId);
        setStatus(t("remoteChannelsTelegramChatIdDetected"));
      } else if (action === "verify") {
        setStatus(result.verified ? t("remoteChannelsTelegramVerified") : result.error || t("remoteChannelsTelegramVerifyFailed"));
      } else {
        setStatus(result.error || t("remoteChannelsTelegramChatIdDetectFailed"));
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : t("remoteChannelsTelegramVerifyFailed"));
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="bridge-section">
      <div className="bridge-card bridge-card--highlight">
        <div className="bridge-toggle-row">
          <div className="bridge-toggle-info">
            <strong>{t("remoteChannelsTelegramEnableTitle")}</strong>
            <p>{t("remoteChannelsTelegramEnableDescription")}</p>
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
                <label>{t("remoteChannelsTelegramBotTokenTitle")}</label>
                <input className="bridge-input" type="password" value={d.botToken ?? ""} placeholder="123456:ABC..." onChange={(e) => updateDraft(bot.id, "botToken", e.target.value)} />
              </div>
              <div className="bridge-field">
                <label>{t("remoteChannelsTelegramChatIdTitle")}</label>
                <input className="bridge-input" value={d.chatId ?? ""} placeholder="-100..." onChange={(e) => updateDraft(bot.id, "chatId", e.target.value)} />
              </div>
              <div className="bridge-field">
                <label>{t("remoteChannelsTelegramProxyTitle")}</label>
                <input className="bridge-input" value={d.proxyUrl ?? ""} placeholder="socks5://user:pass@127.0.0.1:1080" onChange={(e) => updateDraft(bot.id, "proxyUrl", e.target.value)} />
              </div>
            </div>
            <div className="bridge-actions">
              <button type="button" className="bridge-button bridge-button--outline bridge-button--sm" disabled={isVerifying} onClick={() => void handleVerify(bot, "detect_chat_id")}>
                {t("remoteChannelsTelegramDetectChatId")}
              </button>
              <button type="button" className="bridge-button bridge-button--outline bridge-button--sm" disabled={isVerifying} onClick={() => void handleVerify(bot, "verify")}>
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
            {t("remoteChannelsAddTelegramBot")}
          </button>
        </div>
      )}

      {status && <p className="bridge-status-msg">{status}</p>}
    </div>
  );
}
