/**
 * Server settings API routes
 */

import {
  ALL_PERMISSION_MODES,
  ALL_PROVIDERS,
  type NewSessionDefaults,
  type PermissionMode,
  type ProviderName,
} from "@yep-anywhere/shared";

const MASKED_SECRET_PREFIX = "***";
const FEISHU_REGISTRATION_GLOBAL_KEY = "__yep_feishu_registration_sessions__";
const WEIXIN_LOGIN_GLOBAL_KEY = "__yep_weixin_login_sessions__";
const FEISHU_REGISTRATION_PATH = "/oauth/v1/app/registration";
const FEISHU_ACCOUNTS_BASE = "https://accounts.feishu.cn";
const LARK_ACCOUNTS_BASE = "https://accounts.larksuite.com";
const WEIXIN_QR_BASE = "https://ilinkai.weixin.qq.com";
const FEISHU_REGISTRATION_CLEANUP_MS = 10 * 60_000;
const WEIXIN_QR_TTL_MS = 5 * 60_000;
import { Hono } from "hono";
import QRCode from "qrcode";
import { postThroughTunnel } from "../remote-channels/proxy-tunnel.js";
import { testSSHConnection } from "../sdk/remote-spawn.js";
import type {
  RemoteChannelFeishuBot,
  RemoteChannelTelegramBot,
  RemoteChannelQqBot,
  RemoteChannelWeixinBot,
  ServerSettings,
  ServerSettingsService,
} from "../services/ServerSettingsService.js";
import {
  isValidSshHostAlias,
  normalizeSshHostAlias,
} from "../utils/sshHostAlias.js";

export interface SettingsRoutesDeps {
  serverSettingsService: ServerSettingsService;
  remoteChannelService?: {
    sendTestNotification(botId?: string): Promise<{ ok: boolean; error?: string }>;
  };
  /** Callback to apply allowedHosts changes at runtime */
  onAllowedHostsChanged?: (value: string | undefined) => void;
  /** Callback to apply remote session persistence changes at runtime */
  onRemoteSessionPersistenceChanged?: (
    enabled: boolean,
  ) => Promise<void> | void;
  /** Callback to apply Ollama URL changes at runtime */
  onOllamaUrlChanged?: (url: string | undefined) => void;
  /** Callback to apply Ollama system prompt changes at runtime */
  onOllamaSystemPromptChanged?: (prompt: string | undefined) => void;
  /** Callback to apply Ollama full system prompt toggle at runtime */
  onOllamaUseFullSystemPromptChanged?: (enabled: boolean) => void;
}

function parseHostAliasList(rawHosts: unknown[]): {
  hosts: string[];
  invalidHost?: string;
} {
  const hosts: string[] = [];

  for (const rawHost of rawHosts) {
    if (typeof rawHost !== "string") continue;

    const host = normalizeSshHostAlias(rawHost);
    if (!host) continue;
    if (!isValidSshHostAlias(host)) {
      return { hosts: [], invalidHost: host };
    }

    hosts.push(host);
  }

  return { hosts };
}

/**
 * Returns:
 * - `null` when the payload is invalid
 * - `undefined` when the setting should be cleared
 * - an object when valid defaults should be saved
 */
function parseRemoteChannelProxyUrl(raw: unknown): string | undefined | null {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string") return null;

  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" &&
      url.protocol !== "http:" &&
      url.protocol !== "socks5:"
    ) {
      return null;
    }
    return url.toString().slice(0, 2000);
  } catch {
    return null;
  }
}

function parseOptionalString(
  raw: unknown,
  maxLength: number,
): string | undefined | null {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string") return null;
  return raw.trim().slice(0, maxLength) || undefined;
}

function maskSecret(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return `${MASKED_SECRET_PREFIX}${value.slice(-8)}`;
}

function redactSettings(settings: ServerSettings): ServerSettings {
  const feishu = settings.remoteChannels?.feishu;
  const telegram = settings.remoteChannels?.telegram;
  const qq = settings.remoteChannels?.qq;
  const hasFeishuSecret = feishu?.bots?.some((b) => b.appSecret);
  const hasTelegramSecret = telegram?.bots?.some((b) => b.botToken);
  const hasQqSecret = qq?.bots?.some((b) => b.appSecret);
  if (!hasFeishuSecret && !hasTelegramSecret && !hasQqSecret) {
    return settings;
  }

  return {
    ...settings,
    remoteChannels: {
      ...settings.remoteChannels,
      feishu: feishu
        ? { ...feishu, bots: feishu.bots?.map((b) => ({ ...b, appSecret: maskSecret(b.appSecret) })) }
        : undefined,
      telegram: telegram
        ? { ...telegram, bots: telegram.bots?.map((b) => ({ ...b, botToken: maskSecret(b.botToken) })) }
        : undefined,
      qq: qq
        ? { ...qq, bots: qq.bots?.map((b) => ({ ...b, appSecret: maskSecret(b.appSecret) })) }
        : undefined,
    },
  };
}

interface FeishuRegistrationSession {
  deviceCode: string;
  verificationUrl: string;
  interval: number;
  expiresAt: number;
  status: "waiting" | "completed" | "expired" | "failed";
  appId?: string;
  appSecret?: string;
  domain?: "feishu" | "lark";
  error?: string;
}

interface WeixinLoginSession {
  qrcode: string;
  qrImage: string;
  startedAt: number;
  status: "waiting" | "scanned" | "confirmed" | "expired" | "failed";
  accountId?: string;
  peerUserId?: string;
  error?: string;
}

function getGlobalMap<T>(key: string): Map<string, T> {
  const globalStore = globalThis as Record<string, unknown>;
  if (!globalStore[key]) globalStore[key] = new Map<string, T>();
  return globalStore[key] as Map<string, T>;
}

