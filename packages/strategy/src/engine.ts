import { PROTECTED_STRATEGY, type Direction, type SetupState } from "@mazzi/core";
import { atrSeries, rsiSeries } from "./indicators";
import { assertWellFormed, type Bar } from "./bars";
import { confirmedSwings, swingBarsFor } from "./swings";
import { findBreaks, type BreakEvent } from "./structure";
import { fibBaselineZone, type FibZone } from "./fib";
import { findZones, overlap } from "./supply-demand";
import { ichimokuGate, rsiGate, type GateResult } from "./gates";
import { m5Confirmation, type M5Outcome } from "./m5";
import { structuralStop, validateStop } from "./risk-plan";
import { transitionsFromSequence, type TransitionRecord } from "./lifecycle";

/**
 * Setup engine. Signal timeframe H4, higher timeframe D1 (Ichimoku gate), execution M5
 * (the only mandatory confirmation). All inputs are closed bars.
 *
 * evaluate(series, asOf) first keeps only bars that CLOSED at or before asOf, then computes the
 * decision from that truncated input alone. A future bar therefore cannot change an earlier
 * decision; the replay test checks this.
 */

export interface SeriesSet {
  H4: readonly Bar[];
  D1: readonly Bar[];
  M5: readonly Bar[];
}

export interface EngineConfig {
  /** Smallest price step used when testing zone overlap. */
  tickSize: number;
  /** Broker minimum stop distance in price units. 0 when unknown (no broker in phase 3). */
  minStopDistance: number;
  /** Signal bars after the break with no zone entry before the setup expires. */
  setupExpiryBars: number;
  /** Signal bars after a break with no setup before the break expires. */
  breakoutExpiryBars: number;
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = Object.freeze({
  tickSize: 0.00001,
  minStopDistance: 0,
  setupExpiryBars: 30,
  breakoutExpiryBars: 20,
});

export interface SetupDecision {
  /** Deterministic id from direction, break time and zone. Null when no setup exists. */
  id: string | null;
  state: SetupState;
  direction: Direction | null;
  reason: string;
  zone?: FibZone;
  anchorLow?: number;
  anchorHigh?: number;
  gates?: { ichimoku: GateResult; rsi: GateResult; supplyDemand: boolean };
  m5?: M5Outcome;
  stop?: number;
  stopCheck?: { ok: boolean; distance: number; reason: string };
  /** Only real, permitted state changes, starting from SCANNING. */
  transitions: TransitionRecord[];
}

const K_SIGNAL = swingBarsFor("H4");
const BREAK_OPTS = { k: K_SIGNAL, atrFraction: 0.1, falseBreakBars: 3 };

/** Keep only bars that closed at or before asOf, and check they are well formed. */
export function truncateSeries(series: SeriesSet, asOf: number): SeriesSet {
  const out: SeriesSet = {
    H4: series.H4.filter((b) => b.end <= asOf),
    D1: series.D1.filter((b) => b.end <= asOf),
    M5: series.M5.filter((b) => b.end <= asOf),
  };
  assertWellFormed(out.H4);
  assertWellFormed(out.D1);
  assertWellFormed(out.M5);
  return out;
}

/**
 * Anchors for a break. LONG: start = last confirmed swing low before the break level,
 * end = highest confirmed swing high between that low and the break bar. SHORT mirrors.
 */
function anchorsFor(
  bars: readonly Bar[],
  brk: BreakEvent,
  upTo: number,
): { start: number; end: number; startIdx: number } | undefined {
  const dir = brk.direction;
  const baseKind = dir === "LONG" ? "LOW" : "HIGH";
  const oppKind = dir === "LONG" ? "HIGH" : "LOW";
  const base = confirmedSwings(bars, K_SIGNAL, brk.breakBar - 1)
    .filter((s) => s.kind === baseKind && s.index < brk.levelIndex)
    .pop();
  if (!base) return undefined;
  const between = confirmedSwings(bars, K_SIGNAL, upTo).filter(
    (s) => s.kind === oppKind && s.index > base.index && s.index <= brk.breakBar,
  );
  if (between.length === 0) return undefined;
  const extreme = dir === "LONG" ? Math.max(...between.map((s) => s.price)) : Math.min(...between.map((s) => s.price));
  return { start: base.price, end: extreme, startIdx: base.index };
}

/** Pure evaluation at asOf. Same input always gives the same decision. */
export function evaluate(rawSeries: SeriesSet, asOf: number, cfg: EngineConfig = DEFAULT_ENGINE_CONFIG): SetupDecision {
  const series = truncateSeries(rawSeries, asOf);
  const h4 = series.H4;
  const d1 = series.D1;
  const m5 = series.M5;
  const period = PROTECTED_STRATEGY.rsi.period;
  const notReady = (reason: string): SetupDecision => ({
    id: null,
    state: "SCANNING",
    direction: null,
    reason,
    transitions: [],
  });
  if (h4.length < 60 || d1.length < 60) return notReady("WARMUP");
  const last = h4.length - 1;
  const atrH4 = atrSeries(h4, period);
  const atrM5 = atrSeries(m5, period);
  const atr = atrH4[last];
  if (!Number.isFinite(atr)) return notReady("ATR_WARMUP");

  // 1. Most recent break that has not been invalidated, in either direction.
  const breaks = [...findBreaks(h4, last, atrH4, "LONG", BREAK_OPTS), ...findBreaks(h4, last, atrH4, "SHORT", BREAK_OPTS)]
    .filter((b) => b.status !== "INVALIDATED")
    .sort((a, b) => b.breakBar - a.breakBar);
  if (breaks.length === 0) return notReady("NO_BREAK");
  const brk = breaks[0];
  const dir = brk.direction;

  const trace: { state: SetupState; reason: string }[] = [];
  const finish = (
    state: SetupState,
    reason: string,
    extra: Omit<SetupDecision, "state" | "reason" | "transitions" | "direction"> = { id: null },
    via: { state: SetupState; reason: string }[] = [],
  ): SetupDecision => {
    const seq = [{ state: "SCANNING" as SetupState, reason: "start" }, ...trace, ...via, { state, reason }];
    return { ...extra, state, reason, direction: dir, transitions: transitionsFromSequence(seq) };
  };

  // 2. Break expiry.
  if (last - brk.breakBar > cfg.breakoutExpiryBars) return finish("EXPIRED", "BREAKOUT_EXPIRED");

  // 3. Impulse leg must be at least 1 ATR (structure found).
  const anchors = anchorsFor(h4, brk, last);
  if (!anchors) return finish("SCANNING", "NO_ANCHORS");
  if (!(Math.abs(anchors.end - anchors.start) >= atr)) return finish("SCANNING", "LEG_BELOW_1_ATR");
  trace.push({ state: "STRUCTURE_FOUND", reason: brk.kind });

  const zone = fibBaselineZone(dir, anchors.start, anchors.end);
  const anchorLow = dir === "LONG" ? anchors.start : anchors.end;
  const anchorHigh = dir === "LONG" ? anchors.end : anchors.start;
  const anchorPrice = dir === "LONG" ? anchors.start : anchors.end;
  const base = { id: `${dir}-${brk.breakTime}-${zone.lower}-${zone.upper}`, zone, anchorLow, anchorHigh };

  // 4. Invalidation before entry: close beyond the anchor, or a CHoCH against the setup.
  const beyondAnchor = h4.slice(brk.breakBar + 1).some((b) => (dir === "LONG" ? b.c < anchorPrice : b.c > anchorPrice));
  if (beyondAnchor) return finish("INVALIDATED", "CLOSE_BEYOND_ANCHOR", base);
  const opposite = dir === "LONG" ? "SHORT" : "LONG";
  const counterChoch = findBreaks(h4, last, atrH4, opposite, BREAK_OPTS).some(
    (e) => e.kind === "CHOCH" && e.breakBar > brk.breakBar && e.status !== "INVALIDATED",
  );
  if (counterChoch) return finish("INVALIDATED", "CHOCH_AGAINST_SETUP", base);

  // 5. Gates: Ichimoku (H4 vs D1), RSI back across 50 from the anchor, fresh supply/demand overlap.
  const ichimoku = ichimokuGate(h4, last, d1, d1.length - 1, dir);
  const rsi = rsiGate(rsiSeries(h4, period), anchors.startIdx, last, dir);
  const supplyDemand = findZones(h4, atrH4, dir, last).some(
    (z) => z.fresh && overlap(zone.lower, zone.upper, z.low, z.high) >= cfg.tickSize,
  );
  const gates = { ichimoku, rsi, supplyDemand };
  const withGates = { ...base, gates };
  if (!ichimoku.pass || !rsi.pass || !supplyDemand) {
    if (last - brk.breakBar >= cfg.setupExpiryBars) return finish("EXPIRED", "GATES_NOT_MET_IN_TIME", withGates);
    return finish("ZONE_ARMED", "GATES_NOT_MET", withGates, [{ state: "ZONE_ARMED", reason: "GATES_PENDING" }]);
  }
  trace.push({ state: "ZONE_ARMED", reason: "GATES_OK" });

  // 6. Zone entry on M5, from the break onward.
  const breakTime = h4[brk.breakBar].end;
  const entryIdx = m5.findIndex((b) => b.end > breakTime && b.h >= zone.lower && b.l <= zone.upper);
  if (entryIdx < 0) {
    if (last - brk.breakBar >= cfg.setupExpiryBars) return finish("EXPIRED", "NO_ZONE_ENTRY_IN_EXPIRY", withGates);
    return finish("ZONE_ARMED", "WAITING_FOR_ZONE_ENTRY", withGates);
  }
  trace.push({ state: "AWAITING_M5", reason: "ZONE_ENTERED" });

  // 7. M5 confirmation (the only producer of CONFIRMED).
  const m5Out = m5Confirmation(m5, {
    direction: dir,
    entryIndex: entryIdx,
    zoneEdge: dir === "LONG" ? zone.lower : zone.upper,
    anchor: anchorPrice,
    atrM5,
    expiryBars: PROTECTED_STRATEGY.m5ConfirmationExpiryBars,
  });
  const withM5 = { ...withGates, m5: m5Out };
  if (m5Out.state === "INVALIDATED") return finish("INVALIDATED", m5Out.reason, withM5);
  if (m5Out.state === "EXPIRED") return finish("EXPIRED", m5Out.reason, withM5);
  if (m5Out.state === "PENDING") return finish("AWAITING_M5", m5Out.reason, withM5);

  // 8. Stop check at confirmation. A rejected stop is never moved; the setup is invalidated.
  const stop = structuralStop(dir, anchorPrice, atr);
  const entry = dir === "LONG" ? zone.upper : zone.lower;
  const stopCheck = validateStop({ direction: dir, entry, stop, atrSignal: atr, minStopDistance: cfg.minStopDistance });
  const withStop = { ...withM5, stop, stopCheck };
  if (!stopCheck.ok) return finish("INVALIDATED", stopCheck.reason, withStop);
  return finish("CONFIRMED", m5Out.reason, withStop);
}

/** Only a CONFIRMED setup with a CONFIRMED M5 event and an accepted stop may reach an order path. */
export function mayRequestOrder(d: SetupDecision): boolean {
  return d.state === "CONFIRMED" && d.m5?.state === "CONFIRMED" && d.stopCheck?.ok === true;
}
