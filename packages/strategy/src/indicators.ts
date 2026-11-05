import { PROTECTED_STRATEGY } from "@mazzi/core";
import type { Bar } from "./bars";

/**
 * Indicators are causal: the value at index i uses only bars[0..i]. Values before the
 * warm-up are NaN. Nothing here reads a later bar, which the replay harness verifies.
 */

/** Wilder ATR. The first value is the simple mean of the first `period` true ranges. */
export function atrSeries(bars: readonly Bar[], period: number): number[] {
  const out = new Array<number>(bars.length).fill(Number.NaN);
  if (period < 1 || bars.length <= period) return out;
  const tr = (i: number): number => {
    const b = bars[i];
    if (i === 0) return b.h - b.l;
    const pc = bars[i - 1].c;
    return Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc));
  };
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr(i);
  let atr = sum / period;
  out[period] = atr;
  for (let i = period + 1; i < bars.length; i++) {
    atr = (atr * (period - 1) + tr(i)) / period;
    out[i] = atr;
  }
  return out;
}

function rsiValue(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/** Wilder RSI on closing prices. A flat run returns 50. */
export function rsiSeries(bars: readonly Bar[], period: number): number[] {
  const out = new Array<number>(bars.length).fill(Number.NaN);
  if (period < 1 || bars.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = bars[i].c - bars[i - 1].c;
    if (d > 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = rsiValue(avgGain, avgLoss);
  for (let i = period + 1; i < bars.length; i++) {
    const d = bars[i].c - bars[i - 1].c;
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = rsiValue(avgGain, avgLoss);
  }
  return out;
}

/** Donchian midpoint: (highest high + lowest low) / 2 over `period` bars ending at `end`. */
export function midpoint(bars: readonly Bar[], end: number, period: number): number | undefined {
  const start = end - period + 1;
  if (start < 0 || end >= bars.length) return undefined;
  let hi = Number.NEGATIVE_INFINITY;
  let lo = Number.POSITIVE_INFINITY;
  for (let i = start; i <= end; i++) {
    if (bars[i].h > hi) hi = bars[i].h;
    if (bars[i].l < lo) lo = bars[i].l;
  }
  return (hi + lo) / 2;
}

export interface IchimokuPoint {
  tenkan: number;
  kijun: number;
  /** Cloud edges plotted at bar t. They were computed from bar t minus displacement. */
  spanA: number;
  spanB: number;
  cloudTop: number;
  cloudBottom: number;
}

/**
 * Ichimoku at bar t. Tenkan and Kijun are read at t. The cloud plotted at t is built from
 * the bar at t - displacement, so no value uses a bar after t.
 */
export function ichimokuAt(
  bars: readonly Bar[],
  t: number,
  p: { tenkan: number; kijun: number; senkouB: number; displacement: number } = PROTECTED_STRATEGY.ichimoku,
): IchimokuPoint | undefined {
  const tenkan = midpoint(bars, t, p.tenkan);
  const kijun = midpoint(bars, t, p.kijun);
  const s = t - p.displacement;
  if (s < 0 || tenkan === undefined || kijun === undefined) return undefined;
  const sTenkan = midpoint(bars, s, p.tenkan);
  const sKijun = midpoint(bars, s, p.kijun);
  const sSenkouB = midpoint(bars, s, p.senkouB);
  if (sTenkan === undefined || sKijun === undefined || sSenkouB === undefined) return undefined;
  const spanA = (sTenkan + sKijun) / 2;
  const spanB = sSenkouB;
  return {
    tenkan,
    kijun,
    spanA,
    spanB,
    cloudTop: Math.max(spanA, spanB),
    cloudBottom: Math.min(spanA, spanB),
  };
}