function createSessionId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function getFeishuTenantAccessToken(
  appId: string,
  appSecret: string,
): Promise<{ ok: true; token: string } | { ok: false; error?: string }> {
  const response = await fetch(
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    },
  );

  if (!response.ok) {
    return { ok: false, error: `Feishu auth returned HTTP ${response.status}` };
  }

  const body = (await response.json()) as {
    code?: number;
    msg?: string;
    tenant_access_token?: string;
  };
  if (body.code !== 0 || !body.tenant_access_token) {
    return { ok: false, error: body.msg ?? `Feishu auth failed with code ${body.code}` };
  }

  return { ok: true, token: body.tenant_access_token };
}

async function sendFeishuAppTestMessage(
  appId: string,
  appSecret: string,
  chatId: string | undefined,
): Promise<{ ok: boolean; error?: string }> {
  const tokenResult = await getFeishuTenantAccessToken(appId, appSecret);
  if (!tokenResult.ok) return tokenResult;
  if (!chatId) return { ok: true };

  const response = await fetch(
    "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenResult.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        receive_id: chatId,
        msg_type: "text",
        content: JSON.stringify({ text: "Yep Anywhere Feishu App test message" }),
      }),
    },
  );

  if (!response.ok) {
    return { ok: false, error: `Feishu message returned HTTP ${response.status}` };
  }

  const body = (await response.json()) as { code?: number; msg?: string };
  if (body.code !== 0) {
    return { ok: false, error: body.msg ?? `Feishu message failed with code ${body.code}` };
  }

  return { ok: true };
}

async function startFeishuRegistration(): Promise<{
  sessionId: string;
  verificationUrl: string;
  interval: number;
}> {
  const response = await fetch(`${FEISHU_ACCOUNTS_BASE}${FEISHU_REGISTRATION_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "action=begin&archetype=PersonalAgent&auth_method=client_secret&request_user_info=open_id+tenant_brand",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Feishu registration returned HTTP ${response.status}`);

  const body = (await response.json()) as {
    device_code?: string;
    verification_uri_complete?: string;
    expires_in?: number;
    interval?: number;
  };
  if (!body.device_code || !body.verification_uri_complete) {
    throw new Error("Invalid Feishu registration response");
  }

  const sessionId = createSessionId("feishu_reg");
  const session: FeishuRegistrationSession = {
    deviceCode: body.device_code,
    verificationUrl: body.verification_uri_complete,
    interval: (body.interval || 5) * 1000,
    expiresAt: Date.now() + (body.expires_in || 300) * 1000,
    status: "waiting",
  };
  getGlobalMap<FeishuRegistrationSession>(FEISHU_REGISTRATION_GLOBAL_KEY).set(
    sessionId,
    session,
  );
  setTimeout(() => {
    getGlobalMap<FeishuRegistrationSession>(FEISHU_REGISTRATION_GLOBAL_KEY).delete(sessionId);
  }, FEISHU_REGISTRATION_CLEANUP_MS).unref();

  return {
    sessionId,
    verificationUrl: session.verificationUrl,
    interval: session.interval,
  };
}

async function pollFeishuRegistration(
  sessionId: string,
  serverSettingsService: ServerSettingsService,
): Promise<FeishuRegistrationSession> {
  const sessions = getGlobalMap<FeishuRegistrationSession>(FEISHU_REGISTRATION_GLOBAL_KEY);
  const session = sessions.get(sessionId);
  if (!session) throw new Error("Feishu registration session not found");
  if (session.status !== "waiting") return session;
  if (Date.now() > session.expiresAt) {
    session.status = "expired";
    session.error = "timeout";
    return session;
  }

  const accountsBase = session.domain === "lark" ? LARK_ACCOUNTS_BASE : FEISHU_ACCOUNTS_BASE;
  const response = await fetch(`${accountsBase}${FEISHU_REGISTRATION_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `action=poll&device_code=${encodeURIComponent(session.deviceCode)}`,
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json()) as {
    client_id?: string;
    client_secret?: string;
    user_info?: { tenant_brand?: string };
    error?: string;
  };

  if (body.error === "authorization_pending") return session;
  if (body.error === "slow_down") {
    session.interval = Math.min(session.interval + 5000, 60_000);
    return session;
  }
  if (body.error === "expired_token") {
    session.status = "expired";
    session.error = "timeout";
    return session;
  }
  if (body.error === "access_denied") {
    session.status = "failed";
    session.error = "user_denied";
    return session;
  }
  if (body.error) {
    session.status = "failed";
    session.error = body.error;
    return session;
  }

  if (!body.client_secret && body.user_info?.tenant_brand === "lark") {
    session.domain = "lark";
    return session;
  }
  if (!body.client_id || !body.client_secret) {
    session.status = "failed";
    session.error = "empty_credentials";
    return session;
  }

  const settings = serverSettingsService.getSettings();
  const existingBots = settings.remoteChannels?.feishu?.bots ?? [];
  const newBot = {
    id: `feishu_${Date.now()}`,
    name: undefined as string | undefined,
    enabled: true,
    appId: body.client_id,
    appSecret: body.client_secret,
    appChatId: undefined as string | undefined,
    proxyUrl: undefined as string | undefined,
    boundSessionId: undefined as string | undefined,
  };
  await serverSettingsService.updateSettings({
    remoteChannels: {
      ...settings.remoteChannels,
      feishu: {
        ...settings.remoteChannels?.feishu,
        enabled: settings.remoteChannels?.feishu?.enabled ?? true,
        bots: [...existingBots, newBot],
      },
    },
  });
  session.status = "completed";
  session.appId = body.client_id;
  session.appSecret = body.client_secret;
  session.domain = session.domain ?? "feishu";
  return session;
}

function telegramPost(
  botToken: string,
  method: string,
  body: string,
  proxyUrl: string | undefined,
  signal: AbortSignal,
): Promise<Response> {
  const url = new URL(`https://api.telegram.org/bot${botToken}/${method}`);
  if (!proxyUrl) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal,
    });
  }
  return postThroughTunnel(url, new URL(proxyUrl), 443, body, signal);
}

