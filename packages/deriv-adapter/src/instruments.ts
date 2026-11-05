import type { InstrumentCategory, InstrumentDefinition } from "@mazzi/core";

/** Fields used from Deriv active_symbols (product_type "basic", full). Unknown fields are ignored. */
export interface DerivActiveSymbol {
  symbol: string;
  display_name?: string;
  market?: string;
  submarket?: string;
  pip?: number;
  exchange_is_open?: number | boolean;
  is_trading_suspended?: number | boolean;
}

/**
 * Maps Deriv synthetic symbols to the canonical platform id and family.
 * Returns undefined for anything not recognised here. Unknown symbols are still
 * kept, with a DERIV_ prefix and no family.
 */
export function mapDerivSymbol(symbol: string): { canonicalId: string; family: string } | undefined {
  let m: RegExpExecArray | null;
  if ((m = /^R_(10|25|50|75|100)$/.exec(symbol))) return { canonicalId: `SYN_RNG_VOL_${m[1]}`, family: "VOLATILITY" };
  if ((m = /^1HZ(10|25|50|75|100)V$/.exec(symbol))) return { canonicalId: `SYN_RNG_VOL_1S_${m[1]}`, family: "VOLATILITY_1S" };
  if ((m = /^BOOM(300|500|1000)N?$/.exec(symbol))) return { canonicalId: `SYN_BOOM_${m[1]}`, family: "BOOM_CRASH" };
  if ((m = /^CRASH(300|500|1000)N?$/.exec(symbol))) return { canonicalId: `SYN_CRASH_${m[1]}`, family: "BOOM_CRASH" };
  if ((m = /^JD(10|25|50|75|100)$/.exec(symbol))) return { canonicalId: `SYN_JUMP_${m[1]}`, family: "JUMP" };
  if (symbol === "stpRNG") return { canonicalId: "SYN_STEP_100", family: "STEP" };
  return undefined;
}

function categoryFromMarket(market: string | undefined): InstrumentCategory {
  switch (market) {
    case "synthetic_index":
      return "SYNTHETIC";
    case "forex":
      return "FOREX";
    case "commodities":
      return "COMMODITY";
    case "stocks_indices":
      return "INDEX";
    case "cryptocurrency":
      return "CRYPTO";
    default:
      return "OTHER";
  }
}

/**
 * Converts a numeric pip size to an exact decimal string and its decimal count.
 * Avoids float artefacts such as 0.1 + 0.2 by fixing to 10 places first.
 */
export function pipToTickSize(pip: unknown): { tickSize: string; pipDecimals: number } | undefined {
  if (typeof pip !== "number" || !Number.isFinite(pip) || pip <= 0) return undefined;
  const s = pip.toFixed(10).replace(/0+$/, "").replace(/\.$/, "");
  const decimals = s.includes(".") ? (s.split(".")[1] ?? "").length : 0;
  return { tickSize: s, pipDecimals: decimals };
}

function truthy(v: unknown): boolean {
  return v === true || v === 1 || v === "1";
}

/**
 * Normalises one active_symbols entry. Stake limits and tick value are not
 * supplied by discovery, so they stay null. Nothing is guessed.
 */
export function normalizeActiveSymbol(entry: DerivActiveSymbol, providerId: string): InstrumentDefinition | undefined {
  if (typeof entry.symbol !== "string" || entry.symbol.length === 0) return undefined;
  const symbol = entry.symbol;
  const mapped = mapDerivSymbol(symbol);
  const pip = pipToTickSize(entry.pip);
  const suspended = truthy(entry.is_trading_suspended);
  const closed = entry.exchange_is_open !== undefined && !truthy(entry.exchange_is_open);
  return {
    canonicalId: mapped?.canonicalId ?? `DERIV_${symbol.toUpperCase()}`,
    providerId,
    brokerSymbol: symbol,
    displayName: entry.display_name ?? symbol,
    category: mapped ? "SYNTHETIC" : categoryFromMarket(entry.market),
    family: mapped?.family ?? null,
    tickSize: pip?.tickSize ?? null,
    pipDecimals: pip?.pipDecimals ?? null,
    tickValue: null,
    minStake: null,
    maxStake: null,
    tradingAvailable: !suspended && !closed,
    tradingUnavailableReason: suspended ? "trading suspended" : closed ? "market closed" : null,
  };
}

/** Normalises a whole active_symbols list. Duplicates by canonical id keep the first entry. */
export function normalizeActiveSymbols(list: readonly DerivActiveSymbol[], providerId: string): InstrumentDefinition[] {
  const seen = new Set<string>();
  const out: InstrumentDefinition[] = [];
  for (const entry of list) {
    const def = normalizeActiveSymbol(entry, providerId);
    if (!def || seen.has(def.canonicalId)) continue;
    seen.add(def.canonicalId);
    out.push(def);
  }
  return out;
}
