import {
  Activity,
  Archive,
  BookOpen,
  CheckCircle2,
  Clock,
  Lock,
  PencilLine,
  Server,
  ShieldCheck,
  Workflow,
} from 'lucide-react';
import { getRunbookNavigationSummary } from '@/lib/runbooks/presentation/summaries';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability, getCurrentUser, getUserPermissions } from '@/lib/rbac';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
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
import { z } from 'zod/v3';

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
    <div className="mx-auto w-full max-w-[1600px] space-y-4 px-3 sm:px-4 md:px-6 py-4 md:py-5">
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
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-zinc-700/80 bg-zinc-800/80 px-2.5 py-1 text-xs text-slate-300 font-medium tabular-nums shadow-xs"
              title={`All runbook library and execution timestamps reflect your profile timezone: ${userTimeZone}`}
            >
              <Clock className="h-3 w-3 text-slate-400" aria-hidden="true" />
              {userTimeZone}
            </span>
            {canManage && (
              <div className="flex items-center gap-2">
                <ImportRunbookDialog />
                <CreateRunbookDialog teams={teams} />
              </div>
            )}
          </div>
        }
        statsPlacement="bottom"
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
            label: 'Archived',
            value: archivedCount,
            icon: <Archive className="h-3.5 w-3.5 text-slate-300" />,
            valueClassName: archivedCount > 0 ? 'text-slate-300' : undefined,
            href: '/runbooks?status=archived',
            active: filter.status === 'archived' || filter.tab === 'archived',
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

      <div className="space-y-3.5 md:space-y-4">
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

        {/* Enterprise Execution Guarantee Callout */}
        <div className="relative overflow-hidden rounded-xl border border-zinc-200/90 dark:border-zinc-800/80 bg-gradient-to-r from-zinc-50/90 via-white to-zinc-50/70 dark:from-zinc-900/60 dark:via-zinc-900/40 dark:to-zinc-900/60 p-4 sm:p-5 shadow-xs transition-colors">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5 min-w-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-1 ring-inset ring-emerald-500/25">
                <ShieldCheck className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="space-y-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-bold tracking-tight text-foreground">
                    Enterprise Execution Guarantee
                  </h3>
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                    <Lock className="h-2.5 w-2.5" aria-hidden="true" />
                    Immutable &amp; Signed
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed max-w-4xl">
                  Published runbook versions are immutable and cryptographically checksummed before
                  fleet dispatch. Production changes with non-idempotent risk classes require peer
                  approval gates and generate end-to-end audit telemetry.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 self-start sm:self-center shrink-0 rounded-lg border border-border/80 bg-background/90 px-3 py-1.5 shadow-2xs">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75 motion-reduce:hidden" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              <span className="text-xs font-semibold text-foreground tabular-nums">
                {onlineAgents} Fleet Runners Online
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
