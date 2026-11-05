/** Exponential backoff with a ceiling and optional deterministic jitter. attempt starts at 0. */
export function computeBackoffMs(
  attempt: number,
  baseMs = 1000,
  maxMs = 60000,
  jitter: () => number = () => 1,
): number {
  if (!Number.isInteger(attempt) || attempt < 0) {
    throw new RangeError("attempt must be a non-negative integer");
  }
  const exponent = Math.min(attempt, 30);
  const raw = Math.min(maxMs, baseMs * 2 ** exponent);
  const factor = Math.min(1, Math.max(0, jitter()));
  return Math.round(raw * factor);
}
