import { describe, expect, it } from "vitest";
import { buildApp, type AppDeps, type DashboardSetup } from "../src/app";
import { loadConfig } from "../src/config";
import { MemoryIdentityStore } from "../src/store";

function setupApp(setups: readonly DashboardSetup[] = []) {
  const config = loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", JWT_ACCESS_SECRET: "a".repeat(40), JWT_REFRESH_SECRET: "r".repeat(40) } as NodeJS.ProcessEnv);
  const deps: AppDeps = {
    config,
    store: new MemoryIdentityStore(),
    feedStatus: () => [{ instrument: "R_100", state: "FRESH", lastTickAt: "2026-10-29T12:00:00.000Z", ageMs: 100 }],
    dashboard: {
      setups: () => setups,
      risk: () => ({ mode: "DAY", tradingDate: "2026-10-29", drawdownPct: 1.2, drawdownAmount: 120, drawdownLimitPct: 3, tradeCount: 2, tradeLimit: 5, consecutiveLosses: 1, paused: false, resumeAtET: null }),
      performance: () => ({ paper: { equity: 1020, openPosition: null }, backtest: { tradeCount: 10, winRate: 0.6, netR: 2.5, maxDrawdownPct: 4 }, expectancy: { status: "READY", tradeCount: 10, expectancyR: 0.25, confidenceInterval: { lower: 0.1, upper: 0.4 } } }),
      execution: () => ({ orders: [{ clientOrderId: "c1", brokerContractId: "b1", instrument: "R_100", direction: "LONG", status: "FILLED", updatedAt: "2026-10-29T12:00:00.000Z" }] }),
    },
  };
  return buildApp(deps);
}

const scannerSetups: DashboardSetup[] = [
  { id: "active", instrument: "R_100", state: "CONFIRMED", direction: "LONG", score: 8, updatedAt: "2026-10-29T12:02:00.000Z" },
  { id: "old", instrument: "R_50", state: "CLOSED", direction: "SHORT", score: 5, updatedAt: "2026-10-29T11:00:00.000Z" },
  { id: "ignored", instrument: "R_75", state: "NO_SETUP", direction: null, score: null, updatedAt: "2026-10-29T12:03:00.000Z" },
];

describe("dashboard", () => {
  it("protects the snapshot behind access-token auth", async () => {
    const app = setupApp(scannerSetups);
    await app.ready();
    expect((await app.inject({ method: "GET", url: "/api/dashboard" })).statusCode).toBe(401);
    await app.close();
  });

  it("serves read-only feed, scanner, risk, performance and reconciled order snapshots", async () => {
    const app = setupApp(scannerSetups);
    await app.ready();
    const registration = await app.inject({ method: "POST", url: "/auth/register", payload: { email: "dash@example.com", password: "a long enough test password" } });
    const token = registration.json().accessToken as string;
    const response = await app.inject({ method: "GET", url: "/api/dashboard", headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(200);
    expect(response.json().feeds[0].state).toBe("FRESH");
    expect(response.json().setups.map((item: DashboardSetup) => item.id)).toEqual(["active", "old"]);
    expect(response.json().risk.paused).toBe(false);
    expect(response.json().performance.expectancy.expectancyR).toBe(0.25);
    expect(response.json().execution.orders[0].brokerContractId).toBe("b1");
    expect(response.body).not.toMatch(/cancel|place order/i);
    await app.close();
  });

  it("serves the dashboard page without adding any order-action route", async () => {
    const app = setupApp();
    await app.ready();
    const page = await app.inject({ method: "GET", url: "/" });
    expect(page.statusCode).toBe(200);
    expect(page.headers["content-type"]).toContain("text/html");
    expect(page.body).toContain("Demo execution reconciliation");
    expect(page.body).not.toMatch(/cancelOrder|placeOrder|submitOrder/i);
    await app.close();
  });
});
