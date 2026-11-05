import type { Candle, Timeframe } from "@mazzi/core";

/**
 * In-memory hot cache of recent complete and forming bars per instrument and timeframe.
 * The strategy layer reads from here. Bounded per series, oldest bars evicted.
 * Bars are keyed by their UTC open time, so a re-delivered bar replaces the old one
 * instead of appending a duplicate.
 */
export class HotCandleCache {
  private readonly series = new Map<string, Map<string, Candle>>();

  constructor(private readonly maxBarsPerSeries: number) {
    if (!Number.isInteger(maxBarsPerSeries) || maxBarsPerSeries < 1) {
      throw new RangeError("maxBarsPerSeries must be a positive integer");
    }
  }

  private key(instrument: string, tf: Timeframe): string {
    return `${instrument}|${tf}`;
  }

  put(candle: Candle): void {
    const k = this.key(candle.instrument, candle.timeframe);
    let bars = this.series.get(k);
    if (!bars) {
      bars = new Map();
      this.series.set(k, bars);
    }
    bars.delete(candle.time);
    bars.set(candle.time, candle);
    while (bars.size > this.maxBarsPerSeries) {
      const oldest = bars.keys().next().value as string;
      bars.delete(oldest);
    }
  }

  /** Bars in ascending time order. limit returns the most recent n bars. */
  get(instrument: string, tf: Timeframe, limit?: number): Candle[] {
    const bars = this.series.get(this.key(instrument, tf));
    if (!bars) return [];
    const all = [...bars.values()].sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
    return limit === undefined ? all : all.slice(Math.max(0, all.length - limit));
  }

  size(instrument: string, tf: Timeframe): number {
    return this.series.get(this.key(instrument, tf))?.size ?? 0;
  }

  seriesKeys(): string[] {
    return [...this.series.keys()];
  }
}
