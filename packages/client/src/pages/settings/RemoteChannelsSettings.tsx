import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import { useServerSettings } from "../../hooks/useServerSettings";
import { useI18n } from "../../i18n";

interface BotItem {
  id: string;
  name?: string;
  enabled?: boolean;
  boundSessionId?: string;
  [key: string]: unknown;
}

export function RemoteChannelsSettings() {
  const { t } = useI18n();
  const { settings, isLoading, error, updateSetting } = useServerSettings();
  const [status, setStatus] = useState<string | null>(null);

  const rc = settings?.remoteChannels;

  if (isLoading) {
    return (
      <section className="settings-section">
        <h2>{t("remoteChannelsTitle")}</h2>
        <p className="settings-section-description">
          {t("remoteChannelsLoading")}
        </p>
      </section>
    );
  }

  return (
    <section className="settings-section">
      <h2>{t("remoteChannelsTitle")}</h2>
      <p className="settings-section-description">
        {t("remoteChannelsDescription")}
      </p>

      <div className="settings-group">
        <FeishuChannelCard
          bots={rc?.feishu?.bots ?? []}
          enabled={rc?.feishu?.enabled ?? false}
          rc={rc}
          updateSetting={updateSetting as (key: string, value: unknown) => Promise<void>}
          t={t as (key: string) => string}
          setStatus={setStatus}
        />
        <TelegramChannelCard
          bots={rc?.telegram?.bots ?? []}
          enabled={rc?.telegram?.enabled ?? false}
          rc={rc}
          updateSetting={updateSetting as (key: string, value: unknown) => Promise<void>}
          t={t as (key: string) => string}
          setStatus={setStatus}
        />
        <QqChannelCard
          bots={rc?.qq?.bots ?? []}
          enabled={rc?.qq?.enabled ?? false}
          rc={rc}
          updateSetting={updateSetting as (key: string, value: unknown) => Promise<void>}
          t={t as (key: string) => string}
          setStatus={setStatus}
        />
        <WeixinChannelCard
          bots={rc?.weixin?.bots ?? []}
          enabled={rc?.weixin?.enabled ?? false}
          rc={rc}
          updateSetting={updateSetting as (key: string, value: unknown) => Promise<void>}
          t={t as (key: string) => string}
          setStatus={setStatus}
        />
      </div>

      {(status || error) && <p className="settings-warning">{status || error}</p>}
    </section>
  );
}

// ---------- 通用工具 ----------

function withUpdatedBots(
  rc: unknown,
  channel: string,
  updateFn: (bots: BotItem[]) => BotItem[],
): Record<string, unknown> {
  const rcObj = (rc ?? {}) as Record<string, unknown>;
  const channelObj = (rcObj[channel] ?? {}) as Record<string, unknown>;
  const bots = (channelObj.bots ?? []) as BotItem[];
  return { ...rcObj, [channel]: { ...channelObj, bots: updateFn(bots) } };
}

async function persistBots(
  rc: unknown,
  channel: string,
  updateFn: (bots: BotItem[]) => BotItem[],
  updateSetting: (key: string, value: unknown) => Promise<void>,
) {
  await updateSetting("remoteChannels", withUpdatedBots(rc, channel, updateFn));
}

function setChannelEnabled(
  rc: unknown,
  channel: string,
  enabled: boolean,
  updateSetting: (key: string, value: unknown) => Promise<void>,
) {
  const rcObj = (rc ?? {}) as Record<string, unknown>;
  const channelObj = (rcObj[channel] ?? {}) as Record<string, unknown>;
  void updateSetting("remoteChannels", {
    ...rcObj,
    [channel]: { ...channelObj, enabled },
  });
}

// ---------- 飞书渠道 ----------

interface FeishuBot extends BotItem {
  proxyUrl?: string;
  appId?: string;
  appSecret?: string;
  appChatId?: string;
}

function feishuBotToDraft(bot: FeishuBot): FeishuBot {
  return { ...bot };
}

