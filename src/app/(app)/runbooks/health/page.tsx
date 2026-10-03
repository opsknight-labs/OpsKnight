import Link from 'next/link';
import { Activity, ArrowLeft, Bot, Clock3, Database, HardDrive } from 'lucide-react';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability } from '@/lib/rbac';
import { Badge } from '@/components/ui/shadcn/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';

export const revalidate = 0;

function Stat({
  label,
  value,
  icon,
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <span className="text-rose-600 [&_svg]:h-5 [&_svg]:w-5">{icon}</span>
        <div>
          <div className="text-2xl font-semibold">{value}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export default async function RunbookHealthPage() {
  await assertCapability(CAPABILITIES.RUNBOOK_READ_ALL);
  const [databaseClock] = await prisma.$queryRaw<Array<{ now: Date }>>`SELECT NOW() AS now`;
  if (!databaseClock) throw new Error('Database clock query returned no rows.');
  const now = databaseClock.now;
  const staleBefore = new Date(now.getTime() - 90_000);
  const [executionStates, attemptStates, agents, oldestPending, artifacts, recentFailures] =
    await Promise.all([
      prisma.runbookExecution.groupBy({ by: ['status'], _count: { id: true } }),
      prisma.runbookStepAttempt.groupBy({ by: ['status'], _count: { id: true } }),
      prisma.runbookAgent.findMany({
        where: { status: { not: 'REVOKED' } },
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
    ]);
  const unhealthyAgents = agents.filter(
    agent =>
      !agent.lastHeartbeatAt ||
      agent.lastHeartbeatAt < staleBefore ||
      agent.status !== 'ONLINE' ||
      agent.lastError
  );
  const activeExecutions = executionStates
    .filter(row => !['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT'].includes(row.status))
    .reduce((sum, row) => sum + row._count.id, 0);
  const pendingAttempts = attemptStates.find(row => row.status === 'PENDING')?._count.id ?? 0;
  const oldestPendingSeconds = oldestPending
    ? Math.max(0, Math.round((now.getTime() - oldestPending.availableAt.getTime()) / 1000))
    : 0;
  const artifactBytes = artifacts._sum.sizeBytes ?? 0;
  const circuitOpenServices = recentFailures.filter(row => row._count.id >= 3).length;

  return (
    <div className="mx-auto w-full max-w-[1180px] space-y-6 p-4 sm:p-6 lg:p-8">
      <Link
        href="/runbooks"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Runbooks
      </Link>
      <header>
        <h1 className="flex items-center gap-2 font-heading text-3xl font-semibold">
          <Activity className="h-7 w-7 text-rose-600" /> Runbook health center
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Live execution-plane backlog, Agent health, and artifact storage visibility.
        </p>
      </header>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Active executions" value={activeExecutions} icon={<Activity />} />
        <Stat label="Pending attempts" value={pendingAttempts} icon={<Clock3 />} />
        <Stat label="Oldest pending (seconds)" value={oldestPendingSeconds} icon={<Clock3 />} />
        <Stat
          label="Artifact storage"
          value={`${(artifactBytes / 1_048_576).toFixed(1)} MiB`}
          icon={<HardDrive />}
        />
        <Stat label="Open service circuits" value={circuitOpenServices} icon={<Activity />} />
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Execution states</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {executionStates.map(row => (
              <div key={row.status} className="flex justify-between rounded border p-2 text-sm">
                <span>{row.status}</span>
                <Badge variant="secondary">{row._count.id}</Badge>
              </div>
            ))}
            {executionStates.length === 0 && (
              <p className="text-sm text-muted-foreground">No executions recorded.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Attempt states</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {attemptStates.map(row => (
              <div key={row.status} className="flex justify-between rounded border p-2 text-sm">
                <span>{row.status}</span>
                <Badge variant="secondary">{row._count.id}</Badge>
              </div>
            ))}
            {attemptStates.length === 0 && (
              <p className="text-sm text-muted-foreground">No attempts recorded.</p>
            )}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Bot className="h-5 w-5" /> Agents requiring attention
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {unhealthyAgents.map(agent => (
            <div
              key={agent.id}
              className="flex flex-col justify-between gap-2 rounded border p-3 text-sm sm:flex-row"
            >
              <div>
                <div className="font-medium">{agent.name}</div>
                <div className="text-xs text-muted-foreground">
                  Last heartbeat {agent.lastHeartbeatAt?.toLocaleString() || 'never'} · spool{' '}
                  {agent.spoolDepth} · active {agent.activeAttemptCount}
                </div>
                {agent.lastError && (
                  <div className="mt-1 text-xs text-destructive">{agent.lastError}</div>
                )}
              </div>
              <Badge variant={agent.status === 'DEGRADED' ? 'destructive' : 'secondary'}>
                {agent.status}
              </Badge>
            </div>
          ))}
          {unhealthyAgents.length === 0 && (
            <p className="text-sm text-muted-foreground">
              All {agents.length} active Agents are healthy.
            </p>
          )}
          <Link
            href="/runbooks/agents"
            className="inline-flex items-center gap-2 text-sm text-rose-600"
          >
            <Database className="h-4 w-4" /> Manage Agents and scoped secrets
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
