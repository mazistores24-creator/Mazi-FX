import type { Direction } from "@mazzi/core";
import type { Bar } from "./bars";

export type M5Outcome =
  | { state: "PENDING"; reason: "NO_M5_CLOSE_YET" }
  | { state: "CONFIRMED"; barIndex: number; reason: "M5_CLOSE_BEYOND_PRIOR_HIGH" }
  | { state: "EXPIRED"; reason: "M5_EXPIRED" }
  | { state: "INVALIDATED"; barIndex: number; reason: "M5_CLOSE_BEYOND_ANCHOR" };

export interface M5Input {
  direction: Direction;
  /** Index into the M5 series of the bar that first entered the zone. */
  entryIndex: number;
  /** Zone edge the confirmation bar may not pierce by more than 0.1 x ATR(M5): lower edge for LONG, upper edge for SHORT. */
  zoneEdge: number;
  anchor: number;
  atrM5: readonly number[];
  /** Max M5 bars after entry (protected 12). */
  expiryBars: number;
  /** Optional extra per-bar gate, e.g. RSI back across the level. Called with the M5 index. */
  extraGate?: (m5Index: number) => boolean;
}

/**
 * The only producer of M5 CONFIRMED. A bullish confirmation is an M5 bar that CLOSES above the
 * prior M5 bar high, does not wick below the zone lower edge by more than 0.1 x ATR(M5) (K16),
 * and passes the optional extra gate. Only bars after entry are examined. An M5 close below the
 * anchor (bearish: above) before confirmation invalidates. No close inside expiryBars means EXPIRED.
 * Evaluation stops at the last closed M5 bar in the input array (caller passes closed bars only).
 */
export function m5Confirmation(bars: readonly Bar[], inp: M5Input): M5Outcome {
  const isLong = inp.direction === "LONG";
  const last = Math.min(bars.length - 1, inp.entryIndex + inp.expiryBars);
  for (let j = inp.entryIndex + 1; j <= last; j++) {
    const b = bars[j];
    const prior = bars[j - 1];
    const atr = inp.atrM5[j];
    if (!Number.isFinite(atr)) continue;
    if (isLong ? b.c < inp.anchor : b.c > inp.anchor) return { state: "INVALIDATED", barIndex: j, reason: "M5_CLOSE_BEYOND_ANCHOR" };
    const wickOk = isLong ? b.l >= inp.zoneEdge - 0.1 * atr : b.h <= inp.zoneEdge + 0.1 * atr;
    const closeOk = isLong ? b.c > prior.h : b.c < prior.l;
    if (closeOk && wickOk && (!inp.extraGate || inp.extraGate(j))) {
      return { state: "CONFIRMED", barIndex: j, reason: "M5_CLOSE_BEYOND_PRIOR_HIGH" };
    }
  }
  if (last - inp.entryIndex >= inp.expiryBars) return { state: "EXPIRED", reason: "M5_EXPIRED" };
  return { state: "PENDING", reason: "NO_M5_CLOSE_YET" };
}
