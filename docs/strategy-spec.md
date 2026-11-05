# Technical strategy specification (protected rules)

Status: DRAFT. Protected items are fixed. PROPOSED items need owner approval before Phase 3 sign-off.

## 1. Timeframe hierarchy (PROTECTED)
MN1 long-term macro context. W1 major structure and key levels. D1 directional context and zones. H4 primary setup identification. H1 confirmation. M30 refinement. M15 entry-area refinement. M5 mandatory final execution confirmation.
A lower timeframe may not override a conflicting higher-timeframe condition unless the owner approves an explicit exception.
All timeframes are built from closed candles only. Times are stored in UTC.
M1 is not a dependency. The timeframe allowlist excludes M1 and a static test enforces this.

## 2. Market structure (PROTECTED definitions, PROPOSED parameters)
A swing high at bar i: high[i] strictly greater than highs of the 2 bars before and the 2 bars after. Swing low mirrors with lows. On H4, D1, W1 and MN1 the window is 3 bars each side (PROPOSED for H4+, per owner default).
A swing is confirmed only after the required number of later bars have CLOSED. Future bars are never used to confirm a historical swing before it would have been known.
Structure labels: HH, HL, LH, LL derived from the sequence of confirmed swings.

## 3. BOS and CHoCH (PROTECTED: body close and wick rule; PROPOSED: distance)
BOS (bullish): candle BODY closes above the last confirmed swing high by at least 0.1 x ATR(14) on the structure timeframe. Wick-only breaks do not count. Equal levels do not count.
BOS (bearish): mirror with body close below the last confirmed swing low by at least 0.1 x ATR(14).
CHoCH: the first BOS in the direction opposite to the prevailing structure.
False-breakout rule (PROPOSED): a break is invalidated if price closes back beyond the broken level within 3 bars.
Duplicate prevention: one BOS per swing level.

## 4. Breakout (PROTECTED sequence, PROPOSED leg size)
Breakout is valid when the BOS candle closes beyond the level and the leg is at least 1.0 x ATR(14) on the signal timeframe (PROPOSED). Breakout expires after 20 bars of its timeframe without retracement (PROPOSED).
The strategy never enters on breakout alone and never chases.

## 5. Fibonacci (PROTECTED)
Retracements: 0, 23.6, 38.2, 50, 61.8, 78.6, 100 percent. Extensions: 127.2, 161.8, 261.8, 423.6 percent.
BASELINE ENTRY ZONE: 50.0 percent to 61.8 percent retracement, inclusive. Stored as protected constants FIB_ZONE_LOWER = 0.5 and FIB_ZONE_UPPER = 0.618. Must not be widened, narrowed or replaced without a versioned owner approval. Alternative zones may exist only as EXPERIMENTAL research variants, never enabled in a live mode.
Anchors (PROPOSED): bullish uses the confirmed swing low before the breakout impulse as the low anchor and the highest confirmed swing high after that low up to the breakout as the high anchor. Bearish mirrors.
Bullish zone: upper edge = high - 0.5 x range, lower edge = high - 0.618 x range.

## 6. Supply and demand (PROPOSED definition)
Demand zone: last bearish candle before a bullish impulse whose body is at least 1.5 x ATR(14). Supply mirrors.
Boundaries are that candle's high and low. Fresh until price trades into it; mitigated after the first close inside it.
Gate, not score: the Fibonacci zone must overlap a fresh zone in the trade direction by at least one tick.

## 7. Ichimoku (PROTECTED periods 9/26/52/26; PROPOSED usage)
Tenkan 9, Kijun 26, Senkou B 52, displacement 26. Value at bar t uses only data available at t. Senkou spans displaced forward are used only as of the bar when they were known.
Bullish gate (PROPOSED): price above cloud on the signal timeframe, Tenkan above Kijun, cloud bullish on the higher timeframe. Any conflicting higher-timeframe reading blocks the setup.

## 8. RSI (PROTECTED levels 10 and 90; PROPOSED period and interpretation)
Levels: lower extreme 10, upper extreme 90. Never substituted with 20/80 or 30/70.
Period 14, Wilder smoothing, close price, signal timeframe (PROPOSED).
Bullish interpretation (PROPOSED): RSI at or below 10 at least once during the retracement, then back above 10 before M5 confirmation. Mirror for bearish at 90. RSI is one gate, never a standalone trigger.

## 9. M5 execution confirmation (PROTECTED mandatory; PROPOSED pattern)
M5 is the ONLY mandatory execution confirmation. Bullish: an M5 candle CLOSES above the prior M5 swing high in the setup direction, after zone entry.
Expiry (PROPOSED): 12 M5 bars (1 hour) after zone entry.
Invalidation: M5 close beyond the anchor on the wrong side, or beyond the zone invalidation level.
No order may be submitted without a CONFIRMED M5 event for the same setup ID.

## 10. Stop-loss and take-profit (PROPOSED)
Bullish stop: below anchor low minus 0.1 x ATR(14). Reject the setup if the stop is closer than the broker minimum stop distance or closer than 0.5 x ATR(14). Stops are never widened.
TP1 = 127.2 percent extension, TP2 = 161.8 percent extension. Partial exit is off by default.

## 11. Trailing profit (PROTECTED values 1.0R and 0.25R)
Activation: when price reaches 1.0R on a closed bar, move stop to entry plus 0.25R (protected profit).
After activation, trail the stop to the most recent confirmed swing low (bullish) only if it improves the stop. Stops never loosen.
Values are starting settings to be validated by backtesting, not proof of optimality.

## 12. Setup expiry and invalidation (PROPOSED)
Setup expires if price does not enter the zone within 30 signal-timeframe bars after breakout confirmation.
Invalidated by a close beyond the anchor before entry, or a new CHoCH against the setup direction.
Terminal states cannot be re-entered; a new setup gets a new ID.

## 13. Risk-related strategy hooks
See risk-compliance-spec.md. Risk and compliance can veto any proposal independently of the strategy.
