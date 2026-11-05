import { loadConfig } from "./config";
import { buildApp } from "./app";
import { MemoryIdentityStore } from "./store";
import { createDashboardProviders } from "./dashboard-providers";

/**
 * Entry point. Phase 1: HTTP API only. No scanner, no market-data subscription,
 * no broker execution. Those arrive in later phases and are gated by mode.
 */
async function main(): Promise<void> {
  const config = loadConfig(process.env);
  if (!config.databaseUrl) {
    console.warn(JSON.stringify({ level: "warn", msg: "DATABASE_URL not set; using in-memory identity store (development only)" }));
  }
  // The PostgreSQL store is wired in Phase 1b once a live database is available in CI.
  const store = new MemoryIdentityStore();
  const app = buildApp({ config, store, dashboard: createDashboardProviders({}) });
  await app.listen({ host: config.host, port: config.port });
}

main().catch((err: unknown) => {
  console.error(JSON.stringify({ level: "fatal", msg: err instanceof Error ? err.message : "startup failed" }));
  process.exit(1);
});
