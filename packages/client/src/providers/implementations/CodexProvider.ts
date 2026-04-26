import type {
  Provider,
  ProviderCapabilities,
  ProviderMetadata,
} from "../types";

export class CodexProvider implements Provider {
  readonly id = "codex";
  readonly displayName = "Codex";

  readonly capabilities: ProviderCapabilities = {
    supportsDag: false, // Linear history
    supportsCloning: true,
  };

  readonly metadata: ProviderMetadata = {
    description:
      "OpenAI's Codex CLI. Full editing capabilities with cloud-based reasoning.",
    descriptionKey: "providerCodexDescription",
    limitations: [
      "Edit details not visible (black box)",
      "Best for fire-and-forget tasks",
    ],
    limitationKeys: [
      "providerCodexLimit1",
      "providerCodexLimit2",
    ],
    website: "https://openai.com/index/introducing-codex/",
    cliName: "codex",
  };
}

export class CodexOssProvider implements Provider {
  readonly id = "codex-oss";
  readonly displayName = "Codex OSS";

  readonly capabilities: ProviderCapabilities = {
    supportsDag: false, // Linear history
    supportsCloning: true,
  };

  readonly metadata: ProviderMetadata = {
    description:
      "Codex with local models via Ollama. All operations visible through shell commands.",
    descriptionKey: "providerCodexOssDescription",
    limitations: [
      "Requires Ollama running locally",
      "Model quality varies",
      "More verbose output",
    ],
    limitationKeys: [
      "providerCodexOssLimit1",
      "providerCodexOssLimit2",
      "providerCodexOssLimit3",
    ],
    website: "https://github.com/openai/codex",
    cliName: "codex",
  };
}
