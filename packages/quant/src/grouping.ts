import { TradeRecordSchema, type TradeRecord } from "./types";
export type HistoricalGroupField = "instrument" | "mode" | "direction" | "regime" | "session" | `structuralFeatures.${string}`;
export interface HistoricalGroup { key: string; fields: Partial<Record<HistoricalGroupField, string | number | boolean>>; trades: TradeRecord[] }
/** Exact deterministic grouping. Feature definitions should be selected on training data only. */
export function groupHistoricalTrades(input: readonly TradeRecord[], by: readonly HistoricalGroupField[]): HistoricalGroup[] {
  if (by.length === 0) throw new RangeError("at least one grouping field is required");
  const groups = new Map<string, HistoricalGroup>();
  for (const trade of input.map((item) => TradeRecordSchema.parse(item))) {
    const fields: HistoricalGroup["fields"] = {};
    for (const field of by) {
      const value = field.startsWith("structuralFeatures.") ? trade.structuralFeatures[field.slice("structuralFeatures.".length)] : trade[field as keyof TradeRecord];
      if (value !== undefined) fields[field] = value as string | number | boolean;
    }
    const key = by.map((field) => `${field}=${JSON.stringify(fields[field] ?? null)}`).join("|");
    const existing = groups.get(key);
    if (existing) existing.trades.push(trade); else groups.set(key, { key, fields, trades: [trade] });
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
}
