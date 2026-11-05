# Risk and compliance specification

Status: DRAFT. Values marked PROTECTED are pinned by unit tests in packages/core.

## Planned risk (PROTECTED)
0.25 percent of account equity planned risk per trade (RISK_PER_TRADE = 0.0025).
Position size = (equity x risk) / (stop distance x value per price unit). Instrument-specific: uses tick size, tick value, contract size, volume step, min and max volume, currency conversion.
Round DOWN to volume step. If rounded size is below minimum, or risk after rounding exceeds budget, REJECT. Never round up to meet a minimum.
Planned risk is not maximum loss. Gaps and slippage can exceed it; the system logs realized risk.

## Drawdown limits (PROTECTED)
DAY 2 percent, SWING 3 percent, POSITION 4 percent. Enforced as hard vetoes.
Reference equity: start-of-reset-period equity. Unrealized losses count (conservative). Commissions and swaps count as losses. Deposits and withdrawals are excluded by ledger adjustment.
Reset: 00:00 America/New_York (ET), owner-locked timezone. Static drawdown by default.
Account-level tracker also applies; the stricter limit wins.

## Trade limits (PROTECTED)
Day mode: max 4 trades per trading day. A trade counts on order SUBMITTED. Released only on confirmed reject or cancel without fill. Persisted in trade_counters with the order write in one transaction. Never reset by restart.
Swing mode: max 1 open trade per account. Position mode: max 1 open trade per account. Enforced by a partial unique index in PostgreSQL.

## Consecutive losses (PROTECTED: 2; PROPOSED: resumption)
After 2 consecutive closed losing trades in one mode, that mode blocks new entries until the next trading day (ET). Manual resume requires a logged user action (PROPOSED). Existing positions are still managed.
Owner notified when pause starts and ends.

## No revenge trading (PROTECTED)
Position size never depends on prior P&L. No martingale, loss-recovery or progressive sizing. A winning streak does not raise baseline risk.

## Reservations (PROPOSED)
Approved proposals reserve planned risk against account equity. Reservation converts on fill and releases on reject or cancel. Prevents two modes spending the same budget.

## News (PROTECTED policy; PROPOSED defaults)
Blackout: 30 minutes before and after a high-impact event for affected instruments (PROPOSED default, owner to confirm).
Stale rule (PROPOSED): if the calendar has not refreshed within its coverage window (6 hours), state STALE_BLOCK and block new entries on news-sensitive instruments only.
Deriv Synthetic Indices are exempt from unrelated real-world news blackouts, but remain subject to data, provider and instrument checks.
Times normalized to UTC with source timezone recorded.

## Compliance profiles (PROPOSED)
Each profile: id, firm or account type, version, source URL, verified_at, verifier, status UNVERIFIED | VERIFIED | RETIRED. UNVERIFIED blocks live entries. Personal-account profile only in Phase 1.
Profiles are never assumed still valid because they were valid before.

## Emergency controls (PROTECTED: four distinct actions)
BLOCK_NEW_ENTRIES (default on trigger). CANCEL_PENDING_ENTRIES. MANAGE_EXISTING (always on). CLOSE_ALL (manual only, never automatic).
An emergency stop never closes positions automatically.

## Veto architecture
Risk, compliance and news each return APPROVED or VETO with reason codes. Any veto is final. The executor re-runs all checks against fresh persisted state at submit time.

## Operating modes (PROTECTED)
SCAN_ONLY, ALERT_ONLY, MANUAL_ASSIST, BACKTEST, PAPER: none may submit live orders. They do not load the broker execution adapter at all.
AUTOMATED: may submit only with an explicit live authorization record for the account and environment. Not enabled in Phase 1.
