import { getRunbookDatabaseNow, getRunbookHealthSummary, getRunbookNavigationSummary } from '@/lib/runbooks/presentation/summaries';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability, getCurrentUser } from '@/lib/rbac';
import { RunbookPageHeader } from '@/components/runbooks/RunbookPageHeader';
import { RunbookMetricStrip } from '@/components/runbooks/RunbookMetricStrip';
import { RunbookModuleNav } from '@/components/runbooks/RunbookModuleNav';
import { RunbookStatusBadge } from '@/components/runbooks/RunbookStatusBadge';
import { RunbookLiveRefresh } from '@/components/runbooks/RunbookLiveRefresh';
import {
  HealthAttentionPanel,
  type HealthIssue,
} from '@/components/runbooks/health/HealthAttentionPanel';
import { HealthDetailCards } from '@/components/runbooks/health/HealthDetailCards';
import { getJobWorkerStatus } from '@/lib/job-worker';
import { formatDateTime, getUserTimeZone } from '@/lib/timezone';

export const revalidate = 0;

export default async function RunbookHealthPage() {
  await assertCapability(CAPABILITIES.RUNBOOK_READ_ALL);
  const user = await getCurrentUser();
  const userTimeZone = getUserTimeZone(user);
  const [now, health, navigation] = await Promise.all([getRunbookDatabaseNow(), getRunbookHealthSummary(), getRunbookNavigationSummary()]);
  const [pending, agents, artifacts] = await Promise.all([
    prisma.runbookStepAttempt.count({ where: { status: 'PENDING' } }),
    prisma.runbookAgent.findMany({
      take: 20,
      where: { status: { not: 'REVOKED' }, OR: [{ status: { not: 'ONLINE' } }, { lastHeartbeatAt: null }, { lastHeartbeatAt: { lt: new Date(now.getTime() - 90000) } }, { lastError: { not: '' } }, { deadLetterDepth: { gt: 0 } }] },
      select: { id: true, name: true, status: true, lastHeartbeatAt: true, lastError: true, spoolDepth: true, deadLetterDepth: true },
      orderBy: { name: 'asc' },
    }),
    prisma.runbookArtifact.aggregate({ _count: { id: true }, _sum: { sizeBytes: true } }),
  ]);
  const { oldest, unknown, expiredLeases, circuits } = health;
  const activeExecutions = navigation.activeExecutions ?? 'Unknown';

  const unhealthyAgents = agents.filter(
    agent =>
      !agent.lastHeartbeatAt ||
      now.getTime() - agent.lastHeartbeatAt.getTime() > 90000 ||
      agent.status !== 'ONLINE' ||
      agent.lastError ||
      agent.deadLetterDepth > 0
  );

  const deadLetters = health.fleet.deadLetterDepth;

  const attention =
    health.health === 'DEGRADED';

  const localWorker = getJobWorkerStatus();

  // Synthesize actionable issues for first-order operator review
  const issues: HealthIssue[] = [];

  if (health.fleet.unhealthy > 0) {
    issues.push({
      id: 'unhealthy-agents',
      type: 'agent',
      severity: 'danger',
      title: `${health.fleet.unhealthy} ${health.fleet.unhealthy === 1 ? 'Agent' : 'Agents'} Requiring Attention`,
      description: `Unresponsive heartbeats or dead-letter queue build-ups detected on: ${unhealthyAgents.map(a => a.name).join(', ')}.`,
      actionHref: '/runbooks/agents',
      actionLabel: 'Inspect Fleet',
    });
  }

  if (circuits > 0) {
    issues.push({
      id: 'circuits',
      type: 'circuit',
      severity: 'danger',
      title: `${circuits} ${circuits === 1 ? 'Service' : 'Services'} at Circuit Threshold`,
      description: 'Multiple automated runs failed within 15 minutes. Execution halted to prevent cascading failure.',
      actionHref: '/runbooks/executions?status=FAILED',
      actionLabel: 'Inspect Failures',
    });
  }

  if (unknown > 0) {
    issues.push({
      id: 'unknown-outcomes',
      type: 'unknown',
      severity: 'warning',
      title: `${unknown} Historical Unknown ${unknown === 1 ? 'Outcome' : 'Outcomes'}`,
      description: 'Host disconnects or ambiguous terminations require operator reconciliation.',
      actionHref: '/runbooks/executions?attemptStatus=UNKNOWN',
      actionLabel: 'Review Outcomes',
    });
  }

  if (expiredLeases > 0) {
    issues.push({
      id: 'expired-leases',
      type: 'lease',
      severity: 'warning',
      title: `${expiredLeases} Expired Execution ${expiredLeases === 1 ? 'Lease' : 'Leases'}`,
      description: 'Active step lease expired before completion report. System will re-queue or self-fence.',
      actionHref: '/runbooks/executions',
      actionLabel: 'Inspect Queue',
    });
  }

  if (oldest > 300) {
    issues.push({
      id: 'stale-queue',
      type: 'queue',
      severity: 'warning',
      title: `Queue Backlog Delayed (${oldest}s)`,
      description: 'Oldest pending attempt has been waiting over 5 minutes without worker claim.',
      actionHref: '/runbooks/executions?status=QUEUED',
      actionLabel: 'View Queue',
    });
  }

  if (localWorker.running && localWorker.lastError) {
    issues.push({
      id: 'local-worker-error',
      type: 'queue',
      severity: 'danger',
      title: 'Local Execution Worker Error',
      description: `In-process runbook worker reported a fault: ${localWorker.lastError}`,
      actionHref: '/api/health?mode=readiness',
      actionLabel: 'Inspect Worker',
    });
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 p-4 md:p-6">
      <RunbookLiveRefresh enabled={true} intervalMs={20000} />
      {/* Compact Header */}
      <RunbookPageHeader
        title="Automation Health"
        description={`Continuous health surveillance across execution workers, queues and agents. Last evaluated at ${formatDateTime(now, userTimeZone, { format: 'time' })}.`}
        badge={<RunbookStatusBadge status={health.health} context="health" />}
      />

      {/* Modern Metric Strip */}
      <RunbookMetricStrip
        stats={[
          {
            label: 'Active Executions',
            value: activeExecutions,
            tone: typeof activeExecutions === 'number' && activeExecutions > 0 ? 'info' : 'default',
            subtext: `${activeExecutions} in-flight`,
          },
          {
            label: 'Healthy Fleet',
            value: `${health.fleet.enrolled - health.fleet.unhealthy}/${health.fleet.enrolled}`,
            tone: !health.fleet.enrolled ? 'default' : health.fleet.unhealthy === 0 ? 'success' : 'danger',
            subtext: health.fleet.enrolled ? `${health.fleet.unhealthy} require attention` : 'No Agents configured',
          },
          {
            label: 'Queue Pending',
            value: pending,
            tone: pending > 20 ? 'warning' : 'default',
            subtext: `${oldest}s oldest`,
          },
          {
            label: 'Safety Controls',
            value: attention ? `${issues.length} ${issues.length === 1 ? 'Alert' : 'Alerts'}` : health.health === 'UNKNOWN' ? 'Unknown' : 'Nominal',
            tone: attention ? 'warning' : health.health === 'UNKNOWN' ? 'default' : 'success',
            subtext: attention ? 'Action required' : health.health === 'UNKNOWN' ? 'Status unknown' : 'Zero tripped',
          },
        ]}
      />

      {/* Persistent Module Navigation */}
      <RunbookModuleNav summary={navigation} />

      {/* 1. What Needs Attention? */}
      <HealthAttentionPanel
        issues={issues}
        agentsCount={health.fleet.enrolled}
      />

      {/* 2. Technical Detail Cards */}
      <HealthDetailCards
        localWorker={localWorker}
        pending={pending}
        oldest={oldest}
        artifacts={{ count: artifacts._count.id, sizeBytes: artifacts._sum.sizeBytes ?? 0 }}
        unknown={unknown}
        expiredLeases={expiredLeases}
        circuits={circuits}
        deadLetters={deadLetters}
        unhealthyAgents={unhealthyAgents}
        totalAgentsCount={health.fleet.enrolled}
        now={now}
        userTimeZone={userTimeZone}
      />
    </div>
  );
}
