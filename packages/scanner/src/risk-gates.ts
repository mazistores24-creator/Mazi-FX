import { combineVetoes } from "@mazzi/risk";
import type { Decision } from "@mazzi/risk";
import type { AlertRiskGates, Phase5RiskResults } from "./types";

/** Injectable adapter that keeps the scanner's alert decision fail-closed across every Phase 5 gate. */
export class Phase5RiskGateAdapter implements AlertRiskGates {
  constructor(private readonly assessAll: (input: Parameters<AlertRiskGates["assess"]>[0]) => Promise<Phase5RiskResults>) {}
  async assess(input: Parameters<AlertRiskGates["assess"]>[0]): Promise<Phase5RiskResults> {
    const result = await this.assessAll(input);
    const combined: Decision = combineVetoes(result.risk, result.compliance, result.news, result.emergency);
    return { ...result, risk: combined };
  }
}
