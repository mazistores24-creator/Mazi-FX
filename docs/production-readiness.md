# Production readiness: Phase 10

## Scope and evidence

This is a source-level security review and offline operational drill plan. The default test suite, synthetic load script, synthetic endurance script, and restore-drill planning mode use deterministic local inputs. No live service was contacted for this phase.

The dashboard API remains behind the existing access-token verification and user lookup. Dashboard providers are read-only package snapshot adapters. Tests inject local providers. There is no new broker order path, dashboard mutation route, or direct network client in the dashboard provider adapter.

## Security review pass

Reviewed the documented security model, HTTP auth and dashboard route, runtime provider adapters, migration runner, and operational scripts. Current controls include argon2id password hashing, separate short-lived access and refresh JWT secrets, bearer-authenticated dashboard and account routes, user ownership checks, environment-based secrets, log redaction, restrictive demo execution interlocks, and tests guarding no M1 and no execution wiring in strategy/server. The restore drill refuses non-local connection URLs and requires an explicit opt-in before database commands.

Findings carried forward from `docs/security-model.md`:

- Refresh-token revocation is not implemented.
- Owner MFA is not implemented.
- Provider credentials are not envelope-encrypted at rest.
- CI secret scanning and dependency scanning are not configured.
- Login rate limiting and PostgreSQL row-level security remain Phase 1b work.
- TLS termination at the production reverse proxy is a deployment task, not verified here.
- A durable PostgreSQL-backed identity and execution runtime is not active in this repository's default server entry point.

These are readiness gaps, not claims of a penetration test or external audit. No independent security assessor or production deployment was used.

## Backup and restore drill

Run `bash scripts/postgres-restore-drill.sh` for the offline plan. It enumerates forward migration files and describes the restore sequence without accessing a database. The guarded execution mode is explicitly opt-in and only accepts localhost URLs:

`MAZZI_RESTORE_DRILL_EXECUTE=1 DATABASE_URL=postgres://localhost/mazzi_drill bash scripts/postgres-restore-drill.sh`

Execution requires local PostgreSQL utilities (`pg_dump`, `pg_restore`, `createdb`, `dropdb`), takes a schema-only custom-format backup, creates a uniquely named temporary database, restores the schema, verifies the backup checksum, and drops the temporary database on exit. This phase ran planning mode only. A live restore was not executed or verified.

## Offline load and endurance scripts

`node scripts/offline-load.mjs` runs a deterministic synthetic workload, default 25,000 records, and prints a checksum and local throughput observation. Use `MAZZI_LOAD_ITERATIONS` for a bounded run up to 1,000,000 records.

`node scripts/offline-endurance.mjs` runs a deterministic CPU-only soak, default five seconds, and reports operations, checksum, and tick p95. Configure `MAZZI_ENDURANCE_SECONDS` (1 to 3,600) and `MAZZI_ENDURANCE_OPS_PER_TICK` (1 to 1,000,000). Neither script makes network requests, models broker latency, or establishes production capacity or SLOs. Timings depend on the local machine and are diagnostic only.

## Exact unverified production items

- Live Deriv demo connection and demo-account behavior: unverified. No Deriv connection was made.
- Real Telegram bot token and message delivery: unverified. No Telegram credential or service was used.
- Live PostgreSQL connectivity, migrations, row-level security, backup, and restore: unverified. No Postgres connection was made.

## Release gate

Before production use, verify those three live integrations in their intended isolated environments, perform and record a real PostgreSQL backup/restore drill, close or explicitly accept the security gaps above, configure TLS and monitoring, and review the production secrets/deployment configuration. The offline checks in this phase are not approval to enable live trading.
