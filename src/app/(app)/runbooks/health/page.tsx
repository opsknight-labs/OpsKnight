import {
  getRunbookDatabaseNow,
  getRunbookHealthSummary,
  getRunbookNavigationSummary,
} from '@/lib/runbooks/presentation/summaries';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability, getCurrentUser } from '@/lib/rbac';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import { RunbookModuleNav } from '@/components/runbooks/RunbookModuleNav';
import { Bot, Clock, HeartPulse, ListOrdered, Play, ShieldCheck } from 'lucide-react';
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
  const [now, health, navigation] = await Promise.all([
    getRunbookDatabaseNow(),
    getRunbookHealthSummary(),
    getRunbookNavigationSummary(),
  ]);
  const [pending, agents, artifacts] = await Promise.all([
    prisma.runbookStepAttempt.count({ where: { status: 'PENDING' } }),
    prisma.runbookAgent.findMany({
      take: 20,
      where: {
        status: { not: 'REVOKED' },
        OR: [
          { status: { not: 'ONLINE' } },
          { lastHeartbeatAt: null },
          { lastHeartbeatAt: { lt: new Date(now.getTime() - 90000) } },
          { lastError: { not: '' } },
          { deadLetterDepth: { gt: 0 } },
        ],
      },
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

  const attention = health.health === 'DEGRADED';

  const localWorker = getJobWorkerStatus();

  // Synthesize actionable issues for first-order operator review
  const issues: HealthIssue[] = [];
  if (health.workers.status !== 'HEALTHY' || health.workers.redundancy === 'UNCONFIGURED')
    issues.push({
      id: 'worker-evidence',
      type: 'queue',
      severity: health.workers.status === 'DEGRADED' ? 'danger' : 'warning',
      title:
        health.workers.redundancy === 'UNCONFIGURED'
          ? 'Worker redundancy is unverified'
          : 'Runbook worker evidence missing or degraded',
      description: health.workers.reason,
      actionHref: '/api/health?mode=readiness',
      actionLabel: 'Inspect worker deployment',
    });

  if (health.fleet.offline > 0) {
    const total = health.fleet.offline;
    issues.push({
      id: 'offline-agents',
      type: 'agent',
      severity: 'danger',
      title: `${total} ${total === 1 ? 'Agent' : 'Agents'} Offline`,
      description:
        'No heartbeat within 90 seconds. Work targeted at these Agents cannot be claimed until they reconnect.',
      actionHref: '/runbooks/agents?status=OFFLINE',
      actionLabel: 'Review offline Agents',
    });
  }

  if (health.fleet.degraded > 0) {
    const total = health.fleet.degraded;
    issues.push({
      id: 'degraded-agents',
      type: 'agent',
      severity: 'warning',
      title: `${total} ${total === 1 ? 'Agent' : 'Agents'} Degraded`,
      description: 'These Agents are connected but report runtime or capability faults.',
      actionHref: '/runbooks/agents?status=DEGRADED',
      actionLabel: 'Review degraded Agents',
    });
  }

  if (health.fleet.enrolling > 0) {
    const total = health.fleet.enrolling;
    issues.push({
      id: 'enrolling-agents',
      type: 'agent',
      severity: 'warning',
      title: `${total} Pending ${total === 1 ? 'Enrollment' : 'Enrollments'}`,
      description:
        'Enrollment tokens were issued but the Agent has not completed its first handshake.',
      actionHref: '/runbooks/agents?status=ENROLLING',
      actionLabel: 'Review enrollments',
    });
  }

  const otherUnhealthy = Math.max(
    0,
    health.fleet.unhealthy - health.fleet.offline - health.fleet.degraded - health.fleet.enrolling
  );
  if (otherUnhealthy > 0) {
    const faulted = unhealthyAgents.filter(agent => agent.lastError || agent.deadLetterDepth > 0);
    issues.push({
      id: 'unhealthy-agents',
      type: 'agent',
      severity: 'danger',
      title: `${otherUnhealthy} ${otherUnhealthy === 1 ? 'Agent' : 'Agents'} Requiring Attention`,
      description:
        faulted.length > 0
          ? `Reported errors or dead-letter build-ups detected, including: ${faulted
              .slice(0, 5)
              .map(a => a.name)
              .join(', ')}${faulted.length > 5 ? '…' : '.'}`
          : 'Reported errors or dead-letter build-ups detected.',
      actionHref: '/runbooks/agents?attention=1',
      actionLabel: 'Inspect Agents',
    });
  }

  if (circuits > 0) {
    issues.push({
      id: 'circuits',
      type: 'circuit',
      severity: 'danger',
      title: `${circuits} ${circuits === 1 ? 'Service' : 'Services'} at Circuit Threshold`,
      description:
        'Multiple automated runs failed within 15 minutes. Execution halted to prevent cascading failure.',
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
      description:
        'Active step lease expired before completion report. System will re-queue or self-fence.',
      actionHref: '/runbooks/executions?status=RUNNING',
      actionLabel: 'Inspect running executions',
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

  const runbookWorkerError = localWorker.running
    ? localWorker.lane === 'runbook'
      ? localWorker.lastError
      : localWorker.lastRunbookError
    : null;

  if (runbookWorkerError) {
    issues.push({
      id: 'local-worker-error',
      type: 'queue',
      severity: 'danger',
      title: 'Local Execution Worker Error',
      description: `In-process runbook worker reported a fault: ${runbookWorkerError}`,
      actionHref: '/api/health?mode=readiness',
      actionLabel: 'Inspect Worker',
    });
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-4 px-3 sm:px-4 md:px-6 py-4 md:py-5">
      <DetailHeroBanner
        tag="System Surveillance & Diagnostics"
        title="Automation Health"
        icon={
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-foreground/15 text-primary-foreground ring-1 ring-inset ring-primary-foreground/20">
            <HeartPulse className="h-6 w-6" aria-hidden="true" />
          </div>
        }
        subtitle={
          <p className="text-xs text-primary-foreground/85 leading-relaxed">
            Continuous health surveillance across execution workers, queues, and agents.
          </p>
        }
        badges={<RunbookStatusBadge status={health.health} context="health" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-zinc-700/80 bg-zinc-800/80 px-2.5 py-1 text-xs text-slate-300 font-medium tabular-nums shadow-xs"
              title={`Health evaluated at ${formatDateTime(now, userTimeZone, { format: 'time', includeTimeZone: true })} (${userTimeZone})`}
            >
              <Clock className="h-3 w-3 text-slate-400" aria-hidden="true" />
              {userTimeZone}
            </span>
            <RunbookLiveRefresh enabled={true} intervalMs={20000} />
          </div>
        }
        statsPlacement="bottom"
        stats={[
          {
            label: 'Active Executions',
            value: activeExecutions,
            icon: <Play className="h-3.5 w-3.5 text-sky-200" />,
            valueClassName:
              typeof activeExecutions === 'number' && activeExecutions > 0
                ? 'text-sky-200 font-bold'
                : undefined,
            href: '/runbooks/executions',
            subtext: `${activeExecutions} in-flight`,
          },
          {
            label: 'Healthy Fleet',
            value: `${health.fleet.enrolled - health.fleet.unhealthy}/${health.fleet.enrolled}`,
            icon: <Bot className="h-3.5 w-3.5 text-emerald-200" />,
            valueClassName:
              health.fleet.unhealthy === 0
                ? 'text-emerald-200 font-bold'
                : 'text-amber-200 font-bold',
            href: health.fleet.unhealthy ? '/runbooks/agents?attention=1' : '/runbooks/agents',
            subtext: health.fleet.enrolled
              ? `${health.fleet.unhealthy} require attention`
              : 'No Agents configured',
          },
          {
            label: 'Queue Pending',
            value: pending,
            icon: <ListOrdered className="h-3.5 w-3.5 text-amber-200" />,
            valueClassName: pending > 20 ? 'text-amber-200 font-bold' : undefined,
            href: '/runbooks/executions?status=QUEUED',
            subtext: `${oldest}s oldest`,
          },
          {
            label: 'Safety Controls',
            value: attention
              ? `${issues.length} ${issues.length === 1 ? 'Alert' : 'Alerts'}`
              : health.health === 'UNKNOWN'
                ? 'Unknown'
                : 'Nominal',
            icon: <ShieldCheck className="h-3.5 w-3.5 text-emerald-200" />,
            valueClassName: attention ? 'text-amber-200 font-bold' : 'text-emerald-200 font-bold',
            subtext: attention ? 'Action required' : 'Zero tripped',
          },
        ]}
      />

      <RunbookModuleNav summary={navigation} />

      <HealthAttentionPanel
        health={health.health}
        issues={issues}
        agentsCount={health.fleet.enrolled}
      />

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
        totalUnhealthy={health.fleet.unhealthy}
        now={now}
        userTimeZone={userTimeZone}
      />
    </div>
  );
}
