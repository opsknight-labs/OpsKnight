import Link from 'next/link';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import {
  AiSettingsForm,
  DeleteProviderButton,
  PromptGuidanceForm,
  ProviderForm,
  TestProviderButton,
} from '@/components/settings/AiSettingsForms';
import { Badge } from '@/components/ui/shadcn/badge';
import { logger } from '@/lib/logger';
import { assertCapability } from '@/lib/rbac';
import { CAPABILITIES, hasCapability, type AppRole } from '@/lib/authorization';
import { getTodayUsage, getUsageHistory } from '@/lib/intelligence/ai/budget';
import AiUsageChart from '@/components/settings/AiUsageChart';
import { getAiSettings, listAiProviders } from '@/lib/intelligence/ai/settings';
import { BUILT_IN_PROMPTS, listGuidance, promptHash } from '@/lib/intelligence/ai/prompts';
import { getSemanticIndexStatus } from '@/lib/intelligence/semantic/embedder';
import { listCheckTemplates } from '@/lib/intelligence/assistant/check-templates';
import SquireChecksForm from '@/components/squire/SquireChecksForm';
import { backgroundEmbeddingTokenBudget } from '@/lib/intelligence/ai/contract';
import AiRoutingForm from '@/components/settings/AiRoutingForm';
import { loadAiCostView } from '@/lib/intelligence/ai/cost-view';
import AiSpendPanel from '@/components/settings/AiSpendPanel';
import { AiBudgetsForm, AiModelPricesForm } from '@/components/settings/AiCostForms';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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

