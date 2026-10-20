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
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import { RunbookModuleNav } from '@/components/runbooks/RunbookModuleNav';
import { Activity, CheckCircle2, Clock, Play, ShieldAlert, XCircle } from 'lucide-react';
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
    <div className="mx-auto w-full max-w-[1600px] space-y-4 px-3 sm:px-4 md:px-6 py-4 md:py-5">
      <DetailHeroBanner
        tag="Automation Execution Engine"
        title="Executions"
        icon={
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-foreground/15 text-primary-foreground ring-1 ring-inset ring-primary-foreground/20">
            <Play className="h-6 w-6" aria-hidden="true" />
          </div>
        }
        subtitle={
          <p className="text-xs text-primary-foreground/85 leading-relaxed">
            Every runbook run across services and incidents, with live status, approvals, and
            outcomes.
          </p>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700/80 bg-zinc-800/80 px-2.5 py-1 text-xs text-slate-300 font-medium tabular-nums shadow-xs"
              title={`All execution timestamps reflect your profile timezone: ${userTimeZone}`}
            >
              <Clock className="h-3 w-3 text-slate-400" aria-hidden="true" />
              {userTimeZone}
            </span>
          </div>
        }
        statsPlacement="bottom"
        stats={[
          {
            label: 'Running',
            value: summary.running,
            icon: <Activity className="h-3.5 w-3.5 text-sky-200" />,
            valueClassName: summary.running > 0 ? 'text-sky-200 font-bold' : undefined,
            href: '/runbooks/executions?status=RUNNING',
            active: status === 'RUNNING',
          },
          {
            label: 'Waiting Approval',
            value: summary.waitingApproval,
            icon: <ShieldAlert className="h-3.5 w-3.5 text-amber-200" />,
            valueClassName: summary.waitingApproval > 0 ? 'text-amber-200 font-bold' : undefined,
            href: '/runbooks/executions?status=WAITING_APPROVAL',
            active: status === 'WAITING_APPROVAL',
          },
          {
            label: 'Failed (24h)',
            value: failedLastDay,
            icon: <XCircle className="h-3.5 w-3.5 text-rose-200" />,
            valueClassName: failedLastDay > 0 ? 'text-rose-200 font-bold' : undefined,
            href: '/runbooks/executions?status=FAILED&timeRange=24h',
            active: status === 'FAILED',
          },
          {
            label: 'Succeeded (24h)',
            value: succeededLastDay,
            icon: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-200" />,
            valueClassName: succeededLastDay > 0 ? 'text-emerald-200 font-bold' : undefined,
            href: '/runbooks/executions?status=SUCCEEDED&timeRange=24h',
            active: status === 'SUCCEEDED',
          },
        ]}
      />

      {/* Static here so the execution table header can own the sticky slot. */}
      <RunbookModuleNav summary={navigation} className="static" />

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
