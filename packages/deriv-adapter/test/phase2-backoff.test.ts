import { describe, expect, it } from "vitest";
import { computeBackoffMs } from "../src/backoff";
import { assertDerivAppId, assertDerivEndpoint } from "../src/config";
import { mapDerivSymbol, normalizeActiveSymbol } from "../src/instruments";

describe("reconnection backoff", () => {
  it("doubles from the base and caps at the max, deterministically with no jitter", () => {
    expect(computeBackoffMs(0, 1000, 60000, () => 1)).toBe(1000);
    expect(computeBackoffMs(3, 1000, 60000, () => 1)).toBe(8000);
    expect(computeBackoffMs(20, 1000, 60000, () => 1)).toBe(60000);
  });

  it("rejects a negative attempt", () => {
    expect(() => computeBackoffMs(-1)).toThrow();
  });
});

describe("config guards", () => {
  it("accepts numeric and alphanumeric app ids, while rejecting unsafe values", () => {
    expect(() => assertDerivAppId("1089")).not.toThrow();
    expect(() => assertDerivAppId("abc123")).not.toThrow();
    expect(() => assertDerivAppId("app id")).toThrow("application ID");
  });

  it("accepts only wss://ws.derivws.com", () => {
    expect(() => assertDerivEndpoint("wss://ws.derivws.com/websockets/v3")).not.toThrow();
    expect(() => assertDerivEndpoint("ws://ws.derivws.com")).toThrow();
    expect(() => assertDerivEndpoint("wss://evil.example.com")).toThrow();
  });
});

describe("instrument normalization fixtures", () => {
  it("maps Deriv synthetic symbols to canonical ids", () => {
    expect(mapDerivSymbol("R_100")).toMatchObject({ canonicalId: "SYN_RNG_VOL_100", family: "VOLATILITY" });
    expect(mapDerivSymbol("1HZ100V")).toMatchObject({ canonicalId: "SYN_RNG_VOL_1S_100", family: "VOLATILITY_1S" });
    expect(mapDerivSymbol("BOOM1000N")).toMatchObject({ family: "BOOM_CRASH" });
  });

  it("keeps unknown symbols with a DERIV_ prefix and null family", () => {
    expect(mapDerivSymbol("WEIRD_42")).toBeUndefined();
    const def = normalizeActiveSymbol({ symbol: "WEIRD_42", pip: 0.01 }, "deriv");
    expect(def?.canonicalId.startsWith("DERIV_")).toBe(true);
    expect(def?.family).toBeNull();
  });
});
