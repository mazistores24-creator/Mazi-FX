import type { Scanner } from "@mazzi/scanner";
import type { PaperTradingEngine, BacktestResult } from "@mazzi/backtest";
import type { ExecutionStateStore } from "@mazzi/deriv-adapter";
import { checkDrawdown, evaluateLossPause, tradingDateET } from "@mazzi/risk";
import { estimateExpectancy } from "@mazzi/quant";
import type { DashboardPerformance, DashboardRiskState, DashboardSetup, DashboardExecutionState } from "./app";

export interface DashboardRiskInput {
  mode: "DAY" | "SWING" | "POSITION";
  referenceEquity: number;
  currentEquity: number;
  additionalCosts?: number;
  submitted: number;
  tradeLimit: number;
  outcomes: readonly { mode: "DAY" | "SWING" | "POSITION"; closedAt: string; realizedNetPnl: number }[];
  asOf: Date;
}

export interface Phase9DashboardRuntime {
  scanner?: Scanner;
  risk?: () => DashboardRiskInput | null;
  paper?: PaperTradingEngine;
  paperInstrument?: string;
  backtest?: BacktestResult;
  execution?: ExecutionStateStore;
}

/** Adapts real package instances into the authenticated, read-only dashboard contract. */
export function createDashboardProviders(runtime: Phase9DashboardRuntime) {
  return {
    setups: (): readonly DashboardSetup[] => runtime.scanner?.dashboardSetups() ?? [],
    risk: (): DashboardRiskState | null => {
      const input = runtime.risk?.();
      if (!input) return null;
      const drawdown = checkDrawdown(input.mode, {
        referenceEquity: input.referenceEquity,
        currentEquity: input.currentEquity,
        additionalCosts: input.additionalCosts,
      });
      const lossPause = evaluateLossPause(input.mode, input.outcomes, input.asOf);
      return {
        mode: input.mode,
        tradingDate: tradingDateET(input.asOf),
        drawdownPct: drawdown.drawdownPct,
        drawdownAmount: drawdown.drawdownAmount,
        drawdownLimitPct: drawdown.limitPct,
        tradeCount: input.submitted,
        tradeLimit: input.tradeLimit,
        consecutiveLosses: lossPause.consecutiveLosses,
        paused: lossPause.paused,
        resumeAtET: lossPause.resumeAtET,
      };
    },
    performance: (): DashboardPerformance => {
      const result: DashboardPerformance = {};
      if (runtime.paper) {
        const paper = runtime.paper.snapshot();
        result.paper = {
          equity: paper.equity,
          openPosition: paper.openPosition ? { instrument: runtime.paperInstrument ?? "unknown", direction: paper.openPosition.direction } : null,
        };
      }
      if (runtime.backtest) {
        const backtest = runtime.backtest;
        const stats = backtest.stats;
        const expectancy = estimateExpectancy(backtest.expectancyTrades, {
          dataSource: "deterministic backtest result",
          costAssumptions: "as configured in backtest input",
          evaluation: "SIMULATED",
        }, { resamples: 1000, seed: 0x4d415a5a });
        result.backtest = { tradeCount: stats.tradeCount, winRate: stats.winRate, netR: stats.netR, maxDrawdownPct: stats.maxDrawdownPct };
        result.expectancy = {
          status: expectancy.status,
          tradeCount: expectancy.tradeCount,
          expectancyR: expectancy.expectancyR,
          confidenceInterval: expectancy.confidenceInterval,
        };
      }
      return result;
    },
    execution: async (): Promise<DashboardExecutionState> => {
      if (!runtime.execution) return { orders: [] };
      const orders = await runtime.execution.listPending();
      return { orders: orders.map((order) => ({
        clientOrderId: order.clientOrderId,
        brokerContractId: order.brokerContractId,
        instrument: order.instrument,
        direction: order.direction,
        status: order.status,
        updatedAt: order.updatedAt,
      })) };
    },
  };
}
