import { PROTECTED_STRATEGY } from "./constants";
import type { Candle, Decimal, Timeframe } from "./domain";

/**
 * Timeframes the platform supports. Sourced from the protected hierarchy, which
 * contains no one-minute bar. Adapters must not request or store bars outside this list.
 */
export const SUPPORTED_TIMEFRAMES: readonly Timeframe[] = PROTECTED_STRATEGY.timeframes;

const DAY_MS = 86_400_000;

/** Fixed bar length in seconds. MN1 is calendar-based, so it has no fixed length. */
const FIXED_SECONDS: Readonly<Partial<Record<Timeframe, number>>> = {
  W1: 604_800,
  D1: 86_400,
  H4: 14_400,
  H1: 3_600,
  M30: 1_800,
  M15: 900,
  M5: 300,
};

export function isSupportedTimeframe(value: string): value is Timeframe {
  return (SUPPORTED_TIMEFRAMES as readonly string[]).includes(value);
}

/** Fixed bar length in seconds, or undefined for calendar-based MN1. */
export function timeframeSeconds(tf: Timeframe): number | undefined {
  return FIXED_SECONDS[tf];
}

/** Epoch milliseconds to an ISO-8601 UTC string with a trailing Z. */
export function toIsoUtc(epochMs: number): string {
  if (!Number.isFinite(epochMs)) throw new RangeError("epochMs must be finite");
  return new Date(epochMs).toISOString();
}

/** Parses a UTC ISO-8601 string. Offsets other than Z are refused so timezone never drifts. */
export function parseIsoUtc(time: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(time)) {
    throw new RangeError(`not a UTC ISO timestamp: ${time}`);
  }
  return Date.parse(time);
}

/** Start of the bar containing epochMs. W1 starts Monday 00:00 UTC; MN1 starts on the 1st UTC. */
export function bucketStartMs(epochMs: number, tf: Timeframe): number {
  const d = new Date(epochMs);
  if (tf === "MN1") return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  if (tf === "W1") {
    const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    return dayStart - ((d.getUTCDay() + 6) % 7) * DAY_MS;
  }
  const size = (timeframeSeconds(tf) as number) * 1000;
  return Math.floor(epochMs / size) * size;
}

/** Start of the bar after the bar that starts at startMs. */
export function bucketEndMs(startMs: number, tf: Timeframe): number {
  if (tf === "MN1") {
    const d = new Date(startMs);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  }
  return startMs + (timeframeSeconds(tf) as number) * 1000;
}

export interface TickInput {
  instrument: string;
  epochMs: number;
  quote: Decimal;
}

export interface CandleEvent {
  /** UPDATE: the forming bar changed. CLOSE: the bar is final (complete = true). */
  kind: "UPDATE" | "CLOSE";
  candle: Candle;
}

/**
 * Builds bars from a tick stream. Bars are UTC-aligned. A tick that falls
 * into an older bar than the current one is counted as late and dropped.
 * Non-positive or non-numeric quotes are counted as rejected and dropped.
 */
export class TickCandleAggregator {
  private readonly current = new Map<string, Candle>();
  private late = 0;
  private rejected = 0;

  constructor(private readonly timeframe: Timeframe) {}

  ingest(tick: TickInput): CandleEvent[] {
    const price = Number(tick.quote);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(tick.epochMs)) {
      this.rejected++;
      return [];
    }
    const start = bucketStartMs(tick.epochMs, this.timeframe);
    const cur = this.current.get(tick.instrument);
    if (!cur || start > parseIsoUtc(cur.time)) {
      const events: CandleEvent[] = [];
      if (cur) events.push({ kind: "CLOSE", candle: { ...cur, complete: true } });
      const candle: Candle = {
        time: toIsoUtc(start),
        open: tick.quote,
        high: tick.quote,
        low: tick.quote,
        close: tick.quote,
        timeframe: this.timeframe,
        instrument: tick.instrument,
        complete: false,
      };
      this.current.set(tick.instrument, candle);
      events.push({ kind: "UPDATE", candle });
      return events;
    }
    if (start < parseIsoUtc(cur.time)) {
      this.late++;
      return [];
    }
    const next: Candle = {
      ...cur,
      high: price > Number(cur.high) ? tick.quote : cur.high,
      low: price < Number(cur.low) ? tick.quote : cur.low,
      close: tick.quote,
    };
    this.current.set(tick.instrument, next);
    return [{ kind: "UPDATE", candle: next }];
  }

  currentCandle(instrument: string): Candle | undefined {
    return this.current.get(instrument);
  }

  stats(): { late: number; rejected: number } {
    return { late: this.late, rejected: this.rejected };
  }
}

/**
 * Convenience: aggregate an ordered tick list. Returns every closed bar plus the
 * forming bar for each instrument (complete = false), sorted by time.
 */
export function ticksToCandles(ticks: readonly TickInput[], tf: Timeframe): Candle[] {
  const agg = new TickCandleAggregator(tf);
  const closed: Candle[] = [];
  const instruments = new Set<string>();
  for (const t of ticks) {
    instruments.add(t.instrument);
    for (const ev of agg.ingest(t)) {
      if (ev.kind === "CLOSE") closed.push(ev.candle);
    }
  }
  const forming: Candle[] = [];
  for (const inst of instruments) {
    const c = agg.currentCandle(inst);
    if (c) forming.push(c);
  }
  return [...closed, ...forming].sort(
    (a, b) => parseIsoUtc(a.time) - parseIsoUtc(b.time) || a.instrument.localeCompare(b.instrument),
  );
}

