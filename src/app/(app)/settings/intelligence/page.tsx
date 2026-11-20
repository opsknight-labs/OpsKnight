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

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="space-y-1 py-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
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
      >
        Learns from your incident history to suggest similar past incidents, related incidents,
        possible causes and runbooks. It runs entirely off the paging path: it never delays
        escalation or notifications. Certified service AUTO adds reversible related links after
        paging. Turning it off stops analysis; existing accepted links remain available to undo.
      </IntelligenceGroupHeader>

      {setup && <IntelligenceSetupChecklist state={setup} canManage={canManage} />}

      <SettingsSection
        id="lane-health"
        title="Status"
        description="Live health of the intelligence lane."
        action={
          <Badge variant={settings.enabled ? 'default' : 'secondary'}>
            {settings.enabled ? 'Enabled' : 'Disabled'}
          </Badge>
        }
      >
        <div className="grid gap-4 py-2 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Global mode"
            value={policy ? policy.effectiveMode : 'Unavailable'}
            hint={
              policy && policy.mode !== policy.effectiveMode
                ? `Policy is ${policy.mode}, held off by the master switch`
                : undefined
            }
          />
          <Stat
            label="Similarity engine"
            value={capabilities ? capabilities.similarityTier.replace('_', ' + ') : 'Unavailable'}
            hint={
              capabilities && !capabilities.trigramAvailable
                ? 'pg_trgm is not installed; full-text search is used'
                : undefined
            }
          />
          <Stat
            label="Queue"
            value={backlog ? `${backlog.ready} ready · ${backlog.leased} running` : 'Unavailable'}
            hint={backlog ? `Oldest waiting: ${formatAge(backlog.oldestReadyAgeMs)}` : undefined}
          />
          <Stat
            label="Paging queue lag"
            value={criticalLagMs === null ? 'Unavailable' : formatAge(criticalLagMs)}
            hint={`Pauses above ${formatAge(settings.backpressureEscalationLagMs)}`}
          />
        </div>
      </SettingsSection>

      {['integrated', 'worker', 'general-worker'].includes(getOpsKnightProcessRole()) &&
        process.env.OPSKNIGHT_INTELLIGENCE_DEDICATED !== 'true' && (
          <p
            role="status"
            className="rounded-lg border border-status-elevated/40 bg-status-elevated-soft p-3 text-sm text-foreground dark:bg-status-elevated/10"
          >
            Intelligence shares this process with paging work. For isolated capacity, use the
            dedicated Intelligence worker in a split deployment.
          </p>
        )}

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
        description="Suggestions about service automation, escalation policies, on-call schedules, postmortems, runbooks and notifications. Off by default."
      >
        <OpsInsightsSettingsForm settings={settings} canManage={canManage} />
      </SettingsSection>

      <DigestSection canManage={canManage} />

      <SettingsSection
        id="global-policy"
        title="Global policy"
        description="Each save publishes a new immutable version, so any change can be undone and every decision stays traceable."
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
            <h4 className="mb-3 text-sm font-medium">History</h4>
            <ul className="space-y-3">
              {versions.versions.map(version => (
                <li key={version.version} className="space-y-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">Version {version.version}</span>
                    <Badge variant="secondary">{version.mode}</Badge>
                    {version.createdFromVersion && (
                      <span className="text-xs text-muted-foreground">
                        restored from version {version.createdFromVersion}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {version.createdAt.toISOString().slice(0, 16).replace('T', ' ')} UTC
                    </span>
                  </div>
                  {version.reason && (
                    <p className="text-xs text-muted-foreground">{version.reason}</p>
                  )}
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
        description="Off by default. Suggestions only: nothing is applied until a responder accepts it."
        action={
          <Badge variant={triageEnabled ? 'default' : 'secondary'}>
            {triageEnabled ? 'On' : 'Off'}
          </Badge>
        }
      >
        <div className="space-y-2 py-4 text-sm text-muted-foreground">
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
        </div>
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
          description="Grouping rules learned from the links responders confirmed and the suggestions they rejected, checked against recent history before they are offered."
        >
          <RuleSuggestionsPanel expectedHeadVersion={headVersion} mode={policy.mode} />
        </SettingsSection>
      )}

      {deadLetters && deadLetters.length > 0 && (
        <SettingsSection
          id="failed-work"
          title="Failed work"
          description="Items that exhausted their retries. Quarantined items failed twice within a day and wait for a replay instead of retrying on their own. Nothing here affects incident handling."
        >
          <ul className="divide-y divide-border">
            {deadLetters.map(item => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
              >
                <div className="space-y-1">
                  <p className="font-medium">
                    {item.kind} · {item.attempts} attempts
                    {item.quarantined && (
                      <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                        Quarantined
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">{item.failureSummary}</p>
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
