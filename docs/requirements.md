# MAZZI requirements (Phase 0 consolidation)

Status: DRAFT for owner approval. Source: MAZZI V5 Ultimate master spec (PARTS 1 to 28). Defaults not stated in the spec are marked PROPOSED and are listed in open-questions.md.

## Scope decisions locked by owner
- Deriv only (synthetic indices) for the first integration.
- Deriv demo account first. No MT4/MT5 yet.
- No prop-firm profile yet (compliance engine built with a personal-account profile only).
- News calendar source: investing.com has no official free API. Feed choice is open (see open-questions.md, Q-NEWS).
- Notification channel primary: Telegram.
- Drawdown reset timezone: America/New_York (ET).
- No live trading anywhere in this phase. Demo and paper only.

## Functional requirements (FR)
FR-01 Scan configured instruments continuously (24/7 where the market is open) when infrastructure is healthy.
FR-02 Multi-timeframe hierarchy MN1, W1, D1, H4, H1, M30, M15, M5. M5 is the only mandatory execution confirmation timeframe.
FR-03 No M1 dependency anywhere (enforced by a static test on source).
FR-04 Market structure: confirmed swing highs and lows, HH/HL/LH/LL, BOS and CHoCH per documented rules.
FR-05 Breakout detection with a closed-candle rule; no entry on breakout alone.
FR-06 Fibonacci retracement levels 0, 23.6, 38.2, 50, 61.8, 78.6, 100 and extensions 127.2, 161.8, 261.8, 423.6. The 50 to 61.8 percent baseline zone is a protected constant.
FR-07 Supply and demand zones with creation, freshness and mitigation rules.
FR-08 Ichimoku 9/26/52/26 with no lookahead.
FR-09 RSI with 10 and 90 levels (protected).
FR-10 M5 confirmation: candle close beyond prior M5 swing in setup direction, expiring after 12 M5 bars.
FR-11 Setup lifecycle persisted across restarts, with defined transitions and no re-entry from terminal states.
FR-12 Alerts for all 20 stages in spec PART 7.1. A potential setup is never labelled as a confirmed signal.
FR-13 Operating modes as an enum: SCAN_ONLY, ALERT_ONLY, MANUAL_ASSIST, BACKTEST, PAPER, AUTOMATED. Only AUTOMATED with explicit live authorization may submit orders.
FR-14 Risk engine: 0.25 percent planned risk per trade, instrument-specific sizing, reject when size cannot be represented within budget.
FR-15 Drawdown limits: Day 2 percent, Swing 3 percent, Position 4 percent, enforced as hard vetoes.
FR-16 Day mode: max 4 executed (submitted counted) trades per trading day, persisted.
FR-17 Swing and Position: max 1 open trade each per account.
FR-18 Two consecutive losses pause new entries until the next trading day (ET). Existing positions still managed.
FR-19 Emergency controls with four separate actions (block entries, cancel pending entries, manage existing, close all). Close all is manual only.
FR-20 News blackout 30 minutes before and after high-impact events for news-sensitive instruments. Deriv synthetics are exempt from unrelated real-world news.
FR-21 Fail-safe: missing or stale news feed blocks new entries on news-sensitive instruments only.
FR-22 Trailing profit: activation at 1.0R, protected profit 0.25R (protected starting values).
FR-23 Quantitative layer returns PASS, FAIL, INSUFFICIENT_EVIDENCE, DATA_UNAVAILABLE or REVIEW_REQUIRED. It can only add gates; it cannot change protected rules.
FR-24 Backtesting and paper trading must be structurally incapable of submitting live orders.
FR-25 Multi-user, multi-account isolation: every business query is scoped to the owning user or account.
FR-26 Audit log for decisions, vetoes, mode changes, config changes and authorization events (append-only).
FR-27 Telegram notifications with retries, delivery attempts recorded, and CRITICAL in-app visibility on failure.

## Non-functional requirements (NFR)
NFR-01 Money values stored as NUMERIC, never floating point in persistence. In code, money is carried as decimal strings.
NFR-02 Secrets never in source, logs, notifications or error messages.
NFR-03 Config validated at startup; the process refuses to start on invalid or unapproved protected constants.
NFR-04 Deployable to a Linux VPS with PostgreSQL 16 (not the development sandbox).
NFR-05 No capacity or profitability claims without measured evidence.
NFR-06 Recovery: state in PostgreSQL, not memory. RPO and RTO are targets to be measured in Phase 10 (proposed RPO 1h, RTO 2h).

## Out of scope for Phase 0 and Phase 1
Live trading, MT4/MT5, TradingView, prop-firm profiles, real market data ingestion, strategy logic, dashboard UI, load testing.
