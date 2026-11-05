import { describe, expect, it } from "vitest";
import { assertDerivAppId } from "../src/config";

describe("deriv app id", () => {
  it("accepts a numeric app id", () => {
    expect(() => assertDerivAppId("1089")).not.toThrow();
  });
  it("rejects a non-numeric app id", () => {
    expect(() => assertDerivAppId("abc")).toThrow("numeric");
  });
});
