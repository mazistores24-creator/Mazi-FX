import type { Candle, Timeframe } from "@mazzi/core";

/**
 * Persistence port for bars. Upserts are idempotent on (instrument, timeframe, bar_time),
 * so a retry or a reconnect replay never duplicates a bar.
 */
export interface CandleStore {
  upsert(candles: readonly Candle[], source: string): Promise<number>;
  range(instrument: string, tf: Timeframe, fromIso: string, toIso: string): Promise<Candle[]>;
}

/** Development and test store. Mirrors the upsert semantics of the Postgres store. */
export class MemoryCandleStore implements CandleStore {
  private readonly rows = new Map<string, Candle>();

  async upsert(candles: readonly Candle[]): Promise<number> {
    for (const c of candles) this.rows.set(`${c.instrument}|${c.timeframe}|${c.time}`, c);
    return candles.length;
  }

  async range(instrument: string, tf: Timeframe, fromIso: string, toIso: string): Promise<Candle[]> {
    return [...this.rows.values()]
      .filter((c) => c.instrument === instrument && c.timeframe === tf && c.time >= fromIso && c.time <= toIso)
      .sort((a, b) => (a.time < b.time ? -1 : 1));
  }
}

/** Minimal query surface so this module does not import pg at type level. */
export interface SqlClient {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
}

/**
 * PostgreSQL candle store. Writes to the candle_bars table from migration 002.
 * Bar times are timestamptz and are stored in UTC. A forming bar (complete = false)
 * is overwritten by its later completed version, never the other way round.
 */
export class PgCandleStore implements CandleStore {
  constructor(private readonly db: SqlClient) {}

  async upsert(candles: readonly Candle[], source: string): Promise<number> {
    if (candles.length === 0) return 0;
    const cols = 10;
    const values: string[] = [];
    const params: unknown[] = [];
    candles.forEach((c, i) => {
      const b = i * cols;
      values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10})`);
      params.push(c.instrument, c.timeframe, c.time, c.open, c.high, c.low, c.close, c.complete, source, new Date().toISOString());
    });
    await this.db.query(
      `INSERT INTO candle_bars (instrument, timeframe, bar_time, open, high, low, close, complete, source, ingested_at)
       VALUES ${values.join(",")}
       ON CONFLICT (instrument, timeframe, bar_time) DO UPDATE SET
         open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low, close = EXCLUDED.close,
         complete = EXCLUDED.complete, source = EXCLUDED.source, ingested_at = EXCLUDED.ingested_at
       WHERE candle_bars.complete = FALSE`,
      params,
    );
    return candles.length;
  }

  async range(instrument: string, tf: Timeframe, fromIso: string, toIso: string): Promise<Candle[]> {
    const res = await this.db.query(
      `SELECT instrument, timeframe, to_char(bar_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS time,
              open::text, high::text, low::text, close::text, complete
         FROM candle_bars
        WHERE instrument = $1 AND timeframe = $2 AND bar_time BETWEEN $3 AND $4
        ORDER BY bar_time ASC`,
      [instrument, tf, fromIso, toIso],
    );
    return res.rows as Candle[];
  }
}
