import { getRunbookNavigationSummary } from '@/lib/runbooks/presentation/summaries';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability, getCurrentUser, getUserPermissions } from '@/lib/rbac';
import { RunbookPageHeader } from '@/components/runbooks/RunbookPageHeader';
import { RunbookMetricStrip } from '@/components/runbooks/RunbookMetricStrip';
import { RunbookModuleNav } from '@/components/runbooks/RunbookModuleNav';
import RunbookLibrary, { CreateRunbookDialog } from '@/components/runbooks/RunbookLibrary';
import { LibraryFilterBar } from '@/components/runbooks/library/LibraryFilterBar';
import {
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
  const [permissions, runbooks, navigation] = await Promise.all([
    getUserPermissions(),
    prisma.runbook.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * RUNBOOK_PAGE_SIZE,
      take: RUNBOOK_PAGE_SIZE,
      include: {
        publishedVersion: { select: { version: true } },
        draftVersion: { select: { version: true } },
        bindings: {
          select: {
            id: true,
            service: { select: { name: true } },
          },
          take: 3,
        },
        executions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            status: true,
            createdAt: true,
            startedAt: true,
            completedAt: true,
          },
        },
        _count: { select: { bindings: true, executions: true } },
      },
    }),
    getRunbookNavigationSummary(),
  ]);
  const canManage = permissions.capabilities.includes(CAPABILITIES.RUNBOOK_MANAGE);
  const onlineAgents = navigation.onlineAgents ?? 'Unknown';
  const executionCount = navigation.activeExecutions ?? 'Unknown';

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 p-4 md:p-6">
      {/* Compact Page Header with primary action */}
      <RunbookPageHeader
        title="Runbooks"
        description="Build, version, and safely execute operational recovery workflows. Execution operates under fail-closed guarantees."
        actions={canManage ? <CreateRunbookDialog /> : undefined}
      />

      {/* Modern High-Density Metric Strip */}
      <RunbookMetricStrip
        stats={[
          {
            label: 'Published',
            value: publishedCount,
            subtext: 'Live workflows',
            tone: 'success',
          },
          {
            label: 'Drafts',
            value: draftCount,
            subtext: 'In progress',
            tone: draftCount > 0 ? 'warning' : 'default',
          },
          {
            label: 'Active Executions',
            value: executionCount,
            subtext: 'In-flight',
            tone: typeof executionCount === 'number' && executionCount > 0 ? 'info' : 'default',
          },
          {
            label: 'Archived',
            value: archivedCount,
            subtext: 'Disabled bindings',
            href: '/runbooks?status=archived',
            active: filter.status === 'archived' || filter.tab === 'archived',
          },
          {
            label: 'Online Agents',
            value: onlineAgents,
            subtext: 'Fleet ready',
            tone: typeof onlineAgents === 'number' && onlineAgents > 0 ? 'success' : 'default',
          },
        ]}
      />

      {/* Persistent Module Navigation */}
      <RunbookModuleNav summary={navigation} />

      {/* Search & Filter Toolbar */}
      <LibraryFilterBar query={query} />

      {/* Library Operational Cards */}
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
          sampleServices: item.bindings.map(b => b.service?.name).filter((n): n is string => Boolean(n)),
          lastExecution: item.executions[0]
            ? {
                id: item.executions[0].id,
                status: item.executions[0].status,
                createdAt: item.executions[0].createdAt.toISOString(),
                startedAt: item.executions[0].startedAt?.toISOString() ?? null,
                completedAt: item.executions[0].completedAt?.toISOString() ?? null,
              }
            : null,
          archivedAt: item.archivedAt?.toISOString() ?? null,
          updatedAt: item.updatedAt.toISOString(),
        }))}
      />

      {/* Bounded Server Pagination */}
      <RunbookPagination page={page} total={total} query={query} />
    </div>
  );
}
