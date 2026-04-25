import { describe, expect, it } from "vitest";
import { RemoteChannelDedupStore } from "../../src/remote-channels/DedupStore.js";

describe("RemoteChannelDedupStore", () => {
  it("marks a key once within its ttl", () => {
    let now = 1000;
    const store = new RemoteChannelDedupStore({ now: () => now });

    expect(store.mark("session.completed:sess-1", 1000)).toBe(true);
    expect(store.mark("session.completed:sess-1", 1000)).toBe(false);
    expect(store.has("session.completed:sess-1")).toBe(true);

    now = 2001;

    expect(store.has("session.completed:sess-1")).toBe(false);
    expect(store.mark("session.completed:sess-1", 1000)).toBe(true);
  });

  it("bounds stored keys", () => {
    const store = new RemoteChannelDedupStore({ maxEntries: 2 });

    expect(store.mark("a", 1000)).toBe(true);
    expect(store.mark("b", 1000)).toBe(true);
    expect(store.mark("c", 1000)).toBe(true);

    expect(store.size()).toBe(2);
    expect(store.has("a")).toBe(false);
    expect(store.has("b")).toBe(true);
    expect(store.has("c")).toBe(true);
  });
});
