import { randomUUID } from "node:crypto";
import { barsFromCandles, mayRequestOrder, type SeriesSet } from "@mazzi/strategy";
import { combineVetoes } from "@mazzi/risk";
import { ScannerConfigSchema, REQUIRED_TIMEFRAMES, type PersistedScanState, type ScanEvent, type ScannerOptions } from "./types";
import { formatAlert } from "./telegram";

const freshState = (): PersistedScanState => ({ version: 1, cursor: {}, delivered: {}, pending: {}, lastSentByKey: {}, failures: 0, updatedAt: new Date(0).toISOString() });
const validState = (state: PersistedScanState | undefined): PersistedScanState => {
  if (!state || state.version !== 1 || typeof state.cursor !== "object" || typeof state.delivered !== "object" || typeof state.lastSentByKey !== "object") return freshState();
  return { ...freshState(), ...state };
};

/**
 * Resumable scanner coordinator. It persists a per-feed watermark and alert ledger,
 * commits alert delivery before advancing the cursor, and retries failed sends after restart.
 */
export class Scanner {
  readonly config;
  private state = freshState();
  private started = false;
  private hydrated = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = true;
  private tickInFlight = false;
  private readonly latestSetups = new Map<string, { id: string; instrument: string; state: string; direction: "LONG" | "SHORT" | null; score: number | null; updatedAt: string }>();
  private readonly now: () => number;
  private readonly emit: (event: ScanEvent) => void;
  constructor(private readonly options: ScannerOptions) {
    this.config = ScannerConfigSchema.parse(options.config ?? {});
    this.now = options.now ?? (() => Date.now());
    this.emit = options.onEvent ?? (() => undefined);
  }

