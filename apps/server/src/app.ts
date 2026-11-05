import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "./config";
import { hashPassword, issueTokens, verifyPassword, verifyToken } from "./auth";
import type { IdentityStore } from "./store";

export interface AppDeps {
  config: AppConfig;
  store: IdentityStore;
  /** Returns true when the database answers. Undefined means no database configured. */
  dbCheck?: () => Promise<boolean>;
  /** Per-instrument feed freshness. Undefined when no market-data pipeline is running. */
  feedStatus?: () => Array<{ instrument: string; state: string; lastTickAt: string | null; ageMs: number | null }>;
  /** Dashboard data adapters are injected so reads stay explicit and testable. */
  dashboard?: {
    setups?: () => readonly DashboardSetup[];
    risk?: () => DashboardRiskState | null;
    performance?: () => DashboardPerformance;
    execution?: () => DashboardExecutionState | Promise<DashboardExecutionState>;
  };
}

export interface DashboardSetup {
  id: string;
  instrument: string;
  state: string;
  direction: "LONG" | "SHORT" | null;
  score: number | null;
  updatedAt: string;
}
export interface DashboardRiskState {
  mode: "DAY" | "SWING" | "POSITION";
  tradingDate: string;
  drawdownPct: number;
  drawdownAmount: number;
  drawdownLimitPct: number;
  tradeCount: number;
  tradeLimit: number;
  consecutiveLosses: number;
  paused: boolean;
  resumeAtET: string | null;
}
export interface DashboardPerformance {
  paper?: { equity: number | null; openPosition: { instrument: string; direction: "LONG" | "SHORT" } | null };
  backtest?: { tradeCount: number; winRate: number | null; netR: number; maxDrawdownPct: number };
  expectancy?: { status: string; tradeCount: number; expectancyR: number | null; confidenceInterval: { lower: number; upper: number } | null };
}
export interface DashboardExecutionState {
  orders: readonly { clientOrderId: string; brokerContractId: string | null; instrument: string; direction: "LONG" | "SHORT"; status: "PENDING" | "FILLED" | "REJECTED"; updatedAt: string }[];
}

const credentials = z.object({
  email: z.string().email().max(254),
  password: z.string().min(12).max(256),
});

const refreshBody = z.object({ refreshToken: z.string().min(10) });
const createAccountBody = z.object({
  name: z.string().min(1).max(120),
  baseCurrency: z.string().regex(/^[A-Z]{3}$/),
});

export function buildApp(deps: AppDeps): FastifyInstance {
  const app: FastifyInstance = Fastify({ logger: { level: deps.config.logLevel }, bodyLimit: 16 * 1024 });
  const { config, store } = deps;

  function requireUser(request: { headers: { authorization?: string } }): string | undefined {
    const header = request.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) return undefined;
    return verifyToken(header.slice(7), config.jwtAccessSecret, "access");
  }

  app.get("/health/live", async () => ({ status: "ok" }));

  app.get("/health/ready", async (_request, reply) => {
    if (!deps.dbCheck) {
      return { status: "ok", database: "NOT_CONFIGURED" };
    }
    const ok = await deps.dbCheck().catch(() => false);
    if (!ok) {
      reply.code(503);
      return { status: "unavailable", database: "DOWN" };
    }
    return { status: "ok", database: "UP" };
  });

  app.get("/health/feeds", async () => {
    const feeds = deps.feedStatus ? deps.feedStatus() : [];
    const degraded = feeds.some((f) => f.state !== "FRESH");
    return { status: degraded ? "degraded" : "ok", feeds };
  });

  app.get("/", async (_request, reply) => {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const root = process.cwd();
    const candidates = [join(root, "apps/server/public/dashboard.html"), join(root, "public/dashboard.html")];
    let html: string | undefined;
    for (const candidate of candidates) {
      try { html = await readFile(candidate, "utf8"); break; } catch { /* try the package-root location */ }
    }
    if (!html) return reply.code(500).send({ error: "dashboard_asset_unavailable" });
    return reply.type("text/html; charset=utf-8").send(html);
  });

  app.get("/api/dashboard", async (request, reply) => {
    const userId = requireUser(request);
    if (!userId || !(await store.findUserById(userId))) return reply.code(401).send({ error: "unauthorized" });
    const activeStates = new Set(["STRUCTURE_FOUND", "ZONE_ARMED", "AWAITING_M5", "CONFIRMED"]);
    const setups = [...(deps.dashboard?.setups?.() ?? [])]
      .filter((setup) => activeStates.has(setup.state) || setup.state === "CLOSED" || setup.state === "EXPIRED" || setup.state === "INVALIDATED")
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, 20);
    const feeds = deps.feedStatus ? deps.feedStatus() : [];
    return {
      asOf: new Date().toISOString(),
      feeds,
      setups,
      risk: deps.dashboard?.risk?.() ?? null,
      performance: deps.dashboard?.performance?.() ?? {},
      execution: await deps.dashboard?.execution?.() ?? { orders: [] },
    };
  });

  app.post("/auth/register", async (request, reply) => {
    const parsed = credentials.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });
    const existing = await store.findUserByEmail(parsed.data.email);
    if (existing) return reply.code(409).send({ error: "email_taken" });
    const user = await store.createUser(parsed.data.email, await hashPassword(parsed.data.password));
    const tokens = issueTokens(user.id, config.jwtAccessSecret, config.jwtRefreshSecret);
    return reply.code(201).send({ userId: user.id, ...tokens });
  });

  app.post("/auth/login", async (request, reply) => {
    const parsed = credentials.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });
    const user = await store.findUserByEmail(parsed.data.email);
    // Same response for unknown email and wrong password.
    const ok = user !== undefined && (await verifyPassword(user.passwordHash, parsed.data.password));
    if (!user || !ok) return reply.code(401).send({ error: "invalid_credentials" });
    const tokens = issueTokens(user.id, config.jwtAccessSecret, config.jwtRefreshSecret);
    return { userId: user.id, ...tokens };
  });

  app.post("/auth/refresh", async (request, reply) => {
    const parsed = refreshBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });
    const sub = verifyToken(parsed.data.refreshToken, config.jwtRefreshSecret, "refresh");
    if (!sub) return reply.code(401).send({ error: "invalid_token" });
    const user = await store.findUserById(sub);
    if (!user) return reply.code(401).send({ error: "invalid_token" });
    return issueTokens(user.id, config.jwtAccessSecret, config.jwtRefreshSecret);
  });

  app.get("/me", async (request, reply) => {
    const userId = requireUser(request);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    const user = await store.findUserById(userId);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    return { userId: user.id, email: user.email, role: user.role };
  });

  app.post("/accounts", async (request, reply) => {
    const userId = requireUser(request);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    const parsed = createAccountBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });
    const account = await store.createAccount(userId, parsed.data.name, parsed.data.baseCurrency);
    return reply.code(201).send({ id: account.id, name: account.name, baseCurrency: account.baseCurrency });
  });

  app.get("/accounts", async (request, reply) => {
    const userId = requireUser(request);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    const accounts = await store.listAccountsForUser(userId);
    return { accounts: accounts.map((a) => ({ id: a.id, name: a.name, baseCurrency: a.baseCurrency })) };
  });

  app.get("/accounts/:id", async (request, reply) => {
    const userId = requireUser(request);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    const { id } = request.params as { id: string };
    const account = await store.getAccountForUser(userId, id);
    // Not found and not yours look identical on purpose.
    if (!account) return reply.code(404).send({ error: "not_found" });
    return { id: account.id, name: account.name, baseCurrency: account.baseCurrency };
  });

  return app;
}
