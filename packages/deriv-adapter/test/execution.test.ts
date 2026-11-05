import { describe, expect, it, vi } from "vitest";
import { DerivDemoExecutionProvider, DerivDemoOrderConnection, MemoryExecutionStateStore } from "../src/execution";
import type { DemoOrderConnection, DemoOrderRequest, Phase5ExecutionRiskGate, Phase5ExecutionRiskResult } from "../src/execution";

const pass: Phase5ExecutionRiskResult = {
  risk: { status: "APPROVED" }, compliance: { status: "APPROVED" }, news: { status: "APPROVED" }, emergency: { status: "APPROVED" },
  sizing: { status: "APPROVED", reason: "SIZE_OK", riskBudget: 2.5, volume: 1, plannedRisk: 2 },
  drawdown: { status: "APPROVED", drawdownAmount: 0, drawdownPct: 0, limitPct: 5 },
};
const request: DemoOrderRequest = {
  clientOrderId: "client-1", setupId: "setup-1", instrument: "R_100", direction: "LONG", proposalId: "proposal-7", maxPrice: 10, createdAt: "2026-10-29T10:00:00.000Z",
};
class FakeConnection implements DemoOrderConnection {
  readonly environment = "DEMO" as const;
  submissions = 0;
  remoteStatus: "PENDING" | "FILLED" | "REJECTED" = "PENDING";
  async submit() { this.submissions++; return { contractId: "77" }; }
  async getStatus() { return { status: this.remoteStatus, rejectionReason: this.remoteStatus === "REJECTED" ? "BROKER_RULE" : undefined }; }
}
const gate = (result: Phase5ExecutionRiskResult = pass): Phase5ExecutionRiskGate => ({ assess: vi.fn(async () => result) });
const config = { environment: "DEMO" as const, enabled: true };

describe("Deriv demo execution and reconciliation", () => {
  it("refuses to submit unless both demo and explicit enable are configured", async () => {
    const conn = new FakeConnection();
    const provider = new DerivDemoExecutionProvider({ config: { environment: "DEMO", enabled: false }, connection: conn, risk: gate(), state: new MemoryExecutionStateStore() });
    await expect(provider.submitOrder(request)).rejects.toThrow("EXECUTION_INTERLOCK_BLOCKED");
    expect(conn.submissions).toBe(0);
  });
  it("routes through every Phase 5 gate before submitting", async () => {
    const conn = new FakeConnection();
    const veto = { ...pass, news: { status: "VETO" as const, reasons: ["NEWS_BLACKOUT"] } };
    const provider = new DerivDemoExecutionProvider({ config, connection: conn, risk: gate(veto), state: new MemoryExecutionStateStore() });
    await expect(provider.submitOrder(request)).rejects.toThrow("PHASE5_RISK_VETO");
    expect(conn.submissions).toBe(0);
  });
  it("stores pending before submission and idempotently returns the same order", async () => {
    const conn = new FakeConnection(); const state = new MemoryExecutionStateStore();
    const provider = new DerivDemoExecutionProvider({ config, connection: conn, risk: gate(), state, now: () => Date.parse(request.createdAt) });
    const first = await provider.submitOrder(request);
    const second = await provider.submitOrder(request);
    expect(first.status).toBe("PENDING"); expect(first.brokerContractId).toBe("77");
    expect(second).toEqual(first); expect(conn.submissions).toBe(1);
    await expect(provider.submitOrder({ ...request, maxPrice: 11 })).rejects.toThrow("IDEMPOTENCY_KEY_REUSED");
  });
  it("reconciles pending orders to filled and rejected and persists the result", async () => {
    const conn = new FakeConnection(); const state = new MemoryExecutionStateStore();
    const provider = new DerivDemoExecutionProvider({ config, connection: conn, risk: gate(), state });
    await provider.submitOrder(request);
    conn.remoteStatus = "FILLED";
    expect((await provider.reconcilePending())[0]?.status).toBe("FILLED");
    expect(await state.listPending()).toHaveLength(0);

    const rejectedRequest = { ...request, clientOrderId: "client-2", setupId: "setup-2" };
    await provider.submitOrder(rejectedRequest);
    conn.remoteStatus = "REJECTED";
    const rejected = (await provider.reconcilePending())[0];
    expect(rejected?.status).toBe("REJECTED"); expect(rejected?.rejectionReason).toBe("BROKER_RULE");
  });
  it("encodes the Deriv buy request and maps contract status with a fake transport", async () => {
    const calls: Record<string, unknown>[] = [];
    const transport = { request: vi.fn(async (payload: Record<string, unknown>) => {
      calls.push(payload);
      return "buy" in payload ? { buy: { contract_id: 123 } } : { proposal_open_contract: { status: "won", is_sold: 1 } };
    }) };
    const connection = new DerivDemoOrderConnection(transport);
    expect(await connection.submit({ proposalId: "p", maxPrice: 3, clientOrderId: "c" })).toEqual({ contractId: "123" });
    expect(await connection.getStatus("123")).toEqual({ status: "FILLED" });
    expect(calls[0]).toEqual({ buy: "p", price: 3, passthrough: { client_order_id: "c" } });
  });
});
