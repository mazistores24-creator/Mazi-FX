#!/usr/bin/env node
import { performance } from "node:perf_hooks";

// Deterministic offline synthetic load test. Exercises bounded request parsing and
// aggregation without sockets, credentials, or live services.
const iterations = Number(process.env.MAZZI_LOAD_ITERATIONS ?? 25_000);
if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 1_000_000) {
  throw new RangeError("MAZZI_LOAD_ITERATIONS must be an integer from 1 to 1000000");
}
const seed = 0x4d415a5a;
let state = seed >>> 0;
function next() {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return state;
}
const started = performance.now();
let checksum = 0;
let accepted = 0;
for (let i = 0; i < iterations; i++) {
  const item = { id: next(), instrument: `SYN_${next() % 100}`, value: (next() % 1_000_000) / 100, complete: (next() % 3) !== 0 };
  if (item.complete && Number.isFinite(item.value)) {
    accepted++;
    checksum = (checksum + item.id + Math.trunc(item.value * 100)) >>> 0;
  }
}
const elapsedMs = performance.now() - started;
console.log(JSON.stringify({ test: "offline-load", seed, iterations, accepted, checksum, elapsedMs: Number(elapsedMs.toFixed(3)), requestsPerSecond: Math.round(iterations / Math.max(elapsedMs / 1000, 0.000001)) }));
