import { DEFAULTS } from "@mazzi/core";
import type { Decision } from "./types";

export interface NewsCalendarEvent { id: string; title: string; currencies: readonly string[]; impact: "LOW" | "MEDIUM" | "HIGH"; eventTimeUtc: string; sourceTimezone: string }
export interface NewsCalendarSnapshot { fetchedAtUtc: string; coverageStartUtc: string; coverageEndUtc: string; events: readonly NewsCalendarEvent[] }
/** Provider boundary only. Implementations may call a calendar service outside this package. */
export interface NewsCalendarProvider { fetchCalendar(nowUtc: string): Promise<NewsCalendarSnapshot> }
export interface NewsAssessment { status: "APPROVED" | "VETO"; reason: string; event?: NewsCalendarEvent }
const validTime = (value: string): number => { const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : NaN; };
const synthetic = (instrument: string): boolean => /^(SYN_|R_\d|1HZ|BOOM|CRASH|JUMP|stpRNG)/i.test(instrument);
export class NewsService {
  constructor(private readonly provider: NewsCalendarProvider, private readonly maxStaleMs = 6 * 60 * 60 * 1000, private readonly beforeMinutes = DEFAULTS.newsBlackoutMinutesBefore, private readonly afterMinutes = DEFAULTS.newsBlackoutMinutesAfter) {}
  async assess(input: { instrument: string; affectedCurrencies: readonly string[]; nowUtc: string }): Promise<NewsAssessment> {
    const now = validTime(input.nowUtc);
    if (!Number.isFinite(now)) return { status: "VETO", reason: "INVALID_AS_OF_TIME" };
    if (synthetic(input.instrument)) return { status: "APPROVED", reason: "SYNTHETIC_UNRELATED_NEWS_EXEMPT" };
    let calendar: NewsCalendarSnapshot;
    try { calendar = await this.provider.fetchCalendar(input.nowUtc); } catch { return { status: "VETO", reason: "NEWS_PROVIDER_UNAVAILABLE" }; }
    const fetched = validTime(calendar.fetchedAtUtc), start = validTime(calendar.coverageStartUtc), end = validTime(calendar.coverageEndUtc);
    if (![fetched, start, end].every(Number.isFinite) || fetched > now || now - fetched > this.maxStaleMs || now < start || now > end) {
      return { status: "VETO", reason: "NEWS_CALENDAR_STALE_BLOCK" };
    }
    for (const event of calendar.events) {
      if (event.impact !== "HIGH" || !event.currencies.some((code) => input.affectedCurrencies.includes(code))) continue;
      const eventAt = validTime(event.eventTimeUtc);
      if (!Number.isFinite(eventAt)) return { status: "VETO", reason: "INVALID_NEWS_EVENT_TIME", event };
      const from = eventAt - this.beforeMinutes * 60_000, to = eventAt + this.afterMinutes * 60_000;
      if (now >= from && now <= to) return { status: "VETO", reason: "HIGH_IMPACT_NEWS_BLACKOUT", event };
    }
    return { status: "APPROVED", reason: "NO_RELEVANT_NEWS_BLACKOUT" };
  }
  async decision(input: { instrument: string; affectedCurrencies: readonly string[]; nowUtc: string }): Promise<Decision> {
    const assessment = await this.assess(input);
    return assessment.status === "APPROVED" ? { status: "APPROVED" } : { status: "VETO", reasons: [assessment.reason] };
  }
}
