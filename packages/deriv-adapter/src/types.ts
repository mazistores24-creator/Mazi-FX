/**
 * Re-exports of the provider ports. The contracts live in @mazzi/core so every
 * adapter implements the same interfaces. ExecutionProvider is kept for the
 * Phase 1 static checks and is an alias of the (method-free) execution port.
 */
export type {
  MarketDataProvider,
  BrokerExecutionProvider as ExecutionProvider,
  ProviderConnectionStatus,
} from "@mazzi/core";
