import type { Bar } from "./bars";

export interface Swing {
  /** Index of the pivot bar. */
  index: number;
  price: number;
  kind: "HIGH" | "LOW";
  /** Index of the first bar that proves the pivot (index + k). */
  confirmedAt: number;
}

/**
 * Confirmed swings using only bars[0..upTo]. A pivot at i is a high when bars[i].h is strictly
 * greater than the highs of the k bars before and the k bars after it (mirror for lows).
 * A pivot is returned only when i + k <= upTo, so the swing is known only after its k
 * right-hand bars have closed. Future bars never confirm a historical swing.
 */
export function confirmedSwings(bars: readonly Bar[], k: number, upTo: number): Swing[] {
  const out: Swing[] = [];
  const last = Math.min(upTo, bars.length - 1);
  if (k < 1) throw new RangeError("k must be at least 1");
  for (let i = k; i + k <= last; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = 1; j <= k; j++) {
      const before = bars[i - j];
      const after = bars[i + j];
      if (!(bars[i].h > before.h && bars[i].h > after.h)) isHigh = false;
      if (!(bars[i].l < before.l && bars[i].l < after.l)) isLow = false;
    }
    if (isHigh) out.push({ index: i, price: bars[i].h, kind: "HIGH", confirmedAt: i + k });
    if (isLow) out.push({ index: i, price: bars[i].l, kind: "LOW", confirmedAt: i + k });
  }
  return out;
}

/** Swing count per timeframe: 2 bars each side below H4, 3 bars each side on H4 and above. */
export function swingBarsFor(tf: "MN1" | "W1" | "D1" | "H4" | "H1" | "M30" | "M15" | "M5"): number {
  return tf === "H4" || tf === "D1" || tf === "W1" || tf === "MN1" ? 3 : 2;
}
