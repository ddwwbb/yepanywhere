import { execSync } from "node:child_process";
import react from "@vitejs/plugin-react";
import { DEFAULT_PORT, DEFAULT_VITE_PORT } from "@yep-anywhere/shared";
import { defineConfig } from "vite";
import { cspPlugin } from "./vite-plugin-csp";
import { reloadNotify } from "./vite-plugin-reload-notify";

// NO_FRONTEND_RELOAD: Disable HMR and use manual reload notifications instead
const noFrontendReload = process.env.NO_FRONTEND_RELOAD === "true";

// Port defaults to DEFAULT_PORT + 2, can be overridden via VITE_PORT
const vitePort = process.env.VITE_PORT
  ? Number.parseInt(process.env.VITE_PORT, 10)
  : DEFAULT_VITE_PORT;

// VITE_HOST: Set to "true" to bind to all interfaces (needed in Docker containers)
const viteHost = process.env.VITE_HOST === "true" ? true : undefined;

function getGitVersion(): string {
  try {
    return execSync("git describe --tags --always", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    })
      .trim()
      .replace(/^v/, "");
  } catch {
    return "dev";
  }
}

export default defineConfig({
  clearScreen: false,
  define: {
    __APP_VERSION__: JSON.stringify(getGitVersion()),
  },
  plugins: [
    react(),
    // When HMR is disabled, use reload-notify plugin to tell backend about changes
    reloadNotify({ enabled: noFrontendReload, apiPort: DEFAULT_PORT }),
    // Content Security Policy (stricter in production, permissive in dev for HMR)
    cspPlugin({ isRemote: false }),
  ],
  resolve: {
    conditions: ["source"],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replaceAll("\\", "/");
          if (normalizedId.includes("/src/pages/settings/")) return "page-settings";
          if (normalizedId.includes("/src/pages/SessionPage")) return "page-session";
          if (normalizedId.includes("/src/pages/")) return "pages";
          if (!normalizedId.includes("node_modules")) return undefined;
          if (normalizedId.includes("lucide-react")) return "vendor-icons";
          if (normalizedId.includes("react")) return "vendor-react";
          if (normalizedId.includes("zod")) return "vendor-validation";
          return "vendor";
        },
      },
    },
  },
  server: {
    port: vitePort,
    host: viteHost,
    allowedHosts: ["localhost", ".yepanywhere.com"],
    // HMR configuration for reverse proxy setup
    // When accessed through backend proxy (port 7777) or Tailscale, HMR needs to
    // connect back through the same proxy path, not directly to Vite's port
    hmr: noFrontendReload
      ? false
      : {
          // Let the client determine host/port from its current location
          // This allows HMR to work through any proxy (backend, Tailscale, etc.)
          // The backend will proxy WebSocket connections to us
        },
    // No proxy needed - backend (port 7777) proxies to us, not the other way around
    // Users access http://localhost:7777 and backend forwards non-API requests here
  },
});