async function verifyTelegramBot(
  botToken: string,
  chatId: string | undefined,
  proxyUrl: string | undefined,
): Promise<{ verified: boolean; botName?: string; chatId?: string; error?: string }> {
  const meResponse = await telegramPost(
    botToken,
    "getMe",
    "{}",
    proxyUrl,
    AbortSignal.timeout(10_000),
  );
  const meBody = (await meResponse.json()) as {
    ok?: boolean;
    description?: string;
    result?: { username?: string; first_name?: string };
  };
  if (!meResponse.ok || !meBody.ok) {
    return { verified: false, error: meBody.description ?? `Telegram returned HTTP ${meResponse.status}` };
  }
  if (!chatId) {
    return { verified: true, botName: meBody.result?.username ?? meBody.result?.first_name };
  }

  const sendResponse = await telegramPost(
    botToken,
    "sendMessage",
    JSON.stringify({ chat_id: chatId, text: "Yep Anywhere Telegram test message" }),
    proxyUrl,
    AbortSignal.timeout(10_000),
  );
  const sendBody = (await sendResponse.json()) as { ok?: boolean; description?: string };
  if (!sendResponse.ok || !sendBody.ok) {
    return { verified: false, botName: meBody.result?.username, error: sendBody.description ?? `Telegram message returned HTTP ${sendResponse.status}` };
  }
  return { verified: true, botName: meBody.result?.username ?? meBody.result?.first_name, chatId };
}

async function detectTelegramChatId(
  botToken: string,
  proxyUrl: string | undefined,
): Promise<{ detected: boolean; chatId?: string; error?: string }> {
  const response = await telegramPost(
    botToken,
    "getUpdates",
    "{}",
    proxyUrl,
    AbortSignal.timeout(10_000),
  );
  const body = (await response.json()) as {
    ok?: boolean;
    description?: string;
    result?: Array<{ message?: { chat?: { id?: number | string } }; channel_post?: { chat?: { id?: number | string } } }>;
  };
  if (!response.ok || !body.ok) {
    return { detected: false, error: body.description ?? `Telegram returned HTTP ${response.status}` };
  }
  const chat = [...(body.result ?? [])]
    .reverse()
    .map((update) => update.message?.chat ?? update.channel_post?.chat)
    .find((item) => item?.id !== undefined);
  if (!chat?.id) return { detected: false, error: "No recent Telegram chat found" };
  return { detected: true, chatId: String(chat.id) };
}

async function verifyQqBot(
  appId: string,
  appSecret: string,
): Promise<{ verified: boolean; gatewayUrl?: string; error?: string }> {
  const tokenResponse = await fetch("https://bots.qq.com/app/getAppAccessToken", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appId, clientSecret: appSecret }),
    signal: AbortSignal.timeout(10_000),
  });
  const tokenBody = (await tokenResponse.json()) as { access_token?: string; message?: string };
  if (!tokenResponse.ok || !tokenBody.access_token) {
    return { verified: false, error: tokenBody.message ?? `QQ token returned HTTP ${tokenResponse.status}` };
  }

  const gatewayResponse = await fetch("https://api.sgroup.qq.com/gateway", {
    headers: { Authorization: `QQBot ${tokenBody.access_token}` },
    signal: AbortSignal.timeout(10_000),
  });
  const gatewayBody = (await gatewayResponse.json()) as { url?: string; message?: string };
  if (!gatewayResponse.ok || !gatewayBody.url) {
    return { verified: false, error: gatewayBody.message ?? `QQ gateway returned HTTP ${gatewayResponse.status}` };
  }
  return { verified: true, gatewayUrl: gatewayBody.url };
}

