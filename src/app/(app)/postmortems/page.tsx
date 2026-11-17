import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { getAllPostmortems } from './actions';
import { getCurrentAuthorizationActor, getUserPermissions } from '@/lib/rbac';
import {
  incidentReadWhere,
  postmortemReadWhere,
  serviceReadWhere,
} from '@/lib/authorization-filters';
import prisma from '@/lib/prisma';
import Link from 'next/link';
import { PageHeader } from '@/components/patterns';
import { FileText, CheckCircle2, Clock, Archive, Plus } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import PostmortemsListTable from '@/components/postmortem/PostmortemsListTable';

import PostmortemsFilters from '@/components/postmortem/PostmortemsFilters';
import { parsePageParam, parseEnumValue } from '@/lib/pagination-parser';
import { requirePageAccess } from '@/lib/access/server';

export default async function PostmortemsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; search?: string; serviceId?: string; page?: string }>;
}) {
  await requirePageAccess('/postmortems');
  const session = await getServerSession(await getAuthOptions());
  if (!session) {
    redirect('/login');
  }

  const params = await searchParams;
  const status = parseEnumValue(params.status, ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const);
  const search = params.search;
  const serviceId = params.serviceId;
  const page = parsePageParam(params.page);
  const [permissions, actor] = await Promise.all([
    getUserPermissions(),
    getCurrentAuthorizationActor(),
  ]);

  const [{ postmortems, pagination }, services] = await Promise.all([
    getAllPostmortems({ status, search, serviceId, page }),
    prisma.service.findMany({
      where: serviceReadWhere(actor),
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);
  const canCreate = permissions.isResponderOrAbove;

  // Get resolved incidents without postmortems for quick create
  const resolvedIncidentsWithoutPostmortems = canCreate
    ? await prisma.incident.findMany({
        where: {
          AND: [incidentReadWhere(actor), { status: 'RESOLVED', postmortem: null }],
        },
        select: {
          id: true,
          title: true,
          resolvedAt: true,
        },
        orderBy: { resolvedAt: 'desc' },
        take: 10,
      })
    : [];

  // Fetch counts for metrics
  const postmortemAccess = postmortemReadWhere(actor);
  const [totalCount, publishedCount, draftCount, archivedCount] = await Promise.all([
    prisma.postmortem.count({ where: postmortemAccess }),
    prisma.postmortem.count({ where: { AND: [postmortemAccess, { status: 'PUBLISHED' }] } }),
    prisma.postmortem.count({ where: { AND: [postmortemAccess, { status: 'DRAFT' }] } }),
    prisma.postmortem.count({ where: { AND: [postmortemAccess, { status: 'ARCHIVED' }] } }),
  ]);

  const pendingCount = resolvedIncidentsWithoutPostmortems.length;
  const createAction =
    canCreate && pendingCount > 0 ? (
      <Button asChild>
        <Link href="/postmortems/create">
          <Plus aria-hidden="true" />
          New postmortem
          <span
            className="rounded-full bg-primary-foreground/15 px-1.5 text-xs font-semibold tabular-nums"
            aria-label={`${pendingCount} resolved incidents without a postmortem`}
          >
            {pendingCount}
          </span>
        </Link>
      </Button>
    ) : undefined;
  const hasFilters = Boolean(status || search || serviceId);

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      <PageHeader
        title="Postmortems"
        icon={FileText}
        description="What happened during resolved incidents, why it happened, and what the team is changing so it does not happen again."
        primaryAction={createAction}
        statsPlacement="bottom"
        stats={[
          {
            label: 'All',
            value: totalCount,
            icon: <FileText className="h-3.5 w-3.5" aria-hidden="true" />,
            href: '/postmortems',
            active: !status,
          },
          {
            label: 'Published',
            value: publishedCount,
            icon: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" />,
            href: '/postmortems?status=PUBLISHED',
            active: status === 'PUBLISHED',
          },
          {
            label: 'Drafts',
            value: draftCount,
            icon: <Clock className="h-3.5 w-3.5 text-amber-300" aria-hidden="true" />,
            href: '/postmortems?status=DRAFT',
            active: status === 'DRAFT',
          },
          {
            label: 'Archived',
            value: archivedCount,
            icon: <Archive className="h-3.5 w-3.5" aria-hidden="true" />,
            href: '/postmortems?status=ARCHIVED',
            active: status === 'ARCHIVED',
          },
        ]}
      />

      <div className="space-y-4">
        <PostmortemsFilters
          currentStatus={status}
          currentSearch={search}
          currentServiceId={serviceId}
          services={services}
          postmortemsData={postmortems}
        />

        <PostmortemsListTable
          postmortems={postmortems}
          pagination={pagination}
          canManage={canCreate}
          hasFilters={hasFilters}
          createAction={createAction}
        />
      </div>
    </div>
  );
}
