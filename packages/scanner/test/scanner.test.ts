import { describe, expect, it } from "vitest";
import type { Candle, FeedFreshness, OperatingMode } from "@mazzi/core";
import type { SetupDecision } from "@mazzi/strategy";
import type { Phase5RiskResults, ScanEvent, SetupPort } from "../src/types";
import { MemoryFeedPort, MemoryScanStateStore } from "../src/adapters";
import { Scanner } from "../src/scanner";
import { FakeTelegramSender } from "../src/telegram";

const time = "2026-10-29T12:00:00.000Z";
const candle = (timeframe: Candle["timeframe"]): Candle => ({ time, open: "1", high: "2", low: "0.5", close: "1.5", timeframe, instrument: "R_100", complete: true });
const fresh = (instrument: string): FeedFreshness => ({ instrument, state: "FRESH", lastTickAt: time, ageMs: 0 });
const confirmed: SetupDecision = {
  id: "LONG-setup-1", state: "CONFIRMED", direction: "LONG", reason: "M5_CONFIRMED", transitions: [],
  gates: { ichimoku: { pass: true, reason: "OK" }, rsi: { pass: true, reason: "OK" }, supplyDemand: true },
  m5: { state: "CONFIRMED", barIndex: 1, reason: "M5_CLOSE_BEYOND_PRIOR_HIGH" }, stop: 0.5, stopCheck: { ok: true, distance: 0.5, reason: "STOP_OK" },
};
const setupPort: SetupPort = { evaluate: () => confirmed };
const passRisk = (): Promise<Phase5RiskResults> => Promise.resolve({
  risk: { status: "APPROVED" }, compliance: { status: "APPROVED" }, news: { status: "APPROVED" }, emergency: { status: "APPROVED" },
  sizing: { status: "APPROVED", reason: "SIZE_OK", riskBudget: 1, volume: 1, plannedRisk: 1 },
  drawdown: { status: "APPROVED", drawdownAmount: 0, drawdownPct: 0, limitPct: 2 },
});
function feed(state: "FRESH" | "STALE" | "NO_DATA" = "FRESH"): MemoryFeedPort {
  const f = new MemoryFeedPort();
  for (const tf of ["D1", "H4", "M5"] as const) f.add("R_100", tf, [candle(tf)], { ...fresh("R_100"), state });
  return f;
}
function createScanner(opts?: { feed?: MemoryFeedPort; risk?: (input: { instrument: string; setup: SetupDecision; asOf: string; mode: OperatingMode }) => Promise<Phase5RiskResults>; sender?: FakeTelegramSender; state?: MemoryScanStateStore; events?: ScanEvent[] }) {
  const sender = opts?.sender ?? new FakeTelegramSender();
  const store = opts?.state ?? new MemoryScanStateStore();
  const events = opts?.events ?? [];
  let now = Date.parse(time);
  const scanner = new Scanner({
    feed: opts?.feed ?? feed(), setup: setupPort, telegram: sender, state: store, now: () => now,
    risk: { assess: opts?.risk ?? passRisk }, onEvent: (event) => events.push(event), config: { cooldownMs: 60_000 },
  });
  return { scanner, sender, store, events, setNow: (value: number) => { now = value; } };
}

describe("Phase 6 scanner", () => {
  it("delivers once and restores dedup ledger after restart", async () => {
    const first = createScanner();
    await first.scanner.tick();
    expect(first.sender.sent).toHaveLength(1);
    const second = createScanner({ state: first.store, sender: first.sender });
    await second.scanner.tick();
    expect(first.sender.sent).toHaveLength(1);
    expect(second.events.some((event) => event.type === "DUPLICATE")).toBe(true);
  });
  it.each(["STALE", "NO_DATA"] as const)("blocks alerts when Phase 2 feed is %s", async (state) => {
    const { scanner, sender, events } = createScanner({ feed: feed(state) });
    await scanner.tick();
    expect(sender.sent).toHaveLength(0);
    expect(events.some((event) => event.type === "SKIPPED")).toBe(true);
  });
  it("fails closed on any Phase 5 risk gate veto", async () => {
    const risk = async (): Promise<Phase5RiskResults> => ({ ...await passRisk(), news: { status: "VETO", reasons: ["NEWS_BLACKOUT"] } });
    const { scanner, sender, events } = createScanner({ risk });
    await scanner.tick();
    expect(sender.sent).toHaveLength(0);
    expect(events.some((event) => event.type === "VETOED")).toBe(true);
  });
  it("retries failed Telegram delivery, preserving pending alert through recovery", async () => {
    const sender = new FakeTelegramSender(); sender.failNext();
    const first = createScanner({ sender });
    await first.scanner.tick();
    expect(sender.sent).toHaveLength(0);
    const second = createScanner({ state: first.store, sender });
    await second.scanner.tick();
    expect(sender.sent).toHaveLength(1);
  });
  it("enforces cooldown for a different setup in the same instrument-direction", async () => {
    const sender = new FakeTelegramSender();
    let id = confirmed.id;
    const customSetup: SetupPort = { evaluate: () => ({ ...confirmed, id }) };
    const source = feed();
    let now = Date.parse(time);
    const scanner = new Scanner({ feed: source, setup: customSetup, risk: { assess: passRisk }, telegram: sender, state: new MemoryScanStateStore(), now: () => now, config: { cooldownMs: 60_000 } });
    await scanner.tick();
    id = "LONG-setup-2";
    now += 10_000;
    await scanner.tick();
    expect(sender.sent).toHaveLength(1);
  });
});
