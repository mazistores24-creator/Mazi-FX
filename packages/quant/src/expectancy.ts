import { TradeRecordSchema, type ExpectancyOptions, type ExpectancyResult, type TradeRecord } from "./types";
function rng(seed:number):()=>number { let s=seed>>>0; return ()=>{s+=0x6D2B79F5;let t=s;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296}; }
function quantile(sorted:number[],q:number):number {const x=(sorted.length-1)*q,lo=Math.floor(x),hi=Math.ceil(x);return sorted[lo]+(sorted[hi]-sorted[lo])*(x-lo)}
function wilson(w:number,n:number):{lower:number;upper:number}{const z=1.959963984540054,p=w/n,d=1+z*z/n,m=(p+z*z/(2*n))/d,h=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;return{lower:Math.max(0,m-h),upper:Math.min(1,m+h)}}
export interface ExpectancyMetadata {dataSource:string;costAssumptions:string;evaluation:ExpectancyResult["evaluation"]}
/** Empirical net-R expectancy and percentile bootstrap CI. Default is 10,000 seeded resamples. */
export function estimateExpectancy(input:readonly TradeRecord[],metadata:ExpectancyMetadata,options:ExpectancyOptions={}):ExpectancyResult{
 const trades=input.map(t=>TradeRecordSchema.parse(t)),n=trades.length,base={tradeCount:n,dateRange:n?{start:trades.map(t=>t.openedAt).sort()[0],end:trades.map(t=>t.closedAt).sort().at(-1)!}:null,instruments:[...new Set(trades.map(t=>t.instrument))].sort(),dataSource:metadata.dataSource,costAssumptions:metadata.costAssumptions,evaluation:metadata.evaluation};
 const empty=(status:ExpectancyResult["status"]):ExpectancyResult=>({...base,status,expectancyR:null,confidenceInterval:null,winRate:null,winRateInterval:null});
 if(trades.some(t=>t.netR===undefined))return empty("DATA_UNAVAILABLE");if(n<30)return empty("INSUFFICIENT_EVIDENCE");
 const values=trades.map(t=>t.netR!),avg=values.reduce((s,v)=>s+v,0)/n,wins=values.filter(v=>v>0).length,winRate=wins/n,resamples=options.resamples??10_000,level=options.confidenceLevel??.95,seed=options.seed??0x4d415a5a;
 if(!Number.isInteger(resamples)||resamples<1||!(level>0&&level<1))return empty("DATA_UNAVAILABLE");
 const random=rng(seed),means=new Array<number>(resamples);for(let r=0;r<resamples;r++){let sum=0;for(let j=0;j<n;j++)sum+=values[Math.floor(random()*n)];means[r]=sum/n}means.sort((a,b)=>a-b);
 const alpha=(1-level)/2,status:ExpectancyResult["status"]=n<100?"INSUFFICIENT_EVIDENCE":"PASS";
 return{...base,status,expectancyR:avg,confidenceInterval:{lower:quantile(means,alpha),upper:quantile(means,1-alpha)},winRate,winRateInterval:wilson(wins,n)}
}
