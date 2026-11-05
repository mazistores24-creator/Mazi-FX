import type { BrokerExecutionProvider, ExecutionOrderRequest, ExecutionOrderReceipt, ExecutionOrderStatus } from "@mazzi/core";
import { combineVetoes } from "@mazzi/risk";
import type { Decision, DrawdownResult, SizingResult } from "@mazzi/risk";

export type DemoOrderRequest = ExecutionOrderRequest;

export interface PersistedExecutionOrder extends DemoOrderRequest {
  status: ExecutionOrderStatus;
  brokerContractId: string | null;
  rejectionReason: string | null;
  updatedAt: string;
}

export interface ExecutionStateStore {
  get(clientOrderId: string): Promise<PersistedExecutionOrder | undefined>;
  /** Atomic insert-if-absent. Returns the existing row when the key already exists. */
  createIfAbsent(order: PersistedExecutionOrder): Promise<{ created: boolean; order: PersistedExecutionOrder }>;
  update(order: PersistedExecutionOrder): Promise<void>;
  listPending(): Promise<readonly PersistedExecutionOrder[]>;
}

export interface DemoOrderConnection {
  readonly environment: "DEMO";
  submit(input: { proposalId: string; maxPrice: number; clientOrderId: string }): Promise<{ contractId: string }>;
  getStatus(contractId: string): Promise<{ status: ExecutionOrderStatus; rejectionReason?: string }>;
}

export interface Phase5ExecutionRiskResult {
  risk: Decision;
  compliance: Decision;
  news: Decision;
  emergency: Decision;
  sizing: SizingResult;
  drawdown: DrawdownResult;
}

/** Must be implemented with the application's Phase 5 policy inputs. Missing gates fail closed. */
export interface Phase5ExecutionRiskGate {
  assess(order: DemoOrderRequest): Promise<Phase5ExecutionRiskResult>;
}

export interface DerivExecutionConfig {
  environment: "DEMO" | "LIVE";
  enabled: boolean;
}

export interface DerivExecutionOptions {
  config: DerivExecutionConfig;
  connection: DemoOrderConnection;
  risk: Phase5ExecutionRiskGate;
  state: ExecutionStateStore;
  now?: () => number;
}

const approved = (result: Phase5ExecutionRiskResult): boolean =>
  combineVetoes(result.risk, result.compliance, result.news, result.emergency,
    result.sizing.status === "APPROVED" ? { status: "APPROVED" } : { status: "VETO", reasons: [result.sizing.reason] },
    result.drawdown).status === "APPROVED";

const copy = (order: PersistedExecutionOrder): PersistedExecutionOrder => ({ ...order });

/** In-memory reference store. Production runtimes should use the SQL-backed store. */
export class MemoryExecutionStateStore implements ExecutionStateStore {
  private readonly orders = new Map<string, PersistedExecutionOrder>();
  async get(id: string): Promise<PersistedExecutionOrder | undefined> { const row = this.orders.get(id); return row && copy(row); }
  async createIfAbsent(order: PersistedExecutionOrder): Promise<{ created: boolean; order: PersistedExecutionOrder }> {
    const existing = this.orders.get(order.clientOrderId);
    if (existing) return { created: false, order: copy(existing) };
    this.orders.set(order.clientOrderId, copy(order));
    return { created: true, order: copy(order) };
  }
  async update(order: PersistedExecutionOrder): Promise<void> {
    if (!this.orders.has(order.clientOrderId)) throw new Error("EXECUTION_ORDER_NOT_FOUND");
    this.orders.set(order.clientOrderId, copy(order));
  }
  async listPending(): Promise<readonly PersistedExecutionOrder[]> { return [...this.orders.values()].filter((row) => row.status === "PENDING").map(copy); }
}

/** DEMO-only order path. Both explicit interlocks are checked before any broker operation. */
export class DerivDemoExecutionProvider implements BrokerExecutionProvider {
  readonly providerId = "deriv-demo-execution";
  readonly environment = "DEMO" as const;
  private readonly now: () => number;

  constructor(private readonly options: DerivExecutionOptions) {
    this.now = options.now ?? Date.now;
  }

