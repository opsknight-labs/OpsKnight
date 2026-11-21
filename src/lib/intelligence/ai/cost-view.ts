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
import type { CapabilityRouting } from './routing';

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
  routing: CapabilityRouting = {},
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
  // Every model that is configured, routed to for a capability, or billed in the period: a model reached
  // only through routing (a cheaper one for summaries) still needs its price on show.
  const byId = new Map(providers.map(provider => [provider.id, provider]));
  const models = new Map<string, { kind: string; model: string; provider: string }>();
  const add = (kind: string, model: string | null | undefined, provider: string) => {
    if (model && !models.has(`${kind}:${model}`)) models.set(`${kind}:${model}`, { kind, model, provider });
  };
  for (const provider of providers) {
    add(provider.kind, provider.model, provider.name);
    add(provider.kind, provider.embeddingModel, provider.name);
  }
  for (const route of Object.values(routing)) {
    const provider = route?.model ? byId.get(route.providerId) : undefined;
    if (provider) add(provider.kind, route!.model, provider.name);
  }
  for (const slice of breakdown.byModel) {
    const at = slice.key.indexOf(':');
    if (at <= 0) continue; // the folded "Other" slice
    const kind = slice.key.slice(0, at);
    add(kind, slice.key.slice(at + 1), providers.find(p => p.kind === kind)?.name ?? kind);
  }
  const configuredPrices = [...models.values()].map(({ kind, model, provider }) => {
    const price = resolveModelPrice(kind as ProviderKind, model, overrides);
    return {
      providerKind: kind,
      model,
      provider,
      inputUsdPerMTok: price?.inputUsdPerMTok ?? null,
      outputUsdPerMTok: price?.outputUsdPerMTok ?? null,
      source: price?.source ?? null,
    };
  });
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
