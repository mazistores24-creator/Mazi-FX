import type { Direction } from "@mazzi/core";
import type { Bar } from "./bars";
import { confirmedSwings, type Swing } from "./swings";

export type StructureLabel = "HH_HL" | "LH_LL" | "MIXED" | "INSUFFICIENT";

/** Labels the structure from the last two confirmed highs and the last two confirmed lows. */
export function labelStructure(swings: readonly Swing[]): StructureLabel {
  const highs = swings.filter((s) => s.kind === "HIGH");
  const lows = swings.filter((s) => s.kind === "LOW");
  if (highs.length < 2 || lows.length < 2) return "INSUFFICIENT";
  const h1 = highs[highs.length - 2].price;
  const h2 = highs[highs.length - 1].price;
  const l1 = lows[lows.length - 2].price;
  const l2 = lows[lows.length - 1].price;
  if (h2 > h1 && l2 > l1) return "HH_HL";
  if (h2 < h1 && l2 < l1) return "LH_LL";
  return "MIXED";
}

export interface BreakEvent {
  kind: "BOS" | "CHOCH";
  /** LONG = bullish break of a swing high. SHORT = bearish break of a swing low. */
  direction: Direction;
  breakBar: number;
  breakTime: number;
  /** The broken swing price. */
  level: number;
  levelIndex: number;
  /** PENDING until falseBreakBars bars after the break have closed. */
  status: "PENDING" | "VALID" | "INVALIDATED";
  invalidatedAt?: number;
}

export interface BreakOptions {
  /** Swing window (bars each side). */
  k: number;
  /** Required clearance beyond the level, in ATR units (0.1 per the spec). */
  atrFraction: number;
  /** A close back beyond the level within this many bars invalidates the break. */
  falseBreakBars: number;
}

/**
 * Break-of-structure detection on closed bars up to t. A break needs a candle BODY close
 * beyond the swing level by at least atrFraction x ATR. Wick-only breaks and equal levels
 * do not count. Each swing level produces at most one break event (the first qualifying bar).
 * A break is CHOCH when it runs against the structure known before the break bar, otherwise BOS.
 * Decisions at t use only bars[0..t].
 */
export function findBreaks(
  bars: readonly Bar[],
  t: number,
  atr: readonly number[],
  dir: Direction,
  opts: BreakOptions,
): BreakEvent[] {
  const upTo = Math.min(t, bars.length - 1);
  const wanted = dir === "LONG" ? "HIGH" : "LOW";
  const swings = confirmedSwings(bars, opts.k, upTo).filter((s) => s.kind === wanted);
  const events: BreakEvent[] = [];
  for (const s of swings) {
    for (let b = s.confirmedAt + 1; b <= upTo; b++) {
      const a = atr[b];
      if (!Number.isFinite(a)) continue;
      const c = bars[b].c;
      const broke = dir === "LONG" ? c > s.price + opts.atrFraction * a : c < s.price - opts.atrFraction * a;
      if (!broke) continue;
      const label = labelStructure(confirmedSwings(bars, opts.k, b - 1));
      const counter = dir === "LONG" ? label === "LH_LL" : label === "HH_HL";
      let invalidatedAt: number | undefined;
      const checkEnd = Math.min(b + opts.falseBreakBars, upTo);
      for (let j = b + 1; j <= checkEnd; j++) {
        const cj = bars[j].c;
        if (dir === "LONG" ? cj < s.price : cj > s.price) {
          invalidatedAt = j;
          break;
        }
      }
      let status: BreakEvent["status"];
      if (invalidatedAt !== undefined) status = "INVALIDATED";
      else if (b + opts.falseBreakBars <= upTo) status = "VALID";
      else status = "PENDING";
      events.push({
        kind: counter ? "CHOCH" : "BOS",
        direction: dir,
        breakBar: b,
        breakTime: bars[b].end,
        level: s.price,
        levelIndex: s.index,
        status,
        ...(invalidatedAt !== undefined ? { invalidatedAt } : {}),
      });
      break;
    }
  }
  return events;
}