function draftToFeishuBot(draft: FeishuBot): FeishuBot {
  const { ...bot } = draft;
  return bot;
}

function FeishuChannelCard({
  bots,
  enabled,
  rc,
  updateSetting,
  t,
  setStatus,
}: {
  bots: FeishuBot[];
  enabled: boolean;
  rc: unknown;
  updateSetting: (key: string, value: unknown) => Promise<void>;
  t: (key: string) => string;
  setStatus: (s: string | null) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, FeishuBot>>({});
  const [isRegistering, setIsRegistering] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState<Record<string, boolean>>({});

  // 初始化 drafts：对没有本地 draft 的 bot 使用服务器值
  const getDraft = useCallback(
    (bot: FeishuBot): FeishuBot => ({ ...bot, ...drafts[bot.id] }),
    [drafts],
  );
  const hasChanges = useCallback(
    (bot: FeishuBot): boolean => {
      const d = drafts[bot.id];
      if (!d) return false;
      return (
        d.proxyUrl !== bot.proxyUrl ||
        d.appId !== bot.appId ||
        d.appSecret !== bot.appSecret ||
        d.appChatId !== bot.appChatId
      );
    },
    [drafts],
  );

  const updateDraft = (botId: string, field: string, value: string) => {
    setDrafts((prev) => ({
      ...prev,
      [botId]: { ...(prev[botId] ?? ({} as FeishuBot)), [field]: value },
    }));
  };

  const handleSave = async (botId: string) => {
    const draft = drafts[botId];
    if (!draft) return;
    setIsSaving((prev) => ({ ...prev, [botId]: true }));
    setStatus(null);
    try {
      await persistBots(rc, "feishu", (bs) =>
        bs.map((b) => (b.id === botId ? { ...b, ...draftToFeishuBot(draft) } : b)),
        updateSetting,
      );
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[botId];
        return next;
      });
      setStatus(t("remoteChannelsSaved"));
    } catch (err) {
      setStatus(err instanceof Error ? err.message : t("remoteChannelsSaveFailed"));
    } finally {
      setIsSaving((prev) => ({ ...prev, [botId]: false }));
    }
  };

  const handleAddBot = async () => {
    const newBot: FeishuBot = {
      id: `feishu_${Date.now()}`,
      enabled: true,
    };
    await persistBots(rc, "feishu", (bs) => [...bs, newBot], updateSetting);
  };

  const handleRemoveBot = async (botId: string) => {
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[botId];
      return next;
    });
    await persistBots(rc, "feishu", (bs) => bs.filter((b) => b.id !== botId), updateSetting);
  };

  const abortRef = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const handleRegister = async (botId: string) => {
    setIsRegistering(true);
    setStatus(null);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const started = await api.startFeishuRemoteChannelRegistration();
      window.open(started.verificationUrl, "_blank", "noopener,noreferrer");
      let interval = started.interval || 5000;
      for (;;) {
        if (ac.signal.aborted) return;
        await new Promise((resolve) => setTimeout(resolve, interval));
        if (ac.signal.aborted) return;
        const result = await api.pollFeishuRemoteChannelRegistration(started.sessionId);
        interval = result.interval || interval;
        if (result.status === "waiting") continue;
        if (result.status === "completed") {
          updateDraft(botId, "appId", result.appId ?? "");
          setStatus(t("remoteChannelsFeishuRegistrationCompleted"));
        } else {
          setStatus(result.error || t("remoteChannelsFeishuRegistrationFailed"));
        }
        break;
      }
    } catch (err) {
      if (ac.signal.aborted) return;
      setStatus(err instanceof Error ? err.message : t("remoteChannelsFeishuRegistrationFailed"));
    } finally {
      setIsRegistering(false);
    }
  };

  const handleTestApp = async (botId: string) => {
    setIsTesting(true);
    setStatus(null);
    try {
      await api.testFeishuAppRemoteChannel(botId);
      setStatus(t("remoteChannelsAppTestSucceeded"));
    } catch (err) {
      setStatus(err instanceof Error ? err.message : t("remoteChannelsAppTestFailed"));
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="settings-group">
      <label className="settings-item">
        <div className="settings-item-info">
          <strong>{t("remoteChannelsFeishuEnableTitle")}</strong>
          <p>{t("remoteChannelsFeishuEnableDescription")}</p>
        </div>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setChannelEnabled(rc, "feishu", e.target.checked, updateSetting)}
        />
      </label>

      {enabled && bots.map((bot) => {
        const d = getDraft(bot);
        return (
          <div key={bot.id} style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius)", padding: "var(--space-3)", marginBottom: "var(--space-2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-2)" }}>
              <strong>{bot.name || `Bot ${bot.id.slice(-6)}`}</strong>
              <div style={{ display: "flex", gap: "var(--space-2)" }}>
                {bot.boundSessionId && (
                  <span style={{ fontSize: "0.8em", color: "var(--color-text-secondary)" }}>
                    {t("remoteChannelsBoundTo")}: {bot.boundSessionId.slice(0, 8)}...
                  </span>
                )}
                <button type="button" className="settings-button secondary" style={{ fontSize: "0.8em" }}
                  onClick={() => void handleRemoveBot(bot.id)}>
                  {t("remoteChannelsRemoveBot")}
                </button>
              </div>
            </div>
            <BotField label={t("remoteChannelsFeishuProxyTitle")} value={d.proxyUrl ?? ""} placeholder="http://127.0.0.1:7890"
              onChange={(v) => updateDraft(bot.id, "proxyUrl", v)} />
            <div style={{ display: "flex", gap: "var(--space-2)" }}>
              <div style={{ flex: 1 }}>
                <BotField label={t("remoteChannelsFeishuAppIdTitle")} value={d.appId ?? ""} placeholder="cli_..."
                  onChange={(v) => updateDraft(bot.id, "appId", v)} />
              </div>
              <button type="button" className="settings-button secondary" style={{ alignSelf: "flex-end" }}
                disabled={isRegistering} onClick={() => void handleRegister(bot.id)}>
                {isRegistering ? t("remoteChannelsFeishuRegistering") : t("remoteChannelsFeishuQuickCreate")}
              </button>
            </div>
            <BotField label={t("remoteChannelsFeishuAppSecretTitle")} value={d.appSecret ?? ""} placeholder="app secret" type="password"
              onChange={(v) => updateDraft(bot.id, "appSecret", v)} />
            <BotField label={t("remoteChannelsFeishuAppChatIdTitle")} value={d.appChatId ?? ""} placeholder="oc_..."
              onChange={(v) => updateDraft(bot.id, "appChatId", v)} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
              <button type="button" className="settings-button secondary"
                disabled={isTesting || !d.appId || !d.appSecret}
                onClick={() => void handleTestApp(bot.id)}>
                {isTesting ? t("remoteChannelsTesting") : t("remoteChannelsAppTest")}
              </button>
              <button type="button" className="settings-button"
                disabled={isSaving[bot.id] || !hasChanges(bot)}
                onClick={() => void handleSave(bot.id)}>
                {isSaving[bot.id] ? t("providersSaving") : t("providersSave")}
              </button>
            </div>
          </div>
        );
      })}

      {enabled && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="button" className="settings-button secondary" onClick={() => void handleAddBot()}>
            {t("remoteChannelsAddFeishuBot")}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- Telegram 渠道 ----------

interface TelegramBot extends BotItem {
  botToken?: string;
  chatId?: string;
  proxyUrl?: string;
}

function TelegramChannelCard({
  bots,
  enabled,
  rc,
  updateSetting,
  t,
  setStatus,
}: {
  bots: TelegramBot[];
  enabled: boolean;
  rc: unknown;
  updateSetting: (key: string, value: unknown) => Promise<void>;
  t: (key: string) => string;
  setStatus: (s: string | null) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, TelegramBot>>({});
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSaving, setIsSaving] = useState<Record<string, boolean>>({});

  const getDraft = useCallback(
    (bot: TelegramBot): TelegramBot => ({ ...bot, ...drafts[bot.id] }),
    [drafts],
  );
  const hasChanges = useCallback(
    (bot: TelegramBot): boolean => {
      const d = drafts[bot.id];
      if (!d) return false;
      return d.botToken !== bot.botToken || d.chatId !== bot.chatId || d.proxyUrl !== bot.proxyUrl;
    },
    [drafts],
  );

  const updateDraft = (botId: string, field: string, value: string) => {
    setDrafts((prev) => ({
      ...prev,
      [botId]: { ...(prev[botId] ?? ({} as TelegramBot)), [field]: value },
    }));
  };

  const handleSave = async (botId: string) => {
    const draft = drafts[botId];
    if (!draft) return;
    setIsSaving((prev) => ({ ...prev, [botId]: true }));
    setStatus(null);
    try {
      await persistBots(rc, "telegram", (bs) =>
        bs.map((b) => (b.id === botId ? { ...b, ...draft } : b)),
        updateSetting,
      );
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[botId];
        return next;
      });
      setStatus(t("remoteChannelsSaved"));
    } catch (err) {
      setStatus(err instanceof Error ? err.message : t("remoteChannelsSaveFailed"));
    } finally {
      setIsSaving((prev) => ({ ...prev, [botId]: false }));
    }
  };

  const handleAddBot = async () => {
    const newBot: TelegramBot = { id: `telegram_${Date.now()}`, enabled: true };
    await persistBots(rc, "telegram", (bs) => [...bs, newBot], updateSetting);
  };

  const handleRemoveBot = async (botId: string) => {
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[botId];
      return next;
    });
    await persistBots(rc, "telegram", (bs) => bs.filter((b) => b.id !== botId), updateSetting);
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
    <div className="settings-group">
      <label className="settings-item">
        <div className="settings-item-info">
          <strong>{t("remoteChannelsTelegramEnableTitle")}</strong>
          <p>{t("remoteChannelsTelegramEnableDescription")}</p>
        </div>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setChannelEnabled(rc, "telegram", e.target.checked, updateSetting)}
        />
      </label>

      {enabled && bots.map((bot) => {
        const d = getDraft(bot);
        return (
          <div key={bot.id} style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius)", padding: "var(--space-3)", marginBottom: "var(--space-2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-2)" }}>
              <strong>{bot.name || `Bot ${bot.id.slice(-6)}`}</strong>
              <div style={{ display: "flex", gap: "var(--space-2)" }}>
                {bot.boundSessionId && (
                  <span style={{ fontSize: "0.8em", color: "var(--color-text-secondary)" }}>
                    {t("remoteChannelsBoundTo")}: {bot.boundSessionId.slice(0, 8)}...
                  </span>
                )}
                <button type="button" className="settings-button secondary" style={{ fontSize: "0.8em" }}
                  onClick={() => void handleRemoveBot(bot.id)}>
                  {t("remoteChannelsRemoveBot")}
                </button>
              </div>
            </div>
            <BotField label={t("remoteChannelsTelegramBotTokenTitle")} value={d.botToken ?? ""} placeholder="123456:ABC..." type="password"
              onChange={(v) => updateDraft(bot.id, "botToken", v)} />
            <BotField label={t("remoteChannelsTelegramChatIdTitle")} value={d.chatId ?? ""} placeholder="-100..."
              onChange={(v) => updateDraft(bot.id, "chatId", v)} />
            <BotField label={t("remoteChannelsTelegramProxyTitle")} value={d.proxyUrl ?? ""} placeholder="socks5://user:pass@127.0.0.1:1080"
              onChange={(v) => updateDraft(bot.id, "proxyUrl", v)} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
              <button type="button" className="settings-button secondary" disabled={isVerifying}
                onClick={() => void handleVerify(bot, "detect_chat_id")}>
                {t("remoteChannelsTelegramDetectChatId")}
              </button>
              <button type="button" className="settings-button secondary" disabled={isVerifying}
                onClick={() => void handleVerify(bot, "verify")}>
                {isVerifying ? t("remoteChannelsVerifying") : t("remoteChannelsVerify")}
              </button>
              <button type="button" className="settings-button"
                disabled={isSaving[bot.id] || !hasChanges(bot)}
                onClick={() => void handleSave(bot.id)}>
                {isSaving[bot.id] ? t("providersSaving") : t("providersSave")}
              </button>
            </div>
          </div>
        );
      })}

      {enabled && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="button" className="settings-button secondary" onClick={() => void handleAddBot()}>
            {t("remoteChannelsAddTelegramBot")}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- QQ 渠道 ----------

interface QqBot extends BotItem {
  appId?: string;
  appSecret?: string;
  openId?: string;
}

function QqChannelCard({
  bots,
  enabled,
  rc,
  updateSetting,
  t,
  setStatus,
}: {
  bots: QqBot[];
  enabled: boolean;
  rc: unknown;
  updateSetting: (key: string, value: unknown) => Promise<void>;
  t: (key: string) => string;
  setStatus: (s: string | null) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, QqBot>>({});
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSaving, setIsSaving] = useState<Record<string, boolean>>({});

  const getDraft = useCallback(
    (bot: QqBot): QqBot => ({ ...bot, ...drafts[bot.id] }),
    [drafts],
  );
  const hasChanges = useCallback(
    (bot: QqBot): boolean => {
      const d = drafts[bot.id];
      if (!d) return false;
      return d.appId !== bot.appId || d.appSecret !== bot.appSecret || d.openId !== bot.openId;
    },
    [drafts],
  );

  const updateDraft = (botId: string, field: string, value: string) => {
    setDrafts((prev) => ({
      ...prev,
      [botId]: { ...(prev[botId] ?? ({} as QqBot)), [field]: value },
    }));
  };

  const handleSave = async (botId: string) => {
    const draft = drafts[botId];
    if (!draft) return;
    setIsSaving((prev) => ({ ...prev, [botId]: true }));
    setStatus(null);
    try {
      await persistBots(rc, "qq", (bs) =>
        bs.map((b) => (b.id === botId ? { ...b, ...draft } : b)),
        updateSetting,
      );
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[botId];
        return next;
      });
      setStatus(t("remoteChannelsSaved"));
    } catch (err) {
      setStatus(err instanceof Error ? err.message : t("remoteChannelsSaveFailed"));
    } finally {
      setIsSaving((prev) => ({ ...prev, [botId]: false }));
    }
  };

  const handleAddBot = async () => {
    const newBot: QqBot = { id: `qq_${Date.now()}`, enabled: true };
    await persistBots(rc, "qq", (bs) => [...bs, newBot], updateSetting);
  };

  const handleRemoveBot = async (botId: string) => {
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[botId];
      return next;
    });
    await persistBots(rc, "qq", (bs) => bs.filter((b) => b.id !== botId), updateSetting);
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
    <div className="settings-group">
      <label className="settings-item">
        <div className="settings-item-info">
          <strong>{t("remoteChannelsQqEnableTitle")}</strong>
          <p>{t("remoteChannelsQqEnableDescription")}</p>
        </div>
        <input type="checkbox" checked={enabled}
          onChange={(e) => setChannelEnabled(rc, "qq", e.target.checked, updateSetting)} />
      </label>

      {enabled && bots.map((bot) => {
        const d = getDraft(bot);
        return (
          <div key={bot.id} style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius)", padding: "var(--space-3)", marginBottom: "var(--space-2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-2)" }}>
              <strong>{bot.name || `Bot ${bot.id.slice(-6)}`}</strong>
              <button type="button" className="settings-button secondary" style={{ fontSize: "0.8em" }}
                onClick={() => void handleRemoveBot(bot.id)}>
                {t("remoteChannelsRemoveBot")}
              </button>
            </div>
            <BotField label={t("remoteChannelsQqAppIdTitle")} value={d.appId ?? ""}
              onChange={(v) => updateDraft(bot.id, "appId", v)} />
            <BotField label={t("remoteChannelsQqAppSecretTitle")} value={d.appSecret ?? ""} type="password"
              onChange={(v) => updateDraft(bot.id, "appSecret", v)} />
            <BotField label={t("remoteChannelsQqOpenIdTitle")} value={d.openId ?? ""}
              onChange={(v) => updateDraft(bot.id, "openId", v)} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
              <button type="button" className="settings-button secondary" disabled={isVerifying}
                onClick={() => void handleVerify(bot)}>
                {isVerifying ? t("remoteChannelsVerifying") : t("remoteChannelsVerify")}
              </button>
              <button type="button" className="settings-button"
                disabled={isSaving[bot.id] || !hasChanges(bot)}
                onClick={() => void handleSave(bot.id)}>
                {isSaving[bot.id] ? t("providersSaving") : t("providersSave")}
              </button>
            </div>
          </div>
        );
      })}

      {enabled && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="button" className="settings-button secondary" onClick={() => void handleAddBot()}>
            {t("remoteChannelsAddQqBot")}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- 微信渠道 ----------

interface WeixinBot extends BotItem {
  accountId?: string;
  peerUserId?: string;
  botToken?: string;
  baseUrl?: string;
  contextToken?: string;
  getUpdatesBuf?: string;
}

function WeixinChannelCard({
  bots,
  enabled,
  rc,
  updateSetting,
  t,
  setStatus,
}: {
  bots: WeixinBot[];
  enabled: boolean;
  rc: unknown;
  updateSetting: (key: string, value: unknown) => Promise<void>;
  t: (key: string) => string;
  setStatus: (s: string | null) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, WeixinBot>>({});
  const [isStartingLogin, setIsStartingLogin] = useState(false);
  const [isSaving, setIsSaving] = useState<Record<string, boolean>>({});
  const [qrImageForBot, setQrImageForBot] = useState<Record<string, string>>({});

  const getDraft = useCallback(
    (bot: WeixinBot): WeixinBot => ({ ...bot, ...drafts[bot.id] }),
    [drafts],
  );
  const hasChanges = useCallback(
    (bot: WeixinBot): boolean => {
      const d = drafts[bot.id];
      if (!d) return false;
      return (
        d.accountId !== bot.accountId ||
        d.peerUserId !== bot.peerUserId ||
        d.botToken !== bot.botToken ||
        d.baseUrl !== bot.baseUrl
      );
    },
    [drafts],
  );

  const updateDraft = (botId: string, field: string, value: string) => {
    setDrafts((prev) => ({
      ...prev,
      [botId]: { ...(prev[botId] ?? ({} as WeixinBot)), [field]: value },
    }));
  };

  const handleSave = async (botId: string) => {
    const draft = drafts[botId];
    if (!draft) return;
    setIsSaving((prev) => ({ ...prev, [botId]: true }));
    setStatus(null);
    try {
      await persistBots(rc, "weixin", (bs) =>
        bs.map((b) => (b.id === botId ? { ...b, ...draft } : b)),
        updateSetting,
      );
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[botId];
        return next;
      });
      setStatus(t("remoteChannelsSaved"));
    } catch (err) {
      setStatus(err instanceof Error ? err.message : t("remoteChannelsSaveFailed"));
    } finally {
      setIsSaving((prev) => ({ ...prev, [botId]: false }));
    }
  };

  const handleAddBot = async () => {
    const newBot: WeixinBot = { id: `weixin_${Date.now()}`, enabled: true };
    await persistBots(rc, "weixin", (bs) => [...bs, newBot], updateSetting);
  };

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
    await persistBots(rc, "weixin", (bs) => bs.filter((b) => b.id !== botId), updateSetting);
  };

  const abortRef = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

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
        const result = await api.waitWeixinRemoteChannelLogin(started.sessionId);
        if (result.status === "waiting" || result.status === "scanned") {
          setStatus(result.status === "scanned" ? t("remoteChannelsWeixinScanned") : t("remoteChannelsWeixinWaiting"));
          continue;
        }
        if (result.status === "confirmed") {
          updateDraft(botId, "accountId", result.accountId ?? "");
          updateDraft(botId, "peerUserId", result.peerUserId ?? "");
          updateDraft(botId, "botToken", result.botToken ?? "");
          updateDraft(botId, "baseUrl", result.baseUrl ?? "");
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
    <div className="settings-group">
      <label className="settings-item">
        <div className="settings-item-info">
          <strong>{t("remoteChannelsWeixinEnableTitle")}</strong>
          <p>{t("remoteChannelsWeixinEnableDescription")}</p>
        </div>
        <input type="checkbox" checked={enabled}
          onChange={(e) => setChannelEnabled(rc, "weixin", e.target.checked, updateSetting)} />
      </label>

      {enabled && bots.map((bot) => {
        const d = getDraft(bot);
        return (
          <div key={bot.id} style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius)", padding: "var(--space-3)", marginBottom: "var(--space-2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-2)" }}>
              <strong>{bot.name || `Bot ${bot.id.slice(-6)}`}</strong>
              <button type="button" className="settings-button secondary" style={{ fontSize: "0.8em" }}
                onClick={() => void handleRemoveBot(bot.id)}>
                {t("remoteChannelsRemoveBot")}
              </button>
            </div>
            <BotField label={t("remoteChannelsWeixinAccountIdTitle")} value={d.accountId ?? ""}
              onChange={(v) => updateDraft(bot.id, "accountId", v)} />
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "var(--space-2)" }}>
              <button type="button" className="settings-button secondary"
                disabled={isStartingLogin} onClick={() => void handleStartLogin(bot.id)}>
                {isStartingLogin ? t("remoteChannelsWeixinWaiting") : t("remoteChannelsWeixinScanLogin")}
              </button>
            </div>
            {qrImageForBot[bot.id] && (
              <img alt={t("remoteChannelsWeixinQrAlt")} src={qrImageForBot[bot.id]}
                style={{ width: 256, height: 256, marginTop: "var(--space-2)" }} />
            )}
            <BotField label={t("remoteChannelsWeixinPeerUserIdTitle")} value={d.peerUserId ?? ""}
              onChange={(v) => updateDraft(bot.id, "peerUserId", v)} />
            <BotField label="Bot Token" value={d.botToken ?? ""} type="password"
              onChange={(v) => updateDraft(bot.id, "botToken", v)} />
            <BotField label="Base URL" value={d.baseUrl ?? ""} placeholder="https://ilinkai.weixin.qq.com"
              onChange={(v) => updateDraft(bot.id, "baseUrl", v)} />
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "var(--space-2)" }}>
              <button type="button" className="settings-button"
                disabled={isSaving[bot.id] || !hasChanges(bot)}
                onClick={() => void handleSave(bot.id)}>
                {isSaving[bot.id] ? t("providersSaving") : t("providersSave")}
              </button>
            </div>
          </div>
        );
      })}

      {enabled && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="button" className="settings-button secondary" onClick={() => void handleAddBot()}>
            {t("remoteChannelsAddWeixinBot")}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- 通用字段组件 ----------

function BotField({
  label,
  value,
  placeholder,
  type = "text",
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  type?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="settings-item" style={{ flexDirection: "column", alignItems: "stretch" }}>
      <div className="settings-item-info">
        <strong>{label}</strong>
      </div>
      <input
        type={type}
        className="settings-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}
