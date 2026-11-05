import { PROTECTED_STRATEGY, type Direction } from "@mazzi/core";
import { ichimokuAt } from "./indicators";
import type { Bar } from "./bars";

export interface GateResult {
  pass: boolean;
  reason: string;
}

/**
 * Ichimoku gate (K14). LONG: price above the signal-TF cloud, Tenkan above Kijun, the higher-TF
 * cloud bullish (Senkou A above B) and price not below the higher-TF cloud. Any conflicting
 * higher-TF reading blocks the setup. SHORT mirrors.
 */
export function ichimokuGate(
  signal: readonly Bar[],
  sIdx: number,
  higher: readonly Bar[],
  hIdx: number,
  dir: Direction,
): GateResult {
  const s = ichimokuAt(signal, sIdx);
  const h = ichimokuAt(higher, hIdx);
  if (!s || !h) return { pass: false, reason: "ICHIMOKU_WARMUP" };
  const close = signal[sIdx].c;
  const hClose = higher[hIdx].c;
  if (dir === "LONG") {
    if (!(close > s.cloudTop)) return { pass: false, reason: "SIGNAL_NOT_ABOVE_CLOUD" };
    if (!(s.tenkan > s.kijun)) return { pass: false, reason: "TENKAN_NOT_ABOVE_KIJUN" };
    if (!(h.spanA > h.spanB)) return { pass: false, reason: "HIGHER_CLOUD_CONFLICT" };
    if (hClose < h.cloudBottom) return { pass: false, reason: "HIGHER_PRICE_BELOW_CLOUD" };
  } else {
    if (!(close < s.cloudBottom)) return { pass: false, reason: "SIGNAL_NOT_BELOW_CLOUD" };
    if (!(s.tenkan < s.kijun)) return { pass: false, reason: "TENKAN_NOT_BELOW_KIJUN" };
    if (!(h.spanA < h.spanB)) return { pass: false, reason: "HIGHER_CLOUD_CONFLICT" };
    if (hClose > h.cloudTop) return { pass: false, reason: "HIGHER_PRICE_ABOVE_CLOUD" };
  }
  return { pass: true, reason: "ICHIMOKU_OK" };
}

/**
 * RSI gate (K15). Period 14 Wilder, levels 10 and 90 (protected). LONG: RSI at or below 10
 * at least once in [fromIdx, toIdx], and RSI back above 10 at toIdx. SHORT mirrors at 90.
 */
export function rsiGate(rsi: readonly number[], fromIdx: number, toIdx: number, dir: Direction): GateResult {
  const { oversold, overbought } = PROTECTED_STRATEGY.rsi;
  if (fromIdx < 0 || toIdx >= rsi.length || fromIdx > toIdx) return { pass: false, reason: "RSI_RANGE" };
  const window = rsi.slice(fromIdx, toIdx + 1);
  if (window.some((v) => !Number.isFinite(v))) return { pass: false, reason: "RSI_WARMUP" };
  const now = rsi[toIdx];
  if (dir === "LONG") {
    if (!window.some((v) => v <= oversold)) return { pass: false, reason: "RSI_NO_OVERSOLD_TOUCH" };
    if (!(now > oversold)) return { pass: false, reason: "RSI_NOT_BACK_ABOVE_10" };
  } else {
    if (!window.some((v) => v >= overbought)) return { pass: false, reason: "RSI_NO_OVERBOUGHT_TOUCH" };
    if (!(now < overbought)) return { pass: false, reason: "RSI_NOT_BACK_BELOW_90" };
  }
  return { pass: true, reason: "RSI_OK" };
}
