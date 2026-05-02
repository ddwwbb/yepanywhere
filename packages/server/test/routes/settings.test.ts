import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSettingsRoutes } from "../../src/routes/settings.js";
import type {
  ServerSettings,
  ServerSettingsService,
} from "../../src/services/ServerSettingsService.js";

describe("Settings Routes", () => {
  let settings: ServerSettings;
  let mockServerSettingsService: ServerSettingsService;

  beforeEach(() => {
    settings = {
      serviceWorkerEnabled: true,
      persistRemoteSessionsToDisk: false,
    };

    mockServerSettingsService = {
      getSettings: vi.fn(() => settings),
      updateSettings: vi.fn(async (updates: Partial<ServerSettings>) => {
        settings = { ...settings, ...updates };
        return settings;
      }),
    } as unknown as ServerSettingsService;
  });

  describe("PUT /remote-executors", () => {
    it("rejects invalid host aliases", async () => {
      const routes = createSettingsRoutes({
        serverSettingsService: mockServerSettingsService,
      });

      const response = await routes.request("/remote-executors", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          executors: ["devbox", "-oProxyCommand=touch_/tmp/pwned"],
        }),
      });

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toContain("Invalid remote executor host alias");
      expect(mockServerSettingsService.updateSettings).not.toHaveBeenCalled();
    });

    it("accepts and normalizes valid aliases", async () => {
      const routes = createSettingsRoutes({
        serverSettingsService: mockServerSettingsService,
      });

      const response = await routes.request("/remote-executors", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          executors: ["  devbox  ", "gpu-server", "", "  "],
        }),
      });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.executors).toEqual(["devbox", "gpu-server"]);
      expect(mockServerSettingsService.updateSettings).toHaveBeenCalledWith({
        remoteExecutors: ["devbox", "gpu-server"],
      });
    });
  });

  describe("POST /remote-channels/feishu/test", () => {
    it("sends remote channel test notification", async () => {
      const remoteChannelService = {
        sendTestNotification: vi.fn(async () => ({ ok: true })),
      };
      const routes = createSettingsRoutes({
        serverSettingsService: mockServerSettingsService,
        remoteChannelService,
      });

      const response = await routes.request("/remote-channels/feishu/test", {
        method: "POST",
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true });
      expect(remoteChannelService.sendTestNotification).toHaveBeenCalled();
    });

    it("returns error when test notification fails", async () => {
      const remoteChannelService = {
        sendTestNotification: vi.fn(async () => ({
          ok: false,
          error: "No enabled remote channel adapter",
        })),
      };
      const routes = createSettingsRoutes({
        serverSettingsService: mockServerSettingsService,
        remoteChannelService,
      });

      const response = await routes.request("/remote-channels/feishu/test", {
        method: "POST",
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "No enabled remote channel adapter",
      });
    });
  });

  describe("PUT /remote-channels/bots/:botId/bind", () => {
    it("replaces a session binding with another bot", async () => {
      settings = {
        ...settings,
        remoteChannels: {
          telegram: {
            enabled: true,
            bots: [
              {
                id: "bot-old",
                botToken: "token-old",
                chatId: "chat-old",
                boundSessionId: "session-1",
              },
              {
                id: "bot-new",
                botToken: "token-new",
                chatId: "chat-new",
                boundSessionId: "session-2",
              },
            ],
          },
        },
      };
      const remoteChannelService = {
        sendTestNotification: vi.fn(),
        reload: vi.fn(async () => {}),
      };
      const routes = createSettingsRoutes({
        serverSettingsService: mockServerSettingsService,
        remoteChannelService,
      });

      const response = await routes.request(
        "/remote-channels/bots/bot-new/bind",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: "session-1" }),
        },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        ok: true,
        botId: "bot-new",
        boundSessionId: "session-1",
      });
      expect(mockServerSettingsService.updateSettings).toHaveBeenCalledWith({
        remoteChannels: {
          telegram: {
            enabled: true,
            bots: [
              {
                id: "bot-old",
                botToken: "token-old",
                chatId: "chat-old",
                boundSessionId: undefined,
              },
              {
                id: "bot-new",
                botToken: "token-new",
                chatId: "chat-new",
                boundSessionId: "session-1",
              },
            ],
          },
        },
      });
      expect(remoteChannelService.reload).toHaveBeenCalledOnce();
    });
  });

  describe("PUT /", () => {
    it("accepts clearing globalInstructions with null", async () => {
      settings = {
        ...settings,
        globalInstructions: "Existing instructions",
      };

      const routes = createSettingsRoutes({
        serverSettingsService: mockServerSettingsService,
      });

      const response = await routes.request("/", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          globalInstructions: null,
        }),
      });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.settings.globalInstructions).toBeUndefined();
      expect(mockServerSettingsService.updateSettings).toHaveBeenCalledWith({
        globalInstructions: undefined,
      });
    });

    it("rejects invalid aliases in remoteExecutors setting", async () => {
      const routes = createSettingsRoutes({
        serverSettingsService: mockServerSettingsService,
      });

      const response = await routes.request("/", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          remoteExecutors: ["devbox", "-oProxyCommand=touch_/tmp/pwned"],
        }),
      });

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toContain("Invalid remote executor host alias");
      expect(mockServerSettingsService.updateSettings).not.toHaveBeenCalled();
    });

    it("accepts and normalizes valid aliases in chromeOsHosts setting", async () => {
      const routes = createSettingsRoutes({
        serverSettingsService: mockServerSettingsService,
      });

      const response = await routes.request("/", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chromeOsHosts: ["  chromeroot  ", "lab-book", "", " "],
        }),
      });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.settings.chromeOsHosts).toEqual(["chromeroot", "lab-book"]);
      expect(mockServerSettingsService.updateSettings).toHaveBeenCalledWith({
        chromeOsHosts: ["chromeroot", "lab-book"],
      });
    });

    it("rejects invalid aliases in chromeOsHosts setting", async () => {
      const routes = createSettingsRoutes({
        serverSettingsService: mockServerSettingsService,
      });

      const response = await routes.request("/", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chromeOsHosts: ["chromeroot", "-oProxyCommand=touch_/tmp/pwned"],
        }),
      });

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toContain("Invalid ChromeOS host alias");
      expect(mockServerSettingsService.updateSettings).not.toHaveBeenCalled();
    });

    it("accepts lifecycle webhook settings", async () => {
      const routes = createSettingsRoutes({
        serverSettingsService: mockServerSettingsService,
      });

      const response = await routes.request("/", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lifecycleWebhooksEnabled: true,
          lifecycleWebhookUrl: "https://example.com/hook",
          lifecycleWebhookToken: "secret",
          lifecycleWebhookDryRun: false,
        }),
      });

      expect(response.status).toBe(200);
      expect(mockServerSettingsService.updateSettings).toHaveBeenCalledWith({
        lifecycleWebhooksEnabled: true,
        lifecycleWebhookUrl: "https://example.com/hook",
        lifecycleWebhookToken: "secret",
        lifecycleWebhookDryRun: false,
      });
    });

    it("accepts remote channel Feishu settings", async () => {
      const routes = createSettingsRoutes({
        serverSettingsService: mockServerSettingsService,
      });

      const response = await routes.request("/", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          remoteChannels: {
            feishu: {
              enabled: true,
              proxyUrl: "socks5://127.0.0.1:7890",
              appId: "cli_test",
              appSecret: "secret_test",
              appChatId: "oc_test",
            },
          },
        }),
      });

      expect(response.status).toBe(200);
      expect(mockServerSettingsService.updateSettings).toHaveBeenCalledWith({
        remoteChannels: {
          feishu: {
            enabled: true,
            proxyUrl: "socks5://127.0.0.1:7890",
            appId: "cli_test",
            appSecret: "secret_test",
            appChatId: "oc_test",
          },
        },
      });
    });

    it("masks Feishu app secret when reading settings", async () => {
      settings = {
        ...settings,
        remoteChannels: {
          feishu: {
            appId: "cli_test",
            appSecret: "super-secret-value",
          },
        },
      };
      const routes = createSettingsRoutes({
        serverSettingsService: mockServerSettingsService,
      });

      const response = await routes.request("/");

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.settings.remoteChannels.feishu.appSecret).toBe("***et-value");
    });

    it("keeps existing Feishu app secret when saving masked value", async () => {
      settings = {
        ...settings,
        remoteChannels: {
          feishu: {
            appId: "cli_old",
            appSecret: "existing-secret",
          },
        },
      };
      const routes = createSettingsRoutes({
        serverSettingsService: mockServerSettingsService,
      });

      const response = await routes.request("/", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          remoteChannels: {
            feishu: {
              appId: "cli_new",
              appSecret: "***g-secret",
            },
          },
        }),
      });

      expect(response.status).toBe(200);
      expect(mockServerSettingsService.updateSettings).toHaveBeenCalledWith({
        remoteChannels: {
          feishu: {
            enabled: undefined,
            proxyUrl: undefined,
            appId: "cli_new",
            appSecret: "existing-secret",
          },
        },
      });
    });
  });

  describe("POST /remote-executors/:host/test", () => {
    it("rejects invalid host path parameters", async () => {
      const routes = createSettingsRoutes({
        serverSettingsService: mockServerSettingsService,
      });
      const invalidHost = encodeURIComponent("-oProxyCommand=touch_/tmp/pwned");

      const response = await routes.request(
        `/remote-executors/${invalidHost}/test`,
        {
          method: "POST",
        },
      );

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe("host must be a valid SSH host alias");
    });
  });
});
