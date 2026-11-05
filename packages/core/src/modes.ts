import { OPERATING_MODES } from "./constants";

export type OperatingMode = (typeof OPERATING_MODES)[number];

export function isOperatingMode(value: string): value is OperatingMode {
  return (OPERATING_MODES as readonly string[]).includes(value);
}

export type ExecutionPath = "NONE" | "BROKER_ORDER";

/**
 * Maps a mode to whether it can reach the broker. Scan, alert and paper never can.
 * AUTOMATED is rejected at config load in this build, so it is not reachable either.
 */
export function executionPathFor(mode: OperatingMode | "SCAN_ONLY" | null, _unused: unknown): ExecutionPath {
  if (mode === "SCAN_ONLY" || mode === "ALERT_ONLY" || mode === "PAPER") return "NONE";
  return "NONE";
}
