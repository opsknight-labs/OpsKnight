import Link from 'next/link';
import { ChevronRight, Plus, Server } from 'lucide-react';
import { redirect } from 'next/navigation';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { IntelligenceGroupHeader } from '@/components/settings/layout/IntelligenceGroupHeader';
import {
  AiSettingsForm,
  DeleteProviderButton,
  PromptGuidanceForm,
  ProviderForm,
  TestProviderButton,
} from '@/components/settings/AiSettingsForms';
import { Badge } from '@/components/ui/shadcn/badge';
import { InlineNotice } from '@/components/ui/InlineNotice';
import { dataClassAllows } from '@/lib/intelligence/ai/port';
import EmptyState from '@/components/patterns/EmptyState';
import { Button } from '@/components/ui/shadcn/button';
import { pageHeaderBadgeClass } from '@/components/patterns/PageHeader';
import { toneClasses } from '@/components/patterns/status-tone';
import { LearnMore } from '@/components/settings/layout/LearnMore';
import { NO_VALUE, StatGrid, StatTile } from '@/components/intelligence/overview/primitives';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger';
import { assertCapability } from '@/lib/rbac';
import { CAPABILITIES, hasCapability, type AppRole } from '@/lib/authorization';
import { getAiSettings, listAiProviders } from '@/lib/intelligence/ai/settings';
import { BUILT_IN_PROMPTS, listGuidance, promptHash } from '@/lib/intelligence/ai/prompts';
import { getSemanticIndexStatus } from '@/lib/intelligence/semantic/embedder';
import { listCheckTemplates } from '@/lib/intelligence/assistant/check-templates';
import SquireChecksForm from '@/components/squire/SquireChecksForm';
import AiRoutingForm from '@/components/settings/AiRoutingForm';
import {
  intelligenceSettingsHref,
  intelligenceSettingsPath,
  serializeSearchParams,
  type RouteSearchParams,
} from '@/lib/intelligence/settings/routes';
import ConnectionsSection from '../_sections/ConnectionsSection';
import KnowledgeMemorySection from '../_sections/KnowledgeMemorySection';
import { requirePageAccess } from '@/lib/access/server';

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

