import { z } from "zod";

export const QuantStatusSchema = z.enum(["PASS", "FAIL", "INSUFFICIENT_EVIDENCE", "DATA_UNAVAILABLE", "REVIEW_REQUIRED"]);
export type QuantStatus = z.infer<typeof QuantStatusSchema>;
export const RegimeLabelSchema = z.enum(["TRENDING", "RANGING", "HIGH_VOL", "LOW_VOL", "UNSTABLE"]);
export type RegimeLabel = z.infer<typeof RegimeLabelSchema>;
export const ChecklistFeatureSchema = z.enum(["REGIME_COMPATIBLE", "STOP_DISTANCE_VALID", "SPREAD_VALID", "CANDLE_DATA_COMPLETE", "SETUP_CONFIRMED"]);
export type ChecklistFeature = z.infer<typeof ChecklistFeatureSchema>;
export interface ChecklistItem { feature: ChecklistFeature; pass: boolean | null; detail: string }
export interface ChecklistResult { status: QuantStatus; items: ChecklistItem[]; passed: number; checked: number; score: number | null }
export const TradeRecordSchema = z.object({
  id: z.string().min(1), instrument: z.string().min(1), mode: z.enum(["DAY", "SWING", "POSITION"]),
  direction: z.enum(["LONG", "SHORT"]), regime: RegimeLabelSchema, session: z.string().min(1),
  structuralFeatures: z.record(z.union([z.string(), z.number(), z.boolean()])),
  openedAt: z.string().datetime({ offset: true }), closedAt: z.string().datetime({ offset: true }),
  netR: z.number().finite().optional(), commissionR: z.number().finite().nonnegative().optional(),
  spreadR: z.number().finite().nonnegative().optional(), slippageR: z.number().finite().nonnegative().optional(), swapR: z.number().finite().optional(),
});
export type TradeRecord = z.infer<typeof TradeRecordSchema>;
export interface ExpectancyOptions { resamples?: number; confidenceLevel?: number; seed?: number }
export interface ExpectancyResult {
  status: QuantStatus; tradeCount: number; expectancyR: number | null;
  confidenceInterval: { lower: number; upper: number } | null; winRate: number | null;
  winRateInterval: { lower: number; upper: number } | null;
  dateRange: { start: string; end: string } | null; instruments: string[];
  dataSource: string; costAssumptions: string;
  evaluation: "IN_SAMPLE" | "OUT_OF_SAMPLE" | "WALK_FORWARD" | "SIMULATED";
}
export interface RegimeCandle { high: number; low: number; close: number; complete?: boolean }
