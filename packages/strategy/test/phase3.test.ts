import { describe, expect, it } from "vitest";
import { PROTECTED_STRATEGY } from "@mazzi/core";
import type { Bar } from "../src/bars";
import { confirmedSwings } from "../src/swings";
import { atrSeries, rsiSeries } from "../src/indicators";
import { fibBaselineZone, inFibZone } from "../src/fib";
import { m5Confirmation } from "../src/m5";
import { validateStop, structuralStop } from "../src/risk-plan";
import { canTransition, isTerminal, applyTransition, transitionsFromSequence } from "../src/lifecycle";
import { evaluate, truncateSeries, type SeriesSet } from "../src/engine";

const TF_MS = 4 * 3600_000;

function bar(i: number, o: number, h: number, l: number, c: number, ms = TF_MS): Bar {
  return { t: i * ms, end: (i + 1) * ms, o, h, l, c };
}

/** A zig-zag H4 series: valley, rally, pullback, rally again. */
function zigzag(): Bar[] {
  const closes: number[] = [];
  for (let i = 0; i < 60; i++) closes.push(100 + 10 * Math.sin(i / 3));
  return closes.map((c, i) => bar(i, c - 0.2, c + 0.8, c - 0.8, c));
}

describe("lifecycle", () => {
  it("terminal states have no outgoing transitions", () => {
    for (const from of ["EXPIRED", "INVALIDATED", "CLOSED"] as const) {
      expect(isTerminal(from)).toBe(true);
      for (const to of ["SCANNING", "CONFIRMED", "CLOSED", "EXPIRED"] as const) {
        expect(canTransition(from, to)).toBe(false);
      }
    }
  });

  it("only CONFIRMED can lead to CLOSED; no skipping states", () => {
    expect(canTransition("AWAITING_M5", "CONFIRMED")).toBe(true);
    expect(canTransition("SCANNING", "CONFIRMED")).toBe(false);
    expect(canTransition("ZONE_ARMED", "CONFIRMED")).toBe(false);
    expect(canTransition("CONFIRMED", "CLOSED")).toBe(true);
  });

  it("applyTransition throws on a forbidden move and records real changes only", () => {
    expect(() => applyTransition("INVALIDATED", "SCANNING", "x")).toThrow();
    const recs = transitionsFromSequence([
      { state: "SCANNING", reason: "start" },
      { state: "STRUCTURE_FOUND", reason: "BOS" },
      { state: "STRUCTURE_FOUND", reason: "again" },
    ]);
    expect(recs.map((r) => r.to)).toEqual(["STRUCTURE_FOUND"]);
  });
});

describe("protected zone and fibonacci", () => {
  it("baseline zone is the protected 50.0 to 61.8 percent band", () => {
    const z = fibBaselineZone("LONG", 100, 200);
    expect(z.lower).toBeCloseTo(200 - 100 * 0.618, 9);
    expect(z.upper).toBeCloseTo(200 - 100 * 0.5, 9);
    expect(PROTECTED_STRATEGY.fibZone).toEqual({ lower: 0.5, upper: 0.618 });
    expect(inFibZone(150, z)).toBe(true);
    expect(inFibZone(120, z)).toBe(false);
  });

  it("rejects an impulse whose direction does not match the setup", () => {
    expect(() => fibBaselineZone("SHORT", 100, 200)).toThrow();
  });
});

