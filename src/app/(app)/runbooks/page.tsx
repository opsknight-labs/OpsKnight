import {
  Activity,
  Archive,
  BookOpen,
  CheckCircle2,
  PencilLine,
  Server,
  Workflow,
} from 'lucide-react';
import { getRunbookNavigationSummary } from '@/lib/runbooks/presentation/summaries';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability, getCurrentUser, getUserPermissions } from '@/lib/rbac';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import { Card, CardContent } from '@/components/ui/shadcn/card';
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
  const [totalLibraryCount, publishedCount, draftCount, archivedCount, teams, popularTags] =
    await Promise.all([
      prisma.runbook.count({ where: { archivedAt: null } }),
      prisma.runbook.count({
        where: { archivedAt: null, publishedVersionId: { not: null } },
      }),
      prisma.runbook.count({
        where: { archivedAt: null, draftVersionId: { not: null } },
      }),
      prisma.runbook.count({
        where: { archivedAt: { not: null } },
      }),
      prisma.team.findMany({
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
        take: 200,
      }),
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
    <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      {/* Centralized Glassmorphic Hero Banner matching Services */}
      <DetailHeroBanner
        tag="Automation & Remediation Catalog"
        title="Runbooks"
        icon={
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-foreground/15 text-primary-foreground ring-1 ring-inset ring-primary-foreground/20">
            <Workflow className="h-6 w-6" aria-hidden="true" />
          </div>
        }
        subtitle={
          <p className="text-xs text-primary-foreground/85 leading-relaxed">
            Version-controlled, safety-verified automated recovery workflows and diagnostics for
            incident responders.
          </p>
        }
        actions={
          canManage ? (
            <div className="flex items-center gap-2">
              <CreateRunbookDialog teams={teams} />
            </div>
          ) : undefined
        }
        stats={[
          {
            label: 'Total Runbooks',
            value: totalLibraryCount,
            icon: <BookOpen className="h-3.5 w-3.5" />,
            href: '/runbooks',
          },
          {
            label: 'Published',
            value: publishedCount,
            icon: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-200" />,
            valueClassName: 'text-emerald-200',
            href: '/runbooks?status=published',
          },
          {
            label: 'Active Drafts',
            value: draftCount,
            icon: <PencilLine className="h-3.5 w-3.5 text-amber-200" />,
            valueClassName: draftCount > 0 ? 'text-amber-200' : undefined,
            href: '/runbooks?status=draft',
          },
          {
            label: 'Running Now',
            value: executionCount,
            icon: <Activity className="h-3.5 w-3.5 text-sky-200" />,
            valueClassName:
              typeof executionCount === 'number' && executionCount > 0 ? 'text-sky-200' : undefined,
            href: '/runbooks/executions',
          },
          {
            label: 'Fleet Agents',
            value: onlineAgents,
            icon: <Server className="h-3.5 w-3.5 text-emerald-200" />,
            valueClassName:
              typeof onlineAgents === 'number' && onlineAgents > 0 ? 'text-emerald-200' : undefined,
            href: '/runbooks/agents',
          },
        ]}
      />

      <RunbookModuleNav summary={navigation} />

      <div className="space-y-4 md:space-y-5">
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

        {/* Enterprise Contextual Operational Card matching Services */}
        <Card className="bg-muted/40 border-dashed">
          <CardContent className="p-5 text-sm text-muted-foreground flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <strong className="text-foreground font-semibold">
                Enterprise Execution Guarantee:
              </strong>{' '}
              Published runbook versions are immutable and cryptographically checksummed before
              execution. Production changes with non-idempotent risk classes require peer approval
              gates.
            </div>
            <div className="flex items-center gap-2 text-xs shrink-0">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75 motion-reduce:hidden" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              <span className="font-medium text-foreground">
                {onlineAgents} Fleet Runners Online
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
