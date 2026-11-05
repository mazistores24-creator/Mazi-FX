import { describe, expect, it } from "vitest";
import type { SetupEvaluator } from "../src";

describe("strategy contracts", () => {
  it("accepts a conforming evaluator stub", () => {
    const stub: SetupEvaluator = {
      next: (input) => ({ state: input.currentState, reason: "stub" }),
    };
    expect(stub.next({ currentState: "SCANNING", barsSinceArmed: 0, m5Confirmed: false }).state).toBe("SCANNING");
  });
});
