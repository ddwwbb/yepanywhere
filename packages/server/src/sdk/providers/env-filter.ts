/**
 * Filter environment variables for child processes.
 *
 * When spawning Claude as a subprocess, we don't want to leak:
 * - npm_* variables (from pnpm/npm lifecycle)
 * - Yep Anywhere internal variables
 * - Other irrelevant development/build-time variables
 *
 * We keep essential system variables that Claude might need.
 * We also read ~/.claude/settings.json and ~/.claude/settings.local.json
 * to inject user-configured env vars (e.g., ANTHROPIC_BASE_URL) into child processes.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Prefixes to exclude from child process environment */
const EXCLUDED_PREFIXES = [
  "npm_", // npm/pnpm lifecycle variables
  "YEP_ANYWHERE_", // Our internal variables
  "VITE_", // Vite dev server variables
  "VITEST", // Vitest test runner
  "LOG_", // Our logging configuration
];

/** Exact variable names to exclude */
const EXCLUDED_VARS = new Set([
  // npm/pnpm specific
  "npm_execpath",
  "npm_node_execpath",
  // Development tools
  "INIT_CWD",
  "COLOR",
  "FORCE_COLOR",
  // Auth/maintenance ports (internal to yep-anywhere)
  "MAINTENANCE_PORT",
  "AUTH_DISABLED",
  // Proxy debug (internal)
  "PROXY_DEBUG",
  // Prevent nested session detection when server runs inside Claude Code
  "CLAUDECODE",
  // NODE_ENV is set to "production" by yepanywhere's CLI but should not
  // leak into Claude Code child processes where it breaks project tooling
  // (e.g. React 19 + Vitest). See GitHub issue #41.
  "NODE_ENV",
]);

/** Essential variables to always keep (even if they match excluded patterns) */
const ALWAYS_KEEP = new Set([
  // Core system
  "HOME",
  "USER",
  "SHELL",
  "PATH",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "COLORTERM",
  // Common development tools
  "EDITOR",
  "VISUAL",
  "PAGER",
  // Node/runtime
  "NODE_OPTIONS",
  "NODE_PATH",
  "NVM_DIR",
  "NVM_BIN",
  // Git
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL",
  "GIT_SSH_COMMAND",
  // SSH
  "SSH_AUTH_SOCK",
  "SSH_AGENT_PID",
  // Claude/Anthropic 自定义 API 端点和模型别名配置
  "API_TIMEOUT_MS",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS",
  "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
  "DISABLE_INSTALLATION_CHECKS",
  "DISABLE_TELEMETRY",
  "ENABLE_TOOL_SEARCH",
  // XDG directories
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_RUNTIME_DIR",
  // Misc
  "TZ",
  "TMPDIR",
  "TEMP",
  "TMP",
]);

/**
 * Read the `env` field from ~/.claude/settings.json and ~/.claude/settings.local.json.
 * Settings files are merged with local taking precedence over user.
 */
export function readClaudeSettingsEnv(): Record<string, string> {
  const result: Record<string, string> = {};
  const home = homedir();
  const paths = [
    join(home, ".claude", "settings.json"),
    join(home, ".claude", "settings.local.json"),
  ];

  for (const settingsPath of paths) {
    if (!existsSync(settingsPath)) continue;
    try {
      const raw = readFileSync(settingsPath, "utf-8");
      const parsed = JSON.parse(raw) as { env?: Record<string, string> };
      if (parsed.env && typeof parsed.env === "object") {
        for (const [k, v] of Object.entries(parsed.env)) {
          if (typeof v === "string") {
            result[k] = v;
          }
        }
      }
    } catch {
      // 配置文件格式错误时静默跳过
    }
  }

  return result;
}

/**
 * Filter environment variables for spawning child Claude processes.
 *
 * Merges process.env with env vars from ~/.claude/settings*.json,
 * then filters out internal/irrelevant variables.
 *
 * @param env - Environment object to filter (defaults to process.env)
 * @returns Filtered environment object suitable for child processes
 */
export function filterEnvForChildProcess(
  env: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  // 从 ~/.claude/settings*.json 读取用户配置的 env
  const settingsEnv = readClaudeSettingsEnv();
  const merged: Record<string, string | undefined> = {
    ...settingsEnv,
    ...env,
  };

  const filtered: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(merged)) {
    // Always keep essential variables
    if (ALWAYS_KEEP.has(key)) {
      filtered[key] = value;
      continue;
    }

    // Exclude exact matches
    if (EXCLUDED_VARS.has(key)) {
      continue;
    }

    // Exclude by prefix
    if (EXCLUDED_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      continue;
    }

    // Keep everything else
    filtered[key] = value;
  }

  return filtered;
}
