import { Prisma, type ActionItemStatus, type ActionItemPriority } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import { getCurrentAuthorizationActor, getUserPermissions } from '@/lib/rbac';
import { dashboardUserReadWhere, postmortemReadWhere } from '@/lib/authorization-filters';
import ActionItemsBoard, { type BoardActionItem } from '@/components/action-items/ActionItemsBoard';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import { CheckSquare, Circle, Clock, CheckCircle2, AlertOctagon } from 'lucide-react';
import { getJiraCapabilitiesByServiceIds } from '@/lib/jira-capabilities';
import { serializeJiraIssueReference } from '@/lib/jira-references';
import { resolveStoredActionItems, formatActionItemDueDate } from '@/lib/action-items';
import {
  parsePageParam,
  calculatePaginationBounds,
  parseEnumValue,
} from '@/lib/pagination-parser';

export const dynamic = 'force-dynamic';

const ALLOWED_STATUSES = ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED'] as const;
const ALLOWED_PRIORITIES = ['HIGH', 'MEDIUM', 'LOW'] as const;

export default async function ActionItemsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    owner?: string;
    priority?: string;
    view?: 'board' | 'list';
    page?: string;
  }>;
}) {
  const session = await getServerSession(await getAuthOptions());
  if (!session) redirect('/login');

  const params = await searchParams;
  const status = parseEnumValue(params.status, ALLOWED_STATUSES);
  const owner = params.owner;
  const priority = parseEnumValue(params.priority, ALLOWED_PRIORITIES);
  const view = params.view || 'board';
  const requestedPage = parsePageParam(params.page);

  const [permissions, actor] = await Promise.all([
    getUserPermissions(),
    getCurrentAuthorizationActor(),
  ]);

  const baseWhere: Prisma.ActionItemWhereInput = {
    postmortem: postmortemReadWhere(actor),
    ...(owner ? { ownerId: owner } : {}),
    ...(priority ? { priority: priority as ActionItemPriority } : {}),
  };

  const filterWhere: Prisma.ActionItemWhereInput = {
    ...baseWhere,
    ...(status ? { status: status as ActionItemStatus } : {}),
  };

  const now = new Date();

  // Aggregate stats directly from database + unmigrated legacy postmortem records
  const [statusCounts, overdueCount, highPriorityCount, totalCount, users, unmigratedPostmortems] =
    await Promise.all([
      prisma.actionItem.groupBy({
        by: ['status'],
        where: baseWhere,
        _count: { _all: true },
      }),
      prisma.actionItem.count({
        where: {
          ...baseWhere,
          dueDate: { lt: now },
          status: { not: 'COMPLETED' },
        },
      }),
      prisma.actionItem.count({
        where: {
          ...baseWhere,
          priority: 'HIGH',
          status: { not: 'COMPLETED' },
        },
      }),
      prisma.actionItem.count({ where: filterWhere }),
      prisma.user.findMany({
        where: { AND: [{ status: 'ACTIVE' }, dashboardUserReadWhere(actor)] },
        select: { id: true, name: true, email: true },
        orderBy: { name: 'asc' },
      }),
      prisma.postmortem.findMany({
        where: {
          AND: [
            postmortemReadWhere(actor),
            { actionItems: { not: Prisma.JsonNull } },
            { actionItemRecords: { none: {} } },
          ],
        },
        select: {
          id: true,
          title: true,
          incidentId: true,
          createdAt: true,
          actionItems: true,
          incident: {
            select: {
              id: true,
              title: true,
              service: {
                select: { id: true, name: true },
              },
              externalIssueLinks: {
                where: { provider: 'JIRA' },
                orderBy: { createdAt: 'desc' },
                select: {
                  id: true,
                  provider: true,
                  externalKey: true,
                  externalUrl: true,
                  externalStatus: true,
                  externalAssignee: true,
                  syncState: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

  const legacyItems: BoardActionItem[] = unmigratedPostmortems.flatMap(pm => {
    const items = resolveStoredActionItems({
      records: [],
      legacy: pm.actionItems,
      legacyIdPrefix: `postmortem-${pm.id}`,
    });
    const incidentJiraIssues = pm.incident.externalIssueLinks.map(serializeJiraIssueReference);
    return items.map(item => ({
      ...item,
      description: item.description ?? '',
      owner: item.owner,
      dueDate: item.dueDate,
      source: 'POSTMORTEM' as const,
      postmortemId: pm.id,
      postmortemTitle: pm.title,
      incidentId: pm.incidentId,
      incidentTitle: pm.incident.title,
      serviceId: pm.incident.service.id,
      serviceName: pm.incident.service.name,
      incidentJiraIssues,
      createdAt: pm.createdAt,
      completedAt: item.completedAt,
    }));
  });

  const matchingLegacyItems = legacyItems.filter(item => {
    if (owner && item.owner !== owner) return false;
    if (priority && item.priority !== priority) return false;
    if (status && item.status !== status) return false;
    return true;
  });

  const statusMap = new Map(statusCounts.map(s => [s.status, s._count._all]));
  const stats = {
    total: statusCounts.reduce((acc, curr) => acc + curr._count._all, 0),
    open: statusMap.get('OPEN') || 0,
    inProgress: statusMap.get('IN_PROGRESS') || 0,
    completed: statusMap.get('COMPLETED') || 0,
    blocked: statusMap.get('BLOCKED') || 0,
    overdue: overdueCount,
    highPriority: highPriorityCount,
  };

  for (const item of legacyItems) {
    if (owner && item.owner !== owner) continue;
    if (priority && item.priority !== priority) continue;

    stats.total++;
    if (item.status === 'OPEN') stats.open++;
    else if (item.status === 'IN_PROGRESS') stats.inProgress++;
    else if (item.status === 'COMPLETED') stats.completed++;
    else if (item.status === 'BLOCKED') stats.blocked++;

    if (item.dueDate && item.status !== 'COMPLETED' && new Date(item.dueDate) < now) {
      stats.overdue++;
    }
    if (item.priority === 'HIGH' && item.status !== 'COMPLETED') {
      stats.highPriority++;
    }
  }

  const totalFilteredCount = totalCount + matchingLegacyItems.length;

  const pagination = calculatePaginationBounds({
    totalItems: totalFilteredCount,
    page: requestedPage,
    pageSize: 100,
  });

  const records = await prisma.actionItem.findMany({
    where: filterWhere,
    include: {
      postmortem: {
        select: {
          id: true,
          title: true,
          incidentId: true,
          createdAt: true,
          incident: {
            select: {
              id: true,
              title: true,
              service: {
                select: { id: true, name: true },
              },
              externalIssueLinks: {
                where: { provider: 'JIRA' },
                orderBy: { createdAt: 'desc' },
                select: {
                  id: true,
                  provider: true,
                  externalKey: true,
                  externalUrl: true,
                  externalStatus: true,
                  externalAssignee: true,
                  syncState: true,
                },
              },
            },
          },
        },
      },
      externalIssueLinks: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          id: true,
          provider: true,
          externalKey: true,
          externalUrl: true,
          externalStatus: true,
          externalAssignee: true,
          syncState: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    skip: matchingLegacyItems.length === 0 ? pagination.skip : undefined,
    take: matchingLegacyItems.length === 0 ? pagination.take : undefined,
  });

  const normalizedItems: BoardActionItem[] = records.map(record => ({
    id: record.id,
    title: record.title,
    description: record.description ?? '',
    owner: record.ownerId ?? undefined,
    dueDate: formatActionItemDueDate(record.dueDate),
    status: record.status,
    priority: record.priority,
    source: record.source,
    postmortemId: record.postmortem.id,
    postmortemTitle: record.postmortem.title,
    incidentId: record.postmortem.incidentId,
    incidentTitle: record.postmortem.incident.title,
    serviceId: record.postmortem.incident.service.id,
    serviceName: record.postmortem.incident.service.name,
    incidentJiraIssues: record.postmortem.incident.externalIssueLinks.map(
      serializeJiraIssueReference
    ),
    externalIssue: record.externalIssueLinks[0]
      ? serializeJiraIssueReference(record.externalIssueLinks[0])
      : undefined,
    createdAt: record.createdAt,
    completedAt: record.completedAt,
  }));

  const filteredItems: BoardActionItem[] =
    matchingLegacyItems.length === 0
      ? normalizedItems
      : [...normalizedItems, ...matchingLegacyItems]
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(pagination.skip, pagination.skip + pagination.take);

  const canManage = permissions.isResponderOrAbove;
  const jiraCapabilitiesByServiceId = await getJiraCapabilitiesByServiceIds(
    filteredItems.map(item => item.serviceId),
    canManage
  );

  const buildStatUrl = (targetStatus?: string) => {
    const p = new URLSearchParams();
    if (targetStatus && targetStatus !== status) p.set('status', targetStatus);
    if (owner) p.set('owner', owner);
    if (priority) p.set('priority', priority);
    if (view && view !== 'board') p.set('view', view);
    const qs = p.toString();
    return qs ? `/action-items?${qs}` : '/action-items';
  };

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      <DetailHeroBanner
        tag="Postmortem Follow-Up"
        title="Action Items"
        icon={
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-foreground/15 text-primary-foreground ring-1 ring-inset ring-primary-foreground/20">
            <CheckSquare className="h-6 w-6" aria-hidden="true" />
          </div>
        }
        subtitle={
          <p className="text-xs text-primary-foreground/85 leading-relaxed">
            Track preventive action items, assign ownership, manage SLAs, and prevent incident
            recurrence.
          </p>
        }
        statsPlacement="bottom"
        stats={[
          {
            label: 'Total',
            value: stats.total,
            icon: <CheckSquare className="h-3.5 w-3.5" />,
            href: buildStatUrl(undefined),
            active: !status,
          },
          {
            label: 'Open',
            value: stats.open,
            icon: <Circle className="h-3.5 w-3.5 text-blue-200" />,
            valueClassName: stats.open > 0 ? 'text-blue-200' : undefined,
            href: buildStatUrl('OPEN'),
            active: status === 'OPEN',
          },
          {
            label: 'In Progress',
            value: stats.inProgress,
            icon: <Clock className="h-3.5 w-3.5 text-amber-200" />,
            valueClassName: stats.inProgress > 0 ? 'text-amber-200' : undefined,
            href: buildStatUrl('IN_PROGRESS'),
            active: status === 'IN_PROGRESS',
          },
          {
            label: 'Completed',
            value: stats.completed,
            icon: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-200" />,
            valueClassName: stats.completed > 0 ? 'text-emerald-200' : undefined,
            href: buildStatUrl('COMPLETED'),
            active: status === 'COMPLETED',
          },
          {
            label: 'Blocked',
            value: stats.blocked,
            icon: <AlertOctagon className="h-3.5 w-3.5 text-rose-200" />,
            valueClassName: stats.blocked > 0 ? 'text-rose-200' : undefined,
            href: buildStatUrl('BLOCKED'),
            active: status === 'BLOCKED',
          },
        ]}
      />

      <ActionItemsBoard
        key={`${status || 'all'}-${owner || 'all'}-${priority || 'all'}-${view}-${pagination.page}`}
        actionItems={filteredItems}
        users={users}
        canManage={canManage}
        view={view}
        filters={{ status, owner, priority }}
        jiraCapabilitiesByServiceId={jiraCapabilitiesByServiceId}
        pagination={{
          currentPage: pagination.page,
          totalPages: pagination.totalPages,
          totalItems: pagination.totalItems,
          itemsPerPage: pagination.pageSize,
        }}
      />
    </div>
  );
}
