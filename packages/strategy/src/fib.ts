import { PROTECTED_STRATEGY, assertProtectedZone, type Direction } from "@mazzi/core";

/** Standard retracement and extension ladders from the spec (protected list). */
export const RETRACEMENTS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;
export const EXTENSIONS = [1.272, 1.618, 2.618, 4.236] as const;

export interface FibZone {
  direction: Direction;
  /** Impulse start: the low anchor for LONG, the high anchor for SHORT. */
  start: number;
  /** Impulse end: the high anchor for LONG, the low anchor for SHORT. */
  end: number;
  /** Lower and upper price edges of the baseline 50.0 to 61.8 percent zone (inclusive). */
  lower: number;
  upper: number;
}

/** Price at retracement fraction r of the impulse (start to end). r = 0 is the end, r = 1 the start. */
export function retracementPrice(start: number, end: number, r: number): number {
  const range = Math.abs(end - start);
  return direction(start, end) === "LONG" ? end - r * range : end + r * range;
}

/** Extension price measured from the impulse start, in the impulse direction. */
export function extensionPrice(start: number, end: number, e: number): number {
  const range = Math.abs(end - start);
  return direction(start, end) === "LONG" ? start + e * range : start - e * range;
}

function direction(start: number, end: number): Direction {
  return end > start ? "LONG" : "SHORT";
}

/**
 * Baseline entry zone. Always uses the protected constants; the assert makes any drift throw.
 * Bounds are inclusive. Callers pass the impulse as start to end (LONG: low then high).
 */
export function fibBaselineZone(dir: Direction, start: number, end: number): FibZone {
  const p = PROTECTED_STRATEGY.fibZone;
  assertProtectedZone(p.lower, p.upper);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) throw new RangeError("degenerate impulse");
  if ((dir === "LONG") !== (end > start)) throw new RangeError("impulse direction does not match setup direction");
  const a = retracementPrice(start, end, p.lower);
  const b = retracementPrice(start, end, p.upper);
  return { direction: dir, start, end, lower: Math.min(a, b), upper: Math.max(a, b) };
}

/** Inclusive membership test on the baseline zone. */
export function inFibZone(price: number, zone: FibZone): boolean {
  return price >= zone.lower && price <= zone.upper;
}
