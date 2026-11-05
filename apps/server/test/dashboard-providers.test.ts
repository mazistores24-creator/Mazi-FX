import { afterEach, describe, expect, it, vi } from "vitest";
import { createDashboardProviders } from "../src/dashboard-providers";

const scanner = {
  dashboardSetups: () => [{ id: "setup-1", instrument: "SYN_10", state: "CONFIRMED", direction: "LONG" as const, score: null, updatedAt: "2026-10-29T12:00:00.000Z" }],
} as never;

describe("dashboard package providers", () => {
  afterEach(() => vi.restoreAllMocks());

  it("maps scanner setup and risk package snapshots", () => {
    const providers = createDashboardProviders({
      scanner,
      risk: () => ({ mode: "DAY", referenceEquity: 1000, currentEquity: 990, submitted: 2, tradeLimit: 5, outcomes: [], asOf: new Date("2026-10-29T12:00:00.000Z") }),
    });
    expect(providers.setups()[0]?.id).toBe("setup-1");
    expect(providers.risk()).toMatchObject({ mode: "DAY", drawdownAmount: 10, tradeCount: 2, tradeLimit: 5, paused: false });
  });

  it("reads execution pending state and returns local performance snapshots", async () => {
    const listPending = vi.fn().mockResolvedValue([{ clientOrderId: "client-1", brokerContractId: "contract-1", instrument: "SYN_10", direction: "LONG", status: "PENDING", updatedAt: "2026-10-29T12:00:00.000Z" }]);
    const providers = createDashboardProviders({ execution: { listPending } as never });
    await expect(providers.execution()).resolves.toEqual({ orders: [{ clientOrderId: "client-1", brokerContractId: "contract-1", instrument: "SYN_10", direction: "LONG", status: "PENDING", updatedAt: "2026-10-29T12:00:00.000Z" }] });
    expect(listPending).toHaveBeenCalledOnce();
    expect(providers.performance()).toEqual({});
  });
});
