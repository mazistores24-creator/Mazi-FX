import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { analyzeSeries, type Candle, type InstrumentDefinition } from "@mazzi/core";
import { runBacktest } from "../packages/backtest/src/replay";
import { DerivHistoryClient, utcDateRange } from "../packages/backtest/src/deriv-history";
async function main(): Promise<void> {
  const args = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i], value = process.argv[i + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) throw new Error("USAGE: npm run replay:deriv -- --from YYYY-MM-DD --to YYYY-MM-DD [--symbol frxEURUSD] [--equity 10000] [--out path]");
    if (args.has(key)) throw new Error(`DUPLICATE_ARGUMENT:${key}`);
    args.set(key, value);
  }
  const from = args.get("--from"), to = args.get("--to"), symbol = args.get("--symbol") ?? "frxEURUSD";
  const equity = Number(args.get("--equity") ?? "10000"), outputPath = resolve(args.get("--out") ?? "data/replays/frxEURUSD-2025.json");
  if (!from || !to || !Number.isFinite(equity) || equity <= 0) throw new Error("FROM_TO_AND_POSITIVE_EQUITY_REQUIRED");
  const { startMs, endExclusiveMs } = utcDateRange(from, to);
  if (symbol !== "frxEURUSD") throw new Error("CURRENT_REPLAY_RUNNER_SUPPORTS_FRXEURUSD_ONLY");
  if (args.size > 5) throw new Error("UNKNOWN_ARGUMENT");
  const instrument: InstrumentDefinition = { canonicalId: symbol, providerId: "DERIV", brokerSymbol: symbol, displayName: "EUR/USD", category: "FOREX", family: "MAJOR", tickSize: "0.00001", pipDecimals: 5, tickValue: null, minStake: null, maxStake: null, tradingAvailable: true, tradingUnavailableReason: null };
  const appId = process.env.DERIV_APP_ID;
  if (!appId) throw new Error("DERIV_APP_ID is required for public Deriv market data");
  const client = new DerivHistoryClient(appId);
  try {
    await client.connect();
    const candles = {} as Record<"H4" | "D1" | "M5", Candle[]>;
    for (const timeframe of ["H4", "D1", "M5"] as const) {
      process.stdout.write(`fetching ${symbol} ${timeframe} ${from} through ${to} UTC\n`);
      candles[timeframe] = await client.fetchCandles(symbol, timeframe, from, to);
    }
    if (["H4", "D1", "M5"].some(tf => candles[tf as "H4" | "D1" | "M5"].length === 0)) throw new Error("NO_CANDLES_RETURNED_FOR_ONE_OR_MORE_TIMEFRAMES");
    const result = await runBacktest({ instrument, candles, from: `${from}T00:00:00Z`, to: `${to}T23:59:59Z`, mode: "SWING", equity, accountCurrencyRate: null, volumeRules: { step: 0.01, minimum: 0.01, maximum: 100 }, costs: { commissionR: 0, spreadR: 0, slippageR: 0, swapR: 0 } });
    const report = {
      source: "Deriv public ticks_history candles", symbol, fromUtc: from, toUtc: to, mode: "SWING", startingEquity: equity,
      timeframeCounts: Object.fromEntries((["H4", "D1", "M5"] as const).map(tf => [tf, candles[tf].length])),
      dataQuality: Object.fromEntries((["H4", "D1", "M5"] as const).map(tf => [tf, analyzeSeries(candles[tf], tf)])),
      stats: result.stats,
      rejectedReasons: result.rejected.flatMap(item => item.reasons).reduce<Record<string, number>>((counts, reason) => ({ ...counts, [reason]: (counts[reason] ?? 0) + 1 }), {}),
      trades: result.trades,
      caveats: ["offline replay only; no account authorization or order submission", "risk sizing is intentionally vetoed because public data does not supply verified tick value or EUR-to-account-currency conversion", "zero costs used because verified historical spread, commission, slippage, and swap data were not supplied", "OHLC bars do not reveal intrabar ordering beyond stop-touch handling"],
    };
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    const saved = JSON.parse(await readFile(outputPath, "utf8")) as typeof report;
    if (saved.symbol !== symbol || saved.fromUtc !== from || saved.toUtc !== to || startMs >= endExclusiveMs) throw new Error("REPORT_PERSISTENCE_CHECK_FAILED");
    process.stdout.write(`${JSON.stringify({ outputPath, symbol, fromUtc: from, toUtc: to, timeframeCounts: saved.timeframeCounts, stats: saved.stats, rejectedReasons: saved.rejectedReasons, candleQuality: Object.fromEntries((["H4", "D1", "M5"] as const).map(tf => [tf, { gaps: saved.dataQuality[tf].gaps.length, duplicates: saved.dataQuality[tf].duplicates, misaligned: saved.dataQuality[tf].misaligned.length }])) }, null, 2)}\n`);
  } finally {
    await client.close();
  }
}

main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
