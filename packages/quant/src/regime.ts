import type { RegimeCandle, RegimeLabel } from "./types";
export interface RegimeConfig { adxPeriod: number; trendAdxThreshold: number; atrPeriod: number; volatilityWindow: number; efficiencyPeriod: number; highVolPercentile: number; lowVolPercentile: number }
export const DEFAULT_REGIME_CONFIG: Readonly<RegimeConfig> = Object.freeze({ adxPeriod: 14, trendAdxThreshold: 25, atrPeriod: 14, volatilityWindow: 250, efficiencyPeriod: 20, highVolPercentile: 0.8, lowVolPercentile: 0.2 });
export interface RegimeFeatures { adx: number; atr: number; atrPercentile: number; efficiencyRatio: number }
export interface RegimeResult { status: "PASS" | "INSUFFICIENT_EVIDENCE" | "DATA_UNAVAILABLE"; label: RegimeLabel | null; features: RegimeFeatures | null; reason: string }
function valid(c:RegimeCandle):boolean{return [c.high,c.low,c.close].every(Number.isFinite)&&c.high>=c.low}
function mean(a:readonly number[]):number{return a.reduce((s,x)=>s+x,0)/a.length}
/** Causal latest closed-bar regime. Full configured lookback is required. */
export function detectRegime(input:readonly RegimeCandle[],cfg:RegimeConfig=DEFAULT_REGIME_CONFIG):RegimeResult{
 const bars=input.filter(b=>b.complete!==false);
 if(bars.some(b=>!valid(b)))return{status:"DATA_UNAVAILABLE",label:null,features:null,reason:"INVALID_CANDLE"};
 if(cfg.atrPeriod<1||cfg.adxPeriod<2||cfg.volatilityWindow<2||cfg.efficiencyPeriod<1||cfg.lowVolPercentile<0||cfg.highVolPercentile>1||cfg.lowVolPercentile>=cfg.highVolPercentile)return{status:"DATA_UNAVAILABLE",label:null,features:null,reason:"INVALID_CONFIG"};
 const need=Math.max(cfg.volatilityWindow+cfg.atrPeriod,cfg.adxPeriod*2+1,cfg.efficiencyPeriod+1);
 if(bars.length<need)return{status:"INSUFFICIENT_EVIDENCE",label:null,features:null,reason:"WARMUP"};
 const trs:number[]=[],plus:number[]=[],minus:number[]=[];
 for(let i=1;i<bars.length;i++){const c=bars[i],p=bars[i-1],up=c.high-p.high,down=p.low-c.low;trs.push(Math.max(c.high-c.low,Math.abs(c.high-p.close),Math.abs(c.low-p.close)));plus.push(up>down&&up>0?up:0);minus.push(down>up&&down>0?down:0)}
 const dx:number[]=[];
 for(let end=cfg.adxPeriod-1;end<trs.length;end++){const s=end-cfg.adxPeriod+1,tr=mean(trs.slice(s,end+1)),p=mean(plus.slice(s,end+1)),m=mean(minus.slice(s,end+1));dx.push(tr===0?0:100*Math.abs(p-m)/(p+m||1))}
 const adx=dx.length<cfg.adxPeriod?NaN:mean(dx.slice(-cfg.adxPeriod));
 const atrs:number[]=[];for(let end=cfg.atrPeriod-1;end<trs.length;end++)atrs.push(mean(trs.slice(end-cfg.atrPeriod+1,end+1)));
 const atr=atrs.at(-1)??NaN,window=atrs.slice(-cfg.volatilityWindow),atrPercentile=window.length<cfg.volatilityWindow?NaN:window.filter(v=>v<=atr).length/window.length;
 const closes=bars.slice(-cfg.efficiencyPeriod-1).map(b=>b.close),path=closes.slice(1).reduce((s,c,i)=>s+Math.abs(c-closes[i]),0),efficiencyRatio=path===0?0:Math.abs(closes.at(-1)!-closes[0])/path;
 if(![adx,atr,atrPercentile,efficiencyRatio].every(Number.isFinite))return{status:"INSUFFICIENT_EVIDENCE",label:null,features:null,reason:"FEATURE_WARMUP"};
 const features={adx,atr,atrPercentile,efficiencyRatio};let label:RegimeLabel;
 if(atrPercentile>=cfg.highVolPercentile)label="HIGH_VOL";else if(atrPercentile<=cfg.lowVolPercentile)label="LOW_VOL";else if(adx>=cfg.trendAdxThreshold&&efficiencyRatio>=0.25)label="TRENDING";else if(adx<cfg.trendAdxThreshold&&efficiencyRatio<0.25)label="RANGING";else label="UNSTABLE";
 return{status:"PASS",label,features,reason:"CLASSIFIED"}
}
