import type { Candle, InstrumentDefinition } from "@mazzi/core";
import { bucketEndMs, parseIsoUtc } from "@mazzi/core";
import { calculatePositionSize, checkDrawdown, combineVetoes, evaluateLossPause } from "@mazzi/risk";
import type { Decision, RiskMode } from "@mazzi/risk";
import { barsFromCandles, evaluate, mayRequestOrder } from "@mazzi/strategy";
import type { EngineConfig, SetupDecision } from "@mazzi/strategy";

export interface PaperCandleSource {
  /** Must be backed by demo/paper market data. The engine does not create a provider or connect. */
  subscribe(instrument: string, timeframes: readonly ["H4", "D1", "M5"], onCandle: (candle: Candle) => void): () => void;
}
export type PaperLedgerEvent =
  | { id: string; kind: "ENTRY"; at: string; setupId: string; direction: "LONG" | "SHORT"; entry: number; stop: number; volume: number; plannedRisk: number }
  | { id: string; kind: "EXIT"; at: string; setupId: string; exit: number; netR: number; pnl: number; reason: "STOP" | "END_OF_STREAM" };
export interface PaperPosition { setupId: string; direction: "LONG" | "SHORT"; openedAt: string; entry: number; stop: number; volume: number; plannedRisk: number }
export interface PaperConfig {
  instrument: InstrumentDefinition;
  mode: RiskMode;
  equity: number;
  accountCurrencyRate: number | null;
  volumeRules: { step: number; minimum: number; maximum: number };
  engineConfig?: EngineConfig;
  riskGates?: (context: { decision: SetupDecision; at: string; equity: number }) => Decision;
  costsR?: number;
}

/** In-memory append-only paper ledger. No adapter accepts or routes broker orders. */
export class PaperLedger {
  private readonly entries: PaperLedgerEvent[] = [];
  append(event: PaperLedgerEvent): void {
    if (this.entries.some(item=>item.id===event.id)) throw new Error("PAPER_LEDGER_DUPLICATE_ID");
    this.entries.push(Object.freeze({...event}));
  }
  list(): readonly PaperLedgerEvent[] { return this.entries.map(event=>({...event})); }
}

/** Event-driven paper runner. Only complete candles are consumed and all trading effects stay in the local ledger. */
export class PaperTradingEngine {
  private h4: Candle[]=[]; private d1: Candle[]=[]; private m5: Candle[]=[];
  private position: PaperPosition | null=null; private equity: number; private peak: number; private readonly closedOutcomes:Array<{mode:RiskMode;closedAt:string;realizedNetPnl:number}>=[];
  private lastSetup: string | null=null; private sequence=0; private unsubscribe?:()=>void;
  constructor(private readonly config: PaperConfig, readonly ledger = new PaperLedger()) {
    if (!(config.equity>0) || !Number.isFinite(config.equity)) throw new RangeError("INVALID_PAPER_EQUITY");
    this.equity=config.equity; this.peak=config.equity;
  }
  start(source: PaperCandleSource): void {
    if (this.unsubscribe) throw new Error("PAPER_ENGINE_ALREADY_STARTED");
    this.unsubscribe=source.subscribe(this.config.instrument.canonicalId,["H4","D1","M5"],candle=>this.onCandle(candle));
  }
  stop(): void { this.unsubscribe?.(); this.unsubscribe=undefined; }
  onCandle(candle: Candle): void {
    if (!candle.complete || candle.instrument!==this.config.instrument.canonicalId) return;
    const target = candle.timeframe === "H4" ? this.h4 : candle.timeframe === "D1" ? this.d1 : candle.timeframe === "M5" ? this.m5 : undefined;
    if (!target) return;
    const time=parseIsoUtc(candle.time);
    if (target.length && parseIsoUtc(target[target.length-1].time)>=time) throw new Error("PAPER_CANDLES_MUST_BE_STRICTLY_ASCENDING");
    target.push({...candle});
    if (this.position && candle.timeframe === "M5") { this.manage(candle); return; }
    if (candle.timeframe !== "H4" || this.position || this.h4.length<60 || this.d1.length<60) return;
    const at=bucketEndMs(time,"H4"),series={H4:barsFromCandles(this.h4,"H4"),D1:barsFromCandles(this.d1,"D1"),M5:barsFromCandles(this.m5.filter(c=>bucketEndMs(parseIsoUtc(c.time),"M5")<=at),"M5")};
    const decision=evaluate(series,at,this.config.engineConfig);
    if (!mayRequestOrder(decision) || !decision.id || decision.id===this.lastSetup || decision.m5?.state!=="CONFIRMED" || !decision.direction || decision.stop===undefined) return;
    this.lastSetup=decision.id;
    const signalBar=this.m5[decision.m5.barIndex]; if(!signalBar) return;
    const entry=Number(signalBar.close);
    const sizing=calculatePositionSize({equity:this.equity,entry,stop:decision.stop,accountCurrencyRate:this.config.accountCurrencyRate,instrument:this.config.instrument,volumeRules:this.config.volumeRules});
    const drawdown=checkDrawdown(this.config.mode,{referenceEquity:this.peak,currentEquity:this.equity});
    const pause=evaluateLossPause(this.config.mode,this.closedOutcomes,new Date(at));
    const pauseDecision:Decision=pause.paused?{status:"VETO",reasons:["CONSECUTIVE_LOSS_PAUSE"]}:{status:"APPROVED"};
    const custom=this.config.riskGates?.({decision,at:new Date(at).toISOString(),equity:this.equity})??{status:"APPROVED" as const};
    const sizeDecision:Decision=sizing.status==="APPROVED"?{status:"APPROVED"}:{status:"VETO",reasons:[sizing.reason]};
    if(combineVetoes(drawdown,pauseDecision,custom,sizeDecision).status!=="APPROVED"||sizing.volume===null||sizing.plannedRisk===null) return;
    this.position={setupId:decision.id,direction:decision.direction,openedAt:signalBar.time,entry,stop:decision.stop,volume:sizing.volume,plannedRisk:sizing.plannedRisk};
    this.ledger.append({id:this.nextId("entry"),kind:"ENTRY",at:signalBar.time,setupId:decision.id,direction:decision.direction,entry,stop:decision.stop,volume:sizing.volume,plannedRisk:sizing.plannedRisk});
  }
  private manage(candle:Candle):void {
    const pos=this.position!;
    const hit=pos.direction==="LONG"?Number(candle.low)<=pos.stop:Number(candle.high)>=pos.stop;
    if(!hit)return;
    const exit=pos.stop, distance=Math.abs(pos.entry-pos.stop), grossR=(pos.direction==="LONG"?exit-pos.entry:pos.entry-exit)/distance;
    const netR=grossR-(this.config.costsR??0),pnl=netR*pos.plannedRisk;
    this.equity+=pnl; this.peak=Math.max(this.peak,this.equity);
    this.closedOutcomes.push({mode:this.config.mode,closedAt:candle.time,realizedNetPnl:pnl});
    this.ledger.append({id:this.nextId("exit"),kind:"EXIT",at:candle.time,setupId:pos.setupId,exit,netR,pnl,reason:"STOP"});
    this.position=null;
  }
  private nextId(kind:string):string { return `paper-${kind}-${++this.sequence}`; }
  snapshot():{equity:number;openPosition:PaperPosition|null;ledger:readonly PaperLedgerEvent[]} { return {equity:this.equity,openPosition:this.position?{...this.position}:null,ledger:this.ledger.list()}; }
}
