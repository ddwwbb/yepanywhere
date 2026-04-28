import { useState, useCallback, useEffect, useRef } from "react";
import { api } from "../../api/client";
import { useI18n } from "../../i18n";

interface FeishuSettings {
  enabled: boolean;
  domain: "feishu" | "lark";
  dmPolicy: "open" | "pairing" | "allowlist" | "disabled";
  allowFrom: string;
  groupPolicy: "open" | "allowlist" | "disabled";
  groupAllowFrom: string;
  requireMention: boolean;
  threadSession: boolean;
  bots: {
    id: string;
    name?: string;
    enabled?: boolean;
    proxyUrl?: string;
    appId?: string;
    appSecret?: string;
    appChatId?: string;
    boundSessionId?: string;
  }[];
}

const DEFAULT_SETTINGS: FeishuSettings = {
  enabled: false,
  domain: "feishu",
  dmPolicy: "open",
  allowFrom: "*",
  groupPolicy: "open",
  groupAllowFrom: "",
  requireMention: true,
  threadSession: false,
  bots: [],
};

export function FeishuBridgeSection() {
  const { t } = useI18n();
  const abortRef = useRef<AbortController | null>(null);

  const [feishuEnabled, setFeishuEnabled] = useState(false);
  const [bots, setBots] = useState<FeishuSettings["bots"]>([]);

  // ── App Binding state ──
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [appChatId, setAppChatId] = useState("");
  const [domain, setDomain] = useState<"feishu" | "lark">("feishu");
  const [isRegistering, setIsRegistering] = useState(false);
  const [regStatus, setRegStatus] = useState<{
    variant: "success" | "warning" | "error";
    message: string;
  } | null>(null);

  // ── Access & Behavior state ──
  const [dmPolicy, setDmPolicy] = useState(DEFAULT_SETTINGS.dmPolicy);
  const [allowFrom, setAllowFrom] = useState(DEFAULT_SETTINGS.allowFrom);
  const [groupPolicy, setGroupPolicy] = useState(DEFAULT_SETTINGS.groupPolicy);
  const [groupAllowFrom, setGroupAllowFrom] = useState(DEFAULT_SETTINGS.groupAllowFrom);
  const [requireMention, setRequireMention] = useState(DEFAULT_SETTINGS.requireMention);
  const [threadSession, setThreadSession] = useState(DEFAULT_SETTINGS.threadSession);
  const [behaviorSaving, setBehaviorSaving] = useState(false);
  const [behaviorDirty, setBehaviorDirty] = useState(false);
  const savedBehavior = useRef({
    dmPolicy: DEFAULT_SETTINGS.dmPolicy,
    allowFrom: DEFAULT_SETTINGS.allowFrom,
    groupPolicy: DEFAULT_SETTINGS.groupPolicy,
    groupAllowFrom: DEFAULT_SETTINGS.groupAllowFrom,
    requireMention: DEFAULT_SETTINGS.requireMention,
    threadSession: DEFAULT_SETTINGS.threadSession,
  });

  // ── Credentials state ──
  const [credentialsSaving, setCredentialsSaving] = useState(false);
  const [credentialsDirty, setCredentialsDirty] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const savedCredentials = useRef({ appId: "", appSecret: "", appChatId: "", domain: "feishu" as "feishu" | "lark" });

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  // ── Dirty tracking ──
  useEffect(() => {
    const s = savedCredentials.current;
    setCredentialsDirty(
      appId !== s.appId || appSecret !== s.appSecret || appChatId !== s.appChatId || domain !== s.domain
    );
  }, [appId, appSecret, appChatId, domain]);

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
      const primaryBot = feishu?.bots?.[0];

      const loaded: FeishuSettings = {
        enabled: feishu?.enabled ?? false,
        domain: feishu?.domain ?? "feishu",
        dmPolicy: feishu?.dmPolicy ?? "open",
        allowFrom: feishu?.allowFrom ?? "*",
        groupPolicy: feishu?.groupPolicy ?? "open",
        groupAllowFrom: feishu?.groupAllowFrom ?? "",
        requireMention: feishu?.requireMention ?? true,
        threadSession: feishu?.threadSession ?? false,
        bots: feishu?.bots ?? [],
      };

      setFeishuEnabled(feishu?.enabled ?? false);
      setBots(loaded.bots);

      setAppId(primaryBot?.appId ?? "");
      setAppSecret(primaryBot?.appSecret ?? "");
      setAppChatId(primaryBot?.appChatId ?? "");
      setDomain(loaded.domain);
      setDmPolicy(loaded.dmPolicy);
      setAllowFrom(loaded.allowFrom);
      setGroupPolicy(loaded.groupPolicy);
      setGroupAllowFrom(loaded.groupAllowFrom);
      setRequireMention(loaded.requireMention);
      setThreadSession(loaded.threadSession);

      savedCredentials.current = {
        appId: primaryBot?.appId ?? "",
        appSecret: primaryBot?.appSecret ?? "",
        appChatId: primaryBot?.appChatId ?? "",
        domain: loaded.domain,
      };
      savedBehavior.current = {
        dmPolicy: loaded.dmPolicy,
        allowFrom: loaded.allowFrom,
        groupPolicy: loaded.groupPolicy,
        groupAllowFrom: loaded.groupAllowFrom,
        requireMention: loaded.requireMention,
        threadSession: loaded.threadSession,
      };
      setCredentialsDirty(false);
      setBehaviorDirty(false);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

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

  // ── Toggle channel enabled ──
  const handleToggleEnabled = async () => {
    try {
      const response = await api.getServerSettings();
      const rc = response.settings.remoteChannels ?? {};
      const feishu = rc.feishu ?? {};
      await api.updateServerSettings({
        remoteChannels: { ...rc, feishu: { ...feishu, enabled: !feishuEnabled, bots: feishu.bots ?? [] } },
      });
      setFeishuEnabled(!feishuEnabled);
      await fetchSettings();
    } catch {
      // ignore
    }
  };

  // ── Save Credentials ──
  const handleSaveCredentials = async () => {
    setCredentialsSaving(true);
    try {
      const response = await api.getServerSettings();
      const rc = response.settings.remoteChannels ?? {};
      const feishu = rc.feishu ?? {};
      const bots = feishu.bots ?? [];
      const updates: Record<string, unknown> = {
        ...feishu,
        domain,
      };
      if (bots.length > 0) {
        const updatedBots = bots.map((b: typeof bots[0], i: number) =>
          i === 0
            ? {
                ...b,
                appId,
                appChatId,
                ...(appSecret && !appSecret.startsWith("***") ? { appSecret } : {}),
              }
            : b
        );
        updates.bots = updatedBots;
      } else {
        updates.bots = [
          {
            id: `feishu_${Date.now()}`,
            enabled: true,
            appId,
            appChatId,
            ...(appSecret && !appSecret.startsWith("***") ? { appSecret } : {}),
          },
        ];
      }
      await api.updateServerSettings({
        remoteChannels: { ...rc, feishu: { ...updates, enabled: true } },
      });
      setFeishuEnabled(true);
      savedCredentials.current = { appId, appSecret, appChatId, domain };
      setCredentialsDirty(false);
      await fetchSettings();
    } catch {
      // ignore
    } finally {
      setCredentialsSaving(false);
    }
  };

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

  // ── Verify ──
  const handleVerify = async () => {
    setVerifying(true);
    setVerifyResult(null);
    try {
      if (!appId) {
        setVerifyResult({ ok: false, message: t("feishu.enterCredentialsFirst") });
        return;
      }
      await api.testFeishuAppRemoteChannel();
      setVerifyResult({ ok: true, message: t("feishu.verified") });
    } catch (err) {
      setVerifyResult({
        ok: false,
        message: err instanceof Error ? err.message : t("feishu.verifyFailed"),
      });
    } finally {
      setVerifying(false);
    }
  };

  // ── Delete Bot ──
  const handleDeleteBot = async (botId: string) => {
    try {
      const response = await api.getServerSettings();
      const rc = response.settings.remoteChannels ?? {};
      const feishu = rc.feishu ?? {};
      const updatedBots = (feishu.bots ?? []).filter((b: { id: string }) => b.id !== botId);
      await api.updateServerSettings({
        remoteChannels: { ...rc, feishu: { ...feishu, bots: updatedBots } },
      });
      await fetchSettings();
    } catch {
      // ignore
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
          <label className="toggle-switch">
            <input type="checkbox" checked={feishuEnabled} onChange={() => void handleToggleEnabled()} />
            <span className="toggle-slider" />
          </label>
        </div>
      </div>

      {/* ── 飞书应用绑定 ── */}
      <div className="bridge-card">
        <div className="bridge-card-header">
          <h3>{t("feishu.quickCreate")}</h3>
          {bots.length === 0 && <p className="bridge-card-desc">{t("feishu.quickCreateDesc")}</p>}
        </div>
        {bots.length > 0 && (
          <div className="bridge-section-body">
            {bots.map((bot, idx) => (
              <div key={bot.id} className="bridge-bound-row">
                <div className="bridge-bound-info">
                  <span className="bridge-bound-label">{t("feishu.appId")}:</span>
                  <span className="bridge-bound-value">{bot.appId ?? `Bot ${idx + 1}`}</span>
                </div>
                <div className="bridge-bound-info">
                  <span className="bridge-bound-label">{t("feishu.domain")}:</span>
                  <span className="bridge-bound-value">
                    {domain === "lark" ? "Lark" : t("feishu.domainFeishu")}
                  </span>
                </div>
                <div className="bridge-bound-actions">
                  {idx === 0 && (
                    <button
                      type="button"
                      className="bridge-button bridge-button--outline bridge-button--sm"
                      onClick={() => void handleQuickCreate()}
                      disabled={isRegistering}
                    >
                      {t("feishu.rebind")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="bridge-button bridge-button--outline bridge-button--sm bridge-button--danger"
                    onClick={() => void handleDeleteBot(bot.id)}
                  >
                    {t("feishu.unbind")}
                  </button>
                </div>
              </div>
            ))}
            {isRegistering && (
              <div className="bridge-registering-row">
                <span className="bridge-spinner" />
                {t("feishu.waitingAuth")}
              </div>
            )}
            {regStatus && <StatusBanner variant={regStatus.variant} message={regStatus.message} />}
          </div>
        )}
        {bots.length === 0 && (
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
                  <span className="bridge-spinner" />
                  {t("feishu.waitingAuth")}
                </div>
              )}
            </div>
            {regStatus && <StatusBanner variant={regStatus.variant} message={regStatus.message} />}
          </div>
        )}
      </div>

      {/* ── 手动配置（折叠） ── */}
      <details className="bridge-details">
        <summary className="bridge-details-summary">
          {t("feishu.manualConfig")}
        </summary>
        <div className="bridge-card bridge-details-content">
          <div className="bridge-card-header">
            <h3>{t("feishu.credentials")}</h3>
            <p className="bridge-card-desc">{t("feishu.credentialsDesc")}</p>
          </div>
          <div className="bridge-fields">
            <div className="bridge-field">
              <label>{t("feishu.appId")}</label>
              <input
                className="bridge-input"
                value={appId}
                onChange={(e) => setAppId(e.target.value)}
                placeholder="cli_xxxxxxxxxx"
              />
            </div>
            <div className="bridge-field">
              <label>{t("feishu.appSecret")}</label>
              <input
                className="bridge-input"
                type="password"
                value={appSecret}
                onChange={(e) => setAppSecret(e.target.value)}
                placeholder="xxxxxxxxxxxxxxxxxxxxxxxx"
              />
            </div>
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
            <div className="bridge-field">
              <label>{t("remoteChannelsFeishuAppChatIdTitle")}</label>
              <input
                className="bridge-input"
                value={appChatId}
                onChange={(e) => setAppChatId(e.target.value)}
                placeholder="oc_..."
              />
              <p className="bridge-field-hint">{t("remoteChannelsFeishuAppChatIdDescription")}</p>
            </div>
          </div>
          <div className="bridge-actions">
            <button
              type="button"
              className="bridge-button bridge-button--sm"
              disabled={credentialsSaving || !credentialsDirty}
              onClick={() => void handleSaveCredentials()}
            >
              {credentialsSaving ? t("providersSaving") : credentialsDirty ? t("providersSave") : t("feishu.saved")}
            </button>
            <button
              type="button"
              className="bridge-button bridge-button--outline bridge-button--sm"
              onClick={() => void handleVerify()}
              disabled={verifying || !appId}
            >
              {verifying ? t("remoteChannelsVerifying") : t("remoteChannelsVerify")}
            </button>
          </div>
          {verifyResult && (
            <StatusBanner
              variant={verifyResult.ok ? "success" : "error"}
              message={verifyResult.message}
            />
          )}
        </div>
      </details>

      {/* ── 访问与行为 ── */}
      <div className="bridge-card">
        <div className="bridge-card-header">
          <h3>{t("feishu.accessBehavior")}</h3>
          <p className="bridge-card-desc">{t("feishu.accessBehaviorDesc")}</p>
        </div>
        <div className="bridge-fields">
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
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={requireMention}
                onChange={(e) => setRequireMention(e.target.checked)}
              />
              <span className="toggle-slider" />
            </label>
          </div>

          <div className="bridge-divider" />

          {/* 话题会话 */}
          <div className="bridge-toggle-row">
            <div className="bridge-toggle-info">
              <strong>{t("feishu.threadSession")}</strong>
              <p>{t("feishu.threadSessionDesc")}</p>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={threadSession}
                onChange={(e) => setThreadSession(e.target.checked)}
              />
              <span className="toggle-slider" />
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

      {/* ── 使用说明 ── */}
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
    </div>
  );
}