async function startWeixinLogin(): Promise<{ sessionId: string; qrImage: string }> {
  const response = await fetch(`${WEIXIN_QR_BASE}/ilink/bot/get_bot_qrcode?bot_type=3`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Weixin QR start returned HTTP ${response.status}`);
  const body = (await response.json()) as { qrcode?: string; qrcode_img_content?: string; errmsg?: string };
  if (!body.qrcode || !body.qrcode_img_content) {
    throw new Error(body.errmsg ?? "Invalid Weixin QR response");
  }

  const qrImage = await QRCode.toDataURL(body.qrcode_img_content, {
    width: 256,
    margin: 2,
  });
  const sessionId = createSessionId("weixin_qr");
  getGlobalMap<WeixinLoginSession>(WEIXIN_LOGIN_GLOBAL_KEY).set(sessionId, {
    qrcode: body.qrcode,
    qrImage,
    startedAt: Date.now(),
    status: "waiting",
  });
  return { sessionId, qrImage };
}

async function pollWeixinLogin(
  sessionId: string,
  serverSettingsService: ServerSettingsService,
): Promise<WeixinLoginSession> {
  const sessions = getGlobalMap<WeixinLoginSession>(WEIXIN_LOGIN_GLOBAL_KEY);
  const session = sessions.get(sessionId);
  if (!session) throw new Error("Weixin login session not found");
  if (session.status === "confirmed" || session.status === "failed") return session;
  if (Date.now() - session.startedAt > WEIXIN_QR_TTL_MS) {
    session.status = "expired";
    return session;
  }

  const response = await fetch(
    `${WEIXIN_QR_BASE}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(session.qrcode)}`,
    { signal: AbortSignal.timeout(40_000) },
  );
  if (!response.ok) throw new Error(`Weixin QR poll returned HTTP ${response.status}`);
  const body = (await response.json()) as {
    status?: "wait" | "scaned" | "confirmed" | "expired";
    ilink_bot_id?: string;
    ilink_user_id?: string;
    errmsg?: string;
  };

  if (body.status === "wait") session.status = "waiting";
  if (body.status === "scaned") session.status = "scanned";
  if (body.status === "expired") session.status = "expired";
  if (body.status === "confirmed") {
    const accountId = body.ilink_bot_id?.replace(/[@.]/g, "-");
    session.status = "confirmed";
    session.accountId = accountId;
    session.peerUserId = body.ilink_user_id;
    const settings = serverSettingsService.getSettings();
    await serverSettingsService.updateSettings({
      remoteChannels: {
        ...settings.remoteChannels,
        weixin: {
          ...settings.remoteChannels?.weixin,
          accountId,
          peerUserId: body.ilink_user_id,
        },
      },
    });
  }
  if (!body.status && body.errmsg) {
    session.status = "failed";
    session.error = body.errmsg;
  }
  return session;
}

function parseBotField(raw: Record<string, unknown>, field: string, maxLen: number): string | undefined | null {
  return parseOptionalString(raw[field], maxLen);
}

function parseBotProxyUrl(raw: Record<string, unknown>): string | undefined | null {
  return parseRemoteChannelProxyUrl(raw.proxyUrl);
}

function parseFeishuBots(
  botsRaw: unknown,
  existingBots: RemoteChannelFeishuBot[] | undefined,
): RemoteChannelFeishuBot[] | undefined | null {
  if (!Array.isArray(botsRaw)) return null;
  const result: NonNullable<RemoteChannelFeishuBot[] | undefined> = [];
  for (const botRaw of botsRaw) {
    if (typeof botRaw !== "object" || botRaw === null) return null;
    const b = botRaw as Record<string, unknown>;
    if (typeof b.id !== "string" || !b.id) return null;
    const proxyUrl = parseBotProxyUrl(b);
    const appId = parseBotField(b, "appId", 200);
    const appSecretInput = parseBotField(b, "appSecret", 500);
    const appChatId = parseBotField(b, "appChatId", 200);
    if (proxyUrl === null || appId === null || appSecretInput === null || appChatId === null) return null;
    const existing = existingBots?.find((eb) => eb.id === b.id);
    const appSecret = appSecretInput?.startsWith(MASKED_SECRET_PREFIX)
      ? existing?.appSecret
      : appSecretInput;
    result.push({
      id: b.id,
      name: parseBotField(b, "name", 200) ?? undefined,
      enabled: typeof b.enabled === "boolean" ? b.enabled : undefined,
      proxyUrl: proxyUrl ?? undefined,
      appId: appId ?? undefined,
      appSecret,
      appChatId: appChatId ?? undefined,
      boundSessionId: parseBotField(b, "boundSessionId", 200) ?? undefined,
    });
  }
  return result;
}

function parseTelegramBots(
  botsRaw: unknown,
  existingBots: RemoteChannelTelegramBot[] | undefined,
): RemoteChannelTelegramBot[] | undefined | null {
  if (!Array.isArray(botsRaw)) return null;
  const result: NonNullable<RemoteChannelTelegramBot[] | undefined> = [];
  for (const botRaw of botsRaw) {
    if (typeof botRaw !== "object" || botRaw === null) return null;
    const b = botRaw as Record<string, unknown>;
    if (typeof b.id !== "string" || !b.id) return null;
    const botTokenInput = parseBotField(b, "botToken", 500);
    const chatId = parseBotField(b, "chatId", 200);
    const proxyUrl = parseBotProxyUrl(b);
    if (botTokenInput === null || chatId === null || proxyUrl === null) return null;
    const existing = existingBots?.find((eb) => eb.id === b.id);
    const botToken = botTokenInput?.startsWith(MASKED_SECRET_PREFIX)
      ? existing?.botToken
      : botTokenInput;
    result.push({
      id: b.id,
      name: parseBotField(b, "name", 200) ?? undefined,
      enabled: typeof b.enabled === "boolean" ? b.enabled : undefined,
      botToken,
      chatId: chatId ?? undefined,
      proxyUrl: proxyUrl ?? undefined,
      boundSessionId: parseBotField(b, "boundSessionId", 200) ?? undefined,
    });
  }
  return result;
}

function parseQqBots(
  botsRaw: unknown,
  existingBots: RemoteChannelQqBot[] | undefined,
): RemoteChannelQqBot[] | undefined | null {
  if (!Array.isArray(botsRaw)) return null;
  const result: NonNullable<RemoteChannelQqBot[] | undefined> = [];
  for (const botRaw of botsRaw) {
    if (typeof botRaw !== "object" || botRaw === null) return null;
    const b = botRaw as Record<string, unknown>;
    if (typeof b.id !== "string" || !b.id) return null;
    const appId = parseBotField(b, "appId", 200);
    const appSecretInput = parseBotField(b, "appSecret", 500);
    const openId = parseBotField(b, "openId", 200);
    if (appId === null || appSecretInput === null || openId === null) return null;
    const existing = existingBots?.find((eb) => eb.id === b.id);
    const appSecret = appSecretInput?.startsWith(MASKED_SECRET_PREFIX)
      ? existing?.appSecret
      : appSecretInput;
    result.push({
      id: b.id,
      name: parseBotField(b, "name", 200) ?? undefined,
      enabled: typeof b.enabled === "boolean" ? b.enabled : undefined,
      appId: appId ?? undefined,
      appSecret,
      openId: openId ?? undefined,
      boundSessionId: parseBotField(b, "boundSessionId", 200) ?? undefined,
    });
  }
  return result;
}

function parseWeixinBots(
  botsRaw: unknown,
  existingBots: RemoteChannelWeixinBot[] | undefined,
): RemoteChannelWeixinBot[] | undefined | null {
  if (!Array.isArray(botsRaw)) return null;
  const result: NonNullable<RemoteChannelWeixinBot[] | undefined> = [];
  for (const botRaw of botsRaw) {
    if (typeof botRaw !== "object" || botRaw === null) return null;
    const b = botRaw as Record<string, unknown>;
    if (typeof b.id !== "string" || !b.id) return null;
    const accountId = parseBotField(b, "accountId", 200);
    const peerUserId = parseBotField(b, "peerUserId", 200);
    if (accountId === null || peerUserId === null) return null;
    result.push({
      id: b.id,
      name: parseBotField(b, "name", 200) ?? undefined,
      enabled: typeof b.enabled === "boolean" ? b.enabled : undefined,
      accountId: accountId ?? undefined,
      peerUserId: peerUserId ?? undefined,
      boundSessionId: parseBotField(b, "boundSessionId", 200) ?? undefined,
    });
  }
  return result;
}

function parseRemoteChannels(
  raw: unknown,
  existingSettings: ServerSettings,
): ServerSettings["remoteChannels"] | null {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "object") return null;

  const input = raw as Record<string, unknown>;
  const parsed: NonNullable<ServerSettings["remoteChannels"]> = {};

  if ("telegram" in input) {
    const telegramRaw = input.telegram;
    if (telegramRaw === undefined || telegramRaw === null || telegramRaw === "") {
      parsed.telegram = undefined;
    } else if (typeof telegramRaw !== "object") {
      return null;
    } else {
      const telegramInput = telegramRaw as Record<string, unknown>;
      const existingBots = existingSettings.remoteChannels?.telegram?.bots;
      const bots = "bots" in telegramInput ? parseTelegramBots(telegramInput.bots, existingBots) : undefined;
      if (bots === null) return null;
      parsed.telegram = {
        enabled: typeof telegramInput.enabled === "boolean" ? telegramInput.enabled : undefined,
        bots: bots ?? [],
      };
    }
  }

  if ("qq" in input) {
    const qqRaw = input.qq;
    if (qqRaw === undefined || qqRaw === null || qqRaw === "") {
      parsed.qq = undefined;
    } else if (typeof qqRaw !== "object") {
      return null;
    } else {
      const qqInput = qqRaw as Record<string, unknown>;
      const existingBots = existingSettings.remoteChannels?.qq?.bots;
      const bots = "bots" in qqInput ? parseQqBots(qqInput.bots, existingBots) : undefined;
      if (bots === null) return null;
      parsed.qq = {
        enabled: typeof qqInput.enabled === "boolean" ? qqInput.enabled : undefined,
        bots: bots ?? [],
      };
    }
  }

  if ("weixin" in input) {
    const weixinRaw = input.weixin;
    if (weixinRaw === undefined || weixinRaw === null || weixinRaw === "") {
      parsed.weixin = undefined;
    } else if (typeof weixinRaw !== "object") {
      return null;
    } else {
      const weixinInput = weixinRaw as Record<string, unknown>;
      const accountId = parseOptionalString(weixinInput.accountId, 200);
      const peerUserId = parseOptionalString(weixinInput.peerUserId, 200);

      if (accountId === null || peerUserId === null) return null;

      parsed.weixin = {
        enabled:
          typeof weixinInput.enabled === "boolean"
            ? weixinInput.enabled
            : undefined,
        accountId,
        peerUserId,
      };
    }
  }

  if ("feishu" in input) {
    const feishuRaw = input.feishu;
    if (feishuRaw === undefined || feishuRaw === null || feishuRaw === "") {
      parsed.feishu = undefined;
    } else if (typeof feishuRaw !== "object") {
      return null;
    } else {
      const feishuInput = feishuRaw as Record<string, unknown>;
      const existingBots = existingSettings.remoteChannels?.feishu?.bots;
      const bots = "bots" in feishuInput ? parseFeishuBots(feishuInput.bots, existingBots) : undefined;
      if (bots === null) return null;
      parsed.feishu = {
        enabled: typeof feishuInput.enabled === "boolean" ? feishuInput.enabled : undefined,
        bots: bots ?? [],
      };
    }
  }

  return parsed;
}

function parseNewSessionDefaults(
  raw: unknown,
): NewSessionDefaults | undefined | null {
  if (raw === undefined) return null;
  if (raw === null || raw === "") return undefined;
  if (typeof raw !== "object") return null;

  const input = raw as Record<string, unknown>;
  const parsed: NewSessionDefaults = {};

  if ("provider" in input) {
    if (
      input.provider !== undefined &&
      input.provider !== null &&
      input.provider !== "" &&
      !ALL_PROVIDERS.includes(input.provider as ProviderName)
    ) {
      return null;
    }
    if (typeof input.provider === "string" && input.provider.length > 0) {
      parsed.provider = input.provider as ProviderName;
    }
  }

  if ("model" in input) {
    if (
      input.model !== undefined &&
      input.model !== null &&
      input.model !== "" &&
      typeof input.model !== "string"
    ) {
      return null;
    }
    if (typeof input.model === "string" && input.model.length > 0) {
      parsed.model = input.model;
    }
  }

  if ("permissionMode" in input) {
    if (
      input.permissionMode !== undefined &&
      input.permissionMode !== null &&
      input.permissionMode !== "" &&
      !ALL_PERMISSION_MODES.includes(input.permissionMode as PermissionMode)
    ) {
      return null;
    }
    if (
      typeof input.permissionMode === "string" &&
      input.permissionMode.length > 0
    ) {
      parsed.permissionMode = input.permissionMode as PermissionMode;
    }
  }

  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

export function createSettingsRoutes(deps: SettingsRoutesDeps): Hono {
  const app = new Hono();
  const {
    serverSettingsService,
    remoteChannelService,
    onAllowedHostsChanged,
    onRemoteSessionPersistenceChanged,
    onOllamaUrlChanged,
    onOllamaSystemPromptChanged,
    onOllamaUseFullSystemPromptChanged,
  } = deps;

  /**
   * GET /api/settings
   * Get all server settings
   */
  app.get("/", (c) => {
    const settings = redactSettings(serverSettingsService.getSettings());
    return c.json({ settings });
  });

  app.post("/remote-channels/feishu/test", async (c) => {
    if (!remoteChannelService) {
      return c.json({ error: "Remote channel service is not available" }, 503);
    }

    const result = await remoteChannelService.sendTestNotification();
    if (!result.ok) {
      return c.json(
        { error: result.error ?? "Remote channel test notification failed" },
        400,
      );
    }

    return c.json({ ok: true });
  });

  app.post("/remote-channels/feishu/app/test", async (c) => {
    const body = await c.req.json<{ botId?: string }>().catch(() => ({}));
    const feishu = serverSettingsService.getSettings().remoteChannels?.feishu;
    const bot = feishu?.bots?.find((b) => b.id === body.botId);
    if (!bot?.appId || !bot.appSecret) {
      return c.json({ error: "Feishu App ID and App Secret are required" }, 400);
    }

    const result = await sendFeishuAppTestMessage(
      bot.appId,
      bot.appSecret,
      bot.appChatId,
    );
    if (!result.ok) {
      return c.json({ error: result.error ?? "Feishu app test failed" }, 400);
    }

    return c.json({ ok: true });
  });

  app.post("/remote-channels/feishu/register/start", async (c) => {
    try {
      const result = await startFeishuRegistration();
      return c.json(result);
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "Feishu registration failed" },
        500,
      );
    }
  });

  app.post("/remote-channels/feishu/register/poll", async (c) => {
    const body = await c.req.json<{ sessionId?: string }>();
    if (!body.sessionId) return c.json({ error: "sessionId is required" }, 400);

    try {
      const session = await pollFeishuRegistration(
        body.sessionId,
        serverSettingsService,
      );
      return c.json({
        status: session.status,
        interval: session.interval,
        appId: session.appId,
        domain: session.domain,
        error: session.error,
      });
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "Feishu registration poll failed" },
        400,
      );
    }
  });

  app.post("/remote-channels/feishu/register/cancel", async (c) => {
    const body = await c.req.json<{ sessionId?: string }>();
    if (body.sessionId) {
      getGlobalMap<FeishuRegistrationSession>(FEISHU_REGISTRATION_GLOBAL_KEY).delete(
        body.sessionId,
      );
    }
    return c.json({ ok: true });
  });

  app.post("/remote-channels/telegram/verify", async (c) => {
    const body = await c.req.json<{
      action?: string;
      botId?: string;
      botToken?: string;
      chatId?: string;
      proxyUrl?: string;
    }>();
    const stored = serverSettingsService.getSettings().remoteChannels?.telegram;
    const storedBot = stored?.bots?.find((b) => b.id === body.botId);
    const botToken = body.botToken?.startsWith(MASKED_SECRET_PREFIX)
      ? storedBot?.botToken
      : body.botToken || storedBot?.botToken;
    const proxyUrl = body.proxyUrl || storedBot?.proxyUrl;
    if (!botToken) return c.json({ error: "Telegram bot token is required" }, 400);

    try {
      const result = body.action === "detect_chat_id"
        ? await detectTelegramChatId(botToken, proxyUrl)
        : await verifyTelegramBot(botToken, body.chatId || storedBot?.chatId, proxyUrl);
      return c.json(result);
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "Telegram verification failed" },
        500,
      );
    }
  });

  app.post("/remote-channels/qq/verify", async (c) => {
    const body = await c.req.json<{ appId?: string; appSecret?: string }>();
    const stored = serverSettingsService.getSettings().remoteChannels?.qq;
    const appSecret = body.appSecret?.startsWith(MASKED_SECRET_PREFIX)
      ? stored?.appSecret
      : body.appSecret || stored?.appSecret;
    const appId = body.appId || stored?.appId;
    if (!appId || !appSecret) {
      return c.json({ error: "QQ App ID and App Secret are required" }, 400);
    }

    try {
      const result = await verifyQqBot(appId, appSecret);
      return c.json(result);
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "QQ verification failed" },
        500,
      );
    }
  });

  app.post("/remote-channels/weixin/login/start", async (c) => {
    try {
      const result = await startWeixinLogin();
      return c.json(result);
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "Weixin QR login failed" },
        500,
      );
    }
  });

  app.post("/remote-channels/weixin/login/wait", async (c) => {
    const body = await c.req.json<{ sessionId?: string }>();
    if (!body.sessionId) return c.json({ error: "sessionId is required" }, 400);

    try {
      const session = await pollWeixinLogin(body.sessionId, serverSettingsService);
      return c.json({
        status: session.status,
        accountId: session.accountId,
        peerUserId: session.peerUserId,
        error: session.error,
      });
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "Weixin QR login poll failed" },
        400,
      );
    }
  });

  /**
   * GET /api/settings/remote-channels/available-bots
   * 返回所有渠道中未绑定会话的 bot 列表（供会话绑定 UI 消费）
   */
  app.get("/remote-channels/available-bots", (c) => {
    const settings = serverSettingsService.getSettings();
    const rc = settings.remoteChannels;
    if (!rc) return c.json({ bots: [] });

    const bots: Array<{
      botId: string;
      channel: string;
      name?: string;
      boundSessionId?: string;
    }> = [];

    if (rc.feishu?.enabled) {
      for (const bot of rc.feishu.bots ?? []) {
        if (bot.enabled === false) continue;
        if (!bot.appId || !bot.appSecret) continue;
        bots.push({
          botId: bot.id,
          channel: "feishu",
          name: bot.name,
          boundSessionId: bot.boundSessionId,
        });
      }
    }

    if (rc.telegram?.enabled) {
      for (const bot of rc.telegram.bots ?? []) {
        if (bot.enabled === false) continue;
        if (!bot.botToken || !bot.chatId) continue;
        bots.push({
          botId: bot.id,
          channel: "telegram",
          name: bot.name,
          boundSessionId: bot.boundSessionId,
        });
      }
    }

    if (rc.qq?.enabled) {
      for (const bot of rc.qq.bots ?? []) {
        if (bot.enabled === false) continue;
        if (!bot.appId || !bot.appSecret || !bot.openId) continue;
        bots.push({
          botId: bot.id,
          channel: "qq",
          name: bot.name,
          boundSessionId: bot.boundSessionId,
        });
      }
    }

    if (rc.weixin?.enabled) {
      for (const bot of rc.weixin.bots ?? []) {
        if (bot.enabled === false) continue;
        if (!bot.accountId || !bot.peerUserId) continue;
        bots.push({
          botId: bot.id,
          channel: "weixin",
          name: bot.name,
          boundSessionId: bot.boundSessionId,
        });
      }
    }

    return c.json({ bots });
  });

  /**
   * PUT /api/settings/remote-channels/bots/:botId/bind
   * 绑定/解绑 bot 到 session。body: { sessionId: string | null }
   */
  app.put("/remote-channels/bots/:botId/bind", async (c) => {
    const { botId } = c.req.param();
    const body = await c.req.json<{ sessionId?: string | null }>().catch(() => ({}));
    const sessionId = body.sessionId ?? null;

    const settings = serverSettingsService.getSettings();
    const rc = settings.remoteChannels ?? {};
    let found = false;

    const updatedRc = { ...rc };

    // 查找并更新对应 bot 的 boundSessionId
    for (const channel of ["feishu", "telegram", "qq", "weixin"] as const) {
      const channelSettings = rc[channel];
      if (!channelSettings?.bots) continue;
      const botIndex = channelSettings.bots.findIndex((b) => b.id === botId);
      if (botIndex === -1) continue;

      found = true;
      // 绑定校验：如果 sessionId 非空，检查该 session 是否已被其他 bot 绑定
      if (sessionId) {
        for (const ch of ["feishu", "telegram", "qq", "weixin"] as const) {
          const chBots = rc[ch]?.bots ?? [];
          for (const b of chBots) {
            if (b.boundSessionId === sessionId && b.id !== botId) {
              return c.json(
                { error: `Session ${sessionId} is already bound to bot ${b.id}` },
                409,
              );
            }
          }
        }
      }

      const updatedBots = [...channelSettings.bots];
      updatedBots[botIndex] = { ...updatedBots[botIndex], boundSessionId: sessionId ?? undefined };
      updatedRc[channel] = { ...channelSettings, bots: updatedBots };
      break;
    }

    if (!found) {
      return c.json({ error: `Bot ${botId} not found` }, 404);
    }

    await serverSettingsService.updateSettings({ remoteChannels: updatedRc });
    return c.json({ ok: true, botId, boundSessionId: sessionId ?? undefined });
  });

  /**
   * PUT /api/settings
   * Update server settings
   */
  app.put("/", async (c) => {
    const body = await c.req.json<Partial<ServerSettings>>();

    const updates: Partial<ServerSettings> = {};

    // Handle boolean settings
    if (typeof body.serviceWorkerEnabled === "boolean") {
      updates.serviceWorkerEnabled = body.serviceWorkerEnabled;
    }
    if (typeof body.persistRemoteSessionsToDisk === "boolean") {
      updates.persistRemoteSessionsToDisk = body.persistRemoteSessionsToDisk;
    }

    // Handle remoteExecutors array
    if (Array.isArray(body.remoteExecutors)) {
      const { hosts, invalidHost } = parseHostAliasList(body.remoteExecutors);
      if (invalidHost) {
        return c.json(
          { error: `Invalid remote executor host alias: ${invalidHost}` },
          400,
        );
      }
      updates.remoteExecutors = hosts;
    }

    // Handle chromeOsHosts array
    if (Array.isArray(body.chromeOsHosts)) {
      const { hosts, invalidHost } = parseHostAliasList(body.chromeOsHosts);
      if (invalidHost) {
        return c.json(
          { error: `Invalid ChromeOS host alias: ${invalidHost}` },
          400,
        );
      }
      updates.chromeOsHosts = hosts;
    }

    // Handle allowedHosts string ("*", comma-separated hostnames, or undefined to clear)
    if ("allowedHosts" in body) {
      if (
        body.allowedHosts === undefined ||
        body.allowedHosts === null ||
        body.allowedHosts === ""
      ) {
        updates.allowedHosts = undefined;
      } else if (typeof body.allowedHosts === "string") {
        updates.allowedHosts = body.allowedHosts;
      }
    }

    // Handle globalInstructions string (free-form text, or undefined/null/"" to clear)
    if ("globalInstructions" in body) {
      if (
        body.globalInstructions === undefined ||
        body.globalInstructions === null ||
        body.globalInstructions === ""
      ) {
        updates.globalInstructions = undefined;
      } else if (typeof body.globalInstructions === "string") {
        updates.globalInstructions = body.globalInstructions.slice(0, 10000);
      }
    }

    // Handle ollamaUrl string (URL, or undefined/null/"" to clear)
    if ("ollamaUrl" in body) {
      if (
        body.ollamaUrl === undefined ||
        body.ollamaUrl === null ||
        body.ollamaUrl === ""
      ) {
        updates.ollamaUrl = undefined;
      } else if (typeof body.ollamaUrl === "string") {
        updates.ollamaUrl = body.ollamaUrl;
      }
    }

    // Handle ollamaSystemPrompt string (free-form text, or undefined/null/"" to clear)
    if ("ollamaSystemPrompt" in body) {
      if (
        body.ollamaSystemPrompt === undefined ||
        body.ollamaSystemPrompt === null ||
        body.ollamaSystemPrompt === ""
      ) {
        updates.ollamaSystemPrompt = undefined;
      } else if (typeof body.ollamaSystemPrompt === "string") {
        updates.ollamaSystemPrompt = body.ollamaSystemPrompt.slice(0, 10000);
      }
    }

    // Handle ollamaUseFullSystemPrompt boolean
    if (typeof body.ollamaUseFullSystemPrompt === "boolean") {
      updates.ollamaUseFullSystemPrompt = body.ollamaUseFullSystemPrompt;
    }

    // Handle deviceBridgeEnabled boolean
    if (typeof body.deviceBridgeEnabled === "boolean") {
      updates.deviceBridgeEnabled = body.deviceBridgeEnabled;
    }

    if ("newSessionDefaults" in body) {
      const parsedDefaults = parseNewSessionDefaults(body.newSessionDefaults);
      if (parsedDefaults === null) {
        return c.json({ error: "Invalid newSessionDefaults setting" }, 400);
      }
      updates.newSessionDefaults = parsedDefaults;
    }

    if ("remoteChannels" in body) {
      const parsedRemoteChannels = parseRemoteChannels(
        body.remoteChannels,
        serverSettingsService.getSettings(),
      );
      if (parsedRemoteChannels === null) {
        return c.json({ error: "Invalid remoteChannels setting" }, 400);
      }
      updates.remoteChannels = parsedRemoteChannels;
    }

    if (typeof body.lifecycleWebhooksEnabled === "boolean") {
      updates.lifecycleWebhooksEnabled = body.lifecycleWebhooksEnabled;
    }
    if (typeof body.lifecycleWebhookDryRun === "boolean") {
      updates.lifecycleWebhookDryRun = body.lifecycleWebhookDryRun;
    }
    if ("lifecycleWebhookUrl" in body) {
      if (
        body.lifecycleWebhookUrl === undefined ||
        body.lifecycleWebhookUrl === null ||
        body.lifecycleWebhookUrl === ""
      ) {
        updates.lifecycleWebhookUrl = undefined;
      } else if (typeof body.lifecycleWebhookUrl === "string") {
        updates.lifecycleWebhookUrl = body.lifecycleWebhookUrl.slice(0, 2000);
      }
    }
    if ("lifecycleWebhookToken" in body) {
      if (
        body.lifecycleWebhookToken === undefined ||
        body.lifecycleWebhookToken === null ||
        body.lifecycleWebhookToken === ""
      ) {
        updates.lifecycleWebhookToken = undefined;
      } else if (typeof body.lifecycleWebhookToken === "string") {
        updates.lifecycleWebhookToken = body.lifecycleWebhookToken.slice(
          0,
          5000,
        );
      }
    }

    if (Object.keys(updates).length === 0) {
      return c.json({ error: "At least one valid setting is required" }, 400);
    }

    const settings = await serverSettingsService.updateSettings(updates);

    // Apply allowedHosts change to middleware at runtime
    if ("allowedHosts" in updates && onAllowedHostsChanged) {
      onAllowedHostsChanged(settings.allowedHosts);
    }
    if (
      "persistRemoteSessionsToDisk" in updates &&
      onRemoteSessionPersistenceChanged
    ) {
      await onRemoteSessionPersistenceChanged(
        settings.persistRemoteSessionsToDisk,
      );
    }
    if ("ollamaUrl" in updates && onOllamaUrlChanged) {
      onOllamaUrlChanged(settings.ollamaUrl);
    }
    if ("ollamaSystemPrompt" in updates && onOllamaSystemPromptChanged) {
      onOllamaSystemPromptChanged(settings.ollamaSystemPrompt);
    }
    if (
      "ollamaUseFullSystemPrompt" in updates &&
      onOllamaUseFullSystemPromptChanged
    ) {
      onOllamaUseFullSystemPromptChanged(
        settings.ollamaUseFullSystemPrompt ?? false,
      );
    }

    return c.json({ settings });
  });

  /**
   * GET /api/settings/remote-executors
   * Get list of configured remote executors
   */
  app.get("/remote-executors", (c) => {
    const settings = serverSettingsService.getSettings();
    return c.json({ executors: settings.remoteExecutors ?? [] });
  });

  /**
   * PUT /api/settings/remote-executors
   * Update list of remote executors
   */
  app.put("/remote-executors", async (c) => {
    const body = await c.req.json<{ executors: string[] }>();

    if (!Array.isArray(body.executors)) {
      return c.json({ error: "executors must be an array" }, 400);
    }

    const { hosts: validExecutors, invalidHost } = parseHostAliasList(
      body.executors,
    );
    if (invalidHost) {
      return c.json(
        { error: `Invalid remote executor host alias: ${invalidHost}` },
        400,
      );
    }

    await serverSettingsService.updateSettings({
      remoteExecutors: validExecutors,
    });

    return c.json({ executors: validExecutors });
  });

  /**
   * POST /api/settings/remote-executors/:host/test
   * Test SSH connection to a remote executor
   */
  app.post("/remote-executors/:host/test", async (c) => {
    const host = normalizeSshHostAlias(c.req.param("host"));

    if (!host) {
      return c.json({ error: "host is required" }, 400);
    }
    if (!isValidSshHostAlias(host)) {
      return c.json({ error: "host must be a valid SSH host alias" }, 400);
    }

    const result = await testSSHConnection(host);
    return c.json(result);
  });

  return app;
}
