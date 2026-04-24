import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock homedir to point at our temp directory
const FAKE_HOME = join(process.cwd(), "test-tmp-env-filter-home");
const CLAUDE_DIR = join(FAKE_HOME, ".claude");

vi.mock("node:os", () => ({
  homedir: () => FAKE_HOME,
}));

import {
  filterEnvForChildProcess,
  readClaudeSettingsEnv,
} from "../../../src/sdk/providers/env-filter.js";

function writeSettings(filename: string, data: Record<string, unknown>) {
  mkdirSync(CLAUDE_DIR, { recursive: true });
  writeFileSync(join(CLAUDE_DIR, filename), JSON.stringify(data), "utf-8");
}

describe("readClaudeSettingsEnv", () => {
  beforeEach(() => {
    rmSync(FAKE_HOME, { recursive: true, force: true });
  });

  it("returns empty object when no settings files exist", () => {
    expect(readClaudeSettingsEnv()).toEqual({});
  });

  it("reads env from ~/.claude/settings.json", () => {
    writeSettings("settings.json", {
      env: {
        ANTHROPIC_BASE_URL: "https://open.bigmodel.cn/api/anthropic",
        ANTHROPIC_MODEL: "glm-5.1",
      },
    });

    expect(readClaudeSettingsEnv()).toEqual({
      ANTHROPIC_BASE_URL: "https://open.bigmodel.cn/api/anthropic",
      ANTHROPIC_MODEL: "glm-5.1",
    });
  });

  it("merges settings.local.json over settings.json", () => {
    writeSettings("settings.json", {
      env: {
        ANTHROPIC_BASE_URL: "https://old.example.com",
        ANTHROPIC_MODEL: "old-model",
      },
    });
    writeSettings("settings.local.json", {
      env: {
        ANTHROPIC_BASE_URL: "https://new.example.com",
        ANTHROPIC_AUTH_TOKEN: "new-token",
      },
    });

    expect(readClaudeSettingsEnv()).toEqual({
      ANTHROPIC_BASE_URL: "https://new.example.com",
      ANTHROPIC_MODEL: "old-model",
      ANTHROPIC_AUTH_TOKEN: "new-token",
    });
  });

  it("skips malformed JSON silently", () => {
    mkdirSync(CLAUDE_DIR, { recursive: true });
    writeFileSync(join(CLAUDE_DIR, "settings.json"), "not-json", "utf-8");

    expect(readClaudeSettingsEnv()).toEqual({});
  });
});

describe("filterEnvForChildProcess", () => {
  beforeEach(() => {
    rmSync(FAKE_HOME, { recursive: true, force: true });
  });

  it("keeps Claude custom endpoint and model configuration", () => {
    const filtered = filterEnvForChildProcess({
      ANTHROPIC_API_KEY: "api-key",
      ANTHROPIC_AUTH_TOKEN: "auth-token",
      ANTHROPIC_BASE_URL: "https://open.bigmodel.cn/api/anthropic",
      ANTHROPIC_MODEL: "glm-5.1",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "glm-5.1",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-5.1",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "glm-5.1",
      API_TIMEOUT_MS: "600000",
      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      DISABLE_INSTALLATION_CHECKS: "1",
      DISABLE_TELEMETRY: "1",
      ENABLE_TOOL_SEARCH: "1",
    });

    expect(filtered).toEqual({
      ANTHROPIC_API_KEY: "api-key",
      ANTHROPIC_AUTH_TOKEN: "auth-token",
      ANTHROPIC_BASE_URL: "https://open.bigmodel.cn/api/anthropic",
      ANTHROPIC_MODEL: "glm-5.1",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "glm-5.1",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-5.1",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "glm-5.1",
      API_TIMEOUT_MS: "600000",
      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      DISABLE_INSTALLATION_CHECKS: "1",
      DISABLE_TELEMETRY: "1",
      ENABLE_TOOL_SEARCH: "1",
    });
  });

  it("still excludes internal yep-anywhere and runtime variables", () => {
    const filtered = filterEnvForChildProcess({
      PATH: "/bin",
      YEP_ANYWHERE_PORT: "1234",
      npm_lifecycle_event: "test",
      NODE_ENV: "production",
      CLAUDECODE: "1",
    });

    expect(filtered).toEqual({ PATH: "/bin" });
  });

  it("process.env overrides settings.json values", () => {
    writeSettings("settings.json", {
      env: {
        ANTHROPIC_BASE_URL: "https://from-settings.example.com",
      },
    });

    const filtered = filterEnvForChildProcess({
      PATH: "/bin",
      ANTHROPIC_BASE_URL: "https://from-process-env.example.com",
    });

    expect(filtered.ANTHROPIC_BASE_URL).toBe(
      "https://from-process-env.example.com",
    );
  });

  it("settings.json env is injected when not in process.env", () => {
    writeSettings("settings.json", {
      env: {
        ANTHROPIC_BASE_URL: "https://from-settings.example.com",
        ANTHROPIC_MODEL: "glm-5.1",
      },
    });

    const filtered = filterEnvForChildProcess({
      PATH: "/bin",
    });

    expect(filtered.ANTHROPIC_BASE_URL).toBe(
      "https://from-settings.example.com",
    );
    expect(filtered.ANTHROPIC_MODEL).toBe("glm-5.1");
  });
});
