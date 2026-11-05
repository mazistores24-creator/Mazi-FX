# Roadmap (from spec PART 24, with realistic phase gates)

Phase 0 Requirements and architecture: this document set. Exit: owner approves defaults in open-questions.md.
Phase 1 Project foundation: monorepo, config, logging, auth, migrations, core types, health, test framework. Exit: typecheck, lint and tests pass; migrations applied to a live PostgreSQL 16 (pending, see README).
Phase 2 Market-data foundation: Deriv adapter (candles, active symbols, reconnect), candle store, gap detection, freshness monitor.
Phase 3 Technical strategy: swings, BOS, CHoCH, breakout, Fibonacci zone, supply and demand, Ichimoku, RSI, M5 confirmation, setup lifecycle.
Phase 4 Quant intelligence: regime, checklist scoring, historical grouping, expectancy with bootstrap CI.
Phase 5 Risk and compliance: sizing, reservations, drawdown trackers, trade counters, two-loss pause, news service, compliance profiles, emergency controls.
Phase 6 Scanning and alerts: 24/7 orchestration, Telegram delivery, dedup, cooldowns, recovery.
Phase 7 Backtesting and paper trading.
Phase 8 Execution: Deriv demo order path with reconciliation. MT5 only with owner approval.
Phase 9 Dashboard.
Phase 10 Production readiness: security review, restore drill, load and endurance tests, live-readiness report.
Estimated 5 to 7 months part-time (proposal, revised after Phase 2).
