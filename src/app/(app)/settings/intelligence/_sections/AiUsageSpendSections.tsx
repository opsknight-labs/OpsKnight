import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { logger } from '@/lib/logger';
import { getTodayUsage, getUsageHistory } from '@/lib/intelligence/ai/budget';
import AiUsageChart from '@/components/settings/AiUsageChart';
import { getAiSettings, listAiProviders } from '@/lib/intelligence/ai/settings';
import { backgroundEmbeddingTokenBudget } from '@/lib/intelligence/ai/contract';
import { loadAiCostView } from '@/lib/intelligence/ai/cost-view';
import AiSpendPanel from '@/components/settings/AiSpendPanel';
import { AiBudgetsForm, AiModelPricesForm } from '@/components/settings/AiCostForms';

async function safely<T>(label: string, load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    logger.warn(`[Intelligence] AI settings could not load ${label}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * AI usage, dollar spend, budgets and model prices, for the Evaluation & spend page (moved from the
 * Assistant page so configuration and its cost are no longer interleaved). The caller has already
 * checked `intelligence.read`.
 */
export default async function AiUsageSpendSections({
  canManage,
  spendDays,
}: {
  canManage: boolean;
  spendDays: 7 | 30;
}) {
  const [settings, providers, usage, history] = await Promise.all([
    safely('settings', () => getAiSettings()),
    safely('providers', () => listAiProviders()),
    safely('usage', () => getTodayUsage()),
    safely('usage history', () => getUsageHistory(14)),
  ]);
  if (!settings) {
    return (
      <SettingsSection id="usage" title="Usage">
        <p className="py-3 text-sm text-muted-foreground">
          AI usage is unavailable right now. Refresh to try again.
        </p>
      </SettingsSection>
    );
  }
  const cost = await safely('spend and budgets', () =>
    loadAiCostView(spendDays, settings.dailyTokenBudget, providers ?? [])
  );
  const used = usage ? usage.inputTokens + usage.outputTokens : 0;

  return (
    <>
      <SettingsSection
        id="usage"
        title="Usage"
        description="Today's totals reset at 00:00 UTC. Red bars reached the daily budget."
      >
        <div className="grid gap-4 py-3 sm:grid-cols-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Requests</p>
            <p className="text-lg font-semibold">{usage ? usage.requests : 'Unavailable'}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Tokens</p>
            <p className="text-lg font-semibold">
              {usage ? used.toLocaleString('en-US') : 'Unavailable'}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Daily budget</p>
            <p className="text-lg font-semibold">
              {settings.dailyTokenBudget.toLocaleString('en-US')}
            </p>
          </div>
        </div>
        {history && <AiUsageChart history={history} budget={settings.dailyTokenBudget} />}
        <p className="py-2 text-sm text-muted-foreground">
          Background embedding:{' '}
          {usage ? usage.backgroundEmbeddingTokens.toLocaleString('en-US') : 'Unavailable'}
          {' / '}
          {backgroundEmbeddingTokenBudget(settings).toLocaleString('en-US')} tokens today (
          {settings.backgroundEmbeddingBudgetPercent}% of the total allowance). When its allocation
          is reached, backfills wait and existing vectors remain searchable.
        </p>
      </SettingsSection>

      <SettingsSection
        title="Spend and budgets"
        description="Dollar spend by team, capability and model, from token counts and the prices below. A call is charged to the incident's team, or else to the person's first team. Optional daily budgets per team or capability are enforced with the global budget: at the limit, new AI requests in that scope are refused until 00:00 UTC and answers fall back to basic mode."
      >
        {cost ? (
          <>
            <AiSpendPanel breakdown={cost.breakdown} statuses={cost.statuses} />
            <AiBudgetsForm budgets={cost.budgets} teams={cost.teams} canManage={canManage} />
          </>
        ) : (
          <p id="ai-spend" className="scroll-mt-24 py-3 text-sm text-muted-foreground">
            Spend is unavailable right now.
          </p>
        )}
      </SettingsSection>

      <SettingsSection
        id="model-prices"
        title="Model prices"
        description="US dollars per million tokens. Built-in list prices cover common hosted models; set your own for negotiated, regional or self-hosted rates. A model with no price still counts toward token budgets."
      >
        {cost ? (
          <AiModelPricesForm
            configured={cost.configuredPrices}
            overrides={cost.overrides}
            canManage={canManage}
          />
        ) : (
          <p className="py-3 text-sm text-muted-foreground">Prices are unavailable right now.</p>
        )}
      </SettingsSection>
    </>
  );
}
