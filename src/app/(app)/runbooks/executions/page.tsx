import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability, getCurrentUser } from '@/lib/rbac';
import { RunbookPageHeader } from '@/components/runbooks/RunbookPageHeader';
import { RunbookMetricStrip } from '@/components/runbooks/RunbookMetricStrip';
import { RunbookModuleNav } from '@/components/runbooks/RunbookModuleNav';
import { ExecutionFilterBar } from '@/components/runbooks/executions/ExecutionFilterBar';
import { ExecutionList } from '@/components/runbooks/executions/ExecutionList';
import {
  RunbookPagination,
  runbookPageQuery,
  RUNBOOK_PAGE_SIZE,
} from '@/components/runbooks/RunbookPagination';
import { RunbookExecutionStatus, type Prisma } from '@prisma/client';
import { runbookExecutionFilterSchema } from '@/lib/runbooks/schemas';
import { formatDateTime, getUserTimeZone } from '@/lib/timezone';

export const revalidate = 0;

export default async function RunbookExecutionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await assertCapability(CAPABILITIES.RUNBOOK_READ_ALL);
  const user = await getCurrentUser();
  const userTimeZone = getUserTimeZone(user);
  const { query, page: requestedPage } = runbookPageQuery(await searchParams);

  // Time range calculation
  const now = new Date();
  let computedFrom: Date | undefined;
  if (query.timeRange === '1h') {
    computedFrom = new Date(now.getTime() - 60 * 60 * 1000);
  } else if (query.timeRange === '24h') {
    computedFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  } else if (query.timeRange === '7d') {
    computedFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (query.from && Number.isFinite(Date.parse(query.from))) {
    computedFrom = new Date(query.from);
  }

  const computedTo =
    query.to && Number.isFinite(Date.parse(query.to))
      ? new Date(`${query.to}T23:59:59.999Z`)
      : undefined;

  const status = Object.values(RunbookExecutionStatus).find(value => value === query.status);

  const filter = runbookExecutionFilterSchema.parse({
    status,
    runbookId: query.runbook,
    serviceId: query.service,
    incidentId: query.incident,
    agentId: query.agent,
    from: computedFrom,
    to: computedTo,
    trigger: ['automatic', 'responder'].includes(query.trigger) ? query.trigger : undefined,
    page: requestedPage,
  });

  const searchConstraint: Prisma.RunbookExecutionWhereInput = query.q
    ? {
        OR: [
          { runbook: { name: { contains: query.q, mode: 'insensitive' } } },
          { id: { contains: query.q, mode: 'insensitive' } },
        ],
      }
    : {};

  const where: Prisma.RunbookExecutionWhereInput = {
    ...searchConstraint,
    ...(status ? { status } : {}),
    ...(filter.runbookId ? { runbookId: filter.runbookId } : {}),
    ...(filter.serviceId ? { serviceId: filter.serviceId } : {}),
    ...(filter.incidentId ? { incidentId: filter.incidentId } : {}),
    ...(filter.agentId ? { resolvedTargetAgentId: filter.agentId } : {}),
    ...(query.trigger === 'automatic'
      ? { triggeredByUserId: null }
      : query.trigger === 'responder'
        ? { triggeredByUserId: { not: null } }
        : {}),
    ...(computedFrom || computedTo ? { createdAt: { gte: computedFrom, lte: computedTo } } : {}),
  };

  const total = await prisma.runbookExecution.count({ where });
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / RUNBOOK_PAGE_SIZE)));

  // Concurrent metrics & entity selectors fetch
  const [
    runningCount,
    waitingApprovalCount,
    todayCount,
    totalExecutionsCount,
    succeededCount,
    executions,
    services,
    runbooks,
    agents,
  ] = await Promise.all([
    prisma.runbookExecution.count({ where: { status: 'RUNNING' } }),
    prisma.runbookExecution.count({ where: { status: 'WAITING_APPROVAL' } }),
    prisma.runbookExecution.count({
      where: { createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
    }),
    prisma.runbookExecution.count(),
    prisma.runbookExecution.count({ where: { status: 'SUCCEEDED' } }),
    prisma.runbookExecution.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * RUNBOOK_PAGE_SIZE,
      take: RUNBOOK_PAGE_SIZE,
      select: {
        id: true,
        status: true,
        createdAt: true,
        startedAt: true,
        completedAt: true,
        service: { select: { id: true, name: true } },
        resolvedTargetAgent: { select: { name: true } },
        triggeredByUser: { select: { name: true } },
        incidentId: true,
        incident: { select: { id: true, title: true } },
        runbook: { select: { id: true, name: true } },
        runbookVersion: { select: { version: true } },
        steps: {
          select: {
            id: true,
            stepKey: true,
            status: true,
            startedAt: true,
            completedAt: true,
          },
          orderBy: { sequence: 'asc' },
        },
      },
    }),
    prisma.service.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.runbook.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.runbookAgent.findMany({
      where: { status: { not: 'REVOKED' } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  const successRate =
    totalExecutionsCount > 0
      ? `${Math.round((succeededCount / totalExecutionsCount) * 100)}%`
      : '100%';

  const executionListData = executions.map(item => {
    const totalSteps = item.steps.length;
    const completedSteps = item.steps.filter(st => st.status === 'SUCCEEDED').length;
    const failedStep = item.steps.find(st => st.status === 'FAILED');

    return {
      id: item.id,
      status: item.status,
      createdAt: item.createdAt.toISOString(),
      startedAt: item.startedAt?.toISOString() ?? null,
      completedAt: item.completedAt?.toISOString() ?? null,
      service: item.service,
      incidentId: item.incidentId,
      incidentTitle: item.incident?.title ?? null,
      runbook: item.runbook,
      runbookVersion: item.runbookVersion,
      resolvedTargetAgent: item.resolvedTargetAgent,
      triggeredByUser: item.triggeredByUser,
      totalSteps,
      completedSteps,
      failedStepName: failedStep?.stepKey ?? null,
      steps: item.steps.map(st => ({
        id: st.id,
        stepKey: st.stepKey,
        status: st.status,
        startedAt: st.startedAt?.toISOString() ?? null,
        completedAt: st.completedAt?.toISOString() ?? null,
      })),
    };
  });

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 p-4 md:p-6">
      {/* Compact Page Header */}
      <RunbookPageHeader
        title="Executions"
        description={`Monitor active automation runs, step traces, approvals and outcome evidence. Live view as of ${formatDateTime(now, userTimeZone, { format: 'time' })}.`}
      />

      {/* Modern Metric Strip */}
      <RunbookMetricStrip
        stats={[
          {
            label: 'Running',
            value: runningCount,
            tone: runningCount > 0 ? 'info' : 'default',
            subtext: runningCount > 0 ? 'Active on agents' : 'Idle',
          },
          {
            label: 'Waiting Approval',
            value: waitingApprovalCount,
            tone: waitingApprovalCount > 0 ? 'warning' : 'default',
            subtext: waitingApprovalCount > 0 ? 'Action required' : 'Clear',
          },
          {
            label: 'Executions Today',
            value: todayCount,
            subtext: 'Last 24 hours',
          },
          {
            label: 'Success Rate',
            value: successRate,
            tone: 'success',
            subtext: `${totalExecutionsCount} total runs`,
          },
        ]}
      />

      {/* Persistent Module Navigation */}
      <RunbookModuleNav
        counts={{
          executions: runningCount + waitingApprovalCount,
          agents: agents.length,
        }}
      />

      {/* Human-Friendly Entity Filter Bar */}
      <ExecutionFilterBar
        query={query}
        services={services}
        runbooks={runbooks}
        agents={agents}
      />

      {/* High-Density Hybrid List / Drawer Experience */}
      <ExecutionList
        executions={executionListData}
        userTimeZone={userTimeZone}
        totalCount={total}
      />

      {/* Bounded Server Pagination */}
      <RunbookPagination page={page} total={total} query={query} />
    </div>
  );
}
