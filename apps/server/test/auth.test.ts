import { describe, expect, it, beforeAll } from "vitest";
import { buildApp } from "../src/app";
import { loadConfig } from "../src/config";
import { MemoryIdentityStore } from "../src/store";
import type { FastifyInstance } from "fastify";

const PASSWORD = "correct horse battery";

function makeApp(dbCheck?: () => Promise<boolean>): FastifyInstance {
  const config = loadConfig({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    JWT_ACCESS_SECRET: "a".repeat(40),
    JWT_REFRESH_SECRET: "r".repeat(40),
  } as NodeJS.ProcessEnv);
  return buildApp({ config, store: new MemoryIdentityStore(), dbCheck });
}

describe("auth flow", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = makeApp();
    await app.ready();
  });

  it("registers, logs in, reads /me, and refreshes", async () => {
    const reg = await app.inject({ method: "POST", url: "/auth/register", payload: { email: "owner@example.com", password: PASSWORD } });
    expect(reg.statusCode).toBe(201);
    const { accessToken, refreshToken, userId } = reg.json();
    expect(accessToken).toBeTruthy();

    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email: "OWNER@example.com", password: PASSWORD } });
    expect(login.statusCode).toBe(200);
    expect(login.json().userId).toBe(userId);

    const me = await app.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${accessToken}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json().email).toBe("owner@example.com");
    expect(me.body).not.toContain("passwordHash");

    const refreshed = await app.inject({ method: "POST", url: "/auth/refresh", payload: { refreshToken } });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().accessToken).toBeTruthy();
  });

  it("rejects a wrong password and an unknown email with the same status", async () => {
    await app.inject({ method: "POST", url: "/auth/register", payload: { email: "wrong@example.com", password: PASSWORD } });
    const wrong = await app.inject({ method: "POST", url: "/auth/login", payload: { email: "wrong@example.com", password: "not the password at all" } });
    const unknown = await app.inject({ method: "POST", url: "/auth/login", payload: { email: "nobody@example.com", password: PASSWORD } });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
  });

  it("rejects a refresh token used as an access token and vice versa", async () => {
    const reg = await app.inject({ method: "POST", url: "/auth/register", payload: { email: "types@example.com", password: PASSWORD } });
    const { accessToken, refreshToken } = reg.json();
    const meWithRefresh = await app.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${refreshToken}` } });
    expect(meWithRefresh.statusCode).toBe(401);
    const refreshWithAccess = await app.inject({ method: "POST", url: "/auth/refresh", payload: { refreshToken: accessToken } });
    expect(refreshWithAccess.statusCode).toBe(401);
  });

  it("rejects a short password", async () => {
    const res = await app.inject({ method: "POST", url: "/auth/register", payload: { email: "short@example.com", password: "short" } });
    expect(res.statusCode).toBe(400);
  });

  it("rejects /me without a token", async () => {
    const res = await app.inject({ method: "GET", url: "/me" });
    expect(res.statusCode).toBe(401);
  });
});

describe("health endpoints", () => {
  it("reports live and ready with no database configured", async () => {
    const app = makeApp();
    await app.ready();
    expect((await app.inject({ method: "GET", url: "/health/live" })).statusCode).toBe(200);
    const ready = await app.inject({ method: "GET", url: "/health/ready" });
    expect(ready.statusCode).toBe(200);
    expect(ready.json().database).toBe("NOT_CONFIGURED");
  });

  it("returns 503 from readiness when the database check fails", async () => {
    const app = makeApp(async () => false);
    await app.ready();
    const ready = await app.inject({ method: "GET", url: "/health/ready" });
    expect(ready.statusCode).toBe(503);
  });
});
