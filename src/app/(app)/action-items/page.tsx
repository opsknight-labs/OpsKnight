import { Prisma } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import { getCurrentAuthorizationActor, getUserPermissions } from '@/lib/rbac';
import { dashboardUserReadWhere, postmortemReadWhere } from '@/lib/authorization-filters';
import ActionItemsBoard from '@/components/action-items/ActionItemsBoard';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import { CheckSquare, Circle, Clock, CheckCircle2, AlertOctagon } from 'lucide-react';
import { resolveStoredActionItems, type ActionItem } from '@/lib/action-items';
import { getJiraCapabilitiesByServiceIds } from '@/lib/jira-capabilities';
import {
  serializeJiraIssueReference,
  type JiraIssueReference,
} from '@/lib/jira-references';

export const dynamic = 'force-dynamic';

export default async function ActionItemsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    owner?: string;
    priority?: string;
    view?: 'board' | 'list';
  }>;
}) {
  const session = await getServerSession(await getAuthOptions());
  if (!session) redirect('/login');

  const params = await searchParams;
  const status = params.status as 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'BLOCKED' | undefined;
  const owner = params.owner;
  const priority = params.priority as 'HIGH' | 'MEDIUM' | 'LOW' | undefined;
  const view = params.view || 'board';
  const [permissions, actor] = await Promise.all([
    getUserPermissions(),
    getCurrentAuthorizationActor(),
  ]);

  const postmortems = await prisma.postmortem.findMany({
    where: {
      AND: [
        postmortemReadWhere(actor),
        {
          OR: [
            { actionItems: { not: Prisma.JsonNull } },
            { actionItemRecords: { some: {} } },
          ],
        },
      ],
    },
    include: {
      incident: {
        select: {
          id: true,
          title: true,
          service: {
            select: {
              id: true,
              name: true,
            },
          },
          externalIssueLinks: {
            where: { provider: 'JIRA' },
            orderBy: { createdAt: 'desc' as const },
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
      createdBy: {
        select: { id: true, name: true, email: true },
      },
      actionItemRecords: {
        include: {
          externalIssueLinks: {
            orderBy: { createdAt: 'desc' as const },
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
        orderBy: { createdAt: 'asc' as const },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const allActionItems: Array<
    ActionItem & {
      postmortemId: string;
      postmortemTitle: string;
      incidentId: string;
      incidentTitle: string;
      serviceId: string;
      serviceName: string;
      incidentJiraIssues: JiraIssueReference[];
      createdAt: Date;
    }
  > = [];

  postmortems.forEach(postmortem => {
    const actionItems = resolveStoredActionItems({
      records: postmortem.actionItemRecords,
      legacy: postmortem.actionItems,
      legacyIdPrefix: `postmortem-${postmortem.id}`,
    });
    const incidentJiraIssues = postmortem.incident.externalIssueLinks.map(
      serializeJiraIssueReference
    );

    actionItems.forEach(item => {
      allActionItems.push({
        ...item,
        postmortemId: postmortem.id,
        postmortemTitle: postmortem.title,
        incidentId: postmortem.incidentId,
        incidentTitle: postmortem.incident.title,
        serviceId: postmortem.incident.service.id,
        serviceName: postmortem.incident.service.name,
        incidentJiraIssues,
        createdAt: postmortem.createdAt,
      });
    });
  });

  const now = new Date();
  const stats = {
    total: 0,
    open: 0,
    inProgress: 0,
    completed: 0,
    blocked: 0,
    overdue: 0,
    highPriority: 0,
  };

  const filteredItems: typeof allActionItems = [];

  for (const item of allActionItems) {
    stats.total++;
    if (item.status === 'OPEN') stats.open++;
    else if (item.status === 'IN_PROGRESS') stats.inProgress++;
    else if (item.status === 'COMPLETED') stats.completed++;
    else if (item.status === 'BLOCKED') stats.blocked++;

    if (item.dueDate && item.status !== 'COMPLETED' && new Date(item.dueDate) < now) stats.overdue++;
    if (item.priority === 'HIGH' && item.status !== 'COMPLETED') stats.highPriority++;

    if (status && item.status !== status) continue;
    if (owner && item.owner !== owner) continue;
    if (priority && item.priority !== priority) continue;
    filteredItems.push(item);
  }

  const users = await prisma.user.findMany({
    where: { AND: [{ status: 'ACTIVE' }, dashboardUserReadWhere(actor)] },
    select: { id: true, name: true, email: true },
    orderBy: { name: 'asc' },
  });

  const canManage = permissions.isResponderOrAbove;
  const jiraCapabilitiesByServiceId = await getJiraCapabilitiesByServiceIds(
    filteredItems.map(item => item.serviceId),
    canManage
  );

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
            href: '/action-items',
            active: !status && !priority && !owner,
          },
          {
            label: 'Open',
            value: stats.open,
            icon: <Circle className="h-3.5 w-3.5 text-blue-200" />,
            valueClassName: stats.open > 0 ? 'text-blue-200' : undefined,
            href: '/action-items?status=OPEN',
            active: status === 'OPEN',
          },
          {
            label: 'In Progress',
            value: stats.inProgress,
            icon: <Clock className="h-3.5 w-3.5 text-amber-200" />,
            valueClassName: stats.inProgress > 0 ? 'text-amber-200' : undefined,
            href: '/action-items?status=IN_PROGRESS',
            active: status === 'IN_PROGRESS',
          },
          {
            label: 'Completed',
            value: stats.completed,
            icon: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-200" />,
            valueClassName: stats.completed > 0 ? 'text-emerald-200' : undefined,
            href: '/action-items?status=COMPLETED',
            active: status === 'COMPLETED',
          },
          {
            label: 'Blocked',
            value: stats.blocked,
            icon: <AlertOctagon className="h-3.5 w-3.5 text-rose-200" />,
            valueClassName: stats.blocked > 0 ? 'text-rose-200' : undefined,
            href: '/action-items?status=BLOCKED',
            active: status === 'BLOCKED',
          },
        ]}
      />

      <ActionItemsBoard
        actionItems={filteredItems}
        users={users}
        canManage={canManage}
        view={view}
        filters={{ status, owner, priority }}
        jiraCapabilitiesByServiceId={jiraCapabilitiesByServiceId}
      />
    </div>
  );
}
