# Quantitative intelligence specification

Status: DRAFT. The quant layer is a filter and reporter on top of the protected strategy. It is never a replacement.

## Hard rules
Q-R1 Quant results can only return PASS, FAIL, INSUFFICIENT_EVIDENCE, DATA_UNAVAILABLE or REVIEW_REQUIRED.
Q-R2 A missing estimate is never converted into a positive signal.
Q-R3 The quant service has no write path to zone, M5, RSI, Ichimoku or risk parameters.
Q-R4 A score is never presented as a probability of winning.
Q-R5 Changes to any strategy rule require: recorded, versioned, tested, compared to baseline, evaluated out of sample, risk-reviewed, owner-approved.

## Components (PROPOSED defaults)
Regime: features ADX(14) on H4 (trend threshold 25), ATR(14) percentile over trailing 250 bars, efficiency ratio over 20 bars. Labels TRENDING, RANGING, HIGH_VOL, LOW_VOL, UNSTABLE. Tested by whether it improves net expectancy out of sample.
Scoring: Phase 4 starts with a documented checklist of features, no weights. A weighted score is introduced only if out-of-sample expectancy rises monotonically across score buckets.
Historical grouping: by instrument, mode, direction, regime, session and pre-defined structural features. Features chosen on a training window only.
Expectancy: empirical mean of net R (after commission, spread, slippage, swap), with 95 percent bootstrap CI (10,000 resamples, percentile method).
Win rate interval: Wilson score interval.
Thresholds: no estimate shown below 30 trades (no rate shown). Below 100 trades in a category: INSUFFICIENT_EVIDENCE for performance claims.
Volatility checks: stop distance at least 0.5 x ATR(14); spread veto above 0.15 x ATR (PROPOSED).
Correlation: rolling 60-day log-return correlation on H4 closes with Ledoit-Wolf shrinkage. Used for combined-exposure veto. Treated as unstable and time-varying.

## Validation procedure for any strategy change
Fix training window, lock test window, sweep on training data only, single evaluation on test data, walk-forward over at least 5 folds, plus or minus 20 percent sensitivity per parameter, cost stress at 1.5x and 2x, Monte Carlo bootstrap of trade sequence (10,000 paths). The final test set is used once per variant; reuse is recorded and invalidates the out-of-sample claim.

## Reporting rules
Every report states trade count, date range, instruments, data source, cost assumptions, and whether results are in-sample, out-of-sample, walk-forward or simulated. Negative results are included.
