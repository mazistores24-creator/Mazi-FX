/**
 * PROTECTED CONSTANTS. Changing any value here is a spec change, not a config
 * change. test/protected-constants.test.ts pins every value; a change fails CI
 * until the test and docs/strategy-spec.md are updated together with owner approval.
 */
export const PROTECTED_STRATEGY = Object.freeze({
  /** Fibonacci baseline zone, as fractions of the swing range. */
  fibZone: Object.freeze({ lower: 0.5, upper: 0.618 }),
  /** RSI (Wilder) overbought/oversold levels. */
  rsi: Object.freeze({ period: 14, oversold: 10, overbought: 90 }),
  /** Ichimoku periods: tenkan, kijun, senkou B, displacement. */
  ichimoku: Object.freeze({ tenkan: 9, kijun: 26, senkouB: 52, displacement: 26 }),
  /** Multi-timeframe hierarchy, highest first. M1 is intentionally absent. */
  timeframes: Object.freeze(["MN1", "W1", "D1", "H4", "H1", "M30", "M15", "M5"] as const),
  /** The only mandatory execution confirmation timeframe. */
  executionConfirmationTimeframe: "M5",
  /** Bars after which an unconfirmed M5 setup expires. */
  m5ConfirmationExpiryBars: 12,
  /** Trailing profit: activation and protected lock, in R multiples. */
  trailing: Object.freeze({ activationR: 1.0, protectedR: 0.25 }),
});

export const RISK_LIMITS = Object.freeze({
  riskPerTradePct: 0.25,
  day: Object.freeze({ maxDrawdownPct: 2, maxTradesPerDay: 4 }),
  swing: Object.freeze({ maxDrawdownPct: 3, maxOpenTrades: 1 }),
  position: Object.freeze({ maxDrawdownPct: 4, maxOpenTrades: 1 }),
  consecutiveLossesToPause: 2,
  drawdownResetTimeZone: "America/New_York",
});

export const DEFAULTS = Object.freeze({
  atrPeriod: 14,
  swingBarsEachSide: 2,
  swingBarsEachSideHigherTf: 3,
  bosBodyCloseAtrFraction: 0.1,
  newsBlackoutMinutesBefore: 30,
  newsBlackoutMinutesAfter: 30,
});

/** Operating modes. No execution path is reachable from SCAN_ONLY, ALERT_ONLY, or PAPER. */
export const OPERATING_MODES = ["SCAN_ONLY", "ALERT_ONLY", "PAPER", "MANUAL_ASSIST", "AUTOMATED"] as const;
