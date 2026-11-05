import {
  aggregateFromSeries,
  bucketStartMs,
  parseIsoUtc,
  toIsoUtc,
  type Candle,
  type CandleUpdate,
  type HistoricalDataProvider,
  type InstrumentDefinition,
  type InstrumentSpecProvider,
  type MarketDataProvider,
  type ProviderConnectionStatus,
  type TickEvent,
  type Timeframe,
  type Unsubscribe,
} from "@mazzi/core";
import type { DerivConnection, Logger } from "./connection";
import { normalizeActiveSymbols, type DerivActiveSymbol } from "./instruments";

/**
 * Deriv native granularities in seconds. W1 and MN1 are not native and are built from
 * D1 history. M1 is not listed and is never requested.
 */
export const DERIV_GRANULARITY: Readonly<Partial<Record<Timeframe, number>>> = {
  M5: 300,
  M15: 900,
  M30: 1800,
  H1: 3600,
  H4: 14400,
  D1: 86400,
};

export const MAX_HISTORY_COUNT = 5000;

export function granularityFor(tf: Timeframe): number {
  const g = DERIV_GRANULARITY[tf];
  if (g === undefined) {
    throw new Error(`${tf} is not a native Deriv granularity; it is built from D1 history by the candle service`);
  }
  return g;
}

function timeframeForGranularity(g: number): Timeframe | undefined {
  for (const [tf, sec] of Object.entries(DERIV_GRANULARITY)) {
    if (sec === g) return tf as Timeframe;
  }
  return undefined;
}

function candleKey(instrument: string, tf: Timeframe): string {
  return `candle|${instrument}|${tf}`;
}

interface CandleSubState {
  listeners: Set<(e: CandleUpdate) => void>;
  lastOpenSec?: number;
  last?: Candle;
}

interface Pending {
  resolve: (msg: Record<string, unknown>) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface DerivMarketDataOptions {
  requestTimeoutMs?: number;
}

/**
 * Deriv market-data adapter (DEMO). Implements MarketDataProvider (ticks and candles),
 * HistoricalDataProvider (ticks_history) and InstrumentSpecProvider (active_symbols).
 * It has no order methods.
 *
 * Subscriptions are deduplicated per key: the upstream request is sent once and the
 * subscription is forgotten when the last listener leaves. After a reconnect all
 * live subscriptions are sent again.
 */
export class DerivMarketData implements MarketDataProvider, HistoricalDataProvider, InstrumentSpecProvider {
  readonly providerId = "DERIV";
  readonly environment = "DEMO" as const;

  private readonly tickSubs = new Map<string, Set<(e: TickEvent) => void>>();
  private readonly candleSubs = new Map<string, CandleSubState>();
  /** Subscribe payloads by key. Used for resubscribe after reconnect. */
  private readonly specs = new Map<string, Record<string, unknown>>();
  /** Deriv subscription ids by key, from subscription acknowledgements. */
  private readonly subIds = new Map<string, string>();
  private readonly pending = new Map<number, Pending>();
  private nextReq = 1;
  private readonly timeoutMs: number;

  constructor(
    private readonly conn: DerivConnection,
    private readonly log: Logger,
    opts: DerivMarketDataOptions = {},
  ) {
    this.timeoutMs = opts.requestTimeoutMs ?? 15_000;
    conn.onMessage((m) => this.handle(m));
    conn.onReconnected(() => this.resubscribeAll());
  }

  connect(): Promise<void> {
    return this.conn.connect();
  }

