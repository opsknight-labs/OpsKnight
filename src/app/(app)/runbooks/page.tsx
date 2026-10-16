import { Activity, Archive, CheckCircle2, PencilLine, Server } from 'lucide-react';
import { getRunbookNavigationSummary } from '@/lib/runbooks/presentation/summaries';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability, getCurrentUser, getUserPermissions } from '@/lib/rbac';
import { RunbookPageHeader } from '@/components/runbooks/RunbookPageHeader';
import { StatTile } from '@/components/runbooks/ui/primitives';
import { RunbookModuleNav } from '@/components/runbooks/RunbookModuleNav';
import RunbookLibrary, { CreateRunbookDialog } from '@/components/runbooks/RunbookLibrary';
import { ImportRunbookDialog } from '@/components/runbooks/detail/ImportRunbookDialog';
import { LibraryFilterBar } from '@/components/runbooks/library/LibraryFilterBar';
import {
  RunbookPagination,
  runbookPageQuery,
  RUNBOOK_PAGE_SIZE,
} from '@/components/runbooks/RunbookPagination';
import { runbookLibraryFilterSchema } from '@/lib/runbooks/schemas';
import { buildRunbookLibraryWhere } from '@/lib/runbooks/lifecycle';
import { isValidRunbookTag } from '@/lib/runbooks/metadata-form';
import { getUserTimeZone } from '@/lib/timezone';
import { cn } from '@/lib/utils';
import { z } from 'zod';

export const revalidate = 0;

const POPULAR_TAG_LIMIT = 30;
const cuidSchema = z.string().cuid();

async function getPopularRunbookTags() {
  const rows = await prisma.$queryRaw<Array<{ tag: string; count: bigint }>>`
    SELECT t.tag, COUNT(*)::bigint AS count
    FROM "Runbook" r, unnest(r."tags") AS t(tag)
    WHERE r."archivedAt" IS NULL
    GROUP BY t.tag
    ORDER BY count DESC, t.tag ASC
    LIMIT ${POPULAR_TAG_LIMIT}
  `;
  return rows.map(row => ({ tag: row.tag, count: Number(row.count) }));
}

export default async function RunbooksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await assertCapability(CAPABILITIES.RUNBOOK_READ_ALL);
  const user = await getCurrentUser();
  const userTimeZone = getUserTimeZone(user);
  const { query: rawQuery, page: requestedPage } = runbookPageQuery(await searchParams);
  const query = { ...rawQuery };
  if (query.team && !cuidSchema.safeParse(query.team).success) delete query.team;
  if (query.tag) {
    const tag = query.tag.trim().toLowerCase();
    if (isValidRunbookTag(tag)) query.tag = tag;
    else delete query.tag;
  }
  const filter = runbookLibraryFilterSchema.parse({
    q: query.q,
    status: ['all', 'published', 'draft', 'archived'].includes(query.status)
      ? (query.status as 'all' | 'published' | 'draft' | 'archived')
      : undefined,
    tab: ['all', 'published', 'drafts', 'archived'].includes(query.tab)
      ? (query.tab as 'all' | 'published' | 'drafts' | 'archived')
      : undefined,
    ownerId: query.owner,
    teamId: query.team,
    tag: query.tag,
    serviceId: query.service,
    page: requestedPage,
  });
  const hasActiveFilters = Boolean(
    filter.q?.trim() ||
    (filter.status && filter.status !== 'all') ||
    (filter.tab && filter.tab !== 'all') ||
    filter.ownerId ||
    filter.teamId ||
    filter.tag ||
    filter.serviceId
  );
  const where = buildRunbookLibraryWhere(filter);
  const total = await prisma.runbook.count({ where });
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / RUNBOOK_PAGE_SIZE)));
  const [publishedCount, draftCount, archivedCount, teams, popularTags] = await Promise.all([
    prisma.runbook.count({
      where: { archivedAt: null, publishedVersionId: { not: null } },
    }),
    prisma.runbook.count({
      where: { archivedAt: null, draftVersionId: { not: null } },
    }),
    prisma.runbook.count({
      where: { archivedAt: { not: null } },
    }),
    prisma.team.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 200 }),
    getPopularRunbookTags(),
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
        ownerTeam: { select: { id: true, name: true } },
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
    <div className="mx-auto w-full max-w-[1600px] space-y-6 p-4 md:p-6">
      <RunbookPageHeader
        title="Runbooks"
        description="Versioned, safety-checked recovery workflows your responders can run with confidence."
        actions={
          canManage ? (
            <div className="flex flex-wrap items-center gap-2">
              <ImportRunbookDialog />
              <CreateRunbookDialog teams={teams} />
            </div>
          ) : undefined
        }
      />

      <RunbookModuleNav summary={navigation} />

      <section
        aria-label="Library summary"
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5"
      >
        <StatTile
          label="Published"
          value={publishedCount}
          hint="Live for services"
          icon={CheckCircle2}
          tone="success"
          href="/runbooks?status=published"
        />
        <StatTile
          label="Drafts"
          value={draftCount}
          hint={draftCount > 0 ? 'Waiting to publish' : 'Nothing in progress'}
          icon={PencilLine}
          tone={draftCount > 0 ? 'warning' : 'neutral'}
          href="/runbooks?status=draft"
        />
        <StatTile
          label="Running now"
          value={executionCount}
          hint="Active executions"
          icon={Activity}
          tone={typeof executionCount === 'number' && executionCount > 0 ? 'info' : 'neutral'}
          href="/runbooks/executions"
        />
        <StatTile
          label="Online agents"
          value={onlineAgents}
          hint="Ready to execute"
          icon={Server}
          tone={typeof onlineAgents === 'number' && onlineAgents > 0 ? 'success' : 'neutral'}
          href="/runbooks/agents"
        />
        <StatTile
          label="Archived"
          value={archivedCount}
          hint="Bindings disabled"
          icon={Archive}
          href="/runbooks?status=archived"
          className={cn(
            'col-span-2 sm:col-span-1',
            (filter.status === 'archived' || filter.tab === 'archived') && 'border-primary/40'
          )}
        />
      </section>

      {/* Search text is excluded from the key so typing keeps focus */}
      <LibraryFilterBar
        key={JSON.stringify({ ...query, q: undefined })}
        query={query}
        teams={teams}
        popularTags={popularTags}
      />

      {/* Library Operational Cards */}
      <RunbookLibrary
        total={total}
        canManage={canManage}
        userTimeZone={userTimeZone}
        teams={teams}
        hasActiveFilters={hasActiveFilters}
        runbooks={runbooks.map(item => ({
          id: item.id,
          name: item.name,
          description: item.description,
          publishedVersion: item.publishedVersion?.version ?? null,
          draftVersion: item.draftVersion?.version ?? null,
          bindings: item._count.bindings,
          executions: item._count.executions,
          sampleServices: item.bindings
            .map(b => b.service?.name)
            .filter((n): n is string => Boolean(n)),
          ownerTeam: item.ownerTeam,
          tags: item.tags,
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
