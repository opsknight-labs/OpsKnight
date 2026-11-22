import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { IntelligenceGroupHeader } from '@/components/settings/layout/IntelligenceGroupHeader';
import { RuleSuggestionsPanel } from '@/components/settings/InsightsForms';
import {
  IntelligencePolicyForm,
  IntelligenceSettingsForm,
  ReplayForm,
  RollbackForm,
  TriagePolicyForm,
} from '@/components/settings/IntelligenceSettingsForms';
import CorrelationRulesEditor from '@/components/settings/CorrelationRulesEditor';
import OpsInsightsSettingsForm from '@/components/settings/OpsInsightsSettingsForm';
import IntelligenceSetupChecklist from '@/components/settings/IntelligenceSetupChecklist';
import DigestSection from './_sections/DigestSection';
import { Badge } from '@/components/ui/shadcn/badge';
import { LearnMore } from '@/components/settings/layout/LearnMore';
import { NO_VALUE, StatGrid, StatTile } from '@/components/intelligence/overview/primitives';
import { pageHeaderBadgeClass } from '@/components/patterns/PageHeader';
import { toneClasses, type ToneKey } from '@/components/patterns/status-tone';
import RelativeTime from '@/components/patterns/RelativeTime';
import { AlertTriangle, History } from 'lucide-react';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger';
import { assertCapability } from '@/lib/rbac';
import { CAPABILITIES, hasCapability, type AppRole } from '@/lib/authorization';
import { AUTO_MODE_AVAILABLE } from '@/lib/intelligence/contract';
import { getCriticalBacklogLagMs } from '@/lib/intelligence/jobs/backpressure';
import { getWorkBacklog, listDeadLetters } from '@/lib/intelligence/jobs/work-queue';
import {
  getIntelligenceSettings,
  listPolicyVersions,
  resolveEffectivePolicy,
} from '@/lib/intelligence/settings/service';
import { getSetupState } from '@/lib/intelligence/settings/setup';
import { setupChecklist } from '@/lib/intelligence/settings/setup-contract';
import { detectCapabilities } from '@/lib/intelligence/similarity/capabilities';
import { getOpsKnightProcessRole } from '@/lib/runtime-role';
import { requirePageAccess } from '@/lib/access/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** A failing probe degrades one card; it must never take the settings page down. */
async function safely<T>(label: string, load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    logger.warn(`[Intelligence] Settings page could not load ${label}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

const formatAge = (ms: number | null) => {
  if (ms === null) return 'none waiting';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  return `${Math.round(ms / 60_000)} min`;
};

/** A stat hint that carries a tone (icon + text), for a degraded lane. */
function ToneHint({ tone, children }: { tone: ToneKey; children: string }) {
  return (
    <span className={cn('inline-flex items-start gap-1', toneClasses(tone).text)}>
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {children}
    </span>
  );
}

/** Header pill: a tone dot and a label on the dark band. */
function HeaderPill({ tone, children }: { tone: ToneKey; children: string }) {
  return (
    <span className={pageHeaderBadgeClass}>
      <span
        aria-hidden="true"
        className={cn('h-1.5 w-1.5 rounded-full', toneClasses(tone).solid)}
      />
      {children}
    </span>
  );
}

export default async function IntelligenceSettingsPage() {
  await requirePageAccess('/settings/intelligence');
  const user = await assertCapability(CAPABILITIES.INTELLIGENCE_READ);
  const canManage = hasCapability(user.role as AppRole, CAPABILITIES.INTELLIGENCE_MANAGE);

  const [settings, policy, versions, backlog, capabilities, criticalLagMs, deadLetters, setup] =
    await Promise.all([
      getIntelligenceSettings(),
      safely('policy', () => resolveEffectivePolicy(null)),
      safely('policy history', () => listPolicyVersions({}, { limit: 10 })),
      safely('queue backlog', () => getWorkBacklog()),
      safely('capabilities', () => detectCapabilities()),
      safely('paging lag', () => getCriticalBacklogLagMs()),
      safely('dead letters', () => listDeadLetters({ limit: 10 })),
      safely('setup checklist', () => getSetupState()),
    ]);

  const headVersion = versions?.headVersion ?? 0;
  const hasFailedWork = Boolean(deadLetters && deadLetters.length > 0);
  const triageEnabled = policy?.definition.triage.enabled ?? false;
  const showSetup = Boolean(setup && setupChecklist(setup).some(item => !item.on));

  const sharedProcess =
    ['integrated', 'worker', 'general-worker'].includes(getOpsKnightProcessRole()) &&
    process.env.OPSKNIGHT_INTELLIGENCE_DEDICATED !== 'true';
  const lagThreshold = settings.backpressureEscalationLagMs;
  const lagHigh = criticalLagMs !== null && criticalLagMs > lagThreshold;

  return (
    <div className="space-y-6">
      <IntelligenceGroupHeader
        group="engine"
        title="Intelligence"
        visible={[
          ...(showSetup ? ['setup'] : []),
          'lane-health',
          'general',
          'operations-insights',
          'digest',
          'global-policy',
          'triage',
          'correlation-rules',
          ...(hasFailedWork ? ['failed-work'] : []),
        ]}
        badges={
          <>
            <HeaderPill tone={settings.enabled ? 'ok' : 'neutral'}>
              {settings.enabled ? 'Enabled' : 'Disabled'}
            </HeaderPill>
            {policy && <HeaderPill tone="neutral">{`Mode ${policy.effectiveMode}`}</HeaderPill>}
          </>
        }
        about={
          <>
            <p>
              Learns from your incident history to suggest similar past incidents, related
              incidents, possible causes and runbooks. It runs entirely off the paging path: it
              never delays escalation or notifications.
            </p>
            <p>
              Certified service AUTO adds reversible related links after paging. Turning it off
              stops analysis; existing accepted links remain available to undo.
            </p>
          </>
        }
      >
        Suggestions from your incident history, kept off the paging path.
      </IntelligenceGroupHeader>

      {setup && <IntelligenceSetupChecklist state={setup} canManage={canManage} />}

      <SettingsSection
        id="lane-health"
        title="Lane health"
        description="Live health of the intelligence lane. Paging never waits for it."
        contentClassName="py-4"
        footer={
          sharedProcess ? (
            <p role="status" className="flex items-start gap-2 text-sm text-foreground">
              <AlertTriangle
                className={cn('mt-0.5 h-4 w-4 shrink-0', toneClasses('elevated').text)}
                aria-hidden="true"
              />
              Intelligence shares this process with paging work. For isolated capacity, use the
              dedicated Intelligence worker in a split deployment.
            </p>
          ) : undefined
        }
      >
        <StatGrid label="Intelligence lane health">
          <StatTile
            label="Global mode"
            value={policy ? policy.effectiveMode : NO_VALUE}
            hint={
              !policy ? (
                'Unavailable'
              ) : policy.mode !== policy.effectiveMode ? (
                <ToneHint tone="elevated">{`Policy is ${policy.mode}, held off by the master switch`}</ToneHint>
              ) : undefined
            }
          />
          <StatTile
            label="Similarity engine"
            value={capabilities ? capabilities.similarityTier.replace('_', ' + ') : NO_VALUE}
            hint={
              !capabilities ? (
                'Unavailable'
              ) : !capabilities.trigramAvailable ? (
                <ToneHint tone="elevated">
                  pg_trgm is not installed; full-text search is used
                </ToneHint>
              ) : undefined
            }
          />
          <StatTile
            label="Queue"
            value={backlog ? `${backlog.ready} ready · ${backlog.leased} running` : NO_VALUE}
            hint={
              backlog ? `Oldest waiting: ${formatAge(backlog.oldestReadyAgeMs)}` : 'Unavailable'
            }
          />
          <StatTile
            label="Paging queue lag"
            value={criticalLagMs === null ? NO_VALUE : formatAge(criticalLagMs)}
            hint={
              lagHigh ? (
                <ToneHint tone="critical">{`Paused: above ${formatAge(lagThreshold)}`}</ToneHint>
              ) : (
                `Pauses above ${formatAge(lagThreshold)}`
              )
            }
          />
        </StatGrid>
      </SettingsSection>

      <SettingsSection
        id="general"
        title="General"
        description="Master switch, worker budgets and retention. Changes apply within seconds."
      >
        <IntelligenceSettingsForm settings={settings} canManage={canManage} />
      </SettingsSection>

      <SettingsSection
        id="operations-insights"
        title="Operations insights"
        description="Suggestions about automation, escalation, on-call, postmortems, runbooks and notifications. Off by default."
      >
        <OpsInsightsSettingsForm settings={settings} canManage={canManage} />
      </SettingsSection>

      <DigestSection canManage={canManage} />

      <SettingsSection
        id="global-policy"
        title="Global policy"
        description="Each save publishes a new immutable version, so any change can be undone."
        action={<Badge variant="outline">Version {headVersion}</Badge>}
      >
        <IntelligencePolicyForm
          headVersion={headVersion}
          mode={policy?.mode ?? 'OFF'}
          similarityEnabled={policy?.definition.similarity.enabled ?? true}
          responseEnabled={policy?.definition.response.enabled ?? true}
          minScore={policy?.definition.similarity.minScore ?? 0.35}
          canManage={canManage}
          autoAvailable={AUTO_MODE_AVAILABLE}
        />
        {versions && versions.versions.length > 0 && (
          <div className="border-t border-border py-4">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
              <History className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              History
            </h3>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {versions.versions.map(version => (
                <li
                  key={version.version}
                  className="flex flex-col gap-2 px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium tabular-nums">Version {version.version}</span>
                      <Badge variant="secondary">{version.mode}</Badge>
                      {version.version === headVersion && <Badge variant="outline">Current</Badge>}
                      <RelativeTime
                        date={version.createdAt}
                        className="text-xs text-muted-foreground"
                      />
                    </div>
                    {(version.reason || version.createdFromVersion) && (
                      <p className="text-xs text-muted-foreground">
                        {version.createdFromVersion
                          ? `Restored from version ${version.createdFromVersion}. `
                          : ''}
                        {version.reason}
                      </p>
                    )}
                  </div>
                  {canManage && version.version < headVersion && (
                    <RollbackForm targetVersion={version.version} headVersion={headVersion} />
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        id="triage"
        title="Triage suggestions"
        description="Suggestions only: nothing is applied until a responder accepts it. Off by default."
        action={
          <Badge variant={triageEnabled ? 'default' : 'secondary'}>
            {triageEnabled ? 'On' : 'Off'}
          </Badge>
        }
      >
        <LearnMore className="pt-3">
          <p>
            When an incident opens, triage looks at how similar incidents were handled and proposes,
            as chips on the incident:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>an urgency, when similar incidents were raised or lowered;</li>
            <li>an owning team or person, from who resolved them;</li>
            <li>a likely duplicate, when an open incident looks the same;</li>
            <li>an expected time to resolve.</li>
          </ul>
          <p>
            It needs similar-incident matching to be on and a mode of Suggest or higher to be
            visible. A service with its own policy decides for itself. Turning it on or off
            publishes a new policy version, so it can be rolled back from the history above.
          </p>
        </LearnMore>
        <TriagePolicyForm
          headVersion={headVersion}
          enabled={triageEnabled}
          canManage={canManage && policy !== null}
        />
      </SettingsSection>

      <SettingsSection
        id="correlation-rules"
        title="Correlation rules"
        description="Group related incidents of the same service. Rules only suggest links for responders to confirm."
      >
        <CorrelationRulesEditor
          initialRules={policy?.definition.correlation.rules ?? []}
          headVersion={headVersion}
          canManage={canManage}
          maxLookbackDays={settings.lookbackDays}
        />
      </SettingsSection>

      {canManage && policy && (
        <SettingsSection
          title="Suggested grouping rules"
          description="Learned from links responders confirmed and suggestions they rejected, checked against recent history."
        >
          <RuleSuggestionsPanel expectedHeadVersion={headVersion} mode={policy.mode} />
        </SettingsSection>
      )}

      {deadLetters && deadLetters.length > 0 && (
        <SettingsSection
          id="failed-work"
          title="Failed work"
          description="Items that exhausted their retries. Nothing here affects incident handling."
        >
          <LearnMore className="pt-3">
            Quarantined items failed twice within a day and wait for a replay instead of retrying on
            their own.
          </LearnMore>
          <ul className="divide-y divide-border">
            {deadLetters.map(item => (
              <li
                key={item.id}
                className="flex flex-col gap-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{item.kind}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {item.attempts} attempts
                    </span>
                    {item.quarantined && (
                      <span
                        className={cn(
                          'rounded-full border px-2 py-0.5 text-2xs font-semibold',
                          toneClasses('elevated').soft
                        )}
                      >
                        Quarantined
                      </span>
                    )}
                  </div>
                  <p className="break-words text-xs text-muted-foreground">{item.failureSummary}</p>
                </div>
                {canManage && <ReplayForm id={item.id} />}
              </li>
            ))}
          </ul>
        </SettingsSection>
      )}
    </div>
  );
}
