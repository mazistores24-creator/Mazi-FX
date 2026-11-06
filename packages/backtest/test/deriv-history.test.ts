import { describe, expect, it } from "vitest";
import { utcDateRange } from "../src/deriv-history";

describe("Deriv replay date handling", () => {
  it("covers inclusive UTC date bounds", () => {
    const range = utcDateRange("2025-01-01", "2025-12-31");
    expect(new Date(range.startMs).toISOString()).toBe("2025-01-01T00:00:00.000Z");
    expect(new Date(range.endExclusiveMs).toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
  it("rejects impossible and reversed date inputs", () => {
    expect(() => utcDateRange("2025-02-30", "2025-03-01")).toThrow("INVALID_FROM_DATE");
    expect(() => utcDateRange("2025-02-02", "2025-02-01")).toThrow("INVALID_REPLAY_RANGE");
  });
});
