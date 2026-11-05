import { RISK_LIMITS } from "@mazzi/core";
import type { Decision, SizingInput, SizingResult } from "./types";

const veto = (reason: string, budget: number): SizingResult => ({ status: "VETO", reason, riskBudget: budget, volume: null, plannedRisk: null });
const finitePositive = (n: number): boolean => Number.isFinite(n) && n > 0;

/** Risk-based sizing, rounded down only. It does not read prior P&L or raise baseline risk. */
export function calculatePositionSize(input: SizingInput): SizingResult {
  const budget = Number.isFinite(input.equity) && input.equity > 0 ? input.equity * RISK_LIMITS.riskPerTradePct / 100 : 0;
  const { instrument } = input;
  if (!finitePositive(input.equity) || !finitePositive(input.entry) || !finitePositive(input.stop)) return veto("INVALID_INPUT", budget);
  if (!finitePositive(input.accountCurrencyRate ?? NaN)) return veto("CURRENCY_CONVERSION_MISSING", budget);
  const distance = Number(Math.abs(input.entry - input.stop).toPrecision(12));
  if (!finitePositive(distance)) return veto("INVALID_STOP_DISTANCE", budget);
  const tickSize = Number(instrument.tickSize);
  const tickValue = Number(instrument.tickValue);
  const step = input.volumeRules.step;
  const min = input.volumeRules.minimum;
  const max = input.volumeRules.maximum;
  if (![tickSize, tickValue, step, min, max].every(finitePositive)) return veto("INSTRUMENT_SPEC_MISSING", budget);
  const raw = budget / ((distance / tickSize) * tickValue * input.accountCurrencyRate!);
  const volume = Math.floor((raw + Number.EPSILON) / step) * step;
  const precision = Math.min(12, Math.max(0, (String(step).split(".")[1] ?? "").length));
  const rounded = Number(volume.toFixed(precision));
  if (rounded < min) return veto("BELOW_MIN_VOLUME", budget);
  if (rounded > max) return veto("ABOVE_MAX_VOLUME", budget);
  const plannedRisk = (distance / tickSize) * tickValue * rounded * input.accountCurrencyRate!;
  if (plannedRisk > budget + Math.max(1e-10, budget * 1e-10)) return veto("ROUNDED_RISK_EXCEEDS_BUDGET", budget);
  return { status: "APPROVED", reason: "SIZE_OK", riskBudget: budget, volume: rounded, plannedRisk };
}

export interface ReservationStore {
  getActive(accountId: string): Promise<readonly ReservationRecord[]>;
  insert(record: ReservationRecord): Promise<void>;
  transition(id: string, state: "CONVERTED" | "RELEASED"): Promise<void>;
}
export interface ReservationRecord { id: string; accountId: string; mode: "DAY" | "SWING" | "POSITION"; amount: number; state: "RESERVED" | "CONVERTED" | "RELEASED" }

/** In-memory implementation is useful for simulations; production persistence must be atomic. */
export class MemoryReservationStore implements ReservationStore {
  private readonly records = new Map<string, ReservationRecord>();
  async getActive(accountId: string): Promise<readonly ReservationRecord[]> { return [...this.records.values()].filter((r) => r.accountId === accountId && r.state === "RESERVED"); }
  async insert(record: ReservationRecord): Promise<void> { if (this.records.has(record.id)) throw new Error("RESERVATION_ID_EXISTS"); this.records.set(record.id, { ...record }); }
  async transition(id: string, state: "CONVERTED" | "RELEASED"): Promise<void> {
    const record = this.records.get(id);
    if (!record || record.state !== "RESERVED") throw new Error("RESERVATION_NOT_ACTIVE");
    this.records.set(id, { ...record, state });
  }
}

export class RiskReservations {
  constructor(private readonly store: ReservationStore) {}
  async reserve(record: Omit<ReservationRecord, "state">, equity: number): Promise<Decision> {
    if (!record.id || !record.accountId || !finitePositive(record.amount) || !finitePositive(equity)) return { status: "VETO", reasons: ["INVALID_RESERVATION"] };
    const active = await this.store.getActive(record.accountId);
    const committed = active.reduce((sum, item) => sum + item.amount, 0);
    if (committed + record.amount > equity * RISK_LIMITS.riskPerTradePct / 100 + 1e-10) return { status: "VETO", reasons: ["RISK_BUDGET_RESERVED"] };
    await this.store.insert({ ...record, state: "RESERVED" });
    return { status: "APPROVED" };
  }
  convertOnFill(id: string): Promise<void> { return this.store.transition(id, "CONVERTED"); }
  releaseOnRejectOrCancel(id: string): Promise<void> { return this.store.transition(id, "RELEASED"); }
}
