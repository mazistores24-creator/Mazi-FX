import type { FeedFreshness, Candle, Timeframe } from "@mazzi/core";
import type { FeedPort, FeedSnapshot, ScanInstrument } from "./types";

/** Adapter over the Phase 2 freshness monitor and candle cache interfaces. */
export class Phase2FeedPort implements FeedPort {
  constructor(
    private readonly list: () => readonly ScanInstrument[],
    private readonly status: (instrument: string) => FeedFreshness | undefined,
    private readonly candles: (instrument: string, timeframe: Timeframe) => readonly Candle[],
  ) {}
  instruments(): readonly ScanInstrument[] { return this.list(); }
  snapshot(instrument: string, timeframe: Timeframe, nowMs: number): FeedSnapshot {
    const observed = this.status(instrument);
    const feedStatus: FeedFreshness = observed ?? { instrument, state: "NO_DATA", lastTickAt: null, ageMs: null };
    // Treat future timestamps or an old tick as unsafe even if a stale monitor has not yet updated.
    if (feedStatus.lastTickAt) {
      const tickMs = Date.parse(feedStatus.lastTickAt);
      if (!Number.isFinite(tickMs) || tickMs > nowMs || nowMs - tickMs > 120_000) {
        return { status: { ...feedStatus, state: "STALE" }, candles: this.candles(instrument, timeframe) };
      }
    }
    return { status: feedStatus, candles: this.candles(instrument, timeframe) };
  }
}

/** In-memory durable-port reference implementation for local runs and tests. */
export class MemoryScanStateStore {
  private value: import("./types").PersistedScanState | undefined;
  async load(): Promise<import("./types").PersistedScanState | undefined> {
    return this.value ? structuredClone(this.value) : undefined;
  }
  async save(state: import("./types").PersistedScanState): Promise<void> {
    this.value = structuredClone(state);
  }
}

export class MemoryFeedPort implements FeedPort {
  private readonly feeds = new Map<string, { status: FeedFreshness; candles: readonly Candle[] }>();
  private readonly symbols: ScanInstrument[] = [];
  add(instrument: string, timeframe: Timeframe, candles: readonly Candle[], status: FeedFreshness): void {
    let record = this.symbols.find((item) => item.id === instrument);
    if (!record) { record = { id: instrument, timeframes: [] }; this.symbols.push(record); }
    if (!record.timeframes.includes(timeframe)) record.timeframes = [...record.timeframes, timeframe];
    this.feeds.set(`${instrument}|${timeframe}`, { status, candles: structuredClone(candles) });
  }
  instruments(): readonly ScanInstrument[] { return this.symbols.map((item) => ({ ...item, timeframes: [...item.timeframes] })); }
  snapshot(instrument: string, timeframe: Timeframe): FeedSnapshot {
    const feed = this.feeds.get(`${instrument}|${timeframe}`);
    return feed ? structuredClone(feed) : { status: { instrument, state: "NO_DATA", lastTickAt: null, ageMs: null }, candles: [] };
  }
}
