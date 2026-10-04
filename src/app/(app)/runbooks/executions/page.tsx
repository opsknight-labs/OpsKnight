import Link from 'next/link';
import { Play } from 'lucide-react';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability } from '@/lib/rbac';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import EmptyState from '@/components/ui/EmptyState';
import { RunbookNavigation, StatusBadge } from '@/components/runbooks/RunbookControls';
import {
  RunbookFilters,
  RunbookPagination,
  runbookPageQuery,
  RUNBOOK_PAGE_SIZE,
} from '@/components/runbooks/RunbookPagination';
import { RunbookExecutionStatus, type Prisma } from '@prisma/client';
import { runbookExecutionFilterSchema } from '@/lib/runbooks/schemas';

export const revalidate = 0;
export default async function RunbookExecutionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await assertCapability(CAPABILITIES.RUNBOOK_READ_ALL);
  const { query, page: requestedPage } = runbookPageQuery(await searchParams);
  const status = Object.values(RunbookExecutionStatus).find(value => value === query.status);
  const from =
    query.from && Number.isFinite(Date.parse(query.from)) ? new Date(query.from) : undefined;
  const to =
    query.to && Number.isFinite(Date.parse(query.to))
      ? new Date(`${query.to}T23:59:59.999Z`)
      : undefined;
  const filter = runbookExecutionFilterSchema.parse({
    status,
    runbookId: query.runbook,
    serviceId: query.service,
    incidentId: query.incident,
    agentId: query.agent,
    from,
    to,
    trigger: ['automatic', 'responder'].includes(query.trigger) ? query.trigger : undefined,
    page: requestedPage,
  });
  const where: Prisma.RunbookExecutionWhereInput = {
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
    ...(from || to ? { createdAt: { gte: from, lte: to } } : {}),
  };
  const total = await prisma.runbookExecution.count({ where });
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / RUNBOOK_PAGE_SIZE)));
  const executions = await prisma.runbookExecution.findMany({
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
      service: { select: { name: true } },
      resolvedTargetAgent: { select: { name: true } },
      triggeredByUser: { select: { name: true } },
      incidentId: true,
      runbook: { select: { id: true, name: true } },
      runbookVersion: { select: { version: true } },
    },
  });
  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 p-4 md:p-6">
      <DetailHeroBanner
        tag="RUNBOOK AUTOMATION"
        title="Executions"
        subtitle="Recent execution history. Open an incident to inspect its exact plan, approvals and output."
        icon={<Play className="h-8 w-8" />}
      />
      <RunbookNavigation />
      <RunbookFilters
        query={query}
        fields={[
          { name: 'runbook', label: 'Runbook ID' },
          { name: 'service', label: 'Service ID' },
          { name: 'incident', label: 'Incident ID' },
          { name: 'agent', label: 'Agent ID' },
          { name: 'from', label: 'From date', type: 'date' },
          { name: 'to', label: 'To date', type: 'date' },
          { name: 'trigger', label: 'Trigger (automatic or responder)' },
        ]}
        statusOptions={Object.values(RunbookExecutionStatus).map(value => ({
          value,
          label: value.replaceAll('_', ' '),
        }))}
      />
      <section className="space-y-3" aria-label="Recent executions">
        {executions.map(item => (
          <Link
            key={item.id}
            href={
              item.incidentId
                ? `/incidents/${item.incidentId}?tab=runbooks`
                : `/runbooks/${item.runbook.id}?tab=executions`
            }
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4 hover:border-primary/30"
          >
            <div>
              <h2 className="font-semibold">{item.runbook.name}</h2>
              <p className="text-xs text-muted-foreground">
                v{item.runbookVersion.version} ·{' '}
                {item.startedAt
                  ? `Started ${item.startedAt.toLocaleString()}`
                  : `Queued ${item.createdAt.toLocaleString()}`}
                {' · '}
                {item.service?.name || 'No service'} ·{' '}
                {item.resolvedTargetAgent?.name || 'Control plane/pool'} ·{' '}
                {item.triggeredByUser?.name || 'Automatic'} ·{' '}
                {item.startedAt
                  ? `${Math.max(0, Math.round(((item.completedAt ?? new Date()).getTime() - item.startedAt.getTime()) / 1000))}s`
                  : 'Not started'}
              </p>
            </div>
            <StatusBadge status={item.status} />
          </Link>
        ))}
        {executions.length === 0 && (
          <EmptyState
            icon={<Play />}
            title="No executions yet"
            description="Attach a published workflow to a service, then start it from an incident."
          />
        )}
      </section>
      <RunbookPagination page={page} total={total} query={query} />
    </div>
  );
}
