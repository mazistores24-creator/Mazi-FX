import type { Direction } from "@mazzi/core";
import type { Bar } from "./bars";

export interface SupplyDemandZone {
  kind: "DEMAND" | "SUPPLY";
  /** Boundaries are the high and low of the base candle. */
  high: number;
  low: number;
  /** Index of the base candle. */
  baseIndex: number;
  /** Index of the impulse candle that created the zone. */
  impulseIndex: number;
  /** False once a later bar has CLOSED inside the zone (mitigated). */
  fresh: boolean;
}

/**
 * Demand (LONG) or supply (SHORT) zones on closed bars up to upTo.
 * Interpretation (K13): the impulse is a candle of the trade direction whose body is at least
 * impulseAtr x ATR(14). The zone is the LAST opposite-colour candle before that impulse.
 * Fresh means no later bar has closed inside the zone.
 */
export function findZones(
  bars: readonly Bar[],
  atr: readonly number[],
  dir: Direction,
  upTo: number,
  impulseAtr = 1.5,
): SupplyDemandZone[] {
  const zones: SupplyDemandZone[] = [];
  const last = Math.min(upTo, bars.length - 1);
  for (let i = 1; i <= last; i++) {
    const a = atr[i];
    if (!Number.isFinite(a)) continue;
    const b = bars[i];
    const body = Math.abs(b.c - b.o);
    const isImpulse = dir === "LONG" ? b.c > b.o && body >= impulseAtr * a : b.c < b.o && body >= impulseAtr * a;
    if (!isImpulse) continue;
    let base = -1;
    for (let j = i - 1; j >= 0; j--) {
      const bj = bars[j];
      const opposite = dir === "LONG" ? bj.c < bj.o : bj.c > bj.o;
      if (opposite) {
        base = j;
        break;
      }
    }
    if (base < 0) continue;
    const z = { kind: dir === "LONG" ? "DEMAND" : "SUPPLY", high: bars[base].h, low: bars[base].l, baseIndex: base, impulseIndex: i } as const;
    let fresh = true;
    for (let k = i + 1; k <= last; k++) {
      if (bars[k].c <= z.high && bars[k].c >= z.low) {
        fresh = false;
        break;
      }
    }
    zones.push({ ...z, fresh });
  }
  return zones;
}

/** Overlap of two closed price ranges, in price units. Negative means no overlap. */
export function overlap(aLow: number, aHigh: number, bLow: number, bHigh: number): number {
  return Math.min(aHigh, bHigh) - Math.max(aLow, bLow);
}
