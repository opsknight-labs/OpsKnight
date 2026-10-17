import {
  getRunbookDatabaseNow,
  getRunbookExecutionSummary,
  getRunbookNavigationSummary,
} from '@/lib/runbooks/presentation/summaries';
import {
  ACTIVE_EXECUTION_STATUSES,
  getExecutionDateRange,
  getExecutionProgress,
  getUnknownOutcomeWhere,
  TRIGGER_LABELS,
} from '@/lib/runbooks/presentation/contracts';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability, getCurrentUser, getUserPermissions } from '@/lib/rbac';
import { getRerunBlockedReason } from '@/lib/runbooks/rerun';
import { ExecutionStatusChips } from '@/components/runbooks/executions/ExecutionStatusChips';
import { RunbookPageHeader } from '@/components/runbooks/RunbookPageHeader';
import { RunbookModuleNav } from '@/components/runbooks/RunbookModuleNav';
import { StatTile } from '@/components/runbooks/ui/primitives';
import { Activity, CheckCircle2, ShieldAlert, XCircle } from 'lucide-react';
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
  const [user, permissions] = await Promise.all([getCurrentUser(), getUserPermissions()]);
  const userTimeZone = getUserTimeZone(user);
  const canExecute = permissions.capabilities.includes(CAPABILITIES.RUNBOOK_EXECUTE);
  const { query, page: requestedPage } = runbookPageQuery(await searchParams);

  const now = await getRunbookDatabaseNow();
  const dateRange = getExecutionDateRange(query, userTimeZone, now);
  const trigger = Object.keys(TRIGGER_LABELS).find(value => value === query.trigger) as
    keyof typeof TRIGGER_LABELS | undefined;
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

  const baseWhere: Prisma.RunbookExecutionWhereInput = {
    ...searchConstraint,
    ...(filter.runbookId ? { runbookId: filter.runbookId } : {}),
    ...(filter.serviceId ? { serviceId: filter.serviceId } : {}),
    ...(filter.incidentId ? { incidentId: filter.incidentId } : {}),
    ...(filter.agentId ? { resolvedTargetAgentId: filter.agentId } : {}),
    ...(trigger ? { triggeredByType: trigger } : {}),
    ...(query.attemptStatus === 'UNKNOWN' ? getUnknownOutcomeWhere() : {}),
    ...(dateRange.gte || dateRange.lt ? { createdAt: dateRange } : {}),
  };
  const where: Prisma.RunbookExecutionWhereInput = { ...baseWhere, ...(status ? { status } : {}) };

  const [allStatusCounts, summary, navigation, lastDayCounts] = await Promise.all([
    prisma.runbookExecution.groupBy({ by: ['status'], where: baseWhere, _count: { id: true } }),
    getRunbookExecutionSummary(),
    getRunbookNavigationSummary(),
    prisma.runbookExecution.groupBy({
      by: ['status'],
      where: {
        createdAt: { gte: new Date(now.getTime() - 86_400_000) },
        status: { in: ['SUCCEEDED', 'FAILED', 'TIMED_OUT'] },
      },
      _count: { id: true },
    }),
  ]);

  const statusCounts = status
    ? allStatusCounts.filter(row => row.status === status)
    : allStatusCounts;
  const countsByStatus = Object.fromEntries(
    allStatusCounts.map(row => [row.status, row._count.id])
  );
  const total = statusCounts.reduce((acc, row) => acc + row._count.id, 0);
  const lastDay = (value: string) =>
    lastDayCounts.find(row => row.status === value)?._count.id ?? 0;
  const failedLastDay = lastDay('FAILED');
  const timedOutLastDay = lastDay('TIMED_OUT');
  const succeededLastDay = lastDay('SUCCEEDED');
  const activeCount = statusCounts
    .filter(r => (ACTIVE_EXECUTION_STATUSES as readonly string[]).includes(r.status))
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
      serviceId: true,
      service: { select: { id: true, name: true } },
      binding: {
        select: {
          id: true,
          serviceId: true,
          enabled: true,
          detachedAt: true,
          versionStrategy: true,
          runbookVersionId: true,
        },
      },
      resolvedTargetAgent: { select: { name: true } },
      resolvedTargetAgentPool: { select: { id: true, name: true } },
      triggeredByUser: { select: { name: true } },
      incidentId: true,
      incident: { select: { id: true, title: true } },
      runbook: { select: { id: true, name: true, archivedAt: true, publishedVersionId: true } },
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
  const successRate =
    summary.successRate.percent === null
      ? 'No completed runs in 7 days'
      : `${summary.successRate.percent}% success over 7 days`;

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
      runbook: { id: item.runbook.id, name: item.runbook.name },
      runbookVersion: item.runbookVersion,
      rerunBlockedReason: getRerunBlockedReason(item),
      resolvedTargetAgent: item.resolvedTargetAgent,
      resolvedTargetAgentPool: item.resolvedTargetAgentPool,
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
    <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      <RunbookPageHeader
        title="Executions"
        description={`Every runbook run across services and incidents, with live status, approvals and outcomes. As of ${formatDateTime(now, userTimeZone, { format: 'time', includeTimeZone: true })} (${userTimeZone}).`}
      />

      {/* Static here so the execution table header can own the sticky slot. */}
      <RunbookModuleNav summary={navigation} className="static" />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Running"
          value={summary.running}
          icon={Activity}
          tone={summary.running > 0 ? 'info' : 'neutral'}
          hint={summary.running > 0 ? 'Active on Agents now' : 'Nothing running'}
          href="/runbooks/executions?status=RUNNING"
        />
        <StatTile
          label="Waiting approval"
          value={summary.waitingApproval}
          icon={ShieldAlert}
          tone={summary.waitingApproval > 0 ? 'warning' : 'neutral'}
          hint={summary.waitingApproval > 0 ? 'A responder must review' : 'No approvals pending'}
          href="/runbooks/executions?status=WAITING_APPROVAL"
        />
        <StatTile
          label="Failed (24h)"
          value={failedLastDay}
          icon={XCircle}
          tone={failedLastDay > 0 ? 'danger' : 'neutral'}
          hint={timedOutLastDay > 0 ? `Plus ${timedOutLastDay} timed out` : 'Last 24 hours'}
          href="/runbooks/executions?status=FAILED&timeRange=24h"
        />
        <StatTile
          label="Succeeded (24h)"
          value={succeededLastDay}
          icon={CheckCircle2}
          tone={succeededLastDay > 0 ? 'success' : 'neutral'}
          hint={successRate}
          href="/runbooks/executions?status=SUCCEEDED&timeRange=24h"
        />
      </div>

      <ExecutionFilterBar key={JSON.stringify(query)} query={query}>
        <ExecutionStatusChips query={query} counts={countsByStatus} selected={status ?? null} />
      </ExecutionFilterBar>

      <ExecutionList
        executions={executionListData}
        userTimeZone={userTimeZone}
        totalCount={total}
        activeCount={activeCount}
        nowIso={now.toISOString()}
        canExecute={canExecute}
        hasFilters={Object.keys(query).some(key => key !== 'page')}
      />

      <RunbookPagination page={page} total={total} query={query} />
    </div>
  );
}
