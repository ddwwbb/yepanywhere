/**
 * RemoteAccessSetup - Single-screen component for configuring remote access.
 *
 * Reusable in both Settings and Onboarding flows.
 */

import { useEffect, useState } from "react";
import { type RelayStatus, useRemoteAccess } from "../hooks/useRemoteAccess";
import { type Translate, useI18n } from "../i18n";
import { parseUserAgent } from "../lib/deviceDetection";
import { QRCode } from "./QRCode";

const DEFAULT_RELAY_URL = "wss://relay.yepanywhere.com/ws";
const CONNECT_URL = "https://yepanywhere.com/remote/login/relay";

export interface RemoteAccessSetupProps {
  /** Custom title (default: "Remote Access") */
  title?: string;
  /** Custom description */
  description?: string;
  /** Callback when setup completes successfully */
  onSetupComplete?: () => void;
}

/**
 * Format a date for display with relative time.
 */
function formatRelativeDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString();
}

function formatRelativeDateWithT(isoDate: string, t: Translate): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMinutes < 1) {
    return t("remoteSetupJustNow");
  }
  if (diffMinutes < 60) {
    return t("remoteSetupMinutesAgo", {
      count: diffMinutes,
      suffix: diffMinutes === 1 ? "" : "s",
    });
  }
  if (diffHours < 24) {
    return t("remoteSetupHoursAgo", {
      count: diffHours,
      suffix: diffHours === 1 ? "" : "s",
    });
  }
  if (diffDays === 1) {
    return t("remoteSetupYesterday");
  }
  if (diffDays < 7) {
    return t("hostPickerLastConnectedDays", { count: diffDays });
  }
  return formatRelativeDate(isoDate);
}

/**
 * Get human-readable status text and color class.
 */
function getStatusDisplay(
  status: RelayStatus | null,
  enabled: boolean,
  hasCredentials: boolean,
  t: Translate,
): { text: string; className: string } {
  if (!enabled) {
    return {
      text: t("remoteSetupStatusDisabled"),
      className: "status-disabled",
    };
  }
  if (!hasCredentials) {
    return {
      text: t("remoteSetupStatusNotConfigured"),
      className: "status-warning",
    };
  }
  switch (status) {
    case "waiting":
      return {
        text: t("remoteSetupStatusConnected"),
        className: "status-success",
      };
    case "connecting":
      return {
        text: t("remoteSetupStatusConnecting"),
        className: "status-pending",
      };
    case "registering":
      return {
        text: t("remoteSetupStatusRegistering"),
        className: "status-pending",
      };
    case "rejected":
      return {
        text: t("remoteSetupStatusUsernameTaken"),
        className: "status-error",
      };
    default:
      return {
        text: t("remoteSetupStatusDisconnected"),
        className: "status-warning",
      };
  }
}

type RelayOption = "default" | "custom";

