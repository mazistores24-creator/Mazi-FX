import type { Candle, CandleUpdate, Timeframe } from "@mazzi/core";
import { StalenessMonitor, type FeedFreshness } from "@mazzi/core";
import type { CandleStore } from "./candle-store";
import type { HotCandleCache } from "./hot-cache";
import { SubscriptionManager, type SubscriptionKey, type UpstreamFeed } from "./subscriptions";

export interface IngestOptions {
  staleAfterMs: number;
  maxSubscriptions: number;
  maxSubscribesPerSec: number;
  maxPending: number;
  now?: () => number;
}

export interface IngestLog {
  warn(msg: string, fields?: Record<string, unknown>): void;
}

/**
 * Wires one upstream feed into the cache, the store and the freshness monitor.
 * Completed bars are persisted. Forming bars go to the hot cache only, so the database
 * is not written on every tick. Persistence failures are logged and the bar stays in
 * the hot cache, so a database outage never blocks live analysis.
 */
export class IngestPipeline {
  readonly staleness: StalenessMonitor;
  readonly subs: SubscriptionManager;
  private readonly pendingWrites: Candle[] = [];
  private flushing = false;

  constructor(
    upstream: UpstreamFeed,
    private readonly cache: HotCandleCache,
    private readonly store: CandleStore,
    private readonly providerId: string,
    private readonly log: IngestLog,
    opts: IngestOptions,
  ) {
    this.staleness = new StalenessMonitor(opts.staleAfterMs, opts.now);
    this.subs = new SubscriptionManager(
      upstream,
      (instrument, epochMs) => this.staleness.recordTick(instrument, epochMs),
      (u) => this.onCandle(u),
      { maxSubscriptions: opts.maxSubscriptions, maxSubscribesPerSec: opts.maxSubscribesPerSec, maxPending: opts.maxPending, now: opts.now },
    );
  }

  /** Watches an instrument's ticks for staleness. Returns an unwatch function. */
  watchInstrument(instrument: string): () => void {
    this.staleness.register(instrument);
    const off = this.subs.subscribe({ kind: "tick", instrument });
    return () => {
      off?.();
      this.staleness.unregister(instrument);
    };
  }

  /** Subscribes to native bars for one instrument and timeframe. */
  watchCandles(instrument: string, timeframe: Timeframe): (() => void) | undefined {
    return this.subs.subscribe({ kind: "candle", instrument, timeframe } as SubscriptionKey);
  }

  private onCandle(u: CandleUpdate): void {
    this.cache.put(u.candle);
    if (u.complete) this.enqueueWrite(u.candle);
  }

  private enqueueWrite(c: Candle): void {
    this.pendingWrites.push(c);
    if (!this.flushing) void this.flush();
  }

  /** Writes queued completed bars in batches. A failed batch is logged and dropped from the queue. */
  async flush(): Promise<void> {
    this.flushing = true;
    try {
      while (this.pendingWrites.length > 0) {
        const batch = this.pendingWrites.splice(0, 200);
        try {
          await this.store.upsert(batch, this.providerId);
        } catch {
          this.log.warn("candle persistence failed; bars remain in hot cache", { count: batch.length });
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  freshness(): FeedFreshness[] {
    return this.staleness.snapshot();
  }

  async shutdown(): Promise<void> {
    this.subs.closeAll();
    await this.flush();
  }
}

export type { CandleUpdate };
