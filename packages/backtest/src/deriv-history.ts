import { WebSocket, type RawData } from "ws";
import { bucketEndMs, parseIsoUtc, toIsoUtc, validateCandle, type Candle, type Timeframe } from "@mazzi/core";

const WS_URL = "wss://ws.derivws.com/websockets/v3";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_HISTORY_COUNT = 5000;
const GRANULARITY: Record<"H4" | "D1" | "M5", number> = { H4: 14_400, D1: 86_400, M5: 300 };
type DerivCandleRow = { epoch: number; open: string; high: string; low: string; close: string };

function validTimestamp(value: string, field: string): number {
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value) throw new RangeError(`INVALID_${field.toUpperCase()}_DATE`);
  return ms;
}
function chunkRanges(startMs: number, endExclusiveMs: number, granularity: number): Array<{ startMs: number; endExclusiveMs: number }> {
  const maxSpanMs = (MAX_HISTORY_COUNT - 2) * granularity * 1000;
  const chunks: Array<{ startMs: number; endExclusiveMs: number }> = [];
  for (let cursor = startMs; cursor < endExclusiveMs;) { const end = Math.min(endExclusiveMs, cursor + maxSpanMs); chunks.push({ startMs: cursor, endExclusiveMs: end }); cursor = end; }
  return chunks;
}

/** Read-only, unauthenticated historical candle request. No authorize or trading methods are exposed. */
export class DerivHistoryClient {
  private socket?: WebSocket;
  private requestId = 0;
  constructor(private readonly appId: string) { if (!/^\d+$/.test(appId)) throw new Error("DERIV_APP_ID must be numeric"); }
  async connect(): Promise<void> {
    if (this.socket) return;
    const socket = new WebSocket(`${WS_URL}?app_id=${encodeURIComponent(this.appId)}`); this.socket = socket;
    await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error("DERIV_CONNECT_TIMEOUT")), REQUEST_TIMEOUT_MS); socket.once("open", () => { clearTimeout(timer); resolve(); }); socket.once("error", error => { clearTimeout(timer); reject(error); }); });
  }
  async fetchCandles(symbol: string, timeframe: "H4" | "D1" | "M5", from: string, to: string): Promise<Candle[]> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error("DERIV_NOT_CONNECTED");
    if (!/^[A-Za-z0-9_]+$/.test(symbol)) throw new Error("INVALID_SYMBOL");
    const startMs = validTimestamp(from, "from"), endExclusiveMs = validTimestamp(to, "to") + 86_400_000;
    if (startMs >= endExclusiveMs) throw new RangeError("INVALID_REPLAY_RANGE");
    const granularity = GRANULARITY[timeframe];
    const candles: Candle[] = [];
    for (const range of chunkRanges(startMs, endExclusiveMs, granularity)) {
      const count = Math.min(MAX_HISTORY_COUNT, Math.ceil((range.endExclusiveMs - range.startMs) / (granularity * 1000)) + 1);
      const rows = await this.request({ ticks_history: symbol, style: "candles", granularity, start: Math.floor(range.startMs / 1000), end: Math.floor(range.endExclusiveMs / 1000), count, req_id: ++this.requestId });
      if (!Array.isArray(rows)) throw new Error("DERIV_CANDLES_RESPONSE_MALFORMED");
      candles.push(...rows.map((row: DerivCandleRow) => ({ time: toIsoUtc(Number(row.epoch) * 1000), open: String(row.open), high: String(row.high), low: String(row.low), close: String(row.close), timeframe, instrument: symbol, complete: true })).filter(candle => { const open = parseIsoUtc(candle.time); return open >= range.startMs && bucketEndMs(open, timeframe) <= range.endExclusiveMs; }));
    }
    candles.sort((a,b) => parseIsoUtc(a.time) - parseIsoUtc(b.time));
    const unique: Candle[] = [], seen = new Set<number>();
    for (const candle of candles) { const open = parseIsoUtc(candle.time); if (seen.has(open)) continue; seen.add(open); unique.push(candle); const issues = validateCandle(candle); if (issues.length) throw new Error(`INVALID_DERIV_CANDLE:${candle.time}:${issues.join(",")}`); }
    return unique;
  }
  private async request(payload: Record<string, unknown>): Promise<unknown> {
    const socket = this.socket; if (!socket) throw new Error("DERIV_NOT_CONNECTED");
    return new Promise((resolve, reject) => {
      const reqId = payload.req_id;
      const timer = setTimeout(() => { cleanup(); reject(new Error("DERIV_REQUEST_TIMEOUT")); }, REQUEST_TIMEOUT_MS);
      const cleanup = (): void => { clearTimeout(timer); socket.off("message", onMessage); };
      const onMessage = (data: RawData): void => {
        let message: Record<string, unknown>; try { message = JSON.parse(data.toString()) as Record<string, unknown>; } catch { return; }
        if (message.req_id !== reqId) return; cleanup();
        if (message.error) { const error = message.error as { code?: string; message?: string }; reject(new Error(`DERIV_${error.code ?? "ERROR"}:${error.message ?? "request failed"}`)); return; }
        resolve((message.candles as DerivCandleRow[] | undefined) ?? null);
      };
      socket.on("message", onMessage); socket.send(JSON.stringify(payload), error => { if (error) { cleanup(); reject(error); } });
    });
  }
  async close(): Promise<void> {
    const socket = this.socket; this.socket = undefined; if (!socket) return;
    await new Promise<void>(resolve => { if (socket.readyState === WebSocket.CLOSED) { resolve(); return; } socket.once("close", () => resolve()); socket.close(); setTimeout(() => { if (socket.readyState !== WebSocket.CLOSED) socket.terminate(); resolve(); }, 1000).unref(); });
  }
}
export function utcDateRange(from: string, to: string): { startMs: number; endExclusiveMs: number } {
  const startMs = validTimestamp(from, "from"), endExclusiveMs = validTimestamp(to, "to") + 86_400_000;
  if (startMs >= endExclusiveMs) throw new RangeError("INVALID_REPLAY_RANGE");
  return { startMs, endExclusiveMs };
}
export type ReplayTimeframe = "H4" | "D1" | "M5";
export type ReplayCandles = Record<ReplayTimeframe, Candle[]>;
export type ReplayTimeframeType = Timeframe;
