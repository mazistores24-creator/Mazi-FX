import { analyzeSeries, bucketEndMs, parseIsoUtc, type Candle, type InstrumentDefinition } from "@mazzi/core";
import { calculatePositionSize, checkDrawdown, combineVetoes, evaluateLossPause } from "@mazzi/risk";
import type { Decision, RiskMode } from "@mazzi/risk";
import { barsFromCandles, evaluate, mayRequestOrder } from "@mazzi/strategy";
import type { EngineConfig, SeriesSet, SetupDecision } from "@mazzi/strategy";
import type { TradeRecord, RegimeLabel } from "@mazzi/quant";

export interface CandleStore {
  load(input: { instrument: string; timeframe: Candle["timeframe"]; from: string; to: string }): Promise<readonly Candle[]>;
}
export interface ReplayInput {
  instrument: InstrumentDefinition;
  candles: { H4: readonly Candle[]; D1: readonly Candle[]; M5: readonly Candle[] };
  from: string;
  to: string;
  mode: RiskMode;
  equity: number;
  accountCurrencyRate: number | null;
  volumeRules: { step: number; minimum: number; maximum: number };
  regime?: RegimeLabel;
  session?: string;
  engineConfig?: EngineConfig;
  costs?: { commissionR?: number; spreadR?: number; slippageR?: number; swapR?: number };
  riskGates?: (context: { decision: SetupDecision; at: string; equity: number; mode: RiskMode }) => Promise<Decision> | Decision;
}
export interface BacktestTrade extends TradeRecord {
  entry: number;
  stop: number;
  exit: number;
  volume: number;
  plannedRisk: number;
  pnl: number;
  outcome: "WIN" | "LOSS" | "BREAKEVEN";
}
export interface BacktestResult {
  trades: BacktestTrade[];
  rejected: Array<{ at: string; setupId: string | null; reasons: string[] }>;
  stats: { barsEvaluated: number; setupsConfirmed: number; tradeCount: number; wins: number; losses: number; breakeven: number; winRate: number | null; netR: number; profitFactor: number | null; maxDrawdownPct: number };
  expectancyTrades: TradeRecord[];
  dataQuality: ReturnType<typeof analyzeSeries>[];
}

function closeTime(c: Candle): number { return bucketEndMs(parseIsoUtc(c.time), c.timeframe); }
function replaySession(iso: string): string {
  const hour = new Date(iso).getUTCHours();
  return hour < 8 ? "ASIA" : hour < 13 ? "LONDON" : hour < 21 ? "NEW_YORK" : "OFF_HOURS";
}
function stopTouched(direction: "LONG" | "SHORT", candle: Candle, stop: number): boolean {
  return direction === "LONG" ? Number(candle.low) <= stop : Number(candle.high) >= stop;
}
function buildTrade(input: {
  decision: SetupDecision; instrument: string; mode: RiskMode; entryBar: Candle; exitBar: Candle;
  entry: number; exit: number; size: number; plannedRisk: number; regime: RegimeLabel; session?: string;
  costs: Required<NonNullable<ReplayInput["costs"]>>;
}): BacktestTrade {
  const direction = input.decision.direction!;
  const stop = input.decision.stop!;
  const riskDistance = Math.abs(input.entry - stop);
  const grossR = (direction === "LONG" ? input.exit - input.entry : input.entry - input.exit) / riskDistance;
  const { commissionR, spreadR, slippageR, swapR } = input.costs;
  const netR = grossR - commissionR - spreadR - slippageR - swapR;
  const setupId = input.decision.id!;
  return {
    id: setupId, instrument: input.instrument, mode: input.mode, direction, regime: input.regime,
    session: input.session ?? replaySession(input.entryBar.time), structuralFeatures: { setupId, reason: input.decision.reason },
    openedAt: input.entryBar.time, closedAt: input.exitBar.time, netR, commissionR, spreadR, slippageR, swapR,
    entry: input.entry, stop, exit: input.exit, volume: input.size, plannedRisk: input.plannedRisk,
    pnl: netR * input.plannedRisk, outcome: netR > 0 ? "WIN" : netR < 0 ? "LOSS" : "BREAKEVEN",
  };
}

