     1|     1|# MAZZI (Phase 0 and Phase 1)
     2|     2|
     3|     3|Trading intelligence platform. Phase 1 is the foundation: domain constants, config, auth, a Deriv demo connection skeleton, and the Postgres schema. There is no strategy logic yet and no live or execution path. Scan, alert, and paper modes have no route to the broker.
     4|     4|
     5|     5|## Setup
     6|     6|
     7|     7|1. Install Node 20 or newer.
     8|     8|2. From this folder run `npm install`.
     9|     9|3. Copy `.env.example` to `.env` and fill in the values you have (see below).
    10|    10|4. Start Postgres with `docker compose up -d postgres`, then run `npm run migrate -w apps/server`.
    11|    11|5. Start the server with `npm run dev -w apps/server`. Health check: `GET /health/live`, readiness: `GET /health/ready`.
    12|    12|6. Run checks with `npm run typecheck`, `npm run lint`, `npm test`.
    13|    13|
    14|    14|## Env vars the owner must supply
    15|    15|
    16|    16|DATABASE_URL: the Postgres connection string. Defaults to the docker compose instance.
    17|    17|DERIV_APP_ID: your Deriv app id (numeric). Create one in the Deriv API dashboard.
    18|    18|DERIV_TOKEN: a Deriv demo API token. Demo only. Never commit it.
    19|    19|TELEGRAM_BOT_TOKEN: needed in Phase 5 for alerts. Not used yet.
    20|    20|JWT_ACCESS_SECRET and JWT_REFRESH_SECRET: at least 32 characters each. Generate random values for any real deployment.
    21|    21|
    22|    22|## Layout
    23|    23|
    24|    24|apps/server: Fastify API, auth, config (zod), pino logging.
    25|    25|packages/core: domain types and protected constants (zone 50 to 61.8, RSI 10/90, risk 0.25%, drawdown limits).
    26|    26|packages/strategy: interfaces only. Real logic arrives in Phase 3.
    27|    27|packages/deriv-adapter: market-data port and a Deriv WebSocket connection skeleton.
    28|    28|db/migrations: PostgreSQL schema. All keys are UUID, all money is NUMERIC.
    29|    29|docs: Phase 0 specification set.
    30|    30|test: static checks (no M1 reference, no execution wiring in server or strategy).
    31|    31|
    32|    32|## Notes
    33|    33|
    34|    34|No real Deriv or Telegram calls are made by the test suite. Database-backed tests need a running Postgres and are not part of the default run.
    35|
    36|## Phase 7: backtesting and paper trading
    37|
    38|`packages/backtest` replays complete Phase 2 H4, D1, and M5 candle snapshots through the Phase 3 as-of strategy engine. It retains pre-window candles for indicator warmup while opening trades only inside the requested UTC interval. Confirmed setups pass Phase 5 position sizing, drawdown, consecutive-loss pause, and optional injected risk gates before a simulated fill. Stop exits use candle highs/lows, configurable R-denominated costs, and risk-based position sizes. Results include closed trades, rejected setups, win/loss and drawdown statistics, candle quality reports, and `expectancyTrades` with the Phase 4 `TradeRecord` shape.
    39|
    40|Paper trading consumes the same strategy and risk logic through an injected demo-candle source. Its append-only in-memory paper ledger records simulated entry and stop-exit events only. It has no broker execution dependency or real order path. Tests use deterministic candle fixtures and local fakes, with no live network access. Historical data can be supplied directly or through the `CandleStore` port; persistence/provider implementations are left to the application runtime.
    41|
    42|    35|
    43|    36|## Phase 2: market-data foundation (what changed)
    44|    37|
    45|    38|Public Deriv market data only. No authenticated Deriv calls and no order submission. Phase 2 adds:
    46|    39|
    47|    40|- Provider port interfaces in packages/core (MarketDataProvider, HistoricalDataProvider, InstrumentSpecProvider, BrokerExecutionProvider, plus provider connection status). The execution port is declared but nothing implements it.
    48|    41|- Candle and timeframe service in packages/core: UTC-aligned buckets, tick aggregation, incomplete-bar flagging, gap detection (gaps are reported, never filled), duplicate removal, and higher-timeframe aggregation (W1, MN1) from D1 bars.
    49|    42|- Deriv adapter (packages/deriv-adapter): WebSocket connection with keepalive, exponential backoff with jitter, and resubscribe after reconnect. Active symbol discovery and normalization to canonical instruments (R_10 to R_100, 1HZ variants, BOOM, CRASH, JUMP, stpRNG). Unknown symbols keep a DERIV_ prefix. Historical fetch via ticks_history.
    50|    43|- Server pipeline (apps/server/src/pipeline): subscription manager (ref-counted dedupe, token-bucket rate limit, bounded concurrency, refusal on overflow), hot candle cache, candle store (Postgres upsert via migration 002), staleness monitor, and GET /health/feeds.
    51|    44|- Migration 002_market_data.sql adds candle_bars and feed_status tables. A down migration is included. Migrations have not been run against a live database in this sandbox.
    52|    45|
    53|    46|Feed states: FRESH, STALE, NO_DATA (never received a tick, which is not the same as fresh), UNSUBSCRIBED.
    54|    47|
    55|    48|Timeframes: MN1, W1, D1, H4, H1, M30, M15, M5. M1 is not supported and must not appear in code or in strategy dependencies (a static test enforces this).
    56|    49|
    57|    50|Env vars that matter now:
    58|    51|- DERIV_APP_ID: numeric demo app id. Must be digits only.
    59|    52|- DERIV_WS_ENDPOINT: defaults to wss://ws.derivws.com. Only wss://ws.derivws.com is accepted.
    60|    53|- DATABASE_URL: needed for candle persistence. Without it, the hot cache still works.
    61|    54|- DERIV_TOKEN: not used in Phase 2 (public market data only).
    62|    55|
    63|    56|
    64|    57|## Phase 4: quant intelligence
    65|    58|
    66|    59|`packages/quant` is a read-only filter and reporting layer over complete market candles and Phase 3 setup decisions. It provides H4 regime features (ADX(14), ATR(14) trailing percentile, and 20-bar efficiency ratio), a documented unweighted checklist (including the proposed 0.5 x ATR stop floor and 0.15 x ATR spread ceiling), exact historical grouping, and empirical net-R expectancy with deterministic 10,000-resample percentile bootstrap intervals by default. Win-rate intervals use Wilson's method. Estimates and win rates are withheld below 30 trades; categories below 100 trades remain marked `INSUFFICIENT_EVIDENCE`. Missing net-R observations are not imputed. Every expectancy report requires data-source, cost-assumption, and evaluation-window metadata. The quant layer does not modify protected strategy inputs, make execution calls, or represent checklist scores as win probabilities.
    67|    60|
    68|
    69|## Phase 5: risk and compliance
    70|
    71|`packages/risk` provides pure risk checks and injectable persistence/provider ports. Position sizing applies the protected 0.25% budget, requires complete instrument sizing terms, rounds down to volume step, and vetoes below-minimum or over-budget sizes. Risk reservations prevent active planned risk from being double-committed across modes. Drawdown checks include conservative current equity and costs against the mode cap and account cap; ET dates are derived using the protected reset timezone. Trade counters count at submission and only release a confirmed reject/cancel without fill. Consecutive closed losses pause their mode through the next ET trading-day boundary.
    72|
    73|## Phase 6: scanning and alerts
    74|
    75|`packages/scanner` provides a resumable 24/7 scan coordinator. It consumes Phase 2 feed snapshots and refuses incomplete, stale, or unavailable feeds before evaluating Phase 3 setups. Alerts require confirmed strategy gates and an approved Phase 5 risk, compliance, news, emergency, sizing, and drawdown result. A persisted cursor, delivery ledger, pending-alert record, dedup retention, and per-instrument/direction cooldown support recovery and duplicate suppression. Telegram is accessed through an injectable sender port; tests use a deterministic fake and never make network calls. The production Telegram sender is constructed only by the server runtime when bot credentials and recipient configuration are present. This phase sends notifications only and does not submit or execute orders.
    76|
    77|
