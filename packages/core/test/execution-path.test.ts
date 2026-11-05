import { describe, expect, it } from "vitest";
import { executionPathFor } from "../src";

describe("modes have no execution path", () => {
  it.each(["SCAN_ONLY", "ALERT_ONLY", "PAPER"] as const)("%s cannot reach the broker", (mode) => {
    expect(executionPathFor(mode, null)).toBe("NONE");
  });
});
