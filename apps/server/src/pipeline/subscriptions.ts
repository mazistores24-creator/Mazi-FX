import type { CandleUpdate, Timeframe } from "@mazzi/core";
import { SUPPORTED_TIMEFRAMES } from "@mazzi/core";

export type Unsub = () => void;

/** Bounded concurrency gate. Extra work waits in FIFO order. */
export class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError("limit must be a positive integer");
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }

  get inFlight(): number {
    return this.active;
  }
}

/** Token bucket. take() returns false when the call must wait; the caller decides what to do. */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
    private readonly now: () => number = () => Date.now(),
  ) {
    if (capacity < 1 || refillPerSec <= 0) throw new RangeError("invalid rate limit");
    this.tokens = capacity;
    this.last = now();
  }

  take(): boolean {
    const t = this.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((t - this.last) / 1000) * this.refillPerSec);
    this.last = t;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
}

export interface SubscriptionKey {
  kind: "tick" | "candle";
  instrument: string;
  timeframe?: Timeframe;
}

export function subscriptionId(k: SubscriptionKey): string {
  if (k.kind === "tick") return `tick|${k.instrument}`;
  if (!k.timeframe || !SUPPORTED_TIMEFRAMES.includes(k.timeframe)) {
    throw new Error("candle subscriptions need a supported timeframe");
  }
  return `candle|${k.instrument}|${k.timeframe}`;
}

export interface UpstreamFeed {
  subscribeTicks(instrument: string, listener: (e: { epochMs: number; quote: string }) => void): Unsub;
  subscribeCandles(instrument: string, timeframe: Timeframe, listener: (e: CandleUpdate) => void): Unsub;
}

export interface SubscriptionManagerOptions {
  /** Max simultaneous upstream subscriptions. */
  maxSubscriptions: number;
  /** Max new subscription requests started per second. */
  maxSubscribesPerSec: number;
  /** Max queued subscribe requests waiting for a token. Beyond this, requests are refused. */
  maxPending: number;
  now?: () => number;
}

interface Entry {
  key: SubscriptionKey;
  refs: number;
  unsub?: Unsub;
}

/**
 * Owns all upstream subscriptions for one provider. Duplicate requests share one
 * upstream subscription (ref counted). New upstream subscriptions are rate limited,
 * and refused when the queue is full (backpressure), so the caller can see the refusal
 * instead of silently losing data. Nothing here sends orders.
 */
export class SubscriptionManager {
  private readonly entries = new Map<string, Entry>();
  private readonly bucket: TokenBucket;
  private readonly pendingStarts: Array<() => void> = [];
  private refusals = 0;
  private draining = false;

  constructor(
    private readonly upstream: UpstreamFeed,
    private readonly onTick: (instrument: string, epochMs: number, quote: string) => void,
    private readonly onCandle: (u: CandleUpdate) => void,
    private readonly opts: SubscriptionManagerOptions,
  ) {
    this.bucket = new TokenBucket(opts.maxSubscribesPerSec, opts.maxSubscribesPerSec, opts.now);
  }

  get size(): number {
    return this.entries.size;
  }

  get refused(): number {
    return this.refusals;
  }

  /** Returns an unsubscribe for this caller. Refused requests return undefined. */
  subscribe(key: SubscriptionKey): Unsub | undefined {
    const id = subscriptionId(key);
    const existing = this.entries.get(id);
    if (existing) {
      existing.refs++;
      return this.releaser(id);
    }
    if (this.entries.size >= this.opts.maxSubscriptions) {
      this.refusals++;
      return undefined;
    }
    const entry: Entry = { key, refs: 1 };
    this.entries.set(id, entry);
    this.startOrQueue(id, entry);
    return this.releaser(id);
  }

  private startOrQueue(id: string, entry: Entry): void {
    const start = (): void => {
      if (this.entries.get(id) !== entry) return;
      entry.unsub =
        entry.key.kind === "tick"
          ? this.upstream.subscribeTicks(entry.key.instrument, (e) =>
              this.onTick(entry.key.instrument, e.epochMs, e.quote),
            )
          : this.upstream.subscribeCandles(entry.key.instrument, entry.key.timeframe as Timeframe, (u) => this.onCandle(u));
    };
    if (this.bucket.take()) {
      start();
      return;
    }
    if (this.pendingStarts.length >= this.opts.maxPending) {
      this.entries.delete(id);
      this.refusals++;
      return;
    }
    this.pendingStarts.push(start);
    this.scheduleDrain();
  }

  private scheduleDrain(): void {
    if (this.draining) return;
    this.draining = true;
    const tick = (): void => {
      while (this.pendingStarts.length > 0 && this.bucket.take()) {
        const next = this.pendingStarts.shift() as () => void;
        next();
      }
      if (this.pendingStarts.length > 0) setTimeout(tick, 250);
      else this.draining = false;
    };
    setTimeout(tick, 250);
  }

  private releaser(id: string): Unsub {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const entry = this.entries.get(id);
      if (!entry) return;
      entry.refs--;
      if (entry.refs === 0) {
        this.entries.delete(id);
        entry.unsub?.();
      }
    };
  }

  /** Tears down every upstream subscription, for shutdown. */
  closeAll(): void {
    for (const entry of this.entries.values()) entry.unsub?.();
    this.entries.clear();
    this.pendingStarts.length = 0;
  }

  /** Ids currently held. Used by health reporting. */
  activeIds(): string[] {
    return [...this.entries.keys()];
  }
}
