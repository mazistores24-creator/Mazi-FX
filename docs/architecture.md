# Architecture

## Principles
Strategy is separated from risk and execution. Provider code sits behind adapters. Every decision is persisted and replayable. PostgreSQL is the source of truth; memory is never the only copy of risk-critical state.

## Monorepo layout
apps/server: Fastify HTTP API, auth, health, config loading, logging, DB access.
packages/core: domain types, protected constants, pure risk-limit math, operating-mode rules.
packages/strategy: interfaces only in Phase 1. Real logic arrives in Phase 3.
packages/deriv-adapter: provider interfaces and a Deriv WebSocket connection skeleton (demo).
db/migrations: ordered SQL migrations with down scripts.
docs: specifications.

## Components (target, from spec PART 18)
Instrument registry, market-data ingestion, candle service, indicator library, structure engine, setup engine, Fibonacci and supply/demand modules, Ichimoku and RSI gates, M5 confirmation, quant service, risk service, compliance service, news service, executor, trade manager, alert service, notifier, backtest and replay engine, paper engine, audit log, auth and accounts, dashboard API.

Phase 1 implements: config, logging, auth, accounts, health, migrations, core types and constants, adapter interfaces, Deriv connection skeleton.

## Mode isolation in code
The executor is constructed only for AUTOMATED mode with a live authorization record. SCAN_ONLY, ALERT_ONLY, MANUAL_ASSIST, BACKTEST and PAPER processes do not import the broker execution adapter.

## Data flow (target)
provider adapter -> candle store (closed bars only) -> candle-close event -> indicators -> structure -> setup engine (persisted transitions) -> alert service -> notifier.
At CONFIRMED: quant informational check, risk veto, compliance veto, news veto, proposal row, then (AUTOMATED only) executor pre-trade checks and submission.

## Deployment target
Single Linux VPS (2 vCPU, 4 GB as a starting point) running Docker containers: server, scanner (later), PostgreSQL 16. Redis and BullMQ are deferred until a measured need; PostgreSQL advisory locks cover single-writer needs in the meantime. Not claimed: any capacity figure without load tests.

## Local development
docker-compose runs PostgreSQL 16 and the server. Without Docker, set DATABASE_URL to any local PostgreSQL 16.
