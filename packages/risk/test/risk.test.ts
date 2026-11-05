import { describe, expect, it } from "vitest";
import type { InstrumentDefinition } from "@mazzi/core";
import { calculatePositionSize, checkDrawdown, MemoryReservationStore, RiskReservations, MemoryCounterStore, TradeCounters, tradingDateET, evaluateLossPause, NewsService, type NewsCalendarProvider, type NewsCalendarSnapshot, validateComplianceProfile, mayEnterLive, emergencyState, emergencyEntryDecision, combineVetoes } from "../src";
const instrument: InstrumentDefinition = { canonicalId:"EURUSD", providerId:"p", brokerSymbol:"EURUSD", displayName:"EURUSD", category:"FOREX", family:null, tickSize:"0.0001", pipDecimals:4, tickValue:"1", minStake:null, maxStake:null, tradingAvailable:true, tradingUnavailableReason:null };
describe("phase 5 risk and compliance",()=>{
 it("sizes at protected risk, floors volume and vetoes below minimum",()=>{
  const volumeRules={step:0.01,minimum:0.01,maximum:100};
  const result=calculatePositionSize({equity:10000,entry:1.1,stop:1.09,accountCurrencyRate:1,instrument,volumeRules});
  expect(result.status).toBe("APPROVED"); expect(result.riskBudget).toBe(25); expect(result.volume).toBe(0.25); expect(result.plannedRisk).toBeLessThanOrEqual(25);
  expect(calculatePositionSize({equity:100,entry:1.1,stop:1.09,accountCurrencyRate:1,instrument,volumeRules}).reason).toBe("BELOW_MIN_VOLUME");
  expect(calculatePositionSize({equity:10000,entry:1.1,stop:1.09,accountCurrencyRate:1,instrument,volumeRules:{...volumeRules,step:0}}).reason).toBe("INSTRUMENT_SPEC_MISSING");
 });
 it("reserves across modes and converts or releases only active reservations",async()=>{
  const store=new MemoryReservationStore(), reservations=new RiskReservations(store);
  expect((await reservations.reserve({id:"a",accountId:"acct",mode:"DAY",amount:15},10000)).status).toBe("APPROVED");
  expect((await reservations.reserve({id:"b",accountId:"acct",mode:"SWING",amount:11},10000)).status).toBe("VETO");
  await reservations.convertOnFill("a");
  await expect(reservations.releaseOnRejectOrCancel("a")).rejects.toThrow("RESERVATION_NOT_ACTIVE");
 });
 it("applies mode and account drawdown caps to conservative equity",()=>{
  expect(checkDrawdown("DAY",{referenceEquity:10000,currentEquity:9800}).status).toBe("VETO");
  expect(checkDrawdown("SWING",{referenceEquity:10000,currentEquity:9705,additionalCosts:2}).status).toBe("APPROVED");
  expect(checkDrawdown("POSITION",{referenceEquity:10000,currentEquity:9701,additionalCosts:2},2.9).status).toBe("VETO");
 });
 it("counts submitted orders once by ET day, releasing only confirmed no-fill orders",async()=>{
  const counters=new TradeCounters(new MemoryCounterStore()), at=new Date("2026-10-29T16:00:00Z");
  expect(tradingDateET(at)).toBe("2026-10-29");
  for(let i=0;i<4;i++) expect(await counters.submitted("acct","DAY",`d${i}`,at)).toBe(true);
  expect(await counters.submitted("acct","DAY","d4",at)).toBe(false);
  expect(await counters.confirmedRejectOrCancel("acct","d0",false)).toBe(false);
  expect(await counters.confirmedRejectOrCancel("acct","d0",true)).toBe(true);
  expect(await counters.count("acct","DAY",at)).toBe(3);
 });
 it("pauses only after two most recent consecutive losses, scoped to mode",()=>{
  const now=new Date("2026-10-29T18:00:00Z");
  const outcomes=[{mode:"DAY" as const,closedAt:"2026-10-29T17:00:00Z",realizedNetPnl:-1},{mode:"DAY" as const,closedAt:"2026-10-29T16:00:00Z",realizedNetPnl:-2}];
  expect(evaluateLossPause("DAY",outcomes,now).paused).toBe(true); expect(evaluateLossPause("SWING",outcomes,now).paused).toBe(false);
  expect(evaluateLossPause("DAY",outcomes,now).resumeAtET).toBe("2026-10-30");
  expect(evaluateLossPause("DAY",[...outcomes,{mode:"DAY",closedAt:"2026-10-29T17:30:00Z",realizedNetPnl:1}],now).paused).toBe(false);
 });
 it("uses an injected deterministic news provider, blackout, staleness, and synthetic exemption",async()=>{
  const snapshot:NewsCalendarSnapshot={fetchedAtUtc:"2026-10-29T11:00:00Z",coverageStartUtc:"2026-10-29T10:00:00Z",coverageEndUtc:"2026-10-29T20:00:00Z",events:[{id:"n1",title:"rate decision",currencies:["USD"],impact:"HIGH",eventTimeUtc:"2026-10-29T12:00:00Z",sourceTimezone:"UTC"}]};
  const provider:NewsCalendarProvider={fetchCalendar:async()=>snapshot}; const news=new NewsService(provider);
  expect((await news.assess({instrument:"EURUSD",affectedCurrencies:["EUR","USD"],nowUtc:"2026-10-29T11:45:00Z"})).reason).toBe("HIGH_IMPACT_NEWS_BLACKOUT");
  expect((await news.assess({instrument:"SYN_RNG_VOL_100",affectedCurrencies:[],nowUtc:"2026-10-29T11:45:00Z"})).status).toBe("APPROVED");
  expect((await news.assess({instrument:"SYN_RNG_VOL_100",affectedCurrencies:[],nowUtc:"2026-10-29T18:01:00Z"})).status).toBe("APPROVED");
  expect((await news.assess({instrument:"EURUSD",affectedCurrencies:["USD"],nowUtc:"2026-10-29T18:01:00Z"})).reason).toBe("NEWS_CALENDAR_STALE_BLOCK");
  const failing=new NewsService({fetchCalendar:async()=>{throw new Error("offline")}}); expect((await failing.decision({instrument:"EURUSD",affectedCurrencies:["USD"],nowUtc:"2026-10-29T11:45:00Z"})).status).toBe("VETO");
 });
 it("requires fresh verified compliance and explicit automated live authorization",()=>{
  const profile={id:"p",accountType:"personal",version:"1",sourceUrl:"https://example.test/policy",verifiedAt:"2026-10-29T10:00:00Z",verifier:"owner",status:"VERIFIED" as const};
  expect(validateComplianceProfile(profile).status).toBe("APPROVED");
  expect(mayEnterLive("PAPER",profile).status).toBe("VETO");
  expect(mayEnterLive("AUTOMATED",profile,{accountId:"a",environment:"demo",authorizedAt:"2026-10-29T10:00:00Z",active:true}).status).toBe("APPROVED");
  expect(validateComplianceProfile({...profile,status:"UNVERIFIED"}).status).toBe("VETO");
 });
 it("keeps emergency actions distinct and makes any veto final",()=>{
  const state=emergencyState(["BLOCK_NEW_ENTRIES","CANCEL_PENDING_ENTRIES"],["operator stop"]);
  expect(state.manageExisting).toBe(true); expect(state.closeAllRequested).toBe(false); expect(emergencyEntryDecision(state).status).toBe("VETO");
  const manual=emergencyState(["CLOSE_ALL"]); expect(manual.blockNewEntries).toBe(true); expect(manual.closeAllRequested).toBe(true); expect(manual.manageExisting).toBe(true);
  expect(combineVetoes({status:"APPROVED"},{status:"VETO",reasons:["NEWS"]}).status).toBe("VETO");
 });
});