  async start(): Promise<void> {
    if (this.started) return;
    await this.hydrate();
    this.started = true;
    this.stopped = false;
    await this.tick();
    this.schedule();
  }
  private async hydrate(): Promise<void> {
    if (this.hydrated) return;
    this.state = validState(await this.options.state.load());
    this.hydrated = true;
  }
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    while (this.tickInFlight) await new Promise((resolve) => setTimeout(resolve, 1));
    await this.persist();
  }
  isRunning(): boolean { return this.started && !this.stopped; }
  snapshot(): PersistedScanState { return structuredClone(this.state); }
  dashboardSetups(): readonly { id: string; instrument: string; state: string; direction: "LONG" | "SHORT" | null; score: number | null; updatedAt: string }[] {
    return Array.from(this.latestSetups.values(), (item) => ({ ...item }));
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.tick().finally(() => this.schedule());
    }, this.config.intervalMs);
  }
  private key(instrument: string, timeframes: readonly string[]): string { return `${instrument}|${[...timeframes].sort().join(",")}`; }
  private async persist(): Promise<void> {
    this.state.updatedAt = new Date(this.now()).toISOString();
    await this.options.state.save(this.state);
  }
  private report(event: ScanEvent): void { this.emit(event); }

  /** A public deterministic single scan cycle for operators/tests. */
  async tick(): Promise<void> {
    if (this.tickInFlight) return;
    this.tickInFlight = true;
    try {
      await this.hydrate();
      const now = this.now();
      for (const instrument of this.options.feed.instruments()) {
        const key = this.key(instrument.id, instrument.timeframes);
        const snapshots = new Map<string, ReturnType<typeof this.options.feed.snapshot>>();
        let unsafe: string | undefined;
        for (const timeframe of REQUIRED_TIMEFRAMES) {
          if (!instrument.timeframes.includes(timeframe)) { unsafe = `MISSING_${timeframe}`; break; }
          const snap = this.options.feed.snapshot(instrument.id, timeframe, now);
          snapshots.set(timeframe, snap);
          const staleByAge = snap.status.ageMs !== null && snap.status.ageMs > this.config.staleAfterMs;
          if (snap.status.state !== "FRESH" || staleByAge) { unsafe = `FEED_${snap.status.state === "FRESH" ? "STALE" : snap.status.state}_${timeframe}`; break; }
          if (!snap.candles.some((c) => c.complete)) { unsafe = `NO_COMPLETE_CANDLES_${timeframe}`; break; }
        }
        if (unsafe) {
          this.report({ type: "SKIPPED", instrument: instrument.id, reason: unsafe });
          continue;
        }
        const candleList = (tf: "H4" | "D1" | "M5") => snapshots.get(tf)?.candles ?? [];
        const series: SeriesSet = {
          H4: barsFromCandles(candleList("H4"), "H4"),
          D1: barsFromCandles(candleList("D1"), "D1"),
          M5: barsFromCandles(candleList("M5"), "M5"),
        };
        const decision = this.options.setup.evaluate(series, now);
        if (decision.id) {
          this.latestSetups.set(decision.id, {
            id: decision.id,
            instrument: instrument.id,
            state: decision.state,
            direction: decision.direction,
            score: null,
            updatedAt: new Date(now).toISOString(),
          });
        }
        const cursor = this.state.cursor[key];
        const cursorMs = cursor ? Date.parse(cursor) : -Infinity;
        const newest = Math.max(-Infinity, ...series.H4.map((bar) => bar.end), ...series.M5.map((bar) => bar.end), ...series.D1.map((bar) => bar.end));
        if (!Number.isFinite(newest)) {
          this.report({ type: "SKIPPED", instrument: instrument.id, reason: "NO_COMPLETE_CANDLES" });
          continue;
        }
        if (!mayRequestOrder(decision) || !decision.id || !decision.direction) {
          this.report({ type: "NO_SETUP", instrument: instrument.id, reason: decision.reason });
          this.state.cursor[key] = new Date(Math.max(cursorMs, newest)).toISOString();
          await this.persist();
          continue;
        }
        if (decision.state !== "CONFIRMED" || decision.gates?.ichimoku.pass !== true || decision.gates?.rsi.pass !== true || decision.gates?.supplyDemand !== true || !decision.stopCheck?.ok) {
          this.report({ type: "NO_SETUP", instrument: instrument.id, reason: "STRATEGY_GATES_NOT_PASSED" });
          continue;
        }
        const knownDelivery = this.state.delivered[decision.id];
        if (knownDelivery !== undefined && now - knownDelivery <= this.config.dedupRetentionMs) {
          this.report({ type: "DUPLICATE", instrument: instrument.id, setupId: decision.id });
          this.state.cursor[key] = new Date(Math.max(cursorMs, newest)).toISOString();
          await this.persist();
          continue;
        }
        const coolKey = `${instrument.id}|${decision.direction}`;
        const lastSent = this.state.lastSentByKey[coolKey];
        if (lastSent !== undefined && now - lastSent < this.config.cooldownMs) {
          this.report({ type: "COOLDOWN", instrument: instrument.id, setupId: decision.id, until: new Date(lastSent + this.config.cooldownMs).toISOString() });
          continue;
        }
        const mode = this.config.mode as import("@mazzi/core").OperatingMode;
        const risk = await this.options.risk.assess({ instrument: instrument.id, setup: decision, asOf: new Date(now).toISOString(), mode });
    const combined = combineVetoes(risk.risk, risk.compliance, risk.news, risk.emergency);
        if (combined.status !== "APPROVED") {
          this.report({ type: "VETOED", instrument: instrument.id, setupId: decision.id, reasons: combined.reasons });
          continue;
        }
        if (risk.sizing.status !== "APPROVED") {
          this.report({ type: "VETOED", instrument: instrument.id, setupId: decision.id, reasons: [risk.sizing.reason] });
          continue;
        }
        if (risk.drawdown.status !== "APPROVED") {
          this.report({ type: "VETOED", instrument: instrument.id, setupId: decision.id, reasons: risk.drawdown.reasons });
          continue;
        }
      const pendingAlert = this.state.pending[decision.id] ?? formatAlert({ id: randomUUID(), instrument: instrument.id, direction: decision.direction, setupId: decision.id, asOf: new Date(now).toISOString() });
        this.state.pending[decision.id] = pendingAlert;
        await this.persist();
        try {
          await this.options.telegram.send(pendingAlert);
        } catch (error) {
          this.state.failures++;
          this.report({ type: "ERROR", instrument: instrument.id, message: error instanceof Error ? error.message : "TELEGRAM_SEND_FAILED" });
          await this.persist();
          continue;
        }
        // Ledger is committed after successful delivery. Unsent messages remain retryable after recovery.
        this.state.delivered[decision.id] = now;
        this.state.lastSentByKey[coolKey] = now;
        this.state.failures = 0;
        this.state.cursor[key] = new Date(Math.max(cursorMs, newest)).toISOString();
        await this.persist();
        this.report({ type: "DELIVERED", instrument: instrument.id, setupId: decision.id, alertId: pendingAlert.id });
      }
      const expiry = now - this.config.dedupRetentionMs;
      for (const [id, sentAt] of Object.entries(this.state.delivered)) if (sentAt < expiry) delete this.state.delivered[id];
      await this.persist();
    } catch (error) {
      this.state.failures++;
      this.report({ type: "ERROR", message: error instanceof Error ? error.message : "SCAN_CYCLE_FAILED" });
      await this.persist().catch(() => undefined);
    } finally {
      this.tickInFlight = false;
    }
  }
}