export function RemoteAccessSetup({
  title = "Remote Access",
  description = "Access your server from anywhere.",
  onSetupComplete,
}: RemoteAccessSetupProps) {
  const { t } = useI18n();
  const {
    config,
    relayConfig,
    relayStatus,
    sessions,
    loading,
    error: hookError,
    configure,
    enable,
    disable,
    updateRelayConfig,
    revokeSession,
    revokeAllSessions,
    refresh,
  } = useRemoteAccess();

  // Form state
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [relayOption, setRelayOption] = useState<RelayOption>("default");
  const [customRelayUrl, setCustomRelayUrl] = useState("");

  // UI state
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  // Password for QR code generation (kept in memory after successful save)
  const [savedPassword, setSavedPassword] = useState<string | null>(null);
  const [showQRCode, setShowQRCode] = useState(false);

  // Initialize form from existing config
  useEffect(() => {
    if (relayConfig) {
      setUsername(relayConfig.username);
      if (relayConfig.url === DEFAULT_RELAY_URL) {
        setRelayOption("default");
        setCustomRelayUrl("");
      } else {
        setRelayOption("custom");
        setCustomRelayUrl(relayConfig.url);
      }
    }
  }, [relayConfig]);

  // Track changes
  useEffect(() => {
    const usernameChanged = username !== (relayConfig?.username ?? "");
    const passwordChanged = password.length > 0;

    const currentRelayUrl =
      relayOption === "default" ? DEFAULT_RELAY_URL : customRelayUrl;
    const savedRelayUrl = relayConfig?.url ?? DEFAULT_RELAY_URL;
    const relayUrlChanged = currentRelayUrl !== savedRelayUrl;

    setHasChanges(usernameChanged || passwordChanged || relayUrlChanged);
  }, [username, password, relayOption, customRelayUrl, relayConfig]);

  // Poll for status updates when connecting
  useEffect(() => {
    if (
      relayStatus?.status === "connecting" ||
      relayStatus?.status === "registering"
    ) {
      const interval = setInterval(refresh, 2000);
      return () => clearInterval(interval);
    }
  }, [relayStatus?.status, refresh]);

  const isEnabled = config?.enabled ?? false;
  const hasCredentials = !!config?.username;

  // Get the relay URL based on current selection
  const getRelayUrl = () =>
    relayOption === "default" ? DEFAULT_RELAY_URL : customRelayUrl;

  // Save changes (relay config + password)
  const saveChanges = async () => {
    setError(null);

    // Validation
    if (!username.trim()) {
      setError(t("remoteSetupErrorUsernameRequired"));
      return false;
    }
    if (username.length < 3) {
      setError(t("remoteSetupErrorUsernameShort"));
      return false;
    }
    if (!hasCredentials && !password) {
      setError(t("remoteSetupErrorPasswordRequired"));
      return false;
    }
    if (password && password.length < 8) {
      setError(t("remoteSetupErrorPasswordShort"));
      return false;
    }
    if (password && password !== confirmPassword) {
      setError(t("remoteSetupErrorPasswordMismatch"));
      return false;
    }
    if (relayOption === "custom" && !customRelayUrl.trim()) {
      setError(t("remoteSetupErrorCustomRelayRequired"));
      return false;
    }

    try {
      // Update relay config if changed
      const relayUrl = getRelayUrl();
      const relayChanged =
        username !== relayConfig?.username || relayUrl !== relayConfig?.url;
      if (relayChanged) {
        await updateRelayConfig({ url: relayUrl, username });
      }

      // Configure with password if provided
      if (password) {
        await configure(password);
        // Keep password in memory for QR code generation
        setSavedPassword(password);
      }

      // Clear password fields after save
      setPassword("");
      setConfirmPassword("");
      setHasChanges(false);
      return true;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("remoteSetupErrorSaveFailed"),
      );
      return false;
    }
  };

  const handleToggle = async (checked: boolean) => {
    setError(null);
    setIsSaving(true);

    try {
      if (checked) {
        // Turning on
        if (hasChanges) {
          // Has pending edits - save them first, then enable
          const saved = await saveChanges();
          if (!saved) {
            setIsSaving(false);
            return;
          }
          // configure() already enables, so we're done
          onSetupComplete?.();
        } else if (hasCredentials) {
          // No changes, just re-enable
          await enable();
          onSetupComplete?.();
        }
        // If no credentials and no changes, toggle does nothing
        // (they need to fill in the form first)
      } else {
        // Turning off
        await disable();
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("remoteSetupErrorUpdateFailed"),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    const saved = await saveChanges();
    if (saved) {
      onSetupComplete?.();
    }
    setIsSaving(false);
  };

  const handleCopyUrl = async (url: string) => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="remote-access-setup">
        <div className="remote-access-header">
          <div>
            <h3>{title}</h3>
            <p>{description}</p>
          </div>
        </div>
        <div className="remote-access-loading">{t("remoteSetupLoading")}</div>
      </div>
    );
  }

  const status = getStatusDisplay(
    relayStatus?.status ?? null,
    isEnabled,
    hasCredentials,
    t,
  );

  // Build connect URL with query params (for manual entry - no password)
  const connectUrl = (() => {
    const params = new URLSearchParams();
    if (username) {
      params.set("u", username);
    }
    const relayUrl = getRelayUrl();
    if (relayUrl !== DEFAULT_RELAY_URL) {
      params.set("r", relayUrl);
    }
    const queryString = params.toString();
    return queryString ? `${CONNECT_URL}?${queryString}` : CONNECT_URL;
  })();

  // Build QR code URL with credentials in hash (for auto-login)
  const qrCodeUrl = (() => {
    if (!savedPassword || !username) return null;
    const hashParams = new URLSearchParams();
    hashParams.set("u", username);
    hashParams.set("p", savedPassword);
    const relayUrl = getRelayUrl();
    if (relayUrl !== DEFAULT_RELAY_URL) {
      hashParams.set("r", relayUrl);
    }
    return `${CONNECT_URL}#${hashParams.toString()}`;
  })();

  // Can show QR code when connected and we have the password in memory
  const canShowQRCode =
    isEnabled && relayStatus?.status === "waiting" && qrCodeUrl !== null;

  // Can toggle on if: has credentials OR has filled in required fields
  const canToggleOn = hasCredentials || (username && password);

  return (
    <div className="remote-access-setup">
      <div className="remote-access-header">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <label className="toggle-switch">
          <input
            type="checkbox"
            checked={isEnabled}
            onChange={(e) => handleToggle(e.target.checked)}
            disabled={isSaving || (!isEnabled && !canToggleOn)}
          />
          <span className="toggle-slider" />
        </label>
      </div>

      <form onSubmit={handleSave} className="remote-access-form">
        <div className="form-field">
          <label htmlFor="remote-username">{t("remoteSetupUsername")}</label>
          <input
            id="remote-username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            placeholder={t("remoteSetupUsernamePlaceholder")}
            minLength={3}
            maxLength={32}
            pattern="[a-z0-9][a-z0-9-]*[a-z0-9]|[a-z0-9]{1,2}"
            title={t("remoteSetupUsernameHint")}
            autoComplete="username"
            disabled={isSaving}
          />
        </div>

        <div className="form-field">
          <label htmlFor="remote-password">
            {hasCredentials
              ? t("remoteSetupNewPassword")
              : t("remoteSetupPassword")}
          </label>
          <input
            id="remote-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={hasCredentials ? "••••••••" : ""}
            minLength={8}
            autoComplete="new-password"
            disabled={isSaving}
          />
        </div>

        {password && (
          <div className="form-field">
            <label htmlFor="remote-confirm">
              {t("remoteSetupConfirmPassword")}
            </label>
            <input
              id="remote-confirm"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              minLength={8}
              autoComplete="new-password"
              disabled={isSaving}
            />
          </div>
        )}

        <div className="form-field">
          <label htmlFor="relay-select">{t("remoteSetupRelayServer")}</label>
          <select
            id="relay-select"
            value={relayOption}
            onChange={(e) => setRelayOption(e.target.value as RelayOption)}
            disabled={isSaving}
            className="form-select"
          >
            <option value="default">{t("remoteSetupRelayDefault")}</option>
            <option value="custom">{t("remoteSetupRelayCustom")}</option>
          </select>
        </div>

        {relayOption === "custom" && (
          <div className="form-field">
            <label htmlFor="custom-relay-url">
              {t("remoteSetupCustomRelayUrl")}
            </label>
            <input
              id="custom-relay-url"
              type="text"
              value={customRelayUrl}
              onChange={(e) => setCustomRelayUrl(e.target.value)}
              placeholder={t("remoteSetupCustomRelayPlaceholder")}
              disabled={isSaving}
            />
          </div>
        )}

        <div className="remote-access-status">
          <span className="status-label">{t("remoteSetupStatus")}</span>
          <span className={`status-indicator ${status.className}`}>
            {status.text}
          </span>
          {relayStatus?.error && (
            <span className="status-error-detail">{relayStatus.error}</span>
          )}
        </div>

        {(error || hookError) && (
          <p className="form-error">{error || hookError}</p>
        )}

        {isEnabled && username && (
          <div className="remote-access-connect">
            <span className="connect-label">{t("remoteSetupConnectFrom")}</span>
            <div className="connect-url-row">
              <code className="connect-url">{connectUrl}</code>
              <button
                type="button"
                className="copy-button"
                onClick={() => handleCopyUrl(connectUrl)}
                title={t("remoteSetupCopyUrl")}
              >
                {copied ? t("remoteSetupCopied") : t("remoteSetupCopy")}
              </button>
            </div>
          </div>
        )}

        {canShowQRCode && (
          <div className="remote-access-qr">
            <button
              type="button"
              className="qr-toggle-button"
              onClick={() => setShowQRCode(!showQRCode)}
            >
              {showQRCode ? t("remoteSetupHideQr") : t("remoteSetupShowQr")}
            </button>
            {showQRCode && qrCodeUrl && (
              <div className="qr-code-container">
                <QRCode value={qrCodeUrl} size={200} />
                <p className="qr-code-hint">{t("remoteSetupQrHint")}</p>
              </div>
            )}
          </div>
        )}

        <div className="remote-access-sessions">
          <div className="sessions-header">
            <span className="sessions-title">
              {t("remoteSetupSessions", { count: sessions.length })}
            </span>
            {sessions.length > 0 && (
              <button
                type="button"
                className="revoke-all-button"
                onClick={() => revokeAllSessions()}
                disabled={isSaving}
              >
                {t("remoteSetupRevokeAll")}
              </button>
            )}
          </div>
          {sessions.length === 0 ? (
            <p className="sessions-empty">{t("remoteSetupNoSessions")}</p>
          ) : (
            <ul className="sessions-list">
              {sessions.map((session) => {
                const { browser, os } = session.userAgent
                  ? parseUserAgent(session.userAgent)
                  : {
                      browser: t("remoteSetupUnknownBrowser"),
                      os: t("remoteSetupUnknownOs"),
                    };
                const hasDeviceInfo = session.userAgent || session.origin;

                return (
                  <li key={session.sessionId} className="session-item">
                    <div className="session-info">
                      {hasDeviceInfo ? (
                        <>
                          <span className="session-device">
                            {browser} · {os}
                          </span>
                          {session.origin && (
                            <code className="session-origin">
                              {session.origin}
                            </code>
                          )}
                          <span className="session-dates">
                            {t("remoteSetupCreated", {
                              date: formatRelativeDateWithT(
                                session.createdAt,
                                t,
                              ),
                            })}{" "}
                            ·{" "}
                            {t("remoteSetupLastUsed", {
                              date: formatRelativeDateWithT(
                                session.lastUsed,
                                t,
                              ),
                            })}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="session-created">
                            {t("remoteSetupCreatedLabel")}{" "}
                            {new Date(session.createdAt).toLocaleDateString()}
                          </span>
                          <span className="session-last-used">
                            {t("remoteSetupLastUsedLabel")}{" "}
                            {new Date(session.lastUsed).toLocaleDateString()}
                          </span>
                        </>
                      )}
                    </div>
                    <button
                      type="button"
                      className="revoke-button"
                      onClick={() => revokeSession(session.sessionId)}
                      disabled={isSaving}
                    >
                      {t("remoteSetupRevoke")}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="remote-access-actions">
          <button
            type="submit"
            className="settings-button"
            disabled={isSaving || !hasChanges}
          >
            {isSaving ? t("remoteSetupSaving") : t("remoteSetupSave")}
          </button>
        </div>
      </form>
    </div>
  );
}
