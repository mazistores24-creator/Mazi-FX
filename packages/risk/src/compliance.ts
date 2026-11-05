import { OPERATING_MODES } from "@mazzi/core";
import type { ComplianceProfile, Decision } from "./types";

export function validateComplianceProfile(profile: ComplianceProfile): Decision {
  if (profile.status !== "VERIFIED") return { status: "VETO", reasons: [profile.status === "RETIRED" ? "COMPLIANCE_PROFILE_RETIRED" : "COMPLIANCE_PROFILE_UNVERIFIED"] };
  if (!profile.id.trim() || !profile.accountType.trim() || !profile.version.trim() || !profile.verifier?.trim() || !profile.verifiedAt || !Number.isFinite(Date.parse(profile.verifiedAt))) return { status: "VETO", reasons: ["COMPLIANCE_PROFILE_INCOMPLETE"] };
  try { if (new URL(profile.sourceUrl).protocol !== "https:") return { status: "VETO", reasons: ["COMPLIANCE_SOURCE_MUST_USE_HTTPS"] }; }
  catch { return { status: "VETO", reasons: ["COMPLIANCE_SOURCE_INVALID"] }; }
  return { status: "APPROVED" };
}

export interface LiveAuthorization { accountId: string; environment: string; authorizedAt: string; active: boolean }
export function mayEnterLive(mode: typeof OPERATING_MODES[number], profile: ComplianceProfile, authorization?: LiveAuthorization): Decision {
  const compliant = validateComplianceProfile(profile);
  if (compliant.status === "VETO") return compliant;
  if (mode !== "AUTOMATED") return { status: "VETO", reasons: ["MODE_DOES_NOT_SUBMIT_LIVE"] };
  if (!authorization?.active || !authorization.accountId || !authorization.environment || !Number.isFinite(Date.parse(authorization.authorizedAt))) return { status: "VETO", reasons: ["LIVE_AUTHORIZATION_REQUIRED"] };
  return { status: "APPROVED" };
}
