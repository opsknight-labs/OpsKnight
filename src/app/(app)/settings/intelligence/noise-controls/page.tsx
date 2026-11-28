import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { IntelligenceGroupHeader } from '@/components/settings/layout/IntelligenceGroupHeader';
import {
  DecisionList,
  KpiTiles,
  NoisePolicyForm,
  PolicyVersionHistory,
  SimulationForm,
  SuggestionList,
  SuppressionRuleList,
} from '@/components/settings/NoiseControlsForms';
import HeartbeatPanel from '@/components/settings/noise-controls/HeartbeatPanel';
import LookupDeadlineNotice from '@/components/settings/noise-controls/LookupDeadlineNotice';
import MaintenanceWindowsPanel from '@/components/settings/noise-controls/MaintenanceWindowsPanel';
import SuppressionRuleBuilder from '@/components/settings/noise-controls/SuppressionRuleBuilder';
import EmptyState from '@/components/ui/EmptyState';
import { LearnMore } from '@/components/settings/layout/LearnMore';
import { pageHeaderBadgeClass } from '@/components/patterns/PageHeader';
import { toneClasses } from '@/components/patterns/status-tone';
import { cn } from '@/lib/utils';
import { getAppUrl } from '@/lib/app-url';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { assertCapability, getCurrentAuthorizationActor } from '@/lib/rbac';
import { CAPABILITIES, hasCapability, type AppRole } from '@/lib/authorization';
import {
  assessNoiseReadiness,
  getNoiseControlKpis,
  getNoiseControlPolicy,
  listHeartbeatMonitors,
  listMaintenanceWindows,
  listNoiseControlPolicies,
  listNoiseControlPolicyVersions,
  listPrePagingDecisions,
  listSuppressionRules,
  suggestSuppressionRules,
} from '@/lib/intelligence/noise-controls';
import { currentLookupHealth } from '@/lib/intelligence/noise-controls/health';
import { requirePageAccess } from '@/lib/access/server';
import { ViewOnlyNotice } from '@/components/settings/form-kit';
import { noiseModeWord } from '@/lib/intelligence/copy';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function safely<T>(label: string, load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    logger.warn(`[Intelligence] Noise controls could not load ${label}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export default async function NoiseControlsPage({
  searchParams,
}: {
  searchParams: Promise<{ service?: string }>;
}) {
  await requirePageAccess('/settings/intelligence/noise-controls');
  const user = await assertCapability(CAPABILITIES.INTELLIGENCE_READ);
  const canManage = hasCapability(user.role as AppRole, CAPABILITIES.INTELLIGENCE_MANAGE);
  const actor = await getCurrentAuthorizationActor();
  const params = await searchParams;
  const serviceId =
    params.service && /^[A-Za-z0-9_-]{1,64}$/.test(params.service) ? params.service : null;

  const [
    services,
    teams,
    policy,
    policies,
    readiness,
    windows,
    rules,
    suggestions,
    heartbeats,
    decisions,
    kpis,
    versions,
    owners,
    runbooks,
    appUrl,
  ] = await Promise.all([
    safely('services', () =>
      prisma.service.findMany({
        orderBy: { name: 'asc' },
        take: 2000,
        select: { id: true, name: true },
      })
    ),
    safely('teams', () =>
      prisma.team.findMany({
        orderBy: { name: 'asc' },
        take: 500,
        select: { id: true, name: true },
      })
    ),
    safely('policy', () => getNoiseControlPolicy(serviceId)),
    safely('policies', () => listNoiseControlPolicies()),
    safely('readiness', () => assessNoiseReadiness(serviceId)),
    safely('maintenance windows', () => listMaintenanceWindows()),
    safely('suppression rules', () => listSuppressionRules()),
    actor ? safely('suggestions', () => suggestSuppressionRules(actor)) : Promise.resolve([]),
    safely('heartbeats', () => listHeartbeatMonitors()),
    safely('decisions', () => listPrePagingDecisions({ limit: 50 })),
    safely('kpis', () => getNoiseControlKpis({ days: 7 })),
    safely('policy versions', () => listNoiseControlPolicyVersions(serviceId, { limit: 20 })),
    canManage
      ? safely('owners', () =>
          prisma.user.findMany({
            where: { status: 'ACTIVE' },
            orderBy: { name: 'asc' },
            take: 500,
            select: { id: true, name: true },
          })
        )
      : Promise.resolve([]),
    canManage
      ? safely('runbooks', () =>
          prisma.runbook.findMany({
            where: { archivedAt: null },
            orderBy: { name: 'asc' },
            take: 500,
            select: { id: true, name: true },
          })
        )
      : Promise.resolve([]),
    canManage ? safely('app url', () => getAppUrl()) : Promise.resolve(null),
  ]);
  const now = new Date();
  // The owner list always contains the viewer, so the default owner is selectable.
  const ownerOptions =
    owners && !owners.some(owner => owner.id === user.id)
      ? [{ id: user.id, name: user.name ?? user.email ?? 'You' }, ...owners]
      : (owners ?? []);

  return (
    <div className="space-y-6">
      <IntelligenceGroupHeader
        group="noise"
        visible={['policy', 'simulation', 'decisions']}
        badges={
          policy ? (
            <span className={pageHeaderBadgeClass}>
              <span
                aria-hidden="true"
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  toneClasses(
                    policy.mode === 'ON' ? 'ok' : policy.mode === 'SHADOW' ? 'info' : 'neutral'
                  ).solid
                )}
              />
              {`Noise controls: ${noiseModeWord(policy.mode)}`}
            </span>
          ) : undefined
        }
        about={
          <p>
            Hides, merges and groups noisy alerts before anyone is paged: repeats, flapping alerts,
            alert storms, planned maintenance and your own rules, plus heartbeat checks. It starts
            off, you watch what it would do first, and every decision is recorded and can be
            reversed. High-urgency alerts always page unless you allow otherwise.
          </p>
        }
      >
        Decide what happens to an alert before anyone is paged.
      </IntelligenceGroupHeader>
      {!canManage && <ViewOnlyNotice what="Intelligence settings" />}

      <LookupDeadlineNotice health={currentLookupHealth()} />

      {kpis && <KpiTiles kpis={kpis} />}

      <SettingsSection
        id="policy"
        title="Controls"
        description="OFF ignores everything below, SHADOW records what would have happened, ON applies it."
      >
        <LearnMore className="pt-3">
          Turning ON needs a week of shadow evidence, or an explicit acknowledgement.
        </LearnMore>
        {policy && readiness ? (
          <NoisePolicyForm
            policy={policy}
            readiness={readiness}
            services={services ?? []}
            policies={policies ?? []}
            selectedServiceId={serviceId}
            canManage={canManage}
            runbooks={runbooks ?? []}
          />
        ) : (
          <EmptyState
            size="sm"
            variant="simple"
            title="Policy unavailable"
            description="The noise-control policy could not be loaded. Refresh to try again."
          />
        )}
      </SettingsSection>

      <SettingsSection
        id="suppression-rules"
        title="Suppression rules"
        description="Match on source, summary, severity, resource or labels. Rules expire, have an owner and are audited."
      >
        <LearnMore className="pt-3">
          Suggestions come from services whose incidents mostly clear within minutes.
        </LearnMore>
        {canManage && (
          <div className="py-4">
            <SuppressionRuleBuilder
              services={services ?? []}
              owners={ownerOptions}
              currentUserId={user.id}
              initialServiceId={serviceId}
            />
          </div>
        )}
        <SuggestionList suggestions={suggestions ?? []} canManage={canManage} />
        <SuppressionRuleList rules={rules ?? []} canManage={canManage} />
      </SettingsSection>

      <SettingsSection
        id="maintenance-windows"
        title="Maintenance windows"
        description="Alerts in a window are stored and visible but never page, or page at a lower urgency."
      >
        <LearnMore className="pt-3">
          Windows can repeat (weekly, weekdays, weekends, monthly or a custom RRULE) and can be
          ended early. Test a window against the last 7 days before saving it.
        </LearnMore>
        <MaintenanceWindowsPanel
          windows={windows ?? []}
          services={services ?? []}
          teams={teams ?? []}
          canManage={canManage}
          now={now}
        />
      </SettingsSection>

      <SettingsSection
        id="heartbeats"
        title="Heartbeat monitors"
        description="A job that stops pinging raises an incident on its service, and resolves it when the pings return."
      >
        <HeartbeatPanel
          monitors={heartbeats ?? []}
          services={services ?? []}
          canManage={canManage}
          appUrl={appUrl ?? ''}
        />
      </SettingsSection>

      <SettingsSection
        id="simulation"
        title="Test against history"
        description="Replay the saved controls over recent incidents, read-only, to see what would have been held back."
      >
        {canManage ? (
          <SimulationForm services={services ?? []} />
        ) : (
          <EmptyState
            size="sm"
            variant="simple"
            title="Simulations are for managers"
            description="Ask someone with intelligence management access to replay these controls."
          />
        )}
      </SettingsSection>

      <SettingsSection
        id="decisions"
        title="Recent decisions"
        description="Shadow and applied decisions, newest first. Every one can be reversed."
      >
        <LearnMore className="pt-3">
          Reversing an applied decision re-ingests the alert so it pages; reversing a shadow
          decision marks it wrong and counts against readiness.
        </LearnMore>
        <DecisionList decisions={decisions ?? []} canManage={canManage} />
      </SettingsSection>

      <SettingsSection
        id="policy-history"
        title="Orchestration and policy versions"
        description="Compare versions, see what changed and roll back. Every publish is an immutable version."
      >
        <LearnMore className="pt-3">
          Orchestration rules are versioned too, and decisions record the version they were made
          under. Rolling back publishes a copy of the chosen version as the newest one, so history
          is never rewritten.
        </LearnMore>
        {policy ? (
          <PolicyVersionHistory
            versions={versions ?? []}
            serviceId={serviceId}
            revision={policy.revision}
            currentMode={policy.mode}
            canManage={canManage}
          />
        ) : (
          <EmptyState
            size="sm"
            variant="simple"
            title="Version history unavailable"
            description="The noise-control policy could not be loaded. Refresh to try again."
          />
        )}
      </SettingsSection>
    </div>
  );
}
