import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config";

const base = { NODE_ENV: "development" } as NodeJS.ProcessEnv;

describe("config validation", () => {
  it("loads defaults in development", () => {
    const cfg = loadConfig(base);
    expect(cfg.port).toBe(3000);
    expect(cfg.tradingMode).toBe("ALERT_ONLY");
  });

  it("refuses AUTOMATED mode in this build", () => {
    expect(() => loadConfig({ ...base, TRADING_MODE: "AUTOMATED" })).toThrow(ConfigError);
  });

  it("refuses an unknown trading mode", () => {
    expect(() => loadConfig({ ...base, TRADING_MODE: "LIVE" })).toThrow(/TRADING_MODE/);
  });

  it("refuses a changed protected baseline zone", () => {
    expect(() => loadConfig({ ...base, FIB_ZONE_LOWER: "0.382" })).toThrow(/50.0 to 61.8/);
    expect(() => loadConfig({ ...base, FIB_ZONE_UPPER: "0.619" })).toThrow(ConfigError);
  });

  it("accepts the approved zone values", () => {
    expect(() => loadConfig({ ...base, FIB_ZONE_LOWER: "0.5", FIB_ZONE_UPPER: "0.618" })).not.toThrow();
  });

  it("requires DATABASE_URL and secrets in production", () => {
    expect(() => loadConfig({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/);
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://u:p@h:5432/d",
        JWT_ACCESS_SECRET: "short",
        JWT_REFRESH_SECRET: "x".repeat(40),
      } as NodeJS.ProcessEnv),
    ).toThrow(/JWT_ACCESS_SECRET/);
  });

  it("rejects a non-numeric Deriv app id", () => {
    expect(() => loadConfig({ ...base, DERIV_APP_ID: "abc" })).toThrow(/numeric/);
  });

  it("rejects an invalid port", () => {
    expect(() => loadConfig({ ...base, PORT: "99999" })).toThrow(ConfigError);
  });
});
