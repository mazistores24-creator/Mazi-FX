import type { Decision } from "./types";
export type EmergencyAction = "BLOCK_NEW_ENTRIES" | "CANCEL_PENDING_ENTRIES" | "MANAGE_EXISTING" | "CLOSE_ALL";
export interface EmergencyState { blockNewEntries: boolean; cancelPendingEntries: boolean; manageExisting: true; closeAllRequested: boolean; reasons: string[] }
export function emergencyState(actions: readonly EmergencyAction[], reasons: readonly string[] = []): EmergencyState {
  return {
    blockNewEntries: actions.includes("BLOCK_NEW_ENTRIES") || actions.includes("CLOSE_ALL"),
    cancelPendingEntries: actions.includes("CANCEL_PENDING_ENTRIES"),
    manageExisting: true,
    closeAllRequested: actions.includes("CLOSE_ALL"),
    reasons: [...reasons],
  };
}
export function emergencyEntryDecision(state: EmergencyState): Decision {
  return state.blockNewEntries ? { status: "VETO", reasons: state.reasons.length ? state.reasons : ["EMERGENCY_BLOCK_NEW_ENTRIES"] } : { status: "APPROVED" };
}
/** Risk, compliance and news vetoes are combined, never overridden. */
export function combineVetoes(...decisions: readonly Decision[]): Decision {
  const reasons = decisions.flatMap((decision) => decision.status === "VETO" ? decision.reasons : []);
  return reasons.length ? { status: "VETO", reasons: [...new Set(reasons)] } : { status: "APPROVED" };
}
