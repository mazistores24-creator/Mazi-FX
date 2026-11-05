import { bucketEndMs, parseIsoUtc, type Candle, type Timeframe } from "@mazzi/core";

/**
 * Numeric closed bar used by the strategy engine. `t` is the bar open time in epoch ms,
 * `end` is the bar close time in epoch ms. Built only from complete candles, so a bar
 * that is still forming never reaches the rules.
 */
export interface Bar {
  readonly t: number;
  readonly end: number;
  readonly o: number;
  readonly h: number;
  readonly l: number;
  readonly c: number;
}

export function barsFromCandles(candles: readonly Candle[], tf: Timeframe): Bar[] {
  const bars = candles
    .filter((c) => c.complete && c.timeframe === tf)
    .map((c): Bar => {
      const t = parseIsoUtc(c.time);
      return {
        t,
        end: bucketEndMs(t, tf),
        o: Number(c.open),
        h: Number(c.high),
        l: Number(c.low),
        c: Number(c.close),
      };
    })
    .sort((a, b) => a.t - b.t);
  assertWellFormed(bars);
  return bars;
}

/** Throws unless bars are finite, strictly ordered by open time, and internally consistent. */
export function assertWellFormed(bars: readonly Bar[]): void {
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (![b.t, b.end, b.o, b.h, b.l, b.c].every(Number.isFinite)) throw new RangeError(`bar ${i} has a non-finite field`);
    if (b.h < Math.max(b.o, b.c) || b.l > Math.min(b.o, b.c) || b.h < b.l) throw new RangeError(`bar ${i} is internally inconsistent`);
    if (i > 0 && bars[i - 1].t >= b.t) throw new RangeError(`bars must be strictly ascending at index ${i}`);
  }
}
