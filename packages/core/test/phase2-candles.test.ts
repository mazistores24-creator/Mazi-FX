import { describe, expect, it } from "vitest";
import { TickCandleAggregator, aggregateFromSeries, analyzeSeries, bucketStartMs, toIsoUtc, type Candle } from "../src";
import { StalenessMonitor } from "../src/staleness";

const c = (time: string, o: string, h: string, l: string, cl: string, tf: "M5" | "D1" = "M5"): Candle => ({
  time, open: o, high: h, low: l, close: cl, timeframe: tf, instrument: "R_100", complete: true,
});

describe("candle aggregation", () => {
  it("aligns M5 buckets to UTC and aggregates OHLC from ticks", () => {
    const start = Date.parse("2026-01-05T10:00:00Z");
    expect(bucketStartMs(start + 3 * 60_000, "M5")).toBe(start);
    const agg = new TickCandleAggregator("M5");
    agg.ingest({ instrument: "R_100", epochMs: start + 1000, quote: "10" });
    agg.ingest({ instrument: "R_100", epochMs: start + 60_000, quote: "12" });
    agg.ingest({ instrument: "R_100", epochMs: start + 120_000, quote: "9" });
    const cur = agg.currentCandle("R_100");
    expect(cur).toMatchObject({ time: "2026-01-05T10:00:00.000Z", open: "10", high: "12", low: "9", close: "9", complete: false });
  });

  it("emits a CLOSE event when the bucket rolls over", () => {
    const start = Date.parse("2026-01-05T10:00:00Z");
    const agg = new TickCandleAggregator("M5");
    agg.ingest({ instrument: "R_100", epochMs: start + 1000, quote: "10" });
    const events = agg.ingest({ instrument: "R_100", epochMs: start + 300_000 + 1000, quote: "11" });
    expect(events.some((e) => e.kind === "CLOSE")).toBe(true);
  });

  it("builds D1 bars from finer source bars and marks the last one incomplete", () => {
    const d = (day: string) => c(`${day}T00:00:00Z`, "1", "2", "1", "2", "D1");
    const out = aggregateFromSeries([d("2026-01-05"), d("2026-01-06")], "W1");
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((b) => b.time.endsWith("Z"))).toBe(true);
  });
});

describe("gap detection", () => {
  it("reports missing M5 bars and does not fill them", () => {
    const t0 = Date.parse("2026-01-05T10:00:00Z");
    const series = [c(toIsoUtc(t0), "1", "1", "1", "1"), c(toIsoUtc(t0 + 3 * 300_000), "1", "1", "1", "1")];
    const r = analyzeSeries(series, "M5");
    expect(r.gaps).toHaveLength(1);
    expect(r.gaps[0].missingBars).toBe(2);
    expect(r.candles).toHaveLength(2);
  });

  it("removes duplicate bars by time", () => {
    const t0 = toIsoUtc(Date.parse("2026-01-05T10:00:00Z"));
    const r = analyzeSeries([c(t0, "1", "1", "1", "1"), c(t0, "2", "2", "2", "2")], "M5");
    expect(r.duplicates).toBe(1);
    expect(r.candles).toHaveLength(1);
  });
});

describe("staleness monitor", () => {
  it("reports NO_DATA before any tick, FRESH after a tick, STALE once the threshold passes", () => {
    let now = 1_000_000;
    const m = new StalenessMonitor(5000, () => now);
    m.register("R_10");
    expect(m.snapshot()[0].state).toBe("NO_DATA");
    m.recordTick("R_10", now);
    expect(m.snapshot()[0].state).toBe("FRESH");
    now += 6000;
    expect(m.snapshot()[0].state).toBe("STALE");
  });

  it("rejects a non-positive threshold", () => {
    expect(() => new StalenessMonitor(0)).toThrow(RangeError);
  });
});
