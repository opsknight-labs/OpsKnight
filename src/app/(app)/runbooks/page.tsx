import { Workflow } from 'lucide-react';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability, getCurrentUser, getUserPermissions } from '@/lib/rbac';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import RunbookLibrary, { CreateRunbookDialog } from '@/components/runbooks/RunbookLibrary';
import { RunbookNavigation } from '@/components/runbooks/RunbookControls';
import {
  RunbookFilters,
  RunbookPagination,
  runbookPageQuery,
  RUNBOOK_PAGE_SIZE,
} from '@/components/runbooks/RunbookPagination';
import { runbookLibraryFilterSchema } from '@/lib/runbooks/schemas';
import { buildRunbookLibraryWhere } from '@/lib/runbooks/lifecycle';
import { getUserTimeZone } from '@/lib/timezone';

export const revalidate = 0;
export default async function RunbooksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await assertCapability(CAPABILITIES.RUNBOOK_READ_ALL);
  const user = await getCurrentUser();
  const userTimeZone = getUserTimeZone(user);
  const { query, page: requestedPage } = runbookPageQuery(await searchParams);
  const filter = runbookLibraryFilterSchema.parse({
    q: query.q,
    status: ['all', 'published', 'draft', 'archived'].includes(query.status)
      ? (query.status as 'all' | 'published' | 'draft' | 'archived')
      : undefined,
    tab: ['all', 'published', 'drafts', 'archived'].includes(query.tab)
      ? (query.tab as 'all' | 'published' | 'drafts' | 'archived')
      : undefined,
    ownerId: query.owner,
    serviceId: query.service,
    page: requestedPage,
  });
  const where = buildRunbookLibraryWhere(filter);
  const total = await prisma.runbook.count({ where });
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / RUNBOOK_PAGE_SIZE)));
  const [publishedCount, draftCount, archivedCount] = await Promise.all([
    prisma.runbook.count({
      where: { archivedAt: null, publishedVersionId: { not: null } },
    }),
    prisma.runbook.count({
      where: { archivedAt: null, draftVersionId: { not: null } },
    }),
    prisma.runbook.count({
      where: { archivedAt: { not: null } },
    }),
  ]);
  const [permissions, runbooks, executionCount, agents] = await Promise.all([
    getUserPermissions(),
    prisma.runbook.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * RUNBOOK_PAGE_SIZE,
      take: RUNBOOK_PAGE_SIZE,
      include: {
        publishedVersion: { select: { version: true } },
        draftVersion: { select: { version: true } },
        _count: { select: { bindings: true, executions: true } },
      },
    }),
    prisma.runbookExecution.count({
      where: { status: { in: ['QUEUED', 'RUNNING', 'WAITING_AGENT', 'WAITING_APPROVAL'] } },
    }),
    prisma.runbookAgent.groupBy({ by: ['status'], _count: { id: true } }),
  ]);
  const canManage = permissions.capabilities.includes(CAPABILITIES.RUNBOOK_MANAGE);
  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 p-4 md:p-6">
      <DetailHeroBanner
        tag="RUNBOOK AUTOMATION"
        title="Runbooks"
        icon={<Workflow className="h-8 w-8" />}
        subtitle="Build, version and automate operational recovery. Execution stays isolated from critical paging."
        statsPlacement="bottom"
        stats={[
          { label: 'Published', value: publishedCount },
          { label: 'Drafts', value: draftCount },
          { label: 'Active executions', value: executionCount },
          {
            label: 'Archived',
            value: archivedCount,
            href: '/runbooks?status=archived',
            active: filter.status === 'archived' || filter.tab === 'archived',
          },
          {
            label: 'Online Agents',
            value: agents.find(row => row.status === 'ONLINE')?._count.id ?? 0,
          },
        ]}
        actions={canManage ? <CreateRunbookDialog /> : undefined}
      />
      <RunbookNavigation />
      <RunbookFilters
        query={query}
        fields={[
          { name: 'q', label: 'Search runbooks' },
          { name: 'owner', label: 'Owner ID' },
          { name: 'service', label: 'Service binding ID' },
        ]}
        allStatusLabel="All Active"
        statusOptions={[
          { value: 'published', label: 'Published' },
          { value: 'draft', label: 'Draft' },
          { value: 'archived', label: 'Archived' },
        ]}
      />
      <RunbookLibrary
        canManage={canManage}
        userTimeZone={userTimeZone}
        runbooks={runbooks.map(item => ({
          id: item.id,
          name: item.name,
          description: item.description,
          publishedVersion: item.publishedVersion?.version ?? null,
          draftVersion: item.draftVersion?.version ?? null,
          bindings: item._count.bindings,
          executions: item._count.executions,
          archivedAt: item.archivedAt?.toISOString() ?? null,
          updatedAt: item.updatedAt.toISOString(),
        }))}
      />
      <RunbookPagination page={page} total={total} query={query} />
    </div>
  );
}
