# Security model

Authentication: email and password, hashed with argon2id. Access token JWT (HS256, 15 minutes). Refresh token JWT (HS256, 7 days, type claim "refresh"). Access and refresh secrets are separate and at least 32 characters, required in production.
Authorization: every business query includes the owning user id (or account id resolved through ownership). Lookups for another user's resource return not found, not forbidden, to avoid existence leaks.
Account isolation: enforced in the store layer and tested (isolation.test.ts). PostgreSQL row-level security is planned for Phase 1b once a live database test harness is in CI.
Secrets: DERIV_TOKEN, TELEGRAM_BOT_TOKEN, JWT secrets, DATABASE_URL come from environment only. Never committed. .env is gitignored. Logs redact authorization headers, passwords, tokens and password hashes.
Least privilege: Deriv data-only token for market data. A trade-scoped token only when AUTOMATED mode is approved. No withdrawal scopes are ever requested.
Transport: TLS terminated at the VPS reverse proxy (to be configured at deployment).
Rate limiting: planned for login endpoints (Phase 1b).
Credential revocation: planned (Phase 8).
Known gaps (not yet implemented): refresh token revocation list, MFA for owner, encrypted provider credential storage (envelope encryption), CI secret scanning, dependency scanning in CI.
