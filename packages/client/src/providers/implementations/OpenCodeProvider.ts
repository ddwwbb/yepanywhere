import type {
  Provider,
  ProviderCapabilities,
  ProviderMetadata,
} from "../types";

export class OpenCodeProvider implements Provider {
  readonly id = "opencode";
  readonly displayName = "OpenCode";

  readonly capabilities: ProviderCapabilities = {
    supportsDag: false,
    supportsCloning: false,
  };

  readonly metadata: ProviderMetadata = {
    description:
      "Multi-provider agent with tool streaming via SSE. Supports various LLM backends.",
    descriptionKey: "providerOpenCodeDescription",
    limitations: [
      "Tool approval flow still under investigation",
      "Experimental integration",
    ],
    limitationKeys: [
      "providerOpenCodeLimit1",
      "providerOpenCodeLimit2",
    ],
    website: "https://opencode.ai",
    cliName: "opencode",
  };
}