/**
 * Builds higher-timeframe bars (W1, MN1) from finer source bars (typically D1).
 * A bar is complete once a later source bar exists after its end. Otherwise it is
 * marked incomplete and must not be treated as a confirmed close.
 */
export function aggregateFromSeries(source: readonly Candle[], tf: Timeframe): Candle[] {
  if (source.length === 0) return [];
  const sorted = [...source].sort((a, b) => parseIsoUtc(a.time) - parseIsoUtc(b.time));
  const latestSourceMs = parseIsoUtc(sorted[sorted.length - 1].time);
  const groups = new Map<number, Candle[]>();
  for (const c of sorted) {
    const key = bucketStartMs(parseIsoUtc(c.time), tf);
    const list = groups.get(key);
    if (list) list.push(c);
    else groups.set(key, [c]);
  }
  const out: Candle[] = [];
  for (const start of Array.from(groups.keys()).sort((a, b) => a - b)) {
    const list = groups.get(start) as Candle[];
    let high = list[0].high;
    let low = list[0].low;
    for (const c of list) {
      if (Number(c.high) > Number(high)) high = c.high;
      if (Number(c.low) < Number(low)) low = c.low;
    }
    out.push({
      time: toIsoUtc(start),
      open: list[0].open,
      high,
      low,
      close: list[list.length - 1].close,
      timeframe: tf,
      instrument: list[0].instrument,
      complete: bucketEndMs(start, tf) <= latestSourceMs,
    });
  }
  return out;
}

export interface Gap {
  timeframe: Timeframe;
  /** Last bar present before the hole. */
  afterTime: string;
  /** First bar present after the hole. */
  nextTime: string;
  missingBars: number;
}

export interface SeriesReport {
  /** Sorted, de-duplicated bars. */
  candles: Candle[];
  gaps: Gap[];
  /** Bars whose open time appeared more than once. The last occurrence is kept. */
  duplicates: number;
  /** Bars whose open time is not on a bar boundary for the timeframe. */
  misaligned: string[];
  /** True when a gap was longer than MAX_GAP_SCAN bars and the count was capped. */
  truncated: boolean;
}

export const MAX_GAP_SCAN = 10_000;

/**
 * Sorts and de-duplicates a series, then reports holes. Missing bars are never
 * filled with synthetic data. A hole is reported and the strategy layer decides.
 * Deriv synthetics trade around the clock, so any hole is a feed problem. Forex
 * and metals will show weekend and holiday holes once those markets are added.
 */
export function analyzeSeries(input: readonly Candle[], tf: Timeframe): SeriesReport {
  const sorted = [...input].sort((a, b) => parseIsoUtc(a.time) - parseIsoUtc(b.time));
  const dedup: Candle[] = [];
  let duplicates = 0;
  for (const c of sorted) {
    const prev = dedup[dedup.length - 1];
    if (prev && prev.time === c.time) {
      dedup[dedup.length - 1] = c;
      duplicates++;
    } else {
      dedup.push(c);
    }
  }
  const misaligned: string[] = [];
  const gaps: Gap[] = [];
  let truncated = false;
  for (let i = 0; i < dedup.length; i++) {
    const t = parseIsoUtc(dedup[i].time);
    if (bucketStartMs(t, tf) !== t) misaligned.push(dedup[i].time);
    if (i === 0) continue;
    const prevStart = parseIsoUtc(dedup[i - 1].time);
    const next = t;
    let cursor = bucketEndMs(prevStart, tf);
    let missing = 0;
    while (cursor < next && missing < MAX_GAP_SCAN) {
      missing++;
      cursor = bucketEndMs(cursor, tf);
    }
    if (cursor < next) truncated = true;
    if (missing > 0) {
      gaps.push({ timeframe: tf, afterTime: dedup[i - 1].time, nextTime: dedup[i].time, missingBars: missing });
    }
  }
  return { candles: dedup, gaps, duplicates, misaligned, truncated };
}

/** Structural checks on one bar. Returns issue codes; an empty array means the bar is valid. */
export function validateCandle(c: Candle): string[] {
  const issues: string[] = [];
  const o = Number(c.open);
  const h = Number(c.high);
  const l = Number(c.low);
  const cl = Number(c.close);
  if (![o, h, l, cl].every((v) => Number.isFinite(v) && v > 0)) {
    issues.push("NON_NUMERIC_OR_NON_POSITIVE");
  } else {
    if (h < Math.max(o, cl)) issues.push("HIGH_BELOW_BODY");
    if (l > Math.min(o, cl)) issues.push("LOW_ABOVE_BODY");
    if (h < l) issues.push("HIGH_BELOW_LOW");
  }
  try {
    const t = parseIsoUtc(c.time);
    if (bucketStartMs(t, c.timeframe) !== t) issues.push("MISALIGNED_OPEN_TIME");
  } catch {
    issues.push("INVALID_TIMESTAMP");
  }
  return issues;
}
