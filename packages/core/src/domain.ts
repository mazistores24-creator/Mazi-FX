/** Domain types. Money and prices are decimal strings to avoid float drift. */
export type Decimal = string;

export type Direction = "LONG" | "SHORT";
export type TradeMode = "DAY" | "SWING" | "POSITION";
export type Timeframe = "MN1" | "W1" | "D1" | "H4" | "H1" | "M30" | "M15" | "M5";

export interface Candle {
  /** Bar open time, ISO-8601 UTC with a trailing Z. */
  time: string;
  open: Decimal;
  high: Decimal;
  low: Decimal;
  close: Decimal;
  timeframe: Timeframe;
  /** Platform instrument identifier or broker symbol the bar belongs to. */
  instrument: string;
  /** false while the bar is still forming. */
  complete: boolean;
}

export interface SwingPoint {
  index: number;
  price: Decimal;
  kind: "HIGH" | "LOW";
  confirmed: boolean;
}

export type SetupState =
  | "SCANNING"
  | "STRUCTURE_FOUND"
  | "ZONE_ARMED"
  | "AWAITING_M5"
  | "CONFIRMED"
  | "EXPIRED"
  | "INVALIDATED"
  | "CLOSED";

export interface NewsEvent {
  id: string;
  currency: string;
  impact: "LOW" | "MEDIUM" | "HIGH";
  eventTimeUtc: string;
  title: string;
}
