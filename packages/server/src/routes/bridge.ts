import { Hono } from "hono";
import type { RemoteChannelService } from "../remote-channels/RemoteChannelService.js";
import type { ServerSettingsService } from "../services/ServerSettingsService.js";

export interface BridgeRoutesDeps {
  remoteChannelService?: RemoteChannelService;
  serverSettingsService?: ServerSettingsService;
}

export function createBridgeRoutes(deps: BridgeRoutesDeps): Hono {
  const app = new Hono();
  const { remoteChannelService, serverSettingsService } = deps;

  /**
   * GET /api/bridge — 查询桥接运行状态
   */
  app.get("/", (c) => {
    if (!remoteChannelService) {
      return c.json({ running: false, startedAt: null, adapters: [] });
    }
    const status = remoteChannelService.getStatus();
    return c.json(status);
  });

  /**
   * POST /api/bridge — 启动或停止桥接
   * Body: { action: 'start' | 'stop' }
   */
  app.post("/", async (c) => {
    try {
      const body = await c.req.json<{ action?: string }>().catch(() => ({ action: "" }));
      const { action } = body;

      if (action === "start") {
        if (!remoteChannelService) {
          return c.json({ ok: false, reason: "bridge_not_available" });
        }

        const result = await remoteChannelService.start();
        if (!result.started) {
          return c.json({ ok: false, reason: result.reason ?? "unknown_error" });
        }

        await serverSettingsService?.updateSettings({ bridgeAutoStart: true });
        return c.json({ ok: true, status: remoteChannelService.getStatus() });
      }

      if (action === "stop") {
        await remoteChannelService?.stop();
        await serverSettingsService?.updateSettings({ bridgeAutoStart: false });
        return c.json({ ok: true, status: remoteChannelService?.getStatus() ?? { running: false, startedAt: null, adapters: [] } });
      }

      return c.json({ error: 'Invalid action. Use "start" or "stop".' }, 400);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Internal error" },
        500,
      );
    }
  });

  return app;
}
