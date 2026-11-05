import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const SKIP = new Set(["node_modules", "dist", ".git"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|sql|md|json|yml|yaml)$/.test(name) && !name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

describe("no M1 dependency anywhere", () => {
  it("does not reference the M1 timeframe in source, schema, config or docs", () => {
    const pattern = /(?<![A-Za-z0-9])M1(?![0-9A-Za-z])|['"]1m['"]|\bone[- ]minute\b/i;
    const offenders: string[] = [];
    for (const file of walk(ROOT)) {
      const text = readFileSync(file, "utf8");
      text.split("\n").forEach((line, i) => {
        if (pattern.test(line)) offenders.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
      });
    }
    // A mention of M1 is allowed only on a line that states it is excluded.
    const allowed = /\b(no|not|never|without|absent|excludes?|intentionally|prohibit\w*)\b/i;
    expect(offenders.filter((o) => !allowed.test(o))).toEqual([]);
  });
});
