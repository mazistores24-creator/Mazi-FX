import { describe, expect, it } from "vitest";
import { DEFAULTS, OPERATING_MODES, PROTECTED_STRATEGY, RISK_LIMITS, assertProtectedZone } from "../src";

describe("protected constants are pinned", () => {
  it("fib baseline zone is 50 to 61.8 percent", () => {
    expect(PROTECTED_STRATEGY.fibZone).toEqual({ lower: 0.5, upper: 0.618 });
    expect(() => assertProtectedZone(0.5, 0.618)).not.toThrow();
    expect(() => assertProtectedZone(0.382, 0.618)).toThrow(/protected/);
  });

  it("RSI is period 14 with 10 and 90 levels", () => {
    expect(PROTECTED_STRATEGY.rsi).toEqual({ period: 14, oversold: 10, overbought: 90 });
  });

  it("Ichimoku is 9/26/52/26", () => {
    expect(PROTECTED_STRATEGY.ichimoku).toEqual({ tenkan: 9, kijun: 26, senkouB: 52, displacement: 26 });
  });

  it("trailing profit activates at 1.0R and locks 0.25R", () => {
    expect(PROTECTED_STRATEGY.trailing).toEqual({ activationR: 1.0, protectedR: 0.25 });
  });

  it("M5 is the only mandatory execution confirmation, expiring after 12 bars", () => {
    expect(PROTECTED_STRATEGY.executionConfirmationTimeframe).toBe("M5");
    expect(PROTECTED_STRATEGY.m5ConfirmationExpiryBars).toBe(12);
  });

  it("timeframe hierarchy has eight levels and no M1", () => {
    expect([...PROTECTED_STRATEGY.timeframes]).toEqual(["MN1", "W1", "D1", "H4", "H1", "M30", "M15", "M5"]);
  });

  it("risk per trade is 0.25 percent", () => {
    expect(RISK_LIMITS.riskPerTradePct).toBe(0.25);
  });

  it("drawdown and trade limits match the spec", () => {
    expect(RISK_LIMITS.day).toEqual({ maxDrawdownPct: 2, maxTradesPerDay: 4 });
    expect(RISK_LIMITS.swing).toEqual({ maxDrawdownPct: 3, maxOpenTrades: 1 });
    expect(RISK_LIMITS.position).toEqual({ maxDrawdownPct: 4, maxOpenTrades: 1 });
    expect(RISK_LIMITS.consecutiveLossesToPause).toBe(2);
    expect(RISK_LIMITS.drawdownResetTimeZone).toBe("America/New_York");
  });

  it("default indicator and news parameters match Phase 0 decisions", () => {
    expect(DEFAULTS.atrPeriod).toBe(14);
    expect(DEFAULTS.swingBarsEachSide).toBe(2);
    expect(DEFAULTS.swingBarsEachSideHigherTf).toBe(3);
    expect(DEFAULTS.bosBodyCloseAtrFraction).toBe(0.1);
    expect(DEFAULTS.newsBlackoutMinutesBefore).toBe(30);
    expect(DEFAULTS.newsBlackoutMinutesAfter).toBe(30);
  });

  it("operating modes are exactly the spec set", () => {
    expect([...OPERATING_MODES]).toEqual(["SCAN_ONLY", "ALERT_ONLY", "PAPER", "MANUAL_ASSIST", "AUTOMATED"]);
  });
});
