import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
const ROOT = join(__dirname, "..");
describe("scan, replay and paper code do not reach real broker execution", () => {
  it("keeps the execution provider and order calls out of strategy and backtest packages", () => {
    for (const file of ["packages/strategy/src/index.ts", "packages/backtest/src/index.ts", "packages/backtest/src/replay.ts", "packages/backtest/src/paper.ts"]) {
      const source = readFileSync(join(ROOT,file),"utf8");
      expect(source).not.toMatch(/ExecutionProvider|placeOrder|submitOrder|createOrder/);
    }
  });
  it("does not wire any order submission in the server entry point", () => {
    const server = readFileSync(join(ROOT,"apps/server/src/server.ts"),"utf8");
    expect(server).not.toMatch(/placeOrder|submitOrder|ExecutionProvider/);
  });
});
