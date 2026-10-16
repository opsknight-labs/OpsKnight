import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAgentDistribution } from '@/lib/runbooks/distribution';
import {
  getRunbookDatabaseNow,
  getRunbookFleetSummary,
  getRunbookNavigationSummary,
} from '@/lib/runbooks/presentation/summaries';
import { resolveEffectiveAgentStatus } from '@/lib/runbooks/presentation/contracts';
import { AlertTriangle, ArrowRight, Bot, Server } from 'lucide-react';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability, getCurrentUser, getUserPermissions } from '@/lib/rbac';
import { getAppUrl } from '@/lib/app-url';
import { RunbookMetricStrip } from '@/components/runbooks/RunbookMetricStrip';
import { AgentFleetTable } from '@/components/runbooks/agents/AgentFleetTable';
import { AgentFilterBar } from '@/components/runbooks/agents/AgentFilterBar';
import { EnrollAgentSheet } from '@/components/runbooks/agents/EnrollAgentSheet';
import { FleetPageShell } from '@/components/runbooks/agents/FleetPageShell';
import { buildAgentWhere } from '@/components/runbooks/agents/agent-query';
import { legacyFleetRedirect } from '@/components/runbooks/agents/fleet-routes';
import { Pill, SectionCard } from '@/components/runbooks/ui/primitives';
import { runbookAgentFilterSchema } from '@/lib/runbooks/schemas';
import { schedulingLabelsSchema } from '@/lib/runbooks/pool-labels';
import { formatDateTime, getUserTimeZone } from '@/lib/timezone';
import {
  RunbookPagination,
  runbookPageQuery,
  RUNBOOK_PAGE_SIZE,
} from '@/components/runbooks/RunbookPagination';

export const revalidate = 0;

const STATUS_CARDS = [
  { status: 'ONLINE', key: 'online', label: 'Online', subtext: 'Fresh heartbeat', tone: 'success' },
  {
    status: 'DEGRADED',
    key: 'degraded',
    label: 'Degraded',
    subtext: 'Reporting faults',
    tone: 'warning',
  },
  {
    status: 'OFFLINE',
    key: 'offline',
    label: 'Offline',
    subtext: 'Missed heartbeats',
    tone: 'danger',
  },
  {
    status: 'ENROLLING',
    key: 'enrolling',
    label: 'Enrolling',
    subtext: 'Awaiting handshake',
    tone: 'info',
  },
] as const;

const ENROLLMENT_STEPS = [
  {
    title: 'Create an enrollment token',
    description:
      'A single-use token valid for 15 minutes. The Agent private key never leaves the host.',
  },
  {
    title: 'Install the Agent',
    description:
      'Copy a Compose, Swarm, Helm, Kustomize or Linux command pinned to the verified release.',
  },
  {
    title: 'Verify the first heartbeat',
    description: 'The Agent appears here as Online once it authenticates and reports capabilities.',
  },
];

