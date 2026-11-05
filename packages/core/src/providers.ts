import type { Candle, Decimal, Timeframe } from "./domain";
import type { InstrumentDefinition } from "./instruments";

/**
 * Provider port contracts (spec Part 5 and the Deriv section of Part 5).
 * Each provider implements only the ports it can serve. Every port is documented
 * with what it supports and what it does not. Phase 2 implements the market-data,
 * instrument and historical ports for Deriv DEMO. The account and execution ports
 * are declared so the boundary is explicit, and nothing implements them yet.
 */

export type ProviderConnectionStatus = "IDLE" | "CONNECTING" | "CONNECTED" | "RECONNECTING" | "STOPPED";

export type Unsubscribe = () => void;

/** A single quote. epochMs is the exchange timestamp, normalised to UTC milliseconds. */
export interface TickEvent {
  kind: "tick";
  instrument: string;
  epochMs: number;
  quote: Decimal;
}

/**
 * A bar update. complete = true only once the provider has moved on to a later bar.
 * An update for the forming bar is complete = false.
 */
export interface CandleUpdate {
  kind: "candle";
  candle: Candle;
  complete: boolean;
}

export type MarketEvent = TickEvent | CandleUpdate;

/**
 * MarketDataProvider: live ticks and live bars.
 * Supports: tick subscriptions, native bar subscriptions (M5 M15 M30 H1 H4 D1 on Deriv),
 * connection-state notifications, automatic resubscribe after reconnect (Deriv).
 * Limitations: no order-book or depth data. W1 and MN1 are not native on Deriv, so
 * they are built from D1 by the candle service. The adapter never requests M1.
 * Subscribing twice with the same key returns a single upstream subscription.
 */
export interface MarketDataProvider {
  readonly providerId: string;
  readonly environment: "DEMO" | "LIVE";
  connect(options?: { timeoutMs?: number }): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): ProviderConnectionStatus;
  onConnectionChange(listener: (status: ProviderConnectionStatus) => void): Unsubscribe;
  subscribeTicks(instrument: string, listener: (event: TickEvent) => void): Unsubscribe;
  subscribeCandles(instrument: string, timeframe: Timeframe, listener: (event: CandleUpdate) => void): Unsubscribe;
}

/**
 * InstrumentSpecProvider: discovery and normalisation of instruments.
 * Supports: active symbol discovery, canonical identifiers, pip-derived tick size,
 * trading availability and suspension status.
 * Limitations: tick value, min and max stake are NOT supplied by discovery on Deriv.
 * They are null until the execution phase sources them from contract proposals.
 */
export interface InstrumentSpecProvider {
  listInstruments(): Promise<InstrumentDefinition[]>;
  getInstrument(brokerSymbol: string): Promise<InstrumentDefinition | undefined>;
}

/**
 * HistoricalDataProvider: finished bars for warm-up and backfill.
 * Supports: count-based fetch for native timeframes (Deriv ticks_history, max 5000 per call).
 * Limitations: W1 and MN1 are derived from D1 history. The last bar may be incomplete.
 * No date-range pagination in Phase 2.
 */
export interface HistoricalDataProvider {
  getHistoricalCandles(instrument: string, timeframe: Timeframe, count: number): Promise<Candle[]>;
}

/**
 * AccountProvider: account identity, balance and permissions.
 * NOT IMPLEMENTED in Phase 2. Declared so the boundary exists before any broker link.
 */
export interface AccountSummary {
  providerAccountId: string;
  currency: string;
  environment: "DEMO" | "LIVE";
}

export interface AccountProvider {
  readonly providerId: string;
  listAccounts(): Promise<AccountSummary[]>;
}

/** Stable order submission/reconciliation contract, independent of broker SDKs. */
export type ExecutionOrderStatus = "PENDING" | "FILLED" | "REJECTED";
export interface ExecutionOrderRequest {
  clientOrderId: string;
  setupId: string;
  instrument: string;
  direction: "LONG" | "SHORT";
  proposalId: string;
  maxPrice: number;
  createdAt: string;
}
export interface ExecutionOrderReceipt {
  clientOrderId: string;
  status: ExecutionOrderStatus;
  brokerContractId: string | null;
  rejectionReason: string | null;
  updatedAt: string;
}

/** Broker execution is isolated from scan, alert and paper code paths. */
export interface BrokerExecutionProvider {
  readonly providerId: string;
  readonly environment: "DEMO" | "LIVE";
  submitOrder(request: ExecutionOrderRequest): Promise<ExecutionOrderReceipt>;
  reconcilePending(): Promise<readonly ExecutionOrderReceipt[]>;
}
