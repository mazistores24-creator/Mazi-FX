import { describe, expect, it, vi } from "vitest";
import { Semaphore, SubscriptionManager, TokenBucket, subscriptionId, type UpstreamFeed } from "../src/pipeline/subscriptions";
import { HotCandleCache } from "../src/pipeline/hot-cache";
import { MemoryCandleStore } from "../src/pipeline/candle-store";

function fakeFeed() {
  const starts: string[] = [];
  const feed: UpstreamFeed = {
    subscribeTicks: (i) => { starts.push(`tick:${i}`); return () => {}; },
    subscribeCandles: (i, tf) => { starts.push(`candle:${i}:${tf}`); return () => {}; },
  };
  return { feed, starts };
}

describe("subscription manager", () => {
  it("dedupes identical requests into one upstream subscription", () => {
    const { feed, starts } = fakeFeed();
    const now = 0;
    const m = new SubscriptionManager(feed, () => {}, () => {}, { maxSubscriptions: 10, maxSubscribesPerSec: 100, maxPending: 10, now: () => now });
    m.subscribe({ kind: "tick", instrument: "R_10" });
    m.subscribe({ kind: "tick", instrument: "R_10" });
    expect(starts).toEqual(["tick:R_10"]);
    expect(m.size).toBe(1);
  });

  it("only tears down upstream when the last holder releases", () => {
    const unsub = vi.fn();
    const feed: UpstreamFeed = { subscribeTicks: () => unsub, subscribeCandles: () => () => {} };
    const m = new SubscriptionManager(feed, () => {}, () => {}, { maxSubscriptions: 10, maxSubscribesPerSec: 100, maxPending: 10, now: () => 0 });
    const a = m.subscribe({ kind: "tick", instrument: "R_25" });
    const b = m.subscribe({ kind: "tick", instrument: "R_25" });
    a?.();
    expect(unsub).not.toHaveBeenCalled();
    b?.();
    expect(unsub).toHaveBeenCalledOnce();
  });

  it("refuses new subscriptions beyond the maximum", () => {
    const { feed } = fakeFeed();
    const m = new SubscriptionManager(feed, () => {}, () => {}, { maxSubscriptions: 1, maxSubscribesPerSec: 100, maxPending: 10, now: () => 0 });
    m.subscribe({ kind: "tick", instrument: "R_10" });
    expect(m.subscribe({ kind: "tick", instrument: "R_50" })).toBeUndefined();
    expect(m.refused).toBe(1);
  });

  it("rejects candle subscriptions on M1 or unsupported timeframes", () => {
    expect(() => subscriptionId({ kind: "candle", instrument: "R_10", timeframe: "M1" as never })).toThrow();
    expect(subscriptionId({ kind: "candle", instrument: "R_10", timeframe: "H1" })).toBe("candle|R_10|H1");
  });
});

describe("rate limiting and concurrency", () => {
  it("token bucket refuses when empty and refills over time", () => {
    let now = 0;
    const b = new TokenBucket(2, 1, () => now);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(false);
    now = 1000;
    expect(b.take()).toBe(true);
  });

  it("semaphore never runs more than the limit at once", async () => {
    const sem = new Semaphore(2);
    let peak = 0;
    const work = () => sem.run(async () => { peak = Math.max(peak, sem.inFlight); await new Promise((r) => setTimeout(r, 5)); });
    await Promise.all([work(), work(), work(), work()]);
    expect(peak).toBeLessThanOrEqual(2);
  });
});

describe("hot cache and store", () => {
  it("replaces a re-delivered bar instead of duplicating it and enforces the bound", () => {
    const cache = new HotCandleCache(2);
    const bar = (time: string, close: string) => ({ time, open: "1", high: "2", low: "1", close, timeframe: "M5" as const, instrument: "R_10", complete: false });
    cache.put(bar("2026-01-05T10:00:00Z", "1"));
    cache.put(bar("2026-01-05T10:00:00Z", "1.5"));
    expect(cache.size("R_10", "M5")).toBe(1);
    cache.put(bar("2026-01-05T10:05:00Z", "1"));
    cache.put(bar("2026-01-05T10:10:00Z", "1"));
    expect(cache.get("R_10", "M5").map((b) => b.time)).toEqual(["2026-01-05T10:05:00Z", "2026-01-05T10:10:00Z"]);
  });

  it("memory store upserts idempotently", async () => {
    const store = new MemoryCandleStore();
    const bar = { time: "2026-01-05T10:00:00Z", open: "1", high: "2", low: "1", close: "1", timeframe: "M5" as const, instrument: "R_10", complete: true };
    await store.upsert([bar]);
    await store.upsert([bar]);
    expect(await store.range("R_10", "M5", "2026-01-05T00:00:00Z", "2026-01-06T00:00:00Z")).toHaveLength(1);
  });
});