export default async function IntelligenceAssistantPage({
  searchParams,
}: {
  searchParams?: Promise<RouteSearchParams>;
}) {
  await requirePageAccess('/settings/intelligence/ai');
  const user = await assertCapability(CAPABILITIES.INTELLIGENCE_READ);
  // Usage, spend and budgets moved to Evaluation & spend; links carrying the spend period follow.
  const params = await searchParams;
  if (params?.spend !== undefined) {
    redirect(`${intelligenceSettingsPath('evaluation')}${serializeSearchParams(params)}#ai-spend`);
  }
  const canManage = hasCapability(user.role as AppRole, CAPABILITIES.INTELLIGENCE_MANAGE);
  const [settings, providers] = await Promise.all([
    getAiSettings(),
    safely('providers', () => listAiProviders()),
  ]);
  const [guidance, semantic, checkTemplates] = await Promise.all([
    safely('prompt guidance', () => listGuidance()),
    settings.embeddingsEnabled
      ? safely('semantic index', () => getSemanticIndexStatus())
      : Promise.resolve(null),
    safely('suggested checks', () => listCheckTemplates()),
  ]);

  // Summaries, stakeholder updates and postmortem drafts send Personal data; without a provider allowed it they never run.
  const personalNotice =
    settings.enabled &&
    providers &&
    !providers.some(p => p.enabled && dataClassAllows(p.maxDataClass, 'PERSONAL')) ? (
      <InlineNotice tone="warning" title="No provider can receive Personal data" className="my-3">
        Summaries, stakeholder updates and postmortem drafts need a provider allowed to receive
        Personal data. Raise an enabled provider&apos;s data limit to Personal, or add one.
      </InlineNotice>
    ) : null;

  return (
    <div className="space-y-6">
      <IntelligenceGroupHeader
        group="assistant"
        title="Assistant and AI"
        badges={
          <span className={pageHeaderBadgeClass}>
            <span
              aria-hidden="true"
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                toneClasses(settings.enabled ? 'ok' : 'neutral').solid
              )}
            />
            {settings.enabled ? 'AI on' : 'AI off'}
          </span>
        }
        about={
          <p>
            Everything is set here: no environment variables. The assistant reads only what you can
            open. Proposed changes require your confirmation and use the same permissions as the
            application. Usage, spend and budgets are under{' '}
            <Link
              href={intelligenceSettingsHref('evaluation', 'usage')}
              className="font-medium text-foreground underline underline-offset-4"
            >
              Evaluation &amp; spend
            </Link>
            .
          </p>
        }
      >
        {`Configure ${settings.squireName}, the in-app assistant, and the models behind it.`}
      </IntelligenceGroupHeader>

      <SettingsSection
        id="assistant"
        title="General"
        description="Both switches are off by default."
      >
        {personalNotice}
        <AiSettingsForm settings={settings} canManage={canManage} />
      </SettingsSection>

      <SettingsSection
        id="providers"
        title="Providers"
        description="Tried in priority order. Each provider has its own limit on the data it may receive."
      >
        {personalNotice}
        {providers && providers.length > 0 ? (
          <ul className="my-4 divide-y divide-border overflow-hidden rounded-lg border border-border">
            {providers.map(provider => (
              <li key={provider.id}>
                <details className="group/provider">
                  <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-3 py-2.5 transition-colors hover:bg-muted/50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                    <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                      <ChevronRight
                        className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150 group-open/provider:rotate-90 motion-reduce:transition-none"
                        aria-hidden="true"
                      />
                      <span className="min-w-0 wrap-break-word">
                        <span className="sr-only">Edit </span>
                        {provider.name}{' '}
                        <span className="font-normal text-muted-foreground">
                          · {provider.model}
                        </span>
                      </span>
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
                  <div className="space-y-3 border-t border-border bg-muted/20 px-3 pb-4">
                    <ProviderForm provider={provider} canManage={canManage} />
                    {canManage && (
                      <div className="flex flex-wrap items-center gap-3">
                        <TestProviderButton id={provider.id} name={provider.name} />
                        <DeleteProviderButton id={provider.id} name={provider.name} />
                      </div>
                    )}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            size="sm"
            variant="simple"
            icon={<Server aria-hidden="true" />}
            title={providers === null ? 'Providers unavailable' : 'No providers yet'}
            description={
              providers === null
                ? 'The provider list could not be loaded. Refresh to try again.'
                : canManage
                  ? 'Add one below to enable AI answers.'
                  : 'Ask someone with intelligence management access to add one.'
            }
          />
        )}
        {canManage && (
          <details className="group/add -mx-4 border-t border-border px-4 md:-mx-6 md:px-6">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 py-3 text-sm font-medium text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              <Plus className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              Add a provider
            </summary>
            <ProviderForm canManage={canManage} />
          </details>
        )}
      </SettingsSection>

      <SettingsSection
        id="model-routing"
        title="Investigation and model routing"
        description="Investigation mode is off by default. Routing is optional: unset capabilities use the provider priority order."
      >
        <AiRoutingForm
          investigationEnabled={settings.squireInvestigationEnabled ?? false}
          spendControlsEnabled={settings.spendControlsEnabled ?? false}
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

      {settings.embeddingsEnabled && (
        <SettingsSection
          title="Semantic search"
          description="Similar incidents are found by meaning as well as wording. Matching never waits for indexing."
          contentClassName="space-y-3 py-4"
        >
          <LearnMore>
            New incidents are indexed in the background. Changing the embedding provider, endpoint
            or model rebuilds recent vectors within your token budget.
          </LearnMore>
          {semantic?.model ? (
            <StatGrid label="Semantic index">
              <StatTile label="Model" value={semantic.modelLabel ?? semantic.model ?? NO_VALUE} />
              <StatTile
                label="Indexed incidents"
                value={semantic.indexed.toLocaleString('en-US')}
              />
              <StatTile
                label="Waiting (last 30 days)"
                value={
                  semantic.pending >= 1000 ? '1,000+' : semantic.pending.toLocaleString('en-US')
                }
              />
            </StatGrid>
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
        id="prompts"
        title="Prompts"
        description="Every instruction sent to a model is versioned and recorded with each AI interaction in the audit log."
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

      <SettingsSection
        id="checks"
        title="Suggested checks"
        description="Investigation prompts shown with incident answers when the title matches a pattern. Suggestions only; nothing is executed."
      >
        <SquireChecksForm templates={checkTemplates ?? []} canManage={canManage} />
      </SettingsSection>

      <ConnectionsSection canManage={canManage} />

      <KnowledgeMemorySection canManage={canManage} />

      <SettingsSection
        id="proactive"
        title="Proactive help"
        description="Briefings, update reminders and postmortem drafts. Off by default and turned on per service."
        contentClassName="py-4"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Open a service and choose “Squire: proactive help and learned facts”. The same page
            lists the facts people confirmed about that service.
          </p>
          <Button asChild variant="outline" className="min-h-11 shrink-0 sm:min-h-10">
            <Link href={intelligenceSettingsHref('services', 'service-policies')}>
              Per-service policies
            </Link>
          </Button>
        </div>
      </SettingsSection>
    </div>
  );
}
