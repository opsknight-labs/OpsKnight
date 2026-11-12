import 'server-only';
import prisma from '@/lib/prisma';
import {
  getBudgetStatuses,
  getSpendBreakdown,
  listBudgets,
  listModelPriceOverrides,
  type AiBudgetView,
  type BudgetStatus,
  type SpendBreakdown,
} from './cost';
import { resolveModelPrice, type ModelPriceOverride, type ProviderKind } from './pricing';
import type { AiProviderView } from './settings';

export interface ConfiguredModelPriceView {
  providerKind: string;
  model: string;
  provider: string;
  inputUsdPerMTok: number | null;
  outputUsdPerMTok: number | null;
  source: 'override' | 'built-in' | null;
}

export interface AiCostView {
  breakdown: SpendBreakdown;
  statuses: BudgetStatus[];
  budgets: AiBudgetView[];
  teams: Array<{ id: string; name: string }>;
  overrides: ModelPriceOverride[];
  configuredPrices: ConfiguredModelPriceView[];
}

const TEAM_OPTION_LIMIT = 500;

/** Everything the "Spend and budgets" and "Model prices" sections render, in one bounded load. */
export async function loadAiCostView(
  days: 7 | 30,
  globalTokenBudget: number,
  providers: readonly AiProviderView[],
  now: Date = new Date()
): Promise<AiCostView> {
  const [breakdown, statuses, budgets, teams, overrides] = await Promise.all([
    getSpendBreakdown(days, now),
    getBudgetStatuses(globalTokenBudget, now),
    listBudgets(),
    prisma.team.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: TEAM_OPTION_LIMIT,
    }),
    listModelPriceOverrides(),
  ]);
  const labels = new Map(budgets.map(budget => [budget.key, budget.label]));
  const configuredPrices = providers.flatMap(provider =>
    [provider.model, provider.embeddingModel]
      .filter((model): model is string => Boolean(model))
      .map(model => {
        const price = resolveModelPrice(provider.kind as ProviderKind, model, overrides);
        return {
          providerKind: provider.kind,
          model,
          provider: provider.name,
          inputUsdPerMTok: price?.inputUsdPerMTok ?? null,
          outputUsdPerMTok: price?.outputUsdPerMTok ?? null,
          source: price?.source ?? null,
        };
      })
  );
  return {
    breakdown,
    statuses: statuses.map(status => ({
      ...status,
      label: labels.get(status.key) ?? status.label,
    })),
    budgets,
    teams,
    overrides,
    configuredPrices,
  };
}
