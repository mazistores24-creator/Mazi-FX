-- MAZZI schema, PostgreSQL 16. All primary keys UUID. All money NUMERIC.
-- Append-only tables: setup_transitions, order_events, audit_logs.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'OWNER' CHECK (role IN ('OWNER','ADMIN','TRADER','VIEWER','AUDITOR')),
  status        TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_email_lower_unique UNIQUE (email)
);
CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email));

CREATE TABLE accounts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name           TEXT NOT NULL,
  account_type   TEXT NOT NULL DEFAULT 'PERSONAL' CHECK (account_type IN ('PERSONAL','PROP','FUND','MANAGED','OTHER')),
  base_currency  CHAR(3) NOT NULL,
  status         TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','CLOSED')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX accounts_owner_idx ON accounts (owner_user_id);

CREATE TABLE broker_connections (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider         TEXT NOT NULL CHECK (provider IN ('DERIV','MT5')),
  environment      TEXT NOT NULL CHECK (environment IN ('DEMO','LIVE')),
  credential_ref   TEXT,
  status           TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CONNECTED','REVOKED','ERROR')),
  scopes_granted   TEXT[] NOT NULL DEFAULT '{}',
  last_verified_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, provider, environment)
);

CREATE TABLE instruments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_id TEXT NOT NULL UNIQUE,
  category     TEXT NOT NULL CHECK (category IN ('FOREX','METAL','COMMODITY','INDEX','SYNTHETIC','CRYPTO','OTHER')),
  news_sensitive BOOLEAN NOT NULL DEFAULT TRUE,
  active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE instrument_provider_map (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id         UUID NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  broker_connection_id  UUID NOT NULL REFERENCES broker_connections(id) ON DELETE CASCADE,
  broker_symbol         TEXT NOT NULL,
  tick_size             NUMERIC(20,10) NOT NULL CHECK (tick_size > 0),
  tick_value            NUMERIC(20,8)  NOT NULL CHECK (tick_value > 0),
  contract_size         NUMERIC(20,8)  NOT NULL CHECK (contract_size > 0),
  volume_min            NUMERIC(20,8)  NOT NULL CHECK (volume_min > 0),
  volume_max            NUMERIC(20,8)  NOT NULL,
  volume_step           NUMERIC(20,8)  NOT NULL CHECK (volume_step > 0),
  fetched_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (instrument_id, broker_connection_id),
  CHECK (volume_max >= volume_min)
);

CREATE TABLE strategy_configs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, name)
);

CREATE TABLE strategy_config_versions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_config_id UUID NOT NULL REFERENCES strategy_configs(id) ON DELETE CASCADE,
  version           INTEGER NOT NULL CHECK (version >= 1),
  config_json       JSONB NOT NULL,
  config_hash       TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PROPOSED','APPROVED','ACTIVE','RETIRED')),
  approved_by       UUID REFERENCES users(id),
  approved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (strategy_config_id, version)
);

CREATE TABLE setups (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  instrument_id       UUID NOT NULL REFERENCES instruments(id),
  strategy_config_version_id UUID REFERENCES strategy_config_versions(id),
  mode                TEXT NOT NULL CHECK (mode IN ('SCAN_ONLY','ALERT_ONLY','MANUAL_ASSIST','BACKTEST','PAPER','AUTOMATED')),
  direction           TEXT NOT NULL CHECK (direction IN ('LONG','SHORT')),
  state               TEXT NOT NULL,
  attempt             INTEGER NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  zone_high           NUMERIC(20,10),
  zone_low            NUMERIC(20,10),
  anchor_low          NUMERIC(20,10),
  anchor_high         NUMERIC(20,10),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ,
  CHECK (zone_high IS NULL OR zone_low IS NULL OR zone_high >= zone_low),
  UNIQUE (account_id, instrument_id, mode, direction, attempt)
);
CREATE INDEX setups_account_state_idx ON setups (account_id, state);

CREATE TABLE setup_transitions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  setup_id    UUID NOT NULL REFERENCES setups(id) ON DELETE RESTRICT,
  from_state  TEXT,
  to_state    TEXT NOT NULL,
  reason      TEXT NOT NULL,
  inputs_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX setup_transitions_setup_idx ON setup_transitions (setup_id, created_at);

CREATE TABLE alerts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  setup_id     UUID REFERENCES setups(id) ON DELETE SET NULL,
  alert_type   TEXT NOT NULL,
  severity     TEXT NOT NULL CHECK (severity IN ('INFO','ACTION','WARN','CRITICAL')),
  dedup_key    TEXT NOT NULL UNIQUE,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  alert_id    UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  channel     TEXT NOT NULL CHECK (channel IN ('TELEGRAM','EMAIL','WEB_PUSH','IN_APP')),
  status      TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','SENT','FAILED')),
  attempt_no  INTEGER NOT NULL DEFAULT 0 CHECK (attempt_no >= 0),
  error_code  TEXT,
  sent_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (alert_id, channel)
);

