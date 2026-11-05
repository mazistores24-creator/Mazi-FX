import { RISK_LIMITS } from "@mazzi/core";
import type { DrawdownResult, EquitySnapshot, RiskMode } from "./types";

const MODE_LIMIT: Record<RiskMode, number> = {
  DAY: RISK_LIMITS.day.maxDrawdownPct,
  SWING: RISK_LIMITS.swing.maxDrawdownPct,
  POSITION: RISK_LIMITS.position.maxDrawdownPct,
};
function one(snapshot: EquitySnapshot, limitPct: number): DrawdownResult {
  if (!Number.isFinite(snapshot.referenceEquity) || snapshot.referenceEquity <= 0 || !Number.isFinite(snapshot.currentEquity) || !Number.isFinite(snapshot.additionalCosts ?? 0)) {
    return { status: "VETO", reasons: ["INVALID_EQUITY_SNAPSHOT"], drawdownAmount: 0, drawdownPct: 0, limitPct };
  }
  const adjusted = snapshot.currentEquity - (snapshot.additionalCosts ?? 0);
  const amount = Math.max(0, snapshot.referenceEquity - adjusted);
  const pct = amount / snapshot.referenceEquity * 100;
  return { status: pct >= limitPct ? "VETO" : "APPROVED", ...(pct >= limitPct ? { reasons: ["DRAWDOWN_LIMIT_REACHED"] } : {}), drawdownAmount: amount, drawdownPct: pct, limitPct } as DrawdownResult;
}
/** Caller supplies reset-period equity adjusted to exclude deposits and withdrawals. */
export function checkDrawdown(mode: RiskMode, snapshot: EquitySnapshot, accountLimitPct: number = RISK_LIMITS.position.maxDrawdownPct): DrawdownResult {
  const modeResult = one(snapshot, MODE_LIMIT[mode]);
  const accountResult = one(snapshot, accountLimitPct);
  const limitPct = Math.min(modeResult.limitPct, accountLimitPct);
  const hit = modeResult.status === "VETO" || accountResult.status === "VETO";
  const reasons = [
    ...(modeResult.status === "VETO" ? modeResult.reasons : []),
    ...(accountResult.status === "VETO" ? accountResult.reasons : []),
  ];
  return { status: hit ? "VETO" : "APPROVED", ...(hit ? { reasons } : {}), drawdownAmount: modeResult.drawdownAmount, drawdownPct: modeResult.drawdownPct, limitPct } as DrawdownResult;
}

/** Returns the ISO calendar date in the pinned New York reset timezone. */
export function tradingDateET(instant: Date): string {
  if (!Number.isFinite(instant.getTime())) throw new Error("INVALID_DATE");
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: RISK_LIMITS.drawdownResetTimeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
