/**
 * Strategy interfaces only. Phase 1 defines the contracts; real logic (structure,
 * Fibonacci, RSI, Ichimoku, M5 confirmation) is implemented in Phase 3.
 */
import type { Candle, Direction, SwingPoint, Timeframe, SetupState } from "@mazzi/core";

export interface SwingDetector {
  detect(candles: readonly Candle[], barsEachSide: number): SwingPoint[];
}

export interface StructureAnalyzer {
  readonly timeframe: Timeframe;
  classify(swings: readonly SwingPoint[]): "HH_HL" | "LH_LL" | "MIXED" | "INSUFFICIENT";
}

export interface SetupTransitionInput {
  currentState: SetupState;
  barsSinceArmed: number;
  m5Confirmed: boolean;
}

export interface SetupEvaluator {
  next(input: SetupTransitionInput): { state: SetupState; reason: string };
}

export interface StrategyContext {
  readonly direction: Direction;
  readonly accountId: string;
}

export * from "./bars";
export * from "./indicators";
export * from "./swings";
export * from "./structure";
export * from "./fib";
export * from "./supply-demand";
export * from "./gates";
export * from "./m5";
export * from "./lifecycle";
export * from "./risk-plan";
export * from "./engine";
