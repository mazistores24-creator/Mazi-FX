import type { SetupDecision } from "@mazzi/strategy";
import type { ChecklistFeature, ChecklistResult, RegimeLabel } from "./types";
export interface ChecklistInput { setup:Pick<SetupDecision,"state"|"direction"|"stop"|"stopCheck">;regime:RegimeLabel|null;allowedRegimes:readonly RegimeLabel[];stopDistance:number|null;atr14:number|null;spread:number|null;candlesComplete:boolean }
const features:readonly ChecklistFeature[]=["REGIME_COMPATIBLE","STOP_DISTANCE_VALID","SPREAD_VALID","CANDLE_DATA_COMPLETE","SETUP_CONFIRMED"];
/** Unweighted checklist completion ratio. It is not a win probability. */
export function scoreChecklist(input:ChecklistInput):ChecklistResult{
 const values:Record<ChecklistFeature,{pass:boolean|null;detail:string}>={
  REGIME_COMPATIBLE:{pass:input.regime===null?null:input.allowedRegimes.includes(input.regime),detail:input.regime===null?"regime unavailable":`regime ${input.regime}`},
  STOP_DISTANCE_VALID:{pass:input.stopDistance===null||input.atr14===null?null:input.stopDistance>=0.5*input.atr14,detail:"stop distance must be at least 0.5 x ATR(14)"},
  SPREAD_VALID:{pass:input.spread===null||input.atr14===null?null:input.spread<=0.15*input.atr14,detail:"spread must not exceed 0.15 x ATR(14)"},
  CANDLE_DATA_COMPLETE:{pass:input.candlesComplete,detail:"input candles must be complete"},
  SETUP_CONFIRMED:{pass:input.setup.state==="CONFIRMED"&&input.setup.stopCheck?.ok===true&&Number.isFinite(input.setup.stop),detail:"setup must be confirmed with an accepted stop"},
 };
 const items=features.map(feature=>({feature,...values[feature]})),checked=items.filter(x=>x.pass!==null).length,passed=items.filter(x=>x.pass===true).length;
 const status=items.some(x=>x.pass===false)?"FAIL":items.some(x=>x.pass===null)?"DATA_UNAVAILABLE":"PASS";
 return{status,items,passed,checked,score:checked===0?null:passed/checked};
}
