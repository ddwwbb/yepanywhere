import { describe, expect, it } from "vitest";
import {
  redactRemoteChannelPayload,
  redactRemoteChannelText,
} from "../../src/remote-channels/redaction.js";

describe("remote channel redaction", () => {
  it("replaces secret-looking values", () => {
    expect(
      redactRemoteChannelText("token=abc123 password:super-secret api_key=key-1"),
    ).toBe("token=[redacted] password:[redacted] api_key=[redacted]");
  });

  it("keeps only basenames for absolute paths by default", () => {
    expect(
      redactRemoteChannelText(
        "Read /Users/me/project/src/index.ts and C:/work/repo/.env then ~/repo/file.txt",
      ),
    ).toBe("Read index.ts and .env then file.txt");
  });

  it("keeps paths when verbose redaction is enabled", () => {
    expect(redactRemoteChannelText("Open /tmp/repo/file.ts", { verbose: true })).toBe(
      "Open /tmp/repo/file.ts",
    );
  });

  it("does not stringify structured payloads", () => {
    expect(redactRemoteChannelPayload({ command: "cat .env" })).toBe(
      "[redacted payload]",
    );
  });
});
