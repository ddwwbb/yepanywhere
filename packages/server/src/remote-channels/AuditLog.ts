import { mkdir, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RemoteChannelAuditEntry } from "./types.js";

export interface RemoteChannelAuditLogOptions {
  dataDir: string;
  now?: () => string;
}

export class RemoteChannelAuditLog {
  private readonly filePath: string;
  private readonly now: () => string;

  constructor(options: RemoteChannelAuditLogOptions) {
    this.filePath = join(options.dataDir, "remote-channels", "audit.jsonl");
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async record(entry: Omit<RemoteChannelAuditEntry, "timestamp">): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const line: RemoteChannelAuditEntry = {
      timestamp: this.now(),
      ...entry,
    };
    await appendFile(this.filePath, `${JSON.stringify(line)}\n`, "utf-8");
  }
}