CREATE TABLE orders (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  setup_id         UUID REFERENCES setups(id),
  client_order_id  TEXT NOT NULL UNIQUE,
  broker_order_id  TEXT,
  mode             TEXT NOT NULL CHECK (mode IN ('DAY','SWING','POSITION')),
  side             TEXT NOT NULL CHECK (side IN ('BUY','SELL')),
  state            TEXT NOT NULL,
  size             NUMERIC(20,8) NOT NULL CHECK (size > 0),
  requested_price  NUMERIC(20,10),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX orders_account_idx ON orders (account_id);

CREATE TABLE order_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  from_state  TEXT,
  to_state    TEXT NOT NULL,
  source      TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE fills (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  price       NUMERIC(20,10) NOT NULL CHECK (price > 0),
  size        NUMERIC(20,8) NOT NULL CHECK (size > 0),
  commission  NUMERIC(20,8) NOT NULL DEFAULT 0,
  swap        NUMERIC(20,8) NOT NULL DEFAULT 0,
  filled_at   TIMESTAMPTZ NOT NULL,
  source      TEXT NOT NULL
);

CREATE TABLE positions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  mode            TEXT NOT NULL CHECK (mode IN ('DAY','SWING','POSITION')),
  instrument_id   UUID NOT NULL REFERENCES instruments(id),
  state           TEXT NOT NULL CHECK (state IN ('OPEN','CLOSED')),
  entry_fill_id   UUID REFERENCES fills(id),
  stop            NUMERIC(20,10),
  take_profit     NUMERIC(20,10),
  trailing_state  TEXT NOT NULL DEFAULT 'INACTIVE' CHECK (trailing_state IN ('INACTIVE','ACTIVE')),
  opened_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at       TIMESTAMPTZ,
  realized_r      NUMERIC(12,6)
);
-- At most one open SWING and one open POSITION trade per account.
CREATE UNIQUE INDEX positions_one_open_swing ON positions (account_id) WHERE mode = 'SWING' AND state = 'OPEN';
CREATE UNIQUE INDEX positions_one_open_position ON positions (account_id) WHERE mode = 'POSITION' AND state = 'OPEN';

CREATE TABLE trades (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  position_id     UUID NOT NULL UNIQUE REFERENCES positions(id) ON DELETE RESTRICT,
  mode            TEXT NOT NULL CHECK (mode IN ('DAY','SWING','POSITION')),
  gross_pnl       NUMERIC(20,8) NOT NULL,
  net_pnl         NUMERIC(20,8) NOT NULL,
  realized_r      NUMERIC(12,6),
  closed_at       TIMESTAMPTZ NOT NULL
);

CREATE TABLE risk_state (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  mode            TEXT NOT NULL CHECK (mode IN ('DAY','SWING','POSITION')),
  trading_day     DATE NOT NULL,
  consecutive_losses INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_losses >= 0),
  pause_state     TEXT NOT NULL DEFAULT 'NONE' CHECK (pause_state IN ('NONE','TWO_LOSS_PAUSE','MANUAL_HOLD')),
  pause_until     TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  version         INTEGER NOT NULL DEFAULT 0,
  UNIQUE (account_id, mode, trading_day)
);

CREATE TABLE drawdown_state (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  scope               TEXT NOT NULL CHECK (scope IN ('DAY','SWING','POSITION','ACCOUNT')),
  reset_key           TEXT NOT NULL,
  reference_equity    NUMERIC(20,8) NOT NULL CHECK (reference_equity > 0),
  current_equity      NUMERIC(20,8) NOT NULL,
  drawdown_pct        NUMERIC(10,6) NOT NULL,
  breached            BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, scope, reset_key)
);

CREATE TABLE trade_counters (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  mode          TEXT NOT NULL CHECK (mode IN ('DAY','SWING','POSITION')),
  trading_day   DATE NOT NULL,
  submitted     INTEGER NOT NULL DEFAULT 0 CHECK (submitted >= 0),
  released      INTEGER NOT NULL DEFAULT 0 CHECK (released >= 0),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, mode, trading_day),
  CHECK (released <= submitted)
);

CREATE TABLE compliance_profiles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  account_type  TEXT NOT NULL,
  version       INTEGER NOT NULL CHECK (version >= 1),
  rules_json    JSONB NOT NULL,
  source_url    TEXT,
  verified_at   TIMESTAMPTZ,
  verified_by   TEXT,
  status        TEXT NOT NULL DEFAULT 'UNVERIFIED' CHECK (status IN ('UNVERIFIED','VERIFIED','RETIRED')),
  UNIQUE (name, version),
  CHECK (status <> 'VERIFIED' OR (verified_at IS NOT NULL AND verified_by IS NOT NULL))
);

CREATE TABLE news_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source        TEXT NOT NULL,
  external_id   TEXT NOT NULL,
  event_time_utc TIMESTAMPTZ NOT NULL,
  source_time_zone TEXT NOT NULL,
  currency      CHAR(3) NOT NULL,
  impact        TEXT NOT NULL CHECK (impact IN ('LOW','MEDIUM','HIGH')),
  title         TEXT NOT NULL,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, external_id)
);

CREATE TABLE audit_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID REFERENCES accounts(id) ON DELETE SET NULL,
  actor_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_type      TEXT NOT NULL CHECK (actor_type IN ('USER','SYSTEM','WORKER')),
  action          TEXT NOT NULL,
  entity_type     TEXT NOT NULL,
  entity_id       TEXT,
  before_json     JSONB,
  after_json      JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_account_idx ON audit_logs (account_id, created_at);
