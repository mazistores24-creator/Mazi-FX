import type { Decimal } from "./domain";

export type InstrumentCategory = "FOREX" | "METAL" | "COMMODITY" | "INDEX" | "SYNTHETIC" | "CRYPTO" | "OTHER";

/**
 * Provider-independent instrument model. Built from provider discovery.
 * Null means the provider did not supply the value. A null is never replaced
 * with a guess.
 */
export interface InstrumentDefinition {
  /** Platform identifier, stable across providers, e.g. SYN_RNG_VOL_100. */
  canonicalId: string;
  providerId: string;
  brokerSymbol: string;
  displayName: string;
  category: InstrumentCategory;
  /** Provider family grouping, e.g. VOLATILITY, BOOM_CRASH, JUMP, STEP. Null when unknown. */
  family: string | null;
  /** Minimum price increment, from the provider pip size. */
  tickSize: Decimal | null;
  /** Number of decimals in a price quote, derived from pip size. */
  pipDecimals: number | null;
  /** Monetary value of one tick per unit of stake. Not supplied by discovery. */
  tickValue: Decimal | null;
  minStake: Decimal | null;
  maxStake: Decimal | null;
  tradingAvailable: boolean;
  /** Human-readable reason when tradingAvailable is false, e.g. "market closed". */
  tradingUnavailableReason: string | null;
}
