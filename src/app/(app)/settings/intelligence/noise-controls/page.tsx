import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import {
  DecisionList,
  HeartbeatForm,
  HeartbeatList,
  KpiTiles,
  MaintenanceWindowForm,
  MaintenanceWindowList,
  NoisePolicyForm,
  SimulationForm,
  SuggestionList,
  SuppressionRuleForm,
  SuppressionRuleList,
} from '@/components/settings/NoiseControlsForms';
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
  ]);

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
          />
        ) : (
          <p className="py-4 text-sm text-muted-foreground">Unavailable.</p>
        )}
      </SettingsSection>

      <SettingsSection
        title="Maintenance windows"
        description="Alerts in a window are stored and visible but never page (or page at a lower urgency). Windows can repeat (FREQ=WEEKLY;BYDAY=SA,SU) and can be ended early."
      >
        {canManage && <MaintenanceWindowForm services={services ?? []} teams={teams ?? []} />}
        <MaintenanceWindowList windows={windows ?? []} canManage={canManage} />
      </SettingsSection>

      <SettingsSection
        title="Suppression rules"
        description="Match on source, summary, severity, resource or labels. Rules expire, have an owner, and are audited. Suggestions come from services whose incidents mostly clear within minutes."
      >
        {canManage && <SuppressionRuleForm services={services ?? []} />}
        <SuggestionList suggestions={suggestions ?? []} canManage={canManage} />
        <SuppressionRuleList rules={rules ?? []} canManage={canManage} />
      </SettingsSection>

      <SettingsSection
        title="Heartbeat monitors"
        description="A job that stops pinging raises an incident on its service through the normal ingestion path, and resolves it when the pings return."
      >
        {canManage && <HeartbeatForm services={services ?? []} />}
        <HeartbeatList monitors={heartbeats ?? []} canManage={canManage} />
      </SettingsSection>

      <SettingsSection
        title="Test against history"
        description="Replays the saved controls over recent incidents, read-only, and says what would have been suppressed, grouped, downgraded or held."
      >
        {canManage ? (
          <SimulationForm services={services ?? []} />
        ) : (
          <p className="py-4 text-sm text-muted-foreground">Managers can run simulations.</p>
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
