import type { SetupState } from "@mazzi/core";

/**
 * Setup lifecycle. Every permitted transition is listed here; anything else throws.
 * Terminal states (EXPIRED, INVALIDATED, CLOSED) have no outgoing edges, so a terminal setup
 * is never re-entered. A new setup gets a new id.
 */
export const TRANSITIONS: Readonly<Record<SetupState, readonly SetupState[]>> = Object.freeze({
  SCANNING: ["STRUCTURE_FOUND"],
  STRUCTURE_FOUND: ["ZONE_ARMED", "EXPIRED", "INVALIDATED"],
  ZONE_ARMED: ["AWAITING_M5", "EXPIRED", "INVALIDATED"],
  AWAITING_M5: ["CONFIRMED", "EXPIRED", "INVALIDATED"],
  CONFIRMED: ["CLOSED"],
  EXPIRED: [],
  INVALIDATED: [],
  CLOSED: [],
});

export const TERMINAL_STATES: readonly SetupState[] = ["EXPIRED", "INVALIDATED", "CLOSED"];

export function isTerminal(state: SetupState): boolean {
  return TERMINAL_STATES.includes(state);
}

export function canTransition(from: SetupState, to: SetupState): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface TransitionRecord {
  from: SetupState | null;
  to: SetupState;
  reason: string;
}

/** Forward-only applier. Throws on any transition the table does not allow. */
export function applyTransition(from: SetupState, to: SetupState, reason: string): TransitionRecord {
  if (!canTransition(from, to)) throw new Error(`forbidden setup transition ${from} -> ${to}`);
  if (!reason) throw new Error("transition needs a reason");
  return { from, to, reason };
}

/**
 * Turns an ordered list of states into persisted transition records. Only real changes are
 * recorded, and each change must be permitted. Used by the runner to write setup_transitions.
 */
export function transitionsFromSequence(states: readonly { state: SetupState; reason: string }[]): TransitionRecord[] {
  const out: TransitionRecord[] = [];
  let prev: SetupState = "SCANNING";
  for (const s of states) {
    if (s.state === prev) continue;
    out.push(applyTransition(prev, s.state, s.reason));
    prev = s.state;
  }
  return out;
}
