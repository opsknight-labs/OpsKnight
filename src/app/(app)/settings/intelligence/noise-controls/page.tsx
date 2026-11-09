import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import {
  DecisionList,
  KpiTiles,
  NoisePolicyForm,
  SimulationForm,
  SuggestionList,
  SuppressionRuleList,
} from '@/components/settings/NoiseControlsForms';
import HeartbeatPanel from '@/components/settings/noise-controls/HeartbeatPanel';
import MaintenanceWindowsPanel from '@/components/settings/noise-controls/MaintenanceWindowsPanel';
import SuppressionRuleBuilder from '@/components/settings/noise-controls/SuppressionRuleBuilder';
import EmptyState from '@/components/ui/EmptyState';
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
  listPrePagingDecisions,
  listSuppressionRules,
  suggestSuppressionRules,
} from '@/lib/intelligence/noise-controls';

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
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Noise controls</h1>
        <p className="text-sm text-muted-foreground">
          Decide before paging: maintenance windows, suppression rules, orchestration, content
          dedup, flapping, storm grouping and heartbeat monitors. Everything starts OFF, runs in
          SHADOW first, and every decision is recorded and reversible. Highest urgency is never
          held.
        </p>
      </header>

      {kpis && <KpiTiles kpis={kpis} />}

      <SettingsSection
        title="Policy"
        description="OFF ignores everything below. SHADOW records what would have happened. ON applies it. Turning ON needs a week of shadow evidence, or an explicit acknowledgement."
      >
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
        title="Maintenance windows"
        description="Alerts in a window are stored and visible but never page (or page at a lower urgency). Windows can repeat (weekly, weekdays, weekends, monthly or a custom RRULE) and can be ended early. Test a window against the last 7 days before saving it."
      >
        <MaintenanceWindowsPanel
          windows={windows ?? []}
          services={services ?? []}
          teams={teams ?? []}
          canManage={canManage}
          now={now}
        />
      </SettingsSection>

      <SettingsSection
        title="Suppression rules"
        description="Match on source, summary, severity, resource or labels. Rules expire, have an owner, and are audited. Suggestions come from services whose incidents mostly clear within minutes."
      >
        {canManage && (
          <div className="py-4">
            <SuppressionRuleBuilder
              services={services ?? []}
              owners={ownerOptions}
              currentUserId={user.id}
            />
          </div>
        )}
        <SuggestionList suggestions={suggestions ?? []} canManage={canManage} />
        <SuppressionRuleList rules={rules ?? []} canManage={canManage} />
      </SettingsSection>

      <SettingsSection
        title="Heartbeat monitors"
        description="A job that stops pinging raises an incident on its service through the normal ingestion path, and resolves it when the pings return."
      >
        <HeartbeatPanel
          monitors={heartbeats ?? []}
          services={services ?? []}
          canManage={canManage}
          appUrl={appUrl ?? ''}
        />
      </SettingsSection>

      <SettingsSection
        title="Test against history"
        description="Replays the saved controls over recent incidents, read-only, and says what would have been suppressed, grouped, downgraded or held."
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
        title="Recent decisions"
        description="Shadow and applied decisions. Reversing an applied decision re-ingests the alert so it pages; reversing a shadow decision marks it wrong and counts against readiness."
      >
        <DecisionList decisions={decisions ?? []} canManage={canManage} />
      </SettingsSection>
    </div>
  );
}