  async submitOrder(request: DemoOrderRequest): Promise<ExecutionOrderReceipt> {
    this.assertEnabled();
    this.validateRequest(request);
    const prior = await this.options.state.get(request.clientOrderId);
    if (prior) return this.assertSameRequest(prior, request);

    const gates = await this.options.risk.assess(request);
    if (!approved(gates)) throw new Error("PHASE5_RISK_VETO");

    const timestamp = new Date(this.now()).toISOString();
    const pending: PersistedExecutionOrder = {
      ...request, status: "PENDING", brokerContractId: null, rejectionReason: null, updatedAt: timestamp,
    };
    const reservation = await this.options.state.createIfAbsent(pending);
    if (!reservation.created) return this.assertSameRequest(reservation.order, request);

    // Persist the idempotency key before the network call. An ambiguous timeout stays pending
    // and is never blindly resubmitted with a second broker order.
    try {
      const result = await this.options.connection.submit({ proposalId: request.proposalId, maxPrice: request.maxPrice, clientOrderId: request.clientOrderId });
      if (!result.contractId) throw new Error("DERIV_CONTRACT_ID_MISSING");
      const acknowledged = { ...pending, brokerContractId: result.contractId, updatedAt: new Date(this.now()).toISOString() };
      await this.options.state.update(acknowledged);
      return acknowledged;
    } catch {
      throw new Error("ORDER_SUBMISSION_UNCERTAIN_PENDING_RECONCILIATION");
    }
  }

  async reconcilePending(): Promise<readonly ExecutionOrderReceipt[]> {
    this.assertEnabled();
    const pending = await this.options.state.listPending();
    const results: ExecutionOrderReceipt[] = [];
    for (const row of pending) {
      if (!row.brokerContractId) { results.push(row); continue; }
      const remote = await this.options.connection.getStatus(row.brokerContractId);
      if (remote.status === row.status) { results.push(row); continue; }
      const updated: PersistedExecutionOrder = {
        ...row,
        status: remote.status,
        rejectionReason: remote.status === "REJECTED" ? (remote.rejectionReason ?? "BROKER_REJECTED") : null,
        updatedAt: new Date(this.now()).toISOString(),
      };
      await this.options.state.update(updated);
      results.push(updated);
    }
    return results;
  }

  private assertEnabled(): void {
    if (this.options.config.environment !== "DEMO" || this.options.config.enabled !== true || this.options.connection.environment !== "DEMO") {
      throw new Error("EXECUTION_INTERLOCK_BLOCKED_DEMO_AND_ENABLED_REQUIRED");
    }
  }
  private validateRequest(request: DemoOrderRequest): void {
    if (!request.clientOrderId.trim() || !request.setupId.trim() || !request.instrument.trim() || !request.proposalId.trim()) throw new Error("INVALID_ORDER_IDENTIFIERS");
    if (!Number.isFinite(request.maxPrice) || request.maxPrice <= 0 || !Number.isFinite(Date.parse(request.createdAt))) throw new Error("INVALID_ORDER_PRICE_OR_TIME");
  }
  private assertSameRequest(existing: PersistedExecutionOrder, request: DemoOrderRequest): ExecutionOrderReceipt {
    const fields: (keyof DemoOrderRequest)[] = ["setupId", "instrument", "direction", "proposalId", "maxPrice", "createdAt"];
    if (fields.some((field) => existing[field] !== request[field])) throw new Error("IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_ORDER");
    return existing;
  }
}

/** Maps the injected Deriv request transport onto the demo order connection port. */
export interface DerivRequestPort { request(payload: Record<string, unknown>): Promise<Record<string, unknown>> }
export class DerivDemoOrderConnection implements DemoOrderConnection {
  readonly environment = "DEMO" as const;
  constructor(private readonly transport: DerivRequestPort) {}
  async submit(input: { proposalId: string; maxPrice: number; clientOrderId: string }): Promise<{ contractId: string }> {
    const response = await this.transport.request({ buy: input.proposalId, price: input.maxPrice, passthrough: { client_order_id: input.clientOrderId } });
    const error = response.error as { message?: string } | undefined;
    if (error) throw new Error(error.message ?? "DERIV_BUY_REJECTED");
    const buy = response.buy as { contract_id?: string | number } | undefined;
    if (buy?.contract_id === undefined) throw new Error("DERIV_CONTRACT_ID_MISSING");
    return { contractId: String(buy.contract_id) };
  }
  async getStatus(contractId: string): Promise<{ status: ExecutionOrderStatus; rejectionReason?: string }> {
    const response = await this.transport.request({ proposal_open_contract: 1, contract_id: Number(contractId), subscribe: 0 });
    const error = response.error as { message?: string } | undefined;
    if (error) throw new Error(error.message ?? "DERIV_STATUS_LOOKUP_FAILED");
    const contract = response.proposal_open_contract as { status?: string; is_sold?: number; is_expired?: number } | undefined;
    if (!contract) throw new Error("DERIV_STATUS_RESPONSE_MISSING");
    const status = String(contract.status ?? "").toLowerCase();
    if (["won", "lost", "sold"].includes(status) || contract.is_sold === 1 || contract.is_expired === 1) return { status: "FILLED" };
    if (["cancelled", "canceled", "rejected", "void"].includes(status)) return { status: "REJECTED", rejectionReason: `DERIV_${status.toUpperCase()}` };
    return { status: "PENDING" };
  }
}

