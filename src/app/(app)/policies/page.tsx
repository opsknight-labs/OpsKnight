import prisma from '@/lib/prisma';
import { assertCanListPolicies, getUserPermissions } from '@/lib/rbac';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import { PageHeader } from '@/components/patterns';
import { ShieldAlert, Server, Layers, HelpCircle, ArrowRight, Calendar, Users } from 'lucide-react';
import PolicyCreateForm from '@/components/policies/PolicyCreateForm';
import PolicyDirectoryList from '@/components/policies/PolicyDirectoryList';
import { createPolicyAction } from './actions';
import { parsePageParam, calculatePaginationBounds } from '@/lib/pagination-parser';
import type { PolicyDirectoryItem } from '@/components/policies/PolicyDirectoryCard';

import { Prisma } from '@prisma/client';
import { requirePageAccess } from '@/lib/access/server';

export const revalidate = 0;

export default async function PoliciesPage({
  searchParams,
}: {
  searchParams?: Promise<{
    error?: string;
    page?: string;
    q?: string;
    search?: string;
    status?: string;
  }>;
}) {
  await requirePageAccess('/policies');
  const session = await getServerSession(await getAuthOptions());
  if (!session?.user?.email) {
    redirect('/login?callbackUrl=/policies');
  }
  await assertCanListPolicies();

  const resolvedSearchParams = await searchParams;
  const errorCode = resolvedSearchParams?.error;
  const requestedPage = parsePageParam(resolvedSearchParams?.page);
  const searchQuery = (resolvedSearchParams?.q || resolvedSearchParams?.search || '').trim();
  const statusFilter = resolvedSearchParams?.status || 'all';

  const filterConditions: Prisma.EscalationPolicyWhereInput[] = [];

  if (searchQuery) {
    filterConditions.push({
      OR: [
        { name: { contains: searchQuery, mode: 'insensitive' } },
        { description: { contains: searchQuery, mode: 'insensitive' } },
        { services: { some: { name: { contains: searchQuery, mode: 'insensitive' } } } },
      ],
    });
  }

  if (statusFilter === 'in-use') {
    filterConditions.push({ services: { some: {} } });
  } else if (statusFilter === 'unassigned') {
    filterConditions.push({ services: { none: {} } });
  }

  const where: Prisma.EscalationPolicyWhereInput =
    filterConditions.length > 0 ? { AND: filterConditions } : {};

  const [
    allPoliciesCount,
    inUsePoliciesCount,
    unassignedPoliciesCount,
    totalStepsCount,
    totalFilteredCount,
    permissions,
  ] = await Promise.all([
    prisma.escalationPolicy.count(),
    prisma.escalationPolicy.count({ where: { services: { some: {} } } }),
    prisma.escalationPolicy.count({ where: { services: { none: {} } } }),
    prisma.escalationRule.count(),
    prisma.escalationPolicy.count({ where }),
    getUserPermissions(),
  ]);

  const pagination = calculatePaginationBounds({
    totalItems: totalFilteredCount,
    page: requestedPage,
    pageSize: 50,
  });

  const policies = await prisma.escalationPolicy.findMany({
    where,
    skip: pagination.skip,
    take: pagination.take,
    include: {
      steps: {
        include: {
          targetUser: { select: { id: true, name: true } },
          targetTeam: { select: { id: true, name: true } },
          targetSchedule: { select: { id: true, name: true } },
        },
        orderBy: { stepOrder: 'asc' },
      },
      services: {
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      },
    },
    orderBy: { name: 'asc' },
  });

  const canManagePolicies = permissions.isAdmin;

  const totalPolicies = allPoliciesCount;

  // Transform policies into directory items
  const policyDirectoryItems: PolicyDirectoryItem[] = policies.map(p => ({
    id: p.id,
    name: p.name,
    description: p.description,
    stepCount: p.steps.length,
    serviceCount: p.services.length,
    services: p.services,
    steps: p.steps.map(s => ({
      id: s.id,
      stepOrder: s.stepOrder,
      delayMinutes: s.delayMinutes,
      targetType: s.targetType,
      targetUser: s.targetUser,
      targetTeam: s.targetTeam,
      targetSchedule: s.targetSchedule,
    })),
  }));

  const createAction = canManagePolicies ? (
    <PolicyCreateForm action={createPolicyAction} canCreate={canManagePolicies} />
  ) : undefined;

  const resourceLinkClass =
    'flex items-center justify-between gap-2 rounded-md px-2 py-2 text-sm font-medium text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      <PageHeader
        title="Escalation Policies"
        icon={ShieldAlert}
        description="Who gets paged for an incident, in what order, and how long to wait before paging the next responder."
        primaryAction={createAction}
        stats={[
          {
            label: 'Policies',
            value: totalPolicies,
            icon: <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />,
          },
          {
            label: 'In use',
            value: inUsePoliciesCount,
            icon: <Server className="h-3.5 w-3.5" aria-hidden="true" />,
          },
          {
            label: 'Steps',
            value: totalStepsCount,
            icon: <Layers className="h-3.5 w-3.5" aria-hidden="true" />,
          },
        ]}
        alert={
          errorCode === 'duplicate-policy' ? (
            <div
              role="alert"
              className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
            >
              An escalation policy with this name already exists. Choose a unique name.
            </div>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        <div className="space-y-4 lg:col-span-3">
          <PolicyDirectoryList
            policies={policyDirectoryItems}
            canManage={canManagePolicies}
            createAction={createAction}
            pagination={{
              currentPage: pagination.page,
              totalPages: pagination.totalPages,
              totalItems: pagination.totalItems,
              itemsPerPage: pagination.pageSize,
            }}
            filterCounts={{
              total: allPoliciesCount,
              inUse: inUsePoliciesCount,
              unassigned: unassignedPoliciesCount,
            }}
            currentSearch={searchQuery}
            currentStatus={statusFilter}
          />
        </div>

        <aside className="space-y-4" aria-label="Escalation policy guidance">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <HelpCircle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                Escalation best practices
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
              <p>
                <strong className="font-semibold text-foreground">Step 1:</strong> Page the on-call
                schedule or primary responder immediately.
              </p>
              <p>
                <strong className="font-semibold text-foreground">Step 2:</strong> Escalate to a
                backup engineer or team lead after 5–10 minutes without acknowledgement.
              </p>
              <p>
                <strong className="font-semibold text-foreground">Step 3:</strong> Page the whole
                team or an engineering manager after 15–30 minutes for critical outages.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Related</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 px-4 pb-4">
              <Link href="/services" className={resourceLinkClass}>
                <span className="flex items-center gap-2">
                  <Server className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  Services
                </span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              </Link>
              <Link href="/schedules" className={resourceLinkClass}>
                <span className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  On-call schedules
                </span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              </Link>
              <Link href="/teams" className={resourceLinkClass}>
                <span className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  Teams
                </span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              </Link>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
