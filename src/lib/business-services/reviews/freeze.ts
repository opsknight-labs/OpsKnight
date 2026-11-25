import type { ErrorBudget } from '../slo';

export type FreezeEvaluation = {
  /** Warn, never block: the surface shows it, nothing is gated. */
  warn: boolean;
  level: 'none' | 'at_risk' | 'exhausted';
  message: string | null;
};

/** Error-budget freeze warning from a service's budget. Pure; null budget (no SLO) never warns. */
export function evaluateFreeze(budget: ErrorBudget | null | undefined): FreezeEvaluation {
  if (!budget) return { warn: false, level: 'none', message: null };
  if (budget.burnState === 'BREACHED') {
    return {
      warn: true,
      level: 'exhausted',
      message:
        'Error budget exhausted. Consider pausing risky changes and deploys until reliability recovers.',
    };
  }
  return { warn: false, level: budget.burnState === 'AT_RISK' ? 'at_risk' : 'none', message: null };
}

/** Added to a change's risk score when a service it touches has no error budget left. */
export const BUDGET_EXHAUSTED_RISK_BUMP = 0.15;

export const applyBudgetRisk = (score: number, exhausted: boolean) =>
  exhausted ? Math.round(Math.min(1, score + BUDGET_EXHAUSTED_RISK_BUMP) * 1000) / 1000 : score;
