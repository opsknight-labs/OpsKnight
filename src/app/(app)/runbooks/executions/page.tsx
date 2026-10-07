import { getRunbookDatabaseNow, getRunbookExecutionSummary, getRunbookNavigationSummary } from '@/lib/runbooks/presentation/summaries';
import { getExecutionDateRange, getExecutionProgress, getUnknownOutcomeWhere, TRIGGER_LABELS } from '@/lib/runbooks/presentation/contracts';
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

  const now = await getRunbookDatabaseNow();
  const dateRange = getExecutionDateRange(query, userTimeZone, now);
  const trigger = Object.keys(TRIGGER_LABELS).find(value => value === query.trigger) as keyof typeof TRIGGER_LABELS | undefined;
  const status = Object.values(RunbookExecutionStatus).find(value => value === query.status);

  const filter = runbookExecutionFilterSchema.parse({
    status,
    runbookId: query.runbook,
    serviceId: query.service,
    incidentId: query.incident,
    agentId: query.agent,
    from: dateRange.gte,
    to: dateRange.lt,
    triggeredByType: trigger,
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
    ...(trigger ? { triggeredByType: trigger } : {}),
    ...(query.attemptStatus === 'UNKNOWN' ? getUnknownOutcomeWhere() : {}),
    ...(dateRange.gte || dateRange.lt ? { createdAt: dateRange } : {}),
  };

  const [statusCounts, summary, navigation] = await Promise.all([
    prisma.runbookExecution.groupBy({ by: ['status'], where, _count: { id: true } }),
    getRunbookExecutionSummary(),
    getRunbookNavigationSummary(),
  ]);

  const total = statusCounts.reduce((acc, row) => acc + row._count.id, 0);
  const runningCount = statusCounts.find(r => r.status === 'RUNNING')?._count.id ?? 0;
  const waitingApprovalCount = statusCounts.find(r => r.status === 'WAITING_APPROVAL')?._count.id ?? 0;
  const failedCount = statusCounts
    .filter(r => r.status === 'FAILED' || r.status === 'TIMED_OUT')
    .reduce((acc, r) => acc + r._count.id, 0);

  const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / RUNBOOK_PAGE_SIZE)));

  const executions = await prisma.runbookExecution.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    skip: (page - 1) * RUNBOOK_PAGE_SIZE,
    take: RUNBOOK_PAGE_SIZE,
    select: {
      id: true,
      status: true,
      triggeredByType: true,
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
  });
  const successRate = summary.successRate.percent === null ? 'No outcomes' : `${summary.successRate.percent}%`;

  const executionListData = executions.map(item => {
    return {
      id: item.id,
      status: item.status,
      triggeredByType: item.triggeredByType,
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
      ...getExecutionProgress(item.steps),
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
            value: summary.running,
            tone: summary.running > 0 ? 'info' : 'default',
            subtext: summary.running > 0 ? 'Active on agents' : 'Idle',
          },
          {
            label: 'Waiting Approval',
            value: summary.waitingApproval,
            tone: summary.waitingApproval > 0 ? 'warning' : 'default',
            subtext: summary.waitingApproval > 0 ? 'Action required' : 'Clear',
          },
          {
            label: 'Last 24h',
            value: summary.last24h,
            subtext: 'Last 24 hours',
          },
          {
            label: '7-day success rate',
            value: successRate,
            tone: summary.successRate.percent === null ? 'default' : summary.successRate.percent >= 95 ? 'success' : 'warning',
            subtext: `${summary.successRate.total} completed outcomes; cancellations excluded`,
          },
        ]}
      />

      {/* Persistent Module Navigation */}
      <RunbookModuleNav summary={navigation} />
      <ExecutionFilterBar key={JSON.stringify(query)} query={query} />

      {/* High-Density Hybrid List / Drawer Experience */}
      <ExecutionList
        executions={executionListData}
        userTimeZone={userTimeZone}
        totalCount={total}
        runningCount={runningCount}
        waitingApprovalCount={waitingApprovalCount}
        failedCount={failedCount}
      />

      {/* Bounded Server Pagination */}
      <RunbookPagination page={page} total={total} query={query} />
    </div>
  );
}
