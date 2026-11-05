import type { InstrumentDefinition } from "@mazzi/core";
import { z } from "zod";

export const RiskModeSchema = z.enum(["DAY", "SWING", "POSITION"]);
export type RiskMode = z.infer<typeof RiskModeSchema>;
export type Decision = { status: "APPROVED" } | { status: "VETO"; reasons: string[] };
export interface SizingInput {
  equity: number;
  entry: number;
  stop: number;
  /** Currency conversion from instrument P&L currency to account currency. */
  accountCurrencyRate: number | null;
  instrument: InstrumentDefinition;
  /** Provider supplied sizing rules not present in every Phase 2 discovery record. */
  volumeRules: { step: number; minimum: number; maximum: number };
}
export interface SizingResult {
  status: "APPROVED" | "VETO";
  reason: string;
  riskBudget: number;
  volume: number | null;
  plannedRisk: number | null;
}
export interface EquitySnapshot {
  /** Reference equity at the start of the ET reset period, after external cash-flow adjustment. */
  referenceEquity: number;
  /** Current equity including unrealized P&L and commissions/swaps. */
  currentEquity: number;
  /** Losses from commissions and swaps during this period, if currentEquity excludes them. */
  additionalCosts?: number;
}
export type DrawdownResult = Decision & {
  drawdownAmount: number;
  drawdownPct: number;
  limitPct: number;
};
export interface TradeCounterState { tradingDate: string; submitted: number; releasedOrderIds: string[] }
export interface Reservation { id: string; accountId: string; mode: RiskMode; amount: number; state: "RESERVED" | "CONVERTED" | "RELEASED" }
export interface ComplianceProfile {
  id: string; accountType: string; version: string; sourceUrl: string;
  verifiedAt: string | null; verifier: string | null; status: "UNVERIFIED" | "VERIFIED" | "RETIRED";
}
