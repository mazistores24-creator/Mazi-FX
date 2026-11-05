import { z } from "zod";
import type { FeedFreshness, Candle, Timeframe, OperatingMode } from "@mazzi/core";
import type { SetupDecision, SeriesSet } from "@mazzi/strategy";
import type { Decision, DrawdownResult, SizingResult } from "@mazzi/risk";

export const ScannerConfigSchema = z.object({
  intervalMs: z.number().int().min(250).default(5_000),
  staleAfterMs: z.number().int().positive().default(120_000),
  cooldownMs: z.number().int().nonnegative().default(15 * 60_000),
  dedupRetentionMs: z.number().int().positive().default(7 * 24 * 60 * 60_000),
  mode: z.enum(["SCAN_ONLY", "ALERT_ONLY", "PAPER", "MANUAL_ASSIST", "AUTOMATED"]).default("ALERT_ONLY"),
});
export type ScannerConfig = z.infer<typeof ScannerConfigSchema>;

export interface ScanInstrument { id: string; timeframes: readonly Timeframe[] }
export interface FeedSnapshot { status: FeedFreshness; candles: readonly Candle[] }
export interface FeedPort { instruments(): readonly ScanInstrument[]; snapshot(instrument: string, timeframe: Timeframe, nowMs: number): FeedSnapshot }
export interface SetupPort { evaluate(series: SeriesSet, asOf: number): SetupDecision }
export interface Phase5RiskResults {
  risk: Decision;
  compliance: Decision;
  news: Decision;
  emergency: Decision;
  sizing: SizingResult;
  drawdown: DrawdownResult;
}
export interface AlertRiskGates {
  assess(input: { instrument: string; setup: SetupDecision; asOf: string; mode: OperatingMode }): Promise<Phase5RiskResults>;
}
export interface TelegramAlert { id: string; instrument: string; direction: "LONG" | "SHORT"; setupId: string; asOf: string; message: string }
export interface TelegramSender { send(alert: TelegramAlert): Promise<void> }

export interface PersistedScanState {
  version: 1;
  cursor: Record<string, string>;
  delivered: Record<string, number>;
  pending: Record<string, TelegramAlert>;
  lastSentByKey: Record<string, number>;
  failures: number;
  updatedAt: string;
}
export interface ScanStateStore { load(): Promise<PersistedScanState | undefined>; save(state: PersistedScanState): Promise<void> }

export type ScanEvent =
  | { type: "SKIPPED"; instrument: string; reason: string }
  | { type: "NO_SETUP"; instrument: string; reason: string }
  | { type: "VETOED"; instrument: string; setupId: string; reasons: readonly string[] }
  | { type: "DUPLICATE"; instrument: string; setupId: string }
  | { type: "COOLDOWN"; instrument: string; setupId: string; until: string }
  | { type: "DELIVERED"; instrument: string; setupId: string; alertId: string }
  | { type: "ERROR"; instrument?: string; message: string };

export interface ScannerOptions {
  config?: Partial<ScannerConfig>;
  feed: FeedPort;
  setup: SetupPort;
  risk: AlertRiskGates;
  telegram: TelegramSender;
  state: ScanStateStore;
  now?: () => number;
  onEvent?: (event: ScanEvent) => void;
}

export const REQUIRED_TIMEFRAMES: readonly Timeframe[] = Object.freeze(["D1", "H4", "M5"]);
