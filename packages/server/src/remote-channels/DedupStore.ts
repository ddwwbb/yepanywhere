export interface RemoteChannelDedupStoreOptions {
  now?: () => number;
  maxEntries?: number;
}

interface DedupEntry {
  expiresAt: number;
}

export class RemoteChannelDedupStore {
  private readonly entries = new Map<string, DedupEntry>();
  private readonly now: () => number;
  private readonly maxEntries: number;

  constructor(options: RemoteChannelDedupStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.maxEntries = options.maxEntries ?? 1000;
  }

  has(key: string): boolean {
    this.pruneExpired();
    return this.entries.has(key);
  }

  mark(key: string, ttlMs: number): boolean {
    this.pruneExpired();

    if (this.entries.has(key)) {
      return false;
    }

    this.entries.set(key, { expiresAt: this.now() + ttlMs });
    this.pruneOverflow();
    return true;
  }

  size(): number {
    this.pruneExpired();
    return this.entries.size;
  }

  private pruneExpired(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }
  }

  private pruneOverflow(): void {
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (!oldestKey) {
        return;
      }
      this.entries.delete(oldestKey);
    }
  }
}
