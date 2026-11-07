import { describe, expect, it } from "vitest";
import { assertDerivAppId } from "../src/config";

describe("deriv app id", () => {
  it("accepts a numeric app id", () => {
    expect(() => assertDerivAppId("1089")).not.toThrow();
  });
  it("accepts an alphanumeric registered app id and UUID-style identifiers", () => {
    expect(() => assertDerivAppId("myApp2025")).not.toThrow();
    expect(() => assertDerivAppId("01a1b14b-892f-7a23-a940-0cf73c95a089")).not.toThrow();
  });
  it("rejects empty or unsafe app ids", () => {
    expect(() => assertDerivAppId("")).toThrow("application ID");
    expect(() => assertDerivAppId("app id")).toThrow("application ID");
    expect(() => assertDerivAppId("app&id=1")).toThrow("application ID");
  });
});
