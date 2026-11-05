import { RISK_LIMITS } from "@mazzi/core";
import { tradingDateET } from "./drawdown";
import type { RiskMode } from "./types";

export interface ClosedTradeOutcome { mode: RiskMode; closedAt: string; realizedNetPnl: number }
export interface PauseState { paused: boolean; resumeAtET: string | null; consecutiveLosses: number }
/** Evaluate newest closed outcomes in one mode. Costs are expected included in realizedNetPnl. */
export function evaluateLossPause(mode: RiskMode, outcomes: readonly ClosedTradeOutcome[], now: Date): PauseState {
  const sorted = outcomes.filter((trade) => trade.mode === mode && Number.isFinite(trade.realizedNetPnl))
    .filter((trade) => Number.isFinite(Date.parse(trade.closedAt)) && Date.parse(trade.closedAt) <= now.getTime())
    .sort((a, b) => Date.parse(b.closedAt) - Date.parse(a.closedAt));
  let losses = 0;
  for (const trade of sorted) { if (trade.realizedNetPnl >= 0) break; losses += 1; }
  const todayET = tradingDateET(now);
  const paused = losses >= RISK_LIMITS.consecutiveLossesToPause && sorted.some((trade) => tradingDateET(new Date(trade.closedAt)) === todayET);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: RISK_LIMITS.drawdownResetTimeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
  const localDate = `${get("year")}-${get("month")}-${get("day")}`;
  const tomorrow = new Date(`${localDate}T00:00:00.000Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const resumeAtET = tomorrow.toISOString().slice(0, 10);
  return { paused, resumeAtET: paused ? resumeAtET : null, consecutiveLosses: losses };
}