  async disconnect(): Promise<void> {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error("deriv connection stopped"));
      this.pending.delete(id);
    }
    await this.conn.disconnect();
  }

  getStatus(): ProviderConnectionStatus {
    return this.conn.getStatus();
  }

  onConnectionChange(listener: (status: ProviderConnectionStatus) => void): Unsubscribe {
    return this.conn.onStatus(listener);
  }

  subscribeTicks(instrument: string, listener: (event: TickEvent) => void): Unsubscribe {
    const key = `tick|${instrument}`;
    let set = this.tickSubs.get(instrument);
    if (!set) {
      set = new Set();
      this.tickSubs.set(instrument, set);
      this.sendSubscription(key, { ticks: instrument });
    }
    set.add(listener);
    return () => {
      const current = this.tickSubs.get(instrument);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) {
        this.tickSubs.delete(instrument);
        this.forget(key);
      }
    };
  }

  subscribeCandles(instrument: string, timeframe: Timeframe, listener: (event: CandleUpdate) => void): Unsubscribe {
    const granularity = granularityFor(timeframe);
    const key = candleKey(instrument, timeframe);
    let state = this.candleSubs.get(key);
    if (!state) {
      state = { listeners: new Set() };
      this.candleSubs.set(key, state);
      this.sendSubscription(key, {
        ticks_history: instrument,
        style: "candles",
        granularity,
        end: "latest",
        count: 1,
        subscribe: 1,
      });
    }
    state.listeners.add(listener);
    return () => {
      const current = this.candleSubs.get(key);
      if (!current) return;
      current.listeners.delete(listener);
      if (current.listeners.size === 0) {
        this.candleSubs.delete(key);
        this.forget(key);
      }
    };
  }

  async listInstruments(): Promise<InstrumentDefinition[]> {
    const resp = await this.request({ active_symbols: "full", product_type: "basic" });
    const list = resp.active_symbols;
    if (!Array.isArray(list)) throw new Error("deriv active_symbols response malformed");
    return normalizeActiveSymbols(list as DerivActiveSymbol[], this.providerId);
  }

  async getInstrument(brokerSymbol: string): Promise<InstrumentDefinition | undefined> {
    const all = await this.listInstruments();
    return all.find((d) => d.brokerSymbol === brokerSymbol);
  }

  /**
   * Finished bars for warm-up. The last returned bar is marked complete = false because
   * Deriv includes the forming bar. W1 and MN1 are built from D1 history.
   */
  async getHistoricalCandles(instrument: string, timeframe: Timeframe, count: number): Promise<Candle[]> {
    if (!Number.isInteger(count) || count < 1 || count > MAX_HISTORY_COUNT) {
      throw new RangeError(`count must be an integer between 1 and ${MAX_HISTORY_COUNT}`);
    }
    if (timeframe === "W1" || timeframe === "MN1") {
      const perBar = timeframe === "W1" ? 7 : 31;
      const need = Math.min(MAX_HISTORY_COUNT, count * perBar + perBar);
      const d1 = await this.fetchNative(instrument, "D1", need);
      const agg = aggregateFromSeries(d1, timeframe);
      // The first bucket can start before the history does. Drop it, since it is partial.
      if (agg.length > 0 && d1.length > 0 && parseIsoUtc(agg[0].time) < parseIsoUtc(d1[0].time)) agg.shift();
      return agg.slice(-count);
    }
    return this.fetchNative(instrument, timeframe, count);
  }

  private async fetchNative(instrument: string, tf: Timeframe, count: number): Promise<Candle[]> {
    const granularity = granularityFor(tf);
    const resp = await this.request({
      ticks_history: instrument,
      style: "candles",
      granularity,
      end: "latest",
      count,
    });
    const rows = resp.candles;
    if (!Array.isArray(rows)) throw new Error("deriv candles response malformed");
    const candles: Candle[] = rows.map((r: { epoch: unknown; open: unknown; high: unknown; low: unknown; close: unknown }) => {
      const epoch = Number(r.epoch);
      if (!Number.isFinite(epoch)) throw new Error("deriv candle epoch malformed");
      return {
        time: toIsoUtc(epoch * 1000),
        open: String(r.open),
        high: String(r.high),
        low: String(r.low),
        close: String(r.close),
        timeframe: tf,
        instrument,
        complete: true,
      };
    });
    candles.sort((a, b) => parseIsoUtc(a.time) - parseIsoUtc(b.time));
    if (candles.length > 0) candles[candles.length - 1] = { ...candles[candles.length - 1], complete: false };
    return candles;
  }

  private sendSubscription(key: string, payload: Record<string, unknown>): void {
    this.specs.set(key, payload);
    if (!this.conn.send(payload)) {
      this.log.warn("deriv subscription queued for resend on reconnect", { key: key.split("|")[0] });
    }
  }

  private forget(key: string): void {
    this.specs.delete(key);
    const id = this.subIds.get(key);
    this.subIds.delete(key);
    if (id) this.conn.send({ forget: id });
  }

  private resubscribeAll(): void {
    this.subIds.clear();
    this.log.info("deriv resubscribing", { count: this.specs.size });
    for (const payload of this.specs.values()) this.conn.send(payload);
  }

  private request(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = this.nextReq++;
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("deriv request timed out"));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      if (!this.conn.send({ ...payload, req_id: id })) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error("deriv not connected"));
      }
    });
  }

  private handle(msg: Record<string, unknown>): void {
    const reqId = msg.req_id;
    if (msg.error) {
      const err = msg.error as { code?: unknown; message?: unknown };
      const text = `deriv ${String(err.code ?? "error")}: ${String(err.message ?? "")}`;
      if (typeof reqId === "number" && this.pending.has(reqId)) {
        const p = this.pending.get(reqId) as Pending;
        clearTimeout(p.timer);
        this.pending.delete(reqId);
        p.reject(new Error(text));
        return;
      }
      const echoKey = keyFromEcho(msg.echo_req);
      if (echoKey) this.specs.delete(echoKey);
      this.log.warn("deriv error response", { code: String(err.code ?? "error") });
      return;
    }
    if (typeof reqId === "number" && this.pending.has(reqId)) {
      const p = this.pending.get(reqId) as Pending;
      clearTimeout(p.timer);
      this.pending.delete(reqId);
      p.resolve(msg);
      return;
    }
    if (msg.subscription && msg.echo_req) this.recordSubscription(msg);

    switch (msg.msg_type) {
      case "tick": {
        const t = msg.tick as { symbol?: unknown; epoch?: unknown; quote?: unknown } | undefined;
        if (!t || typeof t.symbol !== "string") return;
        const set = this.tickSubs.get(t.symbol);
        if (!set) return;
        const epoch = Number(t.epoch);
        if (!Number.isFinite(epoch)) return;
        const ev: TickEvent = { kind: "tick", instrument: t.symbol, epochMs: epoch * 1000, quote: String(t.quote) };
        for (const l of set) l(ev);
        return;
      }
      case "ohlc":
        this.handleOhlc(msg.ohlc as Record<string, unknown> | undefined);
        return;
      default:
        return;
    }
  }

  private recordSubscription(msg: Record<string, unknown>): void {
    const key = keyFromEcho(msg.echo_req);
    const sub = msg.subscription as { id?: unknown } | undefined;
    if (!key || !sub || typeof sub.id !== "string") return;
    if (!this.specs.has(key)) {
      // Acknowledged after the caller already left. Forget upstream so nothing leaks.
      this.conn.send({ forget: sub.id });
      return;
    }
    this.subIds.set(key, sub.id);
  }

  private handleOhlc(o: Record<string, unknown> | undefined): void {
    if (!o || typeof o.symbol !== "string") return;
    const tf = timeframeForGranularity(Number(o.granularity));
    if (!tf) return;
    const state = this.candleSubs.get(candleKey(o.symbol, tf));
    if (!state) return;
    const openSec = Number(o.open_time);
    if (!Number.isFinite(openSec)) return;
    if (state.lastOpenSec !== undefined) {
      if (openSec < state.lastOpenSec) return;
      if (openSec > state.lastOpenSec && state.last) {
        const closed: Candle = { ...state.last, complete: true };
        for (const l of state.listeners) l({ kind: "candle", candle: closed, complete: true });
      }
    }
    const bar: Candle = {
      time: toIsoUtc(openSec * 1000),
      open: String(o.open),
      high: String(o.high),
      low: String(o.low),
      close: String(o.close),
      timeframe: tf,
      instrument: o.symbol,
      complete: false,
    };
    state.lastOpenSec = openSec;
    state.last = bar;
    for (const l of state.listeners) l({ kind: "candle", candle: bar, complete: false });
  }
}

function keyFromEcho(echo: unknown): string | undefined {
  if (!echo || typeof echo !== "object") return undefined;
  const e = echo as Record<string, unknown>;
  if (typeof e.ticks === "string") return `tick|${e.ticks}`;
  if (typeof e.ticks_history === "string" && typeof e.granularity === "number") {
    const tf = timeframeForGranularity(e.granularity);
    if (tf) return candleKey(e.ticks_history, tf);
  }
  return undefined;
}

// Re-exported so callers can align bars without importing core helpers directly.
export { bucketStartMs };
