#!/usr/bin/env node
import { performance } from "node:perf_hooks";

// Deterministic endurance soak. Every iteration is CPU/local state only; duration
// and scale are explicit so CI and developer runs remain bounded.
const durationSeconds = Number(process.env.MAZZI_ENDURANCE_SECONDS ?? 5);
const operationsPerTick = Number(process.env.MAZZI_ENDURANCE_OPS_PER_TICK ?? 10_000);
if (!Number.isFinite(durationSeconds) || durationSeconds < 1 || durationSeconds > 3600) {
  throw new RangeError("MAZZI_ENDURANCE_SECONDS must be between 1 and 3600");
}
if (!Number.isSafeInteger(operationsPerTick) || operationsPerTick < 1 || operationsPerTick > 1_000_000) {
  throw new RangeError("MAZZI_ENDURANCE_OPS_PER_TICK must be an integer from 1 to 1000000");
}
let state = 0x4d415a5a >>> 0;
let checksum = 0;
let operations = 0;
const started = performance.now();
const deadline = started + durationSeconds * 1000;
const tickDurations = [];
while (performance.now() < deadline) {
  const tickStart = performance.now();
  for (let i = 0; i < operationsPerTick; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    checksum = (checksum + (state ^ i)) >>> 0;
  }
  operations += operationsPerTick;
  tickDurations.push(performance.now() - tickStart);
}
const elapsedMs = performance.now() - started;
tickDurations.sort((a, b) => a - b);
console.log(JSON.stringify({ test: "offline-endurance", seed: "0x4d415a5a", durationSeconds, operationsPerTick, operations, checksum, elapsedMs: Number(elapsedMs.toFixed(3)), tickP95Ms: Number((tickDurations[Math.floor((tickDurations.length - 1) * 0.95)] ?? 0).toFixed(3)), ticks: tickDurations.length }));