export default async function IntelligenceAiPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await assertCapability(CAPABILITIES.INTELLIGENCE_READ);
  const spendDays = (await searchParams)?.spend === '30' ? 30 : 7;
  const canManage = hasCapability(user.role as AppRole, CAPABILITIES.INTELLIGENCE_MANAGE);
  const [settings, providers, usage, history] = await Promise.all([
    getAiSettings(),
    safely('providers', () => listAiProviders()),
    safely('usage', () => getTodayUsage()),
    safely('usage history', () => getUsageHistory(14)),
  ]);
  const [guidance, semantic, checkTemplates] = await Promise.all([
    safely('prompt guidance', () => listGuidance()),
    settings.embeddingsEnabled
      ? safely('semantic index', () => getSemanticIndexStatus())
      : Promise.resolve(null),
    safely('suggested checks', () => listCheckTemplates()),
  ]);
  const cost = await safely('spend and budgets', () =>
    loadAiCostView(spendDays, settings.dailyTokenBudget, providers ?? [])
  );
  const used = usage ? usage.inputTokens + usage.outputTokens : 0;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Assistant and AI</h1>
        <p className="text-sm text-muted-foreground">
          Configure {settings.squireName}, the in-app assistant, and the language models behind it.
          Everything is set here: no environment variables. The assistant reads only what you can
          open. Proposed changes require your confirmation and use the same permissions as the
          application.
        </p>
      </header>

      <SettingsSection
        title="General"
        description="Both switches are off by default."
        action={
          <Badge variant={settings.enabled ? 'default' : 'secondary'}>
            {settings.enabled ? 'AI on' : 'AI off'}
          </Badge>
        }
      >
        <AiSettingsForm settings={settings} canManage={canManage} />
      </SettingsSection>

      <SettingsSection
        title="Investigation and model routing"
        description="Investigation mode is off by default. Routing is optional: unset capabilities use the provider priority order."
      >
        <AiRoutingForm
          investigationEnabled={settings.squireInvestigationEnabled ?? false}
          routing={settings.capabilityRouting ?? {}}
          providers={(providers ?? []).map(provider => ({
            id: provider.id,
            name: provider.name,
            model: provider.model,
            enabled: provider.enabled,
          }))}
          revision={settings.revision}
          canManage={canManage}
        />
      </SettingsSection>

      <SettingsSection
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
          <p className="py-3 text-sm text-muted-foreground">Spend is unavailable right now.</p>
        )}
      </SettingsSection>

      <SettingsSection
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

      {settings.embeddingsEnabled && (
        <SettingsSection
          title="Semantic search"
          description="Similar incidents are found by meaning as well as wording. New incidents are indexed in the background; matching never waits for it. Changing the embedding provider, endpoint or model rebuilds recent vectors within your token budget."
        >
          {semantic?.model ? (
            <dl className="grid gap-4 py-3 sm:grid-cols-3">
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Model</dt>
                <dd className="break-all text-sm font-medium">
                  {semantic.modelLabel ?? semantic.model}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Indexed incidents
                </dt>
                <dd className="text-lg font-semibold">
                  {semantic.indexed.toLocaleString('en-US')}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Waiting (last 30 days)
                </dt>
                <dd className="text-lg font-semibold">
                  {semantic.pending >= 1000 ? '1,000+' : semantic.pending.toLocaleString('en-US')}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="py-3 text-sm text-muted-foreground">
              {semantic === null
                ? 'Status is unavailable right now.'
                : 'Not active: enable Intelligence and AI, and give an enabled provider an embedding model. Masked titles can still contain names. That provider must be allowed to receive Personal data and be in an allowed region.'}
            </p>
          )}
        </SettingsSection>
      )}

      <SettingsSection
        title="Providers"
        description="Tried in priority order. Each provider has its own limit on the data it may receive."
      >
        {providers && providers.length > 0 ? (
          <ul className="divide-y divide-border">
            {providers.map(provider => (
              <li key={provider.id} className="py-3">
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium">
                      {provider.name}{' '}
                      <span className="text-muted-foreground">· {provider.model}</span>
                    </span>
                    <span className="flex gap-2">
                      <Badge variant={provider.enabled ? 'default' : 'secondary'}>
                        {provider.enabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                      <Badge variant="outline">
                        {provider.isExternal ? 'External' : 'Self-hosted'}
                      </Badge>
                    </span>
                  </summary>
                  <ProviderForm provider={provider} canManage={canManage} />
                  {canManage && (
                    <div className="flex flex-wrap items-center gap-3">
                      <TestProviderButton id={provider.id} name={provider.name} />
                      <DeleteProviderButton id={provider.id} name={provider.name} />
                    </div>
                  )}
                </details>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-3 text-sm text-muted-foreground">
            No providers yet. Add one to enable AI answers.
          </p>
        )}
        {canManage && (
          <details className="border-t border-border">
            <summary className="cursor-pointer py-3 text-sm font-medium">Add a provider</summary>
            <ProviderForm canManage={canManage} />
          </details>
        )}
      </SettingsSection>
      <SettingsSection
        title="Suggested checks"
        description="Investigation prompts the assistant shows with incident answers, with or without AI, when the incident title matches a pattern. They are suggestions only; nothing is executed."
      >
        <SquireChecksForm templates={checkTemplates ?? []} canManage={canManage} />
      </SettingsSection>
      <SettingsSection
        title="Prompts"
        description="Every instruction sent to a model is versioned. The version and fingerprint are recorded with each AI interaction in the audit log."
      >
        <ul className="divide-y divide-border">
          {BUILT_IN_PROMPTS.map(prompt => {
            const saved = guidance?.get(prompt.id);
            return (
              <li key={prompt.id} className="space-y-3 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{prompt.title}</p>
                    <p className="text-xs text-muted-foreground">{prompt.purpose}</p>
                  </div>
                  <span className="flex gap-2">
                    <Badge variant="outline">v{prompt.version}</Badge>
                    <Badge variant="outline" title="Content fingerprint">
                      {promptHash(prompt.id)}
                    </Badge>
                  </span>
                </div>
                <details>
                  <summary className="cursor-pointer text-xs text-muted-foreground">
                    Show built-in rules
                  </summary>
                  <pre className="mt-2 whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
                    {prompt.rules}
                  </pre>
                </details>
                <PromptGuidanceForm
                  promptId={prompt.id}
                  text={saved?.text ?? ''}
                  revision={saved?.revision ?? 0}
                  canManage={canManage}
                />
              </li>
            );
          })}
        </ul>
      </SettingsSection>
      {/* Squire knowledge memory (F4). */}
      <SettingsSection
        title="Knowledge memory"
        description="Let Squire search what your organisation already learned: postmortems, resolution and incident notes, runbook steps and confirmed service facts. Off by default."
      >
        <Link href="/settings/intelligence/ai/memory" className="text-sm underline">
          Manage Squire’s knowledge index
        </Link>
      </SettingsSection>
    </div>
  );
}
