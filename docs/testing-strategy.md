# Testing strategy

Framework: vitest. Run with npm test. Typecheck with npm run typecheck. Lint with npm run lint.
Layers: unit (pure logic and constants), integration (HTTP via Fastify inject), isolation (cross-account), static (no M1 in source), database (migration apply and rollback, requires a live PostgreSQL; a harness is planned).

Phase 1 pinned tests: protected constants, mode execution rules, drawdown math, config validation, auth flow, cross-account isolation, health endpoints, Deriv adapter URL and redaction.

Scenario tests from spec PART 23 are mapped in the Phase 3 to Phase 5 plan. Phase 1 covers only items that exist: no M1 dependency (static), scan-only and alert-only never submit (unit on mode rules), a 0.25 percent planned risk constant (unit), account isolation (integration).

Rule: a test that passes but tests nothing real is not evidence. Skipped tests are reported as skipped.
