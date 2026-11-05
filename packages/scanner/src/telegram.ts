import type { TelegramAlert, TelegramSender } from "./types";

/** Deterministic test fake. It performs no network activity. */
export class FakeTelegramSender implements TelegramSender {
  readonly sent: TelegramAlert[] = [];
  private failuresRemaining = 0;
  failNext(count = 1): void { this.failuresRemaining = Math.max(0, Math.floor(count)); }
  async send(alert: TelegramAlert): Promise<void> {
    if (this.failuresRemaining > 0) { this.failuresRemaining--; throw new Error("FAKE_TELEGRAM_FAILURE"); }
    this.sent.push(structuredClone(alert));
  }
}

/** Real sender, constructed explicitly by server runtime only, never by tests. */
export class TelegramBotSender implements TelegramSender {
  constructor(private readonly token: string, private readonly chatId: string, private readonly fetchImpl: typeof fetch = fetch) {
    if (!token.trim() || !chatId.trim()) throw new Error("telegram token and chat id are required");
  }
  async send(alert: TelegramAlert): Promise<void> {
    const response = await this.fetchImpl(`https://api.telegram.org/bot${this.token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: this.chatId, text: alert.message, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`TELEGRAM_HTTP_${response.status}`);
    const body = await response.json() as { ok?: boolean };
    if (body.ok !== true) throw new Error("TELEGRAM_DELIVERY_REJECTED");
  }
}

export function formatAlert(alert: Omit<TelegramAlert, "message">): TelegramAlert {
  return { ...alert, message: [
    `MAZZI setup confirmed: ${alert.direction}`,
    `Instrument: ${alert.instrument}`,
    `Setup: ${alert.setupId}`,
    `As of: ${alert.asOf}`,
    "Alert only. No order was placed.",
  ].join("\n") };
}
