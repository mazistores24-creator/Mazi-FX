/**
 * Per-instrument feed freshness. Pure logic with an injected clock, so it is
 * deterministic in tests. A feed that has never ticked is NO_DATA, not FRESH.
 */
export type FeedState = "FRESH" | "STALE" | "NO_DATA";

export interface FeedFreshness {
  instrument: string;
  state: FeedState;
  lastTickAt: string | null;
  ageMs: number | null;
}

export class StalenessMonitor {
  private readonly lastTick = new Map<string, number | undefined>();

  constructor(
    private readonly staleAfterMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {
    if (!Number.isFinite(staleAfterMs) || staleAfterMs <= 0) {
      throw new RangeError("staleAfterMs must be a positive number");
    }
  }

  register(instrument: string): void {
    if (!this.lastTick.has(instrument)) this.lastTick.set(instrument, undefined);
  }

  unregister(instrument: string): void {
    this.lastTick.delete(instrument);
  }

  recordTick(instrument: string, epochMs?: number): void {
    if (!this.lastTick.has(instrument)) return;
    const at = epochMs ?? this.now();
    const prev = this.lastTick.get(instrument);
    // Keep the newest timestamp. An out-of-order tick does not make a feed look fresher.
    if (prev === undefined || at > prev) this.lastTick.set(instrument, at);
  }

  status(instrument: string): FeedFreshness | undefined {
    if (!this.lastTick.has(instrument)) return undefined;
    const last = this.lastTick.get(instrument);
    if (last === undefined) {
      return { instrument, state: "NO_DATA", lastTickAt: null, ageMs: null };
    }
    const ageMs = Math.max(0, this.now() - last);
    return {
      instrument,
      state: ageMs > this.staleAfterMs ? "STALE" : "FRESH",
      lastTickAt: new Date(last).toISOString(),
      ageMs,
    };
  }

  snapshot(): FeedFreshness[] {
    const out: FeedFreshness[] = [];
    for (const instrument of this.lastTick.keys()) {
      const s = this.status(instrument);
      if (s) out.push(s);
    }
    return out;
  }
}
