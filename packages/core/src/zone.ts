import { PROTECTED_STRATEGY } from "./constants";

/** Throws unless the supplied zone bounds equal the protected baseline. */
export function assertProtectedZone(lower: number, upper: number): void {
  const p = PROTECTED_STRATEGY.fibZone;
  if (lower !== p.lower || upper !== p.upper) {
    throw new Error(
      `fib baseline zone is protected and must stay ${p.lower * 100}.0 to ${p.upper * 100}.0 percent`,
    );
  }
}
