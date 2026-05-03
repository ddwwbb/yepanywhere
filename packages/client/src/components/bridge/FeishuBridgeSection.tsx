import { useState, useCallback, useEffect, useRef } from "react";
import { api } from "../../api/client";
import { useI18n } from "../../i18n";

interface FeishuBot {
  id: string;
  name?: string;
  enabled?: boolean;
  proxyUrl?: string;
  appId?: string;
  appSecret?: string;
  appChatId?: string;
  boundSessionId?: string;
}

export function FeishuBridgeSection() {
  const { t } = useI18n();
  const abortRef = useRef<AbortController | null>(null);

  const [feishuEnabled, setFeishuEnabled] = useState(false);
  const [bots, setBots] = useState<FeishuBot[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Partial<FeishuBot>>>({});
  const [isSaving, setIsSaving] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<string | null>(null);

  // ── Quick Create state ──
  const [isRegistering, setIsRegistering] = useState(false);
  const [regStatus, setRegStatus] = useState<{
    variant: "success" | "warning" | "error";
    message: string;
  } | null>(null);

  // ── Access & Behavior state (shared across all bots) ──
  const [domain, setDomain] = useState<"feishu" | "lark">("feishu");
  const [dmPolicy, setDmPolicy] = useState<"open" | "pairing" | "allowlist" | "disabled">("open");
  const [allowFrom, setAllowFrom] = useState("*");
  const [groupPolicy, setGroupPolicy] = useState<"open" | "allowlist" | "disabled">("open");
  const [groupAllowFrom, setGroupAllowFrom] = useState("");
  const [requireMention, setRequireMention] = useState(true);
  const [threadSession, setThreadSession] = useState(false);
  const [behaviorSaving, setBehaviorSaving] = useState(false);
  const [behaviorDirty, setBehaviorDirty] = useState(false);
  const savedBehavior = useRef({
    dmPolicy: "open" as string,
    allowFrom: "*",
    groupPolicy: "open" as string,
    groupAllowFrom: "",
    requireMention: true,
    threadSession: false,
  });

  // ── Verify state ──
  const [verifying, setVerifying] = useState<Record<string, boolean>>({});
  const [verifyResults, setVerifyResults] = useState<Record<string, { ok: boolean; message: string }>>({});

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  // ── Dirty tracking for behavior ──
  useEffect(() => {
    const s = savedBehavior.current;
    setBehaviorDirty(
      dmPolicy !== s.dmPolicy ||
      allowFrom !== s.allowFrom ||
      groupPolicy !== s.groupPolicy ||
      groupAllowFrom !== s.groupAllowFrom ||
      requireMention !== s.requireMention ||
      threadSession !== s.threadSession
    );
  }, [dmPolicy, allowFrom, groupPolicy, groupAllowFrom, requireMention, threadSession]);

  // ── Fetch ──
  const fetchSettings = useCallback(async () => {
    try {
      const response = await api.getServerSettings();
      const feishu = response.settings.remoteChannels?.feishu;

      setFeishuEnabled(feishu?.enabled ?? false);
      setBots(feishu?.bots ?? []);
      setDomain(feishu?.domain ?? "feishu");
      setDmPolicy(feishu?.dmPolicy ?? "open");
      setAllowFrom(feishu?.allowFrom ?? "*");
      setGroupPolicy(feishu?.groupPolicy ?? "open");
      setGroupAllowFrom(feishu?.groupAllowFrom ?? "");
      setRequireMention(feishu?.requireMention ?? true);
      setThreadSession(feishu?.threadSession ?? false);

      savedBehavior.current = {
        dmPolicy: feishu?.dmPolicy ?? "open",
        allowFrom: feishu?.allowFrom ?? "*",
        groupPolicy: feishu?.groupPolicy ?? "open",
        groupAllowFrom: feishu?.groupAllowFrom ?? "",
        requireMention: feishu?.requireMention ?? true,
        threadSession: feishu?.threadSession ?? false,
      };
      setBehaviorDirty(false);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  // ── Draft helpers ──
  const getDraft = (bot: FeishuBot): FeishuBot => ({ ...bot, ...drafts[bot.id] });
  const hasChanges = (bot: FeishuBot): boolean => {
    const d = drafts[bot.id];
    if (!d) return false;
    return (
      (d.appId !== undefined && d.appId !== bot.appId) ||
      (d.appSecret !== undefined && d.appSecret !== bot.appSecret) ||
      (d.appChatId !== undefined && d.appChatId !== bot.appChatId) ||
      (d.proxyUrl !== undefined && d.proxyUrl !== bot.proxyUrl) ||
      (d.name !== undefined && d.name !== bot.name)
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
      const feishu = rc.feishu ?? {};
      await api.updateServerSettings({
        remoteChannels: {
          ...rc,
          feishu: { ...feishu, enabled: !feishuEnabled, bots: feishu.bots ?? [] },
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
      const feishu = rc.feishu ?? { enabled: feishuEnabled };
      const updatedBots = (feishu.bots ?? []).map((b: FeishuBot) =>
        b.id === botId ? { ...b, ...draft } : b
      );
      await api.updateServerSettings({
        remoteChannels: {
          ...rc,
          feishu: { ...feishu, bots: updatedBots },
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
      setStatus(err instanceof Error ? err.message : t("remoteChannelsSaveFailed"));
    } finally {
      setIsSaving((prev) => ({ ...prev, [botId]: false }));
    }
  };

  // ── Add bot ──
  const handleAddBot = async () => {
    const newBot: FeishuBot = { id: `feishu_${Date.now()}`, enabled: true };
    try {
      const response = await api.getServerSettings();
      const rc = response.settings.remoteChannels ?? {};
      const feishu = rc.feishu ?? { enabled: feishuEnabled };
      await api.updateServerSettings({
        remoteChannels: {
          ...rc,
          feishu: { ...feishu, bots: [...(feishu.bots ?? []), newBot] },
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
      const feishu = rc.feishu ?? { enabled: feishuEnabled };
      await api.updateServerSettings({
        remoteChannels: {
          ...rc,
          feishu: {
            ...feishu,
            bots: (feishu.bots ?? []).filter((b: FeishuBot) => b.id !== botId),
          },
        },
      });
      await fetchSettings();
    } catch {
      // ignore
    }
  };

  // ── Quick Create ──
  const handleQuickCreate = useCallback(async () => {
    setIsRegistering(true);
    setRegStatus(null);
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
          setRegStatus({ variant: "success", message: t("feishu.createSuccess") });
          fetchSettings();
        } else {
          setRegStatus({
            variant: "error",
            message: result.error || t("feishu.createFailed"),
          });
        }
        break;
      }
    } catch (err) {
      if (ac.signal.aborted) return;
      setRegStatus({ variant: "error", message: t("feishu.createFailed") });
    } finally {
      setIsRegistering(false);
    }
  }, [t, fetchSettings]);

  const handleCancelCreate = useCallback(() => {
    abortRef.current?.abort();
    setIsRegistering(false);
    setRegStatus(null);
  }, []);

  // ── Save Behavior ──
  const handleSaveBehavior = async () => {
    setBehaviorSaving(true);
    try {
      const response = await api.getServerSettings();
      const rc = response.settings.remoteChannels ?? {};
      const feishu = rc.feishu ?? {};
      await api.updateServerSettings({
        remoteChannels: {
          ...rc,
          feishu: {
            ...feishu,
            domain,
            dmPolicy,
            allowFrom,
            groupPolicy,
            groupAllowFrom,
            requireMention,
            threadSession,
          },
        },
      });
      savedBehavior.current = {
        dmPolicy, allowFrom, groupPolicy,
        groupAllowFrom, requireMention, threadSession,
      };
      setBehaviorDirty(false);
    } catch {
      // ignore
    } finally {
      setBehaviorSaving(false);
    }
  };

  // ── Verify bot ──
  const handleVerify = async (bot: FeishuBot) => {
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
          [bot.id]: { ok: false, message: t("feishu.enterCredentialsFirst") },
        }));
        return;
      }
      await api.testFeishuAppRemoteChannel(bot.id);
      setVerifyResults((prev) => ({
        ...prev,
        [bot.id]: { ok: true, message: t("feishu.verified") },
      }));
    } catch (err) {
      setVerifyResults((prev) => ({
        ...prev,
        [bot.id]: {
          ok: false,
          message: err instanceof Error ? err.message : t("feishu.verifyFailed"),
        },
      }));
    } finally {
      setVerifying((prev) => ({ ...prev, [bot.id]: false }));
    }
  };

  // ── Status Banner ──
  const StatusBanner = ({ variant, message }: { variant: string; message: string }) => (
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
            <strong>{t("remoteChannelsFeishuEnableTitle")}</strong>
            <p>{t("remoteChannelsFeishuEnableDescription")}</p>
          </div>
          <label className="bridge-switch">
            <input type="checkbox" checked={feishuEnabled} onChange={() => void handleToggleEnabled()} />
            <span className="bridge-switch-slider" />
          </label>
        </div>
      </div>

      {/* ── 快速创建 ── */}
      {feishuEnabled && (
        <div className="bridge-card">
          <div className="bridge-card-header">
            <h3>{t("feishu.quickCreate")}</h3>
            <p className="bridge-card-desc">{t("feishu.quickCreateDesc")}</p>
          </div>
          <div className="bridge-section-body">
            <div className="bridge-register-actions">
              {!isRegistering ? (
                <button type="button" className="bridge-button" onClick={() => void handleQuickCreate()}>
                  {t("feishu.quickCreateBtn")}
                </button>
              ) : (
                <div className="bridge-registering-row">
                  <button type="button" className="bridge-button bridge-button--outline bridge-button--sm" onClick={handleCancelCreate}>
                    {t("projectsCancel")}
                  </button>
                  <span className="bridge-registering-row">
                    <span className="bridge-spinner" />
                    {t("feishu.waitingAuth")}
                  </span>
                </div>
              )}
            </div>
            {regStatus && <StatusBanner variant={regStatus.variant} message={regStatus.message} />}
          </div>
        </div>
      )}

      {/* ── 多 Bot 列表 ── */}
      {feishuEnabled && bots.map((bot) => {
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
            {bot.boundSessionId && (
              <p className="bridge-field-hint" style={{ marginBottom: "var(--space-2)" }}>
                {t("bridge.boundSession")}: {bot.boundSessionId.slice(0, 8)}...
              </p>
            )}
            <div className="bridge-fields">
              <div className="bridge-field">
                <label>{t("remoteChannelsFeishuBotNameTitle")}</label>
                <input
                  className="bridge-input"
                  value={d.name ?? ""}
                  placeholder="My Feishu Bot"
                  onChange={(e) => updateDraft(bot.id, "name", e.target.value)}
                />
              </div>
              <div className="bridge-field">
                <label>{t("feishu.appId")}</label>
                <input
                  className="bridge-input"
                  value={d.appId ?? ""}
                  placeholder="cli_xxxxxxxxxx"
                  onChange={(e) => updateDraft(bot.id, "appId", e.target.value)}
                />
              </div>
              <div className="bridge-field">
                <label>{t("feishu.appSecret")}</label>
                <input
                  className="bridge-input"
                  type="password"
                  value={d.appSecret ?? ""}
                  placeholder="xxxxxxxxxxxxxxxxxxxxxxxx"
                  onChange={(e) => updateDraft(bot.id, "appSecret", e.target.value)}
                />
              </div>
              <div className="bridge-field">
                <label>{t("remoteChannelsFeishuAppChatIdTitle")}</label>
                <input
                  className="bridge-input"
                  value={d.appChatId ?? ""}
                  placeholder="oc_..."
                  onChange={(e) => updateDraft(bot.id, "appChatId", e.target.value)}
                />
                <p className="bridge-field-hint">{t("remoteChannelsFeishuAppChatIdDescription")}</p>
              </div>
              <div className="bridge-field">
                <label>{t("remoteChannelsFeishuProxyTitle")}</label>
                <input
                  className="bridge-input"
                  value={d.proxyUrl ?? ""}
                  placeholder="http://proxy:8080"
                  onChange={(e) => updateDraft(bot.id, "proxyUrl", e.target.value)}
                />
              </div>
            </div>
            <div className="bridge-actions">
              <button
                type="button"
                className="bridge-button bridge-button--outline bridge-button--sm"
                disabled={verifying[bot.id] || !d.appId}
                onClick={() => void handleVerify(bot)}
              >
                {verifying[bot.id] ? t("remoteChannelsVerifying") : t("remoteChannelsVerify")}
              </button>
              <button
                type="button"
                className="bridge-button bridge-button--sm"
                disabled={isSaving[bot.id] || !hasChanges(bot)}
                onClick={() => void handleSave(bot.id)}
              >
                {isSaving[bot.id] ? t("providersSaving") : t("providersSave")}
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
      {feishuEnabled && (
        <div className="bridge-actions">
          <button type="button" className="bridge-button bridge-button--outline" onClick={() => void handleAddBot()}>
            {t("remoteChannelsAddFeishuBot")}
          </button>
        </div>
      )}

      {/* ── 访问与行为 ── */}
      {feishuEnabled && (
        <div className="bridge-card">
          <div className="bridge-card-header">
            <h3>{t("feishu.accessBehavior")}</h3>
            <p className="bridge-card-desc">{t("feishu.accessBehaviorDesc")}</p>
          </div>
          <div className="bridge-fields">
            {/* 域名 */}
            <div className="bridge-field">
              <label>{t("feishu.domain")}</label>
              <select
                className="bridge-select"
                value={domain}
                onChange={(e) => setDomain(e.target.value as "feishu" | "lark")}
              >
                <option value="feishu">{t("feishu.domainFeishu")}</option>
                <option value="lark">{t("feishu.domainLark")}</option>
              </select>
            </div>

            {/* 私信策略 */}
            <div className="bridge-field-group">
              <label className="bridge-field-group-label">{t("feishu.dmPolicy")}</label>
              <select
                className="bridge-select"
                value={dmPolicy}
                onChange={(e) => setDmPolicy(e.target.value as typeof dmPolicy)}
              >
                <option value="open">{t("feishu.dmPolicyOpen")}</option>
                <option value="pairing">{t("feishu.dmPolicyPairing")}</option>
                <option value="allowlist">{t("feishu.dmPolicyAllowlist")}</option>
                <option value="disabled">{t("feishu.dmPolicyDisabled")}</option>
              </select>
            </div>

            {/* 允许来源 */}
            <div className="bridge-field">
              <label>{t("feishu.allowFrom")}</label>
              <input
                className="bridge-input"
                value={allowFrom}
                onChange={(e) => setAllowFrom(e.target.value)}
                placeholder="*, ou_xxxxxxxxxx, ou_yyyyyyyyyy"
              />
              <p className="bridge-field-hint">{t("feishu.allowFromHint")}</p>
            </div>

            <div className="bridge-divider" />

            {/* 群聊策略 */}
            <div className="bridge-field-group">
              <label className="bridge-field-group-label">{t("feishu.groupPolicy")}</label>
              <select
                className="bridge-select"
                value={groupPolicy}
                onChange={(e) => setGroupPolicy(e.target.value as typeof groupPolicy)}
              >
                <option value="open">{t("feishu.groupPolicyOpen")}</option>
                <option value="allowlist">{t("feishu.groupPolicyAllowlist")}</option>
                <option value="disabled">{t("feishu.groupPolicyDisabled")}</option>
              </select>
            </div>

            {groupPolicy === "allowlist" && (
              <div className="bridge-field">
                <label>{t("feishu.groupAllowFrom")}</label>
                <input
                  className="bridge-input"
                  value={groupAllowFrom}
                  onChange={(e) => setGroupAllowFrom(e.target.value)}
                  placeholder="oc_xxxxxxxxxx, oc_yyyyyyyyyy"
                />
                <p className="bridge-field-hint">{t("feishu.groupAllowFromHint")}</p>
              </div>
            )}

            <div className="bridge-divider" />

            {/* 需要 @提及 */}
            <div className="bridge-toggle-row">
              <div className="bridge-toggle-info">
                <strong>{t("feishu.requireMention")}</strong>
                <p>{t("feishu.requireMentionDesc")}</p>
              </div>
              <label className="bridge-switch">
                <input
                  type="checkbox"
                  checked={requireMention}
                  onChange={(e) => setRequireMention(e.target.checked)}
                />
                <span className="bridge-switch-slider" />
              </label>
            </div>

            <div className="bridge-divider" />

            {/* 话题会话 */}
            <div className="bridge-toggle-row">
              <div className="bridge-toggle-info">
                <strong>{t("feishu.threadSession")}</strong>
                <p>{t("feishu.threadSessionDesc")}</p>
              </div>
              <label className="bridge-switch">
                <input
                  type="checkbox"
                  checked={threadSession}
                  onChange={(e) => setThreadSession(e.target.checked)}
                />
                <span className="bridge-switch-slider" />
              </label>
            </div>
          </div>
          <div className="bridge-actions">
            <button
              type="button"
              className="bridge-button bridge-button--sm"
              disabled={behaviorSaving || !behaviorDirty}
              onClick={() => void handleSaveBehavior()}
            >
              {behaviorSaving ? t("providersSaving") : behaviorDirty ? t("providersSave") : t("feishu.saved")}
            </button>
          </div>
        </div>
      )}

      {/* ── 使用说明 ── */}
      {feishuEnabled && (
        <div className="bridge-card">
          <div className="bridge-card-header">
            <h3>{t("feishu.setupGuide")}</h3>
          </div>
          <ol className="bridge-guide-list">
            <li>{t("feishu.step1")}</li>
            <li>{t("feishu.step2")}</li>
            <li>{t("feishu.step3")}</li>
          </ol>
        </div>
      )}

      {status && <p className="bridge-status-msg">{status}</p>}
    </div>
  );
}
