import { describe, expect, it, beforeAll } from "vitest";
import { buildApp } from "../src/app";
import { loadConfig } from "../src/config";
import { MemoryIdentityStore } from "../src/store";
import type { FastifyInstance } from "fastify";

const PASSWORD = "correct horse battery";

describe("cross-account isolation", () => {
  let app: FastifyInstance;
  let tokenA: string;
  let tokenB: string;
  let accountA: string;
  let accountB: string;

  beforeAll(async () => {
    const config = loadConfig({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      JWT_ACCESS_SECRET: "a".repeat(40),
      JWT_REFRESH_SECRET: "r".repeat(40),
    } as NodeJS.ProcessEnv);
    app = buildApp({ config, store: new MemoryIdentityStore() });
    await app.ready();

    tokenA = (await app.inject({ method: "POST", url: "/auth/register", payload: { email: "a@example.com", password: PASSWORD } })).json().accessToken;
    tokenB = (await app.inject({ method: "POST", url: "/auth/register", payload: { email: "b@example.com", password: PASSWORD } })).json().accessToken;

    accountA = (
      await app.inject({
        method: "POST",
        url: "/accounts",
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { name: "A demo", baseCurrency: "USD" },
      })
    ).json().id;
    accountB = (
      await app.inject({
        method: "POST",
        url: "/accounts",
        headers: { authorization: `Bearer ${tokenB}` },
        payload: { name: "B demo", baseCurrency: "USD" },
      })
    ).json().id;
  });

  it("user A can read their own account", async () => {
    const res = await app.inject({ method: "GET", url: `/accounts/${accountA}`, headers: { authorization: `Bearer ${tokenA}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("A demo");
  });

  it("user A cannot read user B's account, and gets the same answer as for a missing id", async () => {
    const other = await app.inject({ method: "GET", url: `/accounts/${accountB}`, headers: { authorization: `Bearer ${tokenA}` } });
    const missing = await app.inject({
      method: "GET",
      url: "/accounts/00000000-0000-4000-8000-00000000dead",
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(other.statusCode).toBe(404);
    expect(other.body).toBe(missing.body);
    expect(other.body).not.toContain("B demo");
  });

  it("list shows only the caller's accounts", async () => {
    const res = await app.inject({ method: "GET", url: "/accounts", headers: { authorization: `Bearer ${tokenA}` } });
    const names = res.json().accounts.map((a: { name: string }) => a.name);
    expect(names).toEqual(["A demo"]);
  });

  it("user B cannot see user A's account either", async () => {
    const res = await app.inject({ method: "GET", url: `/accounts/${accountA}`, headers: { authorization: `Bearer ${tokenB}` } });
    expect(res.statusCode).toBe(404);
  });
});
