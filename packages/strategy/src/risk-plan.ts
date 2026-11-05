import { PROTECTED_STRATEGY, type Direction } from "@mazzi/core";

export interface StopCheckInput {
  direction: Direction;
  entry: number;
  stop: number;
  atrSignal: number;
  /** Broker minimum stop distance in price units. Pass 0 when unknown (phase 3 has no broker). */
  minStopDistance: number;
}

/** Stop validation (K17). Reject, never move, when the stop is too close. */
export function validateStop(i: StopCheckInput): { ok: boolean; distance: number; reason: string } {
  const distance = i.direction === "LONG" ? i.entry - i.stop : i.stop - i.entry;
  if (!(distance > 0)) return { ok: false, distance, reason: "STOP_ON_WRONG_SIDE" };
  if (distance < 0.5 * i.atrSignal) return { ok: false, distance, reason: "STOP_BELOW_HALF_ATR" };
  if (distance < i.minStopDistance) return { ok: false, distance, reason: "STOP_BELOW_BROKER_MINIMUM" };
  return { ok: true, distance, reason: "STOP_OK" };
}

/** Stop below (LONG) or above (SHORT) the anchor, buffered by 0.1 x ATR(signal). */
export function structuralStop(direction: Direction, anchor: number, atrSignal: number): number {
  const buffer = 0.1 * atrSignal;
  return direction === "LONG" ? anchor - buffer : anchor + buffer;
}

export interface TrailInput {
  direction: Direction;
  entry: number;
  initialStop: number;
  /** R = |entry - initialStop|. Fixed at entry. */
  r: number;
  /** Last closed bar's close (the activation test runs on closed bars only). */
  closedBarClose: number;
  /** Most recent CONFIRMED swing low (LONG) or swing high (SHORT), or undefined. */
  latestConfirmedSwing?: number;
  currentStop: number;
}

/**
 * Trailing profit (protected 1.0R activation, 0.25R lock). Returns the new stop. The stop
 * only tightens: it never moves against the position, and a swing candidate is used only if it
 * improves the stop. The stop never crosses the entry in the losing direction.
 */
export function trailStop(i: TrailInput): number {
  const { activationR, protectedR } = PROTECTED_STRATEGY.trailing;
  const isLong = i.direction === "LONG";
  const favour = isLong ? i.closedBarClose - i.entry : i.entry - i.closedBarClose;
  let stop = i.currentStop;
  if (favour >= activationR * i.r) {
    const lock = isLong ? i.entry + protectedR * i.r : i.entry - protectedR * i.r;
    if (isLong ? lock > stop : lock < stop) stop = lock;
  }
  if (activationR * i.r <= favour && i.latestConfirmedSwing !== undefined) {
    const candidate = i.latestConfirmedSwing;
    if (isLong ? candidate > stop && candidate < i.closedBarClose : candidate < stop && candidate > i.closedBarClose) stop = candidate;
  }
  return stop;
}

/** TP1 is the 127.2 percent extension, TP2 is 161.8 percent (K17). Partial exit is off by default. */
export function targets(direction: Direction, start: number, end: number): { tp1: number; tp2: number } {
  const sign = direction === "LONG" ? 1 : -1;
  const range = Math.abs(end - start);
  return { tp1: start + sign * 1.272 * range, tp2: start + sign * 1.618 * range };
}