export default async function RunbookAgentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await assertCapability(CAPABILITIES.RUNBOOK_READ_ALL);
  const rawParams = await searchParams;
  const legacyTarget = legacyFleetRedirect(rawParams);
  if (legacyTarget) redirect(legacyTarget);

  const [permissions, user] = await Promise.all([getUserPermissions(), getCurrentUser()]);
  const userTimeZone = getUserTimeZone(user);
  const canManage = permissions.capabilities.includes(CAPABILITIES.RUNBOOK_AGENT_MANAGE);
  const canManageSecrets = permissions.capabilities.includes(CAPABILITIES.RUNBOOK_SECRET_MANAGE);
  const { query, page: requestedPage } = runbookPageQuery(rawParams);
  const filterQuery = Object.fromEntries(Object.entries(query).filter(([key]) => key !== 'tab'));
  const [now, fleet, navigation, appUrl, distribution] = await Promise.all([
    getRunbookDatabaseNow(),
    getRunbookFleetSummary(),
    getRunbookNavigationSummary(),
    canManage ? getAppUrl() : Promise.resolve(undefined),
    canManage ? getAgentDistribution() : Promise.resolve(null),
  ]);

  const label = query.label ?? '';
  const split = label.indexOf('=');
  const labelKey = split > 0 ? label.slice(0, split) : '';
  const labelValue = split > 0 ? label.slice(split + 1) : '';
  const labels = schedulingLabelsSchema.safeParse(
    labelKey && labelValue ? { [labelKey]: labelValue } : {}
  );
  const status = runbookAgentFilterSchema.shape.status.safeParse(query.status);
  const filter = runbookAgentFilterSchema.parse({
    status: status.success ? status.data : undefined,
    q: query.q,
    poolId: query.pool,
    platform: query.platform?.slice(0, 100),
    capability: query.capability?.slice(0, 100),
    labels: labels.success ? labels.data : undefined,
    page: requestedPage,
  });
  const attention = query.attention === '1';
  const agentWhere = buildAgentWhere({ ...filter, attention }, new Date(now.getTime() - 90000));
  const agentTotal = await prisma.runbookAgent.count({ where: agentWhere });
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(agentTotal / RUNBOOK_PAGE_SIZE)));
  const agents = await prisma.runbookAgent.findMany({
    where: agentWhere,
    skip: (page - 1) * RUNBOOK_PAGE_SIZE,
    take: RUNBOOK_PAGE_SIZE,
    include: {
      poolMemberships: { include: { pool: true }, take: 20 },
      _count: { select: { poolMemberships: true } },
    },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });

  const agentListData = agents.map(agent => ({
    id: agent.id,
    name: agent.name,
    hostname: agent.hostname,
    status: agent.status,
    effectiveStatus: resolveEffectiveAgentStatus(agent, now),
    platform: agent.platform,
    version: agent.version,
    lastHeartbeatAt: agent.lastHeartbeatAt?.toISOString() ?? null,
    capabilities: agent.capabilities,
    capabilityReport: agent.capabilityReport,
    labels: agent.labels,
    poolMemberships: agent.poolMemberships,
    activeAttemptCount: agent.activeAttemptCount,
    spoolDepth: agent.spoolDepth,
    deadLetterDepth: agent.deadLetterDepth,
    trustedSigningKeys: agent.trustedSigningKeys,
    lastError: agent.lastError,
    totalPoolCount: agent._count?.poolMemberships ?? agent.poolMemberships.length,
  }));

  const hasFilters = Object.keys(filterQuery).some(key => key !== 'page');
  const firstEnrollment = fleet.enrolled === 0 && agentTotal === 0 && !hasFilters;

  return (
    <FleetPageShell
      title="Execution Infrastructure"
      icon={Server}
      description={`Outbound-only native Agents, explicit worker pools, and cryptographically isolated credentials. Fleet evaluated at ${formatDateTime(now, userTimeZone, { format: 'time', includeTimeZone: true })} (${userTimeZone}).`}
      navigation={navigation}
      canManageSecrets={canManageSecrets}
      actions={
        canManage ? (
          <EnrollAgentSheet
            label="Enroll agent"
            userTimeZone={userTimeZone}
            appUrl={appUrl}
            distribution={distribution}
          />
        ) : undefined
      }
    >
      {firstEnrollment ? (
        <SectionCard
          icon={Bot}
          title="No Agents enrolled yet"
          description="Agents connect outbound to OpsKnight and run diagnostic and remediation steps on your hosts. Nothing listens for inbound connections."
        >
          <ol className="grid gap-4 md:grid-cols-3">
            {ENROLLMENT_STEPS.map((step, index) => (
              <li key={step.title} className="flex gap-3 rounded-lg border bg-muted/20 p-4">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary ring-1 ring-inset ring-primary/20 tabular-nums">
                  {index + 1}
                </span>
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-semibold">{step.title}</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {step.description}
                  </p>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-5 flex flex-wrap items-center gap-3 border-t pt-5">
            {canManage ? (
              <EnrollAgentSheet
                label="Enroll your first Agent"
                variant="outline"
                userTimeZone={userTimeZone}
                appUrl={appUrl}
                distribution={distribution}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Ask an administrator with Agent management permission to enroll the first Agent.
              </p>
            )}
          </div>
        </SectionCard>
      ) : (
        <>
          <section aria-label="Fleet health" className="space-y-3">
            <RunbookMetricStrip
              stats={STATUS_CARDS.map(card => {
                const active = filter.status === card.status && !attention;
                return {
                  label: card.label,
                  value: fleet[card.key],
                  subtext: card.subtext,
                  tone: fleet[card.key] > 0 ? card.tone : 'default',
                  active,
                  href: active ? '/runbooks/agents' : `/runbooks/agents?status=${card.status}`,
                };
              })}
            />
            {(fleet.deadLetterDepth > 0 || fleet.spoolDepth > 0) && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Pill tone={fleet.spoolDepth > 0 ? 'info' : 'neutral'}>
                  <span className="tabular-nums">{fleet.spoolDepth}</span> pending results spooled
                </Pill>
                <Pill tone={fleet.deadLetterDepth > 0 ? 'danger' : 'neutral'}>
                  <span className="tabular-nums">{fleet.deadLetterDepth}</span> dead-letter events
                </Pill>
                {fleet.deadLetterDepth > 0 && (
                  <Link
                    href="/runbooks/agents?attention=1"
                    className="inline-flex items-center gap-1 rounded-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Review Agents needing attention
                    <ArrowRight className="h-3 w-3" aria-hidden="true" />
                  </Link>
                )}
              </div>
            )}
          </section>

          <AgentFilterBar key={JSON.stringify(filterQuery)} query={filterQuery} />

          {attention && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs">
              <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="font-semibold">
                  Filtered by Health: Agents requiring operator attention
                </span>
                <span className="tabular-nums text-amber-700 dark:text-amber-300">
                  ({agentTotal} matching)
                </span>
              </div>
              <Link
                href="/runbooks/agents"
                className="rounded-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Show all agents
              </Link>
            </div>
          )}

          <section aria-label="Agent fleet">
            <AgentFleetTable
              agents={agentListData}
              userTimeZone={userTimeZone}
              canManage={canManage}
              filtered={hasFilters}
            />
          </section>
          <RunbookPagination page={page} total={agentTotal} query={filterQuery} />
        </>
      )}
    </FleetPageShell>
  );
}
