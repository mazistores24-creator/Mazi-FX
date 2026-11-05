import { RISK_LIMITS } from "@mazzi/core";
import type { RiskMode } from "./types";
import { tradingDateET } from "./drawdown";

export interface CounterStore {
  submit(accountId: string, mode: RiskMode, orderId: string, tradingDate: string): Promise<boolean>;
  release(accountId: string, orderId: string, confirmedNoFill: boolean): Promise<boolean>;
  count(accountId: string, mode: RiskMode, tradingDate: string): Promise<number>;
}
/** A process-local reference implementation. Production must persist/increment in the order transaction. */
export class MemoryCounterStore implements CounterStore {
  private readonly counts = new Map<string, number>();
  private readonly orders = new Map<string, { key: string; released: boolean }>();
  private key(account: string, mode: RiskMode, date: string): string { return `${account}|${mode}|${date}`; }
  async submit(accountId: string, mode: RiskMode, orderId: string, tradingDate: string): Promise<boolean> {
    const key = this.key(accountId, mode, tradingDate);
    if (this.orders.has(orderId)) return false;
    const count = this.counts.get(key) ?? 0;
    const limit = mode === "DAY" ? RISK_LIMITS.day.maxTradesPerDay : 1;
    if (count >= limit) return false;
    this.orders.set(orderId, { key, released: false }); this.counts.set(key, count + 1); return true;
  }
  async release(_accountId: string, orderId: string, confirmedNoFill: boolean): Promise<boolean> {
    const item = this.orders.get(orderId);
    if (!item || item.released || !confirmedNoFill) return false;
    item.released = true; this.counts.set(item.key, Math.max(0, (this.counts.get(item.key) ?? 0) - 1)); return true;
  }
  async count(accountId: string, mode: RiskMode, tradingDate: string): Promise<number> { return this.counts.get(this.key(accountId, mode, tradingDate)) ?? 0; }
}
export class TradeCounters {
  constructor(private readonly store: CounterStore) {}
  submitted(accountId: string, mode: RiskMode, orderId: string, at: Date): Promise<boolean> { return this.store.submit(accountId, mode, orderId, tradingDateET(at)); }
  confirmedRejectOrCancel(accountId: string, orderId: string, confirmedNoFill: boolean): Promise<boolean> { return this.store.release(accountId, orderId, confirmedNoFill); }
  count(accountId: string, mode: RiskMode, at: Date): Promise<number> { return this.store.count(accountId, mode, tradingDateET(at)); }
}
