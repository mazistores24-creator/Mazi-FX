-- Phase 2: market data. Bars are UTC. Money-like prices are NUMERIC.
-- Bars are keyed by (instrument, timeframe, bar_time). Upserts overwrite a forming bar
-- with its completed version. Completed bars are never overwritten.
-- No M1 row can exist: the CHECK list is the supported hierarchy.

CREATE TABLE candle_bars (
  instrument   TEXT NOT NULL,
  timeframe    TEXT NOT NULL CHECK (timeframe IN ('MN1','W1','D1','H4','H1','M30','M15','M5')),
  bar_time     TIMESTAMPTZ NOT NULL,
  open         NUMERIC(20,10) NOT NULL CHECK (open > 0),
  high         NUMERIC(20,10) NOT NULL CHECK (high > 0),
  low          NUMERIC(20,10) NOT NULL CHECK (low > 0),
  close        NUMERIC(20,10) NOT NULL CHECK (close > 0),
  complete     BOOLEAN NOT NULL,
  source       TEXT NOT NULL,
  ingested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (instrument, timeframe, bar_time),
  CHECK (high >= low)
);
CREATE INDEX candle_bars_lookup_idx ON candle_bars (instrument, timeframe, bar_time DESC);

-- Latest feed health per instrument, written by the freshness monitor.
CREATE TABLE feed_status (
  instrument    TEXT PRIMARY KEY,
  provider      TEXT NOT NULL,
  state         TEXT NOT NULL CHECK (state IN ('FRESH','STALE','NO_DATA','UNSUBSCRIBED')),
  last_tick_at  TIMESTAMPTZ,
  checked_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