describe("stops (K17): rejected, never moved", () => {
  it("rejects a stop closer than 0.5 x ATR", () => {
    const r = validateStop({ direction: "LONG", entry: 100, stop: 99.6, atrSignal: 1, minStopDistance: 0 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("STOP_BELOW_HALF_ATR");
  });

  it("rejects a stop on the wrong side", () => {
    const r = validateStop({ direction: "LONG", entry: 100, stop: 101, atrSignal: 1, minStopDistance: 0 });
    expect(r.reason).toBe("STOP_ON_WRONG_SIDE");
  });

  it("accepts a stop at least 0.5 x ATR away and places structural stops beyond the anchor", () => {
    const stop = structuralStop("LONG", 100, 2);
    expect(stop).toBeLessThan(100);
    const r = validateStop({ direction: "LONG", entry: 110, stop, atrSignal: 2, minStopDistance: 0 });
    expect(r.ok).toBe(true);
  });
});

describe("M5 confirmation (K16)", () => {
  const atr = Array.from({ length: 30 }, () => 1);
  const base = (i: number, o: number, h: number, l: number, c: number) => bar(i, o, h, l, c, 300_000);

  it("CONFIRMED needs an M5 close above the prior high, with no deep wick", () => {
    const m5 = [base(0, 100, 101, 99, 100.5), base(1, 100.5, 101.2, 100.2, 100.8), base(2, 100.8, 102, 100.7, 101.8)];
    const out = m5Confirmation(m5, { direction: "LONG", entryIndex: 0, zoneEdge: 99.5, anchor: 90, atrM5: atr, expiryBars: 12 });
    expect(out.state).toBe("CONFIRMED");
  });

  it("expires after the protected 12 M5 bars with no confirming close", () => {
    const flat = Array.from({ length: 20 }, (_, i) => base(i, 100, 100.4, 99.9, 100));
    const out = m5Confirmation(flat, { direction: "LONG", entryIndex: 0, zoneEdge: 99, anchor: 90, atrM5: atr, expiryBars: 12 });
    expect(out.state).toBe("EXPIRED");
    expect(PROTECTED_STRATEGY.m5ConfirmationExpiryBars).toBe(12);
  });
});

describe("causality", () => {
  it("swings are not confirmed before k right-hand bars close", () => {
    const bars = zigzag();
    const k = 2;
    const early = confirmedSwings(bars, k, 5);
    for (const s of early) expect(s.confirmedAt).toBeLessThanOrEqual(5);
    for (const s of confirmedSwings(bars, k, 30)) {
      expect(s.index + k).toBeLessThanOrEqual(s.confirmedAt);
    }
  });

  it("indicators at bar t do not change when later bars are appended", () => {
    const bars = zigzag();
    const atrFull = atrSeries(bars, 14);
    const rsiFull = rsiSeries(bars, 14);
    const cut = 40;
    const atrCut = atrSeries(bars.slice(0, cut), 14);
    const rsiCut = rsiSeries(bars.slice(0, cut), 14);
    for (let i = 0; i < cut; i++) {
      if (Number.isFinite(atrCut[i])) expect(atrFull[i]).toBeCloseTo(atrCut[i], 9);
      if (Number.isFinite(rsiCut[i])) expect(rsiFull[i]).toBeCloseTo(rsiCut[i], 9);
    }
  });

  it("engine decision at asOf is identical when bars after asOf are altered (replay)", () => {
    const h4 = zigzag();
    const d1 = Array.from({ length: 80 }, (_, i) => bar(i, 100 + i * 0.1, 100 + i * 0.1 + 1, 100 + i * 0.1 - 1, 100 + i * 0.1, 86_400_000));
    const m5 = Array.from({ length: 200 }, (_, i) => bar(i, 100, 101, 99, 100 + (i % 3) * 0.1, 300_000));
    const asOf = h4[45].end;
    const series: SeriesSet = { H4: h4, D1: d1, M5: m5 };
    const a = evaluate(series, asOf);

    // Alter every bar that closes after asOf to a wildly different value.
    const tampered: SeriesSet = {
      H4: h4.map((b) => (b.end > asOf ? bar(b.t / TF_MS, 500, 900, 400, 800) : b)),
      D1: d1.map((b) => (b.end > asOf ? bar(b.t / 86_400_000, 1, 2, 0.5, 1.5, 86_400_000) : b)),
      M5: m5.map((b) => (b.end > asOf ? bar(b.t / 300_000, 9, 9, 9, 9, 300_000) : b)),
    };
    const b = evaluate(tampered, asOf);
    expect(b).toEqual(a);
  });

  it("truncateSeries drops any bar that closed after asOf", () => {
    const h4 = zigzag();
    const cut = truncateSeries({ H4: h4, D1: [], M5: [] }, h4[10].end);
    expect(cut.H4.length).toBe(11);
  });
});

describe("engine guards", () => {
  it("returns SCANNING with WARMUP on too little data, never a setup", () => {
    const d = evaluate({ H4: zigzag().slice(0, 10), D1: [], M5: [] }, Number.MAX_SAFE_INTEGER);
    expect(d.state).toBe("SCANNING");
    expect(d.id).toBeNull();
  });
});