/** Deterministic closed-candle replay. All times, bars, gates and sizing terms are caller supplied. */
export async function runBacktest(input: ReplayInput): Promise<BacktestResult> {
  const from = Date.parse(input.from), to = Date.parse(input.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) throw new RangeError("INVALID_REPLAY_RANGE");
  const select = (values: readonly Candle[], timeframe: Candle["timeframe"]): Candle[] => values
    .filter(c => c.complete && c.timeframe === timeframe && c.instrument === input.instrument.canonicalId && closeTime(c) <= to)
    .sort((a,b)=>parseIsoUtc(a.time)-parseIsoUtc(b.time));
  // Keep pre-window history for indicator warmup and strategy context. Only decisions
  // whose H4 close is inside the requested interval can open trades.
  const candles = { H4: select(input.candles.H4,"H4"), D1: select(input.candles.D1,"D1"), M5: select(input.candles.M5,"M5") };
  const dataQuality = [analyzeSeries(candles.H4,"H4"), analyzeSeries(candles.D1,"D1"), analyzeSeries(candles.M5,"M5")];
  const series: SeriesSet = { H4: barsFromCandles(candles.H4,"H4"), D1: barsFromCandles(candles.D1,"D1"), M5: barsFromCandles(candles.M5,"M5") };
  const trades: BacktestTrade[] = [], rejected: BacktestResult["rejected"] = [];
  const costs = { commissionR: input.costs?.commissionR ?? 0, spreadR: input.costs?.spreadR ?? 0, slippageR: input.costs?.slippageR ?? 0, swapR: input.costs?.swapR ?? 0 };
  let equity = input.equity, peakEquity = input.equity, maxDrawdownPct = 0, setupsConfirmed = 0, activeSetup: string | null = null;
  for (let i=0;i<series.H4.length;i++) {
    const asOf = series.H4[i].end;
    if (asOf < from || asOf > to) continue;
    const decision = evaluate({ H4: series.H4.slice(0,i+1), D1: series.D1, M5: series.M5.filter(b=>b.end<=asOf) },asOf,input.engineConfig);
    if (!mayRequestOrder(decision) || !decision.id || decision.id === activeSetup) continue;
    activeSetup = decision.id; setupsConfirmed++;
    if (!decision.m5 || decision.m5.state !== "CONFIRMED" || !decision.direction || decision.stop === undefined) continue;
    const entryBar = candles.M5[decision.m5.barIndex];
    if (!entryBar) continue;
    const entry = Number(entryBar.close);
    const sizing = calculatePositionSize({ equity, entry, stop: decision.stop, accountCurrencyRate: input.accountCurrencyRate, instrument: input.instrument, volumeRules: input.volumeRules });
    const at = new Date(entryBar.time).toISOString();
    const drawdown = checkDrawdown(input.mode,{ referenceEquity: peakEquity, currentEquity: equity });
    const lossPause = evaluateLossPause(input.mode,trades.map(t=>({ mode: t.mode, closedAt: t.closedAt, realizedNetPnl: t.pnl })),new Date(at));
    const pauseDecision: Decision = lossPause.paused ? { status:"VETO", reasons:["CONSECUTIVE_LOSS_PAUSE"] } : { status:"APPROVED" };
    const custom = input.riskGates ? await input.riskGates({ decision, at, equity, mode: input.mode }) : { status:"APPROVED" as const };
    const sizeDecision: Decision = sizing.status === "APPROVED" ? { status:"APPROVED" } : { status:"VETO", reasons:[sizing.reason] };
    const gates = combineVetoes(drawdown,pauseDecision,custom,sizeDecision);
    if (gates.status !== "APPROVED" || sizing.volume === null || sizing.plannedRisk === null) {
      rejected.push({ at, setupId: decision.id, reasons: gates.status === "VETO" ? gates.reasons : [sizing.reason] });
      continue;
    }
    let exitIndex = -1;
    let lastInRange = -1;
    for (let j=decision.m5.barIndex+1;j<candles.M5.length;j++) {
      if (closeTime(candles.M5[j]) > to) break;
      lastInRange=j;
      if (stopTouched(decision.direction,candles.M5[j],decision.stop)) { exitIndex=j; break; }
    }
    // If no stop was hit, close the simulated position at the final in-range candle.
    if (exitIndex < 0) exitIndex = lastInRange;
    const exitBar = exitIndex >= 0 ? candles.M5[exitIndex] : undefined;
    if (!exitBar || exitIndex <= decision.m5.barIndex) continue;
    const exit = stopTouched(decision.direction,exitBar,decision.stop) ? decision.stop : Number(exitBar.close);
    const trade = buildTrade({ decision, instrument: input.instrument.canonicalId, mode: input.mode, entryBar, exitBar, entry, exit, size: sizing.volume, plannedRisk: sizing.plannedRisk, regime: input.regime ?? "UNSTABLE", session: input.session, costs });
    trades.push(trade); equity += trade.pnl;
    if (equity > peakEquity) peakEquity=equity;
    maxDrawdownPct=Math.max(maxDrawdownPct,peakEquity>0?(peakEquity-equity)/peakEquity*100:0);
    while (i+1<series.H4.length && series.H4[i+1].end<=closeTime(exitBar)) i++;
  }
  const wins=trades.filter(t=>t.outcome==="WIN").length, losses=trades.filter(t=>t.outcome==="LOSS").length, breakeven=trades.length-wins-losses;
  const positive=trades.filter(t=>t.pnl>0).reduce((sum,t)=>sum+t.pnl,0), negative=Math.abs(trades.filter(t=>t.pnl<0).reduce((sum,t)=>sum+t.pnl,0));
  const expectancyTrades: TradeRecord[] = trades.map(trade => ({
    id:trade.id,instrument:trade.instrument,mode:trade.mode,direction:trade.direction,regime:trade.regime,session:trade.session,
    structuralFeatures:trade.structuralFeatures,openedAt:trade.openedAt,closedAt:trade.closedAt,netR:trade.netR,
    commissionR:trade.commissionR,spreadR:trade.spreadR,slippageR:trade.slippageR,swapR:trade.swapR,
  }));
  return { trades,rejected,stats:{ barsEvaluated:series.H4.length,setupsConfirmed,tradeCount:trades.length,wins,losses,breakeven,winRate:trades.length?wins/trades.length:null,netR:trades.reduce((sum,t)=>sum+(t.netR??0),0),profitFactor:negative?positive/negative:null,maxDrawdownPct },expectancyTrades,dataQuality };
}

export async function runBacktestFromStore(input: Omit<ReplayInput, "candles"> & { store: CandleStore }): Promise<BacktestResult> {
  const ranges = await Promise.all(([["H4", "H4"], ["D1", "D1"], ["M5", "M5"]] as const).map(async ([key, timeframe]) => [key, await input.store.load({ instrument: input.instrument.canonicalId, timeframe, from: input.from, to: input.to })] as const));
  const candles = Object.fromEntries(ranges) as ReplayInput["candles"];
  return runBacktest({ instrument:input.instrument,from:input.from,to:input.to,mode:input.mode,equity:input.equity,accountCurrencyRate:input.accountCurrencyRate,volumeRules:input.volumeRules,regime:input.regime,session:input.session,engineConfig:input.engineConfig,costs:input.costs,riskGates:input.riskGates,candles });
}
