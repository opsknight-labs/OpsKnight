import Link from 'next/link';
import { Activity, Bot, ShieldCheck } from 'lucide-react';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability, getCurrentUser } from '@/lib/rbac';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import EmptyState from '@/components/ui/EmptyState';
import { RunbookNavigation, StatusBadge } from '@/components/runbooks/RunbookControls';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
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
  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 p-4 md:p-6">
      <DetailHeroBanner
        tag="RUNBOOK AUTOMATION"
        title="Health center"
        subtitle="Live queue and safety indicators. Historical unknown outcomes require operator review; fleet worker health is monitored separately."
        icon={<Activity className="h-8 w-8" />}
        badges={<StatusBadge status={attention ? 'DEGRADED' : 'HEALTHY'} />}
        statsPlacement="bottom"
        stats={[
          { label: 'Active executions', value: activeExecutions },
          {
            label: 'Healthy Agents',
            value: `${agents.length - unhealthyAgents.length}/${agents.length}`,
          },
          { label: 'Queue', value: pending },
          { label: 'Oldest pending', value: `${oldest}s` },
        ]}
      />
      <RunbookNavigation />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="rounded-xl">
          <CardHeader>
            <CardTitle className="text-base">Execution plane</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row
              label="Local worker"
              value={
                localWorker.running
                  ? localWorker.lastError
                    ? 'Needs attention'
                    : 'Running'
                  : 'Not observed in this process'
              }
            />
            <Row label="Worker lane" value={localWorker.lane} />
            <Row
              label="Last successful cycle"
              value={
                localWorker.lastSuccessAt
                  ? formatDateTime(localWorker.lastSuccessAt, userTimeZone, { format: 'datetime' })
                  : 'Not observed'
              }
            />
            <p className="text-xs text-muted-foreground">
              In split deployments this web process does not observe dedicated workers. Monitor each
              worker’s readiness endpoint; these values are not fleet-wide health.
            </p>
          </CardContent>
        </Card>
        <Card className="rounded-xl">
          <CardHeader>
            <CardTitle className="text-base">Queue & storage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Row label="Pending attempts" value={pending} />
            <Row label="Oldest pending" value={`${oldest}s`} />
            <Row label="Artifacts" value={artifacts._count.id} />
            <Row
              label="Artifact storage"
              value={`${((artifacts._sum.sizeBytes ?? 0) / 1048576).toFixed(1)} MiB`}
            />
          </CardContent>
        </Card>
        <Card className="rounded-xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4" />
              Safety
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Row label="Unknown outcomes (historical)" value={unknown} attention={unknown > 0} />
            <Row
              label="Expired active leases"
              value={expiredLeases}
              attention={expiredLeases > 0}
            />
            <Row label="Open service circuits" value={circuits} attention={circuits > 0} />
            <Row label="Dead-letter results" value={deadLetters} attention={deadLetters > 0} />
          </CardContent>
        </Card>
      </div>
      <Card className="rounded-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bot className="h-4 w-4" />
            Agents requiring attention
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {unhealthyAgents.map(agent => (
            <Link
              key={agent.id}
              href="/runbooks/agents"
              className="flex flex-col justify-between gap-3 rounded-lg border p-4 sm:flex-row"
            >
              <div>
                <h2 className="font-semibold">{agent.name}</h2>
                <p className="text-xs text-muted-foreground">
                  Heartbeat{' '}
                  {agent.lastHeartbeatAt
                    ? formatDateTime(agent.lastHeartbeatAt, userTimeZone, { format: 'datetime' })
                    : 'never'}{' '}
                  ·{' '}
                  {agent.spoolDepth} pending · {agent.deadLetterDepth} dead letter
                </p>
                {agent.lastError && (
                  <p className="mt-2 break-words text-xs text-destructive">{agent.lastError}</p>
                )}
              </div>
              <StatusBadge
                status={
                  !agent.lastHeartbeatAt || now.getTime() - agent.lastHeartbeatAt.getTime() > 90000
                    ? 'OFFLINE'
                    : agent.status
                }
              />
            </Link>
          ))}
          {unhealthyAgents.length === 0 && (
            <EmptyState
              title="No Agent alerts"
              description={
                agents.length
                  ? `All ${agents.length} enrolled Agents have healthy heartbeats.`
                  : 'No Agents enrolled. Add one to enable host-level execution.'
              }
              size="sm"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
function Row({
  label,
  value,
  attention = false,
}: {
  label: string;
  value: React.ReactNode;
  attention?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/50 pb-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={
          attention ? 'text-right font-semibold text-destructive' : 'text-right font-medium'
        }
      >
        {value}
      </span>
    </div>
  );
}
