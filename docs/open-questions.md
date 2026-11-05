# Open questions and proposed defaults

Owner answers already locked: Deriv only; Deriv demo first; no prop firm yet; Telegram primary; ET drawdown reset; investing.com as news source (no official free API, feed choice pending).

Still needing owner approval (defaults are in use until changed):
Q-SWING Swing window 2 bars each side, 3 on H4 and above. Approve?
Q-BOS Body close beyond swing by 0.1 x ATR(14). Approve?
Q-NEWS-WINDOW 30 minutes before and after high-impact events. Approve?
Q-M5 Confirmation: M5 close beyond prior M5 swing, expiring after 12 M5 bars. Approve?
Q-RSI Period 14, Wilder, close, bullish interpretation as in strategy-spec section 8. Approve one interpretation.
Q-TWO-LOSS Pause until next trading day (ET), then manual resume. Approve?
Q-COUNTER Trade counts on order submitted. Approve?
Q-OVERNIGHT Day mode forced exit 15 minutes before session close, no overnight holding. Confirm session close time per instrument.
Q-SD Supply and demand definition and Fibonacci overlap gate. Approve?
Q-ICHI Ichimoku gate interpretation. Approve?
Q-STOP Stop buffer 0.1 x ATR and TP1/TP2 at 127.2 and 161.8. Approve?
Q-NEWS-FEED investing.com has no official free API. Options: a licensed economic-calendar API (recommended for production), an unofficial scrape (prototype only, with written acknowledgement), or official central-bank feeds as a cross-check. Decide before Phase 5.
Q-VPS Hosting provider and size. Not blocking Phase 1.
Q-BROKER Deriv availability for Nigerian residents and its automated-trading terms must be checked by the owner against current Deriv terms. Not verified here.
Q-REGIME-ADX ADX threshold 25. Approve or change.
Q-TZ-DISPLAY Dashboard display timezone (default WAT, stored in UTC).
