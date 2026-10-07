import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability, getCurrentUser } from '@/lib/rbac';
import { RunbookPageHeader } from '@/components/runbooks/RunbookPageHeader';
import { RunbookMetricStrip } from '@/components/runbooks/RunbookMetricStrip';
import { RunbookModuleNav } from '@/components/runbooks/RunbookModuleNav';
import { RunbookStatusBadge } from '@/components/runbooks/RunbookStatusBadge';
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
  const [clock] = await prisma.$queryRaw<Array<{ now: Date }>>`SELECT NOW() AS now`;
  if (!clock) throw new Error('Database clock query returned no rows.');
  const now = clock.now;

  const [
    executionStates,
    attemptStates,
    agents,
    oldestPending,
    artifacts,
    recentFailures,
    expiredLeases,
  ] = await Promise.all([
    prisma.runbookExecution.groupBy({ by: ['status'], _count: { id: true } }),
    prisma.runbookStepAttempt.groupBy({ by: ['status'], _count: { id: true } }),
    prisma.runbookAgent.findMany({
      where: { status: { not: 'REVOKED' } },
      select: {
        id: true,
        name: true,
        status: true,
        lastHeartbeatAt: true,
        lastError: true,
        spoolDepth: true,
        deadLetterDepth: true,
      },
      orderBy: { name: 'asc' },
    }),
    prisma.runbookStepAttempt.findFirst({
      where: { status: 'PENDING' },
      orderBy: { availableAt: 'asc' },
      select: { availableAt: true },
    }),
    prisma.runbookArtifact.aggregate({ _count: { id: true }, _sum: { sizeBytes: true } }),
    prisma.runbookExecution.groupBy({
      by: ['serviceId'],
      where: {
        serviceId: { not: null },
        status: 'FAILED',
        completedAt: { gte: new Date(now.getTime() - 15 * 60 * 1000) },
      },
      _count: { id: true },
    }),
    prisma.runbookStepAttempt.count({
      where: { status: { in: ['CLAIMED', 'RUNNING'] }, leaseExpiresAt: { lt: now } },
    }),
  ]);

  const unhealthyAgents = agents.filter(
    agent =>
      !agent.lastHeartbeatAt ||
      now.getTime() - agent.lastHeartbeatAt.getTime() > 90000 ||
      agent.status !== 'ONLINE' ||
      agent.lastError ||
      agent.deadLetterDepth > 0
  );

  const activeExecutions = executionStates
    .filter(row => ['QUEUED', 'RUNNING', 'WAITING_AGENT', 'WAITING_APPROVAL'].includes(row.status))
    .reduce((sum, row) => sum + row._count.id, 0);

  const pending = attemptStates.find(row => row.status === 'PENDING')?._count.id ?? 0;
  const oldest = oldestPending
    ? Math.max(0, Math.round((now.getTime() - oldestPending.availableAt.getTime()) / 1000))
    : 0;

  const unknown = attemptStates.find(row => row.status === 'UNKNOWN')?._count.id ?? 0;
  const deadLetters = agents.reduce((sum, agent) => sum + agent.deadLetterDepth, 0);
  const circuits = recentFailures.filter(row => row._count.id >= 3).length;

  const attention =
    unhealthyAgents.length > 0 || unknown > 0 || expiredLeases > 0 || circuits > 0 || oldest > 300;

  const localWorker = getJobWorkerStatus();

  // Synthesize actionable issues for first-order operator review
  const issues: HealthIssue[] = [];

  if (unhealthyAgents.length > 0) {
    issues.push({
      id: 'unhealthy-agents',
      type: 'agent',
      severity: 'danger',
      title: `${unhealthyAgents.length} ${unhealthyAgents.length === 1 ? 'Agent' : 'Agents'} Requiring Attention`,
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
      title: `${circuits} Service Circuit ${circuits === 1 ? 'Breaker' : 'Breakers'} Tripped`,
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
      actionHref: '/runbooks/executions?status=UNKNOWN',
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

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 p-4 md:p-6">
      {/* Compact Header */}
      <RunbookPageHeader
        title="Automation Health"
        description={`Continuous health surveillance across execution workers, queues and agents. Last evaluated at ${formatDateTime(now, userTimeZone, { format: 'time' })}.`}
        badge={<RunbookStatusBadge status={attention ? 'DEGRADED' : 'HEALTHY'} />}
      />

      {/* Modern Metric Strip */}
      <RunbookMetricStrip
        stats={[
          {
            label: 'Active Executions',
            value: activeExecutions,
            tone: activeExecutions > 0 ? 'info' : 'default',
            subtext: `${activeExecutions} in-flight`,
          },
          {
            label: 'Healthy Fleet',
            value: `${agents.length - unhealthyAgents.length}/${agents.length}`,
            tone: unhealthyAgents.length === 0 ? 'success' : 'danger',
            subtext: `${unhealthyAgents.length} degraded`,
          },
          {
            label: 'Queue Pending',
            value: pending,
            tone: pending > 20 ? 'warning' : 'default',
            subtext: `${oldest}s oldest`,
          },
          {
            label: 'Safety Controls',
            value: attention ? `${issues.length} Alert` : 'Nominal',
            tone: attention ? 'warning' : 'success',
            subtext: attention ? 'Action required' : 'Zero tripped',
          },
        ]}
      />

      {/* Persistent Module Navigation */}
      <RunbookModuleNav
        counts={{
          healthDegraded: attention,
          agents: agents.length,
          executions: activeExecutions,
        }}
      />

      {/* 1. What Needs Attention? */}
      <HealthAttentionPanel
        issues={issues}
        agentsCount={agents.length}
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
        totalAgentsCount={agents.length}
        now={now}
        userTimeZone={userTimeZone}
      />
    </div>
  );
}