## Phase 8: Deriv demo execution and reconciliation

`packages/deriv-adapter` implements the core `BrokerExecutionProvider` through an injectable Deriv request transport. Orders are only permitted when both `environment: DEMO` and `enabled: true` are explicitly configured, and the injected connection must also identify as DEMO. Every submission must pass the injected Phase 5 risk, compliance, news, emergency, sizing, and drawdown gates. Submission is idempotent on `clientOrderId`; the pending order is persisted before sending, and ambiguous submissions remain pending rather than being resubmitted blindly. Reconciliation polls open contract state and persists `PENDING`, `FILLED`, or `REJECTED`. The package includes a memory state store for tests and a state-store port for durable runtime persistence. The Deriv protocol adapter itself has no direct socket dependency and receives an injectable request port. Tests use deterministic fakes only, with no live broker calls. No MT5 adapter or live execution path is included.

## Phase 9: read-only dashboard

Phase 9 adds a lightweight single-page control room at `/` and an authenticated `GET /api/dashboard` snapshot endpoint. The page uses the existing `/auth/login` flow and keeps its access token in session storage. The API combines the existing `/health/feeds` feed-health states with injected read-only snapshots for scanner setups, risk controls, paper and backtest performance (including expectancy), and Phase 8 demo execution reconciliation. The page refreshes every 30 seconds and offers no order placement, modification, or cancellation actions.

Dashboard providers are wired as read-only adapters to scanner, risk, paper/backtest, and execution package snapshots. The route retains bearer authentication and tests continue to use local fakes with no live network calls.

## Historical replay

`npm run replay:deriv -- --from 2025-01-01 --to 2025-12-31 --symbol frxEURUSD` fetches public Deriv H4, D1, and M5 candles in bounded chunks and runs the existing offline replay. Set `DERIV_APP_ID` to a numeric application id. This uses no account authorization or Deriv token and never submits orders. The report records assumptions and candle gaps. EURUSD tick value, account-currency conversion, and historical spread, commission, slippage, and swap are not inferred from price candles, so position sizing is vetoed until independently verified sizing inputs and cost assumptions are supplied.

## Phase 10: production readiness

Phase 10 adds a source-level security review and a readiness checklist at `docs/production-readiness.md`, an offline-first PostgreSQL schema backup/restore drill at `scripts/postgres-restore-drill.sh`, plus deterministic CPU-only load and endurance scripts at `scripts/offline-load.mjs` and `scripts/offline-endurance.mjs`. Database execution in the restore drill requires explicit opt-in and a localhost URL. The offline scripts make no service calls and do not establish production capacity. Live Deriv demo connectivity, real Telegram token delivery, and live PostgreSQL migrations/backup/restore remain unverified; see the checklist for the full release gate and security gaps.
